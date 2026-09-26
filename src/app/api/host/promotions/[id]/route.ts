import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import {
  deletePromotion,
  updatePromotion,
  updatePromotionSchema,
} from "@/lib/pricing/promotion-service";

type Ctx = { params: Promise<{ id: string }> };

/** Host: promosyonu günceller (başkasınınki 404), P1-8. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const patch = updatePromotionSchema.parse(await req.json());
    return NextResponse.json({ promotion: await updatePromotion(actor, id, patch) });
  } catch (error) {
    return toErrorResponse(error, "host.promotions.update");
  }
}

/** Host: siler; kullanılmışsa pasifleştirir. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json(await deletePromotion(actor, id));
  } catch (error) {
    return toErrorResponse(error, "host.promotions.delete");
  }
}

export const dynamic = "force-dynamic";
