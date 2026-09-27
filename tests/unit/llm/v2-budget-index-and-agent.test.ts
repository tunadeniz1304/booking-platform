import { describe, it, expect, beforeEach, vi } from "vitest";
import { LlmBudgetExceededError } from "@/lib/llm/client";

/**
 * v2-P0-4 (review 2)
 *  - İndeksleme: uzak gömme bütçe/Redis/ağ yüzünden reddedilirse hash vektörü uzak-model
 *    indeksine YAZILMAZ (uzaylar karışmaz); UPDATE atlanır.
 *  - MCP HTTP: `search_stays` sorgu gömmesi bearer token kullanıcısının bütçesine faturalanır.
 */

const state = vi.hoisted(() => ({
  embedFn: null as null | ((texts: string[], dim: number) => Promise<number[][]>),
  executeRaw: 0,
}));

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});

vi.mock("@/lib/llm/embeddings", () => ({
  createRemoteEmbedFn: (model?: string) =>
    model ? (texts: string[], dim: number) => state.embedFn!(texts, dim) : null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    property: {
      findUnique: async () => ({
        id: "p1",
        title: "Deniz manzaralı villa",
        description: "Bodrum",
        propertyType: "VILLA",
        location: { city: "Bodrum", country: "TR" },
        amenities: [{ name: "Havuz" }],
      }),
    },
    $executeRaw: async () => {
      state.executeRaw += 1;
      return 1;
    },
  },
}));

async function freshUpsert() {
  vi.resetModules();
  return (await import("@/lib/embedding/backfill")).upsertPropertyEmbedding;
}

describe("regression: v2-P0-4 indeksleme reddedilen uzak gömmede hash yazmaz", () => {
  beforeEach(() => {
    state.executeRaw = 0;
    vi.stubEnv("EMBEDDING_MODEL", "text-embedding-3-small");
  });

  it("sistem bütçesi doluysa UPDATE yapılmaz", async () => {
    state.embedFn = async () => {
      throw new LlmBudgetExceededError("budget");
    };
    const upsert = await freshUpsert();
    await upsert("p1");
    expect(state.executeRaw).toBe(0);
  });

  it("sağlayıcı/Redis hatasında da UPDATE yapılmaz", async () => {
    state.embedFn = async () => {
      throw new Error("ECONNREFUSED");
    };
    const upsert = await freshUpsert();
    await upsert("p1");
    expect(state.executeRaw).toBe(0);
  });

  it("uzak gömme başarılıysa vektör yazılır", async () => {
    state.embedFn = async (texts, dim) => texts.map(() => Array.from({ length: dim }, () => 0.1));
    const upsert = await freshUpsert();
    await upsert("p1");
    expect(state.executeRaw).toBe(1);
  });
});

describe("regression: v2-P0-4 MCP HTTP search_stays token kullanıcısına faturalanır", () => {
  it("arama bağımlılığı `u:<token kullanıcısı>` öznesiyle çalışır", async () => {
    // Modül önbelleği önceki testlerde sıfırlandı: bütçe bağlamı http ile aynı örnekten okunur.
    const { handleMcpHttp } = await import("@/lib/mcp/http");
    const { currentLlmSubject } = await import("@/lib/llm/budget");
    const subjects: Array<string | undefined> = [];
    const deps = {
      authenticate: async () => ({ userId: "u-mcp", role: "USER" }),
      search: async () => {
        subjects.push(currentLlmSubject());
        return { results: [], total: 0, page: 1, pageSize: 10 };
      },
    } as unknown as Parameters<typeof handleMcpHttp>[1];
    const res = await handleMcpHttp(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer t",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "search_stays", arguments: { city: "Bodrum" } },
        }),
      }),
      deps
    );
    expect(res.status).toBe(200);
    expect(subjects).toEqual(["u:u-mcp"]);
  });
});
