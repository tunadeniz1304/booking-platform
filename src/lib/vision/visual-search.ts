import { prisma } from "@/lib/prisma";
import { isVectorEnabled } from "@/lib/search/vector";
import {
  VISION_REASON_MESSAGES,
  visionFlagEnabled,
  type VisionUnavailableReason,
} from "@/lib/vision/clip";

/**
 * Görsel arama durumu ve arama kartı yardımcıları (P1-10). `@/lib/search`'e bağımlı DEĞİL
 * (arama bu modülü içe aktarır; döngü olmasın).
 */

export interface VisionStatus {
  enabled: boolean;
  reason: VisionUnavailableReason | null;
  message: string | null;
}

export const visionStatus = (reason: VisionUnavailableReason | null): VisionStatus => ({
  enabled: reason === null,
  reason,
  message: reason ? VISION_REASON_MESSAGES[reason] : null,
});

/**
 * "Bu fotoğraftaki gibi" araması kullanılabilir mi? Sorgu anında model gerekmez (kayıtlı
 * embedding'lerde kNN) — bayrak ve pgvector yeterli.
 */
export async function visualSearchStatus(): Promise<VisionStatus> {
  if (!visionFlagEnabled()) return visionStatus("FLAG_OFF");
  if (!(await isVectorEnabled())) return visionStatus("VECTOR_UNAVAILABLE");
  return visionStatus(null);
}

/** Arama kartları için mülk başına kapak fotoğrafı (embedding'li, duplikat olmayan ilk). */
export async function coverPhotoIds(propertyIds: string[]): Promise<Map<string, string>> {
  if (propertyIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; propertyId: string }>>`
    SELECT DISTINCT ON (ph."propertyId") ph.id, ph."propertyId"
    FROM "PropertyPhoto" ph
    WHERE ph."propertyId" = ANY(${propertyIds}::text[])
      AND ph.embedding IS NOT NULL AND ph."duplicateOfId" IS NULL
    ORDER BY ph."propertyId", ph."createdAt", ph.id`;
  return new Map(rows.map((r) => [r.propertyId, r.id]));
}
