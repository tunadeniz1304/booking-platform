import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { NotFoundError, toErrorResponse } from "@/lib/http/errors";
import {
  approveEvent,
  createYieldHold,
  rejectEvent,
  releaseYieldHold,
  rollbackEvent,
} from "@/lib/pricing/event-signals";
import { audit } from "@/lib/admin/audit";

/** Olay eylemleri (ADMIN): approve | reject | rollback | yield-hold | release-hold. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  try {
    const { id, action } = await params;
    const admin = await requireRole(req, ["ADMIN"]);
    let result: unknown;
    switch (action) {
      case "approve":
        result = await approveEvent(id, admin.userId);
        break;
      case "reject":
        result = await rejectEvent(id);
        break;
      case "rollback":
        result = await rollbackEvent(id);
        break;
      case "yield-hold": {
        const { share } = z.object({ share: z.number().positive().max(1) }).parse(await req.json());
        result = { held: await createYieldHold(id, share) };
        break;
      }
      case "release-hold":
        result = { released: await releaseYieldHold(id) };
        break;
      default:
        throw new NotFoundError("Bilinmeyen eylem");
    }
    await audit(admin.userId, `event.${action}`, "DemandEvent", id);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error, "admin.events.action");
  }
}

export const dynamic = "force-dynamic";
