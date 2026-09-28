import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/http/errors";
import type { AccessClaims } from "@/lib/auth/tokens";
import { assertPropertyAccess } from "@/lib/host/host-service";
import { minorFromDb, minorToDb } from "@/lib/money/money";
import { withSerializableRetry } from "@/lib/db/transactions";
import { computeTotal } from "@/lib/pricing/quote";
import { invalidatePropertySearchCache } from "@/lib/search";
import {
  normalizeCouponCode,
  PROMOTION_TYPES,
  type PromotionLine,
  type SalesChannel,
} from "@/lib/pricing/promotions";

/**
 * P1-8 ev sahibi promosyon CRUD'u + kupon doğrulama. Sahiplik: HOST yalnız kendi
 * promosyonları/ilanları (başkasınınki 404), ADMIN hepsi.
 */

const promotionFields = z.object({
  /** null/yok → ev sahibinin tüm ilanları. */
  propertyId: z.string().min(1).max(64).nullable().optional(),
  name: z.string().trim().min(2).max(80),
  type: z.enum(PROMOTION_TYPES),
  discountBps: z.number().int().min(1).max(10_000).nullable().optional(),
  discountMinor: z.number().int().positive().max(1_000_000_000_000).nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((c) => c.toUpperCase())
    .nullable()
    .optional(),
  minDaysBefore: z.number().int().min(0).max(730).nullable().optional(),
  maxDaysBefore: z.number().int().min(0).max(730).nullable().optional(),
  minNights: z.number().int().min(1).max(365).nullable().optional(),
  couponCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{4,40}$/, "Kupon kodu 4–40 harf/rakam/-/_ olmalı")
    .nullable()
    .optional(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  stackable: z.boolean().optional(),
  stackGroup: z.string().trim().min(1).max(40).nullable().optional(),
  active: z.boolean().optional(),
});

type PromotionFields = z.infer<typeof promotionFields>;

/** Türe göre zorunlu alanlar ve indirim biçimi (DB CHECK'leriyle aynı kurallar). */
function checkRules(v: PromotionFields, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  const hasBps = v.discountBps != null;
  const hasFixed = v.discountMinor != null;
  if (hasBps === hasFixed) issue("discountBps", "Yüzde (discountBps) VEYA sabit tutar verin");
  if (hasFixed && !v.currency) issue("currency", "Sabit indirimde para birimi zorunlu");
  if (v.type === "EARLY_BIRD" && v.minDaysBefore == null) issue("minDaysBefore", "Zorunlu");
  if (v.type === "LAST_MINUTE" && v.maxDaysBefore == null) issue("maxDaysBefore", "Zorunlu");
  if (v.type === "LONG_STAY" && v.minNights == null) issue("minNights", "Zorunlu");
  if (v.type === "COUPON" && !v.couponCode) issue("couponCode", "Kupon kodu zorunlu");
  if (v.type !== "COUPON" && v.couponCode) issue("couponCode", "Yalnız COUPON türünde");
  if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) issue("endsAt", "Bitiş başlangıçtan sonra");
  if (v.minDaysBefore != null && v.maxDaysBefore != null && v.maxDaysBefore < v.minDaysBefore) {
    issue("maxDaysBefore", "maxDaysBefore ≥ minDaysBefore olmalı");
  }
}

export const createPromotionSchema = promotionFields.superRefine(checkRules);
export const updatePromotionSchema = promotionFields.partial();

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;

const dtoSelect = {
  id: true,
  hostId: true,
  propertyId: true,
  name: true,
  type: true,
  discountBps: true,
  discountMinor: true,
  currency: true,
  minDaysBefore: true,
  maxDaysBefore: true,
  minNights: true,
  couponCode: true,
  usageLimit: true,
  usageCount: true,
  startsAt: true,
  endsAt: true,
  priority: true,
  stackable: true,
  stackGroup: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { title: true } },
} satisfies Prisma.PromotionSelect;

type PromotionRow = Prisma.PromotionGetPayload<{ select: typeof dtoSelect }>;

export function presentPromotion(row: PromotionRow) {
  const { property, ...rest } = row;
  return {
    ...rest,
    discountMinor: rest.discountMinor === null ? null : minorFromDb(rest.discountMinor),
    propertyTitle: property?.title ?? null,
  };
}

export type PromotionDTO = ReturnType<typeof presentPromotion>;

function toData(v: PromotionFields) {
  return {
    name: v.name,
    type: v.type,
    discountBps: v.discountBps ?? null,
    discountMinor: v.discountMinor != null ? minorToDb(v.discountMinor) : null,
    currency: v.discountMinor != null ? (v.currency ?? null) : null,
    minDaysBefore: v.minDaysBefore ?? null,
    maxDaysBefore: v.maxDaysBefore ?? null,
    minNights: v.minNights ?? null,
    couponCode: v.type === "COUPON" ? normalizeCouponCode(v.couponCode) : null,
    usageLimit: v.usageLimit ?? null,
    startsAt: v.startsAt ?? null,
    endsAt: v.endsAt ?? null,
    priority: v.priority ?? 0,
    stackable: v.stackable ?? false,
    stackGroup: v.stackGroup ?? null,
    active: v.active ?? true,
  };
}

function uniqueCoupon(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConflictError("Bu kupon kodu zaten kullanılıyor", "COUPON_CODE_TAKEN");
  }
  throw error;
}

/** Sabit tutarlı ilan promosyonunda para birimi ilanınkiyle aynı olmalı. */
function checkCurrency(v: PromotionFields, propertyCurrency: string | null) {
  if (v.discountMinor != null && propertyCurrency && v.currency !== propertyCurrency) {
    throw new ValidationError(`Sabit indirim ilan para biriminde (${propertyCurrency}) olmalı`);
  }
}

/** Kapsamı çözer: ilan verilirse sahiplik kontrolü; ev sahibi = ilanın sahibi. */
async function resolveScope(actor: AccessClaims, propertyId: string | null | undefined) {
  if (propertyId) {
    const property = await assertPropertyAccess(actor, propertyId);
    return { hostId: property.hostId, propertyId, currency: property.currency };
  }
  if (actor.role === "ADMIN") {
    throw new ValidationError("Yönetici promosyonu bir ilana bağlamalıdır (propertyId)");
  }
  return { hostId: actor.userId, propertyId: null, currency: null };
}

export async function listHostPromotions(actor: AccessClaims): Promise<PromotionDTO[]> {
  const rows = await prisma.promotion.findMany({
    where: actor.role === "ADMIN" ? {} : { hostId: actor.userId },
    select: dtoSelect,
    orderBy: [{ active: "desc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  return rows.map(presentPromotion);
}

export async function createPromotion(
  actor: AccessClaims,
  input: CreatePromotionInput
): Promise<PromotionDTO> {
  const scope = await resolveScope(actor, input.propertyId);
  checkCurrency(input, scope.currency);
  const cfg = getConfig();
  const dto = await withSerializableRetry(async (tx) => {
    const count = await tx.promotion.count({ where: { hostId: scope.hostId } });
    if (count >= cfg.PROMOTION_MAX_PER_HOST) {
      throw new ConflictError("Promosyon sayısı sınırına ulaşıldı", "PROMOTION_LIMIT");
    }
    const row = await tx.promotion
      .create({
        data: { ...toData(input), hostId: scope.hostId, propertyId: scope.propertyId },
        select: dtoSelect,
      })
      .catch(uniqueCoupon);
    return presentPromotion(row);
  });
  await invalidatePromotionScope(scope.hostId, [scope.propertyId]);
  return dto;
}

/**
 * P0-7: arama kartı toplamı promosyonları içerir → promosyon değişince etkilenen ilanların
 * teklif önbelleği (mülk sürümü) geçersiz kılınır. `null` kapsam: ev sahibinin tüm ilanları.
 */
async function invalidatePromotionScope(
  hostId: string,
  propertyIds: ReadonlyArray<string | null>
): Promise<void> {
  const ids = propertyIds.includes(null)
    ? (await prisma.property.findMany({ where: { hostId }, select: { id: true } })).map((p) => p.id)
    : [...new Set(propertyIds.filter((id): id is string => id !== null))];
  await Promise.all(ids.map((id) => invalidatePropertySearchCache(id)));
}

async function findOwned(actor: AccessClaims, id: string) {
  const row = await prisma.promotion.findUnique({ where: { id }, select: dtoSelect });
  if (!row || (actor.role !== "ADMIN" && row.hostId !== actor.userId)) {
    throw new NotFoundError("Promosyon bulunamadı");
  }
  return row;
}

export async function updatePromotion(
  actor: AccessClaims,
  id: string,
  patch: UpdatePromotionInput
): Promise<PromotionDTO> {
  const existing = presentPromotion(await findOwned(actor, id));
  // Birleştirilmiş kayıt tam şemayla yeniden doğrulanır (tür/indirim tutarlılığı).
  const merged = createPromotionSchema.parse({ ...existing, ...patch });
  const scope =
    merged.propertyId !== existing.propertyId
      ? await resolveScope(actor, merged.propertyId)
      : {
          hostId: existing.hostId,
          propertyId: existing.propertyId,
          currency: existing.propertyId
            ? ((
                await prisma.property.findUnique({
                  where: { id: existing.propertyId },
                  select: { currency: true },
                })
              )?.currency ?? null)
            : null,
        };
  if (scope.hostId !== existing.hostId) throw new NotFoundError("Mülk bulunamadı");
  checkCurrency(merged, scope.currency);
  if (merged.usageLimit != null && merged.usageLimit < existing.usageCount) {
    throw new ValidationError("Kullanım limiti mevcut kullanımın altına indirilemez");
  }
  const row = await prisma.promotion
    .update({
      where: { id },
      data: { ...toData(merged), propertyId: scope.propertyId },
      select: dtoSelect,
    })
    .catch(uniqueCoupon);
  await invalidatePromotionScope(existing.hostId, [existing.propertyId, scope.propertyId]);
  return presentPromotion(row);
}

/** Kullanılmış promosyon silinmez, pasifleştirilir (rezervasyon kayıtları korunur). */
export async function deletePromotion(
  actor: AccessClaims,
  id: string
): Promise<{ deleted: boolean; deactivated: boolean }> {
  const existing = await findOwned(actor, id);
  const used = await prisma.promotionRedemption.count({ where: { promotionId: id } });
  if (used > 0) {
    await prisma.promotion.update({ where: { id }, data: { active: false } });
    await invalidatePromotionScope(existing.hostId, [existing.propertyId]);
    return { deleted: false, deactivated: true };
  }
  await prisma.promotion.delete({ where: { id } });
  await invalidatePromotionScope(existing.hostId, [existing.propertyId]);
  return { deleted: true, deactivated: false };
}

export const validateCouponSchema = z.object({
  propertyId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.number().int().min(1).max(20).default(1),
  ratePlanId: z.string().min(1).max(64).optional(),
  units: z.number().int().min(1).max(10).optional(),
  couponCode: z.string().trim().min(1).max(40),
});

export interface CouponValidation {
  code: string;
  valid: boolean;
  /** APPLIED | NOT_FOUND | promosyon gerekçe kodu (USAGE_LIMIT_REACHED, EXPIRED, …). */
  status: string;
  /** Kupon satırı (uygulandıysa). */
  line: PromotionLine | null;
  discountTotal: number;
  total: number;
  currency: string;
}

/** Kuponu teklif motoruyla dener (fiyat hesabı yalnız `computeTotal`'da). */
export async function validateCoupon(
  input: z.infer<typeof validateCouponSchema>,
  channel: SalesChannel
): Promise<CouponValidation> {
  const quote = await computeTotal({ ...input, channel });
  const code = normalizeCouponCode(input.couponCode)!;
  const status = quote.coupon?.status ?? "NOT_FOUND";
  return {
    code,
    valid: status === "APPLIED",
    status,
    line: quote.discounts?.find((l) => l.couponCode === code) ?? null,
    discountTotal: quote.discountTotal ?? 0,
    total: quote.total,
    currency: quote.currency,
  };
}
