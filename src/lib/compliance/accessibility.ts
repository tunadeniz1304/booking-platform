import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transactions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { assertPropertyAccess } from "@/lib/host/host-service";
import { invalidatePropertySearchCache, invalidateSearchCache } from "@/lib/search";
import { PHOTO_URL_PREFIX } from "@/lib/vision/photo-service";
import type { AccessClaims } from "@/lib/auth";
import {
  ACCESSIBILITY_CODES,
  MAX_WIDTH_CM,
  MIN_WIDTH_CM,
  WIDTH_CODE,
  type AccessibilityCodeValue,
} from "@/lib/compliance/accessibility-codes";

/**
 * P1-13(e) erişilebilirlik özellikleri (ADA 28 CFR 36.302(e)(1)(ii), EAA).
 *
 * Akış: host özelliği beyan eder (ilan veya oda tipi düzeyinde) ve kanıt fotoğrafı bağlar
 * (P1-10 `PropertyPhoto`, aynı ilanın) → admin kanıtı görüp doğrular → yalnız doğrulanmış
 * özellikler herkese "doğrulanmış" rozetiyle gösterilir ve arama filtresine girer.
 * Kanıt/kod/ölçü/oda değişirse veya kanıt fotoğrafı silinirse doğrulama DB tetikleyicisiyle
 * düşer (migration 20260927900000). Doğrulama kanıt fotoğrafı olmadan yapılamaz.
 */

const cuidLike = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Geçersiz kimlik");

const widthCm = z.number().int().min(MIN_WIDTH_CM).max(MAX_WIDTH_CM);

export const createFeatureSchema = z
  .object({
    code: z.enum(ACCESSIBILITY_CODES),
    roomTypeId: cuidLike.nullish(),
    widthCm: widthCm.nullish(),
    note: z.string().trim().max(500).nullish(),
    evidencePhotoId: cuidLike.nullish(),
  })
  .strict();

export const updateFeatureSchema = z
  .object({
    widthCm: widthCm.nullish(),
    note: z.string().trim().max(500).nullish(),
    evidencePhotoId: cuidLike.nullish(),
  })
  .strict();

export const verifyFeatureSchema = z.object({ verified: z.boolean() }).strict();

export type CreateFeatureInput = z.infer<typeof createFeatureSchema>;
export type UpdateFeatureInput = z.infer<typeof updateFeatureSchema>;

const FEATURE_SELECT = {
  id: true,
  propertyId: true,
  roomTypeId: true,
  code: true,
  widthCm: true,
  note: true,
  evidencePhotoId: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
  roomType: { select: { name: true } },
} satisfies Prisma.AccessibilityFeatureSelect;

type FeatureRow = Prisma.AccessibilityFeatureGetPayload<{ select: typeof FEATURE_SELECT }>;

function present(row: FeatureRow) {
  const { roomType, ...rest } = row;
  return {
    ...rest,
    roomTypeName: roomType?.name ?? null,
    verified: row.verifiedAt !== null,
    evidencePhotoUrl: row.evidencePhotoId ? `${PHOTO_URL_PREFIX}${row.evidencePhotoId}` : null,
  };
}

export type HostAccessibilityFeature = ReturnType<typeof present>;

function assertWidth(code: AccessibilityCodeValue, width: number | null | undefined) {
  if (width != null && code !== WIDTH_CODE) {
    throw new ValidationError("Genişlik (cm) yalnız kapı genişliği özelliği için girilebilir");
  }
}

async function assertEvidencePhoto(
  tx: Prisma.TransactionClient,
  propertyId: string,
  photoId: string
) {
  const photo = await tx.propertyPhoto.findFirst({
    where: { id: photoId, propertyId },
    select: { id: true },
  });
  // Başka ilanın fotoğrafı kanıt olamaz; varlığı da sızdırılmaz.
  if (!photo) throw new ValidationError("Kanıt fotoğrafı bu ilana ait değil");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function invalidate(propertyId: string) {
  await Promise.all([invalidatePropertySearchCache(propertyId), invalidateSearchCache()]);
}

export async function listHostFeatures(actor: AccessClaims, propertyId: string) {
  await assertPropertyAccess(actor, propertyId);
  const rows = await prisma.accessibilityFeature.findMany({
    where: { propertyId },
    orderBy: [{ code: "asc" }, { createdAt: "asc" }],
    select: FEATURE_SELECT,
  });
  return rows.map(present);
}

export async function createFeature(
  actor: AccessClaims,
  propertyId: string,
  input: CreateFeatureInput
): Promise<HostAccessibilityFeature> {
  await assertPropertyAccess(actor, propertyId);
  assertWidth(input.code, input.widthCm);
  try {
    const row = await withSerializableRetry(async (tx) => {
      if (input.roomTypeId) {
        const room = await tx.roomType.findFirst({
          where: { id: input.roomTypeId, propertyId },
          select: { id: true },
        });
        if (!room) throw new NotFoundError("Oda tipi bulunamadı");
      }
      if (input.evidencePhotoId) await assertEvidencePhoto(tx, propertyId, input.evidencePhotoId);
      return tx.accessibilityFeature.create({
        data: {
          propertyId,
          roomTypeId: input.roomTypeId ?? null,
          code: input.code,
          widthCm: input.widthCm ?? null,
          note: input.note || null,
          evidencePhotoId: input.evidencePhotoId ?? null,
        },
        select: FEATURE_SELECT,
      });
    });
    return present(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("Bu özellik zaten eklenmiş", "ACCESSIBILITY_FEATURE_EXISTS");
    }
    throw error;
  }
}

/** Kanıt bağla/kaldır, ölçü/not güncelle. Kanıt veya ölçü değişirse doğrulama düşer (tetik). */
export async function updateFeature(
  actor: AccessClaims,
  propertyId: string,
  featureId: string,
  input: UpdateFeatureInput
): Promise<HostAccessibilityFeature> {
  await assertPropertyAccess(actor, propertyId);
  const row = await withSerializableRetry(async (tx) => {
    const current = await tx.accessibilityFeature.findFirst({
      where: { id: featureId, propertyId },
      select: { id: true, code: true },
    });
    if (!current) throw new NotFoundError("Erişilebilirlik özelliği bulunamadı");
    assertWidth(current.code, input.widthCm);
    if (input.evidencePhotoId) await assertEvidencePhoto(tx, propertyId, input.evidencePhotoId);
    return tx.accessibilityFeature.update({
      where: { id: featureId },
      data: {
        ...(input.widthCm !== undefined ? { widthCm: input.widthCm } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
        ...(input.evidencePhotoId !== undefined ? { evidencePhotoId: input.evidencePhotoId } : {}),
      },
      select: FEATURE_SELECT,
    });
  });
  await invalidate(propertyId);
  return present(row);
}

export async function deleteFeature(
  actor: AccessClaims,
  propertyId: string,
  featureId: string
): Promise<void> {
  await assertPropertyAccess(actor, propertyId);
  const { count } = await prisma.accessibilityFeature.deleteMany({
    where: { id: featureId, propertyId },
  });
  if (count === 0) throw new NotFoundError("Erişilebilirlik özelliği bulunamadı");
  await invalidate(propertyId);
}

/**
 * Admin doğrulaması (veya geri alma). Kanıt fotoğrafı yoksa doğrulanamaz (409); her karar
 * AuditLog'a yazılır.
 */
export async function verifyFeature(
  adminId: string,
  featureId: string,
  verified: boolean
): Promise<HostAccessibilityFeature> {
  const row = await withSerializableRetry(async (tx) => {
    const current = await tx.accessibilityFeature.findUnique({
      where: { id: featureId },
      select: { id: true, propertyId: true, code: true, evidencePhotoId: true },
    });
    if (!current) throw new NotFoundError("Erişilebilirlik özelliği bulunamadı");
    if (verified && !current.evidencePhotoId) {
      throw new ConflictError(
        "Kanıt fotoğrafı olmadan doğrulanamaz",
        "ACCESSIBILITY_EVIDENCE_REQUIRED"
      );
    }
    const updated = await tx.accessibilityFeature.update({
      where: { id: featureId },
      data: verified
        ? { verifiedAt: new Date(), verifiedById: adminId }
        : { verifiedAt: null, verifiedById: null },
      select: FEATURE_SELECT,
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: verified ? "accessibility.verified" : "accessibility.unverified",
        entity: "Property",
        entityId: current.propertyId,
        meta: {
          featureId,
          code: current.code,
          evidencePhotoId: current.evidencePhotoId,
        },
      },
    });
    return updated;
  });
  await invalidate(row.propertyId);
  return present(row);
}

/** Admin inceleme kuyruğu: bekleyen (kanıtlı, doğrulanmamış) veya doğrulanmış özellikler. */
export async function listFeaturesForReview(status: "pending" | "verified", limit = 100) {
  const rows = await prisma.accessibilityFeature.findMany({
    where:
      status === "pending"
        ? { verifiedAt: null, evidencePhotoId: { not: null } }
        : { verifiedAt: { not: null } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { ...FEATURE_SELECT, property: { select: { title: true } } },
  });
  return rows.map(({ property, ...row }) => ({ ...present(row), propertyTitle: property.title }));
}

export interface PublicAccessibilityFeature {
  code: AccessibilityCodeValue;
  roomTypeId: string | null;
  roomTypeName: string | null;
  widthCm: number | null;
  verifiedAt: string;
  evidencePhotoUrl: string | null;
}

/** İlan sayfası: YALNIZ doğrulanmış özellikler (beyan edilmiş ama doğrulanmamışlar gizli). */
export async function listPublicFeatures(
  propertyId: string
): Promise<PublicAccessibilityFeature[]> {
  const rows = await prisma.accessibilityFeature.findMany({
    where: { propertyId, verifiedAt: { not: null } },
    orderBy: [{ roomTypeId: { sort: "asc", nulls: "first" } }, { code: "asc" }],
    select: FEATURE_SELECT,
  });
  return rows.map((row) => ({
    code: row.code,
    roomTypeId: row.roomTypeId,
    roomTypeName: row.roomType?.name ?? null,
    widthCm: row.widthCm,
    verifiedAt: (row.verifiedAt as Date).toISOString(),
    evidencePhotoUrl: row.evidencePhotoId ? `${PHOTO_URL_PREFIX}${row.evidencePhotoId}` : null,
  }));
}
