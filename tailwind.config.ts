import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import defaultColors from "tailwindcss/colors";

/**
 * P2-1a karanlık mod: mevcut sınıflar (bg-white, text-gray-900, bg-red-50 …) değişmeden
 * iki temada çalışsın diye renkler CSS değişkeni + varsayılan değer (fallback) olarak üretilir.
 * Açık temada hiçbir değişken tanımlı değildir → birebir eski renkler. Karanlık temada
 * (sistem tercihi `prefers-color-scheme: dark` ya da `data-theme="dark"` çerezi) yalnız
 * değişen tonlar için değişken tanımlanır:
 *   --c-*  : kenarlık/halka/ayraç vb. (gri tersine, renklerin açık tonları koyulaşır)
 *   --bg-* : arka plan (açık tonlar 50–300 koyu renk tonuna; 400+ buton renkleri aynı kalır)
 *   --tx-* : metin (koyu tonlar 500+ açık tonlara; beyaz metin beyaz kalır)
 * Kontrast (WCAG 1.4.3 AA) karanlık eşlemede tests/unit/ui/theme-contrast.test.ts ile ölçülür.
 */

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
export const THEMED_FAMILIES = [
  "gray",
  "red",
  "amber",
  "green",
  "blue",
  "emerald",
  "indigo",
  "yellow",
  "rose",
  "orange",
  "lime",
] as const;
type Family = (typeof THEMED_FAMILIES)[number] | "primary";
type Kind = "c" | "bg" | "tx";

// Booking.com marka mavisi + sarı vurgu (açık tema değerleri).
const PRIMARY: Record<string, string> = {
  50: "#eff6ff",
  100: "#dbeafe",
  200: "#bfdbfe",
  300: "#93c5fd",
  400: "#60a5fa",
  500: "#3b82f6",
  600: "#003580",
  700: "#002b66",
  800: "#00234f",
  900: "#001a3a",
  950: "#00112a",
};

export function palette(family: Family): Record<string, string> {
  return family === "primary"
    ? PRIMARY
    : (defaultColors as unknown as Record<string, Record<string, string>>)[family];
}

/** `#rrggbb` → `r g b` (rgb() içinde `/ alfa` ile kullanılır). */
export function hexToChannels(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// Her tür kendi değişkenine bakar; tanımsızsa (açık tema ya da eşlenmeyen ton) özgün renk.
const ref = (kind: Kind, family: string, shade: string, fallback: string) =>
  `rgb(var(--${kind}-${family}-${shade}, ${fallback}) / <alpha-value>)`;

function themed(kind: Kind) {
  const out: Record<string, Record<string, string>> = {};
  for (const family of [...THEMED_FAMILIES, "primary"] as Family[]) {
    const p = palette(family);
    out[family] = Object.fromEntries(
      SHADES.filter((s) => p[s]).map((s) => [s, ref(kind, family, s, hexToChannels(p[s]))])
    );
  }
  return out;
}

/** Karanlık tema ton eşlemesi: {utility türü: {kaynak ton: hedef ton}}. */
export const DARK_SHADE_MAP: Record<"gray" | "color", Record<Kind, Record<string, string>>> = {
  gray: {
    c: {
      50: "950",
      100: "900",
      200: "800",
      300: "600",
      400: "500",
      500: "400",
      600: "400",
      700: "300",
      800: "200",
      900: "100",
      950: "50",
    },
    bg: {
      50: "950",
      100: "800",
      200: "700",
      300: "600",
      400: "500",
      600: "400",
      700: "300",
      800: "200",
      900: "100",
      950: "50",
    },
    tx: {
      50: "900",
      100: "800",
      200: "700",
      300: "600",
      400: "500",
      500: "400",
      600: "300",
      700: "200",
      800: "100",
      900: "50",
      950: "50",
    },
  },
  color: {
    c: { 50: "950", 100: "900", 200: "800", 300: "700", 400: "600" },
    bg: { 50: "950", 100: "900", 200: "800", 300: "700" },
    tx: { 500: "400", 600: "300", 700: "300", 800: "200", 900: "100", 950: "50" },
  },
};

/** Karanlık tema değişkenleri (yalnız değişen tonlar). Kontrast testi de bunu kullanır. */
export function darkThemeVars(): Record<string, string> {
  const vars: Record<string, string> = {
    // Yüzeyler: bg-white kart, gövde arka planı ve metni.
    "--bg-white": hexToChannels(defaultColors.gray[900]),
    "--page-bg": hexToChannels(defaultColors.gray[950]),
    "--page-fg": hexToChannels(defaultColors.gray[50]),
    // Marka metni/halkası koyu zeminde açık maviye döner.
    "--brand-fg": hexToChannels(defaultColors.blue[300]),
    "--brand-ring": hexToChannels(defaultColors.blue[300]),
  };
  for (const family of [...THEMED_FAMILIES, "primary"] as Family[]) {
    const p = palette(family);
    const maps = DARK_SHADE_MAP[family === "gray" ? "gray" : "color"];
    for (const kind of ["c", "bg", "tx"] as Kind[]) {
      for (const [from, to] of Object.entries(maps[kind])) {
        if (p[from] && p[to]) vars[`--${kind}-${family}-${from}`] = hexToChannels(p[to]);
      }
    }
  }
  return vars;
}

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // `dark:` varyantı da aynı iki koşulda çalışsın (sistem tercihi ya da çerezle seçilen tema).
  darkMode: [
    "variant",
    [
      '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) & }',
      ':root[data-theme="dark"] &',
    ],
  ],
  theme: {
    extend: {
      colors: {
        ...themed("c"),
        brand: "rgb(var(--brand-ring, 0 53 128) / <alpha-value>)",
        booking: {
          blue: "#003580",
          blueDark: "#002b66",
          yellow: "#febb02",
        },
      },
      backgroundColor: {
        ...themed("bg"),
        white: "rgb(var(--bg-white, 255 255 255) / <alpha-value>)",
      },
      textColor: {
        ...themed("tx"),
        brand: "rgb(var(--brand-fg, 0 53 128) / <alpha-value>)",
      },
      ringOffsetColor: {
        DEFAULT: "rgb(var(--bg-white, 255 255 255))",
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      const vars = { ...darkThemeVars(), colorScheme: "dark" };
      addBase({
        "@media (prefers-color-scheme: dark)": { ':root:not([data-theme="light"])': vars },
        ':root[data-theme="dark"]': vars,
        body: {
          backgroundColor: "rgb(var(--page-bg, 255 255 255))",
          color: "rgb(var(--page-fg, 17 24 39))",
        },
      });
    }),
  ],
};

export default config;
