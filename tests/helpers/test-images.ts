import sharp from "sharp";

/**
 * Testler için deterministik görseller (ağ/dosya yok). `seed` farklı → farklı desen.
 * Desen: renkli bloklar + ince doku (netlik için kenar), JPEG/PNG baytı döner.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function patternRaw(seed: number, width = 256, height = 192): Buffer {
  const rnd = mulberry32(seed);
  const cells = 6;
  const palette = Array.from({ length: cells * cells }, () => [
    Math.floor(rnd() * 256),
    Math.floor(rnd() * 256),
    Math.floor(rnd() * 256),
  ]);
  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c =
        palette[Math.floor((y * cells) / height) * cells + Math.floor((x * cells) / width)]!;
      const stripe = (x + y) % 8 < 4 ? 20 : -20;
      for (let ch = 0; ch < 3; ch++) {
        buf[(y * width + x) * 3 + ch] = Math.max(0, Math.min(255, c[ch]! + stripe));
      }
    }
  }
  return buf;
}

export async function patternImage(
  seed: number,
  opts: { width?: number; height?: number; format?: "png" | "jpeg"; blur?: number } = {}
): Promise<Buffer> {
  const width = opts.width ?? 256;
  const height = opts.height ?? 192;
  let img = sharp(patternRaw(seed, width, height), { raw: { width, height, channels: 3 } });
  if (opts.blur) img = img.blur(opts.blur);
  return opts.format === "png" ? img.png().toBuffer() : img.jpeg({ quality: 90 }).toBuffer();
}

export async function solidImage(value: number, width = 128, height = 96): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: value, g: value, b: value } },
  })
    .png()
    .toBuffer();
}
