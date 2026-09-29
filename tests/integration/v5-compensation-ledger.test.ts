// v5#1: sepet / pay / devir telafi iadeleri deftere yazılır ve mutabakat onları görür.
// Niyet işareti (`comp:<providerRef>`) PSP iadesinden ÖNCE ve yalnız capture kesinken yazılır:
// iade PSP'de işlenip yanıtı kaybolursa mutabakat farkı gösterir, yeniden deneme jurnali
// tamamlar (Σ psp_clearing = 0, fark 0); capture olmamış (void'i geçici düşmüş) provizyon
// işaretlenmez → yanlış fark yok.
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  addCartItem,
  CART_PAYMENT_SAGA,
  compensateCartPayment,
  compensateSplitPlan,
  confirmShareChallenge,
  createSplitPlan,
  holdCart,
  payCart,
  payShare,
  SPLIT_PAYMENT_SAGA,
  type SplitPlanDTO,
} from "@/lib/cart";
import { confirmPaymentChallenge, payForBooking } from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { listBookingForTransfer, sweepStuckTransfers } from "@/lib/transfer/transfer-service";
import { getConfig } from "@/lib/config/app-config";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import { PaymentProviderError } from "@/lib/payment/provider";
import { injectSagaFaultForTests } from "@/lib/saga/saga";
import { isTrialBalanced, reconcile, trialBalance } from "@/lib/ledger";

/** İadeyi PSP'de işler ama yanıt kaybolur (zaman aşımı/çökme) → çağıran jurnal yazamaz. */
class LostRefundPsp extends MockPsp {
  refundKeys: string[] = [];
  override async refund(...args: Parameters<MockPsp["refund"]>): ReturnType<MockPsp["refund"]> {
    this.refundKeys.push(args[2]);
    await super.refund(...args);
    throw new Error("refund response lost");
  }
}

/**
 * Capture'ı bilinen PSP: capture edilmiş ödeme void edilemez (`already_captured`), capture
 * edilmemiş ödeme iade edilemez. `voidDown` → void geçici olarak düşer (`psp_unavailable`).
 */
class StatefulPsp extends MockPsp {
  captured = new Set<string>();
  refundKeys: string[] = [];
  constructor(private readonly voidDown = false) {
    super();
  }
  override async void(ref?: string): ReturnType<MockPsp["void"]> {
    if (this.voidDown) throw new PaymentProviderError("psp_unavailable", "PSP yanıt vermiyor");
    if (ref && this.captured.has(ref)) {
      throw new PaymentProviderError("already_captured", "Tahsil edilmiş ödeme void edilemez");
    }
    return super.void();
  }
  override async refund(...args: Parameters<MockPsp["refund"]>): ReturnType<MockPsp["refund"]> {
    if (!this.captured.has(args[0])) {
      throw new PaymentProviderError("charge_not_captured", "Tahsil edilmemiş ödeme");
    }
    this.refundKeys.push(args[2]);
    return super.refund(...args);
  }
}

describeInt("v5#1 telafi iadeleri defterde (regression: v5#1)", () => {
  const prisma = new PrismaClient();
  let seq = 0;
  let fx: StayFixture;
  let buyer = "";

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v5-comp-ledger", days: 120 });
    buyer = await newUser("buyer");
  });
  afterEach(() => {
    setPaymentProviderForTests(null);
    injectSagaFaultForTests(CART_PAYMENT_SAGA, null);
    injectSagaFaultForTests(SPLIT_PAYMENT_SAGA, null);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function newUser(tag: string): Promise<string> {
    const u = await prisma.user.create({
      data: {
        email: `v5comp-${tag}-${Date.now()}-${++seq}@t.test`,
        passwordHash: "x",
        firstName: "Telafi",
        lastName: "Test",
        emailVerifiedAt: new Date(),
      },
    });
    return u.id;
  }

  function item(f: StayFixture, start: number, nights = 2) {
    return {
      propertyId: f.propertyId,
      roomTypeId: f.roomId,
      checkIn: iso(utcDay(start)),
      checkOut: iso(utcDay(start + nights)),
      adults: 1,
      children: 0,
      quantity: 1,
    };
  }

  /** Özneye (`paymentId` ya da `transferId`) bağlı jurnalin türleri ve psp_clearing neti (Σ). */
  async function journalOf(where: { paymentId: string } | { transferId: string }) {
    const entries = await prisma.journalEntry.findMany({
      where,
      select: {
        kind: true,
        lines: { select: { side: true, amountMinor: true, account: { select: { kind: true } } } },
      },
    });
    let psp = 0n;
    let captured = 0n;
    for (const l of entries.flatMap((e) => e.lines)) {
      if (l.account.kind !== "PSP_CLEARING") continue;
      psp += l.side === "DEBIT" ? l.amountMinor : -l.amountMinor;
      if (l.side === "DEBIT") captured += l.amountMinor;
    }
    return { kinds: entries.map((e) => e.kind).sort(), psp, captured };
  }

  /** Öznenin bugünkü mutabakat farkları (tür sırasıyla). */
  async function diffsOf(subjectId: string) {
    const report = await reconcile(iso(new Date()), prisma);
    expect(report.imbalancedEntries).toBe(0);
    return report.differences
      .filter((d) => d.subjectId === subjectId)
      .map((d) => ({ kind: d.kind, psp: d.pspMinor, journal: d.journalMinor }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }

  const paired = (amount: bigint) => ({
    kinds: ["BOOKING_CAPTURED", "REFUND_ISSUED"],
    psp: 0n,
    captured: amount,
  });

  const afterTimeout = () =>
    new Date(Date.now() + (getConfig().TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS + 60) * 1000);

  it("sepet: telafi iadesinin yanıtı kaybolursa mutabakat farkı görür; yeniden deneme Σ=0, fark 0", async () => {
    const f = await createStayFixture(prisma, { tag: "v5-comp-cart", units: 2 });
    const user = await newUser("cart");
    await addCartItem(user, item(f, 40));
    const held = await holdCart(user);
    const lost = new LostRefundPsp();
    setPaymentProviderForTests(lost);
    injectSagaFaultForTests(CART_PAYMENT_SAGA, "confirm");
    await expect(
      payCart({
        cartId: held.id,
        userId: user,
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: `v5-comp-cart-${seq}`,
      })
    ).rejects.toThrow();
    injectSagaFaultForTests(CART_PAYMENT_SAGA, null);
    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: held.id } });
    expect(lost.refundKeys).toContain(`compensate:${cp.providerRef}`);
    expect((await journalOf({ paymentId: cp.id })).kinds).toEqual([]);
    // PSP'de tahsilat + iade var, defterde yok → fark sessizce kaybolmamalı.
    expect(await diffsOf(cp.id)).toEqual([
      { kind: "capture", psp: cp.amountMinor, journal: 0n },
      { kind: "refund", psp: cp.amountMinor, journal: 0n },
    ]);

    setPaymentProviderForTests(null);
    expect(
      await compensateCartPayment({ cartId: held.id, providerRef: cp.providerRef!, captured: true })
    ).toBe("compensated");
    expect(await journalOf({ paymentId: cp.id })).toEqual(paired(cp.amountMinor));
    expect(await diffsOf(cp.id)).toEqual([]);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });

  // regression: v5-F9 partial cart journal — PG chaos: telafi edilen (REFUNDED) sepet ödemesinin
  // sepeti OPEN'a döner; kullanıcı kalem ekleyip yeniden öderse `payCart` upsert'i terminal satırın
  // `amountMinor`'ını yeni toplamla eziyordu → mutabakat PSP'yi yeni tutardan (tam) görür, telafi
  // jurnali eski (kısmi) tutarda kalır: capture/refund farkı.
  it("regression: v5-F9 partial cart journal — telafi edilmiş sepet yeniden ödenince tutar ezilmez, fark 0", async () => {
    const f = await createStayFixture(prisma, { tag: "v5-f9-cart", units: 2 });
    const user = await newUser("f9-cart");
    await addCartItem(user, item(f, 60));
    const held = await holdCart(user);
    injectSagaFaultForTests(CART_PAYMENT_SAGA, "confirm");
    await expect(
      payCart({
        cartId: held.id,
        userId: user,
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: `v5-f9-cart-${seq}-1`,
      })
    ).rejects.toThrow();
    injectSagaFaultForTests(CART_PAYMENT_SAGA, null);
    const first = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: held.id } });
    expect(first.status).toBe("REFUNDED");
    expect(await journalOf({ paymentId: first.id })).toEqual(paired(first.amountMinor));

    // Sepet OPEN'a döndü → ikinci kalem eklenip yeniden tutulur ve ödenmeye çalışılır.
    await addCartItem(user, item(f, 70, 3));
    const again = await holdCart(user);
    expect(again.id).toBe(held.id);
    await payCart({
      cartId: held.id,
      userId: user,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `v5-f9-cart-${seq}-2`,
    }).catch(() => undefined);

    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: held.id } });
    expect(cp.providerRef).toBe(first.providerRef);
    expect(cp.amountMinor).toBe(first.amountMinor);
    const j = await journalOf({ paymentId: cp.id });
    expect(j.psp).toBe(0n);
    expect(j.captured).toBe(cp.amountMinor);
    expect(await diffsOf(cp.id)).toEqual([]);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });

  // regression: v5-F9 split plan on refunded cart — `createSplitPlan` aynı CartPayment satırını
  // upsert edip telafi edilmiş (REFUNDED) satırda bile `amountMinor`'ı yeni toplamla ezip
  // `PENDING`'e çekiyordu → mutabakat telafi jurnalini yeni tutarla karşılaştırır. Tekil ödemeyle
  // tutarlı: açık olmayan satırla bölünmüş plan kurulamaz, satır olduğu gibi kalır.
  it("regression: v5-F9 split plan on refunded cart — telafi edilmiş sepette bölünmüş plan reddedilir, fark 0", async () => {
    const f = await createStayFixture(prisma, { tag: "v5-f9-split", units: 2 });
    const user = await newUser("f9-split");
    const p1 = await newUser("f9-split-p1");
    const p1Email = (await prisma.user.findUniqueOrThrow({ where: { id: p1 } })).email;
    await addCartItem(user, item(f, 60));
    const held = await holdCart(user);
    injectSagaFaultForTests(CART_PAYMENT_SAGA, "confirm");
    await expect(
      payCart({
        cartId: held.id,
        userId: user,
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: `v5-f9-split-${seq}-1`,
      })
    ).rejects.toThrow();
    injectSagaFaultForTests(CART_PAYMENT_SAGA, null);
    const first = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: held.id } });
    expect(first.status).toBe("REFUNDED");

    await addCartItem(user, item(f, 70, 3));
    const again = await holdCart(user);
    expect(again.id).toBe(held.id);
    await expect(
      createSplitPlan({
        cartId: held.id,
        userId: user,
        mode: "equal",
        participants: [{ email: p1Email }],
      })
    ).rejects.toMatchObject({ status: 409, code: "CART_PAYMENT_CLOSED" });

    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: held.id } });
    expect(cp.status).toBe("REFUNDED");
    expect(cp.amountMinor).toBe(first.amountMinor);
    expect(cp.providerRef).toBe(first.providerRef);
    expect(await prisma.splitPlan.count({ where: { cartId: held.id } })).toBe(0);
    expect(await journalOf({ paymentId: cp.id })).toEqual(paired(cp.amountMinor));
    expect(await diffsOf(cp.id)).toEqual([]);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });

  it("pay: tahsil edilmiş payların iadesi yanıtsız kalırsa fark görünür; telafi tekrarı Σ=0, fark 0", async () => {
    const a = await createStayFixture(prisma, { tag: "v5-comp-share-a", units: 2 });
    const organizer = await newUser("share-org");
    const p1 = await newUser("share-p1");
    const p1Email = (await prisma.user.findUniqueOrThrow({ where: { id: p1 } })).email;
    await addCartItem(organizer, item(a, 50));
    const cart = await holdCart(organizer);
    const plan: SplitPlanDTO = await createSplitPlan({
      cartId: cart.id,
      userId: organizer,
      mode: "equal",
      participants: [{ email: p1Email }],
    });
    const tokenOf = (position: number) => {
      const url = plan.shares.find((s) => s.position === position)!.inviteUrl!;
      return decodeURIComponent(url.split("/pay/share/")[1]);
    };
    const pay = async (position: number, userId: string) => {
      const token = tokenOf(position);
      const out = await payShare({
        token,
        userId,
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: `v5-comp-share-${++seq}`,
        context: { ip: `10.55.0.${seq % 250}` },
      });
      if (out.status === "requires_action") {
        await confirmShareChallenge({ token, userId, code: MOCK_3DS_CODE });
      }
    };
    await pay(1, p1);
    const lost = new LostRefundPsp();
    setPaymentProviderForTests(lost);
    injectSagaFaultForTests(SPLIT_PAYMENT_SAGA, "confirm");
    await expect(pay(0, organizer)).rejects.toThrow();
    injectSagaFaultForTests(SPLIT_PAYMENT_SAGA, null);

    const shares = await prisma.paymentShare.findMany({ where: { planId: plan.id } });
    expect(shares).toHaveLength(2);
    for (const share of shares) {
      expect(lost.refundKeys).toContain(`compensate:${share.providerRef}`);
      expect((await journalOf({ paymentId: share.id })).kinds).toEqual([]);
      expect(await diffsOf(share.id)).toEqual([
        { kind: "capture", psp: share.amountMinor, journal: 0n },
        { kind: "refund", psp: share.amountMinor, journal: 0n },
      ]);
    }

    setPaymentProviderForTests(null);
    await compensateSplitPlan(plan.id);
    for (const share of shares) {
      expect(await journalOf({ paymentId: share.id })).toEqual(paired(share.amountMinor));
      expect(await diffsOf(share.id)).toEqual([]);
    }
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });

  async function paidBooking() {
    const bk = await fx.hold({ nights: 1 });
    let out = await payForBooking({
      bookingId: bk.id,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `v5-comp-pay-${++seq}`,
    });
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({
        bookingId: bk.id,
        userId: fx.userId,
        code: MOCK_3DS_CODE,
      });
    }
    expect(out.status).toBe("confirmed");
    return bk;
  }

  /** Çöken süreç: ilan CAPTURE_PENDING'de, eşikten eski. */
  async function stuckTransfer() {
    const bk = await paidBooking();
    const ask = Math.max(1, Math.floor(bk.totalMinor / 2));
    const listed = await listBookingForTransfer(bk.id, fx.userId, ask);
    const ref = `pi_v5comp_${listed.id}`;
    await prisma.bookingTransfer.update({
      where: { id: listed.id },
      data: {
        status: "CAPTURE_PENDING",
        claimedById: buyer,
        claimedAt: new Date(
          Date.now() - (getConfig().TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS + 60) * 1000
        ),
        buyerPaymentRef: ref,
      },
    });
    return { transferId: listed.id, ref, ask: BigInt(ask) };
  }

  it("devir: capture'ı kesin (void reddi) takılı devrin iadesi jurnalde, Σ=0, fark 0", async () => {
    const t = await stuckTransfer();
    const psp = new StatefulPsp();
    psp.captured.add(t.ref);
    const res = await sweepStuckTransfers(new Date(), psp);
    expect(res.outcomes.refunded).toBeGreaterThanOrEqual(1);
    expect(psp.refundKeys).toContain(`transfer-refund:${t.transferId}`);
    expect(await journalOf({ transferId: t.transferId })).toEqual(paired(t.ask));
    expect(await diffsOf(t.transferId)).toEqual([]);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });

  it("devir: void geçici düştü + capture yok → niyet işareti yazılmaz, yanlış fark yok", async () => {
    const t = await stuckTransfer();
    const psp = new StatefulPsp(true); // capture yapılmamış; void geçici hata
    await sweepStuckTransfers(new Date(), psp);
    expect(psp.refundKeys).toEqual([]);
    const marker = await prisma.paymentEvent.findUnique({ where: { id: `comp:${t.ref}` } });
    expect(marker).toBeNull();
    expect((await journalOf({ transferId: t.transferId })).kinds).toEqual([]);
    expect(await diffsOf(t.transferId)).toEqual([]);
    // Sonraki süpürme de hayali iadeyi yeniden denemez ve fark üretmez.
    await sweepStuckTransfers(afterTimeout(), new StatefulPsp(true));
    expect(await diffsOf(t.transferId)).toEqual([]);
    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({
      where: { id: t.transferId },
    });
    expect(transfer.failureCode).toBe("CAPTURE_TIMEOUT_UNRESOLVED");
  });
});
