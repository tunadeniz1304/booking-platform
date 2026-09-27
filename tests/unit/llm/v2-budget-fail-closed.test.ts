import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  createLlmClient,
  createRemoteEmbedFn,
  LlmBudgetExceededError,
  resetLlmRuntimeForTests,
} from "@/lib/llm/client";
import { parseLlmSettings } from "@/lib/llm/settings";
import { createRedisBudget, runWithLlmSubject } from "@/lib/llm/budget";
import { FakeRedis } from "../../helpers/fake-redis";

/**
 * v2-P0-4 — LLM token bütçesi fail-closed + atomik rezervasyon.
 *  - Özne yoksa canlı çağrı SDK'ya gitmez (fallback `no_subject`).
 *  - Kontrol + düşüm tek atomik rezervasyon: limitin 1 token altındaki özneden
 *    eşzamanlı N çağrının en fazla biri sağlayıcıya ulaşır.
 *  - Araç döngüsü her adımda bütçeyi yeniden kontrol eder.
 * Ağa çıkılmaz: OpenAI SDK'sına sahte `fetch`, Redis yerine FakeRedis.
 */

const LIMIT = 50_000;
const today = () => new Date().toISOString().slice(0, 10);
const budgetKey = (subject: string) => `llm:budget:${subject}:${today()}`;

type Body = { messages: Array<{ role: string; content: string | null }>; input?: unknown };

function fakeFetch(respond: (body: Body, call: number) => unknown, delayMs = 5) {
  const stats = { calls: 0 };
  const impl = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Body;
    stats.calls += 1;
    const call = stats.calls;
    await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify(respond(body, call)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: impl as typeof fetch, stats };
}

function completion(
  content: string | null,
  usage = { prompt_tokens: 11, completion_tokens: 7 },
  extra: Record<string, unknown> = {}
) {
  return {
    id: "c1",
    object: "chat.completion",
    created: 1,
    model: "deepseek-v4-flash",
    choices: [
      { index: 0, finish_reason: "stop", message: { role: "assistant", content, ...extra } },
    ],
    usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
  };
}

const live = parseLlmSettings({ LLM_API_KEY: "k", LLM_MAX_RETRIES: "0" });
const schema = z.object({ city: z.string() });
const demo = () => ({ city: "Demo" });
const messages = [{ role: "user" as const, content: "Kadıköy" }];

let redis: FakeRedis;
beforeEach(() => {
  resetLlmRuntimeForTests();
  redis = new FakeRedis();
});

describe("regression: v2-P0-4 öznesiz canlı LLM çağrısı fail-closed", () => {
  it("completeJson / completeText / runTools SDK'ya gitmez → fallback no_subject", async () => {
    const f = fakeFetch(() => completion('{"city":"İzmir"}'));
    const client = createLlmClient({
      settings: live,
      fetch: f.fetch,
      budget: createRedisBudget(redis as never, LIMIT),
    });
    const json = await client.completeJson("message_risk", schema, messages, { demo });
    const text = await client.completeText("message_draft", messages, { demo: () => "d" });
    const tools = await client.runTools("trip_plan", schema, messages, [], { demo });
    for (const r of [json, text, tools]) {
      expect(r).toMatchObject({ llmMode: "fallback", reason: "no_subject" });
    }
    expect(json.data).toEqual({ city: "Demo" });
    expect(f.stats.calls).toBe(0);
  });

  it("embedding: özne yoksa ağa çıkılmaz (çağıran hash'e düşer)", async () => {
    const f = fakeFetch(() => ({ object: "list", data: [], model: "emb" }));
    const embed = createRemoteEmbedFn("emb", {
      settings: live,
      fetch: f.fetch,
      budget: createRedisBudget(redis as never, LIMIT),
    })!;
    await expect(embed(["x"], 2)).rejects.toBeInstanceOf(LlmBudgetExceededError);
    expect(f.stats.calls).toBe(0);
  });

  it("açık özne (opts.subject veya bağlam) verilince canlı; kullanım özneye yazılır", async () => {
    const f = fakeFetch(() => completion('{"city":"İzmir"}'));
    const client = createLlmClient({
      settings: live,
      fetch: f.fetch,
      budget: createRedisBudget(redis as never, LIMIT),
    });
    const a = await client.completeJson("smart_filter", schema, messages, {
      demo,
      subject: "u:a",
    });
    const b = await runWithLlmSubject("sys:job", () =>
      client.completeJson("smart_filter", schema, messages, { demo })
    );
    expect(a.llmMode).toBe("live");
    expect(b.llmMode).toBe("live");
    // Rezervasyon gerçek kullanımla (11 + 7) düzeltilir.
    expect(await redis.get(budgetKey("u:a"))).toBe("18");
    expect(await redis.get(budgetKey("sys:job"))).toBe("18");
  });
});

describe("regression: v2-P0-4 bütçe atomik rezervasyonla işlenir", () => {
  it("limitin 1 token altındaki özneden 5 paralel çağrının en fazla 1'i SDK'ya ulaşır", async () => {
    await redis.set(budgetKey("u:near"), String(LIMIT - 1));
    const f = fakeFetch(() => completion('{"city":"İzmir"}'), 20);
    const client = createLlmClient({
      settings: live,
      fetch: f.fetch,
      budget: createRedisBudget(redis as never, LIMIT),
    });
    const results = await runWithLlmSubject("u:near", () =>
      Promise.all(
        Array.from({ length: 5 }, () =>
          client.completeJson("smart_filter", schema, messages, { demo })
        )
      )
    );
    expect(f.stats.calls).toBeLessThanOrEqual(1);
    const denied = results.filter((r) => r.llmMode === "fallback");
    expect(denied.length).toBeGreaterThanOrEqual(4);
    for (const r of denied) expect(r.reason).toBe("budget");
  });

  it("embedding de aynı rezervasyonla: 5 paralelden en fazla 1'i ağa çıkar", async () => {
    await redis.set(budgetKey("u:near"), String(LIMIT - 1));
    const f = fakeFetch(
      () => ({
        object: "list",
        data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
        model: "emb",
        usage: { prompt_tokens: 3, total_tokens: 3 },
      }),
      20
    );
    const embed = createRemoteEmbedFn("emb", {
      settings: live,
      fetch: f.fetch,
      budget: createRedisBudget(redis as never, LIMIT),
    })!;
    const settled = await runWithLlmSubject("u:near", () =>
      Promise.allSettled(Array.from({ length: 5 }, () => embed(["x"], 2)))
    );
    expect(f.stats.calls).toBeLessThanOrEqual(1);
    expect(settled.filter((s) => s.status === "rejected").length).toBeGreaterThanOrEqual(4);
  });

  it("Redis erişilemezse rezervasyon yapılamaz → SDK'ya gidilmez (fail-closed)", async () => {
    redis.failing = true;
    const f = fakeFetch(() => completion('{"city":"İzmir"}'));
    const client = createLlmClient({
      settings: live,
      fetch: f.fetch,
      budget: createRedisBudget(redis as never, LIMIT),
    });
    const res = await client.completeJson("smart_filter", schema, messages, {
      demo,
      subject: "u:x",
    });
    expect(res).toMatchObject({ llmMode: "fallback", reason: "budget" });
    expect(f.stats.calls).toBe(0);
  });
});

describe("regression: v2-P0-4 runTools her adımda bütçeyi kontrol eder", () => {
  it("1. adımın kullanımı bütçeyi doldurunca 2. SDK isteği yapılmaz", async () => {
    const small = 1_000;
    const f = fakeFetch((_body, call) =>
      call === 1
        ? completion(
            null,
            { prompt_tokens: 600, completion_tokens: 500 },
            {
              tool_calls: [
                { id: "t1", type: "function", function: { name: "quote", arguments: "{}" } },
              ],
            }
          )
        : completion('{"city":"İzmir"}')
    );
    const client = createLlmClient({
      settings: live,
      fetch: f.fetch,
      budget: createRedisBudget(redis as never, small),
    });
    let executed = 0;
    const res = await client.runTools(
      "trip_plan",
      schema,
      messages,
      [
        {
          name: "quote",
          description: "fiyat",
          parameters: { type: "object", properties: {} },
          execute: async () => {
            executed += 1;
            return { total: 1 };
          },
        },
      ],
      { demo, subject: "u:tools" }
    );
    expect(f.stats.calls).toBe(1);
    expect(res).toMatchObject({ llmMode: "fallback", reason: "budget", data: { city: "Demo" } });
    expect(executed).toBe(1);
    expect(await redis.get(budgetKey("u:tools"))).toBe("1100");
  });
});
