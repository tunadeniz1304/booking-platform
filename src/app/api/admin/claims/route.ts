import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { listClaims } from "@/lib/resolution/claims";

const statusSchema = z
  .enum([
    "OPEN",
    "AWAITING_RESPONSE",
    "ESCALATED",
    "RESOLVED_APPROVED",
    "RESOLVED_PARTIAL",
    "RESOLVED_REJECTED",
    "CLOSED",
  ])
  .optional();

/** Yönetici: tüm talepler (`?status=` süzgeci). */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["ADMIN"]);
    const parsed = statusSchema.safeParse(req.nextUrl.searchParams.get("status") ?? undefined);
    if (!parsed.success) throw new ValidationError("Geçersiz durum");
    const claims = await listClaims(actor, { all: true, status: parsed.data });
    return NextResponse.json({ claims });
  } catch (error) {
    return toErrorResponse(error, "admin.claims.list");
  }
}

export const dynamic = "force-dynamic";
