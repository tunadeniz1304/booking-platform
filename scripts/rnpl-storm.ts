/**
 * v5 P2-3 — RNPL tahsilat fırtınası yardımcıları (YALNIZCA DEMO_MODE=true; yük yığınında, worker
 * konteynerinde). Rezervasyonlar `load/rnpl-charge-storm.js MODE=seed` ile API'den oluşturulur.
 *
 *   docker compose -p booking-load exec -T worker sh /usr/local/bin/entrypoint.sh \
 *     npx tsx --conditions=react-server scripts/rnpl-storm.ts trigger|verify
 *
 * - `trigger`: yük otelindeki açık (SCHEDULED) planların vadesini "şimdi"ye çeker ve her planın
 *   gecikmeli `rnpl-charge` işini AYNI ANDA öne alır (iş yoksa gecikmesiz yeniden kuyruğa koyar).
 *   Tetikleme anını `RnplStorm` Redis anahtarına yazar.
 * - `verify`: tetiklenen planlar bitene (açık plan kalmayana) ya da `STORM_TIMEOUT_S` dolana dek
 *   bekler; boşalma süresi, verim, sonuç dağılımı ve fırtınaya özgü değişmezleri tek satır JSON
 *   basar (ihlalde çıkış kodu 1). Genel değişmezler için ardından scripts/load-assert.ts.
 */
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { isDemoMode } from "@/lib/config/demo";
import { scheduleRnplCharge } from "@/lib/payment/rnpl";

const LOAD_PROPERTY_TITLE = "Yük Testi Oteli (P2-3)";
const STORM_KEY = "load:rnpl-storm";
const OPEN = ["SCHEDULED", "RETRYING"] as const;

async function trigger(): Promise<void> {
  const open = await prisma.paymentSchedule.findMany({
    where: { status: "SCHEDULED", booking: { property: { title: LOAD_PROPERTY_TITLE } } },
    select: { id: true, attempts: true },
  });
  if (open.length === 0) throw new Error("tetiklenecek açık RNPL planı yok (önce MODE=seed)");
  const now = new Date();
  await prisma.paymentSchedule.updateMany({
    where: { id: { in: open.map((s) => s.id) } },
    data: { dueAt: now },
  });
  const queue = getQueue(QUEUE_NAMES.rnpl);
  const startedAt = Date.now();
  const outcomes = await Promise.all(
    open.map(async (s) => {
      const job = await queue.getJob(`rnpl-${s.id}-${s.attempts}`);
      if (job && (await job.isDelayed())) {
        await job.promote();
        return "promoted";
      }
      if (job) return "already_queued";
      await scheduleRnplCharge({ id: s.id, dueAt: now, nextAttemptAt: null, attempts: s.attempts });
      return "enqueued";
    })
  );
  const counts: Record<string, number> = {};
  for (const o of outcomes) counts[o] = (counts[o] ?? 0) + 1;
  await redis.set(
    STORM_KEY,
    JSON.stringify({ at: now.toISOString(), ids: open.map((s) => s.id) }),
    { ex: 24 * 3600 }
  );
  console.log(
    JSON.stringify({
      triggered: open.length,
      triggeredAt: now.toISOString(),
      enqueueMs: Date.now() - startedAt,
      ...counts,
    })
  );
}

async function verify(): Promise<void> {
  const raw = await redis.get(STORM_KEY);
  if (!raw) throw new Error("önce trigger çalıştırılmalı");
  const { at, ids } = JSON.parse(raw) as { at: string; ids: string[] };
  const triggeredAt = new Date(at);
  const timeoutMs = Number(process.env.STORM_TIMEOUT_S ?? 900) * 1000;
  const deadline = Date.now() + timeoutMs;
  let open = ids.length;
  while (Date.now() < deadline) {
    // Yeniden deneme saatlere yayılır (RNPL_RETRY_INTERVAL_HOURS): RETRYING "bitmiş" sayılır.
    open = await prisma.paymentSchedule.count({
      where: { id: { in: ids }, status: "SCHEDULED" },
    });
    if (open === 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const rows = await prisma.paymentSchedule.findMany({
    where: { id: { in: ids } },
    select: {
      status: true,
      attempts: true,
      capturedAt: true,
      updatedAt: true,
      booking: { select: { status: true, payment: { select: { status: true } } } },
    },
  });
  const byStatus: Record<string, number> = {};
  const byBooking: Record<string, number> = {};
  let lastDone = triggeredAt.getTime();
  let firstCapture = Number.POSITIVE_INFINITY;
  const captureLatencies: number[] = [];
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const k = `${r.booking.status}/${r.booking.payment?.status ?? "-"}/${r.status}`;
    byBooking[k] = (byBooking[k] ?? 0) + 1;
    if (!(OPEN as readonly string[]).includes(r.status)) {
      lastDone = Math.max(lastDone, r.updatedAt.getTime());
    }
    if (r.capturedAt) {
      firstCapture = Math.min(firstCapture, r.capturedAt.getTime());
      captureLatencies.push(r.capturedAt.getTime() - triggeredAt.getTime());
    }
  }
  captureLatencies.sort((a, b) => a - b);
  const pct = (p: number) =>
    captureLatencies.length
      ? captureLatencies[
          Math.min(captureLatencies.length - 1, Math.floor(p * captureLatencies.length))
        ]
      : null;
  // Fırtınaya özgü değişmezler: plan başına en fazla bir PSP tahsilatı (idempotency anahtarı
  // `rnpl:<plan>:<deneme>`), tahsil edilip iptal edilen rezervasyonun ödemesi iade edilmiş.
  const capturedButBookingCancelledUnrefunded = rows.filter(
    (r) =>
      r.status === "CAPTURED" &&
      r.booking.status === "CANCELLED" &&
      r.booking.payment?.status === "PAID"
  ).length;
  const cancelledButPaid = rows.filter(
    (r) => r.status === "CANCELLED" && r.booking.payment?.status === "PAID"
  ).length;
  const drainMs = lastDone - triggeredAt.getTime();
  const done = ids.length - open;
  const violations = capturedButBookingCancelledUnrefunded + cancelledButPaid + open;
  console.log(
    JSON.stringify({
      ok: violations === 0,
      triggered: ids.length,
      stillScheduled: open,
      drainSeconds: Number((drainMs / 1000).toFixed(1)),
      throughputPerSecond: drainMs > 0 ? Number(((done / drainMs) * 1000).toFixed(1)) : null,
      firstCaptureAfterMs: Number.isFinite(firstCapture)
        ? firstCapture - triggeredAt.getTime()
        : null,
      captureAfterTriggerMs: { p50: pct(0.5), p95: pct(0.95), max: pct(1) },
      schedules: byStatus,
      bookingPaymentSchedule: byBooking,
      invariants: { capturedButBookingCancelledUnrefunded, cancelledButPaid },
    })
  );
  if (violations !== 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  if (!isDemoMode()) throw new Error("rnpl-storm yalnızca DEMO_MODE=true ortamında çalışır");
  const cmd = process.argv[2];
  if (cmd === "trigger") await trigger();
  else if (cmd === "verify") await verify();
  else throw new Error("kullanım: rnpl-storm.ts trigger|verify");
}

main()
  .catch((error: unknown) => {
    console.error("rnpl-storm:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
