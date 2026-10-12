import { NextRequest, NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/lib/http/errors";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { redis } from "@/lib/redis";
import { assertNoticeRateLimit, noticeInputSchema, submitNotice } from "@/lib/compliance/dsa";

/**
 * Herkese açık DSA bildirim formu (P1-13b, md. 16). Oturum gerekmez; istemci başına
 * `DSA_NOTICE_MAX_PER_WINDOW` sınırı (proxy genel limitine ek). Alındı onayı e-postayla.
 * Doğrulama hatalı gönderimler kotayı tüketmez (şema limitten önce); 429 yanıtı
 * `Retry-After` başlığı ve `details.retryAfterSeconds` ile kalan bekleme süresini bildirir.
 */
export async function POST(req: NextRequest) {
  let client: string | null = null;
  try {
    const config = getConfig();
    client = clientKey(req.headers, {
      trustedProxyHops: config.TRUSTED_PROXY_HOPS,
      trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
    });
    const input = noticeInputSchema.parse(await req.json());
    await assertNoticeRateLimit(redis, client);
    const notice = await submitNotice(input);
    return NextResponse.json(
      { id: notice.id, status: notice.status, createdAt: notice.createdAt },
      { status: 201 }
    );
  } catch (error) {
    if (client && error instanceof HttpError && error.code === "NOTICE_RATE_LIMITED") {
      const retryAfterSeconds = await noticeRetryAfter(client);
      const res = toErrorResponse(
        new HttpError(error.status, error.code, error.message, { retryAfterSeconds }),
        "notices.submit"
      );
      res.headers.set("Retry-After", String(retryAfterSeconds));
      return res;
    }
    return toErrorResponse(error, "notices.submit");
  }
}

/** Sabit pencerenin kalan süresi (sn); okunamazsa pencerenin tamamı (üst sınır). */
async function noticeRetryAfter(client: string): Promise<number> {
  const windowSeconds = getConfig().DSA_NOTICE_WINDOW_SECONDS;
  try {
    // Anahtar `assertNoticeRateLimit` (lib/compliance/dsa.ts) ile aynı olmalı.
    const ttl = await redis.ttl(`dsa:notice:${client}`);
    return ttl > 0 ? Math.min(ttl, windowSeconds) : windowSeconds;
  } catch {
    return windowSeconds;
  }
}
