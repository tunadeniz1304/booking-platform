/**
 * Compose `migrate` görevi: `prisma migrate deploy`, ardından DEMO_SEED=true ise ve
 * veritabanında hiç kullanıcı yoksa demo seed'i. Tekrar çalıştırmak güvenlidir
 * (idempotent): migration'lar uygulanmışsa atlanır, dolu veritabanına seed yazılmaz.
 */
import { spawnSync } from "child_process";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { loadEnv } from "../src/lib/config/load-env";

function run(args: string[]): void {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    throw new Error(`Komut başarısız: ${args.slice(0, 3).join(" ")} (çıkış ${result.status})`);
  }
}

async function main(): Promise<void> {
  loadEnv();
  run([path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"]);

  if (process.env.DEMO_SEED !== "true") {
    console.log("DEMO_SEED kapalı — seed atlandı");
    return;
  }
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.count();
    if (users > 0) {
      console.log(`Veritabanı dolu (${users} kullanıcı) — seed atlandı`);
      return;
    }
  } finally {
    await prisma.$disconnect();
  }
  run([path.resolve("node_modules/tsx/dist/cli.mjs"), "prisma/seed.ts"]);
}

main().catch((error: unknown) => {
  console.error("migrate-and-seed:", (error as Error).message);
  process.exit(1);
});
