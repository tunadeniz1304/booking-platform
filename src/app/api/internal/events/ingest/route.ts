import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ingestExternalSignal } from "@/lib/sentiment/trigger";
import { authorizeInternalRequest } from "@/lib/security/internal-auth";
import { HttpError, toErrorResponse } from "@/lib/http/errors";

/**
 * İç servis: dış olay sinyalini alır. `x-internal-secret` (≥32 karakter,
 * timing-safe) veya ADMIN JWT ile korunur. İç hata mesajları istemciye dönmez.
 */
const signalSchema = z.object({
  title: z.string().min(3).max(200),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impact: z.number().int().min(1).max(10),
  source: z.string().min(2).max(40),
  confidence: z.number().min(0).max(1).optional(),
  hedgeLastN: z.number().int().min(0).max(5).default(1),
});

export async function POST(req: NextRequest) {
  try {
    await authorizeInternalRequest(req);
    const parsed = signalSchema.parse(await req.json());
    try {
      return NextResponse.json(await ingestExternalSignal(parsed));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // İş kuralı ihlalleri (lokasyon yok, geçersiz aralık): genel mesaj, ayrıntı logda.
      throw new HttpError(422, "SIGNAL_REJECTED", "Sinyal işlenemedi");
    }
  } catch (error) {
    return toErrorResponse(error, "internal.events.ingest");
  }
}

export const dynamic = "force-dynamic";
