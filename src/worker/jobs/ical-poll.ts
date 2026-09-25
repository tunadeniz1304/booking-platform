import type { Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import { pollDueSubscriptions } from "@/lib/channel/ical-poller";

/** iCal abonelik yoklaması (P1-9, v3#21): tekrarlayan iş, aralık `ICAL_POLL_MINUTES`. */
export const ICAL_POLL_JOB = "ical-poll";

/** İdempotent scheduler (birden çok worker güvenli). */
export async function scheduleIcalPoll(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    ICAL_POLL_JOB,
    { every: getConfig().ICAL_POLL_MINUTES * 60_000 },
    { name: ICAL_POLL_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export function runIcalPoll() {
  return pollDueSubscriptions();
}
