import { prisma } from "@/lib/prisma";
import { toVectorLiteral } from "@/lib/embedding/embedder";
import { embedForIndex } from "@/lib/embedding/provider";
import { runWithSystemLlmSubject } from "@/lib/llm/budget";
import { logger } from "@/lib/observability/logger";

/**
 * Property gömme vektörlerini hesaplar ve pgvector'a yazar.
 * Üretimde: property kaydı değiştiğinde (oluşturma/güncelleme sonrası) çağrılır;
 * tam tarama ise mevcut kayıtları geriye dönük doldurur.
 *
 * `npm run embeddings:backfill` ile tüm aktif mülkler işlenir.
 *
 * @returns vektör yazıldıysa `true`; uzak gömme reddedildiyse (bütçe/Redis/ağ) `false` —
 *   mevcut vektör olduğu gibi kalır, sonraki backfill yeniden dener.
 */
export async function upsertPropertyEmbedding(propertyId: string): Promise<boolean> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: { location: true, amenities: { select: { name: true } } },
  });
  if (!property) throw new Error(`Property bulunamadı: ${propertyId}`);

  const text = [
    property.title,
    property.description,
    property.location.city,
    property.location.country,
    property.propertyType,
    ...property.amenities.map((a) => a.name),
  ].join(" ");

  // İndeksleme bir sistem işidir: uzak embedding çağrısı sistem bütçesine faturalanır.
  // Reddedilirse hash vektörü uzak-model indeksine yazılmaz (vektör uzayları karışmaz).
  const vector = await runWithSystemLlmSubject("embedding_index", () => embedForIndex(text));
  if (!vector) {
    logger.warn({ propertyId }, "property embedding skipped; remote embedding rejected");
    return false;
  }
  const literal = toVectorLiteral(vector);

  await prisma.$executeRaw`
    UPDATE "Property"
    SET embedding = ${literal}::vector
    WHERE id = ${propertyId}
  `;
  return true;
}

/**
 * Tüm aktif mülklerin gömme vektörlerini (yeniden) hesaplar. Idempotent:
 * UPDATE olduğundan tekrar çağrılabir. Prisma Unsupported(vector) kolonunu
 * filtreleyemediği için "eksik olanlar" yerine tümü işlenir.
 * @returns vektörü yazılan mülk sayısı (uzak gömmesi reddedilenler hariç)
 */
export async function backfillAllEmbeddings(): Promise<number> {
  const properties = await prisma.property.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  if (properties.length === 0) return 0;

  let written = 0;
  for (const p of properties) {
    if (await upsertPropertyEmbedding(p.id)) written += 1;
  }
  return written;
}
