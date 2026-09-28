import { afterAll, beforeAll, expect, it } from "vitest";
import fc from "fast-check";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture } from "./fixtures";
import { redis } from "@/lib/redis";
import { resetConfigForTests } from "@/lib/config/app-config";
import { resetFxCacheForTests } from "@/lib/fx/store";
import { invalidateSearchCache, searchProperties } from "@/lib/search";
import { GET as quoteRoute } from "@/app/api/quote/route";
import { createBooking } from "@/lib/booking-service";
import { confirmPaymentChallenge, payForBooking } from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import type { Money } from "@/lib/money/money";
import { withSerializableRetry } from "@/lib/db/transactions";
import { post } from "@/lib/ledger";

/**
 * P0-7 "gösterilen = tahsil edilen = defter": rastgele ilan (fiyat, ülke/vergi), tarih, misafir,
 * promosyon (erken rezervasyon / son dakika / uzun konaklama; yüzde ya da sabit; ilana ya da
 * ev sahibine bağlı; birleşebilir), tahsilat para birimi (FX) ve cüzdan kredisi için:
 *
 *   arama kartı toplamı = /api/quote toplamı            (tesis para birimi)
 *   /api/quote tahsilat toplamı = rezervasyon toplamı   (tahsilat para birimi)
 *   PSP capture + kredi = tahsilat toplamı
 *   capture jurnali (BOOKING_CAPTURED, psp_clearing borcu) = PSP capture
 *
 * Kupon arama kartında bilinemez (misafir checkout'ta girer) → jeneratör dışı. Tekil
 * `/api/bookings/[id]/pay` yolu; sepet/bölünmüş ödemede kredi/kupon yok (ADR 0033 notu).
 */

/** Capture edilen tutarları kaydeden PSP (ağsız MockPsp). */
class RecordingPsp extends MockPsp {
  captured = new Map<string, number>();
  override async capture(providerRef?: string, amount?: Money) {
    if (providerRef && amount) this.captured.set(providerRef, amount.amount);
    return super.capture(providerRef, amount);
  }
}

const promotionArb = fc.record({
  type: fc.constantFrom("EARLY_BIRD" as const, "LAST_MINUTE" as const, "LONG_STAY" as const),
  threshold: fc.integer({ min: 0, max: 60 }),
  percent: fc.boolean(),
  discountBps: fc.integer({ min: 100, max: 4000 }),
  discountMinor: fc.integer({ min: 500, max: 40_000 }),
  propertyScoped: fc.boolean(),
  stackable: fc.boolean(),
  priority: fc.integer({ min: 0, max: 3 }),
});

const caseArb = fc.record({
  nightlyMajor: fc.integer({ min: 150, max: 3000 }),
  nightlyCents: fc.integer({ min: 0, max: 99 }),
  country: fc.constantFrom("TEST", "Türkiye"),
  startInDays: fc.integer({ min: 1, max: 90 }),
  nights: fc.integer({ min: 1, max: 4 }),
  guests: fc.integer({ min: 1, max: 2 }),
  promotions: fc.array(promotionArb, { maxLength: 2 }),
  chargeCurrency: fc.constantFrom("TRY", "USD", "EUR"),
  creditShare: fc.option(fc.integer({ min: 1, max: 90 }), { nil: null }),
});

describeInt("P0-7 gösterilen = tahsil edilen = defter (property, integration)", () => {
  const prisma = new PrismaClient();
  const psp = new RecordingPsp();
  const saved = { charge: process.env.FX_CHARGE_CURRENCIES, sources: process.env.FX_SOURCES };
  let seq = 0;

  beforeAll(() => {
    process.env.FX_CHARGE_CURRENCIES = "USD,EUR";
    process.env.FX_SOURCES = "none"; // ağ yok → statik kur tablosu
    resetConfigForTests();
    resetFxCacheForTests();
    setPaymentProviderForTests(psp);
  });

  afterAll(async () => {
    setPaymentProviderForTests(null);
    for (const [key, value] of [
      ["FX_CHARGE_CURRENCIES", saved.charge],
      ["FX_SOURCES", saved.sources],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfigForTests();
    resetFxCacheForTests();
    await prisma.$disconnect();
  });

  async function grantCredit(userId: string, amountMinor: number): Promise<void> {
    const ref = `p07:${Date.now()}:${++seq}`;
    await withSerializableRetry(async (tx) => {
      await post.creditIssued(tx, {
        creditRef: ref,
        guestId: userId,
        amountMinor: BigInt(amountMinor),
        fundedBy: "platform",
        currency: "TRY",
      });
      await tx.walletCredit.create({
        data: {
          userId,
          currency: "TRY",
          source: "CASHBACK",
          sourceRef: ref,
          amountMinor: BigInt(amountMinor),
          remainingMinor: BigInt(amountMinor),
          expiresAt: new Date(Date.now() + 365 * 86_400_000),
        },
      });
    });
  }

  it("≥200 rastgele örnekte kart = teklif = capture = jurnal (0 karşı örnek)", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const fx = await createStayFixture(prisma, {
          tag: "p07",
          nightlyPrice: c.nightlyMajor + c.nightlyCents / 100,
          country: c.country,
          days: 100,
        });
        for (const p of c.promotions) {
          await prisma.promotion.create({
            data: {
              hostId: fx.hostId,
              propertyId: p.propertyScoped ? fx.propertyId : null,
              name: `p07-${p.type}`,
              type: p.type,
              ...(p.percent
                ? { discountBps: p.discountBps }
                : { discountMinor: BigInt(p.discountMinor), currency: "TRY" }),
              ...(p.type === "EARLY_BIRD" ? { minDaysBefore: p.threshold } : {}),
              ...(p.type === "LAST_MINUTE" ? { maxDaysBefore: Math.max(1, p.threshold) } : {}),
              ...(p.type === "LONG_STAY" ? { minNights: 1 + (p.threshold % 4) } : {}),
              stackable: p.stackable,
              priority: p.priority,
            },
          });
        }
        await invalidateSearchCache();
        await redis.del("fraud:v:card:tok_mock_ok_4242", `fraud:v:user:${fx.userId}`);

        const checkIn = iso(utcDay(c.startInDays));
        const checkOut = iso(utcDay(c.startInDays + c.nights));
        const property = await prisma.property.findUniqueOrThrow({
          where: { id: fx.propertyId },
          select: { location: { select: { city: true } } },
        });

        // 1) Arama kartı (tesis para birimi, vergi + promosyon dahil).
        const search = await searchProperties({
          city: property.location.city,
          checkIn,
          checkOut,
          guests: c.guests,
        });
        const card = search.results.find((r) => r.id === fx.propertyId);
        expect(card?.quote, "arama kartında teklif yok").toBeDefined();
        const cardQuote = card!.quote!;

        // 2) /api/quote — kartın oda + planıyla, istenen tahsilat para birimiyle.
        const qs = new URLSearchParams({
          propertyId: fx.propertyId,
          roomId: cardQuote.roomId,
          ratePlanId: cardQuote.ratePlanId,
          checkIn,
          checkOut,
          guests: String(c.guests),
          currency: c.chargeCurrency,
        });
        const res = await quoteRoute(
          new NextRequest(`http://localhost/api/quote?${qs}`),
          undefined
        );
        expect(res.status).toBe(200);
        const quote = (await res.json()) as {
          quoteId: string;
          total: number;
          currency: string;
          charge: { currency: string; total: number };
        };
        expect(quote.currency).toBe(cardQuote.currency);
        expect(quote.total, "kart ≠ teklif").toBe(cardQuote.total);

        // 3) Rezervasyon teklifin tahsilat tutarıyla.
        const { booking } = await createBooking({
          userId: fx.userId,
          propertyId: fx.propertyId,
          roomId: cardQuote.roomId,
          ratePlanId: cardQuote.ratePlanId,
          checkIn,
          checkOut,
          guestCount: c.guests,
          quoteId: quote.quoteId,
          currency: c.chargeCurrency,
        });
        expect(booking.currency).toBe(quote.charge.currency);
        expect(booking.totalMinor, "teklif ≠ rezervasyon").toBe(quote.charge.total);

        // 4) Ödeme (kredi yalnız cüzdan para biriminde: TRY).
        const creditMinor =
          c.creditShare !== null && quote.charge.currency === "TRY"
            ? Math.floor((quote.charge.total * c.creditShare) / 100)
            : 0;
        if (creditMinor > 0) await grantCredit(fx.userId, creditMinor);
        let outcome = await payForBooking({
          bookingId: booking.id,
          userId: fx.userId,
          cardToken: "tok_mock_ok_4242",
          idempotencyKey: `p07-${booking.id}`,
          ...(creditMinor > 0 ? { creditMinor } : {}),
        });
        if (outcome.status === "requires_action") {
          outcome = await confirmPaymentChallenge({
            bookingId: booking.id,
            userId: fx.userId,
            code: MOCK_3DS_CODE,
          });
        }
        expect(outcome.status).toBe("confirmed");

        const payment = await prisma.payment.findUniqueOrThrow({
          where: { bookingId: booking.id },
          select: { id: true, providerRef: true, amountMinor: true, currency: true },
        });
        const captured = psp.captured.get(payment.providerRef ?? "");
        expect(captured, "PSP capture yok").toBeDefined();
        expect(captured! + creditMinor, "capture + kredi ≠ tahsilat").toBe(quote.charge.total);
        expect(Number(payment.amountMinor)).toBe(captured);

        // 5) Defter: tahsilat jurnalinin psp_clearing borcu = PSP capture.
        const lines = await prisma.journalLine.findMany({
          where: {
            entry: { kind: "BOOKING_CAPTURED", paymentId: payment.id },
            account: { kind: "PSP_CLEARING" },
            side: "DEBIT",
          },
          select: { amountMinor: true, currency: true },
        });
        const journal = lines.reduce((s, l) => s + Number(l.amountMinor), 0);
        expect(journal, "jurnal ≠ capture").toBe(captured);
        expect(lines.every((l) => l.currency === payment.currency)).toBe(true);
      }),
      { numRuns: 200 }
    );
  }, 900_000);
});
