import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/http/errors";
import { compareListings } from "@/lib/ai/listing-compare";
import { markAiGenerated, withAiSubject } from "@/lib/http/ai";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({
  ids: z
    .string()
    .max(400)
    .transform((s) =>
      s
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    )
    .pipe(z.array(z.string().min(1).max(64)).min(1).max(10)),
  checkIn: isoDate.optional(),
  checkOut: isoDate.optional(),
  guests: z.coerce.number().int().min(1).max(20).default(2),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((c) => c.toUpperCase())
    .optional(),
  locale: z.string().max(5).optional(),
});

/**
 * İlan karşılaştırma (v4 P1-9): `?ids=a,b[,c,d]&checkIn&checkOut&guests`. Yapılandırılmış
 * fark + teklif motoru toplamları deterministik; `commentary` AI üretimidir (`ai_generated`).
 */
export async function GET(req: NextRequest) {
  try {
    const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const locale = resolveLocale(q.locale ?? req.cookies.get(LOCALE_COOKIE)?.value);
    const result = await withAiSubject(req, () =>
      compareListings({
        ids: q.ids,
        checkIn: q.checkIn,
        checkOut: q.checkOut,
        guests: q.guests,
        currency: q.currency,
        locale,
      })
    );
    return NextResponse.json(markAiGenerated(result));
  } catch (error) {
    return toErrorResponse(error, "compare");
  }
}

export const dynamic = "force-dynamic";
