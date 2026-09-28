import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";
import { getJwtSecret } from "./tokens";

/**
 * E-posta bağlantılarının outbox'ta şifreli taşınması (v4#12).
 *
 * Outbox satırı (ve onu okuyabilen yönetim/izleme araçları) ham tek kullanımlık
 * token'ı görmemeli: payload'a yalnızca token özeti + AES-256-GCM ile şifrelenmiş
 * bağlantı yazılır; bağlantıyı yalnızca e-postayı gönderen tüketici çözer.
 * Anahtar, JWT sırrından HKDF ile türetilir (ayrı bağlam; JWT imzasıyla karışmaz).
 */

const INFO = "booking-platform:auth-email-link:v1";

function key(): Buffer {
  return Buffer.from(hkdfSync("sha256", getJwtSecret(), Buffer.alloc(0), INFO, 32));
}

export function sealLink(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

export function openLink(sealed: string): string {
  if (!sealed.startsWith("v1.")) throw new Error("Bilinmeyen bağlantı şifre sürümü");
  const raw = Buffer.from(sealed.slice(3), "base64url");
  // Etiket uzunluğu sabit: kısaltılmış GCM etiketi (ör. 4 bayt) kabul edilmez (Semgrep).
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12), {
    authTagLength: 16,
  });
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
