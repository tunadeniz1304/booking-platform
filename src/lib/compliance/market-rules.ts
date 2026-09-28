import { z } from "zod";
import defaultRules from "../../../data/market-rules.json";
import { logger } from "@/lib/observability/logger";
import { euCountryCode, isLicenseFormatValid } from "@/lib/compliance/license-registry";

/**
 * P1-7 pazar bazlı uyum kural motoru (v5#14). Tesis ülkesi → pazar kuralı:
 *  - indirim referans penceresi (TR 10 gün, AB 30 gün, varsayılan 30),
 *  - "önceki fiyat" kuralı (pencerenin en düşüğü ya da indirimden hemen önceki fiyat),
 *  - kayıt/belge no zorunluluğu ve biçimi (TR 7464 izin belgesi, AB 2024/1028 kayıt no),
 *  - toplam fiyat gösterimi (ABD FTC ücret kuralı: zorunlu).
 *
 * Kurallar veridir: `data/market-rules.json` (varsayılan) ya da `MARKET_RULES_JSON` (tamamen
 * değiştirir; geçersizse varsayılan + uyarı). Değerler hukuki danışmanlık değildir; kaynaklar
 * ve yürürlük tarihleri docs/COMPLIANCE.md'dedir.
 */

export const PREVIOUS_PRICE_RULES = ["lowest-in-window", "previous-price"] as const;
export type PreviousPriceRule = (typeof PREVIOUS_PRICE_RULES)[number];

const registrationSchema = z.object({
  /** Yasal kayıt/izin no zorunluluğu (ilanda gösterim dahil). */
  required: z.boolean(),
  /** Kayıt şeması: "tr-7464", "eu-2024-1028" ya da platform politikası ("platform"). */
  scheme: z.string().trim().min(1).max(40),
  /** Pazar biçimi (RegExp kaynağı); yoksa platformun genel biçim kontrolü uygulanır. */
  pattern: z
    .string()
    .min(1)
    .max(200)
    .refine((p) => {
      try {
        new RegExp(p);
        return true;
      } catch {
        return false;
      }
    }, "Geçersiz düzenli ifade")
    .optional(),
});

const ruleBodySchema = z.object({
  discountReferenceDays: z.number().int().min(1).max(365),
  previousPriceRule: z.enum(PREVIOUS_PRICE_RULES),
  registration: registrationSchema,
  totalPriceDisplay: z.enum(["required", "recommended"]),
});

const marketSchema = ruleBodySchema.extend({
  id: z.string().trim().min(1).max(20),
  /** Ülke kodları/adları (büyük harf karşılaştırılır); "@EU" tüm AB üyeleri. */
  countries: z.array(z.string().trim().min(1).max(100)).min(1),
});

const fileSchema = z.object({
  default: ruleBodySchema,
  markets: z.array(marketSchema),
});

export type MarketRulesFile = z.infer<typeof fileSchema>;

export interface MarketRules {
  /** Eşleşen pazar kimliği ya da "DEFAULT". */
  market: string;
  discountReferenceDays: number;
  previousPriceRule: PreviousPriceRule;
  registration: { required: boolean; scheme: string; pattern: RegExp | null };
  totalPriceDisplay: "required" | "recommended";
}

let cachedSource: string | undefined;
let cachedFile: MarketRulesFile = fileSchema.parse(defaultRules);

/** Yapılandırılmış kural dosyası. Geçersiz `MARKET_RULES_JSON` → varsayılan dosya + uyarı. */
export function loadMarketRules(
  env: Record<string, string | undefined> = process.env
): MarketRulesFile {
  const source = env.MARKET_RULES_JSON ?? "";
  if (source === cachedSource) return cachedFile;
  let file = fileSchema.parse(defaultRules);
  if (source) {
    try {
      file = fileSchema.parse(JSON.parse(source));
    } catch (error) {
      logger.warn(
        { err: (error as Error).message },
        "MARKET_RULES_JSON geçersiz; varsayılan pazar kuralları"
      );
    }
  }
  cachedSource = source;
  cachedFile = file;
  return file;
}

/** Büyük harf + noktalı İ → I ("United States" tr-TR'de "UNİTED" olur). */
const upper = (s: string) => s.trim().toLocaleUpperCase("tr-TR").replace(/İ/g, "I");

function matches(countries: readonly string[], country: string): boolean {
  const key = upper(country);
  return countries.some((c) => (c === "@EU" ? euCountryCode(country) !== null : upper(c) === key));
}

function resolve(market: string, body: z.infer<typeof ruleBodySchema>): MarketRules {
  return {
    market,
    discountReferenceDays: body.discountReferenceDays,
    previousPriceRule: body.previousPriceRule,
    registration: {
      required: body.registration.required,
      scheme: body.registration.scheme,
      pattern: body.registration.pattern ? new RegExp(body.registration.pattern) : null,
    },
    totalPriceDisplay: body.totalPriceDisplay,
  };
}

/** Tesis ülkesine (Location.country: ad ya da ISO kodu) uyan ilk pazar kuralı; yoksa varsayılan. */
export function marketRulesFor(
  country: string,
  env?: Record<string, string | undefined>
): MarketRules {
  const file = loadMarketRules(env);
  const hit = file.markets.find((m) => matches(m.countries, country));
  return hit ? resolve(hit.id, hit) : resolve("DEFAULT", file.default);
}

/** Tüm pazarlardaki en uzun indirim referans penceresi (fiyat geçmişi saklama alt sınırı). */
export function maxDiscountReferenceDays(env?: Record<string, string | undefined>): number {
  const file = loadMarketRules(env);
  return Math.max(
    file.default.discountReferenceDays,
    ...file.markets.map((m) => m.discountReferenceDays)
  );
}

/**
 * İlan yayın kontrolü: kayıt no pazar biçimine uyuyor mu. Pazar biçimi tanımlı değilse
 * platformun genel biçimi (TR ya da AB) kabul edilir.
 */
export function isRegistrationFormatValid(country: string, value: string): boolean {
  const { pattern } = marketRulesFor(country).registration;
  return pattern ? pattern.test(value) : isLicenseFormatValid(value);
}
