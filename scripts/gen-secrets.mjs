/**
 * Demo ortamı için rastgele sır üretici (docker compose `secrets-init` görevi).
 *
 * Her ad için dosya yoksa 48 baytlık rastgele base64url değer yazar; varsa dokunmaz
 * (yeniden başlatmalarda oturumlar geçerli kalır). Değerler asla yazdırılmaz.
 * Bağımlılıksız düz Node betiği (Windows/Linux).
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";

const dir = process.env.KEYFILE_DIR || "/run/booking-secrets";
const names = [
  "JWT_SECRET",
  "INTERNAL_API_SECRET",
  "TRANSFER_SIGNING_SECRET",
  "PSP_WEBHOOK_SECRET",
  "METRICS_TOKEN",
  "REDIS_PASSWORD",
  "POSTGRES_PASSWORD",
];

mkdirSync(dir, { recursive: true });
let created = 0;
for (const name of names) {
  const file = path.join(dir, name);
  if (existsSync(file)) continue;
  writeFileSync(file, randomBytes(48).toString("base64url"), { encoding: "utf8" });
  // Aynı birimi paylaşan farklı UID'li konteynerler (postgres, redis, app) okuyabilmeli.
  chmodSync(file, 0o644);
  created += 1;
}
console.log(`secrets-init: ${created} yeni, ${names.length - created} mevcut`);
