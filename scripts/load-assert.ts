/**
 * P2-3 yük/kaos koşusu sonrası DEĞİŞMEZ denetimi (demo yığınında, worker konteynerinde):
 *
 *   docker compose -p <proj> exec -T worker npx tsx --conditions=react-server scripts/load-assert.ts
 *
 *  1. Aşırı satış = 0: (a) sayaç — `sold + held <= total` ve negatif sayaç yok;
 *     (b) bağımsız — envanter tüketen rezervasyonların gece başına birim toplamı ≤ total.
 *  2. Defter dengesizliği = 0: mizan (para birimi başına Σborç = Σalacak), jurnal başına
 *     denge ve bugün + dünün mutabakatı (`reconcile`: fark ve dengesiz jurnal 0).
 *  3. Çift capture = 0: ödeme başına tek BOOKING_CAPTURED jurnali, rezervasyon başına tek
 *     CHARGE kaydı; bölünmüş ödemede SETTLED olmayan planda CAPTURED pay yok ve settled
 *     planda Σ tahsil edilen pay = sepet ödemesi.
 *
 * Çıktı tek satır JSON; herhangi bir ihlal varsa çıkış kodu 1.
 */
import { prisma } from "@/lib/prisma";
import { isTrialBalanced, trialBalance } from "@/lib/ledger";
import { reconcile } from "@/lib/ledger/reconcile";

type Row = Record<string, unknown>;

async function count(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(sql);
  return Number(rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const counterOverbooked = await count(
    `SELECT count(*) AS n FROM "InventoryDay" WHERE sold + held > total OR sold < 0 OR held < 0`
  );
  const bookingOverbooked = await count(`
    SELECT count(*) AS n FROM (
      SELECT b."roomId", d::date AS day, SUM(b.units) AS used, MAX(i.total) AS total
      FROM "Booking" b
      CROSS JOIN LATERAL generate_series(b."checkIn", b."checkOut" - interval '1 day', interval '1 day') d
      JOIN "InventoryDay" i ON i."roomTypeId" = b."roomId" AND i.date = d::date
      WHERE b.status IN ('PENDING','HELD','CONFIRMED','COMPLETED')
      GROUP BY b."roomId", d::date
      HAVING SUM(b.units) > MAX(i.total)
    ) t`);
  const counterDrift = await count(`
    SELECT count(*) AS n FROM "InventoryDay" i
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(b.units), 0) AS used FROM "Booking" b
      WHERE b."roomId" = i."roomTypeId" AND b.status IN ('PENDING','HELD','CONFIRMED','COMPLETED')
        AND b."checkIn" <= i.date AND b."checkOut" > i.date
    ) u ON true
    WHERE i.date >= CURRENT_DATE AND i.sold + i.held <> u.used`);

  const balances = await trialBalance(prisma);
  const imbalancedJournals = await count(`
    SELECT count(*) AS n FROM (
      SELECT "entryId", currency FROM "JournalLine"
      GROUP BY "entryId", currency
      HAVING SUM(CASE WHEN side = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END) <> 0
    ) t`);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const recon = await Promise.all([reconcile(yesterday), reconcile(today)]);

  const doubleCaptureJournal = await count(`
    SELECT count(*) AS n FROM (
      SELECT "paymentId" FROM "JournalEntry" WHERE kind = 'BOOKING_CAPTURED' AND "paymentId" IS NOT NULL
      GROUP BY "paymentId" HAVING count(*) > 1
    ) t`);
  const doubleCaptureByBooking = await count(`
    SELECT count(*) AS n FROM (
      SELECT "bookingId" FROM "JournalEntry"
      WHERE kind = 'BOOKING_CAPTURED' AND "idempotencyKey" = 'booking-captured:' || "paymentId"
      GROUP BY "bookingId" HAVING count(*) > 1
    ) t`);
  const capturedOnOpenPlan = await count(`
    SELECT count(*) AS n FROM "PaymentShare" s JOIN "SplitPlan" p ON p.id = s."planId"
    WHERE s.status = 'CAPTURED' AND p.status <> 'SETTLED'`);
  const settledMismatch = await count(`
    SELECT count(*) AS n FROM (
      SELECT p.id FROM "SplitPlan" p
      JOIN "CartPayment" c ON c.id = p."cartPaymentId"
      JOIN "PaymentShare" s ON s."planId" = p.id
      WHERE p.status = 'SETTLED'
      GROUP BY p.id, c."amountMinor"
      HAVING SUM(CASE WHEN s.status IN ('CAPTURED','REFUNDED') THEN s."amountMinor" ELSE 0 END)
             <> c."amountMinor"
    ) t`);

  const stats: Row = Object.fromEntries(
    (
      await prisma.$queryRawUnsafe<Array<{ k: string; n: bigint }>>(`
        SELECT 'bookings_' || lower(status::text) AS k, count(*) AS n FROM "Booking" GROUP BY status
        UNION ALL SELECT 'payments_' || lower(status::text), count(*) FROM "Payment" GROUP BY status
        UNION ALL SELECT 'carts_' || lower(status::text), count(*) FROM "Cart" GROUP BY status
        UNION ALL SELECT 'split_plans_' || lower(status::text), count(*) FROM "SplitPlan" GROUP BY status
        UNION ALL SELECT 'shares_' || lower(status::text), count(*) FROM "PaymentShare" GROUP BY status
        UNION ALL SELECT 'payment_events', count(*) FROM "PaymentEvent"
        UNION ALL SELECT 'journal_entries', count(*) FROM "JournalEntry"`)
    ).map((r) => [r.k, Number(r.n)])
  );

  const result = {
    overbooking: { counterOverbooked, bookingOverbooked, counterDriftInfo: counterDrift },
    ledger: {
      trialBalanced: isTrialBalanced(balances),
      imbalancedJournals,
      reconcile: recon.map((r) => ({
        date: r.date,
        checked: r.checked,
        differences: r.differences.length,
        imbalancedEntries: r.imbalancedEntries,
        orphanEvents: r.orphanEvents.length,
      })),
    },
    doubleCapture: {
      doubleCaptureJournal,
      doubleCaptureByBooking,
      capturedOnOpenPlan,
      settledMismatch,
    },
    stats,
  };
  const violations = [
    counterOverbooked,
    bookingOverbooked,
    imbalancedJournals,
    doubleCaptureJournal,
    doubleCaptureByBooking,
    capturedOnOpenPlan,
    settledMismatch,
    ...recon.map((r) => r.differences.length + r.imbalancedEntries),
  ].reduce((a, b) => a + b, 0);
  const ok = violations === 0 && result.ledger.trialBalanced;
  console.log(JSON.stringify({ ok, ...result }));
  if (!ok) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("load-assert:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // Dolaylı içe aktarılan Redis/kuyruk bağlantıları süreci açık tutmasın.
    process.exit(process.exitCode ?? 0);
  });
