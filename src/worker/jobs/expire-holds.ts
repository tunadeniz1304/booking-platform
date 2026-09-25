import type { Queue } from "bullmq";
import { expireHolds } from "@/lib/booking-service";
import { pruneInventory, rollAvailabilityForward } from "@/lib/booking/availability-rollover";
import { completeStays } from "@/lib/booking/complete-stays";

export const EXPIRE_HOLDS_JOB = "expire-holds";
export const ROLLOVER_JOB = "availability-rollover";
/** Tesisin yerel çıkış saati geçen CONFIRMED rezervasyonlar → COMPLETED (v3#18). */
export const COMPLETE_STAYS_JOB = "complete-stays";

/** Her dakika çalışan tekrarlı iş (idempotent scheduler — birden çok worker güvenli). */
export async function scheduleExpireHolds(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    EXPIRE_HOLDS_JOB,
    { every: 60_000 },
    { name: EXPIRE_HOLDS_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
  // Her 15 dakikada: yerel çıkış saati geçen konaklamaları tamamla (saat dilimleri farklı).
  await queue.upsertJobScheduler(
    COMPLETE_STAYS_JOB,
    { every: 15 * 60_000 },
    { name: COMPLETE_STAYS_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
  // Her gece 02:30 UTC: ileri 365 gecelik envanteri tamamla ve eski günleri buda.
  await queue.upsertJobScheduler(
    ROLLOVER_JOB,
    { pattern: "30 2 * * *", tz: "UTC" },
    { name: ROLLOVER_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runRollover(): Promise<number> {
  const created = await rollAvailabilityForward(365);
  await pruneInventory();
  return created;
}

export async function runCompleteStays(): Promise<number> {
  return completeStays(new Date());
}

/** Süresi dolan tutmaları EXPIRED yapar ve envanteri iade eder. */
export async function runExpireHolds(): Promise<number> {
  let total = 0;
  // Birikmiş iş varsa partiler hâlinde boşalt (tek çalıştırmada en fazla 10 parti).
  for (let i = 0; i < 10; i++) {
    const n = await expireHolds(new Date(), 100);
    total += n;
    if (n < 100) break;
  }
  return total;
}
