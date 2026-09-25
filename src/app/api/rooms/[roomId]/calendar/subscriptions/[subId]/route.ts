import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { assertRoomAccess } from "@/lib/host/host-service";
import { deleteSubscription } from "@/lib/channel/ical-poller";

/** Aboneliği siler (içe aktarılmış bloklar bir sonraki manuel içe aktarmaya kadar kalır). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string; subId: string }> }
) {
  try {
    const { roomId, subId } = await params;
    await assertRoomAccess(await requireRole(req, ["HOST", "ADMIN"]), roomId);
    await deleteSubscription(roomId, subId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error, "channel.subscriptions.delete");
  }
}

export const dynamic = "force-dynamic";
