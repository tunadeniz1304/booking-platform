import { describe, it, expect, beforeEach, vi } from "vitest";

// v2-P0-4: öznesiz canlı çağrı fail-closed. Bu dosya bütçeyi değil istemci davranışını
// sınar → açık bir test öznesi + sınırsız bütçe (LLM_DAILY_TOKEN_BUDGET_PER_USER=0).
vi.mock("@/lib/llm/budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/budget")>()),
  currentLlmSubject: () => "u:test",
}));
import { z } from "zod";
import { createLlmClient, getLlmRuntimeStatus, resetLlmRuntimeForTests } from "@/lib/llm/client";
import { parseLlmSettings } from "@/lib/llm/settings";
import { buildFactSet, assertNumbersGrounded } from "@/lib/llm/guards";

/**
 * LLM istemcisi — ağa çıkmadan, OpenAI SDK'ya sahte `fetch` verilerek test edilir.
 * Böylece SDK'nın gerçek hata sınıfları (RateLimitError, APIConnectionTimeoutError…)
 * ve istek gövdesi (response_format, redakte mesajlar) doğrulanır.
 */

type Body = {
  messages: Array<{ role: string; content: string }>;
  response_format?: { type: string };
  tools?: unknown[];
};
type Handler = (body: Body, call: number) => { status: number; json: unknown } | "hang";

function fakeFetch(handler: Handler): { fetch: typeof fetch; bodies: Body[] } {
  const bodies: Body[] = [];
  const impl = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Body;
    bodies.push(body);
    const result = handler(body, bodies.length);
    if (result === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    return new Response(JSON.stringify(result.json), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: impl as typeof fetch, bodies };
}

function completion(content: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: "c1",
    object: "chat.completion",
    created: 1,
    model: "deepseek-v4-flash",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content, ...extra },
      },
    ],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  };
}

const liveSettings = parseLlmSettings({
  LLM_API_KEY: "test-k",
  LLM_MAX_RETRIES: "0",
  LLM_TIMEOUT_SECONDS: "1",
  LLM_DAILY_TOKEN_BUDGET_PER_USER: "0",
});
const schema = z.object({ city: z.string(), maxPrice: z.number() });
const demo = () => ({ city: "DemoŞehir", maxPrice: 1 });
const messages = [{ role: "user" as const, content: "Kadıköy 3000 TL altı" }];

beforeEach(() => resetLlmRuntimeForTests());

describe("LlmClient — canlı / demo / fallback", () => {
  it("canlı başarı: JSON parse + zod + usage; json_object istenir", async () => {
    const f = fakeFetch(() => ({
      status: 200,
      json: completion('{"city":"İstanbul","maxPrice":3000}'),
    }));
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const res = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(res.llmMode).toBe("live");
    expect(res.data).toEqual({ city: "İstanbul", maxPrice: 3000 });
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 7 });
    expect(f.bodies[0].response_format).toEqual({ type: "json_object" });
    expect(getLlmRuntimeStatus().jsonModeSupported).toBe(true);
  });

  it("anahtar yok → demo, ağa hiç çıkılmaz", async () => {
    const f = fakeFetch(() => {
      throw new Error("çağrılmamalı");
    });
    const client = createLlmClient({ settings: parseLlmSettings({}), fetch: f.fetch });
    const res = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(res.llmMode).toBe("demo");
    expect(res.data).toEqual(demo());
    expect(f.bodies).toHaveLength(0);
  });

  it.each([
    [429, "rate_limited"],
    [500, "upstream_5xx"],
    [503, "upstream_5xx"],
    [401, "http_4xx"],
  ])("HTTP %i → fallback (%s)", async (status, reason) => {
    const f = fakeFetch(() => ({ status, json: { error: { message: "x" } } }));
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const res = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(res.llmMode).toBe("fallback");
    expect(res.reason).toBe(reason);
    expect(res.data).toEqual(demo());
    expect(getLlmRuntimeStatus().lastError).toBe(reason);
  });

  it("timeout → fallback (timeout)", async () => {
    const f = fakeFetch(() => "hang");
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const res = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(res.llmMode).toBe("fallback");
    expect(res.reason).toBe("timeout");
  });

  it("ağ hatası → fallback (network)", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const res = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(res.reason).toBe("network");
  });

  it("geçersiz JSON → fallback (invalid_json)", async () => {
    const f = fakeFetch(() => ({ status: 200, json: completion("üzgünüm, yapamam") }));
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const res = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(res.reason).toBe("invalid_json");
  });

  it("zod hatası → fallback (schema_invalid)", async () => {
    const f = fakeFetch(() => ({ status: 200, json: completion('{"city": 42}') }));
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const res = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(res.reason).toBe("schema_invalid");
  });

  it("boş içerik → fallback (empty_response)", async () => {
    const f = fakeFetch(() => ({ status: 200, json: completion(null) }));
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const res = await client.completeText("smoke", messages, { demo: () => "d" });
    expect(res.reason).toBe("empty_response");
  });

  it("json_object 400 → düz metin yolu; sonuç süreç boyunca önbellekte", async () => {
    const f = fakeFetch((body) =>
      body.response_format
        ? { status: 400, json: { error: { message: "response_format unsupported" } } }
        : {
            status: 200,
            json: completion('Tabii:\n```json\n{"city":"İzmir","maxPrice":2000}\n```'),
          }
    );
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const first = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(first.llmMode).toBe("live");
    expect(first.data).toEqual({ city: "İzmir", maxPrice: 2000 });
    expect(f.bodies).toHaveLength(2);
    expect(getLlmRuntimeStatus().jsonModeSupported).toBe(false);

    await client.completeJson("smart_filter", schema, messages, { demo });
    expect(f.bodies).toHaveLength(3);
    expect(f.bodies[2].response_format).toBeUndefined();
  });

  it("reasoning_content yok sayılır, yalnızca content kullanılır", async () => {
    const f = fakeFetch(() => ({
      status: 200,
      json: completion('{"city":"Bodrum","maxPrice":5000}', {
        reasoning_content: '{"city":"YANLIŞ","maxPrice":0}',
      }),
    }));
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const res = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(res.data.city).toBe("Bodrum");
  });

  it("giden mesajlar redakte edilir; yanıttaki takma ad geri çevrilir", async () => {
    const f = fakeFetch((body) => ({
      status: 200,
      json: completion(
        JSON.stringify({ reply: `Merhaba ${body.messages[0].content.match(/<KISI_\d+>/)?.[0]}` })
      ),
    }));
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const res = await client.completeJson(
      "review_summary",
      z.object({ reply: z.string() }),
      [{ role: "user", content: "Ben Zeynep Arslan, tel 05321234567, mail z@a.io" }],
      { demo: () => ({ reply: "demo" }), knownNames: ["Zeynep Arslan"] }
    );
    const sent = f.bodies[0].messages[0].content;
    expect(sent).not.toContain("Zeynep");
    expect(sent).not.toContain("0532");
    expect(sent).not.toContain("z@a.io");
    expect(res.data.reply).toBe("Merhaba Zeynep Arslan");
  });

  it("guard başarısız → fallback (guard_failed)", async () => {
    const f = fakeFetch(() => ({ status: 200, json: completion("Toplam 9999 TL") }));
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const facts = buildFactSet([3000]);
    const res = await client.completeText("trip_plan", messages, {
      demo: () => "Toplam 3000 TL",
      validate: (text) => assertNumbersGrounded(text, facts),
    });
    expect(res.llmMode).toBe("fallback");
    expect(res.reason).toBe("guard_failed");
    expect(res.data).toBe("Toplam 3000 TL");
  });
});

describe("LlmClient — araç (tool-calling) döngüsü", () => {
  it("araç çağrısı deterministik kodla yürütülür, sonuç modele geri verilir", async () => {
    const f = fakeFetch((body, call) => {
      if (call === 1) {
        return {
          status: 200,
          json: completion(null, {
            tool_calls: [
              {
                id: "t1",
                type: "function",
                function: { name: "quote", arguments: '{"nights":2}' },
              },
            ],
          }),
        };
      }
      const toolMsg = body.messages.find((m) => m.role === "tool");
      const total = JSON.parse(toolMsg?.content ?? "{}").total;
      return { status: 200, json: completion(JSON.stringify({ total })) };
    });
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const res = await client.runTools(
      "trip_plan",
      z.object({ total: z.number() }),
      messages,
      [
        {
          name: "quote",
          description: "fiyat",
          parameters: { type: "object", properties: { nights: { type: "number" } } },
          execute: async (args) => ({ total: 1500 * (args as { nights: number }).nights }),
        },
      ],
      { demo: () => ({ total: 0 }) }
    );
    expect(res.llmMode).toBe("live");
    expect(res.data.total).toBe(3000);
    expect(res.toolCalls).toEqual([
      { name: "quote", args: { nights: 2 }, result: { total: 3000 } },
    ]);
  });

  it("adım sınırı aşılırsa fallback (tool_loop_exceeded)", async () => {
    const f = fakeFetch(() => ({
      status: 200,
      json: completion(null, {
        tool_calls: [{ id: "t", type: "function", function: { name: "x", arguments: "{}" } }],
      }),
    }));
    const settings = { ...liveSettings, maxToolSteps: 2 };
    const client = createLlmClient({ settings, fetch: f.fetch });
    const res = await client.runTools(
      "trip_plan",
      z.object({ ok: z.boolean() }),
      messages,
      [{ name: "x", description: "x", parameters: {}, execute: async () => ({}) }],
      { demo: () => ({ ok: false }) }
    );
    expect(res.llmMode).toBe("fallback");
    expect(res.reason).toBe("tool_loop_exceeded");
    expect(f.bodies).toHaveLength(3);
  });
});
