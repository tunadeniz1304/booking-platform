import { afterEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { StripeProvider } from "@/lib/payment/stripe-provider";
import { mapStripeEvent, verifyStripeWebhook } from "@/lib/payment/stripe-webhook";
import { PaymentProviderError } from "@/lib/payment/provider";
import { WebhookSignatureError } from "@/lib/payment/webhook";
import { MockPsp } from "@/lib/payment/mock-psp";
import { money } from "@/lib/money/money";
import { intent, stripeFake } from "../../support/stripe-fake";

const WEBHOOK_ENV = "STRIPE_WEBHOOK_SECRET";
const SECRET = "whsec_unit_test";
const amount = money(12_500, "TRY");

function signed(event: Record<string, unknown>, secret = SECRET) {
  const payload = JSON.stringify(event);
  return { payload, header: Stripe.webhooks.generateTestHeaderString({ payload, secret }) };
}

function evt(type: string, object: Record<string, unknown>) {
  return { id: `evt_${type}`, object: "event", type, data: { object } };
}

afterEach(() => {
  delete process.env[WEBHOOK_ENV];
});

describe("P0-6 StripeProvider (SDK, ağsız)", () => {
  it("3DS gereken kart → requires_action + clientSecret; idempotency başlığı gider", async () => {
    const { fetchImpl, calls } = stripeFake(() => intent("pi_3ds", "requires_action"));
    const r = await new StripeProvider("sk_test_x", fetchImpl).authorize({
      amount,
      cardToken: "pm_card_threeDSecure2Required",
      idempotencyKey: "pay:b1",
    });
    expect(r).toMatchObject({
      status: "requires_action",
      providerRef: "pi_3ds",
      challenge: { type: "stripe_next_action", clientSecret: "pi_3ds_secret_x" },
    });
    expect(calls[0].idempotencyKey).toBe("pay:b1");
    expect(calls[0].body.get("automatic_payment_methods[enabled]")).toBe("true");
    expect(calls[0].body.get("currency")).toBe("try");
  });

  it("402 kart reddi → declined (hata fırlatmaz)", async () => {
    const { fetchImpl } = stripeFake(() => ({
      status: 402,
      body: {
        error: {
          type: "card_error",
          code: "card_declined",
          decline_code: "insufficient_funds",
          payment_intent: { id: "pi_dec" },
        },
      },
    }));
    const r = await new StripeProvider("sk_test_x", fetchImpl).authorize({
      amount,
      cardToken: "pm_card_chargeDeclined",
      idempotencyKey: "k",
    });
    expect(r).toEqual({
      status: "declined",
      providerRef: "pi_dec",
      declineCode: "insufficient_funds",
    });
  });

  it("API hatası → PaymentProviderError", async () => {
    const { fetchImpl } = stripeFake(() => ({
      status: 400,
      body: { error: { type: "invalid_request_error", code: "parameter_invalid_integer" } },
    }));
    const p = new StripeProvider("sk_test_x", fetchImpl);
    await expect(p.capture("pi_x", amount)).rejects.toBeInstanceOf(PaymentProviderError);
    await expect(p.void("pi_x")).rejects.toMatchObject({ code: "parameter_invalid_integer" });
  });

  it("confirmChallenge / capture / refund / void doğru uç noktalara gider", async () => {
    const { fetchImpl, calls } = stripeFake((c) => {
      if (c.path.endsWith("/capture")) return intent("pi_1", "succeeded");
      if (c.path.endsWith("/cancel")) return intent("pi_1", "canceled");
      if (c.path === "/v1/refunds") return { body: { id: "re_1", object: "refund" } };
      return intent("pi_1", "requires_capture");
    });
    const p = new StripeProvider("sk_test_x", fetchImpl);
    expect((await p.confirmChallenge("pi_1")).status).toBe("authorized");
    expect(await p.capture("pi_1", amount)).toEqual({ status: "captured" });
    expect(await p.refund("pi_1", money(500, "TRY"), "refund:b1")).toEqual({
      status: "refunded",
      refundRef: "re_1",
    });
    expect(await p.void("pi_1")).toEqual({ status: "voided" });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /v1/payment_intents/pi_1",
      "POST /v1/payment_intents/pi_1/capture",
      "POST /v1/refunds",
      "POST /v1/payment_intents/pi_1/cancel",
    ]);
    expect(calls[1].body.get("amount_to_capture")).toBe("12500");
    expect(calls[2].idempotencyKey).toBe("refund:b1");
    expect(calls[2].body.get("payment_intent")).toBe("pi_1");
  });

  it("MockPsp 3DS kodunu doğrular (boş kod → declined)", async () => {
    const psp = new MockPsp();
    const a = await psp.authorize({ amount, cardToken: "tok_mock_3ds_3220", idempotencyKey: "z" });
    expect((await psp.confirmChallenge(a.providerRef, "")).status).toBe("declined");
  });
});

describe("regression: v3#10 Stripe-Signature webhook doğrulaması", () => {
  it("geçerli imza → iç olaya çevrilir (amount_received, büyük harf para birimi)", () => {
    const { payload, header } = signed(
      evt("payment_intent.succeeded", {
        id: "pi_1",
        amount: 12_500,
        amount_received: 12_500,
        currency: "try",
      })
    );
    expect(verifyStripeWebhook(payload, header, SECRET)).toEqual({
      id: "evt_payment_intent.succeeded",
      type: "payment.succeeded",
      data: { providerRef: "pi_1", amount: 12_500, currency: "TRY" },
    });
  });

  it("değiştirilmiş gövde, yanlış sır, eksik başlık veya sır → WebhookSignatureError", () => {
    const { payload, header } = signed(evt("payment_intent.payment_failed", { id: "pi_1" }));
    expect(() => verifyStripeWebhook(payload.replace("pi_1", "pi_2"), header, SECRET)).toThrow(
      WebhookSignatureError
    );
    expect(() => verifyStripeWebhook(payload, header, "whsec_other")).toThrow(
      WebhookSignatureError
    );
    expect(() => verifyStripeWebhook(payload, null, SECRET)).toThrow(WebhookSignatureError);
    expect(() => verifyStripeWebhook(payload, header)).toThrow(WebhookSignatureError);
    process.env[WEBHOOK_ENV] = SECRET;
    expect(verifyStripeWebhook(payload, header)?.type).toBe("payment.failed");
  });

  it("charge.refunded → refund.succeeded; ilgisiz tür → null", () => {
    const refunded = evt("charge.refunded", { id: "ch_1", payment_intent: { id: "pi_9" } });
    expect(mapStripeEvent(refunded as never)).toMatchObject({
      type: "refund.succeeded",
      data: { providerRef: "pi_9" },
    });
    expect(mapStripeEvent(evt("charge.refunded", { id: "ch_2" }) as never)).toBeNull();
    expect(mapStripeEvent(evt("customer.created", { id: "cus_1" }) as never)).toBeNull();
  });
});

describe("fix-sweep-2: depozito için müşteri + kart kaydı", () => {
  it("authorize: customerRef + setupFutureUsage → customer ve setup_future_usage=off_session", async () => {
    const { fetchImpl, calls } = stripeFake(() => intent("pi_1", "requires_capture"));
    const stripe = new StripeProvider("sk_test_x", fetchImpl);
    await stripe.authorize({
      amount,
      cardToken: "pm_card_visa",
      idempotencyKey: "k1",
      customerRef: "cus_1",
      setupFutureUsage: "off_session",
    });
    expect(calls[0].body.get("customer")).toBe("cus_1");
    expect(calls[0].body.get("setup_future_usage")).toBe("off_session");
    await stripe.authorize({ amount, cardToken: "pm_card_visa", idempotencyKey: "k2" });
    expect(calls[1].body.get("customer")).toBeNull();
    expect(calls[1].body.get("setup_future_usage")).toBeNull();
  });

  it("ajan token'ı (SPT) kaydedilemez → müşteri/kayıt parametresi eklenmez", async () => {
    const { fetchImpl, calls } = stripeFake(() => intent("pi_2", "requires_capture"));
    const stripe = new StripeProvider("sk_test_x", fetchImpl);
    await stripe.authorize({
      amount,
      cardToken: "spt_ABCDEF123",
      idempotencyKey: "k3",
      customerRef: "cus_1",
      setupFutureUsage: "off_session",
    });
    expect(calls[0].body.get("shared_payment_granted_token")).toBe("spt_ABCDEF123");
    expect(calls[0].body.get("customer")).toBeNull();
    expect(calls[0].body.get("setup_future_usage")).toBeNull();
  });

  it("createCustomer: yalnız iç kullanıcı kimliği metadata'sı + idempotency anahtarı", async () => {
    const { fetchImpl, calls } = stripeFake((call) =>
      call.path === "/v1/customers" ? { body: { id: "cus_9", object: "customer" } } : undefined
    );
    const stripe = new StripeProvider("sk_test_x", fetchImpl);
    await expect(
      stripe.createCustomer({ userId: "u1", idempotencyKey: "customer:stripe:u1" })
    ).resolves.toEqual({ customerRef: "cus_9" });
    expect(calls[0].body.get("metadata[userId]")).toBe("u1");
    expect(calls[0].body.get("email")).toBeNull();
    expect(calls[0].idempotencyKey).toBe("customer:stripe:u1");
  });

  it("MockPsp müşteri desteklemez (mock depozito akışı değişmez)", () => {
    expect((new MockPsp() as { createCustomer?: unknown }).createCustomer).toBeUndefined();
  });
});
