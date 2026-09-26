import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createMcpServer,
  defaultDeps,
  STAY_CARD_URI,
  transportToken,
  type McpDeps,
} from "@/lib/mcp/server";
import { handleMcpHttp } from "@/lib/mcp/http";
import { signAccessToken } from "@/lib/auth/tokens";
import { ConflictError } from "@/lib/http/errors";
import type { SearchResponse } from "@/lib/search";
import type { Quote } from "@/lib/pricing/quote";
import type { BookingResult } from "@/lib/booking-service";

const quote = {
  quoteId: "8d3b8c5e-4a1f-4f5e-9a3b-2c1d0e9f8a7b",
  currency: "TRY",
  nights: [{ date: "2026-10-01", amount: 150000 }],
  subtotal: 150000,
  fees: [],
  taxes: [],
  total: 151500,
  expiresAt: "2026-10-01T00:15:00.000Z",
} as unknown as Quote;

function fakeDeps(): McpDeps & { [K in keyof McpDeps]: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn(async (): Promise<SearchResponse> => ({
      results: [
        {
          id: "p1",
          title: "Kadıköy Loft",
          description: "",
          propertyType: "APARTMENT",
          basePrice: 1500,
          currency: "TRY",
          ratingAvg: 4.7,
          ratingCount: 12,
          location: { city: "İstanbul", country: "TR" },
          amenities: [],
          availableRooms: 2,
          quote: { roomId: "r1", ratePlanId: "rp1", total: 151500, currency: "TRY", nights: 1 },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
      cached: false,
    })),
    quote: vi.fn(async () => quote),
    hold: vi.fn(async (input): Promise<BookingResult> => ({
      booking: {
        id: "b1",
        propertyId: input.propertyId,
        roomId: input.roomId,
        ratePlanId: "rp1",
        units: 1,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        guestCount: input.guestCount,
        totalPrice: 1515,
        totalMinor: 151500,
        currency: "TRY",
        status: "HELD",
        holdExpiresAt: "2026-10-01T00:15:00.000Z",
        priceBreakdown: null,
      },
      paymentRequired: true,
    })),
    authenticate: vi.fn(defaultDeps.authenticate),
    insight: vi.fn(async () => ({
      currency: "TRY",
      nightlyMinor: 150000,
      predictedMinor: 140000,
      level: 0.9,
      interval: null,
      label: null,
    })),
    listBookings: vi.fn(async (userId: string) => [
      {
        id: "b1",
        status: "CONFIRMED",
        propertyTitle: `Loft (${userId})`,
        city: "İstanbul",
        roomName: "Oda",
        checkIn: "2026-10-01",
        checkOut: "2026-10-02",
        totalMinor: 151500,
        currency: "TRY",
      },
    ]),
    cancel: vi.fn(async (bookingId: string) => ({
      bookingId,
      status: "CANCELLED",
      refund: { amount: 151500, currency: "TRY" },
    })),
    isEmailVerified: vi.fn(async () => true),
    checkout: vi.fn(async (input: { roomId: string }) => ({
      id: "cs1",
      status: "completed",
      currency: "TRY",
      stay: { room_id: input.roomId },
      order: { id: "b1" },
    })),
  } as never;
}

async function connect(deps: McpDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer(deps).connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

function payload(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first.text) as Record<string, unknown>;
}

const holdArgs = {
  propertyId: "p1",
  roomId: "r1",
  checkIn: "2026-10-01",
  checkOut: "2026-10-02",
  guests: 2,
};

describe("MCP sunucusu (P1-12)", () => {
  beforeEach(() => {
    vi.stubEnv("MCP_ACCESS_TOKEN", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("araç listesi: 7 araç (arama, teklif, hold, içgörü, rezervasyonlarım, iptal, checkout)", async () => {
    const client = await connect(fakeDeps());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "cancel_booking",
      "checkout_stay",
      "create_hold",
      "get_price_insight",
      "get_quote",
      "list_my_bookings",
      "search_stays",
    ]);
    const hold = tools.find((t) => t.name === "create_hold")!;
    expect(hold.inputSchema.required).toEqual(
      expect.arrayContaining(["propertyId", "roomId", "checkIn", "checkOut", "guests"])
    );
  });

  it("search_stays deterministik aramanın sonucunu sadeleştirip döner", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const res = await client.callTool({
      name: "search_stays",
      arguments: { city: "İstanbul", checkIn: "2026-10-01", checkOut: "2026-10-02", guests: 2 },
    });
    expect(res.isError).toBeFalsy();
    expect(deps.search).toHaveBeenCalledWith(
      expect.objectContaining({ city: "İstanbul", guests: 2, pageSize: 10 })
    );
    const body = payload(res) as { total: number; results: { propertyId: string }[] };
    expect(body.total).toBe(1);
    expect(body.results[0]).toMatchObject({ propertyId: "p1", city: "İstanbul" });
  });

  it("get_quote sunucu teklifini aynen iletir; tarih biçimi doğrulanır", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const res = await client.callTool({
      name: "get_quote",
      arguments: { roomId: "r1", checkIn: "2026-10-01", checkOut: "2026-10-02", guests: 2 },
    });
    expect(payload(res)).toMatchObject({ quoteId: quote.quoteId, total: 151500 });

    const bad = await client.callTool({
      name: "get_quote",
      arguments: { roomId: "r1", checkIn: "01.10.2026", checkOut: "2026-10-02", guests: 2 },
    });
    expect(bad.isError).toBe(true);
    expect(deps.quote).toHaveBeenCalledTimes(1);
  });

  it("create_hold token'sız reddedilir ve rezervasyon servisine ulaşmaz", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const res = await client.callTool({ name: "create_hold", arguments: holdArgs });
    expect(res.isError).toBe(true);
    expect(payload(res)).toMatchObject({ code: "UNAUTHORIZED" });
    expect(deps.hold).not.toHaveBeenCalled();
  });

  it("create_hold geçersiz token'ı reddeder", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    vi.stubEnv("MCP_ACCESS_TOKEN", "bozuk.token.degeri");
    const res = await client.callTool({ name: "create_hold", arguments: holdArgs });
    expect(payload(res)).toMatchObject({ code: "UNAUTHORIZED" });
    expect(deps.hold).not.toHaveBeenCalled();
  });

  it("create_hold geçerli token ile kullanıcıyı token'dan türetip HELD döner", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const { token } = await signAccessToken("u-mcp", "USER", 900);
    vi.stubEnv("MCP_ACCESS_TOKEN", token);
    const res = await client.callTool({ name: "create_hold", arguments: holdArgs });
    expect(res.isError).toBeFalsy();
    expect(deps.hold).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-mcp", guestCount: 2, roomId: "r1" })
    );
    expect(payload(res)).toMatchObject({ paymentRequired: true, booking: { status: "HELD" } });
  });

  it("regression: v4#6 create_hold doğrulanmamış e-postada EMAIL_NOT_VERIFIED, servise ulaşmaz", async () => {
    const deps = fakeDeps();
    deps.isEmailVerified.mockResolvedValue(false);
    const client = await connect(deps);
    const { token } = await signAccessToken("u-unverified", "USER", 900);
    vi.stubEnv("MCP_ACCESS_TOKEN", token);
    const res = await client.callTool({ name: "create_hold", arguments: holdArgs });
    expect(res.isError).toBe(true);
    expect(payload(res)).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(deps.hold).not.toHaveBeenCalled();
    expect(deps.isEmailVerified).toHaveBeenCalledWith("u-unverified");
  });

  it("checkout_stay: kimlik token'dan, SPT + mandate servise iletilir; doğrulanmamış hesap reddedilir", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const args = {
      roomId: "r1",
      checkIn: "2026-10-01",
      checkOut: "2026-10-02",
      guests: 1,
      spt: "spt_mock_ok",
      mandate: "m.jws.x",
      idempotencyKey: "k1",
    };
    const anon = await client.callTool({ name: "checkout_stay", arguments: args });
    expect(payload(anon)).toMatchObject({ code: "UNAUTHORIZED" });

    const { token } = await signAccessToken("u-agent", "USER", 900);
    vi.stubEnv("MCP_ACCESS_TOKEN", token);
    const res = await client.callTool({ name: "checkout_stay", arguments: args });
    expect(res.isError).toBeFalsy();
    expect(deps.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-agent", spt: "spt_mock_ok", mandate: "m.jws.x" })
    );
    expect(payload(res)).toMatchObject({ status: "completed" });

    deps.isEmailVerified.mockResolvedValue(false);
    const blocked = await client.callTool({ name: "checkout_stay", arguments: args });
    expect(payload(blocked)).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(deps.checkout).toHaveBeenCalledTimes(1);
  });

  it("checkout_stay: mandate reddi (HttpError) araç hatası olarak döner", async () => {
    const deps = fakeDeps();
    const { MandateError } = await import("@/lib/agentic/mandate");
    deps.checkout.mockRejectedValue(new MandateError("MANDATE_AMOUNT_EXCEEDED"));
    const client = await connect(deps);
    const { token } = await signAccessToken("u-agent", "USER", 900);
    vi.stubEnv("MCP_ACCESS_TOKEN", token);
    const res = await client.callTool({
      name: "checkout_stay",
      arguments: {
        roomId: "r1",
        checkIn: "2026-10-01",
        checkOut: "2026-10-02",
        guests: 1,
        spt: "spt_mock_ok",
        idempotencyKey: "k2",
      },
    });
    expect(res.isError).toBe(true);
    expect(payload(res)).toMatchObject({ code: "MANDATE_AMOUNT_EXCEEDED" });
  });

  it("MCP_ACCESS_TOKEN ortam değişkeni varsayılan token olarak kullanılır", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const envToken = await signAccessToken("u-env", "USER", 900);
    vi.stubEnv("MCP_ACCESS_TOKEN", envToken.token);
    await client.callTool({ name: "create_hold", arguments: holdArgs });
    expect(deps.hold).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-env" }));
  });

  it("regression: v3#12 hiçbir araç şemasında kimlik bilgisi argümanı yok", async () => {
    const client = await connect(fakeDeps());
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const props = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      );
      expect(props.filter((p) => /token|secret|password|authorization|jwt/i.test(p))).toEqual([]);
    }
  });

  it("regression: v3#12 argümanla gönderilen token yok sayılır (transport kimliği yoksa 401)", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const { token } = await signAccessToken("u-leak", "USER", 900);
    const res = await client.callTool({
      name: "create_hold",
      arguments: { ...holdArgs, accessToken: token },
    });
    expect(payload(res)).toMatchObject({ code: "UNAUTHORIZED" });
    expect(deps.hold).not.toHaveBeenCalled();
  });

  it("transportToken: HTTP authInfo ortam değişkeninden önce gelir", async () => {
    vi.stubEnv("MCP_ACCESS_TOKEN", "env-token");
    expect(transportToken({ authInfo: { token: "http-token" } })).toBe("http-token");
    expect(transportToken({})).toBe("env-token");
  });

  it("servis hataları (ör. SOLD_OUT) hata koduyla araç hatasına çevrilir", async () => {
    const deps = fakeDeps();
    deps.hold.mockRejectedValueOnce(new ConflictError("Oda dolu", "SOLD_OUT"));
    deps.search.mockRejectedValueOnce(new Error("db down"));
    const client = await connect(deps);
    const { token } = await signAccessToken("u1", "USER", 900);
    vi.stubEnv("MCP_ACCESS_TOKEN", token);
    const held = await client.callTool({ name: "create_hold", arguments: holdArgs });
    expect(held.isError).toBe(true);
    expect(payload(held)).toMatchObject({ code: "SOLD_OUT" });

    const searched = await client.callTool({ name: "search_stays", arguments: {} });
    expect(payload(searched)).toEqual({ code: "INTERNAL", message: "Beklenmeyen hata" });
  });
  it("regression: v3#11 ui://stay-card kaynağı listelenir ve search_stays ona bağlanır", async () => {
    const client = await connect(fakeDeps());
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain(STAY_CARD_URI);
    const read = await client.readResource({ uri: STAY_CARD_URI });
    const [content] = read.contents as { mimeType: string; text: string }[];
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toContain("textContent");
    expect(content.text).not.toContain("innerHTML");
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === "search_stays")!;
    expect(JSON.stringify(search._meta)).toContain(STAY_CARD_URI);
    const res = await client.callTool({ name: "search_stays", arguments: {} });
    expect(res.structuredContent).toMatchObject({ total: 1 });
  });

  it("get_price_insight anonim çalışır", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const res = await client.callTool({
      name: "get_price_insight",
      arguments: { roomId: "r1", checkIn: "2026-10-01", checkOut: "2026-10-02" },
    });
    expect(res.isError).toBeFalsy();
    expect(payload(res)).toMatchObject({ nightlyMinor: 150000 });
  });

  it("regression: v3#11 list_my_bookings token'sız 401, token ile yalnızca kendi kullanıcısı", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const anon = await client.callTool({ name: "list_my_bookings", arguments: {} });
    expect(payload(anon)).toMatchObject({ code: "UNAUTHORIZED" });
    expect(deps.listBookings).not.toHaveBeenCalled();
    const { token } = await signAccessToken("u-list", "USER", 900);
    vi.stubEnv("MCP_ACCESS_TOKEN", token);
    const res = await client.callTool({ name: "list_my_bookings", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(deps.listBookings).toHaveBeenCalledWith("u-list");
  });

  it("regression: v3#11 cancel_booking confirm: true olmadan iptal etmez", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const { token } = await signAccessToken("u-cancel", "USER", 900);
    vi.stubEnv("MCP_ACCESS_TOKEN", token);
    const missing = await client.callTool({
      name: "cancel_booking",
      arguments: { bookingId: "b1" },
    });
    expect(missing.isError).toBe(true);
    const falsy = await client.callTool({
      name: "cancel_booking",
      arguments: { bookingId: "b1", confirm: false },
    });
    expect(falsy.isError).toBe(true);
    expect(deps.cancel).not.toHaveBeenCalled();
    const ok = await client.callTool({
      name: "cancel_booking",
      arguments: { bookingId: "b1", confirm: true },
    });
    expect(ok.isError).toBeFalsy();
    expect(deps.cancel).toHaveBeenCalledWith("b1", "u-cancel");
  });

  it("regression: v3#11 HTTP sunucusunda MCP_ACCESS_TOKEN yedeği kapalı", async () => {
    const deps = fakeDeps();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMcpServer(deps, { envTokenFallback: false }).connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);
    const { token } = await signAccessToken("u-env", "USER", 900);
    vi.stubEnv("MCP_ACCESS_TOKEN", token);
    const res = await client.callTool({ name: "create_hold", arguments: holdArgs });
    expect(payload(res)).toMatchObject({ code: "UNAUTHORIZED" });
    expect(deps.hold).not.toHaveBeenCalled();
  });
});

describe("MCP streamable HTTP (P1-11)", () => {
  const rpc = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const callHold = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "create_hold", arguments: holdArgs },
  };

  it("regression: v3#11 bearer yoksa 401 + WWW-Authenticate; araç çalışmaz", async () => {
    const deps = fakeDeps();
    const res = await handleMcpHttp(rpc(callHold), deps);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(deps.hold).not.toHaveBeenCalled();
  });

  it("regression: v3#11 geçersiz bearer 401", async () => {
    const deps = fakeDeps();
    const res = await handleMcpHttp(rpc(callHold, { authorization: "Bearer bozuk.token" }), deps);
    expect(res.status).toBe(401);
    expect(deps.hold).not.toHaveBeenCalled();
  });

  it("GET 405 döner", async () => {
    const res = await handleMcpHttp(new Request("http://localhost/api/mcp"), fakeDeps());
    expect(res.status).toBe(405);
  });

  it("geçerli bearer ile tools/list ve create_hold token kullanıcısıyla çalışır", async () => {
    const deps = fakeDeps();
    const { token } = await signAccessToken("u-http", "USER", 900);
    const auth = { authorization: `Bearer ${token}` };
    const list = await handleMcpHttp(
      rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, auth),
      deps
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools).toHaveLength(7);
    const held = await handleMcpHttp(rpc(callHold, auth), deps);
    expect(held.status).toBe(200);
    expect(deps.hold).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-http" }));
  });
});

describe("ajan uç noktaları rate-limit (P1-11)", () => {
  it("regression: v3#11 /api/mcp ve /api/agentic hassas 'agentic' kategorisinde (fail-closed)", async () => {
    const { categorize, isSensitiveCategory, limitFor } = await import("@/lib/security/rate-limit");
    const { getConfig } = await import("@/lib/config/app-config");
    expect(categorize("/api/mcp")).toBe("agentic");
    expect(categorize("/api/agentic/checkout_sessions")).toBe("agentic");
    expect(isSensitiveCategory("agentic")).toBe(true);
    expect(limitFor("agentic", getConfig())).toBe(getConfig().RATE_LIMIT_AGENTIC_MAX);
  });
});
