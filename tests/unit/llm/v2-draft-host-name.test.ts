import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmBudget } from "@/lib/llm/budget";
import type { LlmClient } from "@/lib/llm/client";

const state = vi.hoisted(() => ({
  client: null as LlmClient | null,
  requests: [] as string[],
}));

vi.mock("@/lib/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/client")>();
  return { ...actual, getLlmClient: () => state.client };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: async () => ({
        id: "b1",
        userId: "guest-1",
        status: "CONFIRMED",
        checkIn: new Date("2026-10-12T00:00:00.000Z"),
        checkOut: new Date("2026-10-15T00:00:00.000Z"),
        guestCount: 2,
        user: { firstName: "Ayşe", lastName: "Demir" },
        property: {
          hostId: "host-1",
          title: "Deniz Manzaralı Daire",
          host: { firstName: "Kemal", lastName: "Öztürk" },
        },
      }),
    },
    messageThread: { findUnique: async () => ({ id: "t1" }) },
    message: {
      findMany: async () => [
        { senderRole: "GUEST", body: "Teşekkürler Kemal Bey, Ayşe Demir olarak geliyoruz." },
        { senderRole: "HOST", body: "Merhaba, ben Kemal Öztürk, ev sahibiniz." },
      ],
    },
  },
}));

vi.mock("@/lib/messaging/hub", () => ({ publishMessage: async () => {} }));
vi.mock("@/lib/trust/message-risk", () => ({
  enforceMessageScan: async () => {},
  loadMessageRisks: async () => new Map(),
  recordMessageRisk: async () => null,
  scanOutgoingMessage: async () => ({}),
}));

import { createLlmClient, resetLlmRuntimeForTests } from "@/lib/llm/client";
import { parseLlmSettings } from "@/lib/llm/settings";
import { runWithLlmSubject } from "@/lib/llm/budget";
import { createLimiter } from "@/lib/resilience/limit";
import { draftHostReply } from "@/lib/messaging/message-service";

/**
 * v2-P0-8 — message_draft isteğinde ev sahibinin adı ve misafirin soyadı (geçmiş mesajlar
 * dahil) modele gitmez. Ağa çıkılmaz: gerçek istemci, gövdeyi yakalayan sahte `fetch`.
 */

const unlimited: LlmBudget = {
  async exceeded() {
    return false;
  },
  async reserve() {
    return true;
  },
  async consume() {},
};

function liveClient(): LlmClient {
  const settings = parseLlmSettings({ LLM_API_KEY: "k", LLM_MAX_RETRIES: "0" });
  const fetchImpl = async (_url: unknown, init?: RequestInit): Promise<Response> => {
    state.requests.push(String(init?.body ?? ""));
    const content = JSON.stringify({ reply: "Merhaba [MISAFIR], sizi bekliyoruz. <KISI_2>" });
    return new Response(
      JSON.stringify({
        id: "c1",
        object: "chat.completion",
        created: 1,
        model: "deepseek-v4-flash",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  return createLlmClient({
    settings,
    fetch: fetchImpl as typeof fetch,
    budget: unlimited,
    limiter: createLimiter(settings.maxConcurrency),
  });
}

beforeEach(() => {
  resetLlmRuntimeForTests();
  state.client = liveClient();
  state.requests = [];
});

describe("regression: v2-P0-8 message_draft ad redaksiyonu", () => {
  it("ev sahibinin adı ve misafirin tam adı isteğe girmez", async () => {
    const res = await runWithLlmSubject("u:host-1", () => draftHostReply("b1", "host-1"));
    expect(res.llmMode).toBe("live");
    expect(state.requests).toHaveLength(1);
    const body = state.requests[0];
    expect(body).not.toMatch(/Kemal/i);
    expect(body).not.toMatch(/Öztürk/i);
    expect(body).not.toMatch(/Ayşe/i);
    expect(body).not.toMatch(/Demir/i);
    expect(body).toContain("<KISI_");
    expect(res.draft).toContain("Merhaba Ayşe");
  });
});
