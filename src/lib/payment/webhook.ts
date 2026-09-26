import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

/**
 * PSP webhook imzası (Stripe tarzı): `x-psp-signature: t=<unix>,v1=<hex hmac>`
 * HMAC-SHA256(`${t}.${rawBody}`, PSP_WEBHOOK_SECRET). Zaman damgası toleransı 5 dk
 * (replay penceresi); karşılaştırma timing-safe. Olay kimliği ayrıca veritabanında
 * tekildir → replay ikinci kez etki etmez.
 */

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export const webhookEventSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum([
    "payment.succeeded",
    "payment.failed",
    "refund.succeeded",
    // P1-5: PSP itirazı (chargeback) → çözüm merkezinde CHARGEBACK talebi.
    "dispute.created",
    "dispute.updated",
    "dispute.closed",
  ]),
  data: z.object({
    providerRef: z.string().min(1).max(200),
    /** Minor-unit; verilirse kayıtlı ödemeyle birebir eşleşmelidir (v3#2). */
    amount: z.number().int().optional(),
    currency: z.string().optional(),
    /** İtiraz olaylarında: PSP itiraz kimliği, durumu ve gerekçesi. */
    disputeId: z.string().min(1).max(200).optional(),
    disputeStatus: z.string().max(64).optional(),
    reason: z.string().max(200).optional(),
  }),
});

export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

function getSecret(): string {
  const secret = process.env.PSP_WEBHOOK_SECRET ?? "";
  if (secret.length < 32) throw new WebhookSignatureError("Webhook sırrı yapılandırılmamış");
  return secret;
}

export function signWebhook(rawBody: string, timestamp: number, secret = getSecret()): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export function verifyWebhook(
  rawBody: string,
  header: string | null,
  now = Date.now()
): WebhookEvent {
  if (!header) throw new WebhookSignatureError("İmza başlığı yok");
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k, v.join("=")];
    })
  );
  const t = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/.test(v1)) {
    throw new WebhookSignatureError("İmza biçimi geçersiz");
  }
  if (Math.abs(now / 1000 - t) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new WebhookSignatureError("İmza zaman aşımına uğradı");
  }
  const expected = createHmac("sha256", getSecret()).update(`${t}.${rawBody}`).digest();
  const actual = Buffer.from(v1, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new WebhookSignatureError("İmza doğrulanamadı");
  }
  const parsed = webhookEventSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) throw new WebhookSignatureError("Olay gövdesi geçersiz");
  return parsed.data;
}
