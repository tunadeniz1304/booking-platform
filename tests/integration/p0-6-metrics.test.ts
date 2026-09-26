import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { describeInt } from "./helpers";
import { GET as metricsGet } from "@/app/api/metrics/route";
import { REQUIRED_SERIES } from "@/lib/observability/business-metrics";
import { createLlmClient, resetLlmRuntimeForTests } from "@/lib/llm/client";
import { parseLlmSettings } from "@/lib/llm/settings";

/**
 * P0-6 kabul kriteri: `/api/metrics` (METRICS_TOKEN) yeni iş serilerini döner —
 * defter dengesizliği, iade yeniden denemesi, geç ödeme başarısı, LLM token (rota etiketli),
 * kaldırma SLA aşımı, sepet/bölünmüş ödeme/payout/depozito sayaç ve histogramları.
 */
const TOKEN = "m".repeat(24); // sahte test değeri

function metricsRequest(auth?: string): NextRequest {
  return new NextRequest("http://localhost/api/metrics", {
    headers: auth ? { authorization: auth } : {},
  });
}

async function scrape(): Promise<string> {
  const res = await metricsGet(metricsRequest(`Bearer ${TOKEN}`));
  expect(res.status).toBe(200);
  return res.text();
}

describeInt("P0-6 /api/metrics iş serileri", () => {
  let saved: string | undefined;

  beforeAll(() => {
    saved = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = TOKEN;
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.METRICS_TOKEN;
    else Object.assign(process.env, { METRICS_TOKEN: saved });
    resetLlmRuntimeForTests();
  });

  it("token yoksa 401; zorunlu serilerin tamamı HELP/TYPE ile döner", async () => {
    expect((await metricsGet(metricsRequest())).status).toBe(401);
    expect((await metricsGet(metricsRequest("Bearer yanlis-token-000000"))).status).toBe(401);

    const body = await scrape();
    const missing = REQUIRED_SERIES.filter((name) => !body.includes(`# TYPE ${name} `));
    expect(missing).toEqual([]);
  });

  it("alarm kuralları için sayaçlar olay yokken de 0 değerli seri olarak görünür", async () => {
    const body = await scrape();
    expect(body).toMatch(/^ledger_imbalance_total\{source="reconciliation"\} \d+$/m);
    expect(body).toMatch(/^refund_retry_total\{outcome="failed"\} \d+$/m);
    expect(body).toMatch(/^payment_late_success_total\{outcome="refunded"\} \d+$/m);
    expect(body).toMatch(/^takedown_sla_breach_total\{source="MINISTRY_7565"\} \d+$/m);
    expect(body).toMatch(/^split_plan_total\{outcome="settled"\} \d+$/m);
    expect(body).toMatch(/^payouts_total\{kind="host",outcome="paid"\} \d+$/m);
    expect(body).toMatch(/^damage_deposit_events_total\{outcome="captured"\} \d+$/m);
    // Histogramlar: booking p99 (http_request_duration_seconds) ve yeni sepet/split kovaları.
    expect(body).toMatch(/^# TYPE http_request_duration_seconds histogram$/m);
    expect(body).toMatch(/^# TYPE cart_hold_items histogram$/m);
    expect(body).toMatch(/^# TYPE split_settlement_duration_seconds histogram$/m);
  });

  it("llm_tokens_total canlı çağrıda route etiketiyle artar", async () => {
    resetLlmRuntimeForTests();
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          id: "c1",
          object: "chat.completion",
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: '{"city":"İstanbul"}' },
            },
          ],
          usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    const client = createLlmClient({
      settings: parseLlmSettings({ LLM_API_KEY: "test-k", LLM_MAX_RETRIES: "0" }),
      fetch: fakeFetch,
    });
    const res = await client.completeJson(
      "smart_filter",
      z.object({ city: z.string() }),
      [{ role: "user", content: "İstanbul" }],
      { demo: () => ({ city: "demo" }) }
    );
    expect(res.llmMode).toBe("live");

    const body = await scrape();
    const line = body
      .split("\n")
      .find(
        (l) =>
          l.startsWith("llm_tokens_total{") &&
          l.includes('route="/api/search/smart"') &&
          l.includes('task="smart_filter"') &&
          l.includes('kind="prompt"')
      );
    expect(line).toBeDefined();
    expect(Number(line!.split(" ").pop())).toBeGreaterThanOrEqual(13);
  });
});

describe("P0-6 metrik kataloğu", () => {
  it("zorunlu seri listesi tekrarsız", () => {
    expect(new Set(REQUIRED_SERIES).size).toBe(REQUIRED_SERIES.length);
  });
});
