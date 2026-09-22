import { prisma } from "@/lib/prisma";
import { backfillAllEmbeddings } from "@/lib/embedding/backfill";

async function main(): Promise<void> {
  const total = await prisma.property.count();
  const done = await backfillAllEmbeddings();
  const rows = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT count(*)::bigint AS c FROM "Property" WHERE embedding IS NOT NULL
  `;
  console.log(`[embeddings] işlendi: ${done}, gömme yüklü: ${Number(rows[0]?.c ?? 0)}/${total}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[embeddings] hata:", error);
    process.exit(1);
  });
