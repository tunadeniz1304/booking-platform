import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { proposeFromText } from "@/lib/ai/event-extraction";
import { audit } from "@/lib/admin/audit";

/** Olay sinyali kuyruğu (ADMIN): liste ve metinden öneri. */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const events = await prisma.demandEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { location: { select: { city: true } } },
    });
    return NextResponse.json(events);
  } catch (error) {
    return toErrorResponse(error, "admin.events.list");
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole(req, ["ADMIN"]);
    const { text } = z
      .object({ text: z.string().trim().min(10).max(2000) })
      .parse(await req.json());
    const result = await proposeFromText(text, admin.userId);
    await audit(admin.userId, "event.propose", "DemandEvent", result.event.id, {
      llmMode: result.llmMode,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "admin.events.propose");
  }
}

export const dynamic = "force-dynamic";
