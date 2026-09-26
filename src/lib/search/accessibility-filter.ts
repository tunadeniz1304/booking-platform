import type { Prisma } from "@prisma/client";
import type { AccessibilityCodeValue } from "@/lib/compliance/accessibility-codes";

/**
 * P1-13(e) arama filtresi (AND): en az bir satılabilir oda tipi, istenen HER kodu
 * doğrulanmış olarak sağlamalı — kod ya ilan düzeyinde (roomTypeId null; ör. otopark,
 * asansör) ya da o oda tipinde doğrulanmış olmalı. Böylece "roll-in duş A odasında,
 * tutunma barı B odasında" ilanı yanlışlıkla eşleşmez. Doğrulanmamış beyan asla sayılmaz.
 */
export function accessibilityWhere(
  codes: readonly AccessibilityCodeValue[],
  guests?: number
): Prisma.PropertyWhereInput | null {
  if (codes.length === 0) return null;
  const verified = { verifiedAt: { not: null } } as const;
  return {
    rooms: {
      some: {
        available: true,
        ...(guests ? { maxOccupancy: { gte: guests } } : {}),
        AND: codes.map((code) => ({
          OR: [
            { accessibilityFeatures: { some: { code, ...verified } } },
            {
              property: {
                accessibilityFeatures: { some: { code, roomTypeId: null, ...verified } },
              },
            },
          ],
        })),
      },
    },
  };
}
