import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { channelFromHeaders } from "@/lib/pricing/promotions";
import { validateCoupon, validateCouponSchema } from "@/lib/pricing/promotion-service";

/**
 * P1-8 kupon doğrulama: kuponu teklif motoruyla dener, sonucu ve gerekçe kodunu döner.
 * Kod tahminini zorlaştırmak için oturum ister ve `booking` hız sınırı kovasındadır.
 * Kullanımı SAYMAZ — sayım rezervasyon anında atomik yapılır.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const input = validateCouponSchema.parse(await req.json());
    return NextResponse.json(await validateCoupon(input, channelFromHeaders(req.headers)));
  } catch (error) {
    return toErrorResponse(error, "coupons.validate");
  }
}

export const dynamic = "force-dynamic";
