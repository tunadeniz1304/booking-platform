import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { negotiate, NegotiationInput } from "@/lib/negotiation/engine";
import { calculateDynamicPrice } from "@/lib/pricing/engine";

const negotiateSchema = z.object({
  propertyId: z.string().min(1),
  roomId: z.string().min(1),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guestCount: z.number().int().positive().max(10),
  requestedPrice: z.number().positive(),
  round: z.number().int().min(0).max(10).default(0),
  isFlexibleDates: z.boolean().default(false),
  maxRounds: z.number().int().min(1).max(6).default(3),
});

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Çok-etmenli pazarlık ucu. Kullanıcı teklif verir; sistem canlı occupancy ve
 * dinamik fiyata göre kabul/karşı-teklif/red üretir. Durum bilgisi istatistik
 * taşınmaz — her istek o anki gerçek durumdan hesap eder.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const body = await req.json();
    const parsed = negotiateSchema.parse(body);

    const checkIn = parseDate(parsed.checkIn);
    const checkOut = parseDate(parsed.checkOut);
    if (checkIn >= checkOut) {
      return NextResponse.json({ error: "Geçersiz tarih aralığı" }, { status: 400 });
    }
    const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
    const leadDays = Math.max(
      0,
      Math.round((checkIn.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    );

    const room = await prisma.room.findFirst({
      where: { id: parsed.roomId, propertyId: parsed.propertyId, available: true },
      include: { property: { select: { location: true } } },
    });
    if (!room) {
      return NextResponse.json({ error: "Oda bulunamadı veya uygun değil" }, { status: 404 });
    }

    // Doluluk: property odalarındaki gece başına dolu/toplam oranı
    const availability = await prisma.availability.groupBy({
      by: ["roomId", "isAvailable"],
      where: { room: { propertyId: parsed.propertyId }, date: { gte: checkIn, lt: checkOut } },
      _count: { _all: true },
    });
    const totalNights = availability.reduce((s, a) => s + a._count._all, 0);
    const blockedNights = availability
      .filter((a) => !a.isAvailable)
      .reduce((s, a) => s + a._count._all, 0);
    const occupancyRate = totalNights > 0 ? clamp(blockedNights / totalNights, 0, 1) : 0.3;

    const property = await prisma.property.findUnique({
      where: { id: parsed.propertyId },
      select: { basePrice: true, currency: true },
    });
    if (!property) {
      return NextResponse.json({ error: "Mülk bulunamadı" }, { status: 404 });
    }

    // Gece baz fiyatı: oda müsaitlik kaydındaki ilk gece fiyatı (yok: property base)
    const firstNight = await prisma.availability.findFirst({
      where: { roomId: room.id, date: { gte: checkIn, lt: checkOut } },
      orderBy: { date: "asc" },
      select: { price: true },
    });
    const basePrice = firstNight ? Number(firstNight.price) : Number(property.basePrice);

    // Canlı dinamik fiyat (gece başına, talep/occupancy ile)
    const perNight = await calculateDynamicPrice({
      propertyId: parsed.propertyId,
      roomId: room.id,
      date: parsed.checkIn,
      basePrice,
      occupancyRate,
      locationId: room.property.location.id,
    });
    const dynamicPerNight = perNight.price;

    const input: NegotiationInput = {
      basePrice,
      dynamicPrice: dynamicPerNight,
      demandSignal: perNight.factors.demandSignal ?? occupancyRate,
      requestedPrice: parsed.requestedPrice,
      round: parsed.round,
      maxRounds: parsed.maxRounds,
      isFlexibleDates: parsed.isFlexibleDates,
      leadDays,
      currency: property.currency ?? "TRY",
    };

    const result = negotiate(input);

    return NextResponse.json({
      ...result,
      nights,
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      currency: result.currency,
      estimatedTotal: Math.round(
        result.counterPrice !== null ? result.counterPrice * nights : result.currentPrice * nights
      ),
    });
  } catch (error) {
    return toErrorResponse(error, "negotiate");
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const dynamic = "force-dynamic";
