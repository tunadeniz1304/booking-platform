import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { markAiGenerated, withAiSubject } from "@/lib/http/ai";
import { supportChatSchema } from "@/lib/http/api-schemas";
import { runSupportChat } from "@/lib/support/agent";

/**
 * v5 P1-4: AI destek ajanı (misafir). Salt-okur araçlar; iade/iptal/ödeme yapamaz.
 * Para/iade talebi, hukuki/şikâyet sinyali veya düşük güven → insan kuyruğu (SupportTicket).
 * Yanıt `disclosure` + `ai_generated: true` taşır (AI Act Md. 50). Rate-limit: `ai` kovası.
 */
export const POST = observed("support.chat", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const input = supportChatSchema.parse(await req.json());
    const result = await withAiSubject(req, () => runSupportChat({ userId, ...input }));
    return NextResponse.json(markAiGenerated(result));
  } catch (error) {
    return toErrorResponse(error, "support.chat");
  }
});

export const dynamic = "force-dynamic";
