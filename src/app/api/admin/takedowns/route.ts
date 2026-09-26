import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { listTakedowns, receiveTakedown, takedownInputSchema } from "@/lib/compliance/takedown";

/**
 * 7565 kaldırma talepleri (ADMIN, P1-13a). GET: liste (`?status=`); POST: yeni talep —
 * ilan aynı işlemde pasife alınır, SLA (`TAKEDOWN_SLA_HOURS`) kontrol işi planlanır.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const status = z
      .enum(["RECEIVED", "ACTIONED", "CLOSED"])
      .optional()
      .parse(req.nextUrl.searchParams.get("status") ?? undefined);
    return NextResponse.json({ takedowns: await listTakedowns({ status }) });
  } catch (error) {
    return toErrorResponse(error, "admin.takedowns");
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole(req, ["ADMIN"]);
    const input = takedownInputSchema.parse(await req.json());
    const takedown = await receiveTakedown(input, admin.userId);
    return NextResponse.json({ takedown }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "admin.takedowns");
  }
}
