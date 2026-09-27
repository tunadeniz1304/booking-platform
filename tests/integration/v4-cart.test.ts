// P1-1 KK: çok odalı / grup sepeti — tümü-ya-hiç tutma (100 paralel sepet → aşırı satış 0),
// bir kalem başarısızsa hiçbir tutma kalmaz, tek ödeme sonrası defter dengede + mutabakat 0.
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  addCartItem,
  CART_PAYMENT_SAGA,
  compensateCartPayment,
  confirmCartChallenge,
  expireCarts,
  holdCart,
  loadOwnedCart,
  payCart,
  releaseCart,
  reopenCart,
  type CartDTO,
  type CartPayOutcome,
} from "@/lib/cart";
import { cancelAndRefund, handleWebhookEvent, payForBooking } from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import { injectSagaFaultForTests } from "@/lib/saga/saga";
import { isTrialBalanced, ledgerImbalanceTotal, reconcile, trialBalance } from "@/lib/ledger";
import { HttpError } from "@/lib/http/errors";

describeInt("P1-1 grup sepeti: tümü-ya-hiç tutma + tek ödeme", () => {
  const prisma = new PrismaClient();
  let seq = 0;

  async function newUser(tag: string): Promise<string> {
    const u = await prisma.user.create({
      data: {
        email: `cart-${tag}-${Date.now()}-${++seq}@t.test`,
        passwordHash: "x",
        firstName: "Sepet",
        lastName: "Test",
        emailVerifiedAt: new Date(),
      },
    });
    return u.id;
  }

  function item(fx: StayFixture, start: number, nights = 2, quantity = 1) {
    return {
      propertyId: fx.propertyId,
      roomTypeId: fx.roomId,
      checkIn: iso(utcDay(start)),
      checkOut: iso(utcDay(start + nights)),
      adults: 1,
      children: 0,
      quantity,
    };
  }

  async function heldOn(roomTypeId: string, start: number, nights: number) {
    const rows = await prisma.inventoryDay.findMany({
      where: { roomTypeId, date: { gte: utcDay(start), lt: utcDay(start + nights) } },
      select: { total: true, held: true, sold: true },
    });
    return rows;
  }

  async function payOk(cartId: string, userId: string, key: string): Promise<CartPayOutcome> {
    let out = await payCart({ cartId, userId, cardToken: "tok_mock_ok_4242", idempotencyKey: key });
    // Hız kuralları çok ödemede 3DS isteyebilir → mock kodla tamamla (aynı saga yolu).
    if (out.status === "requires_action") {
      out = await confirmCartChallenge({ cartId, userId, code: MOCK_3DS_CODE });
    }
    return out;
  }

  async function imbalanceCount(): Promise<number> {
    const m = await ledgerImbalanceTotal.get();
    return m.values.reduce((s, v) => s + v.value, 0);
  }

  beforeAll(async () => {
    expect(await imbalanceCount()).toBe(0);
  });
  afterEach(() => {
    setPaymentProviderForTests(null);
    injectSagaFaultForTests(CART_PAYMENT_SAGA, null);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("100 paralel sepet (2 oda tipi, ters sıralı kalemler) → aşırı satış 0, tümü-ya-hiç", async () => {
    const UNITS = 30;
    const a = await createStayFixture(prisma, { tag: "cart-par-a", units: UNITS, days: 30 });
    const b = await createStayFixture(prisma, { tag: "cart-par-b", units: UNITS, days: 30 });
    const START = 10;
    const NIGHTS = 3;
    const users = await Promise.all(Array.from({ length: 100 }, (_, i) => newUser(`par${i}`)));
    // Yarısı A→B, yarısı B→A sırasıyla ekler: kilit sırası kalem sırasından bağımsız olmalı.
    // Kurulum (test edilen değil): 20'li eşzamanlı addCartItem, küçük CartItem tablosunda
    // SERIALIZABLE sahte çakışmalarla yük altında 6 denemeyi tüketip P2034 ile düşüyordu.
    // Yarışın asıl test edildiği yer aşağıdaki 100 paralel holdCart'tır; kurulum 5'li gruplarla.
    for (let i = 0; i < users.length; i += 5) {
      await Promise.all(
        users.slice(i, i + 5).map(async (u, j) => {
          const [first, second] = (i + j) % 2 === 0 ? [a, b] : [b, a];
          await addCartItem(u, item(first, START, NIGHTS));
          await addCartItem(u, item(second, START, NIGHTS));
        })
      );
    }

    const results = await Promise.allSettled(users.map((u) => holdCart(u)));
    const held = results.filter((r) => r.status === "fulfilled").length;
    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(HttpError);
        expect((r.reason as HttpError).status).toBe(409);
      }
    }
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThanOrEqual(UNITS);

    // Aşırı satış 0: her gece held+sold ≤ total ve tutulan = başarılı sepet sayısı.
    for (const fx of [a, b]) {
      const rows = await heldOn(fx.roomId, START, NIGHTS);
      expect(rows).toHaveLength(NIGHTS);
      for (const row of rows) {
        expect(row.held + row.sold).toBeLessThanOrEqual(row.total);
        expect(row.held).toBe(held);
      }
    }
    // Tümü-ya-hiç: her sepette ya 2 HELD rezervasyon ya da hiç rezervasyon yok.
    const carts = await prisma.cart.findMany({
      where: { userId: { in: users } },
      select: { status: true, bookings: { select: { status: true } } },
    });
    expect(carts).toHaveLength(100);
    for (const c of carts) {
      if (c.status === "HELD") {
        expect(c.bookings.map((x) => x.status)).toEqual(["HELD", "HELD"]);
      } else {
        expect(c.status).toBe("OPEN");
        expect(c.bookings).toHaveLength(0);
      }
    }
    expect(carts.filter((c) => c.status === "HELD")).toHaveLength(held);
  }, 180_000);

  it("bir kalem tutulamazsa hiçbir tutma kalmaz (işlem geri alınır)", async () => {
    const a = await createStayFixture(prisma, { tag: "cart-atomic-a", units: 5 });
    const c = await createStayFixture(prisma, { tag: "cart-atomic-c", units: 1 });
    const user = await newUser("atomic");
    // Kalemler tek tek fiyatlanırken ikisi de 1 odayı görür; tek işlemde ikincisi sığmaz.
    await addCartItem(user, item(a, 20));
    await addCartItem(user, item(c, 20));
    const cart = await addCartItem(user, item(c, 20));
    expect(cart.items).toHaveLength(3);

    const err = await holdCart(user).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as HttpError).details).toMatchObject({ itemId: expect.any(String) });

    for (const fx of [a, c]) {
      for (const row of await heldOn(fx.roomId, 20, 2)) expect(row.held).toBe(0);
    }
    expect(await prisma.booking.count({ where: { cartId: cart.id } })).toBe(0);
    const after = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(after.status).toBe("OPEN");
    expect(
      await prisma.cartItem.count({ where: { cartId: cart.id, bookingId: { not: null } } })
    ).toBe(0);
  });

  it("tek ödeme: tüm kalemler CONFIRMED, pay Payment'ları, defter dengede, mutabakat 0; kalem iptali sepet tahsilatından iade", async () => {
    const a = await createStayFixture(prisma, {
      tag: "cart-pay-a",
      units: 3,
      nightlyPrice: 1234.56,
    });
    const b = await createStayFixture(prisma, { tag: "cart-pay-b", units: 3, nightlyPrice: 777 });
    const user = await newUser("pay");
    await addCartItem(user, item(a, 30, 2, 2));
    await addCartItem(user, item(b, 30, 3));
    const held = await holdCart(user, { idempotencyKey: "cart-pay-hold" });
    expect(held.status).toBe("HELD");
    // Aynı anahtarla tekrar → aynı tutma (idempotent).
    expect((await holdCart(user, { idempotencyKey: "cart-pay-hold" })).id).toBe(held.id);

    // Kalem rezervasyonu tek başına ödenemez.
    const single = await payForBooking({
      bookingId: held.items[0].bookingId!,
      userId: user,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "single",
    }).catch((e: unknown) => e);
    expect((single as HttpError).code).toBe("CART_BOOKING");

    const out = await payOk(held.id, user, "cart-pay-1");
    expect(out.status).toBe("confirmed");
    if (out.status !== "confirmed") return;
    expect(out.amount).toBe(held.totalMinor);
    // Tekrar → idempotent sonuç, ikinci tahsilat yok.
    const again = await payOk(held.id, user, "cart-pay-2");
    expect(again).toEqual(out);

    const cart = await prisma.cart.findUniqueOrThrow({
      where: { id: held.id },
      include: { payment: { include: { payments: true } }, bookings: true },
    });
    expect(cart.status).toBe("CHECKED_OUT");
    expect(cart.payment?.status).toBe("PAID");
    expect(cart.bookings.every((x) => x.status === "CONFIRMED")).toBe(true);
    const shares = cart.payment!.payments;
    expect(shares).toHaveLength(2);
    expect(shares.reduce((s, p) => s + p.amountMinor, 0n)).toBe(cart.payment!.amountMinor);
    expect(Number(cart.payment!.amountMinor)).toBe(held.totalMinor);
    for (const fx of [a, b]) {
      for (const row of await heldOn(fx.roomId, 30, 2)) {
        expect(row.held).toBe(0);
        expect(row.sold).toBeGreaterThan(0);
      }
    }

    // Her kalem için capture jurnali (booking-captured:<paymentId>), mizan dengede.
    const entries = await prisma.journalEntry.findMany({
      where: { paymentId: { in: shares.map((p) => p.id) } },
      select: { kind: true },
    });
    expect(entries.filter((e) => e.kind === "BOOKING_CAPTURED")).toHaveLength(2);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);

    // Bir kalemin iptali: iade sepetin tek PSP işleminden (providerRef paylaşılır).
    const refunds: string[] = [];
    setPaymentProviderForTests(recordingRefunds(refunds));
    const cancelled = await cancelAndRefund(cart.bookings[0].id, user);
    expect(cancelled.status).toBe("CANCELLED");
    if (cancelled.refund.refundMinor > 0) expect(refunds).toEqual([cart.payment!.providerRef]);

    const day = iso(new Date());
    const report = await reconcile(day, prisma);
    const mine = new Set(shares.map((p) => p.id));
    expect(report.imbalancedEntries).toBe(0);
    expect(report.differences.filter((d) => mine.has(d.subjectId))).toEqual([]);
    expect(report.orphanEvents.filter((e) => e.providerRef === cart.payment!.providerRef)).toEqual(
      []
    );
    expect(await imbalanceCount()).toBe(0);
  });

  it("ödeme reddi → tüm tutmalar serbest, sepet düzenlenebilir kalır", async () => {
    const a = await createStayFixture(prisma, { tag: "cart-decline-a", units: 2 });
    const b = await createStayFixture(prisma, { tag: "cart-decline-b", units: 2 });
    const user = await newUser("decline");
    await addCartItem(user, item(a, 40));
    await addCartItem(user, item(b, 40));
    const held = await holdCart(user);

    const err = await payCart({
      cartId: held.id,
      userId: user,
      cardToken: "tok_mock_decline_0002",
      idempotencyKey: "decline-1",
    }).catch((e: unknown) => e);
    expect((err as HttpError).code).toBe("PAYMENT_DECLINED");

    await expectReleased(held, [a, b], 40);
    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: held.id } });
    expect(cp.status).toBe("FAILED");
    // Yeniden tutulup ödenebilir.
    const again = await holdCart(user);
    expect((await payOk(again.id, user, "decline-2")).status).toBe("confirmed");
  });

  it("capture sonrası onay hatası → tam iade + tüm tutmalar serbest (saga telafisi)", async () => {
    const a = await createStayFixture(prisma, { tag: "cart-comp-a", units: 2 });
    const b = await createStayFixture(prisma, { tag: "cart-comp-b", units: 2 });
    const user = await newUser("comp");
    await addCartItem(user, item(a, 50));
    await addCartItem(user, item(b, 50));
    const held = await holdCart(user);
    injectSagaFaultForTests(CART_PAYMENT_SAGA, "confirm");

    await expect(
      payCart({
        cartId: held.id,
        userId: user,
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: "c1",
      })
    ).rejects.toThrow();

    await expectReleased(held, [a, b], 50);
    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: held.id } });
    expect(cp.status).toBe("REFUNDED");
    expect(cp.refundedAmountMinor).toBe(cp.amountMinor);
    expect(await prisma.payment.count({ where: { cartPaymentId: cp.id } })).toBe(0);
    const report = await reconcile(iso(new Date()), prisma);
    expect(report.orphanEvents.filter((e) => e.providerRef === cp.providerRef)).toEqual([]);
  });

  it("sepet düzeyinde süre dolumu: tüm kalemler tek işlemde EXPIRED; yeniden açılabilir", async () => {
    const a = await createStayFixture(prisma, { tag: "cart-exp-a", units: 2 });
    const b = await createStayFixture(prisma, { tag: "cart-exp-b", units: 2 });
    const user = await newUser("expire");
    await addCartItem(user, item(a, 60));
    await addCartItem(user, item(b, 60));
    const held = await holdCart(user);

    // Paylaşımlı DB: limit, önceki testlerin tutulan sepetlerine takılmasın.
    expect(await expireCarts(new Date(Date.now() + 60 * 60_000), 10_000)).toBeGreaterThanOrEqual(1);
    await expectReleased(held, [a, b], 60, "EXPIRED");

    const reopened = await reopenCart(user);
    expect(reopened?.status).toBe("OPEN");
    expect(reopened?.items).toHaveLength(2);
    expect(reopened?.id).not.toBe(held.id);
    const rehold = await holdCart(user);
    expect(rehold.status).toBe("HELD");
    const released = await releaseCart(user, rehold.id);
    expect(released.status).toBe("OPEN");
    await expectReleased(rehold, [a, b], 60);
  });

  it("regression: v2-P0-1 sepet geç ödeme başarısı: limitli promosyon dolduysa iade, müsaitse onay + kullanım yeniden sayılır", async () => {
    /** Tek kullanımlık otomatik (kuponsuz) limitli promosyonlu ilan. */
    async function limitedStay(tag: string) {
      const fx = await createStayFixture(prisma, { tag, units: 3 });
      const promo = await prisma.promotion.create({
        data: {
          hostId: fx.hostId,
          propertyId: fx.propertyId,
          name: "Tek kullanımlık uzun konaklama",
          type: "LONG_STAY",
          minNights: 2,
          discountBps: 1000,
          usageLimit: 1,
        },
      });
      return { fx, promoId: promo.id };
    }
    const usage = async (promoId: string) =>
      (await prisma.promotion.findUniqueOrThrow({ where: { id: promoId } })).usageCount;

    /** Sepet tutulur, tek ödeme 3DS'te bekler, sepet süresi dolar (kullanım iade edilir). */
    async function lapsedCart(fx: StayFixture, promoId: string, start: number) {
      const user = await newUser(`late-promo-${start}`);
      await addCartItem(user, item(fx, start));
      const held = await holdCart(user);
      expect(await usage(promoId)).toBe(1);
      const pending = await payCart({
        cartId: held.id,
        userId: user,
        cardToken: "tok_mock_3ds_3220",
        idempotencyKey: `late-promo-${held.id}`,
      });
      expect(pending.status).toBe("requires_action");
      await prisma.cart.update({
        where: { id: held.id },
        data: { holdExpiresAt: new Date(Date.now() - 1000) },
      });
      expect(await expireCarts(new Date(), 10_000)).toBeGreaterThanOrEqual(1);
      expect(await usage(promoId)).toBe(0);
      const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: held.id } });
      return { held, cp };
    }
    const lateSucceeded = (cp: { providerRef: string | null; amountMinor: bigint }) =>
      handleWebhookEvent({
        id: `evt_v2_p0_1_cart_${cp.providerRef}`,
        type: "payment.succeeded",
        data: { providerRef: cp.providerRef!, amount: Number(cp.amountMinor), currency: "TRY" },
      });

    // 1) Limit bu arada doldu (B kullandı) → A onaylanmaz, tam iade, sayaç 1.
    const x = await limitedStay("cart-late-promo-x");
    const a = await lapsedCart(x.fx, x.promoId, 20);
    const userB = await newUser("late-promo-b");
    await addCartItem(userB, item(x.fx, 20));
    await holdCart(userB);
    expect(await usage(x.promoId)).toBe(1);
    const refunded = await lateSucceeded(a.cp);
    expect(refunded.compensated).toBe(true);
    const aAfter = await prisma.cart.findUniqueOrThrow({
      where: { id: a.held.id },
      include: { bookings: true, payment: true },
    });
    expect(aAfter.status).not.toBe("CHECKED_OUT");
    expect(aAfter.bookings.every((b) => b.status !== "CONFIRMED")).toBe(true);
    expect(aAfter.payment?.status).toBe("REFUNDED");
    expect(aAfter.payment?.refundedAmountMinor).toBe(a.cp.amountMinor);
    expect(await usage(x.promoId)).toBe(1);
    expect(
      await prisma.promotionRedemption.count({
        where: { promotionId: x.promoId, bookingId: { in: aAfter.bookings.map((b) => b.id) } },
      })
    ).toBe(0);

    // 2) Limit müsait → A onaylanır, kullanım yeniden sayılır ve A'ya bağlanır.
    const y = await limitedStay("cart-late-promo-y");
    const c = await lapsedCart(y.fx, y.promoId, 24);
    const confirmed = await lateSucceeded(c.cp);
    expect(confirmed.compensated).toBeUndefined();
    const cAfter = await prisma.cart.findUniqueOrThrow({
      where: { id: c.held.id },
      include: { bookings: true, payment: true },
    });
    expect(cAfter.status).toBe("CHECKED_OUT");
    expect(cAfter.bookings.every((b) => b.status === "CONFIRMED")).toBe(true);
    expect(await usage(y.promoId)).toBe(1);
    const rows = await prisma.promotionRedemption.findMany({
      where: { promotionId: y.promoId, bookingId: { in: cAfter.bookings.map((b) => b.id) } },
    });
    expect(rows).toHaveLength(1);
    // Tutar, kalemin tutma anındaki indirim satırıyla aynı (kırılım anlık görüntüsü).
    const owner = cAfter.bookings.find((b) => b.id === rows[0].bookingId)!;
    const breakdown = owner.priceBreakdown as {
      discounts?: { promotionId: string; amount: number }[];
    };
    const discount = breakdown.discounts?.find((d) => d.promotionId === y.promoId);
    expect(discount?.amount).toBeGreaterThan(0);
    expect(rows[0].amountMinor).toBe(BigInt(discount!.amount));
  });

  /** Sepet ödemesine (`paymentId`) bağlı jurnal türleri, psp_clearing neti ve tahsilat tutarı. */
  async function cartJournal(cartPaymentId: string) {
    const entries = await prisma.journalEntry.findMany({
      where: { paymentId: cartPaymentId },
      select: {
        kind: true,
        lines: { select: { side: true, amountMinor: true, account: { select: { kind: true } } } },
      },
    });
    let psp = 0n;
    let captured = 0n;
    for (const e of entries) {
      for (const l of e.lines) {
        if (l.account.kind !== "PSP_CLEARING") continue;
        psp += l.side === "DEBIT" ? l.amountMinor : -l.amountMinor;
        if (l.side === "DEBIT") captured += l.amountMinor;
      }
    }
    return { kinds: entries.map((e) => e.kind).sort(), psp, captured };
  }

  async function expectCartBooksClean(cartPaymentIds: string[]) {
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    expect(await imbalanceCount()).toBe(0);
    const report = await reconcile(iso(new Date()), prisma);
    expect(report.imbalancedEntries).toBe(0);
    expect(report.differences.filter((d) => cartPaymentIds.includes(d.subjectId))).toEqual([]);
  }

  it("regression: v2-P0-3 sepet saga telafisi jurnale yazılır (capture + iade, psp net 0); tekrar telafi jurnali çoğaltmaz", async () => {
    const a = await createStayFixture(prisma, { tag: "cart-p03-comp", units: 2 });
    const user = await newUser("p03-comp");
    await addCartItem(user, item(a, 70));
    const held = await holdCart(user);
    injectSagaFaultForTests(CART_PAYMENT_SAGA, "confirm");
    await expect(
      payCart({
        cartId: held.id,
        userId: user,
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: "p03-comp",
      })
    ).rejects.toThrow();
    injectSagaFaultForTests(CART_PAYMENT_SAGA, null);

    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: held.id } });
    expect(cp.status).toBe("REFUNDED");
    const expected = {
      kinds: ["BOOKING_CAPTURED", "REFUND_ISSUED"],
      psp: 0n,
      captured: cp.amountMinor,
    };
    expect(await cartJournal(cp.id)).toEqual(expected);
    await expectCartBooksClean([cp.id]);

    // Telafi yeniden çalışır (compensation-retry işi) → PSP iadesi ve jurnal tek.
    expect(
      await compensateCartPayment({ cartId: held.id, providerRef: cp.providerRef!, captured: true })
    ).toBe("compensated");
    expect(await cartJournal(cp.id)).toEqual(expected);
    await expectCartBooksClean([cp.id]);
  });

  it("regression: v2-P0-3 sepet geç ödeme iadesi jurnale yazılır; tekrar teslim jurnali çoğaltmaz", async () => {
    const fx = await createStayFixture(prisma, { tag: "cart-p03-late", units: 1 });
    const user = await newUser("p03-late");
    await addCartItem(user, item(fx, 22));
    const held = await holdCart(user);
    const pending = await payCart({
      cartId: held.id,
      userId: user,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: "p03-late",
    });
    expect(pending.status).toBe("requires_action");
    await prisma.cart.update({
      where: { id: held.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await expireCarts(new Date(), 10_000)).toBeGreaterThanOrEqual(1);
    // Tek oda bu arada başkasına gitti → geç başarı onaylanamaz, iade.
    const rival = await newUser("p03-rival");
    await addCartItem(rival, item(fx, 22));
    await holdCart(rival);

    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: held.id } });
    const succeeded = (id: string) =>
      handleWebhookEvent({
        id,
        type: "payment.succeeded",
        data: { providerRef: cp.providerRef!, amount: Number(cp.amountMinor), currency: "TRY" },
      });
    expect((await succeeded(`evt_p03_late_${cp.providerRef}`)).compensated).toBe(true);
    const after = await prisma.cartPayment.findUniqueOrThrow({ where: { id: cp.id } });
    expect(after.status).toBe("REFUNDED");
    const expected = {
      kinds: ["BOOKING_CAPTURED", "REFUND_ISSUED"],
      psp: 0n,
      captured: cp.amountMinor,
    };
    expect(await cartJournal(cp.id)).toEqual(expected);
    await expectCartBooksClean([cp.id]);

    // Aynı PSP başarısı farklı olay kimliğiyle yeniden gelir → jurnal tek.
    await succeeded(`evt_p03_late_again_${cp.providerRef}`);
    expect(await cartJournal(cp.id)).toEqual(expected);
    await expectCartBooksClean([cp.id]);
  });

  it("regression: v2-P0-3 mutabakat jurnalsiz sepet ödemesi iadesini fark olarak raporlar", async () => {
    const user = await newUser("p03-orphan");
    const cart = await prisma.cart.create({ data: { userId: user, currency: "TRY" } });
    const now = new Date();
    // PSP'de tahsil + iade edilmiş, deftere hiç yazılmamış sepet ödemesi.
    const cp = await prisma.cartPayment.create({
      data: {
        cartId: cart.id,
        userId: user,
        amountMinor: 12_345n,
        currency: "TRY",
        provider: "mock",
        providerRef: `pi_p03_orphan_${cart.id}`,
        status: "REFUNDED",
        paidAt: now,
        refundedAmountMinor: 12_345n,
        refundedAt: now,
        failureCode: "CART_NOT_CONFIRMABLE",
      },
    });
    try {
      const report = await reconcile(iso(now), prisma);
      const diff = report.differences.filter((d) => d.subjectId === cp.id);
      expect(diff).toHaveLength(2);
      expect(diff).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "capture", pspMinor: 12_345n, journalMinor: 0n }),
          expect.objectContaining({ kind: "refund", pspMinor: 12_345n, journalMinor: 0n }),
        ])
      );
      expect(report.ok).toBe(false);
    } finally {
      // Paylaşımlı DB: sonraki mutabakat testleri bu kasıtlı farkı görmesin.
      await prisma.cart.delete({ where: { id: cart.id } });
    }
  });

  it("sahiplik: başkasının sepeti 404", async () => {
    const a = await createStayFixture(prisma, { tag: "cart-own", units: 2 });
    const owner = await newUser("owner");
    const other = await newUser("other");
    const cart = await addCartItem(owner, item(a, 70));
    await expect(loadOwnedCart(cart.id, other)).rejects.toMatchObject({ status: 404 });
    await expect(holdCart(other, { cartId: cart.id })).rejects.toMatchObject({ status: 404 });
    await expect(
      payCart({
        cartId: cart.id,
        userId: other,
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: "x",
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  async function expectReleased(
    cart: CartDTO,
    fixtures: StayFixture[],
    start: number,
    status: "OPEN" | "EXPIRED" = "OPEN"
  ): Promise<void> {
    for (const fx of fixtures) {
      for (const row of await heldOn(fx.roomId, start, 2)) {
        expect(row.held).toBe(0);
        expect(row.sold).toBe(0);
      }
    }
    const row = await prisma.cart.findUniqueOrThrow({
      where: { id: cart.id },
      include: { bookings: { select: { status: true } } },
    });
    expect(row.status).toBe(status);
    expect(row.bookings.length).toBeGreaterThan(0);
    expect(row.bookings.every((x) => x.status === "EXPIRED")).toBe(true);
  }
});

/** Gerçek mock PSP'yi saran, iade edilen providerRef'leri kaydeden sağlayıcı. */
function recordingRefunds(into: string[]): MockPsp {
  const psp = new MockPsp();
  const refund = psp.refund.bind(psp);
  psp.refund = async (providerRef, amount, idempotencyKey) => {
    into.push(providerRef);
    return refund(providerRef, amount, idempotencyKey);
  };
  return psp;
}
