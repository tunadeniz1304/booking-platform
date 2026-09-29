import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { audit } from "@/lib/admin/audit";
import { markAiGenerated, withAiSubject } from "@/lib/http/ai";
import { decideModeration, listModerationQueue } from "@/lib/reviews/moderation-queue";

/** Yorum moderasyon kuyruğu (ADMIN): filtreye takılan ve şikâyetle gizlenen yorumlar. */
const handleGet = observed("admin.reviews", async function getHandler(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const queue = await withAiSubject(req, () => listModerationQueue());
    // Dizi biçimi korunur; her öğe AI açıklaması taşıdığından öğe bazında işaretlenir (AI Act Md. 50).
    return NextResponse.json(queue.map((item) => markAiGenerated(item)));
  } catch (error) {
    return toErrorResponse(error, "admin.reviews");
  }
});

const bodySchema = z.object({
  id: z.string().min(1).max(64),
  action: z.enum(["publish", "remove"]),
});

const handlePost = observed("admin.reviews", async function postHandler(req: NextRequest) {
  try {
    const admin = await requireRole(req, ["ADMIN"]);
    const { id, action } = bodySchema.parse(await req.json());
    const result = await decideModeration(id, action);
    await audit(admin.userId, `review.${action}`, "Review", id);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error, "admin.reviews.decide");
  }
});

export async function GET(req: NextRequest) {
  return handleGet(req, undefined);
}

export async function POST(req: NextRequest) {
  return handlePost(req, undefined);
}

export const dynamic = "force-dynamic";
