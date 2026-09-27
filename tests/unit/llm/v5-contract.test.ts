import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  LLM_IMPORT_ONLY_ROUTES,
  llmCallingRoutes,
  routeFileOf,
} from "../../helpers/llm-route-graph";

/**
 * §3 LLM sözleşmesi — v5 doğrulaması: (a) AI çıktısı dönen her route yanıtında
 * `ai_generated: true` (AI Act Md. 50), (b) mandate özel anahtarı log'a girmez,
 * (c) başlangıç logu ve `llm:smoke` öznesi. Ağa ve DB'ye çıkılmaz (servisler sahte).
 */

vi.mock("@/lib/auth", () => {
  const claims = { userId: "u1", role: "ADMIN", tokenId: "t1" };
  return {
    getAuth: vi.fn(async () => claims),
    requireAuth: vi.fn(async () => claims),
    requireRole: vi.fn(async () => claims),
  };
});
vi.mock("@/lib/http/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http/ai")>()),
  withAiSubject: <T>(_req: unknown, fn: () => Promise<T>) => fn(),
}));
vi.mock("@/lib/admin/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/reviews/moderation-queue", () => ({
  listModerationQueue: vi.fn(async () => [
    { id: "r1", comment: "x", explanation: "AI açıklaması", llmMode: "demo" },
  ]),
  decideModeration: vi.fn(async () => ({ id: "r1" })),
}));
vi.mock("@/lib/messaging/message-service", () => ({
  draftHostReply: vi.fn(async () => ({ draft: "Merhaba", llmMode: "demo" })),
}));
vi.mock("@/lib/pricing/revenue", () => ({
  generateSchema: z.object({ roomId: z.string() }),
  generateSuggestions: vi.fn(async () => [{ id: "s1", explanation: "AI" }]),
}));

function req(url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("regression: v5§3 API yanıtlarında ai_generated", () => {
  it("LLM çağıran her route kaynağında markAiGenerated kullanır (statik)", () => {
    const missing = llmCallingRoutes()
      .filter((r) => !(r in LLM_IMPORT_ONLY_ROUTES))
      .filter((r) => !readFileSync(routeFileOf(r), "utf8").includes("markAiGenerated("));
    expect(missing).toEqual([]);
  }, 30_000);

  it("GET /api/admin/reviews: her kuyruk öğesi ai_generated: true (dizi biçimi korunur)", async () => {
    const { GET } = await import("@/app/api/admin/reviews/route");
    const body = (await (await GET(req("/api/admin/reviews"))).json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([expect.objectContaining({ id: "r1", ai_generated: true })]);
  });

  it("POST /api/bookings/[id]/messages/draft → ai_generated: true", async () => {
    const { POST } = await import("@/app/api/bookings/[id]/messages/draft/route");
    const res = await POST(req("/api/bookings/b1/messages/draft", {}), {
      params: Promise.resolve({ id: "b1" }),
    });
    expect(await res.json()).toMatchObject({ draft: "Merhaba", ai_generated: true });
  });

  it("POST /api/host/revenue/suggestions → ai_generated: true", async () => {
    const { POST } = await import("@/app/api/host/revenue/suggestions/route");
    const res = await POST(req("/api/host/revenue/suggestions", { roomId: "room1" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      suggestions: [{ id: "s1" }],
      ai_generated: true,
    });
  });
});

describe("§3 v5 log redaksiyonu ve başlangıç", () => {
  it("pino redact: AGENT_MANDATE_PRIVATE_KEY / privateKey log'a girmez", async () => {
    const pino = (await import("pino")).default;
    const { LOGGER_OPTIONS } = await import("@/lib/observability/logger");
    const lines: string[] = [];
    const log = pino(
      { ...LOGGER_OPTIONS, level: "info", mixin: undefined },
      { write: (s: string) => lines.push(s) }
    );
    log.info(
      {
        AGENT_MANDATE_PRIVATE_KEY: "pem-gizli-1",
        env: { AGENT_MANDATE_PRIVATE_KEY: "pem-gizli-2" },
        privateKey: "pem-gizli-3",
        mandate: { privateKey: "pem-gizli-4" },
      },
      "x"
    );
    const out = lines.join("");
    for (const secret of ["pem-gizli-1", "pem-gizli-2", "pem-gizli-3", "pem-gizli-4"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("başlangıç logu describeLlmMode satırıdır (CANLI/DEMO)", async () => {
    const { logger } = await import("@/lib/observability/logger");
    const spy = vi.spyOn(logger, "info").mockImplementation(() => undefined as never);
    const { logLlmStartup } = await import("@/lib/llm/startup");
    logLlmStartup("test");
    const messages = spy.mock.calls.map((c) => String(c[1]));
    expect(messages.some((m) => /^LLM: (CANLI \(.+ @ .+\)|DEMO modu)$/.test(m))).toBe(true);
    spy.mockRestore();
  });

  it("llm:smoke tüm çağrılarını sys:smoke öznesiyle yapar", async () => {
    const { systemLlmSubject } = await import("@/lib/llm/budget");
    expect(systemLlmSubject("smoke")).toBe("sys:smoke");
    const src = readFileSync(path.resolve(__dirname, "../../../scripts/llm-smoke.ts"), "utf8");
    expect(src).toContain('systemLlmSubject("smoke")');
    const calls = src.match(/client\.complete(Json|Text)\(/g) ?? [];
    const withSubject = src.match(/\{ demo: [^}]*subject \}/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(withSubject.length).toBe(calls.length);
  });
});
