import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { resetConfigForTests } from "@/lib/config/app-config";
import { createQuote } from "@/lib/pricing/quote";
import { createBooking } from "@/lib/booking-service";
import { getCurrentFx, refreshFxRates, resetFxCacheForTests } from "@/lib/fx/store";

/**
 * P0-5 kalıcı FX: teklif, verildiği andaki `FxRate` satırını sabitler; kur teklif süresi
 * içinde değişse de rezervasyon teklifteki tahsilat tutarıyla yapılır.
 */
describeInt("kalıcı FX — teklif kur sabitleme (integration)", () => {
  const prisma = new PrismaClient();
  let stay: StayFixture;
  const createdIds: string[] = [];
  const saved = { charge: process.env.FX_CHARGE_CURRENCIES, sources: process.env.FX_SOURCES };
  const checkIn = iso(utcDay(50));
  const checkOut = iso(utcDay(52));

  async function insertRates(usd: number): Promise<string> {
    const row = await prisma.fxRate.create({
      data: {
        base: "TRY",
        rates: { TRY: 1, USD: usd, EUR: 0.022, GBP: 0.019 },
        source: "tcmb",
        asOf: new Date(),
        stale: false,
        fetchedAt: new Date(),
      },
    });
    createdIds.push(row.id);
    resetFxCacheForTests();
    return row.id;
  }

  beforeAll(async () => {
    process.env.FX_CHARGE_CURRENCIES = "USD,EUR";
    process.env.FX_SOURCES = "none"; // ağ yok → statik yedek
    resetConfigForTests();
    stay = await createStayFixture(prisma, { tag: "fx", nightlyPrice: 2000 });
  });

  afterAll(async () => {
    // Diğer suite'ler güncel kur tablosunu okur → test satırları silinir (FK: SET NULL).
    await prisma.fxRate.deleteMany({ where: { id: { in: createdIds } } });
    resetFxCacheForTests();
    for (const [key, value] of [
      ["FX_CHARGE_CURRENCIES", saved.charge],
      ["FX_SOURCES", saved.sources],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfigForTests();
    await prisma.$disconnect();
  });

  it("regression: v3#23 kur değişse de teklif süresindeki rezervasyon teklif tutarıyla tahsil edilir", async () => {
    const rateA = await insertRates(0.025);
    const quote = await createQuote({
      propertyId: stay.propertyId,
      roomId: stay.roomId,
      checkIn,
      checkOut,
      guests: 1,
      currency: "USD",
    });
    expect(quote.fxSnapshotId).toBe(rateA);
    expect(quote.charge.currency).toBe("USD");

    // Kur değişir (yeni satır, önbellek temiz) → güncel tabloyla tutar farklı olurdu.
    const rateB = await insertRates(0.03);
    expect((await getCurrentFx()).id).toBe(rateB);
    const fresh = await createQuote({
      propertyId: stay.propertyId,
      roomId: stay.roomId,
      checkIn,
      checkOut,
      guests: 1,
      currency: "USD",
    });
    expect(fresh.charge.total).not.toBe(quote.charge.total);

    const { booking } = await createBooking({
      userId: stay.userId,
      propertyId: stay.propertyId,
      roomId: stay.roomId,
      checkIn,
      checkOut,
      guestCount: 1,
      quoteId: quote.quoteId,
    });
    expect(booking.currency).toBe("USD");
    expect(booking.totalMinor).toBe(quote.charge.total);
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { fxSnapshotId: true },
    });
    expect(row.fxSnapshotId).toBe(rateA);
  });

  it("kaynak yoksa refreshFxRates statik tabloyu stale olarak yazar", async () => {
    const table = await refreshFxRates();
    if (table.id) createdIds.push(table.id);
    expect(table.source).toBe("static");
    expect(table.stale).toBe(true);
    expect(table.rates.TRY).toBe(1);
  });
});
