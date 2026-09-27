import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import {
  createLlmClient,
  createRemoteEmbedFn,
  getLlmLimiter,
  resetLlmRuntimeForTests,
} from "@/lib/llm/client";
import { LLM_DEFAULTS, parseLlmSettings } from "@/lib/llm/settings";
import { createRedisBudget, runWithLlmSubject } from "@/lib/llm/budget";
import { llmConcurrencyRejectedTotal } from "@/lib/llm/metrics";
import { createLimiter, LimiterRejectedError } from "@/lib/resilience/limit";
import { FakeRedis } from "../../helpers/fake-redis";

/**
 * v2-P0-5 — LLM eşzamanlılık sınırlayıcısı fail-closed: kuyruk üst sınırı
 * (`LLM_MAX_QUEUE`) ve kuyrukta bekleme zaman aşımı (`LLM_QUEUE_TIMEOUT_MS`).
 * Dolu kuyruk / zaman aşımı → o çağrı SDK'ya gitmeden demo çıktısı,
 * `llmMode: "fallback"`, `reason: "concurrency"`; bütçe rezervasyonu iade edilir.
 * Ağa çıkılmaz: sahte `fetch`, Redis yerine FakeRedis.
 */

const SUBJECT = "u:limiter";
const LIMIT = 50_000;
const today = () => new Date().toISOString().slice(0, 10);
const budgetKey = (subject: string) => `llm:budget:${subject}:${today()}`;
const schema = z.object({ ok: z.boolean() });

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

/** Her isteği `delayMs` bekleten, gövdeleri kaydeden sahte fetch. */
function slowFetch(delayMs: number) {
  const stats = { calls: 0, bodies: [] as string[] };
  const impl = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    stats.calls += 1;
    stats.bodies.push(String(init?.body ?? ""));
    await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify(completion('{"ok":true}')), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: impl as typeof fetch, stats };
}

async function rejectedCount(task: string, reason: string): Promise<number> {
  const metric = await llmConcurrencyRejectedTotal.get();
  return (
    metric.values.find((v) => v.labels.task === task && v.labels.reason === reason)?.value ?? 0
  );
}

let redis: FakeRedis;
beforeEach(() => {
  resetLlmRuntimeForTests();
  redis = new FakeRedis();
});

describe("v2-P0-5 sınırlayıcı: kuyruk üst sınırı ve bekleme zaman aşımı", () => {
  it("kuyruk doluysa yeni iş hemen reddedilir, fn çağrılmaz", async () => {
    const limit = createLimiter(1, { maxQueue: 1 });
    let release!: () => void;
    const first = limit(() => new Promise<number>((r) => (release = () => r(1))));
    const second = limit(async () => 2);
    const third = vi.fn(async () => 3);
    await expect(limit(third)).rejects.toMatchObject({
      name: "LimiterRejectedError",
      reason: "queue_full",
    });
    expect(third).not.toHaveBeenCalled();
    expect(limit.activeCount).toBe(1);
    expect(limit.pendingCount).toBe(1);
    release();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it("kuyrukta zaman aşımına uğrayan iş reddedilir, yuva sızmaz", async () => {
    const limit = createLimiter(1, { queueTimeoutMs: 20 });
    const first = limit(() => new Promise<number>((r) => setTimeout(() => r(1), 80)));
    const queued = vi.fn(async () => 2);
    const second = limit(queued);
    expect(limit.pendingCount).toBe(1);
    const err = await second.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LimiterRejectedError);
    expect((err as LimiterRejectedError).reason).toBe("queue_timeout");
    expect(limit.pendingCount).toBe(0);
    await expect(first).resolves.toBe(1);
    expect(queued).not.toHaveBeenCalled();
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
    // Yuva geri döndü: sonraki iş hemen çalışır.
    await expect(limit(async () => 3)).resolves.toBe(3);
  });

  it("zaman aşımından önce sırası gelen iş normal çalışır", async () => {
    const limit = createLimiter(1, { queueTimeoutMs: 200 });
    const first = limit(() => new Promise<number>((r) => setTimeout(() => r(1), 10)));
    const second = limit(async () => 2);
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });
});

describe("v2-P0-5 LLM istemcisi: dolu kuyruk / zaman aşımı → fallback 'concurrency'", () => {
  it("LLM_MAX_QUEUE ve LLM_QUEUE_TIMEOUT_MS ayarları; geçersiz değer varsayılana döner", () => {
    const d = parseLlmSettings({});
    expect(d.maxQueue).toBe(LLM_DEFAULTS.maxQueue);
    expect(d.queueTimeoutMs).toBe(LLM_DEFAULTS.queueTimeoutMs);
    const s = parseLlmSettings({ LLM_MAX_QUEUE: "0", LLM_QUEUE_TIMEOUT_MS: "250" });
    expect(s.maxQueue).toBe(0);
    expect(s.queueTimeoutMs).toBe(250);
    const bad = parseLlmSettings({ LLM_MAX_QUEUE: "-1", LLM_QUEUE_TIMEOUT_MS: "0" });
    expect(bad.maxQueue).toBe(LLM_DEFAULTS.maxQueue);
    expect(bad.queueTimeoutMs).toBe(LLM_DEFAULTS.queueTimeoutMs);
    expect(bad.invalidKeys).toEqual(expect.arrayContaining(["maxQueue", "queueTimeoutMs"]));
  });

  it("concurrency=1, maxQueue=1: 3. eşzamanlı çağrı SDK'ya gitmeden anında fallback döner", async () => {
    const f = slowFetch(60);
    const settings = parseLlmSettings({
      LLM_API_KEY: "k",
      LLM_MAX_RETRIES: "0",
      LLM_MAX_CONCURRENCY: "1",
      LLM_MAX_QUEUE: "1",
      LLM_QUEUE_TIMEOUT_MS: "60000",
    });
    const client = createLlmClient({
      settings,
      fetch: f.fetch,
      budget: createRedisBudget(redis as never, LIMIT),
    });
    const before = await rejectedCount("smoke", "queue_full");
    let firstSettled = false;
    const calls = [0, 1, 2].map((i) =>
      runWithLlmSubject(SUBJECT, () =>
        client.completeJson("smoke", schema, [{ role: "user", content: `soru-${i}` }], {
          demo: () => ({ ok: false }),
        })
      )
    );
    void calls[0].then(() => (firstSettled = true));

    const third = await calls[2];
    expect(third).toMatchObject({
      llmMode: "fallback",
      reason: "concurrency",
      data: { ok: false },
    });
    expect(firstSettled).toBe(false);

    const [first, second] = await Promise.all([calls[0], calls[1]]);
    expect(first.llmMode).toBe("live");
    expect(second.llmMode).toBe("live");
    expect(f.stats.calls).toBe(2);
    expect(f.stats.bodies.some((b) => b.includes("soru-2"))).toBe(false);
    expect(await rejectedCount("smoke", "queue_full")).toBe(before + 1);
    // Reddedilen çağrının rezervasyonu iade edildi: yalnız iki canlı yanıtın gerçek kullanımı.
    expect(Number(await redis.get(budgetKey(SUBJECT)))).toBe(20);

    const limiter = getLlmLimiter(settings);
    expect(limiter.activeCount).toBe(0);
    expect(limiter.pendingCount).toBe(0);
  });

  it("kuyrukta LLM_QUEUE_TIMEOUT_MS'i aşan çağrı fallback döner; yuva sızmaz", async () => {
    const f = slowFetch(150);
    const settings = parseLlmSettings({
      LLM_API_KEY: "k",
      LLM_MAX_RETRIES: "0",
      LLM_MAX_CONCURRENCY: "1",
      LLM_MAX_QUEUE: "4",
      LLM_QUEUE_TIMEOUT_MS: "30",
    });
    const client = createLlmClient({
      settings,
      fetch: f.fetch,
      budget: createRedisBudget(redis as never, LIMIT),
    });
    const before = await rejectedCount("smoke", "queue_timeout");
    const call = () =>
      runWithLlmSubject(SUBJECT, () =>
        client.completeJson("smoke", schema, [], { demo: () => ({ ok: false }) })
      );

    const [first, second] = await Promise.all([call(), call()]);
    expect(first.llmMode).toBe("live");
    expect(second).toMatchObject({ llmMode: "fallback", reason: "concurrency" });
    expect(f.stats.calls).toBe(1);
    expect(await rejectedCount("smoke", "queue_timeout")).toBe(before + 1);
    expect(Number(await redis.get(budgetKey(SUBJECT)))).toBe(10);

    const limiter = getLlmLimiter(settings);
    expect(limiter.activeCount).toBe(0);
    expect(limiter.pendingCount).toBe(0);

    // Yuva geri döndü: sonraki çağrı canlı gider.
    expect((await call()).llmMode).toBe("live");
    expect(f.stats.calls).toBe(2);
  });

  it("embedding: dolu kuyruk SDK'ya gitmeden reddedilir, sayılır ve rezervasyon iade edilir", async () => {
    const settings = parseLlmSettings({ LLM_API_KEY: "k", LLM_MAX_RETRIES: "0" });
    const limiter = createLimiter(1, { maxQueue: 0 });
    let release!: () => void;
    const busy = limiter(() => new Promise<void>((r) => (release = r)));
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    const embed = createRemoteEmbedFn("text-embedding-3-small", {
      settings,
      fetch: fetchSpy as unknown as typeof fetch,
      budget: createRedisBudget(redis as never, LIMIT),
      limiter,
    })!;
    const before = await rejectedCount("embedding", "queue_full");

    const err = await runWithLlmSubject(SUBJECT, () => embed(["merhaba"], 8)).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(LimiterRejectedError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await rejectedCount("embedding", "queue_full")).toBe(before + 1);
    expect(Number((await redis.get(budgetKey(SUBJECT))) ?? 0)).toBe(0);

    release();
    await busy;
    expect(limiter.activeCount).toBe(0);
  });
});
