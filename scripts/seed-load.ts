/**
 * P2-3 yük testi hazırlığı (YALNIZCA DEMO_MODE=true):
 *  - `LOAD_ACCOUNTS` (varsayılan 120) e-postası DOĞRULANMIŞ misafir hesabı:
 *    `load-001@load.test` … (parola demo seed ile aynı; k6 `LOAD_ACCOUNTS=N` ile aynı listeyi üretir).
 *  - Stok sınırlı "Yük Testi Oteli (P2-3)": `LOAD_ROOM_TYPES` (4) oda tipi × `LOAD_UNITS` (5) birim,
 *    `LOAD_HORIZON_DAYS` (400) günlük envanter. Aşırı satış denetimi bu dar stokta anlamlıdır.
 *
 * Tekrar çalıştırmak güvenlidir (hesaplar upsert, otel/oda tipleri varsa yeniden kullanılır,
 * eksik envanter günleri eklenir). Son satırda k6 için `LOAD_ROOMS=<mülk>:<oda>,…` yazar.
 *
 *   docker compose -p <proj> exec -T worker npx tsx scripts/seed-load.ts
 */
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";
import { loadEnv } from "../src/lib/config/load-env";
import { isDemoMode } from "../src/lib/config/demo";

const LOAD_PROPERTY_TITLE = "Yük Testi Oteli (P2-3)";
const DEMO_PASSWORD = "Password123!"; // demo seed parolası (README)

function envInt(name: string, def: number, min: number, max: number): number {
  const n = Number(process.env[name] ?? def);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} ${min}..${max} olmalı`);
  return n;
}

function loadAccountEmail(i: number): string {
  return `load-${String(i).padStart(3, "0")}@load.test`;
}

async function main(): Promise<void> {
  loadEnv();
  if (!isDemoMode()) throw new Error("seed-load yalnızca DEMO_MODE=true ortamında çalışır");
  const accounts = envInt("LOAD_ACCOUNTS", 120, 1, 999);
  const roomTypes = envInt("LOAD_ROOM_TYPES", 4, 2, 20);
  const units = envInt("LOAD_UNITS", 5, 1, 100);
  const horizon = envInt("LOAD_HORIZON_DAYS", 400, 30, 730);

  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const emailVerifiedAt = new Date("2025-01-01T00:00:00Z");
    for (let i = 1; i <= accounts; i++) {
      await prisma.user.upsert({
        where: { email: loadAccountEmail(i) },
        update: { emailVerifiedAt, lockedUntil: null, failedLoginCount: 0 },
        create: {
          email: loadAccountEmail(i),
          passwordHash,
          emailVerifiedAt,
          firstName: "Yük",
          lastName: `Test ${i}`,
          role: UserRole.USER,
          // Yerleşik hesap: risk motorunun "yeni hesap" sinyali her ödemeyi 3DS'e zorlamasın.
          createdAt: emailVerifiedAt,
        },
      });
    }
    console.log(`seed-load: ${accounts} doğrulanmış hesap hazır`);

    const template = await prisma.property.findFirst({
      where: { isActive: true, licenseStatus: "VERIFIED", location: { country: "Türkiye" } },
      select: { hostId: true, locationId: true, cancellationPolicyId: true },
      orderBy: { createdAt: "asc" },
    });
    if (!template) throw new Error("Önce demo seed yüklenmeli (Türkiye'de doğrulanmış ilan yok)");

    let property = await prisma.property.findFirst({
      where: { title: LOAD_PROPERTY_TITLE },
      select: { id: true },
    });
    if (!property) {
      property = await prisma.property.create({
        data: {
          hostId: template.hostId,
          title: LOAD_PROPERTY_TITLE,
          description:
            "Yük ve kaos testleri için stok sınırlı sentetik otel (gerçek ilan değildir).",
          propertyType: "HOTEL",
          locationId: template.locationId,
          basePriceMinor: 150_000n,
          currency: "TRY",
          isActive: true,
          licenseNumber: "34-99999",
          licenseStatus: "VERIFIED",
          licenseCheckedAt: new Date(),
          cancellationPolicyId: template.cancellationPolicyId,
        },
        select: { id: true },
      });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const rooms: string[] = [];
    for (let r = 1; r <= roomTypes; r++) {
      const name = `Yük Odası ${r}`;
      let room = await prisma.roomType.findFirst({
        where: { propertyId: property.id, name },
        select: { id: true },
      });
      if (!room) {
        room = await prisma.roomType.create({
          data: {
            propertyId: property.id,
            name,
            maxOccupancy: 2,
            units,
            bedType: "Çift Kişilik Yatak",
            priceModifierMinor: BigInt(r * 10_000),
            available: true,
            ratePlans: {
              create: [
                {
                  code: "STANDARD",
                  name: "Standart",
                  refundable: true,
                  priceModifierBps: 0,
                  isDefault: true,
                },
              ],
            },
          },
          select: { id: true },
        });
      }
      await prisma.inventoryDay.createMany({
        data: Array.from({ length: horizon }, (_, d) => ({
          roomTypeId: room.id,
          date: new Date(today.getTime() + d * 86_400_000),
          total: units,
          priceMinor: BigInt(150_000 + r * 10_000),
        })),
        skipDuplicates: true,
      });
      rooms.push(`${property.id}:${room.id}`);
    }
    console.log(`seed-load: ${roomTypes} oda tipi × ${units} birim, ${horizon} gün envanter`);
    console.log(`LOAD_ROOMS=${rooms.join(",")}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("seed-load:", (error as Error).message);
  process.exit(1);
});
