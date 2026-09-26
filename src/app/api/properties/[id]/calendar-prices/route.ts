import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NotFoundError, ValidationError, toErrorResponse } from "@/lib/http/errors";
import { getCalendarMonth } from "@/lib/pricing/price-calendar";

/**
 * Esnek tarih fiyat takvimi (v4 P1-3): `?month=YYYY-MM[&taxes=included|excluded]`.
 * Ay ızgarası — her gece için en ucuz 1 gecelik fiyat (minor-unit), ayın en ucuz gecesi
 * işareti, 0–4 fiyat bandı ve müsait olmayan günler. Varsayılan gösterim vergiler dahil
 * ("all-in"). Listelenemeyen/var olmayan ilan → 404 (varlık sızdırılmaz).
 */
const QuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Ay YYYY-AA biçiminde olmalı"),
  taxes: z.enum(["included", "excluded"]).default("included"),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = QuerySchema.safeParse({
      month: req.nextUrl.searchParams.get("month") ?? undefined,
      taxes: req.nextUrl.searchParams.get("taxes") ?? undefined,
    });
    if (!parsed.success) {
      throw new ValidationError("Geçersiz takvim parametreleri", parsed.error.flatten());
    }
    const month = await getCalendarMonth(id, parsed.data.month, parsed.data.taxes);
    if (!month) throw new NotFoundError("İlan bulunamadı");
    return NextResponse.json(month, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    return toErrorResponse(error, "properties.calendar_prices");
  }
}

export const dynamic = "force-dynamic";
