/**
 * `npm run money:backfill` — P0-2 expand/contract (ADR 0019): eski `Decimal(10,2)` para
 * kolonlarını `BigInt *Minor` kolonlarına taşır ve eski/yeni toplamları karşılaştırır.
 * İdempotent: tekrar koşmak yalnızca hâlâ boş kalan satırları doldurur. Contract migration'ı
 * uygulandıktan sonra eski kolonlar olmadığından her kolon "atlandı" raporlanır.
 */
import { PrismaClient } from "@prisma/client";
import { loadEnv } from "../src/lib/config/load-env";
import { backfillMoneyColumns, moneyColumnTotals, MONEY_COLUMNS } from "../src/lib/money/backfill";

async function main(): Promise<number> {
  loadEnv();
  const prisma = new PrismaClient();
  try {
    const results = await backfillMoneyColumns(prisma);
    let mismatches = 0;
    for (const [i, r] of results.entries()) {
      if (r.skipped) {
        console.log(`${r.table}.${r.minor}: atlandı (eski kolon yok)`);
        continue;
      }
      const totals = await moneyColumnTotals(prisma, MONEY_COLUMNS[i]);
      const ok = totals.missing === 0 && totals.legacyMinor === totals.minor;
      if (!ok) mismatches += 1;
      console.log(
        `${r.table}.${r.minor}: ${r.updated} satır; eski=${totals.legacyMinor} yeni=${totals.minor} eksik=${totals.missing} ${ok ? "OK" : "UYUŞMAZLIK"}`
      );
    }
    return mismatches === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error("money backfill hata:", (error as Error).message);
    process.exit(1);
  });
