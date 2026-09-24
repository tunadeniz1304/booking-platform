import { describe, it, expect } from "vitest";
import { computeRefund, DEFAULT_POLICIES, checkInInstant } from "@/lib/booking/cancellation";
import { tokenizeCard, parseMockToken, TEST_CARDS, MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { MockPsp } from "@/lib/payment/mock-psp";
import { StripeProvider } from "@/lib/payment/stripe-provider";
import { signWebhook, verifyWebhook, WebhookSignatureError } from "@/lib/payment/webhook";
import { bookingConfirmedEmail, escapeHtml } from "@/lib/notifications/templates";
import { money } from "@/lib/money/money";
import { parseIsoDate } from "@/lib/time/nights";

const CI = parseIsoDate("2026-12-20"); // check-in anı: 2026-12-20T12:00Z
const start = checkInInstant(CI, 12).getTime();
const hoursBefore = (h: number) => new Date(start - h * 3_600_000);
const booking = {
  checkIn: CI,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  paidMinor: 100_000,
  currency: "TRY" as const,
};

describe("P0-4 iptal politikası ve iade (tablo testleri, UTC)", () => {
  it.each([
    ["FLEXIBLE", 25, 100],
    ["FLEXIBLE", 24, 100], // sınır: tam 24 saat → tam iade
    ["FLEXIBLE", 23.99, 0],
    ["MODERATE", 120, 100],
    ["MODERATE", 119, 50],
    ["MODERATE", 24, 50],
    ["MODERATE", 23, 0],
    ["STRICT", 400, 100],
    ["STRICT", 200, 50],
    ["STRICT", 100, 0],
    ["NON_REFUNDABLE", 1000, 0],
  ] as const)("%s, check-in'e %s saat → %%%s", (kind, h, pct) => {
    const r = computeRefund(DEFAULT_POLICIES[kind], booking, hoursBefore(h), 12);
    expect(r.refundPercent).toBe(pct);
    expect(r.refundMinor).toBe((100_000 * pct) / 100);
  });

  it("check-in anı geçtiyse (no-show) iade yok", () => {
    const r = computeRefund(DEFAULT_POLICIES.FLEXIBLE, booking, new Date(start + 1000), 12);
    expect(r).toMatchObject({ refundMinor: 0, reason: "no_show" });
  });

  it("ödeme yoksa iade 0", () => {
    expect(
      computeRefund(DEFAULT_POLICIES.FLEXIBLE, { ...booking, paidMinor: 0 }, hoursBefore(100), 12)
        .reason
    ).toBe("not_paid");
  });

  it("STRICT cayma penceresi: 48 saat içinde ve check-in ≥ 14 gün uzaktaysa tam iade", () => {
    const createdAt = new Date(start - 20 * 24 * 3_600_000);
    const now = new Date(createdAt.getTime() + 10 * 3_600_000);
    const r = computeRefund(DEFAULT_POLICIES.STRICT, { ...booking, createdAt }, now, 12);
    expect(r).toMatchObject({ refundPercent: 100, reason: "grace_period" });
  });

  it("%50 iade half-up yuvarlanır (tek kuruş)", () => {
    const r = computeRefund(
      DEFAULT_POLICIES.MODERATE,
      { ...booking, paidMinor: 100_001 },
      hoursBefore(48),
      12
    );
    expect(r.refundMinor).toBe(50_001);
  });
});

describe("P0-5 kart token'ı ve MockPsp", () => {
  const exp = { expMonth: 12, expYear: 2030, cvc: "123" };

  it("kart numarası token'a gömülmez; senaryolar deterministik", () => {
    expect(tokenizeCard({ number: TEST_CARDS.success, ...exp })).toBe("tok_mock_ok_4242");
    expect(tokenizeCard({ number: TEST_CARDS.decline, ...exp })).toBe("tok_mock_decline_0002");
    expect(tokenizeCard({ number: TEST_CARDS.threeDs, ...exp })).toBe("tok_mock_3ds_3220");
    expect(() => tokenizeCard({ number: "4242 4242 4242 4241", ...exp })).toThrow(/geçersiz/);
    expect(() =>
      tokenizeCard({ number: TEST_CARDS.success, expMonth: 1, expYear: 2020, cvc: "123" })
    ).toThrow();
    expect(parseMockToken("4242424242424242")).toBeNull();
  });

  it("authorize: onay / ret / 3DS; aynı idempotency → aynı providerRef", async () => {
    const psp = new MockPsp();
    const amount = money(1000, "TRY");
    const a = await psp.authorize({ amount, cardToken: "tok_mock_ok_4242", idempotencyKey: "k" });
    const b = await psp.authorize({ amount, cardToken: "tok_mock_ok_4242", idempotencyKey: "k" });
    expect(a).toEqual(b);
    expect(a.status).toBe("authorized");
    expect(
      (await psp.authorize({ amount, cardToken: "tok_mock_decline_0002", idempotencyKey: "k" }))
        .status
    ).toBe("declined");
    const c = await psp.authorize({ amount, cardToken: "tok_mock_3ds_3220", idempotencyKey: "k" });
    expect(c.status).toBe("requires_action");
    expect((await psp.confirmChallenge(c.providerRef, "000000")).status).toBe("declined");
    expect((await psp.confirmChallenge(c.providerRef, MOCK_3DS_CODE)).status).toBe("authorized");
  });

  it("StripeProvider REST çağrısı (sahte fetch): requires_capture → authorized", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url} ${String(init?.body ?? "")}`);
      return new Response(JSON.stringify({ id: "pi_1", status: "requires_capture" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const stripe = new StripeProvider("sk_test_x", fake);
    const r = await stripe.authorize({
      amount: money(5000, "TRY"),
      cardToken: "pm_card_visa",
      idempotencyKey: "i",
    });
    expect(r).toEqual({ status: "authorized", providerRef: "pi_1" });
    expect(calls[0]).toContain("capture_method=manual");
    expect(calls[0]).toContain("amount=5000");
  });
});

describe("P0-5 webhook imzası", () => {
  const body = JSON.stringify({
    id: "evt_1",
    type: "payment.succeeded",
    data: { providerRef: "pi_x" },
  });

  it("geçerli imza kabul, değiştirilmiş gövde / yanlış imza / eski zaman damgası reddedilir", () => {
    const now = Date.now();
    const header = signWebhook(body, Math.floor(now / 1000));
    expect(verifyWebhook(body, header, now).id).toBe("evt_1");
    expect(() => verifyWebhook(body.replace("pi_x", "pi_y"), header, now)).toThrow(
      WebhookSignatureError
    );
    expect(() => verifyWebhook(body, "t=1,v1=" + "0".repeat(64), now)).toThrow(
      WebhookSignatureError
    );
    const old = signWebhook(body, Math.floor(now / 1000) - 3600);
    expect(() => verifyWebhook(body, old, now)).toThrow(/zaman/);
    expect(() => verifyWebhook(body, null, now)).toThrow();
  });
});

describe("P0-7 e-posta şablonları", () => {
  it("Türkçe, tutar biçimli ve HTML kaçışlı", () => {
    const e = bookingConfirmedEmail({
      guestName: "<script>x</script>",
      propertyTitle: "Kadıköy Loft",
      city: "İstanbul",
      checkIn: "2026-12-20",
      checkOut: "2026-12-22",
      bookingId: "b1",
      totalMinor: 318150,
      currency: "TRY",
    });
    expect(e.subject).toContain("onaylandı");
    expect(e.text).toContain("3.181,50");
    expect(e.html).not.toContain("<script>");
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
});
