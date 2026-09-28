import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken } from "@/lib/auth/tokens";
import { signMandate, verifyMandateToken } from "@/lib/agentic/mandate";
import { registerEventHandlers } from "@/lib/events/register";
import { inlineFlow, setFulfilmentFlowForTests } from "@/lib/saga/booking-saga";
import { setPaymentProviderForTests } from "@/lib/payment";
import { StripeProvider } from "@/lib/payment/stripe-provider";
import { isTrialBalanced, trialBalance } from "@/lib/ledger";
import { redis } from "@/lib/redis";
import { POST as issuePost } from "@/app/api/account/agent-mandates/route";
import { POST as acpCreate } from "@/app/api/agentic/checkout_sessions/route";
import { POST as acpComplete } from "@/app/api/agentic/checkout_sessions/[id]/complete/route";
import { GET as ucpDiscovery } from "@/app/.well-known/ucp/route";
import { POST as ucpCreate } from "@/app/api/ucp/checkout-sessions/route";
import { GET as ucpGet, PUT as ucpPut } from "@/app/api/ucp/checkout-sessions/[id]/route";
import { POST as ucpComplete } from "@/app/api/ucp/checkout-sessions/[id]/complete/route";
import { intent, stripeFake } from "../support/stripe-fake";

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const call0 = (handler: unknown, r: NextRequest) =>
  (handler as (req: NextRequest) => Promise<Response>)(r);

/**
 * P1-11 ajan ticareti v2 — gerçek Postgres/Redis: AP2 mandate verme (recent-auth), ACP ve
 * UCP üzerinden mandate'li ödeme, ret yolları (yok/dolmuş/aşan/ilan/replay), Stripe SPT
 * yolu (ağsız fake) ve defter dengesi.
 */
describeInt("P1-11 ajan ticareti: AP2 mandate + UCP + Stripe SPT (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let token = "";
  let day = 20;

  const nextStay = (nights = 1) => {
    const start = day;
    day += nights + 1;
    return { check_in: iso(utcDay(start)), check_out: iso(utcDay(start + nights)), guests: 1 };
  };
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (path: string, method: string, body?: unknown, bearer = token) =>
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
        "idempotency-key": `p111-${Math.random().toString(36).slice(2)}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  async function acpSession(): Promise<{ id: string; currency: string; total: number }> {
    const res = await call0(
      acpCreate,
      req("/api/agentic/checkout_sessions", "POST", { room_id: fx.roomId, ...nextStay() })
    );
    expect(res.status).toBe(201);
    const view = (await res.json()) as {
      id: string;
      currency: string;
      totals: { type: string; amount: number }[];
    };
    return {
      id: view.id,
      currency: view.currency,
      total: view.totals.find((t) => t.type === "total")!.amount,
    };
  }

  const complete = (id: string, body: Record<string, unknown>) =>
    (acpComplete as unknown as Handler)(
      req(`/api/agentic/checkout_sessions/${id}/complete`, "POST", body),
      ctx(id)
    );

  beforeAll(async () => {
    registerEventHandlers();
    setFulfilmentFlowForTests(inlineFlow);
    fx = await createStayFixture(prisma, { tag: "p111", units: 5, days: 60 });
    token = (await signAccessToken(fx.userId, "USER", 900, 0, Math.floor(Date.now() / 1000))).token;
  });
  beforeEach(async () => {
    await redis.del(`fraud:v:user:${fx.userId}`, "fraud:v:card:tok_mock_ok_0000");
  });
  afterEach(() => setPaymentProviderForTests(null));
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("mandate verme: recent-auth zorunlu (403 REAUTH_REQUIRED), başarıda 201 + audit", async () => {
    const stale = (await signAccessToken(fx.userId, "USER", 900)).token;
    const body = { maxAmountMinor: 500_000, currency: "TRY", expiresInMinutes: 30 };
    const denied = await call0(issuePost, req("/api/account/agent-mandates", "POST", body, stale));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "REAUTH_REQUIRED" });

    const res = await call0(issuePost, req("/api/account/agent-mandates", "POST", body));
    expect(res.status).toBe(201);
    const out = (await res.json()) as { mandate: string; claims: { nonce: string; sub: string } };
    expect(out.claims.sub).toBe(fx.userId);
    expect(out.mandate.split(".")).toHaveLength(3);
    expect(
      await prisma.auditLog.count({
        where: { action: "agent_mandate.issued", entityId: out.claims.nonce, actorId: fx.userId },
      })
    ).toBe(1);

    const bad = await call0(
      issuePost,
      req("/api/account/agent-mandates", "POST", { ...body, expiresInMinutes: 99_999 })
    );
    expect(bad.status).toBe(400);
  });

  it("ACP: mandate'li ödeme CONFIRMED + defter dengede; replay başka oturumda 409", async () => {
    const s = await acpSession();
    const { mandate } = await signMandate(fx.userId, {
      maxAmountMinor: s.total,
      currency: s.currency,
      propertyIds: [fx.propertyId],
    });
    const res = await complete(s.id, {
      payment_data: { token: "spt_mock_ok", provider: "mock" },
      mandate,
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as { status: string; order: { id: string } };
    expect(view.status).toBe("completed");
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: view.order.id } });
    expect(booking.status).toBe("CONFIRMED");
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(
      await prisma.journalEntry.count({
        where: { idempotencyKey: `booking-captured:${payment.id}` },
      })
    ).toBe(1);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { action: "agent_mandate.accepted", entityId: s.id },
      })
    ).toBeGreaterThan(0);

    // Aynı mandate başka bir checkout'ta: tek kullanımlık nonce → 409, rezervasyon açılmaz.
    const other = await acpSession();
    const replay = await complete(other.id, {
      payment_data: { token: "spt_mock_ok", provider: "mock" },
      mandate,
    });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ code: "MANDATE_REPLAYED" });
    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: other.id } });
    expect(row.bookingId).toBeNull();

    // v5 P1-1: nonce DB'de de kalıcı (AgentMandateUse). Redis verisi kaybolsa bile replay 409.
    const { nonce } = (await verifyMandateToken(mandate)) as { nonce: string };
    const use = await prisma.agentMandateUse.findUniqueOrThrow({ where: { nonce } });
    expect(use).toMatchObject({ checkoutSessionId: s.id, userId: fx.userId });
    await redis.del(`agent-mandate:nonce:${nonce}`);
    const third = await acpSession();
    const afterLoss = await complete(third.id, {
      payment_data: { token: "spt_mock_ok", provider: "mock" },
      mandate,
    });
    expect(afterLoss.status).toBe(409);
    expect(await afterLoss.json()).toMatchObject({ code: "MANDATE_REPLAYED" });
  });

  it("ACP ret yolları: mandate yok 403, süresi dolmuş 403, aşan tutar 402 + step-up, başka ilan 403", async () => {
    const s = await acpSession();
    const pay = { token: "spt_mock_ok", provider: "mock" };

    const none = await complete(s.id, { payment_data: pay });
    expect(none.status).toBe(403);
    expect(await none.json()).toMatchObject({ code: "MANDATE_REQUIRED" });

    const past = new Date(Date.now() - 10 * 60_000);
    const expired = await signMandate(
      fx.userId,
      { maxAmountMinor: s.total, currency: s.currency, expiresInMinutes: 5 },
      past
    );
    const exp = await complete(s.id, { payment_data: pay, mandate: expired.mandate });
    expect(exp.status).toBe(403);
    expect(await exp.json()).toMatchObject({ code: "MANDATE_EXPIRED" });

    const small = await signMandate(fx.userId, {
      maxAmountMinor: s.total - 1,
      currency: s.currency,
    });
    const over = await complete(s.id, { payment_data: pay, mandate: small.mandate });
    expect(over.status).toBe(402);
    expect(await over.json()).toMatchObject({
      code: "MANDATE_AMOUNT_EXCEEDED",
      details: { amountMinor: s.total, stepUp: { type: "new_mandate" } },
    });

    const scoped = await signMandate(fx.userId, {
      maxAmountMinor: s.total,
      currency: s.currency,
      propertyIds: ["baska-ilan"],
    });
    const wrong = await complete(s.id, { payment_data: pay, mandate: scoped.mandate });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ code: "MANDATE_PROPERTY_MISMATCH" });

    // Başka kullanıcının mandate'i bu kullanıcı için geçersiz.
    const foreign = await signMandate("baska-kullanici", {
      maxAmountMinor: s.total,
      currency: s.currency,
    });
    const f = await complete(s.id, { payment_data: pay, mandate: foreign.mandate });
    expect(await f.json()).toMatchObject({ code: "MANDATE_SUBJECT_MISMATCH" });

    // Hiçbir ret rezervasyon açmadı / PSP'ye gitmedi; red denetim kaydında.
    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.bookingId).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { action: "agent_mandate.rejected", entityId: s.id } })
    ).toBe(5);
  });

  it("UCP: /.well-known/ucp keşfi + lodging checkout (create → update → complete) ACP ile aynı saga", async () => {
    const discovery = await call0(
      ucpDiscovery,
      new NextRequest("http://localhost:3000/.well-known/ucp")
    );
    expect(discovery.status).toBe(200);
    const profile = (await discovery.json()) as {
      ucp: { capabilities: { name: string }[] };
      endpoints: { checkout_sessions: string };
      ap2: { intent_mandate: { required: boolean; claims: string[] } };
      merchant_of_record: string;
    };
    expect(profile.ucp.capabilities.map((c) => c.name)).toEqual(
      expect.arrayContaining(["dev.ucp.shopping.checkout", "dev.ucp.shopping.ap2_mandate"])
    );
    expect(profile.endpoints.checkout_sessions).toBe(
      "http://localhost:3000/api/ucp/checkout-sessions"
    );
    expect(profile.ap2.intent_mandate).toMatchObject({ required: true });
    expect(profile.ap2.intent_mandate.claims).toContain("maxAmountMinor");
    expect(profile.merchant_of_record).toBe("platform");

    const stay = nextStay();
    const created = await call0(
      ucpCreate,
      req("/api/ucp/checkout-sessions", "POST", {
        line_items: [{ item: { id: fx.roomId }, quantity: 1 }],
        lodging: stay,
      })
    );
    expect(created.status).toBe(201);
    const v1 = (await created.json()) as {
      id: string;
      status: string;
      currency: string;
      lodging: { property_id: string; check_in: string };
      totals: { type: string; amount: number }[];
    };
    expect(v1).toMatchObject({
      status: "ready_for_complete",
      lodging: { property_id: fx.propertyId, check_in: stay.check_in },
    });

    const upd = await (ucpPut as unknown as Handler)(
      req(`/api/ucp/checkout-sessions/${v1.id}`, "PUT", { lodging: { guests: 2 } }),
      ctx(v1.id)
    );
    expect(upd.status).toBe(200);
    const v2 = (await upd.json()) as { totals: { type: string; amount: number }[] };
    const total = v2.totals.find((t) => t.type === "total")!.amount;

    const payment_data = {
      handler_id: "mock_spt",
      credential: { type: "shared_payment_token", token: "spt_mock_ok" },
    };
    const noMandate = await (ucpComplete as unknown as Handler)(
      req(`/api/ucp/checkout-sessions/${v1.id}/complete`, "POST", { payment_data }),
      ctx(v1.id)
    );
    expect(noMandate.status).toBe(403);

    const { mandate } = await signMandate(fx.userId, {
      maxAmountMinor: total,
      currency: v1.currency,
    });
    const done = await (ucpComplete as unknown as Handler)(
      req(`/api/ucp/checkout-sessions/${v1.id}/complete`, "POST", {
        payment_data,
        ap2: { intent_mandate: mandate },
      }),
      ctx(v1.id)
    );
    expect(done.status).toBe(200);
    const v3 = (await done.json()) as { status: string; order: { id: string } };
    expect(v3.status).toBe("completed");
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: v3.order.id } });
    expect(booking).toMatchObject({ status: "CONFIRMED", guestCount: 2, userId: fx.userId });

    const read = await (ucpGet as unknown as Handler)(
      req(`/api/ucp/checkout-sessions/${v1.id}`, "GET"),
      ctx(v1.id)
    );
    expect(await read.json()).toMatchObject({ status: "completed" });

    const invalid = await call0(
      ucpCreate,
      req("/api/ucp/checkout-sessions", "POST", { line_items: [], lodging: stay })
    );
    expect(invalid.status).toBe(400);
  });

  it("Stripe SPT yolu: token kaydı doğrulanır, PaymentIntent shared_payment_granted_token ile; defter dengede", async () => {
    const spt = `spt_${Date.now()}abcdef`;
    const piId = `pi_spt_${Date.now()}`;
    const s = await acpSession();
    const { fetchImpl, calls } = stripeFake((c) => {
      if (c.path === `/v1/shared_payment/granted_tokens/${spt}`) {
        return {
          body: {
            id: spt,
            deactivated_at: null,
            usage_limits: {
              currency: s.currency.toLowerCase(),
              max_amount: s.total,
              expires_at: Math.floor(Date.now() / 1000) + 600,
            },
          },
        };
      }
      if (c.path === "/v1/payment_intents") return intent(piId, "requires_capture");
      if (c.path === `/v1/payment_intents/${piId}/capture`) return intent(piId, "succeeded");
      return undefined;
    });
    setPaymentProviderForTests(new StripeProvider("sk_test_x", fetchImpl));
    await redis.del(`fraud:v:card:${spt}`);

    const { mandate } = await signMandate(fx.userId, {
      maxAmountMinor: s.total,
      currency: s.currency,
    });
    const res = await complete(s.id, {
      payment_data: { token: spt, provider: "stripe" },
      mandate,
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      status: string;
      order: { id: string };
      payment_provider: { provider: string };
    };
    expect(view).toMatchObject({ status: "completed", payment_provider: { provider: "stripe" } });
    const create = calls.find((c) => c.path === "/v1/payment_intents")!;
    expect(create.body.get("shared_payment_granted_token")).toBe(spt);
    expect(create.body.get("amount")).toBe(String(s.total));
    expect(calls.some((c) => c.path.endsWith("/capture"))).toBe(true);

    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: view.order.id } });
    expect(payment.providerRef).toBe(piId);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);

    // Demo token Stripe aktifken kabul edilmez (PSP'ye gitmez).
    const s2 = await acpSession();
    const m2 = await signMandate(fx.userId, { maxAmountMinor: s2.total, currency: s2.currency });
    const before = calls.length;
    const demo = await complete(s2.id, {
      payment_data: { token: "spt_mock_ok", provider: "mock" },
      mandate: m2.mandate,
    });
    expect(demo.status).toBe(400);
    expect(calls.length).toBe(before);
  });
});
