/**
 * `npm run demo:reset` — demo veritabanını sıfırlar: `prisma migrate reset --force
 * --skip-seed`, ardından demo seed. Yıkıcıdır; production'da (NODE_ENV=production)
 * yalnızca açık `DEMO_SEED=true` ile çalışır (seed guard ile aynı kural).
 */
import { spawnSync } from "child_process";
import path from "path";
import { loadEnv } from "../src/lib/config/load-env";
import { assertSeedAllowed } from "../src/lib/config/seed-guard";

function run(args: string[]): void {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    throw new Error(`Komut başarısız: ${args.slice(0, 3).join(" ")} (çıkış ${result.status})`);
  }
}

function main(): void {
  loadEnv();
  assertSeedAllowed();
  run([
    path.resolve("node_modules/prisma/build/index.js"),
    "migrate",
    "reset",
    "--force",
    "--skip-seed",
  ]);
  run([path.resolve("node_modules/tsx/dist/cli.mjs"), "prisma/seed.ts"]);
  console.log("Demo veritabanı sıfırlandı ve yeniden seed edildi.");
}

try {
  main();
} catch (error: unknown) {
  console.error("demo:reset:", (error as Error).message);
  process.exit(1);
}
