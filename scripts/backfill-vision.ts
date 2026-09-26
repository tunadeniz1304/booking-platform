import { prisma } from "@/lib/prisma";
import { getImageEmbedder, VISION_REASON_MESSAGES } from "@/lib/vision/clip";
import { backfillPhotoAnalysis, backfillPhotoEmbeddings } from "@/lib/vision/backfill";

/** P1-10: fotoğraf kalite/pHash ve (model varsa) CLIP embedding geriye dönük doldurma. */
async function main(): Promise<void> {
  const analysed = await backfillPhotoAnalysis();
  console.log(`[vision] kalite/pHash işlendi: ${analysed}`);
  const res = await getImageEmbedder();
  if (!res.embedder) {
    console.log(
      `[vision] embedding atlandı: ${res.reason} — ${VISION_REASON_MESSAGES[res.reason]}`
    );
    return;
  }
  const embedded = await backfillPhotoEmbeddings(res.embedder);
  const rows = await prisma.$queryRaw<Array<{ c: bigint; t: bigint }>>`
    SELECT count(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS c, count(*)::bigint AS t
    FROM "PropertyPhoto"`;
  console.log(
    `[vision] embedding işlendi: ${embedded}, yüklü: ${Number(rows[0]?.c ?? 0)}/${Number(rows[0]?.t ?? 0)}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[vision] hata:", error);
    process.exit(1);
  });
