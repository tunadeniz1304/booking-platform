import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { NotFoundError, toErrorResponse } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { depositAmountFor, toDepositView } from "@/lib/resolution/deposit";

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
    return NextResponse.json({
      deposit: deposit ? toDepositView(deposit) : null,
      expectedMinor: expected === null ? null : Number(expected),
      currency: booking.currency,
      role:
        booking.userId === actor.userId
          ? "GUEST"
          : booking.property.hostId === actor.userId
            ? "HOST"
            : "ADMIN",
    });
  } catch (error) {
    return toErrorResponse(error, "bookings.deposit");
  }
}

export const dynamic = "force-dynamic";
