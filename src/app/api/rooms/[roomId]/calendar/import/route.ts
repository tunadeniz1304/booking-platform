import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { assertRoomAccess } from "@/lib/host/host-service";
import { importCalendar } from "@/lib/channel/channel";

const bodySchema = z.object({
  source: z.string().min(2).max(40),
  ics: z.string().min(20).max(500_000),
});

/** Harici iCal içe aktarımı (host, yalnızca kendi odası). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    await assertRoomAccess(actor, roomId);
    const { source, ics } = bodySchema.parse(await req.json());
    return NextResponse.json(await importCalendar(roomId, ics, source));
  } catch (error) {
    return toErrorResponse(error, "channel.ical.import");
  }
}

export const dynamic = "force-dynamic";
