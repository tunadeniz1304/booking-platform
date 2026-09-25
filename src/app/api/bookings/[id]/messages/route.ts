import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { listMessages, sendMessage, sendMessageSchema } from "@/lib/messaging/message-service";

type Ctx = { params: Promise<{ id: string }> };

/** Rezervasyon mesajları: yalnızca misafir ve ev sahibi (diğerleri 404). */
export const GET = observed(
  "bookings.messages",
  async function getHandler(req: NextRequest, { params }: Ctx) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      return NextResponse.json(await listMessages(id, userId));
    } catch (error) {
      return toErrorResponse(error, "bookings.messages.list");
    }
  }
);

export const POST = observed(
  "bookings.messages",
  async function postHandler(req: NextRequest, { params }: Ctx) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      const input = sendMessageSchema.parse(await req.json());
      return NextResponse.json({ message: await sendMessage(id, userId, input) }, { status: 201 });
    } catch (error) {
      return toErrorResponse(error, "bookings.messages.send");
    }
  }
);

export const dynamic = "force-dynamic";
