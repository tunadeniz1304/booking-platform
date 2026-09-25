import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import {
  addRoom,
  assertPropertyAccess,
  roomSchema,
  roomPatchSchema,
  updateRoom,
} from "@/lib/host/host-service";

type Ctx = { params: Promise<{ id: string }> };

/** v2 istemcileri için `capacity` takma adı (bir sürüm korunur; ADR 0010). */
function withCapacityAlias<T extends { maxOccupancy: number }>(room: T) {
  return { ...room, capacity: room.maxOccupancy };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json(
      withCapacityAlias(await addRoom(actor, id, roomSchema.parse(await req.json()))),
      {
        status: 201,
      }
    );
  } catch (error) {
    return toErrorResponse(error, "host.rooms.create");
  }
}

const patchSchema = z.object({ roomId: z.string().min(1) }).passthrough();

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    await assertPropertyAccess(actor, id);
    const { roomId, ...rest } = patchSchema.parse(await req.json());
    return NextResponse.json(
      withCapacityAlias(await updateRoom(actor, roomId, roomPatchSchema.parse(rest)))
    );
  } catch (error) {
    return toErrorResponse(error, "host.rooms.update");
  }
}

export const dynamic = "force-dynamic";
