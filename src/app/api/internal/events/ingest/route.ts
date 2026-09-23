import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ingestExternalSignal } from "@/lib/sentiment/trigger";

/**
 * İç servis: dış duyuru/haber sinyalini alır ve bölge fiyatlarını anında
 * optimize edip stok hedge eder (Global Sentiment & Event Trigger).
 * INTERNAL_API_SECRET ile korunur; orkestrasyon (Twitter/news poller) bu uca
 * POST atar, worker asenkron işleme için BullMQ kuyruğu da kullanabilir.
 */
const signalSchema = z.object({
  title: z.string().min(3),
  city: z.string().optional(),
  country: z.string().optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impact: z.number().int().min(1).max(10),
  source: z.string().min(2).max(40),
  confidence: z.number().min(0).max(1).optional(),
  hedgeLastN: z.number().int().min(0).max(5).default(1),
});

export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-internal-secret");
  const secret = process.env.INTERNAL_API_SECRET || "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = signalSchema.parse(body);
    const result = await ingestExternalSignal(parsed);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: error.errors }, { status: 400 });
    }
    const message = (error as Error)?.message ?? "Internal server error";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export const dynamic = "force-dynamic";
