import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { reportReview } from "@/lib/reviews/review-service";

const bodySchema = z.object({
  reason: z.enum(["SPAM", "OFFENSIVE", "FAKE", "PRIVACY", "OTHER"]),
  note: z.string().trim().max(500).optional(),
});

/** Yorum şikâyeti: oturum açmış kullanıcı, yorum başına bir kez. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId } = await requireAuth(req);
    const body = bodySchema.parse(await req.json());
    return NextResponse.json(await reportReview({ reviewId: id, reporterId: userId, ...body }), {
      status: 201,
    });
  } catch (error) {
    return toErrorResponse(error, "reviews.report");
  }
}

export const dynamic = "force-dynamic";
