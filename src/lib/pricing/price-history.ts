import { prisma } from "@/lib/prisma";
import { minorFromDb } from "@/lib/money/money";
import { fromDate, toDbDate } from "@/lib/time/nights";
import { lowestPriceInWindow, type PricePoint } from "@/lib/pricing/omnibus";
import type { NightInput } from "@/lib/pricing/quote";

const DAY_MS = 86_400_000;

/**
 * P1-8 Omnibus: her gece için son `days` günde uygulanmış en düşük taban fiyat
 * (`InventoryPriceHistory`, DB tetiği yazar). Şu anki fiyat (`current`) her zaman adaydır →
 * sonuç hiçbir gece için güncel fiyatın üstünde olamaz.
 */
export async function lowestNightInputs(
  roomTypeId: string,
  current: readonly NightInput[],
  now: Date,
  days: number
): Promise<NightInput[]> {
  if (current.length === 0) return [];
  const dates = current.map((n) => toDbDate(n.date));
  const windowStart = new Date(now.getTime() - days * DAY_MS);
  const [inWindow, beforeWindow] = await Promise.all([
    prisma.inventoryPriceHistory.findMany({
      where: { roomTypeId, date: { in: dates }, effectiveAt: { gt: windowStart, lte: now } },
      select: { date: true, priceMinor: true, effectiveAt: true },
    }),
    // Pencere başında yürürlükte olan fiyat: başlangıçtan önceki son değişiklik (gece başına).
    prisma.inventoryPriceHistory.findMany({
      where: { roomTypeId, date: { in: dates }, effectiveAt: { lte: windowStart } },
      orderBy: [{ date: "asc" }, { effectiveAt: "desc" }, { id: "desc" }],
      distinct: ["date"],
      select: { date: true, priceMinor: true, effectiveAt: true },
    }),
  ]);
  const byDate = new Map<string, PricePoint[]>();
  for (const row of [...beforeWindow, ...inWindow]) {
    const key = fromDate(row.date);
    const list = byDate.get(key) ?? [];
    list.push({ effectiveAt: row.effectiveAt, priceMinor: minorFromDb(row.priceMinor) });
    byDate.set(key, list);
  }
  return current.map((n) => ({
    date: n.date,
    baseMinor: lowestPriceInWindow(byDate.get(n.date) ?? [], n.baseMinor, now, days),
  }));
}
