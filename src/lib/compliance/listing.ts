import type { Prisma } from "@prisma/client";

/**
 * Herkese açık ilan koşulu: aktif VE belge/kayıt numarası doğrulanmış (7464 / 7565,
 * AB 2024/1028). Arama, ilan detayı (API + sayfa), fiyat teklifi ve rezervasyon aynı
 * koşulu kullanır; doğrulanmamış ilan hiçbir yoldan görüntülenemez veya satılamaz
 * (v3#25, v3#26).
 */
export const LISTABLE_PROPERTY = {
  isActive: true,
  licenseStatus: "VERIFIED",
} as const satisfies Prisma.PropertyWhereInput;

export function isListable(p: { isActive: boolean; licenseStatus: string }): boolean {
  return p.isActive && p.licenseStatus === LISTABLE_PROPERTY.licenseStatus;
}
