import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, fetchCurrentUser, logout } from "@/lib/api-client";

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `refreshing` sözü `setTimeout(0)` ile sıfırlanır; testler arasında bir tur beklenir. */
const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 0));

function calledPaths(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

describe("api-client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(flushTimers);
  afterAll(() => {
    vi.stubGlobal("fetch", originalFetch);
  });

  it("apiFetch: başarılı yanıtın JSON gövdesini döner, same-origin + JSON başlığı gönderir", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: 1 }));
    const out = await apiFetch<{ ok: number }>("/api/bookings", {
      method: "POST",
      body: "{}",
      headers: { "Idempotency-Key": "abc" },
    });
    expect(out).toEqual({ ok: 1 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe("same-origin");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json", "Idempotency-Key": "abc" });
  });

  it("apiFetch: hata gövdesindeki mesaj, kod ve ayrıntılar ApiError'a taşınır", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "Fiyat değişti", code: "PRICE_CHANGED", details: { a: 1 } })
    );
    const err = await apiFetch("/api/bookings").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 409,
      message: "Fiyat değişti",
      code: "PRICE_CHANGED",
      details: { a: 1 },
      name: "ApiError",
    });
  });

  it("apiFetch: JSON olmayan hata yanıtında varsayılan mesaj", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }));
    await expect(apiFetch("/api/search")).rejects.toMatchObject({
      status: 502,
      message: "İstek başarısız (502)",
      code: undefined,
    });
  });

  it("apiFetch: 401 → bir kez refresh, başarılıysa istek tekrarlanır", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: "Oturum" }))
      .mockResolvedValueOnce(jsonResponse(200, { user: {} }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [1] }));
    await expect(apiFetch("/api/favorites")).resolves.toEqual({ items: [1] });
    expect(calledPaths()).toEqual(["/api/favorites", "/api/auth/refresh", "/api/favorites"]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
  });

  it("apiFetch: refresh başarısızsa ilk 401 hatası döner (tekrar denenmez)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: "Oturum gerekli", code: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(apiFetch("/api/favorites")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    expect(calledPaths()).toEqual(["/api/favorites", "/api/auth/refresh"]);
  });

  it("apiFetch: refresh ağ hatası false sayılır", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockRejectedValueOnce(new Error("ağ yok"));
    await expect(apiFetch("/api/account")).rejects.toMatchObject({ status: 401 });
  });

  it("apiFetch: /api/auth/* uçlarında 401 için refresh denenmez", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "Hatalı parola" }));
    await expect(apiFetch("/api/auth/login", { method: "POST" })).rejects.toMatchObject({
      status: 401,
      message: "Hatalı parola",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("apiFetch: eşzamanlı 401'ler tek refresh isteğini paylaşır", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/auth/refresh") return jsonResponse(200, {});
      const retried = calledPaths().filter((p) => p === path).length > 1;
      return retried ? jsonResponse(200, { path }) : jsonResponse(401, {});
    });
    const [a, b] = await Promise.all([apiFetch("/api/a"), apiFetch("/api/b")]);
    expect(a).toEqual({ path: "/api/a" });
    expect(b).toEqual({ path: "/api/b" });
    expect(calledPaths().filter((p) => p === "/api/auth/refresh")).toHaveLength(1);
  });

  it("fetchCurrentUser: oturum varsa kullanıcı, hata durumunda null", async () => {
    const user = { id: "u1", firstName: "A", lastName: "B", email: "a@b.c", role: "USER" };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, user));
    await expect(fetchCurrentUser()).resolves.toEqual(user);
    expect(calledPaths()).toEqual(["/api/user/me"]);

    await flushTimers();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(fetchCurrentUser()).resolves.toBeNull();
  });

  it("logout: POST gönderir; ağ hatasını yutar", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true }));
    await expect(logout()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(logout()).resolves.toBeUndefined();
  });
});
