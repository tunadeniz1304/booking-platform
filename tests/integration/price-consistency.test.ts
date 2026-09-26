import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { resetConfigForTests } from "@/lib/config/app-config";
import { createQuote } from "@/lib/pricing/quote";
import { createBooking } from "@/lib/booking-service";
import { payForBooking } from "@/lib/payment/payment-service";
import { searchProperties } from "@/lib/search";

/**
 * F3 fiyat tutarlılığı (P0-4): gerçek TR kuralları (KDV %10 dahil, konaklama vergisi
 * tarih aralıklı %1) + hizmet bedeli %5 ile arama kartı = teklif (PDP) = rezervasyon =
 * tahsil edilen tutar. Satır kalemleri sabit beklentiyle (snapshot) doğrulanır.
 */
describeInt("fiyat tutarlılığı — vergi/ücret motoru (integration)", () => {
  const prisma = new PrismaClient();
  let stay: StayFixture;
  let city = "";
  const saved = { rules: process.env.TAX_RULES_JSON, fee: process.env.SERVICE_FEE_BPS };
  // 2026-09-25 + 40 gün → Kasım 2026: konaklama vergisi %1 aralığında.
  const checkIn = iso(utcDay(40));
  const checkOut = iso(utcDay(42));

  beforeAll(async () => {
    process.env.TAX_RULES_JSON = ""; // varsayılan data/tax-rules.json
    process.env.SERVICE_FEE_BPS = "500";
    resetConfigForTests();
    stay = await createStayFixture(prisma, {
      tag: "price",
      nightlyPrice: 1100,
      country: "Türkiye",
    });
    const property = await prisma.property.findUniqueOrThrow({
      where: { id: stay.propertyId },
      select: { location: { select: { city: true } } },
    });
    city = property.location.city;
  });

  afterAll(async () => {
    process.env.TAX_RULES_JSON = saved.rules;
    if (saved.fee === undefined) delete process.env.SERVICE_FEE_BPS;
    else process.env.SERVICE_FEE_BPS = saved.fee;
    resetConfigForTests();
    await prisma.$disconnect();
  });

  it("regression: v3#9 kart = PDP = checkout = tahsilat, kalemler sabit", async () => {
    // Kart en ucuz planı (ratePlanId) gösterir; PDP/checkout aynı planla fiyatlar.
    const search = await searchProperties({ city, checkIn, checkOut, guests: 2 });
    const card = search.results.find((r) => r.id === stay.propertyId)!;
    const standard = await createQuote({
      propertyId: stay.propertyId,
      roomId: stay.roomId,
      checkIn,
      checkOut,
      guests: 2,
    });
    expect(standard.total).toBe(233_000); // STANDARD: 2 × 1100 TL + %1 + %5
    const ratePlanId = card.quote!.ratePlanId;
    const quote = await createQuote({
      propertyId: stay.propertyId,
      roomId: stay.roomId,
      checkIn,
      checkOut,
      guests: 2,
      ratePlanId,
    });
    // NONREF (−%10): 2 × 990 TL brüt; KDV 90 TL/gece dahil; konaklama %1 × 900 TL net;
    // hizmet %5 × brüt.
    expect({
      subtotal: quote.subtotal,
      taxes: quote.taxes,
      fees: quote.fees,
      total: quote.total,
    }).toEqual({
      subtotal: 198_000,
      taxes: [
        { code: "VAT", kind: "VAT", label: "KDV", rateBps: 1000, amount: 18_000, inclusive: true },
        {
          code: "ACCOMMODATION_TAX",
          kind: "ACCOMMODATION",
          label: "Konaklama vergisi",
          rateBps: 100,
          amount: 1_800,
          inclusive: false,
        },
      ],
      fees: [
        {
          code: "SERVICE_FEE",
          kind: "SERVICE_FEE",
          label: "Hizmet bedeli",
          rateBps: 500,
          amount: 9_900,
          inclusive: false,
        },
      ],
      total: 209_700,
    });
    expect(card.quote!.total).toBe(quote.total);

    const { booking } = await createBooking({
      userId: stay.userId,
      propertyId: stay.propertyId,
      roomId: stay.roomId,
      checkIn,
      checkOut,
      guestCount: 2,
      ratePlanId,
    });
    expect(booking.totalMinor).toBe(quote.total);

    const paid = await payForBooking({
      bookingId: booking.id,
      userId: stay.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `price-${booking.id}`,
    });
    expect(paid.status).toBe("confirmed");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(Number(payment.amountMinor)).toBe(quote.total);
  });

  it("TR dışı ülke: vergi satırı yok, toplam = ara toplam", async () => {
    const abroad = await createStayFixture(prisma, {
      tag: "price-abroad",
      nightlyPrice: 1100,
      country: "Yunanistan",
    });
    process.env.SERVICE_FEE_BPS = "0";
    resetConfigForTests();
    const q = await createQuote({
      propertyId: abroad.propertyId,
      roomId: abroad.roomId,
      checkIn,
      checkOut,
      guests: 1,
    });
    expect(q.taxes).toEqual([]);
    expect(q.fees).toEqual([]);
    expect(q.total).toBe(q.subtotal);
    process.env.SERVICE_FEE_BPS = "500";
    resetConfigForTests();
  });
});
