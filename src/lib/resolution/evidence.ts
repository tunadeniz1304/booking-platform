import { createHash } from "crypto";
import sharp, { type OutputInfo } from "sharp";
import { getConfig } from "@/lib/config/app-config";
import { ValidationError } from "@/lib/http/errors";

/**
 * P1-5 kanıt yükleme temizliği. İstemcinin bildirdiği içerik tipine GÜVENİLMEZ: tür dosyanın
 * kendi imzasından (magic bytes) ve `sharp` çözümlemesinden belirlenir.
 *
 *  - Görsel (JPEG/PNG/WebP/AVIF/GIF-ilk kare): `sharp` ile piksel sınırı altında çözülür,
 *    EXIF yönüne göre döndürülür, kenar sınırına küçültülür ve WebP (fotoğraf) olarak YENİDEN
 *    KODLANIR. `withMetadata` çağrılmadığından EXIF/GPS/XMP/IPTC/ICC dahil hiçbir metadata
 *    çıktıya taşınmaz (piksel dışı gömülü içerik, poliglot dosyalar da düşer).
 *  - PDF: yeniden kodlanmaz; yalnız `%PDF-` imzası, `%%EOF` sonu, boyut sınırı ve içerik tipi
 *    doğrulanır, sunarken `Content-Disposition: attachment` + CSP sandbox ile verilir.
 *  - Diğer her şey reddedilir.
 */

const IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "avif", "heif", "gif"]);
const WEBP_QUALITY = 82;

export interface SanitizedEvidence {
  data: Buffer;
  contentType: "image/webp" | "application/pdf";
  width: number | null;
  height: number | null;
  sha256: string;
}

type Sniffed = "jpeg" | "png" | "webp" | "gif" | "avif" | "pdf" | null;

/** Dosya imzasından tür (uzantı / beyan edilen MIME yok sayılır). */
export function sniffType(buf: Buffer): Sniffed {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "png";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString("ascii", 0, 6))) return "gif";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 4, 8) === "ftyp" &&
    /^(avif|avis|heic|heix|mif1)$/.test(buf.toString("ascii", 8, 12))
  )
    return "avif";
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "pdf";
  return null;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function sanitizeEvidence(input: Buffer): Promise<SanitizedEvidence> {
  const cfg = getConfig();
  if (input.byteLength === 0) throw new ValidationError("Boş dosya");
  const kind = sniffType(input);
  if (!kind)
    throw new ValidationError("Desteklenmeyen dosya türü (JPEG/PNG/WebP/AVIF/GIF veya PDF)");

  if (kind === "pdf") {
    if (input.byteLength > cfg.CLAIM_EVIDENCE_PDF_MAX_BYTES) {
      throw new ValidationError("PDF çok büyük");
    }
    // Sondaki boşluk/satır sonları dışında `%%EOF` ile bitmeli (kesik/poliglot dosyaya karşı).
    const tail = input.subarray(Math.max(0, input.byteLength - 1024)).toString("latin1");
    if (!tail.trimEnd().endsWith("%%EOF")) throw new ValidationError("PDF dosyası bozuk");
    return {
      data: input,
      contentType: "application/pdf",
      width: null,
      height: null,
      sha256: sha256(input),
    };
  }

  if (input.byteLength > cfg.CLAIM_EVIDENCE_MAX_BYTES)
    throw new ValidationError("Görsel çok büyük");
  const limitInputPixels = cfg.CLAIM_EVIDENCE_MAX_PIXELS;
  let format: string | undefined;
  try {
    const meta = await sharp(input, { limitInputPixels }).metadata();
    format = meta.format;
    if ((meta.width ?? 0) * (meta.height ?? 0) > limitInputPixels) {
      throw new ValidationError("Görsel piksel sınırını aşıyor");
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Görsel okunamadı");
  }
  if (!format || !IMAGE_FORMATS.has(format))
    throw new ValidationError("Desteklenmeyen görsel biçimi");
  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(input, { limitInputPixels, pages: 1 })
      .rotate()
      .resize(cfg.CLAIM_EVIDENCE_MAX_EDGE_PX, cfg.CLAIM_EVIDENCE_MAX_EDGE_PX, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ValidationError("Görsel işlenemedi");
  }
  return {
    data: out.data,
    contentType: "image/webp",
    width: out.info.width,
    height: out.info.height,
    sha256: sha256(out.data),
  };
}
