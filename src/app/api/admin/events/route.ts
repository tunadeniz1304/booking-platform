import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { proposeFromText } from "@/lib/ai/event-extraction";
import { audit } from "@/lib/admin/audit";
import { markAiGenerated, withAiSubject } from "@/lib/http/ai";

/** Olay sinyali kuyruğu (ADMIN): liste ve metinden öneri. */
const handleGet = observed("admin.events", async function getHandler(req: NextRequest) {
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
});

const handlePost = observed("admin.events", async function postHandler(req: NextRequest) {
  try {
    const admin = await requireRole(req, ["ADMIN"]);
    const { text } = z
      .object({ text: z.string().trim().min(10).max(2000) })
      .parse(await req.json());
    const result = await withAiSubject(req, () => proposeFromText(text, admin.userId));
    await audit(admin.userId, "event.propose", "DemandEvent", result.event.id, {
      llmMode: result.llmMode,
    });
    return NextResponse.json(markAiGenerated(result), { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "admin.events.propose");
  }
});

export async function GET(req: NextRequest) {
  return handleGet(req, undefined);
}

export async function POST(req: NextRequest) {
  return handlePost(req, undefined);
}

export const dynamic = "force-dynamic";
