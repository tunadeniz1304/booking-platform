import path from "path";
import dotenv from "dotenv";

let loaded = false;

/**
 * `.env` yükleyicisi (Next.js dışındaki süreçler — worker, gRPC, script'ler — ve
 * LLM ayarları için). Önce proje kökündeki `.env`, ardından bir üst dizindeki
 * `.env` denenir; ikisi de `override: false` ile yüklenir, yani süreç ortamında
 * zaten tanımlı değişkenler asla ezilmez. Testlerde `SKIP_DOTENV=1` ile kapalıdır.
 *
 * Değerler hiçbir koşulda loglanmaz.
 */
export function loadEnv(opts: { cwd?: string; force?: boolean } = {}): void {
  if (loaded && !opts.force) return;
  loaded = true;
  if (process.env.SKIP_DOTENV === "1" && !opts.force) return;
  const cwd = opts.cwd ?? process.cwd();
  for (const candidate of [path.resolve(cwd, ".env"), path.resolve(cwd, "..", ".env")]) {
    dotenv.config({ path: candidate, override: false, quiet: true });
  }
}
