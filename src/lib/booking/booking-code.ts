import { createHmac, timingSafeEqual } from "crypto";
import { getJwtSecret } from "@/lib/auth/tokens";

/**
 * İmzalı rezervasyon kodu (P1-12 QR kartı). Biçim: `BK1.<bookingId>.<imza>`; imza
 * HMAC-SHA256(sunucu sırrı, "booking-code:v1:<id>") ilk 16 baytı (base64url). Kod ad, e-posta,
 * tarih veya tutar İÇERMEZ — QR ekran görüntüsü paylaşılsa bile kişisel veri sızmaz; tesis
 * tarafı kodu sunucuda doğrulayıp rezervasyonu bulur. Sahte/kurcalanmış kod `null` döner.
 */
const PREFIX = "BK1";
const SIG_BYTES = 16;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function signature(bookingId: string): Buffer {
  return createHmac("sha256", getJwtSecret())
    .update(`booking-code:v1:${bookingId}`)
    .digest()
    .subarray(0, SIG_BYTES);
}

export function signBookingCode(bookingId: string): string {
  if (!ID_PATTERN.test(bookingId)) throw new Error("Geçersiz rezervasyon kimliği");
  return `${PREFIX}.${bookingId}.${signature(bookingId).toString("base64url")}`;
}

/** Geçerli koddan rezervasyon kimliğini döndürür; aksi halde `null` (sabit zamanlı karşılaştırma). */
export function verifyBookingCode(code: string): string | null {
  const parts = code.trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX || !ID_PATTERN.test(parts[1])) return null;
  // Metin olarak karşılaştırılır: base64url'nin son karakterindeki kullanılmayan bitler
  // aynı baytlara çözülen birden çok yazım üretir (kod kanonik olmalı).
  const given = Buffer.from(parts[2]);
  const expected = Buffer.from(signature(parts[1]).toString("base64url"));
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? parts[1] : null;
}
