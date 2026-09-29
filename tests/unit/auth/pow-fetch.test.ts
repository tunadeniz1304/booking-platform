import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/pow-solver", () => ({
  solvePow: vi.fn(async (c: { challenge: string }) => ({ challenge: c.challenge, nonce: "42" })),
}));

import { solvePow } from "@/lib/auth/pow-solver";
import { postJsonWithPow } from "@/lib/auth/pow-fetch";

/** İstemci PoW yardımcısı: 429 `POW_REQUIRED` → çöz + tek yeniden deneme. Ağa çıkmaz. */

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sentBody(call: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]![1]!;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(solvePow).mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postJsonWithPow", () => {
  it("429 olmayan yanıtı olduğu gibi döndürür ve JSON POST gönderir", async () => {
    const ok = jsonResponse(200, { ok: true });
    fetchMock.mockResolvedValueOnce(ok);

    const res = await postJsonWithPow("/api/auth/login", { email: "a@b.c" });

    expect(res).toBe(ok);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/login");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(sentBody(0)).toEqual({ email: "a@b.c" });
    expect(solvePow).not.toHaveBeenCalled();
  });

  it("POW_REQUIRED gelirse bulmacayı çözüp gövdeye pow ekleyerek bir kez yeniden dener", async () => {
    const challenge = { challenge: "id.exp.6.sig", bits: 6 };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(429, { code: "POW_REQUIRED", details: { pow: challenge } })
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const res = await postJsonWithPow("/api/auth/register", { email: "a@b.c" });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(solvePow).toHaveBeenCalledWith(challenge);
    expect(sentBody(1)).toEqual({
      email: "a@b.c",
      pow: { challenge: "id.exp.6.sig", nonce: "42" },
    });
  });

  it("yeniden deneme de 429 dönerse ikinci yanıtı döndürür (sonsuz döngü yok)", async () => {
    const challenge = { challenge: "c", bits: 6 };
    const body = { code: "POW_REQUIRED", details: { pow: challenge } };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, body))
      .mockResolvedValueOnce(jsonResponse(429, body));

    const res = await postJsonWithPow("/x", {});

    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("başka koddaki 429'u (ör. RATE_LIMITED) yeniden denemeden döndürür", async () => {
    const limited = jsonResponse(429, { code: "RATE_LIMITED" });
    fetchMock.mockResolvedValueOnce(limited);

    const res = await postJsonWithPow("/x", {});

    expect(res).toBe(limited);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(solvePow).not.toHaveBeenCalled();
    // Gövde klonlanarak okunduğu için çağıran hâlâ okuyabilir.
    await expect(res.json()).resolves.toEqual({ code: "RATE_LIMITED" });
  });

  it("POW_REQUIRED ama bulmaca yoksa yeniden denemez", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { code: "POW_REQUIRED", details: {} }));

    const res = await postJsonWithPow("/x", {});

    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(solvePow).not.toHaveBeenCalled();
  });

  it("JSON olmayan 429 gövdesinde hata fırlatmadan yanıtı döndürür", async () => {
    const plain = new Response("Too Many Requests", { status: 429 });
    fetchMock.mockResolvedValueOnce(plain);

    const res = await postJsonWithPow("/x", {});

    expect(res).toBe(plain);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(solvePow).not.toHaveBeenCalled();
  });
});
