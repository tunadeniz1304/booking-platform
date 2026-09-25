import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { createPriceAlert, deletePriceAlert, listPriceAlerts } from "@/lib/pricing/price-alerts";
import { ValidationError, toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({
  roomId: z.string().min(1).max(64),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.coerce.number().int().min(1).max(20).default(1),
});

/** Kullanıcının aktif fiyat alarmları (`previousPriceMinor` = Omnibus "önceki fiyat"). */
export const GET = observed("price-alerts.list", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return NextResponse.json({ alerts: await listPriceAlerts(userId) });
  } catch (error) {
    return toErrorResponse(error, "price-alerts.list");
  }
});

/** Alarm kurar (aynı konaklama için tekrar → güncellenir). */
export const POST = observed("price-alerts.create", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = bodySchema.parse(await req.json());
    return NextResponse.json(await createPriceAlert({ userId, ...body }), { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "price-alerts.create");
  }
});

/** `?id=` ile alarmı kapatır (yalnızca kendi alarmı; başkasınınki 404). */
export const DELETE = observed(
  "price-alerts.delete",
  async function deleteHandler(req: NextRequest) {
    try {
      const { userId } = await requireAuth(req);
      const id = req.nextUrl.searchParams.get("id");
      if (!id || id.length > 64) throw new ValidationError("Alarm kimliği gerekli");
      await deletePriceAlert(userId, id);
      return NextResponse.json({ deleted: true });
    } catch (error) {
      return toErrorResponse(error, "price-alerts.delete");
    }
  }
);

export const dynamic = "force-dynamic";
