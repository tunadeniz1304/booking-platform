import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { withAiSubject } from "@/lib/http/ai";
import { draftHostReply } from "@/lib/messaging/message-service";

/** Ev sahibine yapay zekâ yanıt taslağı; kaydedilmez/gönderilmez, host onayıyla gönderilir. */
export const POST = observed(
  "bookings.messages.draft",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      return NextResponse.json(await withAiSubject(req, () => draftHostReply(id, userId)));
    } catch (error) {
      return toErrorResponse(error, "bookings.messages.draft");
    }
  }
);

export const dynamic = "force-dynamic";
