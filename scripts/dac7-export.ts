/**
 * `npm run dac7:export -- <YYYY> [--out <dizin>] [--format json|csv|both] [--pseudonymize]`
 * AB DAC7 benzeri yıllık ev sahibi raporu (eğitim amaçlı): ev sahibi başına brüt bedel,
 * komisyon, işlem sayısı, kiralanan gün ve çeyreklik kırılım. Yıl verilmezse önceki yıl;
 * `--out` yoksa JSON stdout'a yazılır. Kaynak: çift girişli defter (ADR 0020/0021).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "../src/lib/config/load-env";
import { assertYear, buildDac7Report, loadDac7Activities, toDac7Csv } from "../src/lib/payout/dac7";

loadEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).find((a) => /^\d{4}$/.test(a));
  const year = assertYear(arg("year") ?? positional ?? new Date().getUTCFullYear() - 1);
  const format = arg("format") ?? "both";
  if (!["json", "csv", "both"].includes(format)) throw new Error(`Bilinmeyen biçim: ${format}`);
  const out = arg("out");
  const { activities, sellers } = await loadDac7Activities(year);
  const report = buildDac7Report(year, activities, sellers, {
    timestamp: new Date(),
    pseudonymize: process.argv.includes("--pseudonymize"),
  });
  if (!out) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  mkdirSync(out, { recursive: true });
  if (format !== "csv") {
    writeFileSync(join(out, `dac7-${year}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (format !== "json") writeFileSync(join(out, `dac7-${year}.csv`), toDac7Csv(report), "utf8");
  console.error(`DAC7 ${year}: ${report.reportableSellers.length} satıcı → ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("dac7-export hata:", (error as Error).message);
    process.exit(1);
  });
