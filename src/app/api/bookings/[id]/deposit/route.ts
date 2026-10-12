import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { NotFoundError, toErrorResponse } from "@/lib/http/errors";
import { lostChargebackMinor } from "@/lib/payment/refundable";
import { prisma } from "@/lib/prisma";
import { depositAmountFor, toDepositView } from "@/lib/resolution/deposit";

/**
 * Kalan iade edilebilir tutar: tahsilat − iadeler − kaybedilen itirazlar
 * (`resolution/claims.ts` içindeki `refundableMinor` ile aynı kural).
 */
async function refundableMinorOf(b: {
  id: string;
  payment: { status: string; amountMinor: bigint; refundedAmountMinor: bigint } | null;
}): Promise<bigint> {
  const p = b.payment;
  if (!p || !["PAID", "PARTIALLY_REFUNDED"].includes(p.status)) return 0n;
  const rest = p.amountMinor - p.refundedAmountMinor - (await lostChargebackMinor(prisma, b.id));
  return rest > 0n ? rest : 0n;
}

/**
 * Rezervasyonun hasar depozitosu (misafir / ev sahibi / yönetici). Kayıt henüz açılmadıysa
 * ilan ayarından beklenen tutar döner (`expectedMinor`).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireAuth(req);
    const booking = await prisma.booking.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        propertyId: true,
        roomId: true,
        units: true,
        currency: true,
        property: { select: { hostId: true } },
        payment: { select: { status: true, amountMinor: true, refundedAmountMinor: true } },
      },
    });
    if (
      !booking ||
      (actor.role !== "ADMIN" &&
        booking.userId !== actor.userId &&
        booking.property.hostId !== actor.userId)
    ) {
      throw new NotFoundError("Rezervasyon bulunamadı");
    }
    const deposit = await prisma.damageDeposit.findUnique({ where: { bookingId: id } });
    const expected = deposit ? null : await depositAmountFor(prisma, booking);
    const isGuest = booking.userId === actor.userId;
    return NextResponse.json({
      deposit: deposit ? toDepositView(deposit) : null,
      expectedMinor: expected === null ? null : Number(expected),
      // Misafirin iade talebi formu için üst sınır (F599); ev sahibi/yöneticiye null.
      refundableMinor: isGuest ? Number(await refundableMinorOf(booking)) : null,
      currency: booking.currency,
      role: isGuest ? "GUEST" : booking.property.hostId === actor.userId ? "HOST" : "ADMIN",
    });
  } catch (error) {
    return toErrorResponse(error, "bookings.deposit");
  }
}

export const dynamic = "force-dynamic";
