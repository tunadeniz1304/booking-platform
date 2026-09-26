import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { revokeMandate } from "@/lib/agentic/mandate";

/**
 * Mandate iptali (P2-1a). Yetkiyi daraltan işlem olduğu için recent-auth istenmez; yalnız
 * mandate'i veren kullanıcı iptal eder (başkasınınki 404). İptal edilen nonce'la checkout
 * 403 MANDATE_REVOKED alır.
 */
export const DELETE = observed(
  "account.agent_mandates.revoke",
  async function deleteHandler(
    req: NextRequest,
    { params }: { params: Promise<{ nonce: string }> }
  ) {
    try {
      const claims = await requireAuth(req);
      const { nonce } = await params;
      return NextResponse.json(await revokeMandate(claims.userId, nonce));
    } catch (error) {
      return toErrorResponse(error, "account.agent_mandates.revoke");
    }
  }
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
