import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { audit } from "@/lib/admin/audit";
import { decideModeration, listModerationQueue } from "@/lib/reviews/moderation-queue";

/** Yorum moderasyon kuyruğu (ADMIN): filtreye takılan ve şikâyetle gizlenen yorumlar. */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    return NextResponse.json(await listModerationQueue());
  } catch (error) {
    return toErrorResponse(error, "admin.reviews");
  }
}

const bodySchema = z.object({
  id: z.string().min(1).max(64),
  action: z.enum(["publish", "remove"]),
});

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole(req, ["ADMIN"]);
    const { id, action } = bodySchema.parse(await req.json());
    const result = await decideModeration(id, action);
    await audit(admin.userId, `review.${action}`, "Review", id);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error, "admin.reviews.decide");
  }
}

export const dynamic = "force-dynamic";
