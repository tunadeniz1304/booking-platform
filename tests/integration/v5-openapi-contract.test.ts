import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken } from "@/lib/auth/tokens";
import { issueMandate } from "@/lib/agentic/mandate";
import { GET as cartGet } from "@/app/api/cart/route";
import { POST as cartItemsPost } from "@/app/api/cart/items/route";
import { GET as cartByIdGet, DELETE as cartDelete } from "@/app/api/cart/[id]/route";
import { POST as cartHoldPost } from "@/app/api/cart/[id]/hold/route";
import { POST as cartReleasePost } from "@/app/api/cart/[id]/release/route";
import { GET as mandatesGet } from "@/app/api/account/agent-mandates/route";
import { GET as paymentsConfigGet } from "@/app/api/payments/config/route";
import { GET as acpGet } from "@/app/api/agentic/checkout_sessions/[id]/route";
import { POST as acpCreate } from "@/app/api/agentic/checkout_sessions/route";
import { GET as openapiGet } from "@/app/api/openapi.json/route";
import { expectMatchesOpenApi } from "../helpers/openapi-assert";

type IdHandler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const asId = (h: unknown) => h as IdHandler;
const call0 = (h: unknown, r: NextRequest) => (h as (req: NextRequest) => Promise<Response>)(r);

/**
 * v5 P1-2: OpenAPI 3.1 yanıt kontratı — sepet, mandate listesi, ödeme yapılandırması ve ACP
 * okuma uçlarının gerçek yanıt gövdeleri `/api/openapi.json` şemalarına karşı doğrulanır
 * (diğer uçlar `api-routes.test.ts` ve `p1-11-agentic-mandates.test.ts` içinde).
 */
describeInt("v5 P1-2 OpenAPI yanıt kontratı (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let token = "";
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (path: string, method = "GET", body?: unknown) =>
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "idempotency-key": `oa-${Math.random().toString(36).slice(2)}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "oa", units: 3, days: 40 });
    token = (await signAccessToken(fx.userId, "USER", 900, 0, Math.floor(Date.now() / 1000))).token;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sepet: boş sepet → kalem ekle → oku → tut → bırak → sil", async () => {
    const empty = await call0(cartGet, req("/api/cart"));
    expect(empty.status).toBe(200);
    await expectMatchesOpenApi(empty, "GET", "/api/cart");

    const added = await call0(
      cartItemsPost,
      req("/api/cart/items", "POST", {
        propertyId: fx.propertyId,
        roomTypeId: fx.roomId,
        checkIn: iso(utcDay(10)),
        checkOut: iso(utcDay(12)),
        adults: 1,
      })
    );
    expect(added.status).toBe(201);
    const { cart } = await expectMatchesOpenApi<{ cart: { id: string } }>(
      added,
      "POST",
      "/api/cart/items"
    );

    const bad = await call0(cartItemsPost, req("/api/cart/items", "POST", { adults: 0 }));
    expect(bad.status).toBe(400);
    await expectMatchesOpenApi(bad, "POST", "/api/cart/items");

    const read = await asId(cartByIdGet)(req(`/api/cart/${cart.id}`), ctx(cart.id));
    expect(read.status).toBe(200);
    await expectMatchesOpenApi(read, "GET", "/api/cart/{id}");

    const held = await asId(cartHoldPost)(req(`/api/cart/${cart.id}/hold`, "POST"), ctx(cart.id));
    expect(held.status).toBe(200);
    await expectMatchesOpenApi(held, "POST", "/api/cart/{id}/hold");

    const released = await asId(cartReleasePost)(
      req(`/api/cart/${cart.id}/release`, "POST"),
      ctx(cart.id)
    );
    expect(released.status).toBe(200);
    await expectMatchesOpenApi(released, "POST", "/api/cart/{id}/release");

    const missing = await asId(cartByIdGet)(req("/api/cart/yok"), ctx("yok"));
    expect(missing.status).toBe(404);
    await expectMatchesOpenApi(missing, "GET", "/api/cart/{id}");

    const del = await asId(cartDelete)(req(`/api/cart/${cart.id}`, "DELETE"), ctx(cart.id));
    await expectMatchesOpenApi(del, "DELETE", "/api/cart/{id}");
  });

  it("mandate listesi, ödeme yapılandırması, ACP oturum okuma ve OpenAPI belgesi", async () => {
    await issueMandate(fx.userId, { maxAmountMinor: 10_000, currency: "TRY" });
    const list = await call0(mandatesGet, req("/api/account/agent-mandates"));
    expect(list.status).toBe(200);
    await expectMatchesOpenApi(list, "GET", "/api/account/agent-mandates");

    const cfg = await call0(paymentsConfigGet, req("/api/payments/config"));
    expect(cfg.status).toBe(200);
    await expectMatchesOpenApi(cfg, "GET", "/api/payments/config");

    const created = await call0(
      acpCreate,
      req("/api/agentic/checkout_sessions", "POST", {
        room_id: fx.roomId,
        check_in: iso(utcDay(20)),
        check_out: iso(utcDay(21)),
        guests: 1,
      })
    );
    expect(created.status).toBe(201);
    const { id } = await expectMatchesOpenApi<{ id: string }>(
      created,
      "POST",
      "/api/agentic/checkout_sessions"
    );
    const read = await asId(acpGet)(req(`/api/agentic/checkout_sessions/${id}`), ctx(id));
    expect(read.status).toBe(200);
    await expectMatchesOpenApi(read, "GET", "/api/agentic/checkout_sessions/{id}");

    const doc = await call0(openapiGet, req("/api/openapi.json"));
    expect(doc.status).toBe(200);
    await expectMatchesOpenApi(doc, "GET", "/api/openapi.json");
  });
});
