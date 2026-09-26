import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { assertRecentAuth } from "@/lib/auth/recent-auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { issueMandate } from "@/lib/agentic/mandate";

/**
 * AP2 intent mandate verir (P1-11): kullanıcı, ajanına tutar/para birimi/süre (ve isteğe
 * bağlı ilan) sınırlı ödeme yetkisi imzalatır. Para yetkisi → doğrulanmış e-posta +
 * yakın zamanda yeniden kimlik doğrulama (recent-auth, aksi hâlde 403 REAUTH_REQUIRED).
 * Dönen JWS yalnızca bir kez gösterilir; ajan checkout tamamlarken sunar.
 */
export const POST = observed(
  "account.agent_mandates.issue",
  async function postHandler(req: NextRequest) {
    try {
      const claims = await requireVerifiedEmail(req);
      assertRecentAuth(claims);
      const { mandate, claims: issued } = await issueMandate(claims.userId, await req.json());
      return NextResponse.json({ mandate, claims: issued }, { status: 201 });
    } catch (error) {
      return toErrorResponse(error, "account.agent_mandates.issue");
    }
  }
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
