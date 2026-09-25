import { describe, it, expect } from "vitest";
import path from "node:path";
import { convert, getFxTable } from "@/lib/money/fx";
import { formatMoney, money } from "@/lib/money/money";
import { resolveLocale } from "@/i18n/config";
import { NAMESPACES } from "@/i18n/messages";
import { checkMessagesDir } from "@/lib/i18n/check";

describe("P1-3 çoklu para birimi + i18n", () => {
  it("tr ve en mesaj dosyaları aynı anahtarlara sahip; varsayılan dil tr", () => {
    expect(checkMessagesDir(path.resolve("messages"), NAMESPACES)).toEqual([]);
    expect(resolveLocale(undefined)).toBe("tr");
    expect(resolveLocale("de")).toBe("tr");
    expect(resolveLocale("en")).toBe("en");
  });

  it("statik kurla TRY→USD dönüşümü (minor-unit, half-up); aynı birim değişmez", () => {
    const usd = convert(money(318150, "TRY"), "USD", {
      base: "TRY",
      asOf: "x",
      rates: { TRY: 1, USD: 0.0243 },
    });
    expect(usd).toEqual({ amount: 7731, currency: "USD" });
    expect(convert(money(100, "TRY"), "TRY")).toEqual(money(100, "TRY"));
  });

  it("FX_RATES_JSON statik tabloyu ezer", () => {
    expect(getFxTable({ FX_RATES_JSON: '{"USD":0.03}' }).rates.USD).toBe(0.03);
    expect(getFxTable({}).rates.TRY).toBe(1);
  });

  it("biçim snapshot'ları: tr-TR ve en-US", () => {
    expect(formatMoney(money(318150, "TRY"), "tr-TR")).toMatchInlineSnapshot(`"₺3.181,50"`);
    expect(formatMoney(money(7731, "USD"), "en-US")).toMatchInlineSnapshot(`"$77.31"`);
  });
});
