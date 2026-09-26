/**
 * v4 demo seed ekleri (P2-2) — `prisma/seed.ts` sonunda çağrılır; tekrar çalıştırmak güvenlidir.
 *
 *  - Demo ev sahibine `HostAccount` (mock bağlı hesap, KYC doğrulanmış, payout açık).
 *  - Birkaç promosyon (erken rezervasyon, son dakika, uzun konaklama, kupon).
 *  - Seed ilan görsellerinden birkaçı `PropertyPhoto`'ya alınır: ağ varsa ilanın ilk URL'si
 *    indirilir (kısa zaman aşımı), yoksa deterministik bir sahne görseli üretilir. Kalite,
 *    pHash ve embedding (CLIP modeli yoksa deterministik stub) hesaplanır → görsel arama
 *    demoda çalışır (`VISION_CLIP_ENABLED=true`). `SEED_OFFLINE_IMAGES=1` ağı hiç denemez.
 *  - Doğrulanmış erişilebilirlik özellikleri (kanıt fotoğrafı bağlı, yönetici onaylı).
 *  - Seed'in ödenmiş rezervasyonlarına tahsilat jurnali → mutabakat demoda fark 0.
 */
import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { Redis } from "ioredis";
import { postBookingCapture } from "../src/lib/ledger/booking-money";
import { computeQuality, normalizeUpload } from "../src/lib/vision/quality";
import { computePHash } from "../src/lib/vision/phash";
import { getImageEmbedder, type ImageEmbedder } from "../src/lib/vision/clip";
import { createStubImageEmbedder } from "../src/lib/vision/stub-embedder";

const PROMOTIONS = [
  {
    title: "Grand Deluxe Hotel",
    name: "Erken rezervasyon %10",
    type: "EARLY_BIRD" as const,
    discountBps: 1000,
    minDaysBefore: 30,
  },
  {
    title: "Alanya Beach Club",
    name: "Son dakika %15",
    type: "LAST_MINUTE" as const,
    discountBps: 1500,
    maxDaysBefore: 7,
  },
  {
    title: "Villa Amara",
    name: "Uzun konaklama (7+ gece) %12",
    type: "LONG_STAY" as const,
    discountBps: 1200,
    minNights: 7,
  },
];

/** Görsel alınacak ilanlar (v3 demo senaryolarının kullandığı ilanlar hariç tutuldu). */
const PHOTO_TITLES = [
  "Grand Deluxe Hotel",
  "City Center Apart",
  "Luxury Bosphorus Suite",
  "Sunset Beach Resort",
  "Alanya Beach Club",
  "Mountain View Lodge",
  "Cave Suite Cappadocia",
  "Old Town Boutique Hotel",
];

/** Doğrulanmış erişilebilirlik özellikleri (ilan düzeyi; ilk oda tipine duş özelliği). */
const ACCESSIBILITY: Record<string, Array<{ code: string; widthCm?: number; room?: boolean }>> = {
  "Grand Deluxe Hotel": [
    { code: "STEP_FREE_ENTRANCE" },
    { code: "ELEVATOR" },
    { code: "WIDE_DOORWAY", widthCm: 90 },
    { code: "ROLL_IN_SHOWER", room: true },
  ],
  "City Center Apart": [{ code: "ELEVATOR" }, { code: "STEP_FREE_PATH_TO_ROOM" }],
  "Luxury Bosphorus Suite": [{ code: "STEP_FREE_ENTRANCE" }, { code: "GRAB_BARS", room: true }],
};

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

/** Ağsız yedek: gökyüzü + deniz/kara + bina silüeti; ilan başına deterministik renkler. */
export async function generateSceneImage(index: number): Promise<Buffer> {
  const rnd = mulberry32(1000 + index * 7919);
  const hue = Math.floor(rnd() * 360);
  const w = 960;
  const h = 640;
  const horizon = Math.floor(h * (0.45 + rnd() * 0.15));
  const buildings: string[] = [];
  let x = 20;
  while (x < w - 60) {
    const bw = 50 + Math.floor(rnd() * 90);
    const bh = 80 + Math.floor(rnd() * 220);
    const light = 30 + Math.floor(rnd() * 40);
    buildings.push(
      `<rect x="${x}" y="${horizon - bh}" width="${bw}" height="${bh}" fill="hsl(${(hue + 180) % 360},25%,${light}%)"/>`
    );
    for (let wy = horizon - bh + 12; wy < horizon - 16; wy += 26) {
      for (let wx = x + 8; wx < x + bw - 14; wx += 18) {
        if (rnd() > 0.35) {
          buildings.push(
            `<rect x="${wx}" y="${wy}" width="8" height="12" fill="hsl(48,90%,${60 + Math.floor(rnd() * 25)}%)"/>`
          );
        }
      }
    }
    x += bw + 10 + Math.floor(rnd() * 30);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},80%,80%)"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  <circle cx="${120 + Math.floor(rnd() * 700)}" cy="${60 + Math.floor(rnd() * 80)}" r="36" fill="hsl(45,100%,85%)"/>
  <rect y="${horizon}" width="${w}" height="${h - horizon}" fill="hsl(${(hue + 200) % 360},45%,${30 + Math.floor(rnd() * 20)}%)"/>
  ${buildings.join("\n  ")}
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function fetchImage(url: string): Promise<Buffer | null> {
  if (process.env.SEED_OFFLINE_IMAGES === "1" || !/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function embedderForSeed(): Promise<ImageEmbedder> {
  const res = await getImageEmbedder();
  return res.embedder ?? createStubImageEmbedder();
}

async function seedPhotos(
  prisma: PrismaClient,
  hostId: string
): Promise<{
  photoByProperty: Map<string, string>;
  downloaded: number;
  generated: number;
  model: string;
}> {
  const embedder = await embedderForSeed();
  const photoByProperty = new Map<string, string>();
  let downloaded = 0;
  let generated = 0;
  for (const [i, title] of PHOTO_TITLES.entries()) {
    const property = await prisma.property.findFirst({
      where: { title, hostId },
      select: { id: true, images: true },
    });
    if (!property) continue;
    await prisma.propertyPhoto.deleteMany({ where: { propertyId: property.id } });
    let raw = await fetchImage(property.images[0] ?? "");
    if (raw) downloaded++;
    else {
      raw = await generateSceneImage(i);
      generated++;
    }
    const normalized = await normalizeUpload(raw);
    const [quality, pHash] = await Promise.all([
      computeQuality(normalized.data),
      computePHash(normalized.data),
    ]);
    const photo = await prisma.propertyPhoto.create({
      data: {
        propertyId: property.id,
        uploadedById: hostId,
        contentType: normalized.contentType,
        data: normalized.data,
        width: normalized.width,
        height: normalized.height,
        byteSize: normalized.data.byteLength,
        ...quality,
        pHash,
        embeddingModel: embedder.modelId,
      },
      select: { id: true },
    });
    const vector = await embedder.embedImage(normalized.data);
    await prisma.$executeRaw`
      UPDATE "PropertyPhoto" SET embedding = ${`[${vector.join(",")}]`}::vector
      WHERE id = ${photo.id}`;
    photoByProperty.set(title, photo.id);
  }
  return { photoByProperty, downloaded, generated, model: embedder.modelId };
}

/** Seed'in PAID ödemelerine eksik `BOOKING_CAPTURED` jurnalini yazar (idempotent anahtar). */
async function seedCaptureJournals(prisma: PrismaClient): Promise<number> {
  const payments = await prisma.payment.findMany({
    where: { status: "PAID", paidAt: { not: null }, cartPaymentId: null },
    select: {
      id: true,
      bookingId: true,
      currency: true,
      amountMinor: true,
      paidAt: true,
      booking: { select: { priceBreakdown: true } },
    },
  });
  let posted = 0;
  for (const p of payments) {
    const exists = await prisma.journalEntry.count({
      where: { paymentId: p.id, kind: "BOOKING_CAPTURED" },
    });
    if (exists > 0) continue;
    await prisma.$transaction((tx) =>
      postBookingCapture(tx, {
        bookingId: p.bookingId,
        paymentId: p.id,
        currency: p.currency,
        grossMinor: p.amountMinor,
        priceBreakdown: p.booking.priceBreakdown,
        occurredAt: p.paidAt!,
      })
    );
    posted++;
  }
  return posted;
}

/**
 * Seed ilan kimliklerini yeniden ürettiği için çalışan uygulamanın arama katalog önbelleği
 * eski kimlikleri döndürür (tarihli + kişi sayılı aramada boş sonuç). Katalog sürümü
 * artırılır (`src/lib/search.ts` → CATALOG_VERSION_KEY); Redis yoksa sessizce atlanır.
 */
async function bumpSearchCatalogVersion(): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return false;
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.incr("search:catalog:version");
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

export async function seedV4Extras(
  prisma: PrismaClient,
  ids: { hostId: string; adminId: string }
): Promise<void> {
  const { hostId, adminId } = ids;

  await prisma.hostAccount.upsert({
    where: { userId: hostId },
    update: { kycStatus: "VERIFIED", payoutsEnabled: true, payoutsPaused: false },
    create: {
      userId: hostId,
      provider: "mock",
      connectedAccountRef: "acct_mock_demo_host",
      kycStatus: "VERIFIED",
      payoutsEnabled: true,
    },
  });

  await prisma.promotion.deleteMany({ where: { hostId } });
  let promotions = 0;
  for (const p of PROMOTIONS) {
    const property = await prisma.property.findFirst({
      where: { title: p.title, hostId },
      select: { id: true },
    });
    if (!property) continue;
    await prisma.promotion.create({
      data: {
        hostId,
        propertyId: property.id,
        name: p.name,
        type: p.type,
        discountBps: p.discountBps,
        minDaysBefore: p.minDaysBefore ?? null,
        maxDaysBefore: p.maxDaysBefore ?? null,
        minNights: p.minNights ?? null,
      },
    });
    promotions++;
  }
  await prisma.promotion.create({
    data: {
      hostId,
      name: "Hoş geldin kuponu (150 TL)",
      type: "COUPON",
      couponCode: "HOSGELDIN",
      discountMinor: 15_000n,
      currency: "TRY",
      usageLimit: 100,
    },
  });
  promotions++;

  const photos = await seedPhotos(prisma, hostId);

  let features = 0;
  for (const [title, list] of Object.entries(ACCESSIBILITY)) {
    const property = await prisma.property.findFirst({
      where: { title, hostId },
      select: { id: true, rooms: { select: { id: true }, orderBy: { id: "asc" }, take: 1 } },
    });
    const evidencePhotoId = photos.photoByProperty.get(title);
    if (!property || !evidencePhotoId) continue;
    await prisma.accessibilityFeature.deleteMany({ where: { propertyId: property.id } });
    for (const f of list) {
      await prisma.accessibilityFeature.create({
        data: {
          propertyId: property.id,
          roomTypeId: f.room ? (property.rooms[0]?.id ?? null) : null,
          code: f.code as never,
          widthCm: f.widthCm ?? null,
          note: "Demo: yönetici kanıt fotoğrafıyla doğruladı",
          evidencePhotoId,
          verifiedAt: new Date(),
          verifiedById: adminId,
        },
      });
      features++;
    }
  }

  const journals = await seedCaptureJournals(prisma);
  const cacheBumped = await bumpSearchCatalogVersion();
  console.log(
    `v4 ekleri: HostAccount ✓, promosyon ${promotions}, fotoğraf ${photos.photoByProperty.size} ` +
      `(indirilen ${photos.downloaded}, üretilen ${photos.generated}; embedding ${photos.model}), ` +
      `erişilebilirlik ${features} (doğrulanmış), tahsilat jurnali ${journals}, ` +
      `arama önbelleği ${cacheBumped ? "yenilendi" : "atlandı (Redis yok)"}`
  );
}
