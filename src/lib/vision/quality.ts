import sharp from "sharp";
import { getConfig } from "@/lib/config/app-config";
import { ValidationError } from "@/lib/http/errors";

/**
 * Fotoğraf kalite skoru (P1-10, ADR 0022) — deterministik, model gerektirmez.
 *
 *  - **Netlik**: gri tonda (uzun kenar ≤ 512 px) 4-komşu Laplacian yanıtının varyansı.
 *    Bulanık görselde kenarlar yumuşak → varyans düşük. Skor = min(1, var / VISION_BLUR_VARIANCE_GOOD).
 *  - **Pozlama**: parlaklık histogramı; ortalama orta tona (128) yakınsa ve uçlarda
 *    (≤8 / ≥247) kırpılmış piksel azsa yüksek.
 *  - **Kalite** = w·netlik + (1−w)·pozlama (w = VISION_QUALITY_BLUR_WEIGHT).
 *
 * Skorlar yalnız host'a uyarı ve sıralama dışı bilgi içindir; ilan otomatik reddedilmez.
 */

const ANALYSIS_EDGE = 512;
const CLIP_LOW = 8;
const CLIP_HIGH = 247;

export interface QualityScores {
  blurVariance: number;
  blurScore: number;
  exposureScore: number;
  qualityScore: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** Satır öncelikli gri görüntüde 4-komşu Laplacian yanıtının varyansı (kenar pikseller hariç). */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - width]! + gray[i + width]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** 256 kutulu parlaklık histogramından 0..1 pozlama skoru. */
export function exposureFromHistogram(hist: ArrayLike<number>): number {
  let total = 0;
  let weighted = 0;
  let clipped = 0;
  for (let i = 0; i < 256; i++) {
    const c = hist[i] ?? 0;
    total += c;
    weighted += i * c;
    if (i <= CLIP_LOW || i >= CLIP_HIGH) clipped += c;
  }
  if (total === 0) return 0;
  const mean = weighted / total;
  const centered = 1 - Math.abs(mean - 128) / 128;
  const clipPenalty = Math.min(1, (clipped / total) * 2);
  return clamp01(centered * (1 - clipPenalty));
}

/** Gri piksellerden kalite skorları (saf; birim testlerde doğrudan kullanılır). */
export function scoreGray(gray: ArrayLike<number>, width: number, height: number): QualityScores {
  const cfg = getConfig();
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]!]!++;
  const blurVariance = laplacianVariance(gray, width, height);
  const blurScore = clamp01(blurVariance / cfg.VISION_BLUR_VARIANCE_GOOD);
  const exposureScore = exposureFromHistogram(hist);
  const w = cfg.VISION_QUALITY_BLUR_WEIGHT;
  return {
    blurVariance: round4(blurVariance),
    blurScore: round4(blurScore),
    exposureScore: round4(exposureScore),
    qualityScore: round4(w * blurScore + (1 - w) * exposureScore),
  };
}

export async function computeQuality(image: Buffer): Promise<QualityScores> {
  const { data, info } = await sharp(image)
    .rotate()
    .grayscale()
    .resize(ANALYSIS_EDGE, ANALYSIS_EDGE, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return scoreGray(data, info.width, info.height);
}

export interface NormalizedImage {
  data: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
}

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "heif"]);
const WEBP_QUALITY = 82;
/** Dekompresyon bombasına karşı üst piksel sınırı (~8000×8000). */
const MAX_INPUT_PIXELS = 64_000_000;

/**
 * Yüklenen baytı doğrular ve normalize eder: yalnız raster fotoğraf biçimleri; EXIF yönü
 * uygulanır, meta veri (GPS dahil) atılır, uzun kenar `VISION_MAX_EDGE_PX` ile sınırlanır, WebP.
 */
export async function normalizeUpload(input: Buffer): Promise<NormalizedImage> {
  const cfg = getConfig();
  if (input.byteLength === 0) throw new ValidationError("Boş dosya");
  if (input.byteLength > cfg.VISION_MAX_UPLOAD_BYTES) {
    throw new ValidationError("Fotoğraf çok büyük");
  }
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    throw new ValidationError("Görsel okunamadı");
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    throw new ValidationError("Desteklenmeyen görsel biçimi (JPEG/PNG/WebP/AVIF)");
  }
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(cfg.VISION_MAX_EDGE_PX, cfg.VISION_MAX_EDGE_PX, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { data, contentType: "image/webp", width: info.width, height: info.height };
}
