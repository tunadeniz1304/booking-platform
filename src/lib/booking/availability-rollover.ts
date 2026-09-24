import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, todayUtc, toDbDate } from "@/lib/time/nights";
import { logger } from "@/lib/observability/logger";

/**
 * Envanter ufku: her aktif oda için bugünden itibaren `horizonDays` gecelik
 * Availability satırı bulunmasını sağlar (eksik geceler mülkün taban fiyatıyla).
 * `skipDuplicates` ile idempotenttir; mevcut fiyat/doluluk asla ezilmez.
 * Worker'da her gece çalışır (`availability-rollover` işi).
 */
export async function rollAvailabilityForward(
  horizonDays = 365,
  now = new Date()
): Promise<number> {
  const today = todayUtc(now);
  const rooms = await prisma.room.findMany({
    where: { available: true, property: { isActive: true } },
    select: { id: true, property: { select: { basePrice: true } } },
  });
  let created = 0;
  for (const room of rooms) {
    const data = Array.from({ length: horizonDays }, (_, i) => ({
      roomId: room.id,
      date: toDbDate(addDays(today, i)),
      price: new Prisma.Decimal(room.property.basePrice.toString()),
      isAvailable: true,
    }));
    const res = await prisma.availability.createMany({ data, skipDuplicates: true });
    created += res.count;
  }
  if (created > 0) logger.info({ created, rooms: rooms.length }, "availability rolled forward");
  return created;
}
