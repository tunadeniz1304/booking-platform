import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { listHostProperties } from "@/lib/host/host-service";

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await listHostProperties(await requireRole(req, ["HOST", "ADMIN"])));
  } catch (error) {
    return toErrorResponse(error, "host.properties");
  }
}

export const dynamic = "force-dynamic";
