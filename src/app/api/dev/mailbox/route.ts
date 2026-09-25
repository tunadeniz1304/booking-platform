import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { NotFoundError, toErrorResponse } from "@/lib/http/errors";
import { isDemoMode } from "@/lib/config/demo";

/**
 * Dev mailbox: SMTP yapılandırılmadığında gönderilen e-postalar burada görünür.
 * Kullanıcı yalnızca kendi e-postalarını, ADMIN tümünü görür. Demo modu dışında
 * uç yoktur (404, v3#11).
 */
export async function GET(req: NextRequest) {
  try {
    if (!isDemoMode()) throw new NotFoundError();
    const claims = await requireAuth(req);
    const rows = await prisma.notification.findMany({
      where: claims.role === "ADMIN" ? {} : { userId: claims.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        to: true,
        subject: true,
        text: true,
        status: true,
        transport: true,
        createdAt: true,
      },
    });
    return NextResponse.json(rows);
  } catch (error) {
    return toErrorResponse(error, "dev.mailbox");
  }
}

export const dynamic = "force-dynamic";
