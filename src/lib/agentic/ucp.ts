import { z } from "zod";
import { createCheckoutSchema, type CheckoutSessionView, type CheckoutStatus } from "./checkout";
import { activeSptProvider } from "./spt";
import { MANDATE_TYP } from "./mandate";
import { getConfig } from "@/lib/config/app-config";

/**
 * UCP (Universal Commerce Protocol) lodging adaptörü (P1-11, ADR 0023).
 *
 * İnce eşleme katmanı: UCP istek/yanıt şeması ↔ mevcut ACP checkout servisleri. İş mantığı
 * (teklif, HELD, ödeme saga'sı, mandate kapısı) tamamen `checkout.ts`'tedir; burada yalnızca
 * alan adları ve durum değerleri çevrilir. Konaklama ayrıntıları `lodging` uzantısındadır.
 */

export const UCP_VERSION = "2026-01-11";
export const UCP_LODGING_CAPABILITY = "dev.ucp.shopping.checkout.lodging";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD bekleniyor");

const lodgingSchema = z
  .object({ check_in: isoDate, check_out: isoDate, guests: z.number().int().min(1).max(20) })
  .strict();

const lineItemsSchema = z
  .array(
    z
      .object({
        item: z.object({ id: z.string().min(1).max(64) }).passthrough(),
        quantity: z.literal(1),
      })
      .passthrough()
  )
  .length(1, "Konaklama checkout'u tek oda satırı içerir");

export const ucpCreateSchema = z
  .object({ line_items: lineItemsSchema, lodging: lodgingSchema })
  .passthrough();

export const ucpUpdateSchema = z
  .object({ line_items: lineItemsSchema.optional(), lodging: lodgingSchema.partial().optional() })
  .passthrough();

export const ucpCompleteSchema = z
  .object({
    payment_data: z
      .object({
        handler_id: z.enum(["stripe_spt", "mock_spt"]).optional(),
        credential: z.object({
          type: z.literal("shared_payment_token"),
          token: z.string().min(1).max(200),
        }),
      })
      .passthrough(),
    ap2: z
      .object({ intent_mandate: z.string().min(1).max(4096) })
      .partial()
      .optional(),
  })
  .passthrough();

/** UCP gövdesi → ACP `createCheckoutSchema` girdisi (doğrulama ACP şemasıyla tekrar yapılır). */
export function toAcpCreate(body: unknown) {
  const { line_items, lodging } = ucpCreateSchema.parse(body);
  return createCheckoutSchema.parse({ room_id: line_items[0].item.id, ...lodging });
}

export function toAcpUpdate(body: unknown) {
  const { line_items, lodging } = ucpUpdateSchema.parse(body);
  return {
    ...(line_items ? { room_id: line_items[0].item.id } : {}),
    ...(lodging ?? {}),
  };
}

export function toAcpComplete(body: unknown): { token: string; mandate: string | null } {
  const parsed = ucpCompleteSchema.parse(body);
  return {
    token: parsed.payment_data.credential.token,
    mandate: parsed.ap2?.intent_mandate ?? null,
  };
}

export type UcpStatus = "ready_for_complete" | "requires_escalation" | "completed" | "canceled";

const STATUS: Record<CheckoutStatus, UcpStatus> = {
  ready_for_payment: "ready_for_complete",
  in_progress: "requires_escalation",
  completed: "completed",
  canceled: "canceled",
};

function paymentHandlers() {
  return activeSptProvider() === "stripe"
    ? [{ id: "stripe_spt", name: "com.stripe.shared_payment_token", version: UCP_VERSION }]
    : [{ id: "mock_spt", name: "dev.booking.mock_spt", version: UCP_VERSION }];
}

/** ACP görünümü → UCP checkout nesnesi. */
export function toUcpView(view: CheckoutSessionView) {
  const amount = (type: string) => view.totals.find((t) => t.type === type)?.amount ?? 0;
  return {
    ucp: {
      version: UCP_VERSION,
      capabilities: [{ name: UCP_LODGING_CAPABILITY, version: UCP_VERSION }],
    },
    id: view.id,
    status: STATUS[view.status],
    currency: view.currency,
    line_items: view.line_items.map((li) => ({
      id: li.id,
      item: { id: view.stay.room_id, property_id: view.stay.property_id },
      quantity: li.quantity,
      totals: [
        { type: "subtotal", amount: li.base_amount },
        { type: "tax", amount: li.tax },
        { type: "total", amount: li.total },
      ],
    })),
    lodging: {
      property_id: view.stay.property_id,
      check_in: view.stay.check_in,
      check_out: view.stay.check_out,
      guests: view.stay.guests,
    },
    totals: [
      { type: "subtotal", amount: amount("subtotal") },
      { type: "fulfillment", amount: amount("fees") },
      { type: "tax", amount: amount("tax") },
      { type: "total", amount: amount("total") },
    ],
    payment: { handlers: paymentHandlers() },
    merchant_of_record: "platform",
    order: view.order,
    expires_at: view.expires_at,
    messages: view.messages.map((m) => ({
      type: m.type,
      code: m.code,
      content: m.content,
      ...(view.next_action ? { severity: "requires_buyer_input" } : {}),
    })),
    ...(view.next_action ? { next_action: view.next_action } : {}),
  };
}

/** `/.well-known/ucp` profil belgesi: yetenekler, uçlar, ödeme yöntemleri, mandate biçimi. */
export function ucpProfile(origin: string) {
  const config = getConfig();
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        "dev.ucp.shopping": {
          version: UCP_VERSION,
          rest: { endpoint: `${origin}/api/ucp` },
          mcp: { endpoint: `${origin}/api/mcp` },
        },
      },
      capabilities: [
        { name: "dev.ucp.shopping.checkout", version: UCP_VERSION },
        {
          name: UCP_LODGING_CAPABILITY,
          version: UCP_VERSION,
          extends: "dev.ucp.shopping.checkout",
        },
        {
          name: "dev.ucp.shopping.ap2_mandate",
          version: UCP_VERSION,
          extends: "dev.ucp.shopping.checkout",
        },
      ],
    },
    merchant_of_record: "platform",
    endpoints: {
      checkout_sessions: `${origin}/api/ucp/checkout-sessions`,
      checkout_session: `${origin}/api/ucp/checkout-sessions/{id}`,
      complete: `${origin}/api/ucp/checkout-sessions/{id}/complete`,
      acp_checkout_sessions: `${origin}/api/agentic/checkout_sessions`,
    },
    authentication: {
      type: "bearer",
      note: "Kullanıcının OAuth/erişim token'ı; kimlik argüman değildir",
    },
    payment: { handlers: paymentHandlers() },
    ap2: {
      intent_mandate: {
        required: config.AGENT_MANDATE_REQUIRED,
        format: "jws",
        typ: MANDATE_TYP,
        audience: config.AGENT_MANDATE_AUDIENCE,
        claims: ["sub", "aud", "maxAmountMinor", "currency", "expiresAt", "propertyId", "nonce"],
        issue_endpoint: `${origin}/api/account/agent-mandates`,
      },
    },
  };
}
