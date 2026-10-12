import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
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

/** Durum başına toplam talep sayısı (süzgeçten bağımsız). */
async function countByStatus(): Promise<Record<string, number>> {
  const grouped = await prisma.claim.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
}

/**
 * Yönetici: tüm talepler (`?status=` süzgeci). `counts`: durum başına toplam talep sayısı;
 * süzgeçten bağımsızdır, filtre seçeneklerinde gösterilir (F656).
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["ADMIN"]);
    const parsed = statusSchema.safeParse(req.nextUrl.searchParams.get("status") ?? undefined);
    if (!parsed.success) throw new ValidationError("Geçersiz durum");
    const [claims, counts] = await Promise.all([
      listClaims(actor, { all: true, status: parsed.data }),
      countByStatus(),
    ]);
    return NextResponse.json({ claims, counts });
  } catch (error) {
    return toErrorResponse(error, "admin.claims.list");
  }
}

export const dynamic = "force-dynamic";
