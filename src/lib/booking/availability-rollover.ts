import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { addDays, todayUtc, toDbDate } from "@/lib/time/nights";
import { logger } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";

const pruned = counter("inventory_pruned_total", "Saklama süresi dolan envanter günleri");

/**
 * Envanter ufku: her aktif oda tipi için bugünden itibaren `horizonDays` gecelik
 * `InventoryDay` satırı bulunmasını sağlar (eksik geceler mülkün taban fiyatıyla,
 * `total = units`). `skipDuplicates` ile idempotenttir; mevcut fiyat/sayaç asla ezilmez.
 * Worker'da her gece çalışır (`availability-rollover` işi).
 */
export async function rollAvailabilityForward(
  horizonDays = 365,
  now = new Date()
): Promise<number> {
  const today = todayUtc(now);
  const rooms = await prisma.roomType.findMany({
    where: { available: true, property: { isActive: true } },
    select: { id: true, units: true, property: { select: { basePrice: true } } },
  });
  let created = 0;
  for (const room of rooms) {
    const data = Array.from({ length: horizonDays }, (_, i) => ({
      roomTypeId: room.id,
      date: toDbDate(addDays(today, i)),
      price: new Prisma.Decimal(room.property.basePrice.toString()),
      total: room.units,
    }));
    const res = await prisma.inventoryDay.createMany({ data, skipDuplicates: true });
    created += res.count;
  }
  if (created > 0) logger.info({ created, rooms: rooms.length }, "availability rolled forward");
  return created;
}

/**
 * Veri yaşam döngüsü (P0-11, v3#15): `INVENTORY_RETENTION_DAYS` günden eski envanter
 * günleri ve kısıtları budanır. Geçmiş rezervasyonlar etkilenmez (fiyat kırılımı
 * `Booking.priceBreakdown` snapshot'ındadır); aylık ortalama fiyat `PriceHistory`'de kalır.
 * @returns silinen envanter günü sayısı
 */
export async function pruneInventory(now = new Date()): Promise<number> {
  const cutoff = toDbDate(addDays(todayUtc(now), -getConfig().INVENTORY_RETENTION_DAYS));
  const [days] = await prisma.$transaction([
    prisma.inventoryDay.deleteMany({ where: { date: { lt: cutoff } } }),
    prisma.restriction.deleteMany({ where: { date: { lt: cutoff } } }),
    prisma.externalBlock.deleteMany({ where: { date: { lt: cutoff } } }),
  ]);
  if (days.count > 0) {
    pruned.inc(days.count);
    logger.info({ pruned: days.count }, "inventory pruned");
  }
  return days.count;
}
