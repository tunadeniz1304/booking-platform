import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { resetConfigForTests } from "@/lib/config/app-config";
import { computePHash, hammingDistance, pHashFromGray } from "@/lib/vision/phash";
import {
  computeQuality,
  exposureFromHistogram,
  laplacianVariance,
  normalizeUpload,
} from "@/lib/vision/quality";
import { patternImage, solidImage } from "../../helpers/test-images";

beforeEach(() => resetConfigForTests());

describe("P1-10 kalite skoru", () => {
  it("Laplacian varyansı: düz görüntüde 0, keskin kenarda yüksek", () => {
    const flat = new Array(16 * 16).fill(100);
    expect(laplacianVariance(flat, 16, 16)).toBe(0);
    const checker = Array.from({ length: 16 * 16 }, (_, i) =>
      ((i % 16) + Math.floor(i / 16)) % 2 === 0 ? 0 : 255
    );
    expect(laplacianVariance(checker, 16, 16)).toBeGreaterThan(10_000);
    expect(laplacianVariance([1, 2, 3, 4], 2, 2)).toBe(0);
  });

  it("pozlama: orta ton 1'e yakın, kırpılmış siyah/beyaz 0", () => {
    const hist = (bin: number) => Array.from({ length: 256 }, (_, i) => (i === bin ? 100 : 0));
    expect(exposureFromHistogram(hist(128))).toBe(1);
    expect(exposureFromHistogram(hist(0))).toBe(0);
    expect(exposureFromHistogram(hist(255))).toBe(0);
    expect(exposureFromHistogram(hist(64))).toBeCloseTo(0.5, 2);
    expect(exposureFromHistogram(new Array(256).fill(0))).toBe(0);
  });

  it("bulanık fotoğraf netlik ve kalite skorunda keskin olanın altında kalır", async () => {
    const sharpQ = await computeQuality(await patternImage(1));
    const blurQ = await computeQuality(await patternImage(1, { blur: 6 }));
    expect(sharpQ.blurScore).toBeGreaterThan(blurQ.blurScore);
    expect(sharpQ.qualityScore).toBeGreaterThan(blurQ.qualityScore);
    expect(blurQ.blurScore).toBeLessThan(0.35);
  });

  it("karanlık fotoğrafın pozlama skoru düşük", async () => {
    const dark = await computeQuality(await solidImage(5));
    const mid = await computeQuality(await solidImage(128));
    expect(dark.exposureScore).toBe(0);
    expect(mid.exposureScore).toBe(1);
  });

  it("eşikler env'den okunur (sihirli sayı yok)", async () => {
    process.env.VISION_BLUR_VARIANCE_GOOD = "1";
    process.env.VISION_QUALITY_BLUR_WEIGHT = "1";
    resetConfigForTests();
    const q = await computeQuality(await patternImage(2));
    expect(q.blurScore).toBe(1);
    expect(q.qualityScore).toBe(1);
    delete process.env.VISION_BLUR_VARIANCE_GOOD;
    delete process.env.VISION_QUALITY_BLUR_WEIGHT;
  });
});

describe("P1-10 normalize", () => {
  it("WebP'ye çevirir, uzun kenarı sınırlar, meta veriyi atar", async () => {
    process.env.VISION_MAX_EDGE_PX = "256";
    resetConfigForTests();
    const src = await sharp(await patternImage(3, { width: 640, height: 480 }))
      .withMetadata({ exif: { IFD0: { Copyright: "gizli" } } })
      .jpeg()
      .toBuffer();
    const out = await normalizeUpload(src);
    expect(out.contentType).toBe("image/webp");
    expect(Math.max(out.width, out.height)).toBe(256);
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    delete process.env.VISION_MAX_EDGE_PX;
  });

  it("boş, okunamayan, desteklenmeyen ve büyük dosyayı 400 ile reddeder", async () => {
    await expect(normalizeUpload(Buffer.alloc(0))).rejects.toThrow("Boş");
    await expect(normalizeUpload(Buffer.from("merhaba dünya"))).rejects.toThrow("okunamadı");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
    await expect(normalizeUpload(svg)).rejects.toThrow(/Desteklenmeyen|okunamadı/);
    process.env.VISION_MAX_UPLOAD_BYTES = "10000";
    resetConfigForTests();
    await expect(
      normalizeUpload(await patternImage(4, { width: 512, height: 512, format: "png" }))
    ).rejects.toThrow("büyük");
    delete process.env.VISION_MAX_UPLOAD_BYTES;
  });
});

describe("P1-10 pHash + Hamming duplikat", () => {
  it("aynı fotoğrafın yeniden boyutlandırılmış/sıkıştırılmış kopyası yakın, farklı fotoğraf uzak", async () => {
    const original = await patternImage(10, { width: 512, height: 384, format: "png" });
    const resized = await sharp(original).resize(200).jpeg({ quality: 60 }).toBuffer();
    const brighter = await sharp(original).modulate({ brightness: 1.1 }).toBuffer();
    const other = await patternImage(11, { width: 512, height: 384 });
    const [h0, h1, h2, h3] = await Promise.all(
      [original, resized, brighter, other].map((b) => computePHash(b))
    );
    expect(h0).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(h0!, h1!)).toBeLessThanOrEqual(8);
    expect(hammingDistance(h0!, h2!)).toBeLessThanOrEqual(8);
    expect(hammingDistance(h0!, h3!)).toBeGreaterThan(8);
  });

  it("hammingDistance bit farkını sayar; uzunluk uyuşmazlığı hata", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("0000000000000001", "0000000000000003")).toBe(1);
    expect(() => hammingDistance("00", "000")).toThrow();
  });

  it("pHashFromGray deterministik; yanlış boyut hata", () => {
    const px = Array.from({ length: 1024 }, (_, i) => (i * 37) % 256);
    expect(pHashFromGray(px)).toBe(pHashFromGray(px));
    expect(() => pHashFromGray([1, 2, 3])).toThrow();
  });
});
