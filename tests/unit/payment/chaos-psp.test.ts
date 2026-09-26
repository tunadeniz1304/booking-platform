import { describe, expect, it } from "vitest";
import { MockPsp } from "@/lib/payment/mock-psp";
import { chaosEnabled, parseChaosOps, withChaos } from "@/lib/payment/chaos-psp";
import { PaymentProviderError } from "@/lib/payment/provider";
import { money } from "@/lib/money/money";

const off = { latencyMs: 0, jitterMs: 0, failureRate: 0, failureOps: parseChaosOps("") };
const amount = money(10_000, "TRY");
const token = "tok_mock_ok_424242_4242";

describe("P2-3 MockPsp kaos sarmalayıcısı", () => {
  it("varsayılan ayarlar sağlayıcıyı değiştirmez (aynı nesne)", () => {
    const psp = new MockPsp();
    expect(chaosEnabled(off)).toBe(false);
    expect(withChaos(psp, off)).toBe(psp);
  });

  it("her çağrıdan önce sabit + jitter gecikmesi uygular", async () => {
    const waits: number[] = [];
    const psp = withChaos(
      new MockPsp(),
      { ...off, latencyMs: 100, jitterMs: 50 },
      { random: () => 0.5, sleep: async (ms) => void waits.push(ms) }
    );
    const auth = await psp.authorize({ amount, cardToken: token, idempotencyKey: "k1" });
    expect(auth.status).toBe("authorized");
    await psp.capture(auth.providerRef, amount);
    await psp.refund(auth.providerRef, amount, "r1");
    await psp.void(auth.providerRef);
    await psp.confirmChallenge(`${auth.providerRef}_3ds`, "000000");
    expect(waits).toEqual([125, 125, 125, 125, 125]);
    expect(psp.name).toBe("mock");
    expect(await psp.describeToken?.(token)).toEqual({ bin: "424242" });
  });

  it("yalnız seçili işlemlerde oran kadar psp_unavailable fırlatır", async () => {
    const psp = withChaos(
      new MockPsp(),
      { ...off, failureRate: 0.5, failureOps: parseChaosOps(" capture , refund ") },
      { random: () => 0.1, sleep: async () => {} }
    );
    const auth = await psp.authorize({ amount, cardToken: token, idempotencyKey: "k2" });
    expect(auth.status).toBe("authorized");
    await expect(psp.capture(auth.providerRef, amount)).rejects.toBeInstanceOf(
      PaymentProviderError
    );
    await expect(psp.refund(auth.providerRef, amount, "r")).rejects.toMatchObject({
      code: "psp_unavailable",
    });
    await expect(psp.void(auth.providerRef)).resolves.toEqual({ status: "voided" });
  });

  it("oran eşiğin altında kalmazsa hata yok; ön provizyon da sarılır", async () => {
    const psp = withChaos(
      new MockPsp(),
      { ...off, failureRate: 0.2, failureOps: parseChaosOps("authorizeHold") },
      { random: () => 0.9, sleep: async () => {} }
    );
    const hold = await psp.authorizeHold?.({
      amount,
      sourceProviderRef: "pi_mock_x",
      idempotencyKey: "h",
    });
    expect(hold?.status).toBe("authorized");
  });
});
