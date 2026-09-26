import { describe, it, expect } from "vitest";
import { reconcileCheckoutStatus } from "@/lib/agentic/checkout";

/**
 * v4#10 — ajan checkout oturumu takılıyordu: `loadOwned` yalnızca `in_progress`'te
 * senkronluyordu; ödeme reddi sonrası `ready_for_payment` + süresi dolmuş hold TTL'e
 * kadar kilitli kalıyordu. Artık her okumada bağlı rezervasyonla uzlaştırılır.
 */
const now = new Date("2026-09-01T12:00:00.000Z");
const past = new Date(now.getTime() - 1_000);
const future = new Date(now.getTime() + 60_000);

describe("regression: v4#10 checkout oturumu ↔ rezervasyon uzlaştırması", () => {
  it.each([
    ["ready_for_payment", { status: "HELD", holdExpiresAt: past }, "canceled"],
    ["ready_for_payment", { status: "EXPIRED", holdExpiresAt: past }, "canceled"],
    ["ready_for_payment", { status: "CANCELLED", holdExpiresAt: null }, "canceled"],
    ["ready_for_payment", { status: "CONFIRMED", holdExpiresAt: null }, "completed"],
    ["in_progress", { status: "HELD", holdExpiresAt: past }, "canceled"],
    ["in_progress", { status: "COMPLETED", holdExpiresAt: null }, "completed"],
    ["ready_for_payment", { status: "HELD", holdExpiresAt: future }, null],
    ["in_progress", { status: "HELD", holdExpiresAt: future }, null],
    ["ready_for_payment", { status: "PENDING", holdExpiresAt: null }, null],
    ["completed", { status: "CANCELLED", holdExpiresAt: null }, null],
    ["canceled", { status: "CONFIRMED", holdExpiresAt: null }, null],
  ] as const)("%s + %o → %s", (status, booking, expected) => {
    expect(reconcileCheckoutStatus(status, booking, now)).toBe(expected);
  });

  it("bağlı rezervasyon silinmişse açık oturum iptal edilir", () => {
    expect(reconcileCheckoutStatus("ready_for_payment", null, now)).toBe("canceled");
  });
});
