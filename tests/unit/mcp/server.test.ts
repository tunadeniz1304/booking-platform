import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, defaultDeps, type McpDeps } from "../../../services/mcp/server";
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
          quote: { roomId: "r1", total: 151500, currency: "TRY", nights: 1 },
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

  it("araç listesi: search_stays, get_quote, create_hold", async () => {
    const client = await connect(fakeDeps());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["create_hold", "get_quote", "search_stays"]);
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
    const res = await client.callTool({
      name: "create_hold",
      arguments: { ...holdArgs, accessToken: "bozuk.token.degeri" },
    });
    expect(payload(res)).toMatchObject({ code: "UNAUTHORIZED" });
    expect(deps.hold).not.toHaveBeenCalled();
  });

  it("create_hold geçerli token ile kullanıcıyı token'dan türetip HELD döner", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const { token } = await signAccessToken("u-mcp", "USER", 900);
    const res = await client.callTool({
      name: "create_hold",
      arguments: { ...holdArgs, accessToken: token },
    });
    expect(res.isError).toBeFalsy();
    expect(deps.hold).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-mcp", guestCount: 2, roomId: "r1" })
    );
    expect(payload(res)).toMatchObject({ paymentRequired: true, booking: { status: "HELD" } });
  });

  it("MCP_ACCESS_TOKEN ortam değişkeni varsayılan token olarak kullanılır", async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const envToken = await signAccessToken("u-env", "USER", 900);
    vi.stubEnv("MCP_ACCESS_TOKEN", envToken.token);
    await client.callTool({ name: "create_hold", arguments: holdArgs });
    expect(deps.hold).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-env" }));
  });

  it("servis hataları (ör. SOLD_OUT) hata koduyla araç hatasına çevrilir", async () => {
    const deps = fakeDeps();
    deps.hold.mockRejectedValueOnce(new ConflictError("Oda dolu", "SOLD_OUT"));
    deps.search.mockRejectedValueOnce(new Error("db down"));
    const client = await connect(deps);
    const { token } = await signAccessToken("u1", "USER", 900);
    const held = await client.callTool({
      name: "create_hold",
      arguments: { ...holdArgs, accessToken: token },
    });
    expect(held.isError).toBe(true);
    expect(payload(held)).toMatchObject({ code: "SOLD_OUT" });

    const searched = await client.callTool({ name: "search_stays", arguments: {} });
    expect(payload(searched)).toEqual({ code: "INTERNAL", message: "Beklenmeyen hata" });
  });
});
