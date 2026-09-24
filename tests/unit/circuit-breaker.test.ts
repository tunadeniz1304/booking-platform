// Breaker soğuma (cooldown) dönüşü gerçek saate bağlıdır (Date.now tabanlı):
// HALF_OPEN→CLOSED geçişini gözlemlemek için kısa gerçek bekleme kullanıyoruz,
// deterministik saat kontrolü bu sınıfta desteklenmez.
import { describe, it, expect } from "vitest";
import { CircuitBreaker, BreakerOpenError } from "@/lib/resilience/circuit-breaker";

describe("Circuit Breaker", () => {
  it("arızalar pencere içinde eşiği aşınca OPEN olur ve fallback döner", async () => {
    const cb = new CircuitBreaker("t1", {
      failureThreshold: 3,
      windowMs: 5000,
      cooldownMs: 1000,
      halfOpenThreshold: 1,
    });
    const failing = async (): Promise<never> => {
      throw new Error("downstream down");
    };
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(failing)).rejects.toThrow("downstream down");
    }
    expect(cb.getState()).toBe("OPEN");

    // OPEN iken fn çalışmaz; fallback döner
    const value = await cb.call(failing, async () => "fallback-value");
    expect(value).toBe("fallback-value");

    // OPEN iken fallback'siz çağrı BreakerOpenError fırlatır
    await expect(cb.call(failing)).rejects.toBeInstanceOf(BreakerOpenError);
  });

  it("soğuma sonrası HALF_OPEN'da başarı devreyi CLOSED'a döndürür", async () => {
    const cb = new CircuitBreaker("t2", {
      failureThreshold: 2,
      windowMs: 5000,
      cooldownMs: 300,
      halfOpenThreshold: 1,
    });
    const failing = async (): Promise<never> => {
      throw new Error("fail");
    };
    for (let i = 0; i < 2; i++) {
      await cb.call(failing).catch(() => {});
    }
    expect(cb.getState()).toBe("OPEN");

    // Soğuma geçene dek bekle → HALF_OPEN
    await new Promise((r) => setTimeout(r, 400));
    const ok = await cb.call(async () => "recovered");
    expect(ok).toBe("recovered");
    expect(cb.getState()).toBe("CLOSED");
  });

  it("ara sıra tek arıza pencere içinde eşiğe ulaşmazsa CLOSED kalır", async () => {
    const cb = new CircuitBreaker("t3", { failureThreshold: 5, windowMs: 5000, cooldownMs: 1000 });
    await cb.call(async () => "ok").catch(() => {});
    await cb
      .call(async () => {
        throw new Error("boom");
      })
      .catch(() => {});
    await cb.call(async () => "ok");
    expect(cb.getState()).toBe("CLOSED");
    const stats = cb.getStats();
    expect(stats.success).toBe(2);
    expect(stats.failure).toBe(1);
    expect(stats.total).toBe(3);
  });
});
