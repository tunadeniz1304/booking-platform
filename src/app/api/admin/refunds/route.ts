import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { HttpError, NotFoundError, toErrorResponse } from "@/lib/http/errors";
import { REFUND_FAILED, retryFailedRefund } from "@/lib/payment/payment-service";
import { PaymentProviderError } from "@/lib/payment";
import { audit } from "@/lib/admin/audit";

/**
 * Başarısız iade kuyruğu (ADMIN, v4#7): `REFUND_FAILED` ödemeler. Otomatik `refund-retry`
 * denemeleri tükenenler burada kalır; POST ile anında yeniden denenir (aynı idempotency
 * anahtarı → PSP en fazla bir iade yapar).
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const failed = await prisma.payment.findMany({
      where: { failureCode: REFUND_FAILED },
      orderBy: { updatedAt: "asc" },
      take: 100,
      select: {
        bookingId: true,
        status: true,
        amount: true,
        refundedAmount: true,
        currency: true,
        provider: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({
      failed: failed.map((p) => ({
        ...p,
        amount: p.amount.toString(),
        refundedAmount: p.refundedAmount?.toString() ?? null,
      })),
    });
  } catch (error) {
    return toErrorResponse(error, "admin.refunds");
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole(req, ["ADMIN"]);
    const { bookingId } = z
      .object({ bookingId: z.string().min(1).max(64) })
      .parse(await req.json());
    let result;
    try {
      result = await retryFailedRefund(bookingId);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        throw new HttpError(502, "REFUND_RETRY_FAILED", "Ödeme sağlayıcısı iadeyi yine reddetti");
      }
      throw error;
    }
    if (result === "noop") throw new NotFoundError("Başarısız iade bulunamadı");
    await audit(admin.userId, "refund.retry", "Booking", bookingId, { result });
    return NextResponse.json({ retried: true, result });
  } catch (error) {
    return toErrorResponse(error, "admin.refunds.retry");
  }
}

export const dynamic = "force-dynamic";
