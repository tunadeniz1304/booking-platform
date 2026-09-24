import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { NotFoundError, toErrorResponse } from "@/lib/http/errors";
import { requeueDeadMessage } from "@/lib/cqrs/outbox";
import { audit } from "@/lib/admin/audit";

/** Outbox durumu (ADMIN): durum sayıları + DEAD mesajlar; POST ile yeniden kuyruğa al. */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const [counts, dead] = await Promise.all([
      prisma.outboxMessage.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.outboxMessage.findMany({
        where: { status: "DEAD" },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          eventType: true,
          aggregateId: true,
          attempts: true,
          lastError: true,
          createdAt: true,
        },
      }),
    ]);
    return NextResponse.json({
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      dead,
    });
  } catch (error) {
    return toErrorResponse(error, "admin.outbox");
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole(req, ["ADMIN"]);
    const { id } = z.object({ id: z.string().min(1) }).parse(await req.json());
    if (!(await requeueDeadMessage(id))) throw new NotFoundError("DEAD mesaj bulunamadı");
    await audit(admin.userId, "outbox.requeue", "OutboxMessage", id);
    return NextResponse.json({ requeued: true });
  } catch (error) {
    return toErrorResponse(error, "admin.outbox.requeue");
  }
}

export const dynamic = "force-dynamic";
