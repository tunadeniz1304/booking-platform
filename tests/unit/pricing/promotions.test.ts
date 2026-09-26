import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  allocateDiscount,
  channelFromHeaders,
  evaluatePromotions,
  normalizeCouponCode,
  promotionAmount,
  type PromotionContext,
  type PromotionReason,
  type PromotionRule,
} from "@/lib/pricing/promotions";
import { priceStay } from "@/lib/pricing/quote";
import { TaxRuleSchema, type TaxRule } from "@/lib/pricing/tax";
import { addDays, parseIsoDate, type IsoDate } from "@/lib/time/nights";

const TODAY = parseIsoDate("2026-10-01");

function rule(id: string, over: Partial<PromotionRule> = {}): PromotionRule {
  return {
    id,
    name: `Promo ${id}`,
    type: "LONG_STAY",
    discountBps: 1000,
    discountMinor: null,
    currency: null,
    minDaysBefore: null,
    maxDaysBefore: null,
    minNights: 1,
    couponCode: null,
    usageLimit: null,
    usageCount: 0,
    startsAt: null,
    endsAt: null,
    priority: 0,
    stackable: false,
    stackGroup: null,
    active: true,
    ...over,
  };
}

function ctx(over: Partial<PromotionContext> = {}): PromotionContext {
  return {
    now: new Date("2026-10-01T10:00:00Z"),
    today: TODAY,
    checkIn: addDays(TODAY, 10),
    nights: 3,
    channel: "web",
    couponCode: null,
    currency: "TRY",
    subtotalMinor: 100_000,
    maxDiscountBps: 9000,
    ...over,
  };
}

interface Row {
  name: string;
  rules: PromotionRule[];
  ctx?: Partial<PromotionContext>;
  /** Uygulanan satırlar (id → tutar), sırayla. */
  applied: Array<[string, number]>;
  /** Beklenen gerekçeler (yalnız belirtilenler kontrol edilir). */
  reasons?: Record<string, PromotionReason>;
  coupon?: string | null;
}

const TABLE: Row[] = [
  {
    name: "öncelik kazanır (küçük indirim olsa da)",
    rules: [rule("a", { discountBps: 2000 }), rule("b", { discountBps: 500, priority: 5 })],
    applied: [["b", 5000]],
    reasons: { a: "NOT_STACKABLE", b: "APPLIED" },
  },
  {
    name: "eşit öncelikte büyük indirim kazanır",
    rules: [rule("a", { discountBps: 1000 }), rule("b", { discountBps: 1500 })],
    applied: [["b", 15000]],
    reasons: { a: "NOT_STACKABLE" },
  },
  {
    name: "eşit öncelik + eşit tutar → küçük id kazanır",
    rules: [
      rule("z", { discountBps: 1000 }),
      rule("m", { discountMinor: 10_000, currency: "TRY", discountBps: null }),
    ],
    applied: [["m", 10000]],
    reasons: { z: "NOT_STACKABLE" },
  },
  {
    name: "birleşebilir, farklı gruplar → ikisi de",
    rules: [
      rule("a", { discountBps: 1000, stackable: true, stackGroup: "g1" }),
      rule("b", { discountBps: 500, stackable: true, stackGroup: "g2" }),
    ],
    applied: [
      ["a", 10000],
      ["b", 5000],
    ],
  },
  {
    name: "birleşebilir, aynı grup → gruptan yalnız en iyisi",
    rules: [
      rule("a", { discountBps: 1000, stackable: true, stackGroup: "g" }),
      rule("b", { discountBps: 500, stackable: true, stackGroup: "g" }),
      rule("c", { discountBps: 300, stackable: true }),
    ],
    applied: [
      ["a", 10000],
      ["c", 3000],
    ],
    reasons: { b: "STACK_GROUP_TAKEN" },
  },
  {
    name: "lider birleşebilir, sonraki birleşemez → atlanır",
    rules: [
      rule("a", { discountBps: 2000, stackable: true }),
      rule("b", { discountBps: 1000, stackable: false }),
      rule("c", { discountBps: 500, stackable: true }),
    ],
    applied: [
      ["a", 20000],
      ["c", 5000],
    ],
    reasons: { b: "NOT_STACKABLE" },
  },
  {
    name: "lider birleşemez → birleşebilirler de atlanır",
    rules: [
      rule("a", { discountBps: 2000, stackable: false }),
      rule("b", { discountBps: 1000, stackable: true }),
    ],
    applied: [["a", 20000]],
    reasons: { b: "NOT_STACKABLE" },
  },
  {
    name: "tavan (%90): ikinci satır kırpılır, üçüncü DISCOUNT_CAP_REACHED",
    rules: [
      rule("a", { discountBps: 6000, stackable: true }),
      rule("b", { discountBps: 5000, stackable: true }),
      rule("c", { discountBps: 100, stackable: true }),
    ],
    applied: [
      ["a", 60000],
      ["b", 30000],
    ],
    reasons: { c: "DISCOUNT_CAP_REACHED" },
  },
  {
    name: "sabit indirim ara toplamı aşamaz (tavan %100) → fiyat 0, negatif değil",
    rules: [rule("a", { discountBps: null, discountMinor: 500_000, currency: "TRY" })],
    ctx: { maxDiscountBps: 10_000 },
    applied: [["a", 100000]],
  },
  {
    name: "sabit indirimde para birimi uyuşmazlığı",
    rules: [rule("a", { discountBps: null, discountMinor: 1000, currency: "EUR" })],
    applied: [],
    reasons: { a: "CURRENCY_MISMATCH" },
  },
  {
    name: "erken rezervasyon sınırı: tam 10 gün uygun, 11 gün değil",
    rules: [
      rule("eb10", { type: "EARLY_BIRD", minNights: null, minDaysBefore: 10, stackable: true }),
      rule("eb11", { type: "EARLY_BIRD", minNights: null, minDaysBefore: 11, stackable: true }),
    ],
    applied: [["eb10", 10000]],
    reasons: { eb11: "LEAD_TIME_TOO_SHORT" },
  },
  {
    name: "son dakika sınırı: ≤10 uygun, ≤9 değil",
    rules: [
      rule("lm10", { type: "LAST_MINUTE", minNights: null, maxDaysBefore: 10, stackable: true }),
      rule("lm9", { type: "LAST_MINUTE", minNights: null, maxDaysBefore: 9, stackable: true }),
    ],
    applied: [["lm10", 10000]],
    reasons: { lm9: "LEAD_TIME_TOO_LONG" },
  },
  {
    name: "uzun konaklama: 3 gece < 4",
    rules: [rule("ls", { minNights: 4 })],
    applied: [],
    reasons: { ls: "STAY_TOO_SHORT" },
  },
  {
    name: "mobil fiyat web kanalında uygulanmaz",
    rules: [rule("mob", { type: "MOBILE_RATE", minNights: null })],
    applied: [],
    reasons: { mob: "NOT_MOBILE" },
  },
  {
    name: "mobil fiyat mobil kanalda",
    rules: [rule("mob", { type: "MOBILE_RATE", minNights: null })],
    ctx: { channel: "mobile" },
    applied: [["mob", 10000]],
  },
  {
    name: "kupon: büyük/küçük harf duyarsız eşleşir",
    rules: [
      rule("cp", { type: "COUPON", minNights: null, couponCode: "YAZ25", discountBps: 2500 }),
    ],
    ctx: { couponCode: " yaz25 " },
    applied: [["cp", 25000]],
    coupon: "APPLIED",
  },
  {
    name: "kupon: yanlış kod → NOT_FOUND, promosyon COUPON_REQUIRED",
    rules: [rule("cp", { type: "COUPON", minNights: null, couponCode: "YAZ25" })],
    ctx: { couponCode: "KIS10" },
    applied: [],
    reasons: { cp: "COUPON_REQUIRED" },
    coupon: "NOT_FOUND",
  },
  {
    name: "kupon: limit dolmuş",
    rules: [
      rule("cp", {
        type: "COUPON",
        minNights: null,
        couponCode: "YAZ25",
        usageLimit: 2,
        usageCount: 2,
      }),
    ],
    ctx: { couponCode: "YAZ25" },
    applied: [],
    coupon: "USAGE_LIMIT_REACHED",
  },
  {
    name: "kupon başka promosyona kaybederse gerekçesi NOT_STACKABLE",
    rules: [
      rule("cp", { type: "COUPON", minNights: null, couponCode: "YAZ25", discountBps: 500 }),
      rule("big", { discountBps: 3000 }),
    ],
    ctx: { couponCode: "YAZ25" },
    applied: [["big", 30000]],
    coupon: "NOT_STACKABLE",
  },
  {
    name: "geçerlilik: başlamamış / bitmiş (bitiş anı hariç) / pasif",
    rules: [
      rule("future", { startsAt: new Date("2026-10-01T10:00:01Z") }),
      rule("ended", { endsAt: new Date("2026-10-01T10:00:00Z") }),
      rule("off", { active: false }),
      rule("ok", {
        discountBps: 100,
        startsAt: new Date("2026-10-01T10:00:00Z"),
        endsAt: new Date("2026-10-01T10:00:01Z"),
      }),
    ],
    applied: [["ok", 1000]],
    reasons: { future: "NOT_STARTED", ended: "EXPIRED", off: "INACTIVE" },
  },
  {
    name: "yuvarlama tek noktada half-up: %10 × 15 kuruş = 1,5 → 2",
    rules: [rule("r", { discountBps: 1000 })],
    ctx: { subtotalMinor: 15, maxDiscountBps: 10_000 },
    applied: [["r", 2]],
  },
];

describe("P1-8 çakışan promosyonlar — tablo testi (deterministik)", () => {
  for (const row of TABLE) {
    it(row.name, () => {
      const result = evaluatePromotions(row.rules, ctx(row.ctx));
      expect(result.lines.map((l) => [l.promotionId, l.amount])).toEqual(row.applied);
      expect(result.discountTotal).toBe(row.applied.reduce((s, [, a]) => s + a, 0));
      for (const [id, reason] of Object.entries(row.reasons ?? {})) {
        expect(result.decisions.find((d) => d.promotionId === id)?.reason, id).toBe(reason);
      }
      if (row.coupon !== undefined) expect(result.couponStatus).toBe(row.coupon);
      // Girdi sırası sonucu değiştirmez.
      const reversed = evaluatePromotions([...row.rules].reverse(), ctx(row.ctx));
      expect(reversed).toEqual(result);
    });
  }
});

const arbRule = fc.record({
  id: fc.string({ minLength: 1, maxLength: 4 }),
  priority: fc.integer({ min: -2, max: 2 }),
  pct: fc.boolean(),
  bps: fc.integer({ min: 1, max: 10_000 }),
  fixed: fc.integer({ min: 1, max: 200_000 }),
  stackable: fc.boolean(),
  group: fc.constantFrom(null, "a", "b"),
});

describe("P1-8 promosyon özellikleri (fast-check)", () => {
  it("sıra bağımsız, indirim ∈ [0, tavan], satırlar birleşme kurallarına uyar", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbRule, { selector: (r) => r.id, maxLength: 6 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 1000 }),
        (raw, subtotal, cap, seed) => {
          const rules = raw.map((r) =>
            rule(r.id, {
              priority: r.priority,
              discountBps: r.pct ? r.bps : null,
              discountMinor: r.pct ? null : r.fixed,
              currency: r.pct ? null : "TRY",
              stackable: r.stackable,
              stackGroup: r.group,
            })
          );
          const c = ctx({ subtotalMinor: subtotal, maxDiscountBps: cap });
          const res = evaluatePromotions(rules, c);
          const shuffled = [...rules].sort(
            (a, b) => ((a.id.charCodeAt(0) * seed) % 7) - ((b.id.charCodeAt(0) * seed) % 7)
          );
          expect(evaluatePromotions(shuffled, c)).toEqual(res);
          const capMinor = promotionAmount(
            { discountBps: cap, discountMinor: null },
            subtotal,
            "TRY"
          );
          expect(res.discountTotal).toBeGreaterThanOrEqual(0);
          expect(res.discountTotal).toBeLessThanOrEqual(Math.min(capMinor, subtotal));
          expect(res.lines.every((l) => l.amount > 0)).toBe(true);
          if (res.lines.length > 1) {
            const applied = res.lines.map((l) => rules.find((r) => r.id === l.promotionId)!);
            expect(applied.every((r) => r.stackable)).toBe(true);
            const groups = applied.map((r) => r.stackGroup).filter((g) => g !== null);
            expect(new Set(groups).size).toBe(groups.length);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it("allocateDiscount toplamı korur ve hiçbir geceyi negatife düşürmez", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 14 }),
        fc.integer({ min: 0, max: 10_000 }),
        (amounts, bps) => {
          const total = amounts.reduce((s, a) => s + a, 0);
          const discount = Math.floor((total * bps) / 10_000);
          const shares = allocateDiscount(amounts, discount, "TRY");
          expect(shares.reduce((s, a) => s + a, 0)).toBe(total > 0 ? discount : 0);
          shares.forEach((s, i) => expect(amounts[i] - s).toBeGreaterThanOrEqual(0));
        }
      )
    );
  });
});

const TAXES: TaxRule[] = [
  TaxRuleSchema.parse({
    code: "VAT",
    country: "*",
    kind: "VAT",
    label: "KDV",
    rateBps: 1000,
    inclusive: true,
  }),
  TaxRuleSchema.parse({
    code: "ACCOMMODATION_TAX",
    country: "*",
    kind: "ACCOMMODATION",
    label: "Konaklama vergisi",
    rateBps: 200,
  }),
  TaxRuleSchema.parse({
    code: "SERVICE_FEE",
    country: "*",
    kind: "SERVICE_FEE",
    label: "Hizmet bedeli",
    rateBps: 500,
  }),
];

describe("P1-8 teklif toplamı = satır kalemlerinin toplamı", () => {
  it("total = brüt geceler − promosyonlar + ücretler + hariç vergiler (fast-check)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 500_000 }), { minLength: 1, maxLength: 10 }),
        fc.uniqueArray(arbRule, { selector: (r) => r.id, maxLength: 4 }),
        fc.integer({ min: 1, max: 3 }),
        (bases, raw, units) => {
          const nights = bases.map((b, i) => ({
            date: addDays(TODAY, i + 5) as IsoDate,
            baseMinor: b,
          }));
          const rules = raw.map((r) =>
            rule(r.id, {
              priority: r.priority,
              discountBps: r.pct ? r.bps : null,
              discountMinor: r.pct ? null : r.fixed,
              currency: r.pct ? null : "TRY",
              stackable: r.stackable,
              stackGroup: r.group,
            })
          );
          const q = priceStay({
            nights,
            modifierMinor: 0,
            units,
            currency: "TRY",
            taxRules: TAXES,
            guests: 2,
            promotions: {
              rules,
              context: { ...ctx(), checkIn: nights[0].date, nights: nights.length },
            },
          });
          const discounts = (q.discounts ?? []).reduce((s, d) => s + d.amount, 0);
          expect(discounts).toBe(q.discountTotal);
          const nightsSum = q.nights.reduce((s, n) => s + n.amount, 0);
          expect(nightsSum).toBe(q.subtotal);
          const addOn =
            q.fees.filter((f) => !f.inclusive).reduce((s, f) => s + f.amount, 0) +
            q.taxes.filter((t) => !t.inclusive).reduce((s, t) => s + t.amount, 0);
          expect(q.total).toBe(q.subtotal - discounts + addOn);
          expect(q.total).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("promosyonsuz çağrı eski çıktıyı birebir korur; indirim vergi matrahını düşürür", () => {
    const nights = [0, 1, 2].map((i) => ({ date: addDays(TODAY, i + 5), baseMinor: 100_000 }));
    const plain = priceStay({ nights, modifierMinor: 0, currency: "TRY", taxRules: TAXES });
    expect(plain).not.toHaveProperty("discounts");
    const promo = priceStay({
      nights,
      modifierMinor: 0,
      currency: "TRY",
      taxRules: TAXES,
      promotions: {
        rules: [rule("half", { discountBps: 5000 })],
        context: { ...ctx(), checkIn: nights[0].date, nights: 3 },
      },
    });
    expect(promo.subtotal).toBe(plain.subtotal);
    expect(promo.discountTotal).toBe(150_000);
    expect(promo.discounts?.[0]).toMatchObject({ promotionId: "half", name: "Promo half" });
    const acc = (q: typeof plain) => q.taxes.find((t) => t.code === "ACCOMMODATION_TAX")!.amount;
    expect(acc(promo)).toBeLessThan(acc(plain));
    expect(promo.total).toBeLessThan(plain.total);
    expect(promo.coupon).toBeNull();
  });
});

describe("P1-8 yardımcılar", () => {
  it("kupon normalizasyonu ve kanal tespiti", () => {
    expect(normalizeCouponCode("  yaz25 ")).toBe("YAZ25");
    expect(normalizeCouponCode("   ")).toBeNull();
    expect(channelFromHeaders(new Headers({ "sec-ch-ua-mobile": "?1" }))).toBe("mobile");
    expect(channelFromHeaders(new Headers({ "sec-ch-ua-mobile": "?0" }))).toBe("web");
    expect(
      channelFromHeaders(new Headers({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" }))
    ).toBe("mobile");
    expect(channelFromHeaders(new Headers({ "user-agent": "Mozilla/5.0 (Windows NT 10.0)" }))).toBe(
      "web"
    );
  });
});
