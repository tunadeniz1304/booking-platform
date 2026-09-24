import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { replyToReview } from "@/lib/reviews/review-service";

const bodySchema = z.object({ text: z.string().trim().min(2).max(1000) });

/** Ev sahibi yanıtı (yalnızca kendi mülkünün yorumlarına). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId } = await requireRole(req, ["HOST", "ADMIN"]);
    const { text } = bodySchema.parse(await req.json());
    return NextResponse.json(await replyToReview({ hostId: userId, reviewId: id, text }));
  } catch (error) {
    return toErrorResponse(error, "reviews.reply");
  }
}

export const dynamic = "force-dynamic";
