import { describe, expect, it } from "vitest";
import { LockError, Redlock } from "@/lib/distributed-lock/redlock";
import { FakeRedis } from "../../helpers/fake-redis";

/** İlk `failAfterApply` SET çağrısı sunucuda uygulanır ama istemciye hata döner. */
class TimeoutAfterApplyRedis extends FakeRedis {
  constructor(private failAfterApply = 1) {
    super();
  }
  override async set(key: string, value: string, opts?: { ex?: number; nx?: boolean }) {
    const result = await super.set(key, value, opts);
    if (this.failAfterApply > 0) {
      this.failAfterApply -= 1;
      throw new Error("Command timed out");
    }
    return result;
  }
}

describe("Redlock.acquire — belirsiz SET sonrası sahiplik", () => {
  it("SET sunucuda uygulanıp istemcide zaman aşımına düşerse sonraki denemede kilidi edinir", async () => {
    const redis = new TimeoutAfterApplyRedis();
    const lock = new Redlock(redis, { ttlMs: 15_000, retryCount: 3, retryDelayMs: 1 });

    const handle = await lock.acquire("lock:room:1");

    expect(redis.store.get("lock:room:1")).toBe(handle.token);
    expect(handle.fencingToken).toBe(1);
    expect(redis.calls.filter((c) => c === "get")).toHaveLength(1);
  });

  it("başka sahibin kilidini GET ile sahiplenmez (belirsiz SET olsa bile)", async () => {
    const redis = new FakeRedis();
    await redis.set("lock:room:2", "other-owner");
    let firstCall = true;
    const origSet = redis.set.bind(redis);
    redis.set = async (key, value, opts) => {
      if (firstCall) {
        firstCall = false;
        throw new Error("Command timed out");
      }
      return origSet(key, value, opts);
    };
    const lock = new Redlock(redis, { ttlMs: 15_000, retryCount: 2, retryDelayMs: 1 });

    await expect(lock.acquire("lock:room:2")).rejects.toBeInstanceOf(LockError);
    expect(redis.store.get("lock:room:2")).toBe("other-owner");
  });

  it("hata olmadan NX reddinde GET yapılmaz (sıcak yol ek komut içermez)", async () => {
    const redis = new FakeRedis();
    await redis.set("lock:room:3", "other-owner");
    const lock = new Redlock(redis, { ttlMs: 15_000, retryCount: 2, retryDelayMs: 1 });

    await expect(lock.acquire("lock:room:3")).rejects.toBeInstanceOf(LockError);
    expect(redis.calls).not.toContain("get");
  });

  it("waitMs: deneme sayısı yerine toplam bekleme bütçesi uygulanır", async () => {
    const redis = new FakeRedis();
    await redis.set("lock:room:4", "other-owner");
    const lock = new Redlock(redis, { ttlMs: 15_000, retryCount: 1, retryDelayMs: 5 });

    const t0 = Date.now();
    await expect(lock.acquire("lock:room:4", undefined, { waitMs: 120 })).rejects.toBeInstanceOf(
      LockError
    );
    const elapsed = Date.now() - t0;
    // retryCount=1 (≈2 deneme) yerine bütçe boyunca denenir; bütçe aşılmaz.
    expect(redis.calls.filter((c) => c === "set").length).toBeGreaterThan(3);
    expect(elapsed).toBeLessThan(1_000);
  });
});
