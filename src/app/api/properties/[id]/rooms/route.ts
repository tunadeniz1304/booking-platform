import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { addRoom, assertPropertyAccess, roomSchema, updateRoom } from "@/lib/host/host-service";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json(await addRoom(actor, id, roomSchema.parse(await req.json())), {
      status: 201,
    });
  } catch (error) {
    return toErrorResponse(error, "host.rooms.create");
  }
}

const patchSchema = roomSchema
  .partial()
  .extend({ roomId: z.string().min(1), available: z.boolean().optional() });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    await assertPropertyAccess(actor, id);
    const { roomId, ...rest } = patchSchema.parse(await req.json());
    return NextResponse.json(await updateRoom(actor, roomId, rest));
  } catch (error) {
    return toErrorResponse(error, "host.rooms.update");
  }
}

export const dynamic = "force-dynamic";
