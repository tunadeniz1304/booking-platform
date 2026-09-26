import { z } from "zod";
import { CURRENCIES } from "@/lib/money/money";
import { isIsoDate } from "@/lib/time/nights";
import { ACCESSIBILITY_CODES } from "@/lib/compliance/accessibility-codes";

/**
 * Arama parametreleri (v3#7) — sınırda tek zod şeması. v2'de `new Date(checkIn)` ve
 * `Number(guests)` doğrulanmıyordu (NaN → 500); artık geçersiz girdi 400 döner.
 *
 * Kurallar: tarihler ISO `YYYY-MM-DD`, ikisi birlikte verilir ve checkOut > checkIn;
 * fiyat filtresi GÖRÜNTÜ para birimindeki (`currency`) vergi dahil toplam üzerinden
 * uygulanır (tarih yoksa gecelik taban fiyat); sayfa ≥ 1, sayfa boyutu 1–50 (fazlası 50'ye kırpılır).
 */

const isoDate = z
  .string()
  .trim()
  .refine((v) => isIsoDate(v), "Tarih YYYY-AA-GG biçiminde olmalı");

const optionalNumber = (schema: z.ZodType<number, z.ZodTypeDef, unknown>) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    schema.optional()
  );

export const MAX_PAGE_SIZE = 50;

export const SORTS = ["recommended", "price_asc", "price_desc", "rating"] as const;

export const SearchParamsSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).optional(),
    checkIn: isoDate.optional(),
    checkOut: isoDate.optional(),
    guests: optionalNumber(z.coerce.number().int().min(1).max(30)),
    propertyType: z.enum(["HOTEL", "APARTMENT", "VILLA", "HOSTEL", "BED_AND_BREAKFAST"]).optional(),
    minPrice: optionalNumber(z.coerce.number().min(0).max(10_000_000)),
    maxPrice: optionalNumber(z.coerce.number().min(0).max(10_000_000)),
    amenities: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    currency: z.enum(CURRENCIES).optional(),
    page: optionalNumber(z.coerce.number().int().min(1).max(1000)),
    // Üst sınır aşımı reddedilmez, sınıra kırpılır (v2 istemcileri büyük değer gönderiyordu).
    pageSize: optionalNumber(
      z.coerce
        .number()
        .int()
        .min(1)
        .transform((v) => Math.min(v, MAX_PAGE_SIZE))
    ),
    sort: z.enum(SORTS).optional(),
    semantic: z.boolean().optional(),
    /** P1-10: "bu fotoğraftaki gibi" — görsel kNN kanalının kaynak fotoğrafı. */
    similarToPhotoId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "Geçersiz fotoğraf kimliği")
      .optional(),
    userId: z.string().max(64).optional(),
    /** P1-13(e): yalnız doğrulanmış erişilebilirlik özellikleri; seçilen HER kod gerekir (AND). */
    accessibility: z.array(z.enum(ACCESSIBILITY_CODES)).max(ACCESSIBILITY_CODES.length).optional(),
    /**
     * P1-3 esnek tarih: ±N gün (0 = kapalı). Tarihlerle birlikte anlamlıdır; üst sınır
     * `SEARCH_FLEX_MAX_DAYS`'e kırpılır (varsayılan 3).
     */
    flexDays: optionalNumber(z.coerce.number().int().min(0).max(7)),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.checkIn) !== Boolean(v.checkOut)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkOut"],
        message: "Giriş ve çıkış tarihi birlikte verilmeli",
      });
    }
    if (v.checkIn && v.checkOut && v.checkOut <= v.checkIn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkOut"],
        message: "Çıkış tarihi girişten sonra olmalı",
      });
    }
    if (v.minPrice !== undefined && v.maxPrice !== undefined && v.minPrice > v.maxPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxPrice"],
        message: "Azami fiyat asgari fiyattan küçük olamaz",
      });
    }
  });

export type SearchParams = z.infer<typeof SearchParamsSchema>;
/** Doğrulanmamış girdi (route/araç sınırı) — `searchProperties` bunu kabul eder ve doğrular. */
export type SearchInput = z.input<typeof SearchParamsSchema>;

/** URL sorgu dizgisinden (GET /api/search, /api/properties) ham nesne. */
export function searchParamsFromUrl(sp: URLSearchParams): Record<string, unknown> {
  const flag = (k: string) => sp.get(k) === "1" || sp.get(k) === "true";
  const amenities = sp.get("amenities")?.split(",").filter(Boolean);
  const accessibility = sp
    .get("accessibility")
    ?.split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  return {
    query: sp.get("destination") ?? sp.get("query") ?? undefined,
    city: sp.get("city") ?? undefined,
    checkIn: sp.get("checkIn") || undefined,
    checkOut: sp.get("checkOut") || undefined,
    guests: sp.get("guests") ?? undefined,
    propertyType: sp.get("propertyType") || undefined,
    minPrice: sp.get("minPrice") ?? undefined,
    maxPrice: sp.get("maxPrice") ?? undefined,
    amenities: amenities && amenities.length > 0 ? amenities : undefined,
    currency: sp.get("currency") || undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
    sort: sp.get("sort") || undefined,
    semantic: flag("semantic") || undefined,
    similarToPhotoId: sp.get("similarToPhotoId") || undefined,
    accessibility: accessibility && accessibility.length > 0 ? accessibility : undefined,
    flexDays: sp.get("flexDays") ?? undefined,
  };
}
