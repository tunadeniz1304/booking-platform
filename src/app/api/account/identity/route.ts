import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { getIdentityStatus, startIdentityVerification, startKycSchema } from "@/lib/trust/kyc";

/** Hesabın kimlik doğrulama durumu + gereklilik bayrakları (P1-6). */
export const GET = observed("account.identity", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return NextResponse.json(await getIdentityStatus(userId));
  } catch (error) {
    return toErrorResponse(error, "account.identity.status");
  }
});

/** Doğrulama başlatır; Stripe'ta yönlendirme URL'si, mock'ta anında sonuç döner. */
export const POST = observed("account.identity", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireVerifiedEmail(req);
    const input = startKycSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await startIdentityVerification(userId, input), { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "account.identity.start");
  }
});

export const dynamic = "force-dynamic";
