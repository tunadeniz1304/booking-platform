import { prisma } from "@/lib/prisma";
import { toVectorLiteral } from "@/lib/embedding/embedder";
import { embedText } from "@/lib/embedding/provider";

/**
 * Property gömme vektörlerini hesaplar ve pgvector'a yazar.
 * Üretimde: property kaydı değiştiğinde (oluşturma/güncelleme sonrası) çağrılır;
 * tam tarama ise mevcut kayıtları geriye dönük doldurur.
 *
 * `npm run embeddings:backfill` ile tüm aktif mülkler işlenir.
 */
export async function upsertPropertyEmbedding(propertyId: string): Promise<void> {
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

  const vector = await embedText(text);
  const literal = toVectorLiteral(vector);

  await prisma.$executeRaw`
    UPDATE "Property"
    SET embedding = ${literal}::vector
    WHERE id = ${propertyId}
  `;
}

/**
 * Tüm aktif mülklerin gömme vektörlerini (yeniden) hesaplar. Idempotent:
 * UPDATE olduğundan tekrar çağrılabir. Prisma Unsupported(vector) kolonunu
 * filtreleyemediği için "eksik olanlar" yerine tümü işlenir.
 * @returns işlenen mülk sayısı
 */
export async function backfillAllEmbeddings(): Promise<number> {
  const properties = await prisma.property.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  if (properties.length === 0) return 0;

  for (const p of properties) {
    await upsertPropertyEmbedding(p.id);
  }
  return properties.length;
}
