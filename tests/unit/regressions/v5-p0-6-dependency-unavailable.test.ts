import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { toErrorResponse } from "@/lib/http/errors";
import { RedisUnavailableError } from "@/lib/redis";

/**
 * regression: v5 P0-6 (chaos) — Toxiproxy ile Postgres bağlantısı koparıldığında ve Redis
 * kesintisinin ilk anında route'lar 500 INTERNAL_ERROR döndü (k6 chaos-pg: 1 493 × 500;
 * chaos-redis: `isSessionRevoked` → ioredis MaxRetriesPerRequestError → 500). Bağımlılığın geçici
 * olarak erişilemez olması sunucu hatası değildir: 503 SERVICE_UNAVAILABLE + Retry-After.
 */
const CLIENT = "6.0.0";

function ioredisError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe("regression: v5 P0-6 — bağımlılık erişilemezken 503 (500 değil)", () => {
  const cases: Array<[string, unknown]> = [
    [
      "Prisma: veritabanına ulaşılamıyor (başlatma)",
      new Prisma.PrismaClientInitializationError(
        "Can't reach database server at `toxiproxy:5432`",
        CLIENT,
        "P1001"
      ),
    ],
    [
      "Prisma: P1001 sorgu sırasında",
      new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
        code: "P1001",
        clientVersion: CLIENT,
      }),
    ],
    [
      "Prisma: P1017 sunucu bağlantıyı kapattı",
      new Prisma.PrismaClientKnownRequestError("Server has closed the connection.", {
        code: "P1017",
        clientVersion: CLIENT,
      }),
    ],
    [
      "Prisma: P2024 havuzdan bağlantı alınamadı",
      new Prisma.PrismaClientKnownRequestError("Timed out fetching a new connection", {
        code: "P2024",
        clientVersion: CLIENT,
      }),
    ],
    [
      "Prisma: kodsuz 'Server has closed the connection'",
      new Prisma.PrismaClientUnknownRequestError("Server has closed the connection.", {
        clientVersion: CLIENT,
      }),
    ],
    ["Redis: bağlantı hazır değil", new RedisUnavailableError("reconnecting")],
    [
      "Redis: uçuştaki komut bağlantı kopunca",
      ioredisError(
        "MaxRetriesPerRequestError",
        "Reached the max retries per request limit (which is 2)."
      ),
    ],
  ];

  for (const [name, error] of cases) {
    it(`${name} → 503 SERVICE_UNAVAILABLE + Retry-After`, async () => {
      const res = toErrorResponse(error, "test");
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBeTruthy();
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe("SERVICE_UNAVAILABLE");
      expect(body.error).not.toMatch(/toxiproxy|Prisma|database server/i);
    });
  }

  it("ilgisiz hata hâlâ 500 INTERNAL_ERROR", () => {
    expect(toErrorResponse(new Error("beklenmeyen"), "test").status).toBe(500);
    expect(
      toErrorResponse(
        new Prisma.PrismaClientKnownRequestError("unique", {
          code: "P2002",
          clientVersion: CLIENT,
        }),
        "test"
      ).status
    ).toBe(500);
  });
});
