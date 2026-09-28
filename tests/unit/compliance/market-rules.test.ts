import { describe, expect, it } from "vitest";
import {
  isRegistrationFormatValid,
  loadMarketRules,
  marketRulesFor,
  maxDiscountReferenceDays,
} from "@/lib/compliance/market-rules";
import { referencePrice } from "@/lib/pricing/omnibus";

const NONE = { MARKET_RULES_JSON: "" };

describe("P1-7 pazar kural motoru — TR/AB/ABD tablo testleri", () => {
  it.each([
    // [ülke, pazar, referans penceresi, kayıt zorunlu, şema, toplam fiyat]
    ["Türkiye", "TR", 10, true, "tr-7464", "required"],
    ["TR", "TR", 10, true, "tr-7464", "required"],
    ["turkey", "TR", 10, true, "tr-7464", "required"],
    ["Germany", "EU", 30, true, "eu-2024-1028", "required"],
    ["FR", "EU", 30, true, "eu-2024-1028", "required"],
    ["İspanya", "EU", 30, true, "eu-2024-1028", "required"],
    ["United States", "US", 30, false, "platform", "required"],
    ["ABD", "US", 30, false, "platform", "required"],
    ["Japan", "DEFAULT", 30, false, "platform", "recommended"],
  ] as const)("%s → %s", (country, market, days, required, scheme, total) => {
    const r = marketRulesFor(country, NONE);
    expect(r.market).toBe(market);
    expect(r.discountReferenceDays).toBe(days);
    expect(r.previousPriceRule).toBe("lowest-in-window");
    expect(r.registration.required).toBe(required);
    expect(r.registration.scheme).toBe(scheme);
    expect(r.totalPriceDisplay).toBe(total);
  });

  it.each([
    ["Türkiye", "34-12345", true],
    ["Türkiye", "FR-75056ABC123", false],
    ["Germany", "DE-ABC123456", true],
    ["Germany", "34-12345", false],
    // Pazar biçimi tanımsız → platformun genel biçimi (TR ya da AB).
    ["United States", "34-12345", true],
    ["United States", "FR-75056ABC123", true],
    ["United States", "abc", false],
  ] as const)("kayıt no biçimi: %s %s → %s", (country, value, ok) => {
    expect(isRegistrationFormatValid(country, value)).toBe(ok);
  });

  it("MARKET_RULES_JSON dosyayı tamamen değiştirir; geçersizse varsayılan kalır", () => {
    const custom = {
      default: {
        discountReferenceDays: 14,
        previousPriceRule: "previous-price",
        registration: { required: false, scheme: "platform" },
        totalPriceDisplay: "recommended",
      },
      markets: [],
    };
    const env = { MARKET_RULES_JSON: JSON.stringify(custom) };
    expect(marketRulesFor("Türkiye", env).discountReferenceDays).toBe(14);
    expect(marketRulesFor("Türkiye", env).previousPriceRule).toBe("previous-price");
    expect(maxDiscountReferenceDays(env)).toBe(14);
    const bad = { MARKET_RULES_JSON: '{"default":{"discountReferenceDays":0}}' };
    expect(marketRulesFor("Türkiye", bad).discountReferenceDays).toBe(10);
    expect(loadMarketRules(NONE).markets.map((m) => m.id)).toEqual(["TR", "EU", "US"]);
  });

  it("fiyat geçmişi saklama alt sınırı en uzun penceredir", () => {
    expect(maxDiscountReferenceDays(NONE)).toBe(30);
  });
});

describe("referencePrice — önceki fiyat kuralları", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const history = [
    { effectiveAt: ago(15), priceMinor: 50_000 },
    { effectiveAt: ago(12), priceMinor: 120_000 },
    { effectiveAt: ago(1), priceMinor: 100_000 },
  ];

  it("TR penceresi (10 gün): 15 gün önceki fiyat referans değildir", () => {
    expect(referencePrice(history, 100_000, now, 10, "lowest-in-window")).toBe(100_000);
  });

  it("AB penceresi (30 gün): 15 gün önceki düşük fiyat referanstır", () => {
    expect(referencePrice(history, 100_000, now, 30, "lowest-in-window")).toBe(50_000);
  });

  it("previous-price: indirimden hemen önce yürürlükteki fiyat", () => {
    expect(referencePrice(history, 100_000, now, 30, "previous-price")).toBe(120_000);
    expect(referencePrice([], 100_000, now, 30, "previous-price")).toBe(100_000);
  });
});
