import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { claimTransfer } from "@/lib/transfer/transfer-service";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";

const claimSchema = z.object({
  /** Satıcının paylaştığı imzalı claim linkindeki token (zorunlu). */
  token: z.string().min(20).max(1000),
  cardToken: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireVerifiedEmail(req);
    const { token, cardToken } = claimSchema.parse(await req.json());
    // Opsiyonel: aynı isteğin tekrarı aynı provizyonu kullanır; yoksa deneme başına yeni anahtar.
    const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128) || undefined;
    // v5#5: fraud sinyalleri için istemci bağlamı (ödeme yollarıyla aynı IP çözümü).
    const config = getConfig();
    const hops = config.TRUSTED_PROXY_HOPS;
    const context = {
      ip: clientKey(req.headers, {
        trustedProxyHops: hops,
        trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
      }),
      ipCountry: hops > 0 ? req.headers.get("cf-ipcountry") : null,
    };
    return NextResponse.json(
      await claimTransfer({ token, buyerId: userId, cardToken, idempotencyKey, context })
    );
  } catch (error) {
    return toErrorResponse(error, "transfers.claim");
  }
}

export const dynamic = "force-dynamic";
