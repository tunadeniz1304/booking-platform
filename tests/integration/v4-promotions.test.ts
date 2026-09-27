// P1-8: promosyon motoru + Omnibus "son 30 gün en düşük fiyat" (gerçek DB).
import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken, type Role } from "@/lib/auth/tokens";
import { computeTotal, createQuote } from "@/lib/pricing/quote";
import { createBooking, releaseHold } from "@/lib/booking-service";
import {
  confirmPaymentChallenge,
  handleWebhookEvent,
  payForBooking,
} from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { isTrialBalanced, reconcile, taxShareMinor, trialBalance } from "@/lib/ledger";
import * as promotionsRoute from "@/app/api/host/promotions/route";
import * as promotionRoute from "@/app/api/host/promotions/[id]/route";
import * as couponRoute from "@/app/api/coupons/validate/route";
import { GET as quoteGet } from "@/app/api/quote/route";

const ctx = <T>(params: T) => ({ params: Promise.resolve(params) });

async function tokenFor(userId: string, role: Role): Promise<string> {
  return (await signAccessToken(userId, role, 300, 0, Math.floor(Date.now() / 1000))).token;
}

function req(method: string, url: string, token?: string, body?: unknown, ua?: string) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(ua ? { "user-agent": ua } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describeInt("P1-8 promosyon motoru + Omnibus (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let other: StayFixture;
  let hostToken = "";

  /** Aynı ilanda ek oda tipi (kupon yarışı gerçekten paralel işlemlerle koşsun diye). */
  async function extraRoom(propertyId: string): Promise<string> {
    const room = await prisma.roomType.create({
      data: {
        propertyId,
        name: "Ek oda",
        maxOccupancy: 2,
        units: 1,
        bedType: "Çift",
        ratePlans: { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] },
      },
    });
    await prisma.inventoryDay.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        roomTypeId: room.id,
        date: utcDay(i + 1),
        priceMinor: 100_000n,
        total: 1,
      })),
    });
    return room.id;
  }

  async function createPromo(body: Record<string, unknown>, token = hostToken) {
    const res = await promotionsRoute.POST(req("POST", "/api/host/promotions", token, body));
    return { status: res.status, body: await res.json() };
  }

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "p1-8-promo", country: "Türkiye", days: 60 });
    other = await createStayFixture(prisma, { tag: "p1-8-other", country: "Türkiye", days: 60 });
    hostToken = await tokenFor(fx.hostId, "HOST");
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("host CRUD: doğrulama 400, sahiplik 404, kupon kodu tekil 409, kullanılmış silinmez", async () => {
    // Tür alanı eksik → 400; sabit indirimde ilan para birimi dışı → 400.
    expect((await createPromo({ name: "EB", type: "EARLY_BIRD", discountBps: 500 })).status).toBe(
      400
    );
    expect(
      (
        await createPromo({
          name: "Sabit",
          type: "LONG_STAY",
          minNights: 2,
          discountMinor: 1000,
          currency: "EUR",
          propertyId: fx.propertyId,
        })
      ).status
    ).toBe(400);
    // Başka ev sahibinin ilanına promosyon → 404.
    expect(
      (
        await createPromo({
          name: "Yabancı",
          type: "LONG_STAY",
          minNights: 2,
          discountBps: 500,
          propertyId: other.propertyId,
        })
      ).status
    ).toBe(404);

    const created = await createPromo({
      name: "Taslak",
      type: "COUPON",
      couponCode: "taslak-01",
      discountBps: 100,
      active: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.promotion.couponCode).toBe("TASLAK-01");
    expect(
      (
        await createPromo({
          name: "Kopya",
          type: "COUPON",
          couponCode: "TASLAK-01",
          discountBps: 1,
        })
      ).status
    ).toBe(409);

    const id = created.body.promotion.id as string;
    const otherToken = await tokenFor(other.hostId, "HOST");
    const foreign = await promotionRoute.PATCH(
      req("PATCH", `/api/host/promotions/${id}`, otherToken, { priority: 9 }),
      ctx({ id })
    );
    expect(foreign.status).toBe(404);
    const patched = await promotionRoute.PATCH(
      req("PATCH", `/api/host/promotions/${id}`, hostToken, { priority: 3, discountBps: 200 }),
      ctx({ id })
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).promotion).toMatchObject({ priority: 3, discountBps: 200 });
    // Birleştirilmiş kayıt yeniden doğrulanır: iki indirim biçimi birden → 400.
    const bad = await promotionRoute.PATCH(
      req("PATCH", `/api/host/promotions/${id}`, hostToken, {
        discountMinor: 500,
        currency: "TRY",
      }),
      ctx({ id })
    );
    expect(bad.status).toBe(400);

    const list = await promotionsRoute.GET(req("GET", "/api/host/promotions", hostToken));
    expect((await list.json()).promotions.map((p: { id: string }) => p.id)).toContain(id);
    const del = await promotionRoute.DELETE(
      req("DELETE", `/api/host/promotions/${id}`, hostToken),
      ctx({ id })
    );
    expect(await del.json()).toEqual({ deleted: true, deactivated: false });
  });

  it("çakışan promosyonlar teklifte satır kalemi; rezervasyon = teklif; indirimli ödeme defterde dengede", async () => {
    const eb = await createPromo({
      name: "Erken rezervasyon",
      type: "EARLY_BIRD",
      minDaysBefore: 2,
      discountBps: 1000,
      priority: 1,
      stackable: true,
      stackGroup: "sezon",
    });
    const ls = await createPromo({
      name: "Uzun konaklama",
      type: "LONG_STAY",
      minNights: 3,
      discountMinor: 5_000,
      currency: "TRY",
      propertyId: fx.propertyId,
      stackable: true,
    });
    const weaker = await createPromo({
      name: "Aynı grup, zayıf",
      type: "EARLY_BIRD",
      minDaysBefore: 1,
      discountBps: 500,
      priority: 1,
      stackable: true,
      stackGroup: "sezon",
    });
    const mobile = await createPromo({
      name: "Mobil",
      type: "MOBILE_RATE",
      discountBps: 300,
      stackable: true,
    });
    expect([eb.status, ls.status, weaker.status, mobile.status]).toEqual([201, 201, 201, 201]);

    const stay = { checkIn: iso(utcDay(20)), checkOut: iso(utcDay(23)) };
    const quote = await createQuote({ roomId: fx.roomId, ...stay, guests: 1 });
    expect(quote.discounts!.map((d) => [d.name, d.amount])).toEqual([
      ["Erken rezervasyon", 30_000],
      ["Uzun konaklama", 5_000],
    ]);
    const reasons = Object.fromEntries(quote.promotionDecisions!.map((d) => [d.name, d.reason]));
    expect(reasons).toMatchObject({ "Aynı grup, zayıf": "STACK_GROUP_TAKEN", Mobil: "NOT_MOBILE" });
    const addOn =
      quote.fees.filter((f) => !f.inclusive).reduce((s, f) => s + f.amount, 0) +
      quote.taxes.filter((t) => !t.inclusive).reduce((s, t) => s + t.amount, 0);
    expect(quote.total).toBe(quote.subtotal - quote.discountTotal! + addOn);

    // HTTP: mobil UA → mobil promosyon da eklenir; Omnibus alanı yanıtta.
    const res = await quoteGet(
      req(
        "GET",
        `/api/quote?roomId=${fx.roomId}&checkIn=${stay.checkIn}&checkOut=${stay.checkOut}`,
        undefined,
        undefined,
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"
      ),
      ctx({})
    );
    const mobileQuote = await res.json();
    expect(mobileQuote.channel).toBe("mobile");
    expect(mobileQuote.discounts.map((d: { name: string }) => d.name)).toContain("Mobil");
    expect(mobileQuote.lowestPrice30dMinor).toBeTypeOf("number");

    // Rezervasyon teklifle birebir (PRICE_CHANGED yok), kırılım promosyon satırlarını taşır.
    const { booking } = await createBooking({
      userId: fx.userId,
      propertyId: fx.propertyId,
      roomId: fx.roomId,
      ...stay,
      guestCount: 1,
      quoteId: quote.quoteId,
    });
    expect(booking.totalMinor).toBe(quote.total);
    expect(booking.priceBreakdown?.discountTotal).toBe(35_000);

    // Ödeme → capture jurnali: escrow + vergi = indirimli tahsilat; mizan dengede, mutabakat 0.
    let out = await payForBooking({
      bookingId: booking.id,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `p18-${Date.now()}`,
    });
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({
        bookingId: booking.id,
        userId: fx.userId,
        code: MOCK_3DS_CODE,
      });
    }
    expect(out.status).toBe("confirmed");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(Number(payment.amountMinor)).toBe(quote.total);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const tax = taxShareMinor(row.priceBreakdown, payment.amountMinor);
    const lines = await prisma.journalLine.findMany({
      where: { entry: { bookingId: booking.id } },
      select: { side: true, amountMinor: true, account: { select: { kind: true } } },
    });
    const credit = (kind: string) =>
      lines
        .filter((l) => l.account.kind === kind && l.side === "CREDIT")
        .reduce((s, l) => s + l.amountMinor, 0n);
    expect(credit("ESCROW") + credit("TAX_PAYABLE")).toBe(payment.amountMinor);
    expect(credit("TAX_PAYABLE")).toBe(tax);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    const report = await reconcile(payment.paidAt!.toISOString().slice(0, 10), prisma);
    expect(report.imbalancedEntries).toBe(0);
    expect(report.differences.filter((d) => d.subjectId === payment.id)).toEqual([]);

    // Sonraki testleri etkilemesin.
    await prisma.promotion.updateMany({ where: { hostId: fx.hostId }, data: { active: false } });
  });

  it("kupon limit yarışı: limit 2, 6 eşzamanlı rezervasyon → tam 2 başarılı, aşım yok", async () => {
    const coupon = await createPromo({
      name: "Yarış kuponu",
      type: "COUPON",
      couponCode: "YARIS2",
      discountBps: 2000,
      usageLimit: 2,
      propertyId: fx.propertyId,
    });
    expect(coupon.status).toBe(201);
    const promoId = coupon.body.promotion.id as string;
    const rooms = await Promise.all(Array.from({ length: 6 }, () => extraRoom(fx.propertyId)));
    const stay = { checkIn: iso(utcDay(30)), checkOut: iso(utcDay(32)) };

    // Doğrulama ucu kullanımı saymaz.
    const userToken = await tokenFor(fx.userId, "USER");
    const check = await couponRoute.POST(
      req("POST", "/api/coupons/validate", userToken, {
        propertyId: fx.propertyId,
        roomId: fx.roomId,
        ...stay,
        guests: 1,
        couponCode: "yaris2",
      })
    );
    expect(await check.json()).toMatchObject({ valid: true, status: "APPLIED", code: "YARIS2" });

    const results = await Promise.allSettled(
      rooms.map((roomId) =>
        createBooking({
          userId: fx.userId,
          propertyId: fx.propertyId,
          roomId,
          ...stay,
          guestCount: 1,
          couponCode: "yaris2",
        })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(2);
    expect(failed.map((f) => (f.reason as { code?: string }).code)).toEqual(
      Array(4).fill("COUPON_EXHAUSTED")
    );
    const promo = await prisma.promotion.findUniqueOrThrow({ where: { id: promoId } });
    expect(promo.usageCount).toBe(2);
    expect(await prisma.promotionRedemption.count({ where: { promotionId: promoId } })).toBe(2);
    // Başarısız denemeler tutma bırakmadı.
    expect(await prisma.booking.count({ where: { roomId: { in: rooms }, status: "HELD" } })).toBe(
      2
    );

    // Doğrulama ucu artık tükenmiş der.
    const exhausted = await couponRoute.POST(
      req("POST", "/api/coupons/validate", userToken, {
        propertyId: fx.propertyId,
        roomId: fx.roomId,
        ...stay,
        guests: 1,
        couponCode: "YARIS2",
      })
    );
    expect(await exhausted.json()).toMatchObject({ valid: false, status: "USAGE_LIMIT_REACHED" });

    // Tutma düşünce kullanım iade edilir → kupon yeniden kullanılabilir.
    const held = (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createBooking>>>).value;
    expect(await releaseHold(held.booking.id)).toBe(true);
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: promoId } })).usageCount).toBe(
      1
    );
    const again = await createBooking({
      userId: fx.userId,
      propertyId: fx.propertyId,
      roomId: held.booking.roomId,
      ...stay,
      guestCount: 1,
      couponCode: "YARIS2",
    });
    expect(again.booking.priceBreakdown?.coupon).toEqual({ code: "YARIS2", status: "APPLIED" });
    await prisma.promotion.update({ where: { id: promoId }, data: { active: false } });
  });

  /** v2-P0-1: kuponlu tutma 3DS'te bekler, süresi dolar (kullanım iade edilir). */
  async function couponHoldLapsed(roomId: string, code: string, startInDays: number) {
    const held = await createBooking({
      userId: fx.userId,
      propertyId: fx.propertyId,
      roomId,
      checkIn: iso(utcDay(startInDays)),
      checkOut: iso(utcDay(startInDays + 2)),
      guestCount: 1,
      couponCode: code,
    });
    expect(held.booking.priceBreakdown?.coupon).toEqual({ code, status: "APPLIED" });
    const out = await payForBooking({
      bookingId: held.booking.id,
      userId: fx.userId,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: `v2-p0-1-${held.booking.id}`,
    });
    expect(out.status).toBe("requires_action");
    await prisma.booking.update({
      where: { id: held.booking.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await releaseHold(held.booking.id)).toBe(true);
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { bookingId: held.booking.id },
    });
    return { bookingId: held.booking.id, payment };
  }

  function lateSucceeded(payment: { providerRef: string | null; amountMinor: bigint }) {
    return handleWebhookEvent({
      id: `evt_v2_p0_1_${payment.providerRef}`,
      type: "payment.succeeded",
      data: {
        providerRef: payment.providerRef!,
        amount: Number(payment.amountMinor),
        currency: "TRY",
      },
    });
  }

  it("regression: v2-P0-1 geç ödeme başarısı, kupon limiti bu arada dolduysa onaylamaz ve tam iade eder", async () => {
    const coupon = await createPromo({
      name: "Geç kupon",
      type: "COUPON",
      couponCode: "GEC1",
      discountBps: 1500,
      usageLimit: 1,
      propertyId: fx.propertyId,
    });
    expect(coupon.status).toBe(201);
    const promoId = coupon.body.promotion.id as string;
    const [roomA, roomB] = await Promise.all([extraRoom(fx.propertyId), extraRoom(fx.propertyId)]);
    const usage = async () =>
      (await prisma.promotion.findUniqueOrThrow({ where: { id: promoId } })).usageCount;

    const a = await couponHoldLapsed(roomA, "GEC1", 44);
    expect(await usage()).toBe(0);
    // Bu arada B kuponun tek kullanımını alır.
    const b = await createBooking({
      userId: other.userId,
      propertyId: fx.propertyId,
      roomId: roomB,
      checkIn: iso(utcDay(44)),
      checkOut: iso(utcDay(46)),
      guestCount: 1,
      couponCode: "GEC1",
    });
    expect(b.booking.priceBreakdown?.coupon).toEqual({ code: "GEC1", status: "APPLIED" });
    expect(await usage()).toBe(1);

    const res = await lateSucceeded(a.payment);
    expect(res.compensated).toBe(true);
    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: a.bookingId },
      include: { payment: true },
    });
    expect(after.status).toBe("EXPIRED");
    expect(after.payment?.status).toBe("REFUNDED");
    expect(after.payment?.refundedAmountMinor).toBe(a.payment.amountMinor);
    expect(await usage()).toBe(1);
    // A'nın geri alınan tutması envanterde kalmadı.
    const day = await prisma.inventoryDay.findFirstOrThrow({
      where: { roomTypeId: roomA, date: utcDay(44) },
    });
    expect(day).toMatchObject({ held: 0, sold: 0 });
    await prisma.promotion.update({ where: { id: promoId }, data: { active: false } });
  });

  it("regression: v2-P0-1 geç ödeme başarısı, kupon limiti müsaitse onaylar ve kullanımı yeniden sayar", async () => {
    const coupon = await createPromo({
      name: "Geç kupon 2",
      type: "COUPON",
      couponCode: "GEC2",
      discountBps: 1500,
      usageLimit: 1,
      propertyId: fx.propertyId,
    });
    expect(coupon.status).toBe(201);
    const promoId = coupon.body.promotion.id as string;
    const roomA = await extraRoom(fx.propertyId);

    const a = await couponHoldLapsed(roomA, "GEC2", 48);
    const redemption = async () =>
      prisma.promotionRedemption.findMany({
        where: { bookingId: a.bookingId, promotionId: promoId },
      });
    const released = await prisma.promotion.findUniqueOrThrow({ where: { id: promoId } });
    expect(released.usageCount).toBe(0);

    const res = await lateSucceeded(a.payment);
    expect(res.compensated).toBeUndefined();
    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: a.bookingId },
      include: { payment: true },
    });
    expect(after.status).toBe("CONFIRMED");
    expect(after.payment?.status).toBe("PAID");
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: promoId } })).usageCount).toBe(
      1
    );
    const rows = await redemption();
    expect(rows).toHaveLength(1);
    expect(rows[0].amountMinor).toBeGreaterThan(0n);
    await prisma.promotion.update({ where: { id: promoId }, data: { active: false } });
  });

  it("Omnibus: fiyat değişimi tetikle geçmişe yazılır; referans = pencerede uygulanmış en düşük", async () => {
    const nights = [40, 41].map((d) => utcDay(d));
    const stay = {
      roomId: other.roomId,
      checkIn: iso(nights[0]),
      checkOut: iso(utcDay(42)),
      guests: 1,
    };
    const setPrice = (priceMinor: bigint) =>
      prisma.inventoryDay.updateMany({
        where: { roomTypeId: other.roomId, date: { in: nights } },
        data: { priceMinor },
      });

    const base = await computeTotal(stay);
    expect(base.lowestPrice30dMinor).toBe(base.total); // geçmiş yalnız mevcut fiyat
    await setPrice(80_000n);
    const low = await computeTotal(stay);
    await setPrice(120_000n);
    const high = await computeTotal(stay);
    expect(high.total).toBeGreaterThan(low.total);
    expect(high.lowestPrice30dMinor).toBe(low.total);
    const rows = await prisma.inventoryPriceHistory.findMany({
      where: { roomTypeId: other.roomId, date: nights[0] },
      orderBy: { id: "asc" },
    });
    expect(rows.map((r) => Number(r.priceMinor))).toEqual([100_000, 80_000, 120_000]);

    // Pencere dışı (40 gün önce) çok düşük fiyat sayılmaz; pencere başında yürürlükte olan sayılır.
    await prisma.inventoryPriceHistory.deleteMany({ where: { roomTypeId: other.roomId } });
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
    for (const date of nights) {
      await prisma.inventoryPriceHistory.createMany({
        data: [
          { roomTypeId: other.roomId, date, priceMinor: 100n, effectiveAt: ago(40) },
          { roomTypeId: other.roomId, date, priceMinor: 90_000n, effectiveAt: ago(35) },
          { roomTypeId: other.roomId, date, priceMinor: 120_000n, effectiveAt: ago(1) },
        ],
      });
    }
    const windowed = await computeTotal(stay);
    await setPrice(90_000n);
    const at90 = await computeTotal(stay);
    await setPrice(120_000n);
    expect(windowed.lowestPrice30dMinor).toBe(at90.total);
    expect(windowed.omnibusDays).toBe(30);
  });
});
