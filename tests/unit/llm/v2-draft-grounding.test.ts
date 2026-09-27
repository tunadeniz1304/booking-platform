import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmBudget } from "@/lib/llm/budget";
import type { LlmClient } from "@/lib/llm/client";

const state = vi.hoisted(() => ({
  client: null as LlmClient | null,
  replies: [] as string[],
  reviewRows: [] as unknown[],
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
        guestCount: 4,
        user: { firstName: "Ayşe", lastName: "Yıldız" },
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
        { senderRole: "GUEST", body: "Merhaba, iptal edersem 1500 TL iade alabilir miyim?" },
      ],
    },
    review: { findMany: async () => state.reviewRows },
  },
}));

vi.mock("@/lib/messaging/hub", () => ({ publishMessage: async () => {} }));
vi.mock("@/lib/trust/message-risk", () => ({
  enforceMessageScan: async () => {},
  loadMessageRisks: async () => new Map(),
  recordMessageRisk: async () => null,
  scanOutgoingMessage: async () => ({}),
}));
vi.mock("@/lib/reviews/review-service", () => ({
  bumpVersion: async () => {},
  recomputeRating: async () => {},
}));

import { createLlmClient, resetLlmRuntimeForTests } from "@/lib/llm/client";
import { parseLlmSettings } from "@/lib/llm/settings";
import { runWithLlmSubject } from "@/lib/llm/budget";
import { createLimiter } from "@/lib/resilience/limit";
import { draftHostReply } from "@/lib/messaging/message-service";
import { listModerationQueue } from "@/lib/reviews/moderation-queue";
import { demoModerationExplain } from "@/lib/llm/demo";

/**
 * v2-P0-7 — message_draft ve moderation_explain çıktısındaki her sayı/tarih girdideki
 * olgulardan gelmeli; uydurma tutar ("1500 TL iade") taslağa/açıklamaya sızmaz.
 * Ağa çıkılmaz: gerçek istemci, sahte `fetch` ile canlı yanıt taklidi (live-mock).
 */

function completion(content: string) {
  return {
    id: "c1",
    object: "chat.completion",
    created: 1,
    model: "deepseek-v4-flash",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  };
}

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
  const fetchImpl = async (): Promise<Response> =>
    new Response(JSON.stringify(completion(state.replies.shift() ?? "{}")), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
  state.replies = [];
  state.reviewRows = [];
});

describe("regression: v2-P0-7 message_draft sayı koruması", () => {
  it("girdide olmayan iade tutarı taslağa girmez; çağrı demo taslağına düşer", async () => {
    state.replies.push(
      JSON.stringify({
        reply: "Merhaba [MISAFIR], iptal ederseniz size 1500 TL iade edeceğiz. Görüşmek üzere!",
      })
    );
    const res = await runWithLlmSubject("u:host-1", () => draftHostReply("b1", "host-1"));
    expect(res.draft).not.toContain("1500");
    expect(res.llmMode).toBe("fallback");
    expect(res.draft).toContain("Ayşe");
  });

  it("girdideki tarihleri, gece ve misafir sayısını içeren yanıt canlı geçer", async () => {
    state.replies.push(
      JSON.stringify({
        reply:
          "Merhaba [MISAFIR], 2026-10-12 – 12.10.2026 girişli 3 gecelik konaklamanızda 4 kişilik hazırlığı yaptık. 15.10.2026 çıkışınıza kadar buradayız.",
      })
    );
    const res = await runWithLlmSubject("u:host-1", () => draftHostReply("b1", "host-1"));
    expect(res.llmMode).toBe("live");
    expect(res.draft).toContain("Merhaba Ayşe");
    expect(res.draft).toContain("4 kişilik");
  });
});

describe("regression: v2-P0-7 moderation_explain sayı koruması", () => {
  const row = (reasons: unknown) => ({
    id: "r1",
    propertyId: "p1",
    rating: 2,
    comment: "…",
    moderationStatus: "PENDING_REVIEW",
    moderationReasons: reasons,
    reportCount: 3,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    property: { title: "Deniz Manzaralı Daire" },
  });

  it("gerekçede olmayan sayı içeren açıklama deterministik açıklamaya düşer", async () => {
    const reasons = [{ code: "PROFANITY", detail: "Küfür/hakaret içeren ifade" }];
    state.reviewRows = [row(reasons)];
    state.replies.push(
      JSON.stringify({ explanation: "Yorum 7 kez şikayet edildi; misafire 1500 TL iade önerilir." })
    );
    const [item] = await runWithLlmSubject("u:admin", () => listModerationQueue());
    expect(item.explanation).not.toContain("1500");
    expect(item.explanation).toBe(demoModerationExplain(reasons).explanation);
  });

  it("yalnızca gerekçedeki sayıları kullanan açıklama geçer", async () => {
    const reasons = [{ code: "PII_PHONE", detail: "Telefon numarası (1 adet)" }];
    state.reviewRows = [row(reasons)];
    const live = "Yorumda 1 adet telefon numarası bulunduğu için işaretlendi.";
    state.replies.push(JSON.stringify({ explanation: live }));
    const [item] = await runWithLlmSubject("u:admin", () => listModerationQueue());
    expect(item.explanation).toBe(live);
  });
});
