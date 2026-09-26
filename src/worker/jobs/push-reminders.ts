import type { Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import { runCheckinReminders, type CheckinReminderRun } from "@/lib/push/notifications";

/**
 * Check-in hatırlatma push'u (P1-12). Zamanlama `PUSH_CHECKIN_REMINDER_CRON` (UTC);
 * VAPID yoksa iş çalışır ama hiçbir şey göndermez. Fiyat düşüşü push'u ise mevcut
 * fiyat alarmı işinin `price.dropped` olayına bağlıdır (register.ts).
 */
export const PUSH_CHECKIN_REMINDER_JOB = "push-checkin-reminders";

/** İdempotent scheduler. */
export async function schedulePushReminders(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    PUSH_CHECKIN_REMINDER_JOB,
    { pattern: getConfig().PUSH_CHECKIN_REMINDER_CRON, tz: "UTC" },
    {
      name: PUSH_CHECKIN_REMINDER_JOB,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: 100 },
    }
  );
}

export async function runPushReminders(now = new Date()): Promise<CheckinReminderRun> {
  return runCheckinReminders(now);
}
