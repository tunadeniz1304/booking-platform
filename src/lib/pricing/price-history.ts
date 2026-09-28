import { prisma } from "@/lib/prisma";
import { minorFromDb } from "@/lib/money/money";
import { fromDate, toDbDate } from "@/lib/time/nights";
import { referencePrice, type PricePoint } from "@/lib/pricing/omnibus";
import type { PreviousPriceRule } from "@/lib/compliance/market-rules";
import type { NightInput } from "@/lib/pricing/quote";

const DAY_MS = 86_400_000;

/**
 * P1-8 Omnibus / P1-7 pazar kuralı: her gece için son `days` günün referans taban fiyatı
 * (varsayılan: pencerede uygulanmış en düşük; `InventoryPriceHistory`, DB tetiği yazar).
 * `lowest-in-window` için şu anki fiyat (`current`) her zaman adaydır → sonuç hiçbir gece için
 * güncel fiyatın üstünde olamaz.
 */
export async function lowestNightInputs(
  roomTypeId: string,
  current: readonly NightInput[],
  now: Date,
  days: number,
  rule: PreviousPriceRule = "lowest-in-window"
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
    baseMinor: referencePrice(byDate.get(n.date) ?? [], n.baseMinor, now, days, rule),
  }));
}
