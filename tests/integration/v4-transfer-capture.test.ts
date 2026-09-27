// v4#1: devir ödemesi capture'dan önce commit edilmemeli (iki aşamalı devir sagası).
import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { PrismaClient, BookingStatus } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import {
  claimTransfer,
  listBookingForTransfer,
  sweepStuckTransfers,
  TRANSFER_SAGA,
  TRANSFER_SAGA_STEPS,
} from "@/lib/transfer/transfer-service";
import { MockPsp } from "@/lib/payment/mock-psp";
import { setPaymentProviderForTests } from "@/lib/payment";
import { injectSagaFaultForTests } from "@/lib/saga/saga";
import type { Money } from "@/lib/money/money";
import type { PaymentProvider } from "@/lib/payment/provider";

/** Capture/void/refund çağrılarını kaydeden; capture davranışı test başına ayarlanan PSP. */
class ScriptedPsp implements PaymentProvider {
  readonly name = "mock";
  private readonly inner = new MockPsp();
  captures: string[] = [];
  voids: string[] = [];
  refunds: Array<{ ref: string; amount: number }> = [];
  constructor(private readonly onCapture: (ref: string) => Promise<void> = async () => {}) {}
  authorize(input: Parameters<PaymentProvider["authorize"]>[0]) {
    return this.inner.authorize(input);
  }
  confirmChallenge(ref: string, code: string) {
    return this.inner.confirmChallenge(ref, code);
  }
  async capture(ref: string): Promise<{ status: "captured" }> {
    await this.onCapture(ref);
    this.captures.push(ref);
    return { status: "captured" };
  }
  async void(ref: string): Promise<{ status: "voided" }> {
    this.voids.push(ref);
    return { status: "voided" };
  }
  refund(ref: string, amount: Money, key: string) {
    this.refunds.push({ ref, amount: amount.amount });
    return this.inner.refund(ref, amount, key);
  }
}

/**
 * Stripe davranışını taklit eden PSP: aynı idempotency anahtarı → aynı provizyon (önbellek);
 * aynı anahtar farklı kartla → idempotency hatası; void edilmiş provizyon capture edilemez.
 * `gate` verilirse authorize, eşzamanlı istekler buluşana kadar (en çok `gateMs`) bekler.
 */
class StripeLikePsp implements PaymentProvider {
  readonly name = "mock";
  private readonly byKey = new Map<
    string,
    { cardToken: string; result: Awaited<ReturnType<PaymentProvider["authorize"]>> }
  >();
  private readonly voided = new Set<string>();
  private seq = 0;
  private arrivals = 0;
  keys: string[] = [];
  captures: string[] = [];
  voids: string[] = [];
  refunds: Array<{ ref: string; amount: number }> = [];
  constructor(
    private readonly gate = 0,
    private readonly gateMs = 300
  ) {}
  async authorize(input: Parameters<PaymentProvider["authorize"]>[0]) {
    this.keys.push(input.idempotencyKey);
    if (this.gate > 0) {
      this.arrivals += 1;
      const until = Date.now() + this.gateMs;
      while (this.arrivals < this.gate && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    const cached = this.byKey.get(input.idempotencyKey);
    if (cached) {
      if (cached.cardToken !== input.cardToken) {
        throw new Error("idempotency_error: key reused with different parameters");
      }
      return cached.result;
    }
    this.seq += 1;
    const providerRef = `pi_stripelike_${this.seq}`;
    const result: Awaited<ReturnType<PaymentProvider["authorize"]>> = input.cardToken.includes(
      "decline"
    )
      ? { status: "declined", providerRef, declineCode: "card_declined" }
      : { status: "authorized", providerRef };
    this.byKey.set(input.idempotencyKey, { cardToken: input.cardToken, result });
    return result;
  }
  async confirmChallenge(): Promise<never> {
    throw new Error("3DS yok");
  }
  async capture(ref: string): Promise<{ status: "captured" }> {
    // Gerçek PSP gecikmesi: eşzamanlı kaybedenin telafisi bu arada koşar.
    await new Promise((r) => setTimeout(r, 50));
    if (this.voided.has(ref)) throw new Error(`cannot capture voided authorization ${ref}`);
    this.captures.push(ref);
    return { status: "captured" };
  }
  async void(ref: string): Promise<{ status: "voided" }> {
    this.voided.add(ref);
    this.voids.push(ref);
    return { status: "voided" };
  }
  async refund(ref: string, amount: Money, key: string) {
    this.refunds.push({ ref, amount: amount.amount });
    return { status: "refunded" as const, refundRef: `re_${ref}_${key}` };
  }
}

describeInt("regression: v4#1 devir capture hatası (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let seller = "";
  let buyer = "";
  let propertyId = "";
  let roomId = "";
  let dayOffset = 30;

  async function confirmedBooking() {
    dayOffset += 3;
    const b = await prisma.booking.create({
      data: {
        userId: seller,
        propertyId,
        roomId,
        checkIn: utcDay(dayOffset),
        checkOut: utcDay(dayOffset + 2),
        guestCount: 1,
        totalPriceMinor: 200000n,
        status: BookingStatus.CONFIRMED,
      },
    });
    await prisma.payment.create({
      data: {
        bookingId: b.id,
        userId: seller,
        amountMinor: 200000n,
        provider: "mock",
        providerRef: `pi_v4seller_${b.id}`,
        status: "PAID",
      },
    });
    return b.id;
  }

  /** Devir defteri dengesi: alıcı ödemesi − satıcı payout'u (minor) ve satır sayısı. */
  async function transferLedger(bookingId: string) {
    const rows = await prisma.ledgerEntry.findMany({
      where: { bookingId, kind: { in: ["TRANSFER_PAYMENT", "TRANSFER_PAYOUT"] } },
    });
    const net = rows.reduce((sum, r) => {
      const minor = Number(r.amountMinor);
      return r.kind === "TRANSFER_PAYMENT" ? sum + minor : sum - minor;
    }, 0);
    return { count: rows.length, net };
  }

  async function expectUnchanged(bookingId: string, transferId: string, failureCode: string) {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { payment: true },
    });
    expect(booking.userId).toBe(seller);
    expect(booking.payment?.userId).toBe(seller);
    expect(await prisma.payout.count({ where: { transferId } })).toBe(0);
    expect(await transferLedger(bookingId)).toEqual({ count: 0, net: 0 });
    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: transferId } });
    expect(transfer.status).toBe("FAILED");
    expect(transfer.failureCode).toBe(failureCode);
    expect(transfer.failedAt).not.toBeNull();
    expect(transfer.completedAt).toBeNull();
    expect(
      await prisma.outboxMessage.count({
        where: { aggregateId: bookingId, eventType: "booking.transferred" },
      })
    ).toBe(0);
  }

  beforeAll(async () => {
    const mk = (n: string) =>
      prisma.user.create({
        data: {
          email: `v4tr-${n}-${stamp}@t.test`,
          passwordHash: "x",
          firstName: n,
          lastName: "Test",
        },
      });
    seller = (await mk("satici")).id;
    buyer = (await mk("alici")).id;
    const location = await prisma.location.create({
      data: { city: `V4TransCity-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        licenseStatus: "VERIFIED",
        hostId: seller,
        title: "Devir Oteli v4",
        description: "t",
        propertyType: "HOTEL",
        locationId: location.id,
        basePriceMinor: 100000n,
      },
    });
    propertyId = property.id;
    roomId = (
      await prisma.roomType.create({
        data: { propertyId, name: "Oda", maxOccupancy: 2, bedType: "Çift" },
      })
    ).id;
  });

  afterEach(() => {
    setPaymentProviderForTests(null);
    injectSagaFaultForTests(TRANSFER_SAGA, null);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("capture PSP hatası → sahiplik değişmez, payout yok, defter dengede, yetki void", async () => {
    const psp = new ScriptedPsp(async () => {
      throw new Error("psp capture timeout");
    });
    setPaymentProviderForTests(psp);
    const bookingId = await confirmedBooking();
    const listed = await listBookingForTransfer(bookingId, seller, 150_000);

    await expect(
      claimTransfer({ token: listed.claimToken, buyerId: buyer, cardToken: "tok_mock_ok_4242" })
    ).rejects.toMatchObject({ status: 502, code: "TRANSFER_PAYMENT_FAILED" });

    await expectUnchanged(bookingId, listed.id, "CAPTURE_FAILED");
    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });
    expect(psp.voids).toEqual([transfer.buyerPaymentRef]);
    expect(psp.refunds).toEqual([]);
    // Başarısız devirden sonra satıcı yeniden listeleyebilir.
    await expect(listBookingForTransfer(bookingId, seller, 150_000)).resolves.toMatchObject({
      status: "LISTED",
    });
  });

  it("saga hata enjeksiyonu (capture adımı) → aynı telafi", async () => {
    const psp = new ScriptedPsp();
    setPaymentProviderForTests(psp);
    injectSagaFaultForTests(TRANSFER_SAGA, TRANSFER_SAGA_STEPS.capture);
    const bookingId = await confirmedBooking();
    const listed = await listBookingForTransfer(bookingId, seller, 150_000);

    await expect(
      claimTransfer({ token: listed.claimToken, buyerId: buyer, cardToken: "tok_mock_ok_4242" })
    ).rejects.toMatchObject({ code: "TRANSFER_PAYMENT_FAILED" });
    await expectUnchanged(bookingId, listed.id, "CAPTURE_FAILED");
    expect(psp.captures).toEqual([]);
    expect(psp.voids).toHaveLength(1);
  });

  it("capture sonrası commit düşerse (satıcı iptal etti) tahsilat alıcıya iade edilir", async () => {
    let bookingId = "";
    const psp = new ScriptedPsp(async () => {
      // Tahsilat sürerken rezervasyon satıcı tarafından iptal edildi.
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CANCELLED },
      });
    });
    setPaymentProviderForTests(psp);
    bookingId = await confirmedBooking();
    const listed = await listBookingForTransfer(bookingId, seller, 150_000);

    await expect(
      claimTransfer({ token: listed.claimToken, buyerId: buyer, cardToken: "tok_mock_ok_4242" })
    ).rejects.toMatchObject({ status: 409, code: "BOOKING_CHANGED" });

    await expectUnchanged(bookingId, listed.id, "COMMIT_FAILED");
    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });
    expect(psp.refunds).toEqual([{ ref: transfer.buyerPaymentRef, amount: 150_000 }]);
    expect(psp.voids).toEqual([]);
  });

  it("capture sürerken CAPTURE_PENDING: sahiplik henüz satıcıda, yeniden listeleme 409; sonra COMPLETED", async () => {
    let bookingId = "";
    let transferId = "";
    const seen: Array<{ status: string; owner: string; payouts: number }> = [];
    let relist: unknown = null;
    const psp = new ScriptedPsp(async () => {
      const t = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: transferId } });
      const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      seen.push({
        status: t.status,
        owner: b.userId,
        payouts: await prisma.payout.count({ where: { transferId } }),
      });
      relist = await listBookingForTransfer(bookingId, seller, 100_000).catch((e) => e);
    });
    setPaymentProviderForTests(psp);
    bookingId = await confirmedBooking();
    const listed = await listBookingForTransfer(bookingId, seller, 150_000);
    transferId = listed.id;

    const res = await claimTransfer({
      token: listed.claimToken,
      buyerId: buyer,
      cardToken: "tok_mock_ok_4242",
    });
    expect(res.status).toBe("COMPLETED");
    expect(seen).toEqual([{ status: "CAPTURE_PENDING", owner: seller, payouts: 0 }]);
    expect(relist).toMatchObject({ status: 409, code: "TRANSFER_PENDING" });

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.userId).toBe(buyer);
    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: transferId } });
    expect(transfer.status).toBe("COMPLETED");
    expect(psp.captures).toEqual([transfer.buyerPaymentRef]);
    expect(await prisma.payout.count({ where: { transferId } })).toBe(1);
    expect(await transferLedger(bookingId)).toEqual({ count: 2, net: 0 });
  });
  /** Çöken süreç simülasyonu: ilan CAPTURE_PENDING'de, `minutesAgo` dakika önce talep edilmiş. */
  async function stuckTransfer(minutesAgo: number) {
    const bookingId = await confirmedBooking();
    const listed = await listBookingForTransfer(bookingId, seller, 150_000);
    await prisma.bookingTransfer.update({
      where: { id: listed.id },
      data: {
        status: "CAPTURE_PENDING",
        claimedById: buyer,
        claimedAt: new Date(Date.now() - minutesAgo * 60_000),
        buyerPaymentRef: `pi_v4stuck_${listed.id}`,
      },
    });
    return { bookingId, transferId: listed.id, ref: `pi_v4stuck_${listed.id}` };
  }

  it("regression: v4#1 takılı CAPTURE_PENDING süpürülür: void + FAILED + audit, yeniden listelenebilir", async () => {
    const psp = new ScriptedPsp();
    const old = await stuckTransfer(60);
    const fresh = await stuckTransfer(1);
    const res = await sweepStuckTransfers(new Date(), psp);
    expect(res.swept).toBeGreaterThanOrEqual(1);

    await expectUnchanged(old.bookingId, old.transferId, "CAPTURE_TIMEOUT");
    expect(psp.voids).toContain(old.ref);
    expect(psp.refunds).toEqual([]);
    expect(
      await prisma.auditLog.findFirst({
        where: { action: "transfer.capture_timeout", entityId: old.transferId },
      })
    ).toMatchObject({ actorId: "system:transfer-sweep", meta: { outcome: "voided" } });
    // Eşik altındaki (saga hâlâ sürüyor olabilir) kayda dokunulmaz.
    expect(
      (await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: fresh.transferId } })).status
    ).toBe("CAPTURE_PENDING");
    expect(psp.voids).not.toContain(fresh.ref);
    // Blok kalktı: satıcı yeniden listeleyebilir.
    await expect(listBookingForTransfer(old.bookingId, seller, 150_000)).resolves.toMatchObject({
      id: expect.any(String),
    });
    // İkinci süpürme aynı kaydı tekrar işlemez.
    await sweepStuckTransfers(new Date(), psp);
    expect(psp.voids.filter((r) => r === old.ref)).toHaveLength(1);
  });

  it("regression: v4#1 void edilemeyen (capture yapılmış) takılı devir saga anahtarıyla iade edilir", async () => {
    const psp = new ScriptedPsp();
    psp.void = async () => {
      throw new Error("already captured");
    };
    const stuck = await stuckTransfer(60);
    await sweepStuckTransfers(new Date(), psp);
    await expectUnchanged(stuck.bookingId, stuck.transferId, "CAPTURE_TIMEOUT");
    expect(psp.refunds).toContainEqual({ ref: stuck.ref, amount: 150_000 });
    expect(
      await prisma.auditLog.findFirst({
        where: { action: "transfer.capture_timeout", entityId: stuck.transferId },
      })
    ).toMatchObject({ meta: { outcome: "refunded" } });
  });

  it("regression: aynı alıcının eşzamanlı iki claim'i → biri COMPLETED, diğeri 409; kazananın provizyonu void edilmez", async () => {
    const psp = new StripeLikePsp(2);
    setPaymentProviderForTests(psp);
    const bookingId = await confirmedBooking();
    const listed = await listBookingForTransfer(bookingId, seller, 150_000);

    const claim = () =>
      claimTransfer({ token: listed.claimToken, buyerId: buyer, cardToken: "tok_mock_ok_4242" });
    const results = await Promise.allSettled([claim(), claim()]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toMatchObject({ status: 409 });

    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });
    expect(transfer.status).toBe("COMPLETED");
    expect(psp.captures).toEqual([transfer.buyerPaymentRef]);
    expect(psp.voids).not.toContain(transfer.buyerPaymentRef);
    expect(psp.refunds).toEqual([]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId).toBe(
      buyer
    );
    expect(await prisma.payout.count({ where: { transferId: listed.id } })).toBe(1);
    expect(await transferLedger(bookingId)).toEqual({ count: 2, net: 0 });
  });

  it("regression: kart reddinden sonra farklı kartla yeniden deneme yeni anahtarla başarılı olur", async () => {
    const psp = new StripeLikePsp();
    setPaymentProviderForTests(psp);
    const bookingId = await confirmedBooking();
    const listed = await listBookingForTransfer(bookingId, seller, 150_000);

    await expect(
      claimTransfer({
        token: listed.claimToken,
        buyerId: buyer,
        cardToken: "tok_mock_decline_0002",
      })
    ).rejects.toMatchObject({ status: 402, code: "PAYMENT_DECLINED" });

    const res = await claimTransfer({
      token: listed.claimToken,
      buyerId: buyer,
      cardToken: "tok_mock_ok_4242",
    });
    expect(res.status).toBe("COMPLETED");
    expect(psp.keys).toHaveLength(2);
    expect(new Set(psp.keys).size).toBe(2);

    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });
    expect(transfer.status).toBe("COMPLETED");
    expect(transfer.claimedById).toBe(buyer);
    expect(psp.captures).toEqual([transfer.buyerPaymentRef]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId).toBe(
      buyer
    );
  });
});
