import { NextRequest, NextResponse } from "next/server";
import { exportRoomCalendar, verifyFeedToken } from "@/lib/channel/channel";
import { toErrorResponse } from "@/lib/http/errors";

/** iCal akışı (imzalı token ile; OTA kanal yöneticileri için). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await params;
    if (!(await verifyFeedToken(roomId, req.nextUrl.searchParams.get("token")))) {
      return NextResponse.json({ error: "Geçersiz takvim tokenı" }, { status: 403 });
    }
    return new NextResponse(await exportRoomCalendar(roomId), {
      headers: { "content-type": "text/calendar; charset=utf-8" },
    });
  } catch (error) {
    return toErrorResponse(error, "channel.ical.export");
  }
}

export const dynamic = "force-dynamic";
