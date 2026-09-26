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
import { claimTransfer, listBookingForTransfer } from "@/lib/transfer/transfer-service";
import { setPaymentProviderForTests } from "@/lib/payment";
import { runPayouts } from "@/worker/jobs/payouts";
import {
  isTrialBalanced,
  ledgerImbalanceTotal,
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
      select: { completedAt: true },
    });
    const days = new Set<string>();
    for (const d of [
      ...payments.flatMap((p) => [p.paidAt, p.refundedAt]),
      ...transfers.map((t) => t.completedAt),
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
