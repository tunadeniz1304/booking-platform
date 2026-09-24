import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { ariSchema, bulkUpdateAvailability } from "@/lib/host/host-service";

/** Toplu ARI (≤365 gece); rezervasyonlu geceler ezilmez. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json(
      await bulkUpdateAvailability(actor, roomId, ariSchema.parse(await req.json()))
    );
  } catch (error) {
    return toErrorResponse(error, "host.availability");
  }
}

export const dynamic = "force-dynamic";
