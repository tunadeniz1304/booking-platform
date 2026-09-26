import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { HttpError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { getPushSettings, isAllowedPushEndpoint } from "./config";

/**
 * Web Push abonelikleri (P1-12). Sahiplik: abonelik yalnızca oturumdaki kullanıcıya yazılır
 * ve yalnızca sahibi silebilir. Aynı tarayıcı uç noktası başka bir hesapla yeniden abone
 * olursa kayıt yeni hesaba geçer (tarayıcıyı artık o kullanıcı kullanıyor; eski hesabın
 * bildirimleri o cihaza gitmemeli).
 */

const base64url = z
  .string()
  .min(8)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/, "base64url bekleniyor");

export const subscribeSchema = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z.object({ p256dh: base64url, auth: base64url }).strict(),
    locale: z.enum(["tr", "en"]).default("tr"),
    expirationTime: z.number().nullable().optional(),
  })
  .strict();

export type SubscribeInput = z.infer<typeof subscribeSchema>;

export const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) }).strict();

export interface PushSubscriptionView {
  id: string;
  locale: string;
  createdAt: string;
}

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Geçersiz abonelik");
  }
  return parsed.data;
}

export async function savePushSubscription(
  userId: string,
  body: unknown,
  userAgent: string | null
): Promise<PushSubscriptionView> {
  const settings = getPushSettings();
  if (!settings.enabled) {
    throw new HttpError(503, "PUSH_DISABLED", "Anlık bildirimler bu sunucuda kapalı");
  }
  const input = parseOrThrow(subscribeSchema, body);
  const cfg = getConfig();
  if (!isAllowedPushEndpoint(input.endpoint, cfg.PUSH_ENDPOINT_HOSTS)) {
    throw new HttpError(400, "PUSH_ENDPOINT_NOT_ALLOWED", "Push servisi desteklenmiyor");
  }
  const data = {
    userId,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    locale: input.locale,
    userAgent: userAgent?.slice(0, 256) ?? null,
    failureCount: 0,
  };
  const row = await withSerializableRetry(async (tx) => {
    const saved = await tx.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
    });
    // Cihaz sınırı: en yeni N abonelik kalır.
    const stale = await tx.pushSubscription.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: cfg.PUSH_MAX_SUBSCRIPTIONS_PER_USER,
      select: { id: true },
    });
    if (stale.length > 0) {
      await tx.pushSubscription.deleteMany({
        where: { id: { in: stale.map((s) => s.id).filter((id) => id !== saved.id) } },
      });
    }
    return saved;
  });
  return { id: row.id, locale: row.locale, createdAt: row.createdAt.toISOString() };
}

/** Yalnızca sahibinin aboneliğini siler; başkasının uç noktası → 404 (varlık sızdırılmaz). */
export async function removePushSubscription(userId: string, body: unknown): Promise<void> {
  const { endpoint } = parseOrThrow(unsubscribeSchema, body);
  const { count } = await withSerializableRetry((tx) =>
    tx.pushSubscription.deleteMany({ where: { endpoint, userId } })
  );
  if (count === 0) throw new NotFoundError("Abonelik bulunamadı");
}

export async function countPushSubscriptions(userId: string): Promise<number> {
  return prisma.pushSubscription.count({ where: { userId } });
}
