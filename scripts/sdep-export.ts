/**
 * `npm run sdep:export [YYYY-MM] [çıktı.csv]` — AB 2024/1028 SDEP aylık CSV'si
 * (kayıt no başına gece + misafir). Dönem verilmezse önceki ay; dosya verilmezse stdout.
 */
import { writeFileSync } from "node:fs";
import { loadEnv } from "../src/lib/config/load-env";
import { buildSdepRows, previousPeriod, toSdepCsv } from "../src/lib/compliance/sdep";

loadEnv();
const period = process.argv[2] ?? previousPeriod();
const out = process.argv[3];
buildSdepRows(period)
  .then((rows) => {
    const csv = toSdepCsv(rows);
    if (out) {
      writeFileSync(out, csv, "utf8");
      console.error(`SDEP ${period}: ${rows.length} kayıt → ${out}`);
    } else {
      process.stdout.write(csv);
    }
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("sdep-export hata:", (error as Error).message);
    process.exit(1);
  });
