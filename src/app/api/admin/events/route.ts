import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { proposeFromText } from "@/lib/ai/event-extraction";
import { audit } from "@/lib/admin/audit";
import { markAiGenerated, withAiSubject } from "@/lib/http/ai";

const listQuerySchema = z.object({
  status: z.enum(["PROPOSED", "APPROVED", "REJECTED", "ROLLED_BACK"]).optional(),
  cursor: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Olay sinyali kuyruğu (ADMIN): liste ve metinden öneri. Parametresiz GET eskisi gibi en yeni 100
 * olayı döndürür. `?status=` verilirse yalnız o durumdakiler başlangıç tarihine göre (artan) gelir;
 * `?limit=&cursor=` ile sayfalanır (F464). Gövde DİZİ kalır; sonraki sayfa `X-Next-Cursor` başlığı
 * ve `Link: <…?cursor=…>; rel="next"` ile bildirilir.
 */
const handleGet = observed("admin.events", async function getHandler(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const url = new URL(req.url);
    const query = listQuerySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const include = { location: { select: { city: true } } } as const;
    if (!query.status && !query.cursor && !query.limit) {
      const events = await prisma.demandEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include,
      });
      return NextResponse.json(events);
    }
    const limit = query.limit ?? 100;
    const rows = await prisma.demandEvent.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: query.status
        ? [{ startsAt: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: limit + 1,
      include,
    });
    const events = rows.slice(0, limit);
    const res = NextResponse.json(events);
    if (rows.length > limit) {
      const nextCursor = events[events.length - 1].id;
      const next = new URL(url);
      next.searchParams.set("cursor", nextCursor);
      res.headers.set("X-Next-Cursor", nextCursor);
      res.headers.set("Link", `<${next.pathname}${next.search}>; rel="next"`);
    }
    return res;
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
