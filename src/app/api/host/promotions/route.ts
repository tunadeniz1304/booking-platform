import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import {
  createPromotion,
  createPromotionSchema,
  listHostPromotions,
} from "@/lib/pricing/promotion-service";

/** Host: kendi promosyonları (ADMIN: tümü), P1-8. */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json({ promotions: await listHostPromotions(actor) });
  } catch (error) {
    return toErrorResponse(error, "host.promotions.list");
  }
}

/** Host: promosyon oluşturur (ilan verilirse sahiplik kontrolü; yoksa tüm ilanları). */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const input = createPromotionSchema.parse(await req.json());
    return NextResponse.json({ promotion: await createPromotion(actor, input) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "host.promotions.create");
  }
}

export const dynamic = "force-dynamic";
