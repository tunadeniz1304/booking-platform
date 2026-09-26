/**
 * `npm run import:insideairbnb` — Inside Airbnb İstanbul ilanlarının küçük bir alt kümesini
 * demo veritabanına aktarır (P2-2). Opsiyonel: OSM POI'larıyla açıklamayı zenginleştirir.
 *
 * VERİ ATFI: Inside Airbnb (https://insideairbnb.com) — Creative Commons Attribution 4.0
 * International (CC BY 4.0). Veri uyarlanmıştır (alan eşleme, alt küme, fiyat biçimi); her
 * içe aktarılan ilanın açıklamasında kaynak belirtilir. OSM POI'ları © OpenStreetMap
 * katkıda bulunanlar, ODbL 1.0. Ayrıntı: README → "Veri atfı".
 *
 *   npm run import:insideairbnb -- --file=./listings.csv          # yerel dosya (.csv/.csv.gz)
 *   npm run import:insideairbnb -- --url=https://data.insideairbnb.com/turkey/marmara/istanbul/<tarih>/visualisations/listings.csv
 *   npm run import:insideairbnb -- --file=… --limit=100 --osm --publish
 *   npm run import:insideairbnb -- --file=… --dry-run              # yalnız eşleme özeti
 *
 * Ortam: INSIDEAIRBNB_FILE / INSIDEAIRBNB_URL / INSIDEAIRBNB_LIMIT (varsayılan 50, en çok
 * 1000). Kaynak verilmemişse, dosya yoksa veya ağ erişilemiyorsa bilgi verip ATLAR (çıkış 0).
 * `--publish`: ilanlar demo için "belge doğrulanmış" işaretlenir (aksi halde PENDING kalır ve
 * aramada görünmez — 7464 belge kuralı). Yalnız demo modunda (`DEMO_MODE=true`) yazar.
 * Tekrar çalıştırmak güvenlidir: aynı Inside Airbnb id'si güncellenir, kopya açılmaz.
 */
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";
import { loadEnv } from "../src/lib/config/load-env";
import { assertSeedAllowed } from "../src/lib/config/seed-guard";
import {
  bboxOf,
  csvRecords,
  externalMarker,
  mapListing,
  nearestPois,
  overpassQuery,
  parseOverpass,
  poiSentence,
  type MappedListing,
  type Poi,
} from "../src/lib/import/insideairbnb";

const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const IMPORT_HOST_EMAIL = "insideairbnb-import@booking.test";
const INVENTORY_DAYS = 180;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

function skip(message: string): never {
  console.log(`[insideairbnb] atlandı: ${message}`);
  process.exit(0);
}

async function readSource(): Promise<{ bytes: Buffer; label: string }> {
  const file = arg("file") ?? process.env.INSIDEAIRBNB_FILE;
  const url = arg("url") ?? process.env.INSIDEAIRBNB_URL;
  if (file) {
    if (!existsSync(file)) skip(`dosya bulunamadı: ${file}`);
    return { bytes: readFileSync(file), label: file };
  }
  if (!url) {
    skip(
      "kaynak verilmedi (--file=… veya --url=…, ya da INSIDEAIRBNB_FILE/INSIDEAIRBNB_URL). " +
        "İstanbul verisi: https://insideairbnb.com/get-the-data/ (CC BY 4.0)"
    );
  }
  if (!/^https:\/\//.test(url)) skip(`yalnız https URL desteklenir: ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) skip(`indirme başarısız (HTTP ${res.status}): ${url}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), label: url };
  } catch (error) {
    skip(`ağ erişilemiyor (${(error as Error).message}): ${url}`);
  }
}

function decode(bytes: Buffer): string {
  const gz = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return (gz ? gunzipSync(bytes) : bytes).toString("utf8");
}

async function fetchPois(listings: MappedListing[]): Promise<Poi[]> {
  const points = listings
    .filter((l) => l.latitude !== null && l.longitude !== null)
    .map((l) => ({ lat: l.latitude!, lon: l.longitude! }));
  const box = bboxOf(points);
  if (!box) {
    console.log("[insideairbnb] OSM atlandı: koordinatlı ilan yok");
    return [];
  }
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        // Overpass kullanım politikası: tanımlayıcı User-Agent (yoksa 406).
        "user-agent": "booking-platform-demo-import/1.0 (portfolio; +README)",
      },
      body: `data=${encodeURIComponent(overpassQuery(box))}`,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.log(`[insideairbnb] OSM atlandı: Overpass HTTP ${res.status}`);
      return [];
    }
    const pois = parseOverpass(await res.json());
    console.log(`[insideairbnb] OSM POI: ${pois.length}`);
    return pois;
  } catch (error) {
    console.log(`[insideairbnb] OSM atlandı: ağ erişilemiyor (${(error as Error).message})`);
    return [];
  }
}

function utcDay(offset: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

async function upsertListing(
  prisma: PrismaClient,
  l: MappedListing,
  ctx: { hostId: string; locationId: string; publish: boolean; description: string }
): Promise<"created" | "updated"> {
  const license = ctx.publish
    ? {
        licenseStatus: "VERIFIED" as const,
        licenseNumber: l.licenseNumber ?? `IAB-${l.externalId}`,
      }
    : { licenseStatus: "PENDING" as const, licenseNumber: l.licenseNumber };
  const existing = await prisma.property.findFirst({
    where: { hostId: ctx.hostId, description: { contains: externalMarker(l.externalId) } },
    select: { id: true },
  });
  const data = {
    title: l.title,
    description: ctx.description,
    propertyType: l.propertyType,
    basePriceMinor: l.nightlyMinor,
    images: l.imageUrl ? [l.imageUrl] : [],
    ...license,
  };
  if (existing) {
    await prisma.property.update({ where: { id: existing.id }, data });
    return "updated";
  }
  await prisma.$transaction(async (tx) => {
    const property = await tx.property.create({
      data: {
        ...data,
        hostId: ctx.hostId,
        locationId: ctx.locationId,
        currency: "TRY",
        cancellationPolicyId: "policy_moderate_v1",
      },
    });
    const room = await tx.roomType.create({
      data: {
        propertyId: property.id,
        name: l.propertyType === "APARTMENT" ? "Tüm ev" : "Oda",
        maxOccupancy: l.maxOccupancy,
        units: 1,
        bedType: "Çift",
        ratePlans: { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] },
      },
    });
    await tx.inventoryDay.createMany({
      data: Array.from({ length: INVENTORY_DAYS }, (_, i) => ({
        roomTypeId: room.id,
        date: utcDay(i),
        priceMinor: l.nightlyMinor,
        total: 1,
      })),
    });
  });
  return "created";
}

async function main(): Promise<void> {
  loadEnv();
  const limit = Number(arg("limit") ?? process.env.INSIDEAIRBNB_LIMIT ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("--limit 1..1000 arası tamsayı olmalı");
  }
  const dryRun = arg("dry-run") === "true";
  const publish = arg("publish") === "true";
  const withOsm = arg("osm") === "true";

  const { bytes, label } = await readSource();
  const records = csvRecords(decode(bytes));
  const listings: MappedListing[] = [];
  const skipped = new Map<string, number>();
  for (const rec of records) {
    if (listings.length >= limit) break;
    const r = mapListing(rec);
    if (r.ok) listings.push(r.listing);
    else skipped.set(r.reason, (skipped.get(r.reason) ?? 0) + 1);
  }
  console.log(
    `[insideairbnb] kaynak=${label}: ${records.length} kayıt, eşlenen=${listings.length} (sınır ${limit})` +
      (skipped.size ? `, atlanan: ${[...skipped].map(([k, v]) => `${k}=${v}`).join(", ")}` : "")
  );
  if (listings.length === 0) skip("eşlenebilir ilan yok");

  const pois = withOsm ? await fetchPois(listings) : [];
  const describe = (l: MappedListing): string => {
    if (pois.length === 0 || l.latitude === null || l.longitude === null) return l.description;
    const sentence = poiSentence(nearestPois({ lat: l.latitude, lon: l.longitude }, pois));
    return sentence ? `${l.description}\n\n${sentence}` : l.description;
  };

  if (dryRun) {
    for (const l of listings.slice(0, 5)) {
      console.log(`  - ${l.externalId} ${l.propertyType} ${l.nightlyMinor} minor: ${l.title}`);
    }
    console.log("[insideairbnb] --dry-run: veritabanına yazılmadı");
    return;
  }

  assertSeedAllowed();
  const prisma = new PrismaClient();
  try {
    const host = await prisma.user.upsert({
      where: { email: IMPORT_HOST_EMAIL },
      update: {},
      create: {
        email: IMPORT_HOST_EMAIL,
        // Giriş yapılamaz (bcrypt biçiminde değil): yalnız içe aktarılan ilanların sahibi.
        passwordHash: "!disabled",
        firstName: "Inside Airbnb",
        lastName: "İçe aktarım",
        role: "HOST",
        emailVerifiedAt: new Date(),
      },
    });
    const location = await prisma.location.upsert({
      where: { city_country: { city: "İstanbul", country: "Türkiye" } },
      update: {},
      create: { city: "İstanbul", country: "Türkiye", latitude: 41.0082, longitude: 28.9784 },
    });
    let created = 0;
    let updated = 0;
    for (const l of listings) {
      const outcome = await upsertListing(prisma, l, {
        hostId: host.id,
        locationId: location.id,
        publish,
        description: describe(l),
      });
      if (outcome === "created") created++;
      else updated++;
    }
    console.log(
      `[insideairbnb] yeni=${created}, güncellenen=${updated}` +
        (publish ? " (yayında)" : " (belge PENDING → aramada gizli; --publish ile yayınla)") +
        `. Arama embedding'leri için: npm run embeddings:backfill`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[insideairbnb] hata:", error instanceof Error ? error.message : error);
  process.exit(1);
});
