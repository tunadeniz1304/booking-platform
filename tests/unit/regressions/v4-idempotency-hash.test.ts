import { describe, it, expect } from "vitest";
import { hashIdempotentRequest } from "@/lib/http/idempotency";

describe("regression: v4#9 idempotency istek özeti", () => {
  it("deterministik, sıraya duyarlı; undefined ≡ null", () => {
    const a = hashIdempotentRequest(["p1", "r1", "2026-10-01", "2026-10-03", 2, 1, undefined]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIdempotentRequest(["p1", "r1", "2026-10-01", "2026-10-03", 2, 1, null])).toBe(a);
    expect(hashIdempotentRequest(["r1", "p1", "2026-10-01", "2026-10-03", 2, 1, null])).not.toBe(a);
    expect(hashIdempotentRequest(["p1", "r1", "2026-10-01", "2026-10-03", 3, 1, null])).not.toBe(a);
  });

  it('alan sınırları karışmaz ("ab","c" ≠ "a","bc")', () => {
    expect(hashIdempotentRequest(["ab", "c"])).not.toBe(hashIdempotentRequest(["a", "bc"]));
  });
});
