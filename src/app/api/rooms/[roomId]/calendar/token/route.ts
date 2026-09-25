import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { assertRoomAccess } from "@/lib/host/host-service";
import { currentFeedToken, rotateFeedToken } from "@/lib/channel/channel";

type Ctx = { params: Promise<{ roomId: string }> };

const feedPath = (roomId: string, token: string) =>
  `/api/rooms/${roomId}/calendar.ics?token=${encodeURIComponent(token)}`;

/** Güncel iCal akış yolu (host, yalnızca kendi odası). */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { roomId } = await params;
    await assertRoomAccess(await requireRole(req, ["HOST", "ADMIN"]), roomId);
    return NextResponse.json({ path: feedPath(roomId, await currentFeedToken(roomId)) });
  } catch (error) {
    return toErrorResponse(error, "channel.feed.get");
  }
}

/** Akış tokenını döndürür (v3#21): eski URL'ler anında 403 alır. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { roomId } = await params;
    await assertRoomAccess(await requireRole(req, ["HOST", "ADMIN"]), roomId);
    const { token, version } = await rotateFeedToken(roomId);
    return NextResponse.json({ path: feedPath(roomId, token), version });
  } catch (error) {
    return toErrorResponse(error, "channel.feed.rotate");
  }
}

export const dynamic = "force-dynamic";
