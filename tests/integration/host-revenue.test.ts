import { it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture } from "./fixtures";
import {
  acceptSuggestion,
  generateSuggestions,
  getRevenueOverview,
  rejectSuggestion,
} from "@/lib/pricing/revenue";
import { updateAvailabilityPrices } from "@/lib/pricing-service";
import type { AccessClaims } from "@/lib/auth";

const claims = (userId: string): AccessClaims => ({
  userId,
  role: "HOST",
  jti: "t",
  exp: Math.floor(Date.now() / 1000) + 3600,
  tv: 0,
});

describeInt("regression: v3#5 host gelir paneli (integration)", () => {
  it("öneri üretir; kabul fiyatı sabitler, ret hiçbir şeyi değiştirmez; sahiplik ve çift karar", async () => {
    const prisma = new PrismaClient();
    try {
      const fx = await createStayFixture(prisma, { tag: "rev", nightlyPrice: 1000, days: 40 });
      const host = claims(fx.hostId);

      const suggestions = await generateSuggestions(host, fx.roomId);
      expect(suggestions.length).toBeGreaterThan(0);
      for (const s of suggestions) {
        expect(s.status).toBe("PENDING");
        expect(s.suggestedMinor).toBeGreaterThanOrEqual(s.floorMinor);
        expect(s.suggestedMinor).toBeLessThanOrEqual(s.ceilingMinor);
        expect(s.contributions.reduce((a, c) => a + c.amountMinor, 0)).toBe(
          s.suggestedMinor - 100_000
        );
        expect(s.explanation.length).toBeGreaterThan(0);
      }
      // Üretim hiçbir fiyatı değiştirmez.
      const untouched = await prisma.inventoryDay.findMany({
        where: { roomTypeId: fx.roomId, priceOverride: true },
      });
      expect(untouched).toHaveLength(0);

      // Başka host: 404 (varlık sızdırılmaz).
      const other = await prisma.user.create({
        data: {
          email: `rev-other-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: "O",
          lastName: "H",
          role: "HOST",
        },
      });
      await expect(acceptSuggestion(claims(other.id), suggestions[0].id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(generateSuggestions(claims(other.id), fx.roomId)).rejects.toMatchObject({
        status: 404,
      });

      // Ret: fiyat aynı kalır.
      const rejected = suggestions[1];
      const beforeReject = await prisma.inventoryDay.findFirstOrThrow({
        where: { roomTypeId: fx.roomId, date: new Date(`${rejected.date}T00:00:00.000Z`) },
      });
      const r = await rejectSuggestion(host, rejected.id);
      expect(r.status).toBe("REJECTED");
      const afterReject = await prisma.inventoryDay.findFirstOrThrow({
        where: { id: beforeReject.id },
      });
      expect(afterReject.priceMinor).toBe(beforeReject.priceMinor);
      expect(afterReject.priceOverride).toBe(false);
      await expect(rejectSuggestion(host, rejected.id)).rejects.toMatchObject({ status: 409 });

      // Kabul: fiyat yazılır ve gece sabitlenir.
      const accepted = suggestions[0];
      const a = await acceptSuggestion(host, accepted.id);
      expect(a.status).toBe("ACCEPTED");
      const day = await prisma.inventoryDay.findFirstOrThrow({
        where: { roomTypeId: fx.roomId, date: new Date(`${accepted.date}T00:00:00.000Z`) },
      });
      expect(day.priceOverride).toBe(true);
      expect(Number(day.priceMinor)).toBe(accepted.suggestedMinor);
      await expect(acceptSuggestion(host, accepted.id)).rejects.toMatchObject({ status: 409 });

      // Fiyat motoru sabitlenmiş geceyi ezmez.
      await updateAvailabilityPrices(fx.roomId, [accepted.date, rejected.date], 777, "TRY");
      const kept = await prisma.inventoryDay.findFirstOrThrow({ where: { id: day.id } });
      expect(kept.priceMinor).toBe(day.priceMinor);

      // Özet: bekleyenler kararlıları içermez; KPI alanları tutarlı.
      const overview = await getRevenueOverview(host, fx.propertyId);
      const ids = overview.suggestions.map((s) => s.id);
      expect(ids).not.toContain(accepted.id);
      expect(ids).not.toContain(rejected.id);
      expect(overview.kpis.availableRoomNights).toBeGreaterThan(0);
      expect(overview.kpis.occupancy).toBeGreaterThanOrEqual(0);
      expect(overview.pickup.length).toBeGreaterThan(0);
      await expect(getRevenueOverview(claims(other.id), fx.propertyId)).rejects.toMatchObject({
        status: 404,
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
