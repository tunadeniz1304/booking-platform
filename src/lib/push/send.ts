import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { counter } from "@/lib/observability/metrics";
import { errorFields, logger } from "@/lib/observability/logger";
import { getPushSettings } from "./config";

/**
 * Web Push gönderimi (P1-12). Yük yalnızca başlık/metin/yerel URL içerir — kişisel veri,
 * tutar veya token yoktur (push servisi yükü şifreli taşır ama cihaz kilit ekranında görünür).
 *
 * - Push kapalıysa (VAPID yok) hiçbir şey gönderilmez: `{ skipped: "disabled" }`.
 * - 404/410 dönen abonelik silinir (tarayıcı aboneliği bitirmiş).
 * - Diğer hatalar `failureCount`'u artırır; iş başarısız sayılmaz (bildirim en iyi çaba).
 * - `dedupeKey` verilirse aynı bildirim at-least-once teslimde ikinci kez gönderilmez.
 */
export type PushLocale = "tr" | "en";

export interface PushMessage {
  title: string;
  body: string;
  /** Yalnızca site içi yol (`/trips`); service worker bunu açar. */
  url: string;
  /** Aynı etiketli bildirimler cihazda üst üste biner. */
  tag: string;
}

export interface PushSendResult {
  sent: number;
  removed: number;
  failed: number;
  skipped?: "disabled" | "duplicate" | "no_subscriptions";
}

export const pushNotificationsTotal = counter(
  "push_notifications_total",
  "Web Push gönderim sonuçları",
  ["kind", "outcome"] as const
);

const DEDUPE_PREFIX = "push:sent:";
const GONE_STATUSES = new Set([404, 410]);

function statusOf(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : null;
}

export function toLocale(value: string | null | undefined): PushLocale {
  return value === "en" ? "en" : "tr";
}

export async function sendPushToUser(
  userId: string,
  kind: string,
  build: (locale: PushLocale) => PushMessage,
  opts: { dedupeKey?: string; dedupeTtlSeconds?: number } = {}
): Promise<PushSendResult> {
  const settings = getPushSettings();
  if (!settings.enabled) return { sent: 0, removed: 0, failed: 0, skipped: "disabled" };
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) {
    return { sent: 0, removed: 0, failed: 0, skipped: "no_subscriptions" };
  }
  if (opts.dedupeKey) {
    try {
      const fresh = await redis.set(`${DEDUPE_PREFIX}${opts.dedupeKey}`, "1", {
        nx: true,
        ex: opts.dedupeTtlSeconds ?? 7 * 86_400,
      });
      if (fresh === null) {
        pushNotificationsTotal.inc({ kind, outcome: "duplicate" });
        return { sent: 0, removed: 0, failed: 0, skipped: "duplicate" };
      }
    } catch (error) {
      // Redis yoksa tekilleştirme yapılamaz; kaçırmaktansa olası tekrarı kabul ederiz.
      logger.warn({ ...errorFields(error), kind }, "push dedupe unavailable");
    }
  }

  const cfg = getConfig();
  const result: PushSendResult = { sent: 0, removed: 0, failed: 0 };
  for (const sub of subscriptions) {
    const payload = JSON.stringify(build(toLocale(sub.locale)));
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        {
          vapidDetails: {
            subject: settings.subject,
            publicKey: settings.publicKey,
            privateKey: settings.privateKey,
          },
          TTL: cfg.PUSH_TTL_SECONDS,
          timeout: cfg.PUSH_SEND_TIMEOUT_MS,
        }
      );
      result.sent++;
      pushNotificationsTotal.inc({ kind, outcome: "sent" });
      await prisma.pushSubscription.updateMany({
        where: { id: sub.id },
        data: { lastSuccessAt: new Date(), failureCount: 0 },
      });
    } catch (error) {
      const status = statusOf(error);
      if (status !== null && GONE_STATUSES.has(status)) {
        result.removed++;
        pushNotificationsTotal.inc({ kind, outcome: "gone" });
        await prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
        continue;
      }
      result.failed++;
      pushNotificationsTotal.inc({ kind, outcome: "failed" });
      logger.warn({ ...errorFields(error), status, kind, subscriptionId: sub.id }, "push failed");
      await prisma.pushSubscription.updateMany({
        where: { id: sub.id },
        data: { failureCount: { increment: 1 } },
      });
    }
  }
  return result;
}
