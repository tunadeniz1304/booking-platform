import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http/errors";
import { summarizeReviews } from "@/lib/ai/review-summary";
import { markAiGenerated, withAiSubject } from "@/lib/http/ai";

/**
 * Atıflı AI yorum özeti (llmMode: live | demo | fallback). Rate-limit kategorisi `ai`
 * (v3 §3-b; proxy `categorize`), bütçe öznesi istek sahibi.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(markAiGenerated(await withAiSubject(req, () => summarizeReviews(id))));
  } catch (error) {
    return toErrorResponse(error, "reviews.summary");
  }
}

export const dynamic = "force-dynamic";
