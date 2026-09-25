/**
 * i18n anahtar denetimi (P1-12): `npx tsx scripts/i18n-check.ts`. Eksik/fazla anahtar,
 * boş metin veya farklı yer tutucu varsa çıkış kodu 1 (CI hatası).
 */
import path from "node:path";
import { checkMessagesDir } from "../src/lib/i18n/check";
import { NAMESPACES } from "../src/i18n/messages";
import { LOCALES } from "../src/i18n/config";

const issues = checkMessagesDir(path.resolve("messages"), NAMESPACES, LOCALES);
if (issues.length > 0) {
  for (const i of issues)
    console.error(`✗ ${i.namespace}${i.key ? `.${i.key}` : ""}: ${i.problem}`);
  console.error(`${issues.length} i18n sorunu`);
  process.exit(1);
}
console.log(`i18n: ${NAMESPACES.length} ad alanı, ${LOCALES.join("/")} anahtarları eşit ✓`);
