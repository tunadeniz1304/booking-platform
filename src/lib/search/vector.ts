import { prisma } from "@/lib/prisma";

/**
 * pgvector semantik arama + kişiselleştirme eşzamanlı sıralama.
 *
 * - `computeAffinityBoost`: kullanıcının geçmişiyle (favori + rezervasyon
 *   lokasyonları/mülk tipleri) eşleşen mülklere küçük bir tercih ağırlığı verir.
 */

let vectorProbe: boolean | null = null;

/** pgvector eklentisi ve gömme kolonu kullanılabilir mi? (birden çok denemede önbellekle) */
export async function isVectorEnabled(): Promise<boolean> {
  if (vectorProbe !== null) return vectorProbe;
  try {
    const rows = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    vectorProbe = rows.length > 0;
  } catch {
    vectorProbe = false;
  }
  return vectorProbe;
}

export interface Affinity {
  cityWeights: Map<string, number>;
  typeWeights: Map<string, number>;
}

/** Kullanıcının favori/rezervasyon geçmişinden lokasyon ve tip ağırlıkları. */
export async function computeAffinity(userId: string): Promise<Affinity> {
  const [favorites, bookings] = await Promise.all([
    prisma.favorite.findMany({
      where: { userId },
      select: {
        property: { select: { locationId: true, propertyType: true } },
      },
    }),
    prisma.booking.findMany({
      where: { userId, status: { not: "CANCELLED" } },
      select: {
        property: { select: { locationId: true, propertyType: true } },
      },
    }),
  ]);

  const cityWeights = new Map<string, number>();
  const typeWeights = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string, amount: number) => {
    map.set(key, (map.get(key) ?? 0) + amount);
  };

  for (const f of favorites) {
    bump(cityWeights, f.property.locationId, 1.2);
    bump(typeWeights, f.property.propertyType, 0.8);
  }
  for (const b of bookings) {
    bump(cityWeights, b.property.locationId, 1.5);
    bump(typeWeights, b.property.propertyType, 1.0);
  }
  return { cityWeights, typeWeights };
}

/** Bir mülk için kullanıcının tercihine göre (0-1) boost üretir. */
export function affinityBoostFor(
  affinity: Affinity,
  locationId: string,
  propertyType: string
): number {
  const cityBoost = affinity.cityWeights.get(locationId) ?? 0;
  const typeBoost = affinity.typeWeights.get(propertyType) ?? 0;
  return Math.min(1, (cityBoost * 0.7 + typeBoost * 0.3) / 2);
}
