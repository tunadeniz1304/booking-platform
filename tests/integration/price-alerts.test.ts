import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { createPriceAlert, listPriceAlerts, runPriceAlerts } from "@/lib/pricing/price-alerts";
import { getPriceInsight } from "@/lib/pricing/insight";
import { EventTypes } from "@/lib/events/events";
import { addDays, todayUtc } from "@/lib/time/nights";

/**
 * P1-4 fiyat alarmı: günlük iş, toplam Omnibus referansının (son 30 günün en düşüğü)
 * altına inince tek bir `price.dropped` outbox kaydı yazar; aynı gün tekrar çalışmak
 * ikinci bir kayıt üretmez.
 */
describeInt("fiyat alarmı ve içgörü (integration)", () => {
  const prisma = new PrismaClient();
  let stay: StayFixture;
  const checkIn = iso(utcDay(40));
  const checkOut = iso(utcDay(42));

  beforeAll(async () => {
    stay = await createStayFixture(prisma, { tag: "palert", nightlyPrice: 1000 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("fiyat düşüşü tek e-posta olayı üretir; aynı gün tekrar çalışma idempotent", async () => {
    const alert = await createPriceAlert({
      userId: stay.userId,
      roomId: stay.roomId,
      checkIn,
      checkOut,
      guests: 1,
    });
    // Dünkü gözlem daha yüksek toplamla: referans = bu değer.
    const yesterday = addDays(todayUtc(), -1);
    await prisma.priceAlert.update({
      where: { id: alert.id },
      data: { observations: [{ on: yesterday, total: alert.lastTotalMinor + 50_000 }] },
    });
    await prisma.inventoryDay.updateMany({
      where: { roomTypeId: stay.roomId, date: { gte: utcDay(40), lt: utcDay(42) } },
      data: { priceMinor: 80000n },
    });

    const first = await runPriceAlerts();
    expect(first.dropped).toBeGreaterThanOrEqual(1);
    await runPriceAlerts();

    const events = await prisma.outboxMessage.findMany({
      where: { aggregateId: alert.id, eventType: EventTypes.PriceDropped },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as { previousMinor: number; currentMinor: number };
    expect(payload.previousMinor).toBe(alert.lastTotalMinor + 50_000);
    expect(payload.currentMinor).toBeLessThan(alert.lastTotalMinor);

    const [view] = await listPriceAlerts(stay.userId);
    expect(view.previousPriceMinor).toBe(alert.lastTotalMinor + 50_000);
    expect(view.lastTotalMinor).toBe(payload.currentMinor);
  });

  it("içgörü: kalibrasyon yetersizse etiket yok, gecelik fiyat döner", async () => {
    const insight = await getPriceInsight({ roomId: stay.roomId, checkIn, checkOut });
    expect(insight.nightlyMinor).toBe(80_000);
    expect(insight.level).toBe(0.9);
    if (insight.calibrationSize < 20) expect(insight.label).toBeNull();
    else expect(["low", "typical", "high"]).toContain(insight.label);
  });
});
