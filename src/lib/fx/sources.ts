import { CURRENCIES, type CurrencyCode } from "@/lib/money/money";

/**
 * Kur kaynağı ayrıştırıcıları (P0-5) — saf, ağsız, bağımlılıksız.
 * Çıktı tüm kaynaklarda aynı biçimdedir: "1 TRY = x birim" (TRY = 1), yalnızca desteklenen
 * para birimleri. Beklenmeyen biçim → `FxParseError` (çağıran bir sonraki kaynağa geçer).
 */

export type FxSourceName = "tcmb" | "ecb";

export interface ParsedRates {
  source: FxSourceName;
  /** Yayım tarihi (YYYY-AA-GG). */
  asOf: string;
  rates: Partial<Record<CurrencyCode, number>>;
}

export class FxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxParseError";
  }
}

const supported = (code: string): code is CurrencyCode =>
  (CURRENCIES as readonly string[]).includes(code);

/** Sonucu doğrular: TRY + en az bir yabancı para, hepsi sonlu pozitif. */
function finish(source: FxSourceName, asOf: string, rates: Record<string, number>): ParsedRates {
  const out: Partial<Record<CurrencyCode, number>> = { TRY: 1 };
  for (const [code, rate] of Object.entries(rates)) {
    if (supported(code) && Number.isFinite(rate) && rate > 0) out[code] = rate;
  }
  if (Object.keys(out).length < 2) throw new FxParseError(`${source}: desteklenen kur yok`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new FxParseError(`${source}: tarih okunamadı`);
  return { source, asOf, rates: out };
}

/**
 * TCMB `today.xml`: `<Currency Kod="USD"><Unit>1</Unit><ForexSelling>41.2</ForexSelling>`
 * → 1 birim = x TRY. Döviz satış kuru kullanılır (yoksa efektif satış).
 */
export function parseTcmbXml(xml: string): ParsedRates {
  const date = /<Tarih_Date[^>]*\bDate="(\d{2})\/(\d{2})\/(\d{4})"/.exec(xml);
  if (!date) throw new FxParseError("tcmb: Tarih_Date bulunamadı");
  const asOf = `${date[3]}-${date[1]}-${date[2]}`;
  const rates: Record<string, number> = {};
  for (const block of xml.matchAll(
    /<Currency\b[^>]*\bKod="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Currency>/g
  )) {
    const [, code, body] = block;
    const tag = (name: string) =>
      new RegExp(`<${name}>\\s*([\\d.]+)\\s*</${name}>`).exec(body)?.[1];
    const unit = Number(tag("Unit") ?? "1");
    const tryPerUnits = Number(tag("ForexSelling") ?? tag("BanknoteSelling"));
    if (unit > 0 && tryPerUnits > 0) rates[code] = unit / tryPerUnits;
  }
  return finish("tcmb", asOf, rates);
}

/**
 * ECB `eurofxref-daily.xml`: `<Cube time="…"><Cube currency="USD" rate="1.17"/>` → 1 EUR = x.
 * TRY tabanına çapraz kurla çevrilir (TRY kuru ECB listesinde yoksa kullanılamaz).
 */
export function parseEcbXml(xml: string): ParsedRates {
  const time = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml);
  if (!time) throw new FxParseError("ecb: Cube time bulunamadı");
  const perEur: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    perEur[m[1]] = Number(m[2]);
  }
  const tryPerEur = perEur.TRY;
  if (!(tryPerEur > 0)) throw new FxParseError("ecb: TRY kuru yok");
  const rates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(perEur)) rates[code] = rate / tryPerEur;
  return finish("ecb", time[1], rates);
}

export const PARSERS: Record<FxSourceName, (xml: string) => ParsedRates> = {
  tcmb: parseTcmbXml,
  ecb: parseEcbXml,
};
