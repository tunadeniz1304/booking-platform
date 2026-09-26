import { NextRequest, NextResponse } from "next/server";
import { handleIdentityWebhook } from "@/lib/trust/kyc";
import { toErrorResponse } from "@/lib/http/errors";

/**
 * KYC sağlayıcı webhook'u (P1-6). İmza YALNIZCA aktif sağlayıcının şemasıyla doğrulanır:
 * Stripe Identity aktifken `Stripe-Signature`, mock aktifken `x-kyc-signature` (HMAC, 5 dk
 * tolerans). Diğer sağlayıcının imzası/imzasız → 401; bozuk imza → 400. Bilinmeyen oturum
 * veya ilgisiz olay türü → 200 (sağlayıcı yeniden denemesin).
 */
export async function POST(req: NextRequest) {
  try {
    const result = await handleIdentityWebhook(await req.text(), req.headers);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    return toErrorResponse(error, "trust.kyc.webhook");
  }
}

export const dynamic = "force-dynamic";
