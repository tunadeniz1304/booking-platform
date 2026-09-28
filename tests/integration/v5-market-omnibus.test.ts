// regression: v5#14 — indirim referans penceresi tesis ülkesinin pazar kuralından gelir
// (TR 10 gün, AB 30 gün); tek global PRICE_OMNIBUS_DAYS penceresi yanlış referans üretir.
import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { computeTotal } from "@/lib/pricing/quote";

const prisma = new PrismaClient();

describeInt("regression: v5#14 pazar bazlı indirim referans penceresi", () => {
  let tr: StayFixture;
  let eu: StayFixture;
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
  const nights = [30, 31].map((d) => utcDay(d));

  /** 15 gün önce düşük (50.000), 12 gün önceden beri 100.000 fiyat geçmişi kurar. */
  async function seedHistory(roomId: string) {
    await prisma.inventoryPriceHistory.deleteMany({ where: { roomTypeId: roomId } });
    for (const date of nights) {
      await prisma.inventoryPriceHistory.createMany({
        data: [
          { roomTypeId: roomId, date, priceMinor: 50_000n, effectiveAt: ago(15) },
          { roomTypeId: roomId, date, priceMinor: 100_000n, effectiveAt: ago(12) },
        ],
      });
    }
  }

  const stayOf = (roomId: string) => ({
    roomId,
    checkIn: iso(nights[0]),
    checkOut: iso(utcDay(32)),
    guests: 1,
  });

  beforeAll(async () => {
    tr = await createStayFixture(prisma, { tag: "v5-14-tr", country: "Türkiye", days: 40 });
    eu = await createStayFixture(prisma, { tag: "v5-14-eu", country: "Germany", days: 40 });
    await seedHistory(tr.roomId);
    await seedHistory(eu.roomId);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("TR ilanı son 10 günü kullanır: 15 gün önceki düşük fiyat referans olmaz", async () => {
    const quote = await computeTotal(stayOf(tr.roomId));
    expect(quote.omnibusDays).toBe(10);
    // Pencere başında (10 gün önce) yürürlükte olan fiyat 100.000 → referans = mevcut toplam.
    expect(quote.lowestPrice30dMinor).toBe(quote.total);
  });

  it("AB ilanı son 30 günü kullanır: 15 gün önceki düşük fiyat referanstır", async () => {
    const quote = await computeTotal(stayOf(eu.roomId));
    expect(quote.omnibusDays).toBe(30);
    expect(quote.lowestPrice30dMinor).toBeLessThan(quote.total);
  });
});
