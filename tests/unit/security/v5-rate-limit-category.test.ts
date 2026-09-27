import { describe, it, expect } from "vitest";
import { categorize } from "@/lib/security/rate-limit";
import { llmCallingRoutes } from "../../helpers/llm-route-graph";

/**
 * regression: v5#12 — `/api/ucp/*` ajan kovasında; LLM çağıran her route `ai` kovasında.
 * Liste elle değil, `src/lib/llm` istemcisini çağıran modüllere statik import grafiğiyle
 * ulaşan route'lardan türetilir; yeni bir LLM route'u eklenip `ai`'ye alınmazsa test kırılır.
 */

/**
 * LLM modülünü import eden ama bu route'un isteğinde LLM ÇAĞIRMAYAN (ya da çağrısı
 * varsayılan kapalı bir bayrağa bağlı yan sinyal olan) route'lar — gerekçeli istisna.
 */
const NOT_AI: Readonly<Record<string, string>> = {
  "/api/bookings/[id]/messages":
    "Mesaj gönderimi; LLM risk sinyali MESSAGE_SCAN_LLM_ENABLED (varsayılan kapalı) ve bütçeye tabi, kova booking (fail-closed)",
  "/api/bookings/[id]/messages/stream": "Yalnız resolveThreadAccess (SSE); LLM çağrısı yok",
  "/api/host/revenue": "getRevenueOverview deterministik KPI; LLM açıklaması yalnız suggestions",
  "/api/host/revenue/suggestions/[id]/accept": "acceptSuggestion deterministik; LLM çağrısı yok",
  "/api/host/revenue/suggestions/[id]/reject": "rejectSuggestion deterministik; LLM çağrısı yok",
};

/** Statik grafik ~150 route dosyasını okur; yavaş CI diskinde varsayılan 5 sn dar kalabilir. */
const META_TIMEOUT_MS = 30_000;
const concrete = (route: string) => route.replace(/\[[^\]]+\]/g, "x1");

describe("regression: v5#12 rate-limit kategorileri", () => {
  it.each([
    ["/api/ucp/checkout-sessions", "agentic"],
    ["/api/ucp/checkout-sessions/cs1", "agentic"],
    ["/api/ucp/checkout-sessions/cs1/complete", "agentic"],
    ["/api/mcp", "agentic"],
    ["/api/agentic/checkout", "agentic"],
    ["/api/bookings/b1/messages/draft", "ai"],
    ["/api/host/revenue/suggestions", "ai"],
    ["/api/admin/reviews", "ai"],
    ["/api/admin/events", "ai"],
    ["/api/ai/trip-plan", "ai"],
    ["/api/search/smart", "ai"],
    ["/api/compare", "ai"],
    ["/api/properties/p1/reviews/summary", "ai"],
    ["/api/properties/p1/review-highlights", "ai"],
    // LLM çağırmayan kardeş uçlar kendi kovalarında kalır.
    ["/api/bookings/b1/messages", "booking"],
    ["/api/bookings/b1", "booking"],
    ["/api/host/revenue", "default"],
    ["/api/host/revenue/suggestions/s1/accept", "default"],
    ["/api/admin/events/e1/approve", "default"],
    ["/api/properties/p1/reviews", "search"],
  ])("%s → %s", (path, category) => {
    expect(categorize(path)).toBe(category);
  });

  it(
    "LLM çağıran her route `ai` kategorisinde (import grafiğinden türetilir)",
    () => {
      const routes = llmCallingRoutes();
      expect(routes.length).toBeGreaterThan(5);
      const wrong = routes
        .filter((r) => !(r in NOT_AI))
        .filter((r) => categorize(concrete(r)) !== "ai");
      expect(wrong).toEqual([]);
    },
    META_TIMEOUT_MS
  );

  it(
    "istisna listesi güncel: her istisna hâlâ LLM modülüne ulaşıyor",
    () => {
      const routes = new Set(llmCallingRoutes());
      expect(Object.keys(NOT_AI).filter((r) => !routes.has(r))).toEqual([]);
    },
    META_TIMEOUT_MS
  );
});
