import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { NextRequest } from "next/server";
import { signWebhook, WebhookSignatureError } from "@/lib/payment/webhook";
import {
  verifyActiveProviderWebhook,
  WebhookProviderMismatchError,
} from "@/lib/payment/webhook-verify";
import { setPaymentProviderForTests } from "@/lib/payment";
import { StripeProvider } from "@/lib/payment/stripe-provider";
import { MockPsp } from "@/lib/payment/mock-psp";
import { POST as webhookPost } from "@/app/api/payments/webhook/route";

const MOCK_SECRET = "m".repeat(40);
const STRIPE_SECRET = "whsec_v4_16";

const mockBody = JSON.stringify({
  id: "evt_v4_16",
  type: "payment.succeeded",
  data: { providerRef: "pi_mock_x", amount: 1000, currency: "TRY" },
});
const stripeBody = JSON.stringify({
  id: "evt_stripe_v4_16",
  object: "event",
  type: "customer.created",
  data: { object: { id: "cus_1" } },
});

function mockHeaders(): Headers {
  return new Headers({
    "x-psp-signature": signWebhook(mockBody, Math.floor(Date.now() / 1000), MOCK_SECRET),
  });
}
function stripeHeaders(): Headers {
  return new Headers({
    "stripe-signature": Stripe.webhooks.generateTestHeaderString({
      payload: stripeBody,
      secret: STRIPE_SECRET,
    }),
  });
}

beforeEach(() => {
  process.env.PSP_WEBHOOK_SECRET = MOCK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;
});
afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  setPaymentProviderForTests(null);
});

describe("regression: v4#16 yalnızca aktif sağlayıcının webhook imzası kabul edilir", () => {
  it("Stripe aktifken geçerli mock HMAC imzası reddedilir; Stripe imzası kabul edilir", () => {
    expect(() => verifyActiveProviderWebhook("stripe", mockBody, mockHeaders())).toThrow(
      WebhookProviderMismatchError
    );
    // İlgisiz Stripe olayı: imza geçerli → null (yok sayılır).
    expect(verifyActiveProviderWebhook("stripe", stripeBody, stripeHeaders())).toBeNull();
  });

  it("mock aktifken Stripe imzası reddedilir; mock imzası kabul edilir", () => {
    expect(() => verifyActiveProviderWebhook("mock", stripeBody, stripeHeaders())).toThrow(
      WebhookProviderMismatchError
    );
    expect(verifyActiveProviderWebhook("mock", mockBody, mockHeaders())?.id).toBe("evt_v4_16");
  });

  it("imzasız istek mismatch; aktif şemada bozuk imza WebhookSignatureError", () => {
    expect(() => verifyActiveProviderWebhook("mock", mockBody, new Headers())).toThrow(
      WebhookProviderMismatchError
    );
    const bad = new Headers({ "x-psp-signature": `t=${Math.floor(Date.now() / 1000)},v1=00` });
    expect(() => verifyActiveProviderWebhook("mock", mockBody, bad)).toThrow(WebhookSignatureError);
    expect(() => verifyActiveProviderWebhook("paypal", mockBody, mockHeaders())).toThrow(
      WebhookSignatureError
    );
  });

  it("route: Stripe aktifken mock imzalı 'ödendi' olayı 401 WRONG_PROVIDER_SIGNATURE", async () => {
    setPaymentProviderForTests(new StripeProvider("sk_test_x"));
    const res = await webhookPost(
      new NextRequest("http://localhost/api/payments/webhook", {
        method: "POST",
        headers: mockHeaders(),
        body: mockBody,
      })
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("WRONG_PROVIDER_SIGNATURE");
  });

  it("route: mock aktifken bozuk mock imzası 400 INVALID_SIGNATURE", async () => {
    setPaymentProviderForTests(new MockPsp());
    const res = await webhookPost(
      new NextRequest("http://localhost/api/payments/webhook", {
        method: "POST",
        headers: { "x-psp-signature": "t=1,v1=zz" },
        body: mockBody,
      })
    );
    expect(res.status).toBe(400);
  });
});
