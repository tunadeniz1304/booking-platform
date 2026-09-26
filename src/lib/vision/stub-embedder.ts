import sharp from "sharp";
import { CLIP_DIMENSIONS, normalizeVector, type ImageEmbedder } from "@/lib/vision/clip";

/**
 * Deterministik stub görsel embedder (testler ve çevrimdışı demo; ağ/model yok).
 *
 * CLIP değildir: görseli 16×16 RGB'ye indirir (768 değer), 512 boyuta katlayıp ortalamayı
 * çıkarır ve L2-normalize eder. Aynı/benzer görseller yüksek, farklı renk/düzen düşük kosinüs
 * benzerliği verir — kNN ve RRF yolunu uçtan uca sınamak için yeterli.
 */
const GRID = 16;

export const STUB_MODEL_ID = "stub/rgb-16x16";

export function createStubImageEmbedder(): ImageEmbedder {
  return {
    modelId: STUB_MODEL_ID,
    async embedImage(image: Buffer): Promise<number[]> {
      const { data } = await sharp(image)
        .rotate()
        .removeAlpha()
        .resize(GRID, GRID, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const folded = new Array<number>(CLIP_DIMENSIONS).fill(0);
      for (let i = 0; i < data.length; i++) folded[i % CLIP_DIMENSIONS]! += data[i]! / 255;
      const mean = folded.reduce((a, b) => a + b, 0) / CLIP_DIMENSIONS;
      return normalizeVector(folded.map((v) => v - mean));
    },
  };
}
