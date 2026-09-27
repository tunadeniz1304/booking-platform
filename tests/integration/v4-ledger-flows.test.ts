// F2c (P0-3 KK): gerçek para akışları çift girişli deftere bağlı — her adımdan sonra mizan
// dengede, günlük mutabakat farkı 0, ledger_imbalance_total değişmez.
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import fc from "fast-check";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, ledgerNetMinor, type StayFixture } from "./fixtures";
import {
  cancelAndRefund,
  confirmPaymentChallenge,
  payForBooking,
} from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import {
  claimTransfer,
  listBookingForTransfer,
  sweepStuckTransfers,
} from "@/lib/transfer/transfer-service";
import { getConfig } from "@/lib/config/app-config";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import { ALREADY_CAPTURED_CODE, PaymentProviderError } from "@/lib/payment/provider";
import { runPayouts } from "@/worker/jobs/payouts";
import {
  isTrialBalanced,
  ledgerImbalanceTotal,
  postCaptureCompensation,
  reconcile,
  taxShareMinor,
  trialBalance,
} from "@/lib/ledger";

type Net = Record<string, bigint>;

describeInt("F2c defter bağlama: rezervasyon → ödeme → iade → iptal → devir → payout", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let buyer = "";
  let key = 0;
  const touched = { payments: new Set<string>(), transfers: new Set<string>() };

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v4-ledger-flows", days: 160, country: "Türkiye" });
    buyer = (
      await prisma.user.create({
        data: {
          email: `lf-buyer-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: "Alıcı",
          lastName: "Test",
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
  });
  afterEach(() => setPaymentProviderForTests(null));
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function imbalanceCount(): Promise<number> {
    const m = await ledgerImbalanceTotal.get();
    return m.values.reduce((s, v) => s + v.value, 0);
  }

  async function pay(bookingId: string) {
    let out = await payForBooking({
      bookingId,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `lf-${++key}`,
    });
    // Hız kuralı çok sayıda ödemede 3DS ister → mock kodla tamamla (defter aynı yoldan yazılır).
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({ bookingId, userId: fx.userId, code: MOCK_3DS_CODE });
    }
    expect(out.status).toBe("confirmed");
    const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
    touched.payments.add(p.id);
    return p;
  }

  /** Rezervasyon(lar)ın jurnal satırlarından hesap türü başına doğal bakiye. */
  async function netByKind(bookingIds: string[]): Promise<Net> {
    const lines = await prisma.journalLine.findMany({
      where: { entry: { bookingId: { in: bookingIds } } },
      select: { side: true, amountMinor: true, account: { select: { kind: true } } },
    });
    const out: Net = {};
    for (const l of lines) {
      const debitNormal = ["PSP_CLEARING", "GUEST_RECEIVABLE"].includes(l.account.kind);
      const sign = (l.side === "DEBIT") === debitNormal ? 1n : -1n;
      out[l.account.kind] = (out[l.account.kind] ?? 0n) + sign * l.amountMinor;
    }
    return out;
  }

  /** Mizan dengede + dokunulan her gün için mutabakatta (bu dosyanın özneleri) fark 0. */
  async function assertBooksClean(): Promise<void> {
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    const payments = await prisma.payment.findMany({
      where: { id: { in: [...touched.payments] } },
      select: { paidAt: true, refundedAt: true },
    });
    const transfers = await prisma.bookingTransfer.findMany({
      where: { id: { in: [...touched.transfers] } },
      select: { completedAt: true, failedAt: true },
    });
    const days = new Set<string>();
    for (const d of [
      ...payments.flatMap((p) => [p.paidAt, p.refundedAt]),
      ...transfers.flatMap((t) => [t.completedAt, t.failedAt]),
    ]) {
      if (d) days.add(d.toISOString().slice(0, 10));
    }
    const mine = new Set([...touched.payments, ...touched.transfers]);
    for (const day of days) {
      const report = await reconcile(day, prisma);
      expect(report.imbalancedEntries).toBe(0);
      expect(report.differences.filter((d) => mine.has(d.subjectId))).toEqual([]);
    }
    expect(await imbalanceCount()).toBe(0);
  }

  it("senaryo: ödeme → kısmi iade → tam iptal → devir → payout → devredilmiş iptal", async () => {
    expect(await imbalanceCount()).toBe(0);

    // 1) Rezervasyon + ödeme: Dr psp_clearing brüt / Cr escrow + tax_payable.
    const a = await fx.hold({ nights: 2 });
    const pa = await pay(a.id);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: a.id } });
    const taxA = taxShareMinor(booking.priceBreakdown, pa.amountMinor);
    expect(taxA).toBeGreaterThan(0n);
    expect(await netByKind([a.id])).toEqual({
      PSP_CLEARING: pa.amountMinor,
      ESCROW: pa.amountMinor - taxA,
      TAX_PAYABLE: taxA,
    });
    expect(await ledgerNetMinor(prisma, a.id)).toBe(a.totalMinor); // dual-write çift sayılmaz
    await assertBooksClean();

    // 2) Kısmi iade (MODERATE, girişe 48 saat → %50).
    const checkIn = new Date(`${a.checkIn}T12:00:00.000Z`);
    const partial = await cancelAndRefund(
      a.id,
      fx.userId,
      new Date(checkIn.getTime() - 48 * 3_600_000)
    );
    expect(partial.refund.refundPercent).toBe(50);
    const refundA = BigInt(partial.refund.refundMinor);
    const netA = await netByKind([a.id]);
    expect(netA.PSP_CLEARING).toBe(pa.amountMinor - refundA);
    expect(netA.ESCROW! + netA.TAX_PAYABLE!).toBe(pa.amountMinor - refundA);
    expect(await ledgerNetMinor(prisma, a.id)).toBe(a.totalMinor - Number(refundA));
    await assertBooksClean();

    // 3) Tam iptal (%100): emanet ve vergi bu rezervasyon için sıfırlanır.
    const b = await fx.hold({ nights: 1 });
    await pay(b.id);
    const full = await cancelAndRefund(b.id, fx.userId);
    expect(full.refund.refundPercent).toBe(100);
    expect(await netByKind([b.id])).toEqual({ PSP_CLEARING: 0n, ESCROW: 0n, TAX_PAYABLE: 0n });
    expect(await ledgerNetMinor(prisma, b.id)).toBe(0);
    await assertBooksClean();

    // 4) Devir: alıcının ödemesi satıcıya borç (host_payable), sonra payout.
    const c = await fx.hold({ nights: 2 });
    const pc = await pay(c.id);
    const ask = Math.floor(c.totalMinor / 2);
    const listed = await listBookingForTransfer(c.id, fx.userId, ask);
    touched.transfers.add(listed.id);
    const claimed = await claimTransfer({
      token: listed.claimToken,
      buyerId: buyer,
      cardToken: "tok_mock_ok_4242",
    });
    expect(claimed.status).toBe("COMPLETED");
    let netC = await netByKind([c.id]);
    expect(netC.PSP_CLEARING).toBe(pc.amountMinor + BigInt(ask));
    expect(netC.HOST_PAYABLE).toBe(BigInt(ask));
    await assertBooksClean();

    await runPayouts();
    netC = await netByKind([c.id]);
    expect(netC.HOST_PAYABLE).toBe(0n);
    expect(netC.PSP_CLEARING).toBe(pc.amountMinor);
    await assertBooksClean();

    // 5) Devredilmiş rezervasyonu alıcı iptal eder: iade alıcının devir ödemesine, emanetten.
    const cancelled = await cancelAndRefund(c.id, buyer);
    const refundC = BigInt(cancelled.refund.refundMinor);
    expect(refundC).toBeGreaterThan(0n);
    expect(refundC).toBeLessThanOrEqual(BigInt(ask));
    netC = await netByKind([c.id]);
    expect(netC.PSP_CLEARING).toBe(pc.amountMinor - refundC);
    expect(netC.ESCROW! + netC.TAX_PAYABLE!).toBe(pc.amountMinor - refundC);
    await assertBooksClean();
  });

  it("regression: v2-P0-3 devir capture telafisi jurnale yazılır (capture + iade, psp net 0); tekrar yazılmaz", async () => {
    const bk = await fx.hold({ nights: 1 });
    await pay(bk.id);
    const ask = Math.max(1, Math.floor(bk.totalMinor / 2));
    const listed = await listBookingForTransfer(bk.id, fx.userId, ask);
    touched.transfers.add(listed.id);
    // Tahsilat sürerken satıcı rezervasyonu iptal eder → commit düşer, saga tahsilatı iade eder.
    class CancellingPsp extends MockPsp {
      async capture(...args: Parameters<MockPsp["capture"]>) {
        await prisma.booking.update({ where: { id: bk.id }, data: { status: "CANCELLED" } });
        return super.capture(...args);
      }
    }
    setPaymentProviderForTests(new CancellingPsp());
    await expect(
      claimTransfer({ token: listed.claimToken, buyerId: buyer, cardToken: "tok_mock_ok_4242" })
    ).rejects.toMatchObject({ status: 409, code: "BOOKING_CHANGED" });
    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });
    expect(transfer.status).toBe("FAILED");
    expect(transfer.failureCode).toBe("COMMIT_FAILED");

    const transferJournal = async () => {
      const entries = await prisma.journalEntry.findMany({
        where: { transferId: listed.id },
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
    };
    const expected = {
      kinds: ["BOOKING_CAPTURED", "REFUND_ISSUED"],
      psp: 0n,
      captured: BigInt(ask),
    };
    expect(await transferJournal()).toEqual(expected);
    await assertBooksClean();

    // Aynı telafi yeniden (aynı iade anahtarı) → jurnal yeniden yazılmaz.
    const replayed = await prisma.$transaction((tx) =>
      postCaptureCompensation(tx, {
        refundRef: `transfer-refund:${listed.id}`,
        currency: transfer.currency,
        amountMinor: transfer.askPriceMinor,
        bookingId: bk.id,
        transferId: listed.id,
      })
    );
    expect(replayed).toBe(false);
    expect(await transferJournal()).toEqual(expected);
    await assertBooksClean();
  });

  /** Devrin jurnal türleri, psp_clearing neti ve tahsilat (Dr psp_clearing) toplamı. */
  async function transferJournalOf(transferId: string) {
    const entries = await prisma.journalEntry.findMany({
      where: { transferId },
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

  /** Capture yapılmış yetkilendirme void edilemez (Stripe semantiği); iadeleri kaydeder. */
  class CapturedPsp extends MockPsp {
    captured = new Set<string>();
    refundKeys: string[] = [];
    constructor(private readonly afterCapture: () => Promise<void> = async () => {}) {
      super();
    }
    async capture(...args: Parameters<MockPsp["capture"]>) {
      const res = await super.capture(...args);
      if (args[0]) this.captured.add(args[0]);
      await this.afterCapture();
      return res;
    }
    async void(ref?: string): ReturnType<MockPsp["void"]> {
      if (ref && this.captured.has(ref)) {
        throw new PaymentProviderError(ALREADY_CAPTURED_CODE, "already captured");
      }
      return super.void();
    }
    async refund(...args: Parameters<MockPsp["refund"]>) {
      this.refundKeys.push(args[2]);
      return super.refund(...args);
    }
  }

  it("regression: v2-P0-3 süpürücü ↔ saga yarışı: iki telafi de koşar, jurnal tek çift, mutabakat temiz", async () => {
    const bk = await fx.hold({ nights: 1 });
    await pay(bk.id);
    const ask = Math.max(1, Math.floor(bk.totalMinor / 2));
    const listed = await listBookingForTransfer(bk.id, fx.userId, ask);
    touched.transfers.add(listed.id);
    // Capture tamamlandıktan hemen sonra süpürücü eşiği aşılmış sayar (süreç takıldı) → FAILED +
    // CAPTURE_TIMEOUT, void düşer → iade. Ardından saganın commit'i ALREADY_CLAIMED ile düşer ve
    // kendi capture telafisi aynı anahtarla yeniden iade eder.
    const later = () =>
      new Date(Date.now() + (getConfig().TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS + 60) * 1000);
    const psp: CapturedPsp = new CapturedPsp(async () => {
      await sweepStuckTransfers(later(), psp);
    });
    setPaymentProviderForTests(psp);
    await expect(
      claimTransfer({ token: listed.claimToken, buyerId: buyer, cardToken: "tok_mock_ok_4242" })
    ).rejects.toMatchObject({ status: 409, code: "ALREADY_CLAIMED" });

    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });
    expect(transfer).toMatchObject({ status: "FAILED", failureCode: "CAPTURE_TIMEOUT" });
    expect(psp.refundKeys.filter((k) => k === `transfer-refund:${listed.id}`)).toHaveLength(2);
    expect(await transferJournalOf(listed.id)).toEqual({
      kinds: ["BOOKING_CAPTURED", "REFUND_ISSUED"],
      psp: 0n,
      captured: BigInt(ask),
    });
    await assertBooksClean();
  });

  /** Çöken süreç simülasyonu: ilan CAPTURE_PENDING'de, eşikten eski, capture yapılmış. */
  async function stuckCapturedTransfer() {
    const bk = await fx.hold({ nights: 1 });
    await pay(bk.id);
    const ask = Math.max(1, Math.floor(bk.totalMinor / 2));
    const listed = await listBookingForTransfer(bk.id, fx.userId, ask);
    const ref = `pi_p03stuck_${listed.id}`;
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
    return { bookingId: bk.id, transferId: listed.id, ref, ask };
  }

  it("regression: v2-P0-3 süpürücünün capture iadesi jurnale yazılır; ikinci süpürme çoğaltmaz", async () => {
    const stuck = await stuckCapturedTransfer();
    touched.transfers.add(stuck.transferId);
    const psp = new CapturedPsp();
    psp.captured.add(stuck.ref);
    await sweepStuckTransfers(new Date(), psp);
    expect(psp.refundKeys).toContain(`transfer-refund:${stuck.transferId}`);
    const expected = {
      kinds: ["BOOKING_CAPTURED", "REFUND_ISSUED"],
      psp: 0n,
      captured: BigInt(stuck.ask),
    };
    expect(await transferJournalOf(stuck.transferId)).toEqual(expected);
    await sweepStuckTransfers(new Date(), psp);
    expect(await transferJournalOf(stuck.transferId)).toEqual(expected);
    await assertBooksClean();
  });

  /** PSP iadeyi işler ama yanıt kaybolur (zaman aşımı/çökme) → çağıran jurnal yazamadan düşer. */
  class LostRefundPsp extends CapturedPsp {
    async refund(...args: Parameters<MockPsp["refund"]>): ReturnType<MockPsp["refund"]> {
      await super.refund(...args);
      throw new Error("refund response lost");
    }
  }

  /** Süpürücü eşiği (`TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS`) aşılmış bir "şimdi". */
  const afterTimeout = () =>
    new Date(Date.now() + (getConfig().TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS + 60) * 1000);

  /** Devrin bugünkü mutabakat farkları (tür sırasıyla). */
  async function transferDiffs(transferId: string) {
    const report = await reconcile(new Date().toISOString().slice(0, 10), prisma);
    return report.differences
      .filter((d) => d.subjectId === transferId)
      .map((d) => ({ subject: d.subject, kind: d.kind, psp: d.pspMinor, journal: d.journalMinor }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }

  it("regression: v2-P0-3 süpürücü iadesinden sonra jurnal yazılamazsa mutabakat raporlar, sonraki süpürme tamamlar", async () => {
    const stuck = await stuckCapturedTransfer();
    const lost = new LostRefundPsp();
    lost.captured.add(stuck.ref);
    await sweepStuckTransfers(new Date(), lost);
    expect(lost.refundKeys).toContain(`transfer-refund:${stuck.transferId}`);
    expect((await transferJournalOf(stuck.transferId)).kinds).toEqual([]);
    // PSP'de iade var, defterde yok → fark görünür olmalı (sessizce kaybolmamalı).
    expect(await transferDiffs(stuck.transferId)).toEqual([
      { subject: "transfer", kind: "capture", psp: BigInt(stuck.ask), journal: 0n },
      { subject: "transfer", kind: "refund", psp: BigInt(stuck.ask), journal: 0n },
    ]);

    // Eşik sonrası süpürme aynı iade anahtarıyla yeniden dener ve jurnali tamamlar (tek çift).
    const psp = new CapturedPsp();
    psp.captured.add(stuck.ref);
    await sweepStuckTransfers(afterTimeout(), psp);
    expect(psp.refundKeys).toContain(`transfer-refund:${stuck.transferId}`);
    const expected = {
      kinds: ["BOOKING_CAPTURED", "REFUND_ISSUED"],
      psp: 0n,
      captured: BigInt(stuck.ask),
    };
    expect(await transferJournalOf(stuck.transferId)).toEqual(expected);
    await sweepStuckTransfers(afterTimeout(), psp);
    expect(await transferJournalOf(stuck.transferId)).toEqual(expected);
    touched.transfers.add(stuck.transferId);
    await assertBooksClean();
  });

  it("regression: v2-P0-3 saga capture telafisinde iade yanıtı kaybolursa süpürücü jurnali tamamlar", async () => {
    const bk = await fx.hold({ nights: 1 });
    await pay(bk.id);
    const ask = Math.max(1, Math.floor(bk.totalMinor / 2));
    const listed = await listBookingForTransfer(bk.id, fx.userId, ask);
    // Tahsilat sürerken satıcı rezervasyonu iptal eder → commit düşer; iade PSP'de işlenir ama
    // yanıt kaybolur → saga jurnal yazamaz.
    const lost: LostRefundPsp = new LostRefundPsp(async () => {
      await prisma.booking.update({ where: { id: bk.id }, data: { status: "CANCELLED" } });
    });
    setPaymentProviderForTests(lost);
    await expect(
      claimTransfer({ token: listed.claimToken, buyerId: buyer, cardToken: "tok_mock_ok_4242" })
    ).rejects.toBeTruthy();
    expect(lost.refundKeys).toContain(`transfer-refund:${listed.id}`);
    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });
    expect(transfer.status).toBe("FAILED");
    expect((await transferJournalOf(listed.id)).kinds).toEqual([]);
    expect(await transferDiffs(listed.id)).toEqual([
      { subject: "transfer", kind: "capture", psp: BigInt(ask), journal: 0n },
      { subject: "transfer", kind: "refund", psp: BigInt(ask), journal: 0n },
    ]);

    const psp = new CapturedPsp();
    psp.captured.add(transfer.buyerPaymentRef!);
    await sweepStuckTransfers(afterTimeout(), psp);
    expect(await transferJournalOf(listed.id)).toEqual({
      kinds: ["BOOKING_CAPTURED", "REFUND_ISSUED"],
      psp: 0n,
      captured: BigInt(ask),
    });
    touched.transfers.add(listed.id);
    await assertBooksClean();
  });

  it("regression: v2-P0-3 mutabakat jurnalsiz devir iadesini fark olarak raporlar", async () => {
    const stuck = await stuckCapturedTransfer();
    const now = new Date();
    // Jurnal yazmadan iade eden bir yol: durum FAILED + telafi işareti, jurnal yok.
    await prisma.bookingTransfer.update({
      where: { id: stuck.transferId },
      data: { status: "FAILED", failedAt: now, failureCode: "CAPTURE_TIMEOUT" },
    });
    await prisma.paymentEvent.create({
      data: {
        id: `comp:${stuck.ref}`,
        type: "compensation.transfer_capture",
        providerRef: stuck.ref,
        receivedAt: now,
      },
    });
    try {
      const report = await reconcile(now.toISOString().slice(0, 10), prisma);
      const mine = report.differences
        .filter((d) => d.subjectId === stuck.transferId)
        .map((d) => ({
          subject: d.subject,
          kind: d.kind,
          psp: d.pspMinor,
          journal: d.journalMinor,
        }))
        .sort((a, b) => a.kind.localeCompare(b.kind));
      expect(mine).toEqual([
        { subject: "transfer", kind: "capture", psp: BigInt(stuck.ask), journal: 0n },
        { subject: "transfer", kind: "refund", psp: BigInt(stuck.ask), journal: 0n },
      ]);
      expect(report.ok).toBe(false);
    } finally {
      // Paylaşımlı DB: sonraki mutabakat testleri bu kasıtlı farkı görmesin.
      await prisma.paymentEvent.delete({ where: { id: `comp:${stuck.ref}` } });
    }
  });

  it("property: rastgele akış dizileri sonrası defter dengede, mutabakat farkı 0", async () => {
    type Step = "cancelNow" | "cancelLate" | "transfer" | "transferThenCancel" | "keep";
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom<Step>(
            "cancelNow",
            "cancelLate",
            "transfer",
            "transferThenCancel",
            "keep"
          ),
          {
            minLength: 1,
            maxLength: 3,
          }
        ),
        async (steps) => {
          for (const step of steps) {
            const bk = await fx.hold({ nights: 1 });
            await pay(bk.id);
            if (step === "cancelNow") await cancelAndRefund(bk.id, fx.userId);
            if (step === "cancelLate") {
              const ci = new Date(`${bk.checkIn}T12:00:00.000Z`);
              await cancelAndRefund(bk.id, fx.userId, new Date(ci.getTime() - 30 * 3_600_000));
            }
            if (step === "transfer" || step === "transferThenCancel") {
              const listed = await listBookingForTransfer(
                bk.id,
                fx.userId,
                Math.max(1, Math.floor(bk.totalMinor / 3))
              );
              touched.transfers.add(listed.id);
              await claimTransfer({
                token: listed.claimToken,
                buyerId: buyer,
                cardToken: "tok_mock_ok_4242",
              });
              await runPayouts();
              if (step === "transferThenCancel") await cancelAndRefund(bk.id, buyer);
            }
          }
          await assertBooksClean();
        }
      ),
      { numRuns: 4 }
    );
  });
});
