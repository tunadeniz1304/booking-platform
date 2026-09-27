import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { LlmBudgetExceededError } from "@/lib/llm/client";

/**
 * v2-P0-4 (review) — öznesiz arama fail-closed embedding ile vektör uzaylarını karıştırmaz.
 * İndeks uzak modelle (`EMBEDDING_MODEL`) üretilmişken sorgu gömmesi bütçe/özne yüzünden
 * reddedilirse hash vektörüne düşülüp uzak indeksle kosinüs karşılaştırılmamalı:
 * vektör kanalı atlanır, diğer kanallar çalışır.
 */

const state = vi.hoisted(() => ({
  embedFn: null as null | ((texts: string[], dim: number) => Promise<number[][]>),
  sql: [] as string[],
}));

vi.mock("@/lib/llm/embeddings", () => ({
  createRemoteEmbedFn: (model?: string) =>
    model ? (texts: string[], dim: number) => state.embedFn!(texts, dim) : null,
}));

vi.mock("@/lib/search/vector", () => ({ isVectorEnabled: async () => true }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.sql.push(Prisma.sql(strings, ...(values as Prisma.Sql[])).sql);
      return [];
    },
  },
}));

const VECTOR_CHANNEL = "b.embedding <=>";

async function freshHybrid() {
  vi.resetModules();
  return (await import("@/lib/search/hybrid")).hybridSearch;
}

beforeEach(() => {
  state.sql = [];
  vi.stubEnv("EMBEDDING_MODEL", "text-embedding-3-small");
});

describe("regression: v2-P0-4 öznesiz hibrit arama vektör uzaylarını karıştırmaz", () => {
  it("uzak sorgu gömmesi fail-closed (no_subject) → vektör kanalı atlanır", async () => {
    state.embedFn = async () => {
      throw new LlmBudgetExceededError("no_subject");
    };
    const hybridSearch = await freshHybrid();
    await hybridSearch("deniz manzaralı villa");
    expect(state.sql).toHaveLength(1);
    expect(state.sql[0]).not.toContain(VECTOR_CHANNEL);
    // Sözcüksel kanal yine çalışır.
    expect(state.sql[0]).toContain("to_tsquery");
  });

  it("uzak sorgu gömmesi bütçe aşımında da hash'e düşmez", async () => {
    state.embedFn = async () => {
      throw new LlmBudgetExceededError("budget");
    };
    const hybridSearch = await freshHybrid();
    await hybridSearch("deniz manzaralı villa");
    expect(state.sql[0]).not.toContain(VECTOR_CHANNEL);
  });

  it("uzak sorgu gömmesi başarılıysa vektör kanalı kullanılır", async () => {
    state.embedFn = async (texts, dim) => texts.map(() => Array.from({ length: dim }, () => 0.1));
    const hybridSearch = await freshHybrid();
    await hybridSearch("deniz manzaralı villa");
    expect(state.sql[0]).toContain(VECTOR_CHANNEL);
  });
});
