import { prisma } from "@/lib/prisma";
import { computePHash } from "@/lib/vision/phash";
import { computeQuality } from "@/lib/vision/quality";
import { findNearestDuplicate, upsertPhotoEmbedding } from "@/lib/vision/photo-service";
import type { ImageEmbedder } from "@/lib/vision/clip";

/**
 * P1-10 geriye dönük doldurma (`npm run vision:backfill`, `embeddings:backfill` deseni):
 * kalite/pHash'i eksik fotoğraflar analiz edilir (duplikat işareti dahil), embedder varsa
 * embedding'i olmayanlar gömülür. Idempotent: yalnız eksik alanlar yazılır.
 */

export async function backfillPhotoAnalysis(): Promise<number> {
  const photos = await prisma.propertyPhoto.findMany({
    where: { OR: [{ pHash: null }, { qualityScore: null }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  for (const { id } of photos) {
    const photo = await prisma.propertyPhoto.findUniqueOrThrow({
      where: { id },
      select: { data: true, duplicateOfId: true },
    });
    const data = Buffer.from(photo.data);
    const [quality, pHash] = await Promise.all([computeQuality(data), computePHash(data)]);
    const nearest = photo.duplicateOfId ? null : await findNearestDuplicate(pHash, id);
    await prisma.propertyPhoto.update({
      where: { id },
      data: {
        ...quality,
        pHash,
        ...(nearest ? { duplicateOfId: nearest.id, duplicateDistance: nearest.distance } : {}),
      },
    });
  }
  return photos.length;
}

export async function backfillPhotoEmbeddings(embedder: ImageEmbedder): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "PropertyPhoto"
    WHERE embedding IS NULL OR "embeddingModel" IS DISTINCT FROM ${embedder.modelId}
    ORDER BY "createdAt", id`;
  for (const { id } of rows) await upsertPhotoEmbedding(id, embedder);
  return rows.length;
}
