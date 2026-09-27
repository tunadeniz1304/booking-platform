import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { z } from "zod";
import {
  createLlmClient,
  createRemoteEmbedFn,
  LlmBudgetExceededError,
  resetLlmRuntimeForTests,
} from "@/lib/llm/client";
import { LLM_DEFAULTS, parseLlmSettings } from "@/lib/llm/settings";
import { runWithLlmSubject, type LlmBudget } from "@/lib/llm/budget";
import { createLimiter, mapLimit } from "@/lib/resilience/limit";

/**
 * v4#3 — ölçülmeyen LLM harcaması: eşzamanlılık sınırı, tüm AI yollarında bütçe öznesi,
 * embeddings redaksiyonu/bütçesi ve `openai` importunun yalnızca client.ts'e kısıtlanması.
 * Ağa çıkılmaz: OpenAI SDK'sına sahte `fetch` verilir.
 */

const root = path.resolve(__dirname, "../../..");

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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Her isteği `delayMs` bekleten ve aynı anda uçuştaki azami istek sayısını ölçen fetch. */
function slowFetch(delayMs: number, respond: (body: unknown) => unknown) {
  const stats = { inFlight: 0, maxInFlight: 0, calls: 0, bodies: [] as unknown[] };
  const impl = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    stats.bodies.push(body);
    stats.calls += 1;
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise((r) => setTimeout(r, delayMs));
    stats.inFlight -= 1;
    return json(respond(body));
  };
  return { fetch: impl as typeof fetch, stats };
}

function memoryBudget(limit: number): LlmBudget & { used: Map<string, number> } {
  const used = new Map<string, number>();
  return {
    used,
    async exceeded(subject) {
      return (used.get(subject) ?? 0) >= limit;
    },
    async reserve(subject, tokens) {
      if ((used.get(subject) ?? 0) >= limit) return false;
      used.set(subject, (used.get(subject) ?? 0) + tokens);
      return true;
    },
    async consume(subject, tokens) {
      used.set(subject, (used.get(subject) ?? 0) + tokens);
    },
  };
}

beforeEach(() => resetLlmRuntimeForTests());

describe("regression: v4#3 LLM eşzamanlılık sınırı (LLM_MAX_CONCURRENCY)", () => {
  it("varsayılan 4; geçersiz değer varsayılana döner; LLM_VISION_MODEL opsiyonel", () => {
    expect(LLM_DEFAULTS.maxConcurrency).toBe(4);
    const d = parseLlmSettings({});
    expect(d.maxConcurrency).toBe(4);
    expect(d.visionModel).toBeUndefined();
    const bad = parseLlmSettings({ LLM_MAX_CONCURRENCY: "0" });
    expect(bad.maxConcurrency).toBe(4);
    expect(bad.invalidKeys).toContain("maxConcurrency");
    const s = parseLlmSettings({ LLM_MAX_CONCURRENCY: "2", LLM_VISION_MODEL: " vis-1 " });
    expect(s.maxConcurrency).toBe(2);
    expect(s.visionModel).toBe("vis-1");
  });

  it("20 eşzamanlı canlı çağrıda uçuştaki istek sayısı sınırı aşmaz", async () => {
    const f = slowFetch(15, () => completion('{"ok":true}'));
    const settings = parseLlmSettings({
      LLM_API_KEY: "k",
      LLM_MAX_RETRIES: "0",
      LLM_MAX_CONCURRENCY: "3",
    });
    const client = createLlmClient({
      settings,
      fetch: f.fetch,
      limiter: createLimiter(settings.maxConcurrency),
      budget: memoryBudget(Number.POSITIVE_INFINITY),
    });
    // v2-P0-4: öznesiz canlı çağrı fail-closed → açık özne (bütçe burada sınanmıyor).
    const results = await runWithLlmSubject("u:concurrency", () =>
      Promise.all(
        Array.from({ length: 20 }, () =>
          client.completeJson("smoke", z.object({ ok: z.boolean() }), [], {
            demo: () => ({ ok: false }),
          })
        )
      )
    );
    expect(results.every((r) => r.llmMode === "live")).toBe(true);
    expect(f.stats.calls).toBe(20);
    expect(f.stats.maxInFlight).toBe(3);
  });

  it("sınırlayıcı: FIFO, hata yuvayı serbest bırakır, mapLimit sırayı korur", async () => {
    const limit = createLimiter(1);
    const order: number[] = [];
    const failing = limit(async () => {
      order.push(1);
      throw new Error("x");
    });
    const second = limit(async () => {
      order.push(2);
      return 2;
    });
    expect(limit.pendingCount).toBe(1);
    await expect(failing).rejects.toThrow("x");
    await expect(second).resolves.toBe(2);
    expect(order).toEqual([1, 2]);
    expect(limit.activeCount).toBe(0);
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20]);
    expect(peak).toBe(2);
    expect(() => createLimiter(0)).toThrow(RangeError);
  });
});

describe("regression: v4#3 embeddings: redaksiyon + bütçe + eşzamanlılık", () => {
  const live = parseLlmSettings({ LLM_API_KEY: "k", LLM_MAX_RETRIES: "0" });

  it("anahtarsız/demo modda veya model yoksa uzak embedding yok (null)", () => {
    expect(createRemoteEmbedFn("emb", { settings: parseLlmSettings({}) })).toBeNull();
    expect(createRemoteEmbedFn(undefined, { settings: live })).toBeNull();
  });

  it("giden metin KVKK redaksiyonundan geçer; tüketim özneye faturalanır", async () => {
    const f = slowFetch(1, () => ({
      object: "list",
      data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
      model: "emb",
      usage: { prompt_tokens: 7, total_tokens: 7 },
    }));
    const budget = memoryBudget(100);
    const embed = createRemoteEmbedFn("emb", {
      settings: live,
      fetch: f.fetch,
      budget,
      limiter: createLimiter(2),
    })!;
    const vectors = await runWithLlmSubject("u:1", () =>
      embed(["Ayşe ayse@example.com 0532 123 45 67 TR330006100519786457841326"], 2)
    );
    expect(vectors).toEqual([[0.1, 0.2]]);
    const sent = JSON.stringify(f.stats.bodies[0]);
    expect(sent).not.toContain("ayse@example.com");
    expect(sent).not.toContain("0532 123 45 67");
    expect(sent).not.toContain("TR330006100519786457841326");
    expect(sent).toContain("<EPOSTA_1>");
    expect(budget.used.get("u:1")).toBe(7);
  });

  it("bütçe dolduysa ağa çıkılmaz (çağıran hash-embedder'a düşer)", async () => {
    const f = slowFetch(1, () => ({}));
    const budget = memoryBudget(1);
    budget.used.set("u:2", 5);
    const embed = createRemoteEmbedFn("emb", { settings: live, fetch: f.fetch, budget })!;
    await expect(runWithLlmSubject("u:2", () => embed(["x"], 2))).rejects.toBeInstanceOf(
      LlmBudgetExceededError
    );
    expect(f.stats.calls).toBe(0);
  });
});

describe("regression: v4#3 LLM çağıran her uç bütçe öznesiyle sarılı", () => {
  /** LLM'e giden servis fonksiyonları → bunları çağıran route `withAiSubject` kullanmalı. */
  const LLM_ENTRYPOINTS = [
    "draftHostReply",
    "generateSuggestions",
    "listModerationQueue",
    "translateQuery",
    "summarizeReviews",
    "planTrip",
    "draftListingCopy",
    "proposeFromText",
    "searchProperties",
  ];

  function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return routeFiles(full);
      return name === "route.ts" ? [full] : [];
    });
  }

  it("messages/draft, host/revenue/suggestions, admin/reviews dahil tüm AI route'ları", () => {
    const offenders: string[] = [];
    const covered = new Set<string>();
    for (const file of routeFiles(path.join(root, "src/app/api"))) {
      const src = readFileSync(file, "utf8");
      const calls = LLM_ENTRYPOINTS.filter((fn) => new RegExp(`\\b${fn}\\(`).test(src));
      if (calls.length === 0) continue;
      calls.forEach((c) => covered.add(c));
      if (!src.includes("withAiSubject(")) offenders.push(path.relative(root, file));
    }
    expect(offenders).toEqual([]);
    for (const fn of ["draftHostReply", "generateSuggestions", "listModerationQueue"]) {
      expect(covered.has(fn)).toBe(true);
    }
  });

  it("withAiSubject içindeki çağrı özneye faturalanır; bütçe dolunca demo (budget)", async () => {
    vi.resetModules();
    const f = slowFetch(1, () => completion("Kısa yanıt."));
    const budget = memoryBudget(10);
    const client = createLlmClient({
      settings: parseLlmSettings({ LLM_API_KEY: "k", LLM_MAX_RETRIES: "0" }),
      fetch: f.fetch,
      budget,
    });
    const call = () =>
      runWithLlmSubject("u:host", () =>
        client.completeText("message_draft", [], { demo: () => "d" })
      );
    expect((await call()).llmMode).toBe("live");
    expect(budget.used.get("u:host")).toBe(10);
    const second = await call();
    expect(second).toMatchObject({ llmMode: "fallback", reason: "budget" });
    expect(f.stats.calls).toBe(1);
  });
});

describe("regression: v4#3 `openai` yalnızca src/lib/llm/client.ts içinde", () => {
  it("ESLint kuralı yalnızca client.ts'i muaf tutar", () => {
    const config = readFileSync(path.join(root, "eslint.config.mjs"), "utf8");
    expect(config).toMatch(/ignores: \["src\/lib\/llm\/client\.ts", "tests\/\*\*"\]/);
    expect(config).not.toMatch(/"src\/lib\/llm\/\*\*"/);
  });

  it("kaynakta client.ts dışında openai importu yok", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs|js)$/.test(name)) {
          const src = readFileSync(full, "utf8");
          if (/from\s+["']openai(\/[^"']*)?["']/.test(src)) hits.push(path.relative(root, full));
        }
      }
    };
    for (const d of ["src", "services", "scripts"]) walk(path.join(root, d));
    expect(hits.map((h) => h.replace(/\\/g, "/"))).toEqual(["src/lib/llm/client.ts"]);
  });
});
