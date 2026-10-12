import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";

/**
 * Yönetim kuyruklarında yönetici işlemi bekleyen kayıt sayıları (ADMIN, salt okunur; F642/F1066).
 * `claims`: açık ya da yükseltilmiş talepler; `support`: açık ya da işlemdeki destek talepleri;
 * `compliance`: alınmış DSA bildirimleri + bekleyen md. 20 itirazları + işlenmemiş kaldırma
 * talepleri.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const [claims, support, notices, appeals, takedowns] = await Promise.all([
      prisma.claim.count({ where: { status: { in: ["OPEN", "ESCALATED"] } } }),
      prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      prisma.notice.count({ where: { status: "RECEIVED" } }),
      prisma.noticeAppeal.count({ where: { status: "PENDING" } }),
      prisma.takedownRequest.count({ where: { status: "RECEIVED" } }),
    ]);
    return NextResponse.json({ claims, support, compliance: notices + appeals + takedowns });
  } catch (error) {
    return toErrorResponse(error, "admin.queueCounts");
  }
}

export const dynamic = "force-dynamic";
