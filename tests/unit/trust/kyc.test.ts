import { afterEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { stripeFake } from "../../support/stripe-fake";
import {
  buildMockKycWebhook,
  KycWebhookSignatureError,
  KycWrongProviderError,
  MOCK_OUTCOMES,
  MOCK_SIGNATURE_HEADER,
  MockIdentityProvider,
  resolveKycProviderName,
  signMockKycWebhook,
  StripeIdentityProvider,
  verifyMockKycSignature,
} from "@/lib/trust/kyc";

describe("P1-6 KYC mock sağlayıcı + imza", () => {
  const mock = new MockIdentityProvider();

  afterEach(() => {
    delete process.env.KYC_MOCK_WEBHOOK_SECRET;
  });

  it.each(Object.entries(MOCK_OUTCOMES))(
    "test belgesi %s → deterministik sonuç",
    (doc, outcome) => {
      const hook = buildMockKycWebhook("kyc_mock_1", doc as keyof typeof MOCK_OUTCOMES);
      expect(mock.verifyWebhook(hook.rawBody, hook.headers)).toEqual({
        providerRef: "kyc_mock_1",
        status: outcome.status,
        errorCode: outcome.errorCode,
      });
    }
  );

  it("start: sağlayıcı referansı doğrulama kimliğinden, yönlendirme yok", async () => {
    await expect(
      mock.start({ userId: "u1", verificationId: "v1", returnUrl: "http://x" })
    ).resolves.toEqual({ providerRef: "kyc_mock_v1", redirectUrl: null });
  });

  it("gövde değişirse imza reddedilir (400)", () => {
    const hook = buildMockKycWebhook("kyc_mock_1", "fake");
    const tampered = hook.rawBody.replace("FAILED", "VERIFIED");
    expect(() => mock.verifyWebhook(tampered, hook.headers)).toThrow(KycWebhookSignatureError);
  });

  it("zaman aşımı ve bozuk biçim reddedilir", () => {
    const raw = JSON.stringify({
      id: "e",
      type: "identity.verification.updated",
      data: { providerRef: "r", status: "VERIFIED" },
    });
    const old = signMockKycWebhook(raw, Math.floor(Date.now() / 1000) - 3600);
    expect(() => verifyMockKycSignature(raw, old)).toThrow(/zaman aşımı/);
    expect(() => verifyMockKycSignature(raw, "t=1,v1=zz")).toThrow(KycWebhookSignatureError);
  });

  it("imza sırrı değişince eski imza geçmez", () => {
    const hook = buildMockKycWebhook("kyc_mock_1", "valid");
    process.env.KYC_MOCK_WEBHOOK_SECRET = "k".repeat(40);
    expect(() => mock.verifyWebhook(hook.rawBody, hook.headers)).toThrow(KycWebhookSignatureError);
  });

  it("aktif sağlayıcı mock iken Stripe imzası / imzasız → 401 WRONG_PROVIDER", () => {
    const headers = new Headers({ "stripe-signature": "t=1,v1=abc" });
    expect(() => mock.verifyWebhook("{}", headers)).toThrow(KycWrongProviderError);
    try {
      mock.verifyWebhook("{}", new Headers());
    } catch (e) {
      expect((e as KycWrongProviderError).status).toBe(401);
    }
  });

  it("sağlayıcı seçimi: Stripe yalnızca anahtar + Identity webhook sırrı varken", () => {
    expect(resolveKycProviderName({}, "auto")).toBe("mock");
    expect(resolveKycProviderName({ STRIPE_SECRET_KEY: "sk_test_x" }, "auto")).toBe("mock");
    const env = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_IDENTITY_WEBHOOK_SECRET: "whsec_x" };
    expect(resolveKycProviderName(env, "auto")).toBe("stripe");
    expect(resolveKycProviderName(env, "mock")).toBe("mock");
    expect(resolveKycProviderName({}, "stripe")).toBe("mock");
  });

  it("regression: v5#3 demo dışında Stripe yoksa mock'a düşmez → unavailable", () => {
    const prod = { DEMO_MODE: "false" };
    expect(resolveKycProviderName(prod, "auto")).toBe("unavailable");
    expect(resolveKycProviderName(prod, "stripe")).toBe("unavailable");
    expect(resolveKycProviderName(prod, "mock")).toBe("unavailable");
    expect(resolveKycProviderName({ NODE_ENV: "production" }, "auto")).toBe("unavailable");
    const ready = { ...prod, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_IDENTITY_WEBHOOK_SECRET: "w" };
    expect(resolveKycProviderName(ready, "auto")).toBe("stripe");
    expect(resolveKycProviderName({ DEMO_MODE: "true" }, "mock")).toBe("mock");
  });
});

describe("P1-6 Stripe Identity adaptörü (ağsız)", () => {
  const secret = "whsec_test_identity";

  it("start: verification_sessions oluşturur, yönlendirme URL'si döner", async () => {
    const fake = stripeFake((call) =>
      call.path === "/v1/identity/verification_sessions"
        ? {
            body: {
              id: "vs_123",
              object: "identity.verification_session",
              status: "requires_input",
              url: "https://verify.stripe.com/start/x",
            },
          }
        : undefined
    );
    const p = new StripeIdentityProvider("sk_test_x", secret, fake.fetchImpl);
    const s = await p.start({
      userId: "u1",
      verificationId: "v1",
      returnUrl: "http://localhost/account",
    });
    expect(s).toEqual({ providerRef: "vs_123", redirectUrl: "https://verify.stripe.com/start/x" });
    expect(fake.calls[0].body.get("type")).toBe("document");
    expect(fake.calls[0].body.get("metadata[verificationId]")).toBe("v1");
    expect(fake.calls[0].idempotencyKey).toBe("kyc-start:v1");
  });

  const stripeEvent = (type: string, object: Record<string, unknown>) =>
    JSON.stringify({ id: "evt_1", object: "event", type, data: { object } });

  it.each([
    ["identity.verification_session.verified", "VERIFIED", null],
    ["identity.verification_session.requires_input", "REQUIRES_INPUT", "document_expired"],
    ["identity.verification_session.canceled", "FAILED", null],
  ])("%s → %s", (type, status, code) => {
    const p = new StripeIdentityProvider("sk_test_x", secret);
    const raw = stripeEvent(type, { id: "vs_9", last_error: code ? { code } : null });
    const header = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret });
    expect(p.verifyWebhook(raw, new Headers({ "stripe-signature": header }))).toEqual({
      providerRef: "vs_9",
      status,
      errorCode: code,
    });
  });

  it("ilgisiz tür → null; bozuk imza → 400; mock imzası → 401", () => {
    const p = new StripeIdentityProvider("sk_test_x", secret);
    const raw = stripeEvent("customer.created", { id: "cus_1" });
    const header = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret });
    expect(p.verifyWebhook(raw, new Headers({ "stripe-signature": header }))).toBeNull();
    expect(() => p.verifyWebhook(raw, new Headers({ "stripe-signature": "t=1,v1=bad" }))).toThrow(
      KycWebhookSignatureError
    );
    const hook = buildMockKycWebhook("vs_9", "valid");
    expect(hook.headers.get(MOCK_SIGNATURE_HEADER)).toBeTruthy();
    expect(() => p.verifyWebhook(hook.rawBody, hook.headers)).toThrow(KycWrongProviderError);
  });
});
