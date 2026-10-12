import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http/errors";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { redis } from "@/lib/redis";
import { assertNoticeRateLimit } from "@/lib/compliance/dsa";
import { appealInputSchema, submitAppeal } from "@/lib/compliance/dsa-appeal";

/**
 * DSA md. 20 itiraz (P2-1a). Oturum gerekmez: karar e-postasındaki imzalı bağlantının
 * belirteci (rol başına HMAC) yetkiyi taşır. Bildirim formuyla aynı istemci limiti, ayrı
 * sayaçla ("appeal"); doğrulama hatalı gönderimler kotayı tüketmez (şema limitten önce).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const config = getConfig();
    const client = clientKey(req.headers, {
      trustedProxyHops: config.TRUSTED_PROXY_HOPS,
      trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
    });
    const input = appealInputSchema.parse(await req.json());
    await assertNoticeRateLimit(redis, client, "appeal");
    const appeal = await submitAppeal(id, input);
    return NextResponse.json(
      { id: appeal.id, status: appeal.status, createdAt: appeal.createdAt },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error, "notices.appeal");
  }
}
