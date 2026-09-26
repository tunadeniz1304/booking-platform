import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { withSerializableRetry } from "@/lib/db/transactions";
import {
  account,
  bookingCaptured,
  getAccountBalance,
  isTrialBalanced,
  LedgerError,
  listBookingLedger,
  netChargedMinor,
  noteLedgerTriggerViolation,
  post,
  postJournal,
  reconcile,
  refundIssued,
  trialBalance,
} from "@/lib/ledger";
import { signAccessToken } from "@/lib/auth/tokens";
import { GET as reconciliationGet } from "@/app/api/admin/reconciliation/route";
import { runLedgerReconcile } from "@/worker/jobs/ledger-reconcile";

/** Diğer test dosyalarının verisiyle çakışmayan uzak tarihler (mutabakat günleri). */
const CLEAN_DAY = "2031-03-10";
const DIFF_DAY = "2031-03-11";
const at = (day: string, hh = "12") => new Date(`${day}T${hh}:00:00.000Z`);

describeInt("P0-3 çift girişli defter (jurnal, tetik, idempotency, mutabakat)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v4-ledger", days: 90 });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function paidPayment(opts: {
    amount: string;
    paidAt: Date;
    refunded?: string;
    refundedAt?: Date;
  }) {
    const b = await fx.hold();
    return prisma.payment.create({
      data: {
        bookingId: b.id,
        userId: fx.userId,
        amount: new Prisma.Decimal(opts.amount),
        currency: "TRY",
        provider: "mock",
        providerRef: `pi_ledger_${randomUUID()}`,
        status: opts.refunded ? "PARTIALLY_REFUNDED" : "PAID",
        paidAt: opts.paidAt,
        refundedAmount: new Prisma.Decimal(opts.refunded ?? "0"),
        refundedAt: opts.refundedAt ?? null,
      },
    });
  }

  it("şablon aynı işlemde yazılır; hesap bakiyeleri ve mizan dengeli", async () => {
    const b = await fx.hold();
    const paymentId = `pay_${randomUUID()}`;
    const res = await withSerializableRetry((tx) =>
      post.bookingCaptured(tx, {
        bookingId: b.id,
        paymentId,
        currency: "TRY",
        grossMinor: 120_00n,
        taxMinor: 20_00n,
      })
    );
    expect(res.created).toBe(true);
    const lines = await prisma.journalLine.findMany({ where: { entryId: res.entryId } });
    expect(lines).toHaveLength(3);

    await withSerializableRetry((tx) =>
      post.escrowReleased(tx, {
        bookingId: b.id,
        hostId: fx.hostId,
        currency: "TRY",
        amountMinor: 100_00n,
        platformFeeMinor: 15_00n,
      })
    );
    const host = await getAccountBalance(prisma, account.hostPayable(fx.hostId), "TRY");
    expect(host.balanceMinor).toBe(85_00n);
    expect(host.code).toBe(`host_payable:${fx.hostId}`);
    const none = await getAccountBalance(prisma, account.guestCredit("nobody"), "TRY");
    expect(none.balanceMinor).toBe(0n);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });

  it("idempotency: aynı anahtar tek jurnal (eşzamanlı dahil), farklı içerik 409", async () => {
    const input = bookingCaptured({
      bookingId: "b-idem",
      paymentId: `pay_${randomUUID()}`,
      currency: "TRY",
      grossMinor: 50_00n,
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => withSerializableRetry((tx) => postJournal(tx, input)))
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.entryId)).size).toBe(1);
    expect(
      await prisma.journalEntry.count({ where: { idempotencyKey: input.idempotencyKey } })
    ).toBe(1);
    expect(await prisma.journalLine.count({ where: { entryId: results[0].entryId } })).toBe(2);

    const again = await withSerializableRetry((tx) => postJournal(tx, input));
    expect(again).toEqual({ entryId: results[0].entryId, created: false });

    const changed = { ...input, lines: input.lines.map((l) => ({ ...l, amountMinor: 51_00n })) };
    const err = await withSerializableRetry((tx) => postJournal(tx, changed)).catch((e) => e);
    expect(err).toBeInstanceOf(LedgerError);
    expect((err as LedgerError).code).toBe("LEDGER_IDEMPOTENCY_CONFLICT");
  });

  it("DB tetiği dengesiz / satırsız jurnali reddeder (assertBalanced atlansa bile); defter yalnızca eklenir", async () => {
    const psp = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: "psp_clearing" } });
    const esc = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: "escrow" } });

    /** assertBalanced'ı atlayan hatalı kod yolu: doğrudan Prisma yazımı. */
    async function rawJournal(
      tx: Prisma.TransactionClient,
      lines: Array<[string, "DEBIT" | "CREDIT", bigint, string]>
    ): Promise<string> {
      const id = randomUUID();
      await tx.journalEntry.create({
        data: {
          id,
          idempotencyKey: `bad:${id}`,
          kind: "TEST",
          linesHash: "x",
          occurredAt: new Date(),
        },
      });
      if (lines.length > 0) {
        await tx.journalLine.createMany({
          data: lines.map(([accountId, side, amountMinor, currency]) => ({
            entryId: id,
            accountId,
            side,
            amountMinor,
            currency,
          })),
        });
      }
      return id;
    }
    const immediate = (tx: Prisma.TransactionClient) =>
      tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

    // 1) Ertelenmiş kontrol COMMIT'te: satırlar kalıcı olmaz (Prisma 5 COMMIT hatasını
    //    iletmese de veritabanı işlemi geri alır).
    let deferredId = "";
    await prisma
      .$transaction(async (tx) => {
        deferredId = await rawJournal(tx, [
          [psp.id, "DEBIT", 100n, "TRY"],
          [esc.id, "CREDIT", 99n, "TRY"],
        ]);
      })
      .catch(() => undefined);
    expect(await prisma.journalEntry.count({ where: { id: deferredId } })).toBe(0);
    expect(await prisma.journalLine.count({ where: { entryId: deferredId } })).toBe(0);

    // 2) Kontrol işlem içinde zorlanınca hata görünür: tutar farkı, para birimi farkı, satırsız.
    const cases: Array<Array<[string, "DEBIT" | "CREDIT", bigint, string]>> = [
      [
        [psp.id, "DEBIT", 100n, "TRY"],
        [esc.id, "CREDIT", 99n, "TRY"],
      ],
      [
        [psp.id, "DEBIT", 100n, "TRY"],
        [esc.id, "CREDIT", 100n, "USD"],
      ],
      [],
    ];
    for (const lines of cases) {
      const err = await prisma
        .$transaction(async (tx) => {
          await rawJournal(tx, lines);
          await immediate(tx);
        })
        .catch((e) => e);
      expect(String(err)).toMatch(/ledger_unbalanced/);
      expect(noteLedgerTriggerViolation(err)).toBe(true);
    }
    expect(noteLedgerTriggerViolation(new Error("başka hata"))).toBe(false);

    // 3) postJournal, aynı işlemdeki bekleyen dengesiz yazımı kendi içinde yakalar.
    const viaPost = await prisma
      .$transaction(async (tx) => {
        await rawJournal(tx, [
          [psp.id, "DEBIT", 5n, "TRY"],
          [esc.id, "CREDIT", 4n, "TRY"],
        ]);
        await post.escrowHeld(tx, { reference: randomUUID(), currency: "TRY", amountMinor: 1n });
      })
      .catch((e) => e);
    expect(String(viaPost)).toMatch(/ledger_unbalanced/);

    // 4) Aynı işlemde birden çok şablon: yeniden DEFERRED olduğu için ikinci başlık engellenmez.
    await withSerializableRetry(async (tx) => {
      await post.escrowHeld(tx, { reference: randomUUID(), currency: "TRY", amountMinor: 7n });
      await post.escrowHeld(tx, { reference: randomUUID(), currency: "EUR", amountMinor: 9n });
    });

    const existing = await prisma.journalLine.findFirstOrThrow();
    await expect(
      prisma.journalLine.update({ where: { id: existing.id }, data: { amountMinor: 1n } })
    ).rejects.toThrow(/ledger_immutable/);
    await expect(prisma.journalEntry.delete({ where: { id: existing.entryId } })).rejects.toThrow(
      /ledger_immutable/
    );
  });

  it("mutabakat: PSP ↔ jurnal farkı 0 (ödeme + devir) → ok; iş ve admin route aynı sonucu verir", async () => {
    const p = await paidPayment({ amount: "150.00", paidAt: at(CLEAN_DAY) });
    await withSerializableRetry((tx) =>
      post.bookingCaptured(tx, {
        bookingId: p.bookingId,
        paymentId: p.id,
        currency: "TRY",
        grossMinor: 150_00n,
        taxMinor: 25_00n,
        occurredAt: at(CLEAN_DAY),
      })
    );
    const tb = await fx.hold();
    const transfer = await prisma.bookingTransfer.create({
      data: {
        bookingId: tb.id,
        sellerId: fx.userId,
        status: "COMPLETED",
        askPrice: new Prisma.Decimal("80.00"),
        currency: "TRY",
        tokenHash: `th_${randomUUID()}`,
        expiresAt: at(CLEAN_DAY, "23"),
        completedAt: at(CLEAN_DAY, "10"),
        buyerPaymentRef: `pi_buyer_${randomUUID()}`,
      },
    });
    await withSerializableRetry((tx) =>
      post.transferSettled(tx, {
        transferId: transfer.id,
        bookingId: tb.id,
        sellerId: fx.userId,
        currency: "TRY",
        askMinor: 80_00n,
        platformFeeMinor: 4_00n,
        occurredAt: at(CLEAN_DAY, "10"),
      })
    );
    await prisma.paymentEvent.create({
      data: {
        id: `evt_${randomUUID()}`,
        type: "payment.succeeded",
        providerRef: p.providerRef,
        receivedAt: at(CLEAN_DAY),
      },
    });

    const report = await reconcile(CLEAN_DAY);
    expect(report.differences).toEqual([]);
    expect(report.imbalancedEntries).toBe(0);
    expect(report.orphanEvents).toEqual([]);
    expect(report.checked).toBe(3);
    expect(report.ok).toBe(true);

    const summary = await runLedgerReconcile(at("2031-03-11", "03"));
    expect(summary).toMatchObject({ date: CLEAN_DAY, differences: 0, imbalancedEntries: 0 });

    const { token } = await signAccessToken("u-admin-ledger", "ADMIN", 900);
    const res = await reconciliationGet(
      new NextRequest(`http://localhost/api/admin/reconciliation?date=${CLEAN_DAY}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ date: CLEAN_DAY, ok: true, differences: [] });
    const bad = await reconciliationGet(
      new NextRequest(`http://localhost/api/admin/reconciliation?date=2031-02-30`, {
        headers: { authorization: `Bearer ${token}` },
      })
    );
    expect(bad.status).toBe(400);
  });

  it("mutabakat farkı yakalar: eksik tahsilat tutarı, jurnalsiz iade, sahipsiz PSP olayı", async () => {
    const short = await paidPayment({ amount: "200.00", paidAt: at(DIFF_DAY) });
    await withSerializableRetry((tx) =>
      post.bookingCaptured(tx, {
        bookingId: short.bookingId,
        paymentId: short.id,
        currency: "TRY",
        grossMinor: 190_00n,
        occurredAt: at(DIFF_DAY),
      })
    );
    const refunded = await paidPayment({
      amount: "100.00",
      paidAt: at("2031-03-01"),
      refunded: "40.00",
      refundedAt: at(DIFF_DAY, "15"),
    });
    await withSerializableRetry((tx) =>
      post.bookingCaptured(tx, {
        bookingId: refunded.bookingId,
        paymentId: refunded.id,
        currency: "TRY",
        grossMinor: 100_00n,
        occurredAt: at("2031-03-01"),
      })
    );
    // İadenin yalnızca 25,00'i jurnalde; ayrıca krediye yapılan iade PSP farkına sayılmaz.
    await withSerializableRetry((tx) =>
      postJournal(
        tx,
        refundIssued({
          refundRef: `re_${randomUUID()}`,
          bookingId: refunded.bookingId,
          paymentId: refunded.id,
          guestId: fx.userId,
          currency: "TRY",
          amountMinor: 25_00n,
          from: "escrow",
          occurredAt: at(DIFF_DAY, "15"),
        })
      )
    );
    await withSerializableRetry((tx) =>
      post.refundIssued(tx, {
        refundRef: `re_credit_${randomUUID()}`,
        bookingId: refunded.bookingId,
        paymentId: refunded.id,
        guestId: fx.userId,
        currency: "TRY",
        amountMinor: 10_00n,
        from: "escrow",
        to: "guest_credit",
        occurredAt: at(DIFF_DAY, "16"),
      })
    );
    const orphanRef = `pi_orphan_${randomUUID()}`;
    await prisma.paymentEvent.create({
      data: {
        id: `evt_${randomUUID()}`,
        type: "payment.succeeded",
        providerRef: orphanRef,
        receivedAt: at(DIFF_DAY),
      },
    });

    const report = await reconcile(DIFF_DAY);
    expect(report.ok).toBe(false);
    const rows = report.differences.map((d) => [
      d.subjectId,
      d.kind,
      d.pspMinor,
      d.journalMinor,
      d.diffMinor,
    ]);
    expect(rows).toContainEqual([short.id, "capture", 200_00n, 190_00n, 10_00n]);
    expect(rows).toContainEqual([refunded.id, "refund", 40_00n, 25_00n, 15_00n]);
    expect(report.differences).toHaveLength(2);
    expect(report.orphanEvents.map((e) => e.providerRef)).toEqual([orphanRef]);

    const summary = await runLedgerReconcile(at("2031-03-12", "03"));
    expect(summary).toMatchObject({ date: DIFF_DAY, differences: 2, orphanEvents: 1 });
  });

  it("eski LedgerEntry uyumluluğu: dual-write çift sayılmaz, jurnal-yalnız iade türetilir", async () => {
    const p = await paidPayment({ amount: "300.00", paidAt: at("2031-04-01") });
    await prisma.ledgerEntry.create({
      data: {
        bookingId: p.bookingId,
        userId: fx.userId,
        kind: "CHARGE",
        amount: new Prisma.Decimal("300.00"),
        currency: "TRY",
        reference: p.providerRef,
      },
    });
    await withSerializableRetry(async (tx) => {
      await post.bookingCaptured(tx, {
        bookingId: p.bookingId,
        paymentId: p.id,
        currency: "TRY",
        grossMinor: 300_00n,
        occurredAt: at("2031-04-01"),
      });
      await post.refundIssued(tx, {
        refundRef: `re_${randomUUID()}`,
        bookingId: p.bookingId,
        paymentId: p.id,
        guestId: fx.userId,
        currency: "TRY",
        amountMinor: 120_00n,
        taxMinor: 20_00n,
        from: "escrow",
        occurredAt: at("2031-04-02"),
      });
    });
    const rows = await listBookingLedger(prisma, p.bookingId);
    expect(rows.map((r) => [r.source, r.kind, r.amountMinor])).toEqual([
      ["legacy", "CHARGE", 300_00n],
      ["journal", "REFUND", 120_00n],
    ]);
    expect(netChargedMinor(rows, "TRY")).toBe(180_00n);

    // Devir: jurnalden TRANSFER_PAYMENT + TRANSFER_PAYOUT türetilir.
    const tb = await fx.hold();
    const t = await prisma.bookingTransfer.create({
      data: {
        bookingId: tb.id,
        sellerId: fx.userId,
        claimedById: fx.hostId,
        status: "COMPLETED",
        askPrice: new Prisma.Decimal("60.00"),
        tokenHash: `th_${randomUUID()}`,
        expiresAt: at("2031-04-05"),
        completedAt: at("2031-04-03"),
        buyerPaymentRef: `pi_buyer_${randomUUID()}`,
      },
    });
    await withSerializableRetry((tx) =>
      post.transferSettled(tx, {
        transferId: t.id,
        bookingId: tb.id,
        sellerId: fx.userId,
        currency: "TRY",
        askMinor: 60_00n,
        occurredAt: at("2031-04-03"),
      })
    );
    const trows = await listBookingLedger(prisma, tb.id);
    expect(trows.map((r) => [r.kind, r.userId, r.reference, r.amountMinor])).toEqual([
      ["TRANSFER_PAYMENT", fx.hostId, t.buyerPaymentRef, 60_00n],
      ["TRANSFER_PAYOUT", fx.userId, t.id, 60_00n],
    ]);
  });
});
