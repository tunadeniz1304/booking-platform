import { describe, expect, it } from "vitest";
import { sptToCardToken } from "@/lib/agentic/spt";
import { StripeProvider, isSharedPaymentToken } from "@/lib/payment/stripe-provider";
import { MockPsp } from "@/lib/payment/mock-psp";
import { money } from "@/lib/money/money";
import { intent, stripeFake, type StripeCall } from "../../support/stripe-fake";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const SPT = "spt_1RgaZcFPC5QUO6ZC";
const expected = { amountMinor: 150_000, currency: "TRY" };

function grant(extra: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return {
    body: {
      id: SPT,
      object: "shared_payment.granted_token",
      deactivated_at: null,
      usage_limits: {
        currency: "try",
        max_amount: 200_000,
        expires_at: Math.floor(NOW.getTime() / 1000) + 3600,
        ...usage,
      },
      ...extra,
    },
  };
}

function stripeWith(route: (call: StripeCall) => { status?: number; body: unknown } | undefined) {
  const fake = stripeFake(route);
  return { provider: new StripeProvider("sk_test_x", fake.fetchImpl), calls: fake.calls };
}

describe("ACP SPT → PSP token (P1-11)", () => {
  it("mock fallback: spt_mock_<senaryo> → MockPsp token; başka biçim 400", async () => {
    const psp = new MockPsp();
    await expect(sptToCardToken("spt_mock_ok", expected, psp)).resolves.toBe("tok_mock_ok_0000");
    await expect(sptToCardToken("spt_mock_3ds", expected, psp)).resolves.toBe("tok_mock_3ds_0000");
    for (const bad of ["tok_mock_ok_4242", SPT, "spt_mock_x"]) {
      await expect(sptToCardToken(bad, expected, psp)).rejects.toMatchObject({ status: 400 });
    }
  });

  it("isSharedPaymentToken yalnız gerçek Stripe SPT kimliğini tanır", () => {
    expect(isSharedPaymentToken(SPT)).toBe(true);
    expect(isSharedPaymentToken("spt_mock_ok")).toBe(false);
    expect(isSharedPaymentToken("pm_123456")).toBe(false);
  });

  it("Stripe: token kaydı okunur, limitler geçerse SPT kimliği PSP token'ı olur", async () => {
    const { provider, calls } = stripeWith((c) =>
      c.path === `/v1/shared_payment/granted_tokens/${SPT}` ? grant() : undefined
    );
    await expect(sptToCardToken(SPT, expected, provider, NOW)).resolves.toBe(SPT);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
  });

  it("Stripe: demo token'ı ve biçimsiz token PSP'ye gitmeden 400", async () => {
    const { provider, calls } = stripeWith(() => grant());
    await expect(sptToCardToken("spt_mock_ok", expected, provider, NOW)).rejects.toMatchObject({
      status: 400,
    });
    await expect(sptToCardToken("pm_card_visa", expected, provider, NOW)).rejects.toMatchObject({
      status: 400,
    });
    expect(calls).toHaveLength(0);
  });

  it("Stripe: bulunamayan token 400; devre dışı/dolmuş/para birimi/limit 402", async () => {
    const missing = stripeWith(() => undefined).provider;
    await expect(sptToCardToken(SPT, expected, missing, NOW)).rejects.toMatchObject({
      status: 400,
    });
    const cases: [ReturnType<typeof grant>, string][] = [
      [grant({ deactivated_at: 1 }), "SPT_INACTIVE"],
      [grant({}, { expires_at: Math.floor(NOW.getTime() / 1000) - 1 }), "SPT_INACTIVE"],
      [grant({}, { currency: "eur" }), "SPT_CURRENCY_MISMATCH"],
      [grant({}, { max_amount: 149_999 }), "SPT_LIMIT_EXCEEDED"],
    ];
    for (const [body, code] of cases) {
      const { provider } = stripeWith(() => body);
      await expect(sptToCardToken(SPT, expected, provider, NOW)).rejects.toMatchObject({
        status: 402,
        code,
      });
    }
    // Limitsiz kayıt (usage_limits yok) kabul edilir.
    const open = stripeWith(() => ({ body: { id: SPT, deactivated_at: null } })).provider;
    await expect(sptToCardToken(SPT, expected, open, NOW)).resolves.toBe(SPT);
  });

  it("StripeProvider.authorize: SPT ile shared_payment_granted_token gönderilir (payment_method değil)", async () => {
    const { provider, calls } = stripeWith(() => intent("pi_spt", "requires_capture"));
    const res = await provider.authorize({
      amount: money(150_000, "TRY"),
      cardToken: SPT,
      idempotencyKey: "acs:1",
    });
    expect(res).toEqual({ status: "authorized", providerRef: "pi_spt" });
    expect(calls[0].path).toBe("/v1/payment_intents");
    expect(calls[0].body.get("shared_payment_granted_token")).toBe(SPT);
    expect(calls[0].body.get("payment_method")).toBeNull();
    expect(calls[0].body.get("capture_method")).toBe("manual");

    await provider.authorize({
      amount: money(150_000, "TRY"),
      cardToken: "pm_card_visa",
      idempotencyKey: "web:1",
    });
    expect(calls[1].body.get("payment_method")).toBe("pm_card_visa");
    expect(calls[1].body.get("shared_payment_granted_token")).toBeNull();
  });
});
