import { z } from "zod";
import defaultRules from "../../../data/tax-rules.json";
import { getConfig } from "@/lib/config/app-config";
import { logger } from "@/lib/observability/logger";
import { bpsOf, includedBpsOf, money, type CurrencyCode } from "@/lib/money/money";
import { isIsoDate, type IsoDate } from "@/lib/time/nights";

/**
 * Vergi / ücret motoru (P0-4) — saf, deterministik, tamsayı minor-unit.
 *
 * Kurallar veri olarak gelir: `data/tax-rules.json` (varsayılan) ya da `TAX_RULES_JSON`
 * (tamamen değiştirir). Hizmet bedeli `SERVICE_FEE_BPS` ayarından üretilir (0 → yok).
 *
 * Hesap sırası (gece başına):
 *  1. Dahil (inclusive) yüzde vergiler gece tutarının İÇİNDEN ayrılır (ör. KDV %10 dahil);
 *     toplamı değiştirmez, kırılımda "dahil" olarak gösterilir.
 *  2. Hariç yüzde vergiler, dahil vergilerden arındırılmış NET tutar üzerinden eklenir
 *     (TR konaklama vergisinin matrahı KDV hariç bedeldir).
 *  3. Sabit tutarlı kurallar (`flatMinor`) gece × oda ve/veya kişi başına eklenir.
 *  4. Hizmet bedeli (kind=SERVICE_FEE) brüt konaklama tutarı üzerinden eklenir.
 *
 * Aynı `code` için birden çok kural bir geceye uyuyorsa TARİH ARALIKLI kural, aralıksız
 * kuralı ezer (ör. konaklama vergisi %2, 1 Mayıs–31 Aralık 2026 arası %1).
 */

export const TAX_KINDS = ["VAT", "ACCOMMODATION", "CITY", "SERVICE_FEE"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

const isoDay = z.string().refine((v) => isIsoDate(v), "Tarih YYYY-AA-GG olmalı");

export const TaxRuleSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    /** Konum ülke adı (Location.country) ya da tüm ülkeler için "*". */
    country: z.string().trim().min(1).max(100),
    kind: z.enum(TAX_KINDS),
    label: z.string().trim().min(1).max(80),
    rateBps: z.number().int().min(0).max(10_000).optional(),
    flatMinor: z.number().int().min(0).optional(),
    /** Sabit tutarın para birimi; tesisin para biriminden farklıysa kural uygulanmaz. */
    currency: z.string().length(3).optional(),
    perNight: z.boolean().default(false),
    perGuest: z.boolean().default(false),
    inclusive: z.boolean().default(false),
    validFrom: isoDay.optional(),
    validTo: isoDay.optional(),
  })
  .refine((r) => (r.rateBps === undefined) !== (r.flatMinor === undefined), {
    message: "Kural ya rateBps ya da flatMinor içermeli (ikisi birden değil)",
  })
  .refine((r) => !(r.inclusive && r.flatMinor !== undefined), {
    message: "Sabit tutarlı kural dahil (inclusive) olamaz",
  });

export type TaxRule = z.infer<typeof TaxRuleSchema>;

const rulesFileSchema = z.object({ rules: z.array(TaxRuleSchema) });

let cachedSource: string | undefined;
let cachedRules: TaxRule[] = [];

/** Yapılandırılmış tüm kurallar. Geçersiz `TAX_RULES_JSON` → varsayılan dosya + uyarı. */
export function loadTaxRules(env: Record<string, string | undefined> = process.env): TaxRule[] {
  const source = env.TAX_RULES_JSON ?? "";
  if (source === cachedSource) return cachedRules;
  let rules = rulesFileSchema.parse(defaultRules).rules;
  if (source) {
    try {
      const raw: unknown = JSON.parse(source);
      rules = rulesFileSchema.parse(Array.isArray(raw) ? { rules: raw } : raw).rules;
    } catch (error) {
      logger.warn(
        { err: (error as Error).message },
        "TAX_RULES_JSON geçersiz; varsayılan kurallar"
      );
    }
  }
  cachedSource = source;
  cachedRules = rules;
  return rules;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("tr-TR");

/** Ülkeye uyan kurallar + config'teki hizmet bedeli. */
export function taxRulesFor(country: string, env?: Record<string, string | undefined>): TaxRule[] {
  const rules = loadTaxRules(env).filter(
    (r) => r.country === "*" || norm(r.country) === norm(country)
  );
  const feeBps = getConfig().SERVICE_FEE_BPS;
  if (feeBps > 0 && !rules.some((r) => r.kind === "SERVICE_FEE")) {
    rules.push(
      TaxRuleSchema.parse({
        code: "SERVICE_FEE",
        country: "*",
        kind: "SERVICE_FEE",
        label: "Hizmet bedeli",
        rateBps: feeBps,
      })
    );
  }
  return rules;
}

const inRange = (r: TaxRule, date: IsoDate) =>
  (!r.validFrom || date >= r.validFrom) && (!r.validTo || date <= r.validTo);
const dated = (r: TaxRule) => Boolean(r.validFrom || r.validTo);

/** Bir gece için her `code`'un geçerli kuralı (tarih aralıklı kural öncelikli). */
export function rulesForNight(rules: readonly TaxRule[], date: IsoDate): TaxRule[] {
  const byCode = new Map<string, TaxRule>();
  for (const r of rules) {
    if (!inRange(r, date)) continue;
    const current = byCode.get(r.code);
    if (!current || (dated(r) && !dated(current))) byCode.set(r.code, r);
  }
  return [...byCode.values()];
}

export interface TaxLine {
  code: string;
  kind: TaxKind;
  label: string;
  /** Tüm gecelerde aynı oran uygulandıysa baz puan; karışıksa undefined. */
  rateBps?: number;
  amount: number;
  /** true → tutar zaten fiyatın içinde (toplama eklenmez). */
  inclusive: boolean;
}

export interface TaxResult {
  taxes: TaxLine[];
  fees: TaxLine[];
  /** Toplama eklenecek (hariç) vergi + ücret tutarı. */
  addOn: number;
}

/**
 * Gece tutarlarına (oda adedi dahil, brüt) kuralları uygular.
 * Dönüş sırası kural sırasını izler → kırılım deterministiktir.
 */
export function computeTaxes(input: {
  nights: ReadonlyArray<{ date: IsoDate; amount: number }>;
  rules: readonly TaxRule[];
  currency: CurrencyCode;
  guests?: number;
  units?: number;
}): TaxResult {
  const { currency } = input;
  const guests = input.guests ?? 1;
  const units = input.units ?? 1;
  const lines = new Map<string, TaxLine & { rates: Set<number> }>();
  const add = (rule: TaxRule, amount: number) => {
    const line = lines.get(rule.code) ?? {
      code: rule.code,
      kind: rule.kind,
      label: rule.label,
      amount: 0,
      inclusive: rule.inclusive,
      rates: new Set<number>(),
    };
    line.amount += amount;
    if (rule.rateBps !== undefined) line.rates.add(rule.rateBps);
    lines.set(rule.code, line);
  };

  const flatOnce = new Set<string>();
  for (const night of input.nights) {
    const gross = money(night.amount, currency);
    const applicable = rulesForNight(input.rules, night.date);
    let net = gross.amount;
    for (const r of applicable) {
      if (r.inclusive && r.rateBps !== undefined) {
        const part = includedBpsOf(gross, r.rateBps).amount;
        net -= part;
        add(r, part);
      }
    }
    for (const r of applicable) {
      if (r.inclusive) continue;
      if (r.rateBps !== undefined) {
        const base = r.kind === "SERVICE_FEE" ? gross : money(net, currency);
        add(r, bpsOf(base, r.rateBps).amount);
      } else if (r.flatMinor !== undefined && (!r.currency || r.currency === currency)) {
        if (!r.perNight) {
          if (flatOnce.has(r.code)) continue;
          flatOnce.add(r.code);
        }
        const count = (r.perNight ? units : 1) * (r.perGuest ? guests : 1);
        add(r, r.flatMinor * count);
      }
    }
  }

  const taxes: TaxLine[] = [];
  const fees: TaxLine[] = [];
  let addOn = 0;
  for (const { rates, ...line } of lines.values()) {
    if (line.amount === 0) continue;
    const out: TaxLine = { ...line, rateBps: rates.size === 1 ? [...rates][0] : undefined };
    (line.kind === "SERVICE_FEE" ? fees : taxes).push(out);
    if (!line.inclusive) addOn += line.amount;
  }
  return { taxes, fees, addOn };
}
