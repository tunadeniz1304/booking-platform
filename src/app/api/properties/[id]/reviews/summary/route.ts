import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http/errors";
import { summarizeReviews } from "@/lib/ai/review-summary";

/** Atıflı AI yorum özeti (llmMode: live | demo | fallback). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await summarizeReviews(id));
  } catch (error) {
    return toErrorResponse(error, "reviews.summary");
  }
}

export const dynamic = "force-dynamic";
