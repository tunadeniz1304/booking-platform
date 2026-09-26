import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { z } from "zod";
import { createLlmClient, resetLlmRuntimeForTests } from "@/lib/llm/client";
import { parseLlmSettings } from "@/lib/llm/settings";
import { createRedisBudget, runWithLlmSubject, type LlmBudget } from "@/lib/llm/budget";
import { categorize } from "@/lib/security/rate-limit";
import { logger } from "@/lib/observability/logger";
import { FakeRedis } from "../../helpers/fake-redis";

/**
 * §3 LLM sözleşmesi — v3 eklemeleri (a) bütçe, (b) `ai` kategorisi, (c) redakte prompt
 * logu, (d) `aiGenerated`, (e) SDK import kısıtı. Ağa çıkılmaz (sahte fetch).
 */

function completion(content: string) {
  return {
    id: "c1",
    object: "chat.completion",
    created: 1,
    model: "deepseek-v4-flash",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
  };
}

function okFetch(bodies: unknown[] = []): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify(completion('{"city":"İzmir"}')), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const schema = z.object({ city: z.string() });
const demo = () => ({ city: "Demo" });
const live = (extra: Record<string, string> = {}) =>
  parseLlmSettings({ LLM_API_KEY: "k", LLM_MAX_RETRIES: "0", ...extra });

/** Bellek içi bütçe (Redis sayacı yerine). */
function memoryBudget(limit: number): LlmBudget & { used: Map<string, number> } {
  const used = new Map<string, number>();
  return {
    used,
    async exceeded(subject) {
      return (used.get(subject) ?? 0) >= limit;
    },
    async consume(subject, tokens) {
      used.set(subject, (used.get(subject) ?? 0) + tokens);
    },
  };
}

beforeEach(() => resetLlmRuntimeForTests());

describe("§3 v3-a kullanıcı başına günlük token bütçesi", () => {
  it("regression: v3#22 bütçe dolunca canlı çağrı yapılmaz → demo, fallback + reason budget", async () => {
    const bodies: unknown[] = [];
    const budget = memoryBudget(60);
    const client = createLlmClient({ settings: live(), fetch: okFetch(bodies), budget });
    const call = () =>
      runWithLlmSubject("u:alice", () =>
        client.completeJson("smart_filter", schema, [{ role: "user", content: "x" }], { demo })
      );
    expect((await call()).llmMode).toBe("live"); // 50 token
    expect((await call()).llmMode).toBe("live"); // 100 ≥ 60 sonrası dolu
    const third = await call();
    expect(third).toMatchObject({ llmMode: "fallback", reason: "budget", data: { city: "Demo" } });
    expect(bodies).toHaveLength(2);
    expect(budget.used.get("u:alice")).toBe(100);
    // Başka kullanıcının bütçesi etkilenmez.
    const bob = await runWithLlmSubject("u:bob", () =>
      client.completeJson("smart_filter", schema, [{ role: "user", content: "x" }], { demo })
    );
    expect(bob.llmMode).toBe("live");
  });

  it("Redis sayacı: gün anahtarı, limit 0 = sınırsız, Redis hatasında güvenli taraf (aşıldı)", async () => {
    const redis = new FakeRedis();
    const budget = createRedisBudget(redis as never, 100);
    const now = new Date("2026-09-25T10:00:00Z");
    expect(await budget.exceeded("u:x", now)).toBe(false);
    await redis.set("llm:budget:u:x:2026-09-25", "100");
    expect(await budget.exceeded("u:x", now)).toBe(true);
    expect(await budget.exceeded("u:x", new Date("2026-09-26T00:00:01Z"))).toBe(false);
    expect(await createRedisBudget(redis as never, 0).exceeded("u:x", now)).toBe(false);
    redis.failing = true;
    expect(await budget.exceeded("u:y", now)).toBe(true);
  });
});

describe("§3 v3-b tüm AI uçları `ai` rate-limit kategorisinde", () => {
  it("regression: v3#22 yorum özeti dahil", () => {
    expect(categorize("/api/properties/p1/reviews/summary")).toBe("ai");
    expect(categorize("/api/properties/p1/reviews")).toBe("search");
    expect(categorize("/api/search/smart")).toBe("ai");
    expect(categorize("/api/ai/trip-plan")).toBe("ai");
  });
});

describe("§3 v3-c LLM_LOG_PROMPTS yalnızca redakte prompt loglar", () => {
  it("açıkken debug log'da ham e-posta/telefon yok; kapalıyken hiç log yok", async () => {
    const spy = vi.spyOn(logger, "debug").mockImplementation(() => undefined as never);
    const text = "Ben Ayşe, ayse@example.com, +90 532 111 22 33";
    const on = createLlmClient({
      settings: live({ LLM_LOG_PROMPTS: "true", NODE_ENV: "test" }),
      fetch: okFetch(),
      budget: memoryBudget(0),
    });
    await on.completeJson("smart_filter", schema, [{ role: "user", content: text }], {
      demo,
      knownNames: ["Ayşe"],
    });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("llm prompt (redacted)");
    expect(logged).not.toContain("ayse@example.com");
    expect(logged).not.toContain("532 111 22 33");
    spy.mockClear();
    const off = createLlmClient({ settings: live(), fetch: okFetch(), budget: memoryBudget(0) });
    await off.completeJson("smart_filter", schema, [{ role: "user", content: text }], { demo });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("production'da LLM_LOG_PROMPTS=true etkisizdir", () => {
    expect(live({ LLM_LOG_PROMPTS: "true", NODE_ENV: "production" }).logPrompts).toBe(false);
  });
});

describe("§3 v3-d AI Act Md. 50 işareti", () => {
  it("canlı, demo ve fallback sonuçlarının hepsi aiGenerated: true", async () => {
    const liveRes = await createLlmClient({
      settings: live(),
      fetch: okFetch(),
      budget: memoryBudget(0),
    }).completeJson("smart_filter", schema, [{ role: "user", content: "x" }], { demo });
    const demoRes = await createLlmClient({
      settings: parseLlmSettings({ LLM_MODE: "demo" }),
    }).completeText("smoke", [{ role: "user", content: "x" }], { demo: () => "ok" });
    const failRes = await createLlmClient({
      settings: live(),
      fetch: (async () => new Response("{}", { status: 500 })) as typeof fetch,
      budget: memoryBudget(0),
    }).completeJson("smart_filter", schema, [{ role: "user", content: "x" }], { demo });
    for (const r of [liveRes, demoRes, failRes]) expect(r.aiGenerated).toBe(true);
    expect(failRes.llmMode).toBe("fallback");
  });
});

describe("§3 v3-e LLM SDK'sı yalnızca src/lib/llm içinde", () => {
  it("ESLint no-restricted-imports kuralı openai'yi src/lib/llm dışında yasaklar", () => {
    const config = readFileSync(path.resolve(__dirname, "../../../eslint.config.mjs"), "utf8");
    expect(config).toMatch(/no-restricted-imports/);
    expect(config).toMatch(/name: "openai"/);
    expect(config).toMatch(/ignores: \["src\/lib\/llm\/client\.ts"/);
  });
});

describe("§3 güvenlik maddeleri (doğrulama tablosu)", () => {
  it("/api/llm/status anahtar değerini asla içermez (yalnızca hasKey)", async () => {
    const { getLlmStatus } = await import("@/lib/llm/status");
    const { resetLlmSettingsForTests } = await import("@/lib/llm/settings");
    const saved = { key: process.env.LLM_API_KEY, mode: process.env.LLM_MODE };
    const k = ["sk", "cok", "gizli", "anahtar", "123456"].join("-");
    process.env.LLM_API_KEY = k;
    process.env.LLM_MODE = "auto";
    resetLlmSettingsForTests();
    const body = JSON.stringify(getLlmStatus());
    expect(body).not.toContain("sk-cok-gizli");
    expect(JSON.parse(body)).toMatchObject({ hasKey: true, effectiveMode: "live" });
    for (const [k, v] of [
      ["LLM_API_KEY", saved.key],
      ["LLM_MODE", saved.mode],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetLlmSettingsForTests();
  });

  it("pino redact: apiKey / authorization / token / parola log'a girmez", async () => {
    const pino = (await import("pino")).default;
    const { LOGGER_OPTIONS } = await import("@/lib/observability/logger");
    const lines: string[] = [];
    const log = pino(
      { ...LOGGER_OPTIONS, level: "info", mixin: undefined },
      {
        write: (s: string) => lines.push(s),
      }
    );
    log.info(
      {
        apiKey: "sk-live-1",
        password: "Parola1",
        headers: { authorization: "Bearer eyJ-gizli" },
        session: { token: "tok-gizli" },
      },
      "x"
    );
    const out = lines.join("");
    for (const secret of ["sk-live-1", "Parola1", "eyJ-gizli", "tok-gizli"]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("[REDACTED]");
  });

  it(".env arama: kök → üst dizin; mevcut ortam değişkenleri ezilmez (override: false)", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("fs");
    const os = await import("os");
    const { loadEnv } = await import("@/lib/config/load-env");
    const parent = mkdtempSync(path.join(os.tmpdir(), "envtest-"));
    const child = path.join(parent, "proj");
    mkdirSync(child);
    writeFileSync(path.join(child, ".env"), "V3_A=kok\nV3_B=kok\n");
    writeFileSync(path.join(parent, ".env"), "V3_B=ust\nV3_C=ust\n");
    process.env.V3_A = "mevcut";
    loadEnv({ cwd: child, force: true });
    expect(process.env.V3_A).toBe("mevcut");
    expect(process.env.V3_B).toBe("kok");
    expect(process.env.V3_C).toBe("ust");
    for (const k of ["V3_A", "V3_B", "V3_C"]) delete process.env[k];
  });
});
