import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { markAiGenerated, withAiSubject } from "@/lib/http/ai";
import { draftHostReply } from "@/lib/messaging/message-service";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";

/** Ev sahibine yapay zekâ yanıt taslağı; kaydedilmez/gönderilmez, host onayıyla gönderilir. */
export const POST = observed(
  "bookings.messages.draft",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      // Misafirin son mesajının dili önceliklidir; yoksa arayüz dili (F404).
      const locale = resolveLocale(req.cookies.get(LOCALE_COOKIE)?.value);
      const draft = await withAiSubject(req, () => draftHostReply(id, userId, locale));
      return NextResponse.json(markAiGenerated(draft));
    } catch (error) {
      return toErrorResponse(error, "bookings.messages.draft");
    }
  }
);

export const dynamic = "force-dynamic";
