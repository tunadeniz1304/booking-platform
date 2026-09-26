import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { createReview, listReviews } from "@/lib/reviews/review-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    return NextResponse.json(await listReviews(id));
  } catch (error) {
    return toErrorResponse(error, "reviews.list");
  }
}

const bodySchema = z.object({
  bookingId: z.string().min(1).max(64),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
  subScores: z
    .object({
      cleanliness: z.number().int().min(1).max(5).optional(),
      location: z.number().int().min(1).max(5).optional(),
      staff: z.number().int().min(1).max(5).optional(),
      value: z.number().int().min(1).max(5).optional(),
    })
    .optional(),
});

/** Yalnızca konaklamasını tamamlamış misafir (booking başına 1). */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await params;
    const { userId } = await requireVerifiedEmail(req);
    const body = bodySchema.parse(await req.json());
    return NextResponse.json(await createReview({ userId, ...body }), { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "reviews.create");
  }
}

export const dynamic = "force-dynamic";
