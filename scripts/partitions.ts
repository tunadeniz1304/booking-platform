/**
 * `npm run db:partitions [ay=12]` — Availability OPT-IN aylık RANGE partisyonları
 * (bkz. migrations/manual + ADR 0006). Tablo partisyonlu değilse hiçbir şey yapmaz.
 * Önümüzdeki N ay için eksik partisyonları oluşturur; DEFAULT partisyon doluysa uyarır
 * (dolu DEFAULT'a çakışan yeni partisyon eklenemez — önce satırlar taşınmalı).
 */
import { PrismaClient } from "@prisma/client";
import { loadEnv } from "../src/lib/config/load-env";

async function main(): Promise<void> {
  loadEnv();
  const months = Number(process.argv[2] ?? 12);
  const prisma = new PrismaClient();
  try {
    const partitioned = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM pg_partitioned_table p
      JOIN pg_class c ON c.oid = p.partrelid WHERE c.relname = 'Availability'`;
    if (Number(partitioned[0].n) === 0) {
      console.log("Availability partisyonlu değil (opt-in) — işlem yok.");
      return;
    }
    const def = await prisma
      .$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "Availability_default"`
      )
      .catch(() => [{ n: 0n }]);
    if (Number(def[0].n) > 0) {
      console.warn(`UYARI: DEFAULT partisyonda ${def[0].n} satır var; çakışan aylar atlanabilir.`);
    }
    const now = new Date();
    for (let i = 0; i < months; i++) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const name = `Availability_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
      const from = start.toISOString().slice(0, 10);
      const to = end.toISOString().slice(0, 10);
      await prisma
        .$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "Availability" FOR VALUES FROM ('${from}') TO ('${to}')`
        )
        .then(
          () => console.log(`✓ ${name} [${from}, ${to})`),
          (e: Error) => console.warn(`✗ ${name}: ${e.message.split("\n")[0]}`)
        );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("partitions hata:", (error as Error).message);
  process.exit(1);
});
