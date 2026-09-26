import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { lockOrder, roomLockKey, withOrderedLocks } from "@/lib/cart/locks";
import { cartItemPatchSchema, cartItemSchema } from "@/lib/cart/schemas";

/** Edinim/bırakma sırasını kaydeden sahte Redlock. */
function recordingLock() {
  const events: string[] = [];
  return {
    events,
    lock: {
      async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        events.push(`+${key}`);
        try {
          return await fn();
        } finally {
          events.push(`-${key}`);
        }
      },
    } as unknown as Parameters<typeof withOrderedLocks>[0],
  };
}

describe("P1-1 sepet kilit sırası (deadlock önleme)", () => {
  it("oda tiplerini tekilleştirir ve artan sırada döner", () => {
    expect(lockOrder(["rt_c", "rt_a", "rt_c", "rt_b"])).toEqual(["rt_a", "rt_b", "rt_c"]);
    expect(lockOrder([])).toEqual([]);
  });

  it("property: sıra girdinin permütasyonundan bağımsızdır (iki sepet aynı sırayla kilitler)", () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z0-9]{1,6}$/), { maxLength: 12 }), (ids) => {
        const shuffled = [...ids].reverse();
        const a = lockOrder(ids);
        expect(lockOrder(shuffled)).toEqual(a);
        expect(new Set(a).size).toBe(a.length);
        for (let i = 1; i < a.length; i++) expect(a[i - 1] < a[i]).toBe(true);
      })
    );
  });

  it("kilitleri sırayla iç içe alır, işi hepsi tutulurken çalıştırır, ters sırada bırakır", async () => {
    const { events, lock } = recordingLock();
    const result = await withOrderedLocks(lock, ["b", "a", "b"], async () => {
      events.push("run");
      return 42;
    });
    expect(result).toBe(42);
    expect(events).toEqual([
      `+${roomLockKey("a")}`,
      `+${roomLockKey("b")}`,
      "run",
      `-${roomLockKey("b")}`,
      `-${roomLockKey("a")}`,
    ]);
  });

  it("iş hata verirse tüm kilitler yine bırakılır ve hata yayılır", async () => {
    const { events, lock } = recordingLock();
    await expect(
      withOrderedLocks(lock, ["x", "y"], async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(events.filter((e) => e.startsWith("-"))).toHaveLength(2);
  });

  it("tekil rezervasyonla aynı kilit anahtarını kullanır", () => {
    expect(roomLockKey("rt1")).toBe("booking:lock:room:rt1");
  });
});

describe("P1-1 sepet giriş şemaları", () => {
  const base = {
    propertyId: "p1",
    roomTypeId: "r1",
    checkIn: "2026-10-01",
    checkOut: "2026-10-03",
    adults: 2,
  };

  it("varsayılanlar: çocuk 0, oda adedi 1; para birimi büyük harfe", () => {
    expect(cartItemSchema.parse({ ...base, currency: "eur" })).toMatchObject({
      children: 0,
      quantity: 1,
      currency: "EUR",
    });
  });

  it("geçersiz doluluk ve adet reddedilir", () => {
    expect(cartItemSchema.safeParse({ ...base, adults: 0 }).success).toBe(false);
    expect(cartItemSchema.safeParse({ ...base, quantity: 11 }).success).toBe(false);
    expect(cartItemSchema.safeParse({ ...base, checkIn: "01-10-2026" }).success).toBe(false);
  });

  it("boş güncelleme reddedilir", () => {
    expect(cartItemPatchSchema.safeParse({}).success).toBe(false);
    expect(cartItemPatchSchema.safeParse({ quantity: 2 }).success).toBe(true);
  });
});
