import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// v2-P0-4: öznesiz canlı çağrı fail-closed. Bu dosya bütçeyi değil istemci davranışını
// sınar → açık bir test öznesi + sınırsız bütçe (LLM_DAILY_TOKEN_BUDGET_PER_USER=0).
vi.mock("@/lib/llm/budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/budget")>()),
  currentLlmSubject: () => "u:test",
}));
import { z } from "zod";
import { createLlmClient, getLlmRuntimeStatus, resetLlmRuntimeForTests } from "@/lib/llm/client";
import { parseLlmSettings } from "@/lib/llm/settings";

/**
 * v5#18 — JSON modu geri çekilmesi daraltılır: yalnız `response_format` ile ilgili 400
 * JSON modunu `LLM_JSON_MODE_RETRY_MINUTES` boyunca kapatır; diğer 400'ler (ör. bağlam
 * taşması) yalnız o çağrıyı fallback'e düşürür. Ağa çıkmaz (sahte `fetch`).
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
  LLM_JSON_MODE_RETRY_MINUTES: "10",
});
const schema = z.object({ city: z.string(), maxPrice: z.number() });
const demo = () => ({ city: "DemoŞehir", maxPrice: 1 });
const messages = [{ role: "user" as const, content: "Kadıköy 3000 TL altı" }];
const ok = () => ({ status: 200, json: completion('{"city":"İzmir","maxPrice":2000}') });

beforeEach(() => resetLlmRuntimeForTests());
afterEach(() => vi.useRealTimers());

describe("regression: v5#18 JSON modu geri çekilmesi", () => {
  it("bağlam taşması 400'ü o çağrıyı fallback'e düşürür; sonraki çağrı yine JSON modu dener", async () => {
    const f = fakeFetch((_body, call) =>
      call === 1
        ? {
            status: 400,
            json: {
              error: {
                message: "This model's maximum context length is 8192 tokens.",
                type: "invalid_request_error",
                param: "messages",
                code: "context_length_exceeded",
              },
            },
          }
        : ok()
    );
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const first = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(first.llmMode).toBe("fallback");
    expect(first.reason).toBe("http_4xx");
    // Aynı çağrı JSON'suz tekrarlanmaz (başka bir 400'ün düz metinle düzelmesi beklenmez).
    expect(f.bodies).toHaveLength(1);
    expect(getLlmRuntimeStatus().jsonModeSupported).not.toBe(false);

    const second = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(second.llmMode).toBe("live");
    expect(f.bodies[1].response_format).toEqual({ type: "json_object" });
  });

  it("response_format param'lı 400 JSON modunu kapatır; TTL sonunda yeniden dener", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
    const f = fakeFetch((body) =>
      body.response_format
        ? {
            status: 400,
            json: { error: { message: "Invalid parameter.", param: "response_format" } },
          }
        : ok()
    );
    const client = createLlmClient({ settings: liveSettings, fetch: f.fetch });
    const first = await client.completeJson("smart_filter", schema, messages, { demo });
    expect(first.llmMode).toBe("live");
    expect(f.bodies).toHaveLength(2);
    expect(getLlmRuntimeStatus().jsonModeSupported).toBe(false);

    vi.setSystemTime(new Date("2026-09-27T10:09:00Z"));
    await client.completeJson("smart_filter", schema, messages, { demo });
    expect(f.bodies).toHaveLength(3);
    expect(f.bodies[2].response_format).toBeUndefined();

    vi.setSystemTime(new Date("2026-09-27T10:11:00Z"));
    await client.completeJson("smart_filter", schema, messages, { demo });
    expect(f.bodies[3].response_format).toEqual({ type: "json_object" });
  });
});
