import sharp from "sharp";

/**
 * Test yardımcıları (P1-5): GPS'li EXIF taşıyan görsel üretir ve EXIF'te GPS IFD'sinin
 * (etiket 0x8825) kaç girdi taşıdığını okur. Bağımlılıksız, yalnız TIFF başlığı + IFD0.
 */
export async function jpegWithGps(width = 96, height = 64): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 90, b: 30 } },
  })
    .jpeg()
    .withExif({
      IFD0: { Make: "TestCam", Model: "GPS-1", Copyright: "test" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "41/1 0/1 3600/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "28/1 58/1 1200/100",
      },
    })
    .toBuffer();
}

/** EXIF blok(sharp `metadata().exif`) içindeki GPS IFD girdi sayısı; GPS yoksa 0. */
export function gpsEntryCount(exif: Buffer | undefined): number {
  if (!exif || exif.length < 14) return 0;
  const start = exif.toString("latin1", 0, 6) === "Exif\u0000\u0000" ? 6 : 0;
  const tiff = exif.subarray(start);
  const le = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd0 = u32(4);
  const entries = u16(ifd0);
  for (let i = 0; i < entries; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === 0x8825) {
      const gps = u32(e + 8);
      return gps + 2 <= tiff.length ? u16(gps) : 0;
    }
  }
  return 0;
}
