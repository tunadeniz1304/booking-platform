import { describe, it, expect } from "vitest";
import { negotiate, computeFloorRatio, NegotiationInput } from "@/lib/negotiation/engine";

function base(overrides: Partial<NegotiationInput>): NegotiationInput {
  return {
    basePrice: 100,
    dynamicPrice: 140,
    demandSignal: 0.5,
    requestedPrice: 120,
    round: 0,
    maxRounds: 3,
    isFlexibleDates: false,
    leadDays: 10,
    ...overrides,
  };
}

describe("çok-etmenli pazarlık rule-engine", () => {
  it("tavanın üstünde teklif anında kabul edilir", () => {
    const r = negotiate(base({ requestedPrice: 150 }));
    expect(r.decision).toBe("accept");
    expect(r.counterPrice).toBeNull();
    expect(r.rulesFired).toContain("rule.ask_above_or_at_dynamic");
  });

  it("taban altı teklif esnekliksiz reddedilir", () => {
    const r = negotiate(base({ requestedPrice: 80, isFlexibleDates: false }));
    expect(r.decision).toBe("reject");
    expect(r.rulesFired).toContain("rule.below_floor_no_flex");
  });

  it("taban altı + esnek tarih karşı-teklife düşer ve tabanın üstünde kalır", () => {
    const floorRatio = computeFloorRatio({
      demandSignal: 0.3,
      isFlexibleDates: true,
      leadDays: 60,
    });
    const floor = 140 * floorRatio;
    const r = negotiate(
      base({ requestedPrice: 80, isFlexibleDates: true, leadDays: 60, demandSignal: 0.3 })
    );
    expect(r.decision).toBe("counter");
    expect(r.counterPrice).not.toBeNull();
    if (r.counterPrice !== null) {
      expect(r.counterPrice).toBeGreaterThanOrEqual(floor);
      expect(r.counterPrice).toBeLessThanOrEqual(140);
    }
    expect(r.rulesFired).toContain("rule.below_floor_but_flexible");
  });

  it("ara teklif için tavan-taban arasında karşı-teklif üretir", () => {
    const r = negotiate(base({ requestedPrice: 134, round: 1 }));
    expect(r.decision).toBe("counter");
    expect(r.counterPrice).not.toBeNull();
    if (r.counterPrice !== null) {
      expect(r.counterPrice).toBeGreaterThan(134);
      expect(r.counterPrice).toBeLessThanOrEqual(140);
    }
  });

  it("yüksek talep taban oranını yükseltir (daha az indirim)", () => {
    const low = computeFloorRatio({ demandSignal: 0.2, isFlexibleDates: false, leadDays: 5 });
    const high = computeFloorRatio({ demandSignal: 0.9, isFlexibleDates: false, leadDays: 5 });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(0.92);
    expect(low).toBeGreaterThanOrEqual(0.68);
  });
});
