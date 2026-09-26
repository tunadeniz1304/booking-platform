/**
 * PWA ikonlarını `public/icons/icon.svg`'den üretir (P1-12): `node scripts/generate-pwa-icons.mjs`.
 * Çıktılar depoya eklenir; derleme sırasında çalışmaz. Maskable ikon güvenli bölge için
 * %20 kenar boşluklu düz arka planla üretilir.
 */
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const svg = await readFile("public/icons/icon.svg");
const out = (name) => `public/icons/${name}`;

for (const size of [192, 512]) {
  await sharp(svg)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out(`icon-${size}.png`));
}
await sharp(svg)
  .resize(180, 180)
  .flatten({ background: "#003580" })
  .png()
  .toFile(out("apple-touch-icon.png"));
const inner = await sharp(svg).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#003580" } })
  .composite([{ input: inner, gravity: "center" }])
  .png({ compressionLevel: 9 })
  .toFile(out("maskable-512.png"));
console.log("PWA ikonları üretildi");
