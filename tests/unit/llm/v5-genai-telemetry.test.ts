import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/llm/budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/budget")>()),
  currentLlmSubject: () => "u:test",
}));
import { z } from "zod";
import type { Span, Tracer } from "@opentelemetry/api";
import { createLlmClient, resetLlmRuntimeForTests } from "@/lib/llm/client";
import { parseLlmSettings } from "@/lib/llm/settings";
import { GENAI_ATTR, GENAI_SEMCONV_VERSION } from "@/lib/llm/telemetry";

/**
 * P1-5 — `client.ts` GenAI span'leri (semconv sabit sürüm). Ağa çıkmaz: sahte `fetch`
 * + bellek-içi sahte tracer. İçerik yakalama kapalıyken prompt metni span'de YOK.
 */

interface RecordedSpan {
  name: string;
  attributes: Record<string, unknown>;
  status?: number;
  ended: boolean;
}

function fakeTracer(): { tracer: Tracer; spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  const tracer = {
    startActiveSpan(
      name: string,
      options: { attributes?: Record<string, unknown> },
      fn: (s: Span) => unknown
    ) {
      const rec: RecordedSpan = {
        name,
        attributes: { ...(options.attributes ?? {}) },
        ended: false,
      };
      spans.push(rec);
      const span = {
        setAttribute(k: string, v: unknown) {
          rec.attributes[k] = v;
          return span;
        },
        setStatus(s: { code: number }) {
          rec.status = s.code;
          return span;
        },
        end() {
          rec.ended = true;
        },
      } as unknown as Span;
      return fn(span);
    },
  } as unknown as Tracer;
  return { tracer, spans };
}

const PRIVATE_PROMPT = "Kadıköy 3000 TL altı, telefonum 0532 111 22 33";

function okFetch(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        id: "c1",
        object: "chat.completion",
        created: 1,
        model: "deepseek-v4-flash",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: '{"city":"İzmir"}' },
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;
}

const schema = z.object({ city: z.string() });
const messages = [{ role: "user" as const, content: PRIVATE_PROMPT }];

function settings(capture: boolean) {
  return parseLlmSettings({
    LLM_API_KEY: "test-k",
    LLM_MAX_RETRIES: "0",
    LLM_TIMEOUT_SECONDS: "1",
    LLM_DAILY_TOKEN_BUDGET_PER_USER: "0",
    LLM_OTEL_CAPTURE_CONTENT: capture ? "true" : "false",
  });
}

beforeEach(() => resetLlmRuntimeForTests());

describe("P1-5 gen_ai span'leri", () => {
  it("semconv sürümü sabit", () => {
    expect(GENAI_SEMCONV_VERSION).toBe("1.37.0");
  });

  it("canlı çağrı: operation/model/usage/finish_reasons öznitelikleri", async () => {
    const { tracer, spans } = fakeTracer();
    const client = createLlmClient({ settings: settings(false), fetch: okFetch(), tracer });
    const r = await client.completeJson("smart_filter", schema, messages, {
      demo: () => ({ city: "x" }),
    });
    expect(r.llmMode).toBe("live");
    expect(spans).toHaveLength(1);
    const s = spans[0]!;
    expect(s.name).toBe("chat deepseek-v4-flash");
    expect(s.ended).toBe(true);
    expect(s.attributes[GENAI_ATTR.operationName]).toBe("chat");
    expect(s.attributes[GENAI_ATTR.requestModel]).toBe("deepseek-v4-flash");
    expect(s.attributes[GENAI_ATTR.usageInputTokens]).toBe(11);
    expect(s.attributes[GENAI_ATTR.usageOutputTokens]).toBe(7);
    expect(s.attributes[GENAI_ATTR.responseFinishReasons]).toEqual(["stop"]);
    expect(s.attributes[GENAI_ATTR.task]).toBe("smart_filter");
  });

  it("içerik yakalama KAPALI: prompt/yanıt metni hiçbir öznitelikte yok", async () => {
    const { tracer, spans } = fakeTracer();
    const client = createLlmClient({ settings: settings(false), fetch: okFetch(), tracer });
    await client.completeJson("smart_filter", schema, messages, { demo: () => ({ city: "x" }) });
    const dump = JSON.stringify(spans);
    expect(dump).not.toContain("Kadıköy");
    expect(dump).not.toContain("İzmir");
    expect(spans[0]!.attributes[GENAI_ATTR.inputMessages]).toBeUndefined();
    expect(spans[0]!.attributes[GENAI_ATTR.outputMessages]).toBeUndefined();
  });

  it("içerik yakalama AÇIK: içerik yazılır ama redakte (telefon yok)", async () => {
    const { tracer, spans } = fakeTracer();
    const client = createLlmClient({ settings: settings(true), fetch: okFetch(), tracer });
    await client.completeJson("smart_filter", schema, messages, { demo: () => ({ city: "x" }) });
    const input = String(spans[0]!.attributes[GENAI_ATTR.inputMessages]);
    expect(input).toContain("Kadıköy");
    expect(input).not.toContain("0532 111 22 33");
    expect(String(spans[0]!.attributes[GENAI_ATTR.outputMessages])).toContain("İzmir");
  });

  it("demo modunda da içeriksiz gen_ai span'i üretilir", async () => {
    const { tracer, spans } = fakeTracer();
    const demoSettings = parseLlmSettings({ LLM_MODE: "demo" });
    const client = createLlmClient({ settings: demoSettings, tracer });
    await client.completeJson("smart_filter", schema, messages, { demo: () => ({ city: "x" }) });
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes[GENAI_ATTR.mode]).toBe("demo");
    expect(spans[0]!.attributes[GENAI_ATTR.providerName]).toBe("booking.demo");
    expect(JSON.stringify(spans)).not.toContain("Kadıköy");
  });
});
