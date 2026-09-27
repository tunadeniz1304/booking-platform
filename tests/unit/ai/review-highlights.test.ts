import { describe, it, expect, beforeEach, vi } from "vitest";

// v2-P0-4: öznesiz canlı çağrı fail-closed → canlı yol açık bir test öznesiyle sınanır.
vi.mock("@/lib/llm/budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/budget")>()),
  currentLlmSubject: () => "u:test",
}));
import {
  buildReviewHighlights,
  splitSentences,
  topKeyword,
  type HighlightReview,
  type HighlightsConfig,
} from "@/lib/ai/review-highlights-core";
import { createLlmClient, resetLlmRuntimeForTests } from "@/lib/llm/client";
import { parseLlmSettings } from "@/lib/llm/settings";
import { HashEmbedder, type Embedder } from "@/lib/embedding/provider";
import type { LlmBudget } from "@/lib/llm/budget";

/**
 * v4 P1-9 yorum öne çıkanları: demo deterministik ve gerçek cümlelerden; canlı modda
 * uydurma/alıntısız iddia reddedilir; hiç geçerli iddia kalmazsa fallback. Ağa çıkılmaz
 * (OpenAI SDK'ya sahte fetch).
 */
const reviews: HighlightReview[] = [
  {
    id: "r1",
    rating: 5,
    comment: "Oda çok temiz ve ferahtı. Kahvaltı zengindi.",
    author: "Ayşe Yılmaz",
  },
  {
    id: "r2",
    rating: 4,
    comment: "Temizlik mükemmeldi, oda pırıl pırıl. Konum harika, metroya yakın.",
  },
  {
    id: "r3",
    rating: 5,
    comment: "Konum çok iyi, metro hemen yakında. Ayşe Yılmaz bizi karşıladı.",
  },
  { id: "r4", rating: 2, comment: "Kahvaltı zayıftı ve 2 kez soğuk geldi. Oda temiz ama küçük." },
];

const config: HighlightsConfig = {
  minReviews: 2,
  maxClusters: 4,
  seed: 42,
  maxIterations: 50,
  maxClaims: 3,
  minQuoteChars: 12,
};

const noBudget: LlmBudget = {
  exceeded: async () => false,
  reserve: async () => true,
  consume: async () => undefined,
};
const demoClient = () => createLlmClient({ settings: parseLlmSettings({}), budget: noBudget });

function liveClient(content: (call: number, body: { messages: { content: string }[] }) => unknown) {
  const bodies: Array<{ messages: { content: string }[] }> = [];
  const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    bodies.push(body);
    const out = content(bodies.length, body);
    if (out === 500) return new Response("{}", { status: 500 });
    return new Response(
      JSON.stringify({
        id: "c",
        object: "chat.completion",
        created: 1,
        model: "m",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(out) },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const client = createLlmClient({
    settings: parseLlmSettings({
      LLM_API_KEY: "test-k",
      LLM_MAX_RETRIES: "0",
      LLM_TIMEOUT_SECONDS: "1",
    }),
    fetch: fetchImpl as typeof fetch,
    budget: noBudget,
  });
  return { client, bodies };
}

beforeEach(() => resetLlmRuntimeForTests());

describe("splitSentences / topKeyword", () => {
  it("cümle aralıkları özgün metinle birebir", () => {
    const s = splitSentences({ id: "r", comment: "  Oda temiz.  Konum iyi!\nSon" });
    expect(s.map((x) => x.text)).toEqual(["Oda temiz.", "Konum iyi!", "Son"]);
    for (const x of s) expect("  Oda temiz.  Konum iyi!\nSon".slice(x.start, x.end)).toBe(x.text);
    expect(splitSentences({ id: "r", comment: "... !!" })).toEqual([]);
  });

  it("en sık sözcük (katlanmış), eşitlikte ilk görülen", () => {
    const s = splitSentences({ id: "r", comment: "Konum iyi. Konum güzel. Oda iyi." });
    expect(topKeyword(s)).toBe("konum");
    expect(topKeyword([])).toBeNull();
  });
});

describe("buildReviewHighlights — demo", () => {
  it("deterministik; tüm alıntılar kaynak yorumlarda birebir ve aralıklar doğru", async () => {
    const deps = {
      client: demoClient(),
      embedder: new HashEmbedder(),
      locale: "tr" as const,
      config,
    };
    const a = await buildReviewHighlights(reviews, deps);
    const b = await buildReviewHighlights([...reviews].reverse(), deps);
    expect(b).toEqual(a);
    expect(a.llmMode).toBe("demo");
    expect(a.reviewCount).toBe(4);
    expect(a.clusters.length).toBeGreaterThanOrEqual(2);
    const byId = new Map(reviews.map((r) => [r.id, r.comment]));
    for (const c of a.clusters) {
      expect(c.llmMode).toBe("demo");
      expect(c.title).toMatch(/^(Öne çıkan konu: |Diğer görüşler)/);
      expect(c.mentionCount).toBe(c.reviewIds.length);
      expect(c.claims.length).toBeGreaterThan(0);
      for (const claim of c.claims) {
        expect(byId.get(claim.reviewId)!.slice(claim.start, claim.end)).toBe(claim.quote);
      }
    }
    const total = a.clusters.reduce((s, c) => s + c.mentionCount, 0);
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it("İngilizce başlık ve en az yorum eşiği", async () => {
    const deps = {
      client: demoClient(),
      embedder: new HashEmbedder(),
      locale: "en" as const,
      config,
    };
    const en = await buildReviewHighlights(reviews, deps);
    expect(en.clusters[0].title).toMatch(/^(Recurring topic: |Other feedback)/);
    const few = await buildReviewHighlights(reviews.slice(0, 1), deps);
    expect(few.clusters).toEqual([]);
    const blank = await buildReviewHighlights(
      [
        { id: "a", rating: 3, comment: "..." },
        { id: "b", rating: 3, comment: "!!" },
      ],
      deps
    );
    expect(blank.clusters).toEqual([]);
  });

  it("embedding'e giden metin redakte edilir (ad/telefon)", async () => {
    const seen: string[] = [];
    const spy: Embedder = {
      name: "spy",
      dim: 128,
      async embed(texts) {
        seen.push(...texts);
        return new HashEmbedder().embed(texts);
      },
    };
    await buildReviewHighlights(
      [...reviews, { id: "r5", rating: 4, comment: "Beni 0532 123 45 67 numarasından aradılar." }],
      { client: demoClient(), embedder: spy, locale: "tr", config }
    );
    expect(seen.join(" ")).not.toContain("Ayşe Yılmaz");
    expect(seen.join(" ")).not.toContain("0532 123 45 67");
  });
});

describe("buildReviewHighlights — canlı (sahte fetch)", () => {
  const one = { ...config, maxClusters: 1 };

  it("uydurma ve alıntısız iddialar reddedilir, gerçek alıntılı iddia kalır", async () => {
    const { client, bodies } = liveClient(() => ({
      title: "Temizlik ve konum",
      claims: [
        { text: "Odalar temiz", quote: "Oda çok temiz ve ferahtı", reviewId: "r1" },
        { text: "Havuz harika", quote: "Havuz çok büyük ve ılıktı", reviewId: "r2" },
        { text: "Personel ilgili", quote: "", reviewId: "r3" },
        { text: "Kahvaltı 3 kez soğuk", quote: "Kahvaltı zayıftı", reviewId: "r4" },
      ],
    }));
    const res = await buildReviewHighlights(reviews, {
      client,
      embedder: new HashEmbedder(),
      locale: "tr",
      config: one,
    });
    expect(res.llmMode).toBe("live");
    expect(res.rejectedClaims).toBe(3);
    expect(res.clusters).toHaveLength(1);
    expect(res.clusters[0].claims).toEqual([
      {
        text: "Odalar temiz",
        quote: "Oda çok temiz ve ferahtı",
        reviewId: "r1",
        start: 0,
        end: 24,
      },
    ]);
    // LLM'e giden prompt redakte: yorumdaki yazar adı maskeli.
    expect(JSON.stringify(bodies[0])).not.toContain("Ayşe Yılmaz");
  });

  it("geçerli iddia kalmazsa küme demo özetine düşer (fallback, guard_failed)", async () => {
    const { client } = liveClient(() => ({
      title: "Uydurma",
      claims: [{ text: "Spa var", quote: "Spa merkezi mükemmeldi", reviewId: "r1" }],
    }));
    const res = await buildReviewHighlights(reviews, {
      client,
      embedder: new HashEmbedder(),
      locale: "tr",
      config: one,
    });
    expect(res.llmMode).toBe("fallback");
    expect(res.clusters[0].llmMode).toBe("fallback");
    expect(res.clusters[0].title).toMatch(/^Öne çıkan konu: /);
    expect(res.clusters[0].claims.every((c) => c.quote.length > 0)).toBe(true);
  });

  it("başlıkta kaynakta olmayan sayı → fallback; sağlayıcı 5xx → fallback", async () => {
    const bad = liveClient(() => ({
      title: "Misafirlerin %97'si memnun",
      claims: [{ text: "Odalar temiz", quote: "Oda çok temiz ve ferahtı", reviewId: "r1" }],
    }));
    const r1 = await buildReviewHighlights(reviews, {
      client: bad.client,
      embedder: new HashEmbedder(),
      locale: "tr",
      config: one,
    });
    expect(r1.llmMode).toBe("fallback");
    const down = liveClient(() => 500);
    const r2 = await buildReviewHighlights(reviews, {
      client: down.client,
      embedder: new HashEmbedder(),
      locale: "tr",
      config: one,
    });
    expect(r2.llmMode).toBe("fallback");
    expect(r2.clusters[0].claims.length).toBeGreaterThan(0);
  });
});
