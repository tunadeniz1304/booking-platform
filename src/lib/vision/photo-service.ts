import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { NotFoundError, ValidationError } from "@/lib/http/errors";
import { logger, errorFields } from "@/lib/observability/logger";
import { toVectorLiteral } from "@/lib/embedding/embedder";
import { assertPropertyAccess } from "@/lib/host/host-service";
import { invalidatePropertySearchCache, invalidateSearchCache } from "@/lib/search";
import { isVectorEnabled } from "@/lib/search/vector";
import type { AccessClaims } from "@/lib/auth";
import { computePHash } from "@/lib/vision/phash";
import { computeQuality, normalizeUpload, type QualityScores } from "@/lib/vision/quality";
import {
  getImageEmbedder,
  type ImageEmbedder,
  type VisionUnavailableReason,
} from "@/lib/vision/clip";
import { visionStatus as status, type VisionStatus } from "@/lib/vision/visual-search";

/**
 * İlan fotoğrafı yükleme hattı (P1-10, ADR 0022):
 *   normalize (WebP, EXIF/GPS yok) → kalite skoru → pHash → duplikat araması (Hamming)
 *   → (bayrak + model varsa) CLIP embedding → kayıt + `Property.images`'a URL ekleme.
 *
 * Duplikat YÜKLEMEYİ ENGELLEMEZ; host'a uyarı döner ve `duplicateOfId` işaretlenir
 * (başkasının ilanındaki kopyada o ilanın kimliği sızdırılmaz). Kalite skoru da yalnız uyarıdır.
 */

export const PHOTO_URL_PREFIX = "/api/photos/";

export type DuplicateScope = "SAME_PROPERTY" | "OWN_LISTING" | "OTHER_LISTING";
export type PhotoWarning = "DUPLICATE" | "LOW_QUALITY";

export interface DuplicateMatch {
  scope: DuplicateScope;
  distance: number;
  /** Yalnız host'un kendi ilanlarındaki eşleşmede. */
  photoId?: string;
  propertyId?: string;
}

export interface UploadedPhoto {
  id: string;
  url: string;
  width: number;
  height: number;
  quality: QualityScores;
  pHash: string;
  embedded: boolean;
}

export interface UploadResult {
  photo: UploadedPhoto;
  duplicate: DuplicateMatch | null;
  warnings: PhotoWarning[];
  visual: VisionStatus;
}

/** pHash'e en yakın (Hamming) kayıtlı fotoğraf; eşik üstündeyse null. */
export async function findNearestDuplicate(
  pHash: string,
  excludePhotoId?: string
): Promise<{ id: string; propertyId: string; hostId: string; distance: number } | null> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; propertyId: string; hostId: string; distance: number }>
  >`
    SELECT ph.id, ph."propertyId", p."hostId",
           bit_count(('x' || ph."pHash")::bit(64) # ('x' || ${pHash})::bit(64))::int AS distance
    FROM "PropertyPhoto" ph JOIN "Property" p ON p.id = ph."propertyId"
    WHERE ph."pHash" IS NOT NULL AND ph.id <> ${excludePhotoId ?? ""}
    ORDER BY distance, ph."createdAt", ph.id
    LIMIT 1`;
  const best = rows[0];
  if (!best || best.distance > getConfig().VISION_DUPLICATE_MAX_HAMMING) return null;
  return { ...best, distance: Number(best.distance) };
}

async function tryEmbed(
  data: Buffer
): Promise<
  { vector: number[]; modelId: string } | { vector: null; reason: VisionUnavailableReason }
> {
  const res = await getImageEmbedder();
  if (!res.embedder) return { vector: null, reason: res.reason };
  if (!(await isVectorEnabled())) return { vector: null, reason: "VECTOR_UNAVAILABLE" };
  try {
    return { vector: await res.embedder.embedImage(data), modelId: res.embedder.modelId };
  } catch (error) {
    logger.warn(errorFields(error), "görsel embedding üretilemedi");
    return { vector: null, reason: "LOAD_FAILED" };
  }
}

export async function uploadPropertyPhoto(
  actor: AccessClaims,
  propertyId: string,
  input: Buffer
): Promise<UploadResult> {
  const cfg = getConfig();
  const property = await assertPropertyAccess(actor, propertyId);
  const normalized = await normalizeUpload(input);
  const [quality, pHash] = await Promise.all([
    computeQuality(normalized.data),
    computePHash(normalized.data),
  ]);
  const nearest = await findNearestDuplicate(pHash);
  const embedding = await tryEmbed(normalized.data);

  const photo = await withSerializableRetry(async (tx) => {
    const count = await tx.propertyPhoto.count({ where: { propertyId } });
    if (count >= cfg.VISION_MAX_PHOTOS_PER_PROPERTY) {
      throw new ValidationError("Bu ilan için fotoğraf sınırına ulaşıldı");
    }
    const created = await tx.propertyPhoto.create({
      data: {
        propertyId,
        uploadedById: actor.userId,
        contentType: normalized.contentType,
        data: normalized.data,
        width: normalized.width,
        height: normalized.height,
        byteSize: normalized.data.byteLength,
        ...quality,
        pHash,
        duplicateOfId: nearest?.id ?? null,
        duplicateDistance: nearest?.distance ?? null,
        embeddingModel: embedding.vector ? embedding.modelId : null,
      },
      select: { id: true },
    });
    if (embedding.vector) {
      await tx.$executeRaw`
        UPDATE "PropertyPhoto" SET embedding = ${toVectorLiteral(embedding.vector)}::vector
        WHERE id = ${created.id}`;
    }
    await tx.property.update({
      where: { id: propertyId },
      data: { images: { push: `${PHOTO_URL_PREFIX}${created.id}` } },
    });
    return created;
  });
  await Promise.all([invalidatePropertySearchCache(propertyId), invalidateSearchCache()]);

  let duplicate: DuplicateMatch | null = null;
  if (nearest) {
    const scope: DuplicateScope =
      nearest.propertyId === propertyId
        ? "SAME_PROPERTY"
        : nearest.hostId === property.hostId
          ? "OWN_LISTING"
          : "OTHER_LISTING";
    duplicate =
      scope === "OTHER_LISTING"
        ? { scope, distance: nearest.distance }
        : {
            scope,
            distance: nearest.distance,
            photoId: nearest.id,
            propertyId: nearest.propertyId,
          };
  }
  const warnings: PhotoWarning[] = [];
  if (duplicate) warnings.push("DUPLICATE");
  if (quality.qualityScore < cfg.VISION_LOW_QUALITY_THRESHOLD) warnings.push("LOW_QUALITY");
  if (duplicate) {
    logger.info(
      { propertyId, photoId: photo.id, scope: duplicate.scope, distance: duplicate.distance },
      "duplikat fotoğraf yüklendi"
    );
  }

  return {
    photo: {
      id: photo.id,
      url: `${PHOTO_URL_PREFIX}${photo.id}`,
      width: normalized.width,
      height: normalized.height,
      quality,
      pHash,
      embedded: embedding.vector !== null,
    },
    duplicate,
    warnings,
    visual: status(embedding.vector ? null : embedding.reason),
  };
}

export async function listPropertyPhotos(actor: AccessClaims, propertyId: string) {
  await assertPropertyAccess(actor, propertyId);
  const photos = await prisma.propertyPhoto.findMany({
    where: { propertyId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      width: true,
      height: true,
      blurScore: true,
      exposureScore: true,
      qualityScore: true,
      duplicateOfId: true,
      duplicateDistance: true,
      embeddingModel: true,
      createdAt: true,
    },
  });
  return photos.map((p) => ({ ...p, url: `${PHOTO_URL_PREFIX}${p.id}` }));
}

export async function deletePropertyPhoto(
  actor: AccessClaims,
  propertyId: string,
  photoId: string
): Promise<void> {
  await assertPropertyAccess(actor, propertyId);
  await withSerializableRetry(async (tx) => {
    const photo = await tx.propertyPhoto.findFirst({
      where: { id: photoId, propertyId },
      select: { id: true },
    });
    if (!photo) throw new NotFoundError("Fotoğraf bulunamadı");
    const property = await tx.property.findUniqueOrThrow({
      where: { id: propertyId },
      select: { images: true },
    });
    const url = `${PHOTO_URL_PREFIX}${photoId}`;
    await tx.property.update({
      where: { id: propertyId },
      data: { images: property.images.filter((u) => u !== url) },
    });
    await tx.propertyPhoto.delete({ where: { id: photoId } });
  });
  await Promise.all([invalidatePropertySearchCache(propertyId), invalidateSearchCache()]);
}

/** Herkese açık bayt servisi: yalnız yayında (aktif) ilanın fotoğrafı. */
export async function getPublicPhoto(
  photoId: string
): Promise<{ data: Buffer; contentType: string } | null> {
  const photo = await prisma.propertyPhoto.findFirst({
    where: { id: photoId, property: { isActive: true } },
    select: { data: true, contentType: true },
  });
  return photo ? { data: Buffer.from(photo.data), contentType: photo.contentType } : null;
}

/** Tek fotoğrafın embedding'ini (yeniden) hesaplar; backfill ve testler kullanır. */
export async function upsertPhotoEmbedding(
  photoId: string,
  embedder: ImageEmbedder
): Promise<void> {
  const photo = await prisma.propertyPhoto.findUnique({
    where: { id: photoId },
    select: { data: true },
  });
  if (!photo) throw new NotFoundError("Fotoğraf bulunamadı");
  const vector = await embedder.embedImage(Buffer.from(photo.data));
  await prisma.$executeRaw`
    UPDATE "PropertyPhoto"
    SET embedding = ${toVectorLiteral(vector)}::vector, "embeddingModel" = ${embedder.modelId}
    WHERE id = ${photoId}`;
}
