import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http/errors";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { redis } from "@/lib/redis";
import { assertNoticeRateLimit, noticeInputSchema, submitNotice } from "@/lib/compliance/dsa";

/**
 * Herkese açık DSA bildirim formu (P1-13b, md. 16). Oturum gerekmez; istemci başına
 * `DSA_NOTICE_MAX_PER_WINDOW` sınırı (proxy genel limitine ek). Alındı onayı e-postayla.
 */
export async function POST(req: NextRequest) {
  try {
    const config = getConfig();
    const client = clientKey(req.headers, {
      trustedProxyHops: config.TRUSTED_PROXY_HOPS,
      trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
      socketIp: (req as unknown as { ip?: string }).ip,
    });
    await assertNoticeRateLimit(redis, client);
    const notice = await submitNotice(noticeInputSchema.parse(await req.json()));
    return NextResponse.json(
      { id: notice.id, status: notice.status, createdAt: notice.createdAt },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error, "notices.submit");
  }
}
