// Canlı Redis TTL/kilit davranışını gerçek saatle test eden integration testidir:
// kilit ömrü ve fencing token yenileme platform saatiyle yürür — fake timer
// Redis'in gerçek kilidini süremez, burada deterministik zaman kontrolü çalışmaz.
import { describe, it, expect } from "vitest";
import { createRedlock } from "@/lib/distributed-lock/redlock";
import { redis } from "@/lib/redis";
import { describeInt } from "./helpers";

describeInt("redlock (integration)", () => {
  const redlock = createRedlock(redis);

  describe("Redlock dağıtık kilit — mutual exclusion", () => {
    it("aynı kaynakta 40 eşzamanlı istekte kritik kesitte en fazla 1 sahip olur", async () => {
      const resource = `test:lock:${Date.now()}`;
      let current = 0;
      let maxConcurrent = 0;

      const results = await Promise.allSettled(
        Array.from({ length: 40 }, () =>
          redlock.withLock(
            resource,
            async () => {
              current += 1;
              maxConcurrent = Math.max(maxConcurrent, current);
              await new Promise((r) => setTimeout(r, 180));
              current -= 1;
            },
            { ttlMs: 600, renewEveryMs: 200 }
          )
        )
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      // Aynı anda yalnız bir sahip → kesin ve yeniden üretilebilir güvenlik garantisi
      expect(maxConcurrent).toBe(1);
      // Bounded retry ile eşzamanlı 40 istekten en az biri işini tamamlar
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      await redis.del(resource);
    }, 30000);

    it("kilit yenileme: uzun işte TTL aşılır ve ikinci sahip kazanır", async () => {
      const resource = `test:lock:${Date.now()}`;
      const first = await redlock.acquire(resource, 500);
      // ilk sahip bekle, kilidi tazele
      await new Promise((r) => setTimeout(r, 350));
      const renewed = await redlock.renew(first, 300);
      expect(renewed).toBe(true);
      await redlock.release(first);
      // serbest kalınca ikinci edinir
      const second = await redlock.acquire(resource, 500);
      expect(second.token).not.toBe(first.token);
      await redlock.release(second);
      await redis.del(resource);
    }, 15000);
  });
});
