import type { Queue } from "bullmq";
import { expireHolds } from "@/lib/booking-service";
import { rollAvailabilityForward } from "@/lib/booking/availability-rollover";

export const EXPIRE_HOLDS_JOB = "expire-holds";
export const ROLLOVER_JOB = "availability-rollover";

/** Her dakika çalışan tekrarlı iş (idempotent scheduler — birden çok worker güvenli). */
export async function scheduleExpireHolds(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    EXPIRE_HOLDS_JOB,
    { every: 60_000 },
    { name: EXPIRE_HOLDS_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
  // Her gece 02:30 UTC: ileri 365 gecelik envanteri tamamla.
  await queue.upsertJobScheduler(
    ROLLOVER_JOB,
    { pattern: "30 2 * * *", tz: "UTC" },
    { name: ROLLOVER_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runRollover(): Promise<number> {
  return rollAvailabilityForward(365);
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
