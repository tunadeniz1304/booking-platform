import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { assertRoomAccess } from "@/lib/host/host-service";
import { listSubscriptions, upsertSubscription } from "@/lib/channel/ical-poller";
import { httpsUrl } from "@/lib/security/url";

type Ctx = { params: Promise<{ roomId: string }> };

const bodySchema = z.object({
  source: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, "Kaynak adı küçük harf, rakam ve tire olmalı"),
  url: httpsUrl,
});

/** Odanın iCal abonelikleri (host). */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { roomId } = await params;
    await assertRoomAccess(await requireRole(req, ["HOST", "ADMIN"]), roomId);
    return NextResponse.json({ subscriptions: await listSubscriptions(roomId) });
  } catch (error) {
    return toErrorResponse(error, "channel.subscriptions.list");
  }
}

/** Abonelik ekler/günceller; worker `ICAL_POLL_MINUTES` aralığıyla yoklar. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { roomId } = await params;
    await assertRoomAccess(await requireRole(req, ["HOST", "ADMIN"]), roomId);
    const { source, url } = bodySchema.parse(await req.json());
    return NextResponse.json(await upsertSubscription(roomId, source, url), { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "channel.subscriptions.upsert");
  }
}

export const dynamic = "force-dynamic";
