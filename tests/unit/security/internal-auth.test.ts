import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});
vi.mock("@/lib/sentiment/trigger", () => ({
  ingestExternalSignal: vi.fn(async () => {
    throw new Error("Lokasyon bulunamadı: GIZLI-IC-DETAY");
  }),
}));

import {
  authorizeInternalRequest,
  getInternalSecret,
  safeCompare,
} from "@/lib/security/internal-auth";
import { signAccessToken } from "@/lib/auth/tokens";
import { POST as ingest } from "@/app/api/internal/events/ingest/route";

const STRONG = "s".repeat(40);
const ENV_NAME = "INTERNAL_API_SECRET";
const original = process.env[ENV_NAME];

/** İç sırrı ayarlar (undefined → siler). */
function setSecret(value: string | undefined): void {
  if (value === undefined) delete process.env[ENV_NAME];
  else process.env[ENV_NAME] = value;
}

function req(headers: Record<string, string> = {}, body?: unknown) {
  return new NextRequest("http://localhost:3000/api/internal/events/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function statusOf(promise: Promise<unknown>): Promise<number | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { status: number }).status;
  }
}

beforeEach(() => {
  setSecret(STRONG);
});
afterEach(() => {
  setSecret(original);
});

describe("regression: #2 iç uçlar varsayılan sırla korunuyor", () => {
  it("varsayılan/kısa/eksik sır kabul edilmez", () => {
    setSecret("change-me-internal-secret");
    expect(getInternalSecret()).toBeNull();
    setSecret("kisa");
    expect(getInternalSecret()).toBeNull();
    setSecret(undefined);
    expect(getInternalSecret()).toBeNull();
  });

  it("sır zayıfken sır başlığıyla gelen istek 503 (varsayılan değer ile bile)", async () => {
    setSecret("change-me-internal-secret");
    expect(
      await statusOf(
        authorizeInternalRequest(req({ "x-internal-secret": "change-me-internal-secret" }))
      )
    ).toBe(503);
  });

  it("yanlış sır 403, doğru sır kabul", async () => {
    expect(await statusOf(authorizeInternalRequest(req({ "x-internal-secret": "yanlis" })))).toBe(
      403
    );
    expect(await authorizeInternalRequest(req({ "x-internal-secret": STRONG }))).toBe("secret");
  });

  it("ADMIN JWT kabul, USER JWT 403, kimliksiz 401", async () => {
    const admin = await signAccessToken("a1", "ADMIN", 900);
    const user = await signAccessToken("u1", "USER", 900);
    expect(await authorizeInternalRequest(req({ authorization: `Bearer ${admin.token}` }))).toBe(
      "admin"
    );
    expect(
      await statusOf(authorizeInternalRequest(req({ authorization: `Bearer ${user.token}` })))
    ).toBe(403);
    expect(await statusOf(authorizeInternalRequest(req()))).toBe(401);
  });

  it("safeCompare farklı uzunlukta da güvenli", () => {
    expect(safeCompare("a", "a")).toBe(true);
    expect(safeCompare("a", "ab")).toBe(false);
  });

  it("ingest ucu ham error.message döndürmez", async () => {
    const res = await ingest(
      req(
        { "x-internal-secret": STRONG },
        {
          title: "Konser",
          city: "X",
          startsOn: "2026-10-01",
          endsOn: "2026-10-02",
          impact: 5,
          source: "test",
        }
      )
    );
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain("GIZLI-IC-DETAY");
  });
});
