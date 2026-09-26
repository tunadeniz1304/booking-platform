import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import { getRankingVariant, RANKING_FLAG, setFlagsForTests } from "@/lib/flags";
import { experimentResults, type VariantResult } from "@/lib/flags/stats";

/**
 * P1-3: maruziyet DB'ye + outbox'a tek işlemde yazılır, (bayrak, özne) başına bir kez;
 * sonuç tablosu dönüşümü yalnız maruziyetten SONRAKİ onaylı rezervasyonla sayar.
 * Paylaşılan DB → sonuçlar önce/sonra farkıyla doğrulanır.
 */
describeInt("deney maruziyeti ve sonuçları (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const users: string[] = [];
  let propertyId = "";
  let roomId = "";

  beforeAll(async () => {
    await setFlagsForTests(null);
    for (let i = 0; i < 2; i++) {
      const u = await prisma.user.create({
        data: {
          email: `exp-${i}-${stamp}@t.test`,
          passwordHash: "x",
          firstName: "E",
          lastName: "X",
          role: "USER",
        },
      });
      users.push(u.id);
    }
    const location = await prisma.location.upsert({
      where: { city_country: { city: `Deneykent${stamp}`, country: "TEST" } },
      update: {},
      create: { city: `Deneykent${stamp}`, country: "TEST", latitude: 41, longitude: 29 },
    });
    const property = await prisma.property.create({
      data: {
        licenseStatus: "VERIFIED",
        hostId: users[0],
        title: "Deney oteli",
        description: "A/B",
        propertyType: "HOTEL",
        locationId: location.id,
        basePriceMinor: 50000n,
        currency: "TRY",
      },
    });
    propertyId = property.id;
    const room = await prisma.roomType.create({
      data: {
        propertyId,
        name: "Oda",
        maxOccupancy: 2,
        bedType: "Çift",
        priceModifierMinor: 0n,
      },
    });
    roomId = room.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const byVariant = async () => {
    const res = (await experimentResults()).find((r) => r.flagKey === RANKING_FLAG)!;
    return new Map(res.variants.map((v) => [v.variant, v] as [string, VariantResult]));
  };

  it("maruziyet bir kez yazılır (DB + outbox), aynı kullanıcı aynı kolu alır; dönüşüm sayılır", async () => {
    const before = await byVariant();
    const subject = { key: `user:${users[0]}`, userId: users[0] };
    const first = await getRankingVariant(subject);
    const second = await getRankingVariant(subject);
    expect(second.variant).toBe(first.variant);
    expect(first.inExperiment).toBe(true);

    const rows = await prisma.experimentExposure.findMany({
      where: { flagKey: RANKING_FLAG, subjectId: subject.key },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ variant: first.variant, userId: users[0] });
    const outbox = await prisma.outboxMessage.findMany({
      where: { eventType: "experiment.exposure", aggregateId: subject.key },
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].payload).toMatchObject({ flagKey: RANKING_FLAG, variant: first.variant });

    // Anonim oturum: maruziyet sayılır, kullanıcı/dönüşüm sayılmaz.
    const anon = await getRankingVariant({ key: `session:${stamp}` });
    await prisma.booking.create({
      data: {
        userId: users[0],
        propertyId,
        roomId,
        checkIn: utcDay(3),
        checkOut: utcDay(4),
        guestCount: 1,
        totalPriceMinor: 50000n,
        status: "CONFIRMED",
      },
    });

    const after = await byVariant();
    const delta = (variant: string, field: "exposures" | "users" | "conversions") =>
      after.get(variant)![field] - before.get(variant)![field];
    const anonSame = anon.variant === first.variant ? 1 : 0;
    expect(delta(first.variant, "exposures")).toBe(1 + anonSame);
    expect(delta(anon.variant, "exposures")).toBeGreaterThanOrEqual(1);
    expect(delta(first.variant, "users")).toBe(1);
    expect(delta(first.variant, "conversions")).toBe(1);
    const v = after.get(first.variant)!;
    expect(v.ci.low).toBeLessThanOrEqual(v.rate);
    expect(v.ci.high).toBeGreaterThanOrEqual(v.rate);
  });

  it("maruziyetten ÖNCEKİ rezervasyon dönüşüm sayılmaz", async () => {
    await prisma.booking.create({
      data: {
        userId: users[1],
        propertyId,
        roomId,
        checkIn: utcDay(5),
        checkOut: utcDay(6),
        guestCount: 1,
        totalPriceMinor: 50000n,
        status: "CONFIRMED",
      },
    });
    const before = await byVariant();
    const a = await getRankingVariant({ key: `user:${users[1]}`, userId: users[1] });
    const after = await byVariant();
    expect(after.get(a.variant)!.users - before.get(a.variant)!.users).toBe(1);
    expect(after.get(a.variant)!.conversions - before.get(a.variant)!.conversions).toBe(0);
  });
});
