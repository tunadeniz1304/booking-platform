import { describe, expect, it } from "vitest";
import config, {
  THEMED_FAMILIES,
  darkThemeVars,
  hexToChannels,
  palette,
} from "../../../tailwind.config";
import { THEMES, resolveTheme, themeAttribute } from "@/lib/ui/theme";

/**
 * P2-1a karanlık mod kontrast testi (WCAG 2.x 1.4.3 AA metin ≥ 4.5:1, 1.4.11 odak halkası
 * ≥ 3:1): tailwind.config.ts'nin ürettiği karanlık değişkenlerle, uygulamada kullanılan
 * metin/zemin çiftleri ölçülür. Açık tema değişmediği için yalnız karanlık eşleme test edilir.
 */

type Rgb = [number, number, number];
const vars = darkThemeVars();
const parse = (channels: string): Rgb => channels.split(" ").map(Number) as Rgb;

/** Karanlık temada `kind` (c|bg|tx) türündeki `family-shade` sınıfının etkin rengi. */
function dark(kind: "c" | "bg" | "tx", family: string, shade: string): Rgb {
  const own = vars[`--${kind}-${family}-${shade}`];
  return parse(own ?? hexToChannels(palette(family as never)[shade]));
}

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: Rgb, b: Rgb): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const SURFACES: Record<string, Rgb> = {
  "bg-white (kart)": parse(vars["--bg-white"]),
  gövde: parse(vars["--page-bg"]),
  "bg-gray-50": dark("bg", "gray", "50"),
  "bg-gray-100": dark("bg", "gray", "100"),
};

describe("P2-1a karanlık tema kontrastı (AA)", () => {
  it("gövde metni ve gri metin tonları (500–900) tüm yüzeylerde ≥ 4.5:1", () => {
    expect(contrast(parse(vars["--page-fg"]), parse(vars["--page-bg"]))).toBeGreaterThan(4.5);
    for (const shade of ["500", "600", "700", "800", "900"]) {
      for (const [name, bg] of Object.entries(SURFACES)) {
        const ratio = contrast(dark("tx", "gray", shade), bg);
        expect(ratio, `text-gray-${shade} / ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("renkli metin (600–900) kartta ve kendi açık zemininde (50/100 rozet) ≥ 4.5:1", () => {
    for (const family of THEMED_FAMILIES.filter((f) => f !== "gray")) {
      for (const shade of ["600", "700", "800", "900"]) {
        const fg = dark("tx", family, shade);
        for (const bg of [
          SURFACES["bg-white (kart)"],
          dark("bg", family, "50"),
          dark("bg", family, "100"),
        ]) {
          expect(contrast(fg, bg), `text-${family}-${shade}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("marka metni ≥ 4.5:1, odak halkası ≥ 3:1 (1.4.11); beyaz buton metni değişmez", () => {
    for (const bg of Object.values(SURFACES)) {
      expect(contrast(parse(vars["--brand-fg"]), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parse(vars["--brand-ring"]), bg)).toBeGreaterThanOrEqual(3);
    }
    // Birincil buton: beyaz metin marka mavisi zeminde (tema bağımsız).
    expect(contrast([255, 255, 255], parse(hexToChannels("#003580")))).toBeGreaterThan(4.5);
    // 400+ arka planlar (dolu butonlar) karanlıkta da aynı kalır.
    expect(vars["--bg-red-700"]).toBeUndefined();
    expect(vars["--bg-gray-500"]).toBeUndefined();
  });

  it("açık temada değişken tanımlanmaz: sınıflar özgün renge düşer", () => {
    const colors = config.theme?.extend?.textColor as Record<string, Record<string, string>>;
    expect(colors.gray["900"]).toBe("rgb(var(--tx-gray-900, 17 24 39) / <alpha-value>)");
    const bg = config.theme?.extend?.backgroundColor as Record<string, string>;
    expect(bg.white).toBe("rgb(var(--bg-white, 255 255 255) / <alpha-value>)");
  });

  it("tema tercihi çerezi: geçersiz değer sistem temasına düşer", () => {
    expect(THEMES).toEqual(["system", "light", "dark"]);
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("purple")).toBe("system");
    expect(resolveTheme(undefined)).toBe("system");
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute("light")).toBe("light");
  });
});
