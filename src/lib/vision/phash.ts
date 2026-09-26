import sharp from "sharp";

/**
 * 64-bit DCT perceptual hash (pHash) — ADR 0022.
 *
 * Görsel 32×32 gri tona indirilir, 2B DCT-II alınır; en düşük frekanslı 8×8 katsayı
 * (DC hariç) medyanla karşılaştırılarak 64 bit üretilir. Yeniden boyutlandırma, JPEG
 * yeniden sıkıştırma ve hafif renk/parlaklık değişimi hash'i az değiştirir; bu yüzden
 * duplikat tespiti Hamming mesafesiyle yapılır (eşik: `VISION_DUPLICATE_MAX_HAMMING`).
 * Dış bağımlılık yok (`sharp` zaten görsel hattında).
 */

const SIZE = 32;
const LOW = 8;

/** Önceden hesaplanmış DCT kosinüs tablosu: COS[u][x] = cos((2x+1)uπ / 2N). */
const COS: Float64Array[] = Array.from({ length: LOW }, (_, u) => {
  const row = new Float64Array(SIZE);
  for (let x = 0; x < SIZE; x++) row[x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE));
  return row;
});

/** 32×32 gri piksel dizisinden (satır öncelikli) 16 hex karakterlik pHash. */
export function pHashFromGray(pixels: ArrayLike<number>): string {
  if (pixels.length !== SIZE * SIZE) {
    throw new Error(`pHash girdisi ${SIZE * SIZE} piksel olmalı`);
  }
  // Ayrılabilir DCT: önce satırlar (yalnız ilk 8 frekans), sonra sütunlar.
  const rows: Float64Array[] = [];
  for (let y = 0; y < SIZE; y++) {
    const out = new Float64Array(LOW);
    for (let u = 0; u < LOW; u++) {
      let s = 0;
      for (let x = 0; x < SIZE; x++) s += pixels[y * SIZE + x]! * COS[u]![x]!;
      out[u] = s;
    }
    rows.push(out);
  }
  const coeffs: number[] = [];
  for (let v = 0; v < LOW; v++) {
    for (let u = 0; u < LOW; u++) {
      let s = 0;
      for (let y = 0; y < SIZE; y++) s += rows[y]![u]! * COS[v]![y]!;
      coeffs.push(s);
    }
  }
  // DC (ortalama parlaklık) medyanı domine etmesin.
  const median = [...coeffs.slice(1)].sort((a, b) => a - b)[Math.floor((coeffs.length - 1) / 2)]!;
  let hash = 0n;
  for (const c of coeffs) hash = (hash << 1n) | (c > median ? 1n : 0n);
  return hash.toString(16).padStart(16, "0");
}

/** Görsel baytlarından pHash (EXIF yönü uygulanır). */
export async function computePHash(image: Buffer): Promise<string> {
  const { data } = await sharp(image)
    .rotate()
    .grayscale()
    .resize(SIZE, SIZE, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return pHashFromGray(data);
}

const POPCOUNT4 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** İki 16 hex pHash arasındaki Hamming mesafesi (0..64). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("pHash uzunlukları farklı");
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d += POPCOUNT4[parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)]!;
  }
  return d;
}
