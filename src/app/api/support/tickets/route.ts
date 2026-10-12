import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const MY_TICKET_LIMIT = 5;

/**
 * Misafirin kendi destek talepleri (en yeniden eskiye): insana devredilen konunun durumu
 * sohbet sayfasından izlenir. Yalnız oturumdaki kullanıcının kayıtları; salt-okur.
 */
export const GET = observed("support.tickets", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const tickets = await prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: MY_TICKET_LIMIT,
      select: {
        id: true,
        bookingId: true,
        status: true,
        reason: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
      },
    });
    return NextResponse.json({ tickets });
  } catch (error) {
    return toErrorResponse(error, "support.tickets");
  }
});

export const dynamic = "force-dynamic";
