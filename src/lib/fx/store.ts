import { getConfig } from "@/lib/config/app-config";
import { ValidationError } from "@/lib/http/errors";
import { logger } from "@/lib/observability/logger";
import { convert, getFxTable, type FxSnapshot } from "@/lib/money/fx";
import { assertCurrency, money, type CurrencyCode, type Money } from "@/lib/money/money";
import { prisma } from "@/lib/prisma";
import { FxParseError, PARSERS, type FxSourceName, type ParsedRates } from "./sources";

/**
 * Kalıcı kur tablosu (P0-5).
 *
 * - `refreshFxRates` (günlük `fx-refresh` işi): `FX_SOURCES` sırasıyla TCMB / ECB denenir;
 *   hiçbiri yanıt vermezse statik `data/fx-rates.json` (veya `FX_RATES_JSON`) `stale: true`
 *   olarak yazılır. Her çalışma yeni bir `FxRate` satırıdır (geçmiş korunur).
 * - `getCurrentFx`: en yeni satır (kısa bellek önbelleği); tablo boşsa statik yedek.
 * - `getFxById`: teklifin bağlı olduğu satır → kur sonradan değişse de aynı tutar.
 */

export interface FxTable extends FxSnapshot {
  /** `FxRate.id`; statik yedek tablo kullanıldıysa null. */
  id: string | null;
  source: FxSourceName | "static";
  stale: boolean;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

function sourceUrl(name: FxSourceName): string {
  const config = getConfig();
  return name === "tcmb" ? config.FX_TCMB_URL : config.FX_ECB_URL;
}

export function configuredSources(): FxSourceName[] {
  return getConfig()
    .FX_SOURCES.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is FxSourceName => s === "tcmb" || s === "ecb");
}

/** Kaynakları sırayla dener; hiçbiri olmazsa null (çağıran statik tabloya düşer). */
export async function fetchLatestRates(fetchImpl: FetchLike = fetch): Promise<ParsedRates | null> {
  for (const name of configuredSources()) {
    try {
      const res = await fetchImpl(sourceUrl(name), {
        signal: AbortSignal.timeout(getConfig().FX_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return PARSERS[name](await res.text());
    } catch (error) {
      logger.warn(
        { source: name, err: (error as Error).message, parse: error instanceof FxParseError },
        "kur kaynağı kullanılamadı"
      );
    }
  }
  return null;
}

function staticTable(): FxTable {
  return { ...getFxTable(), id: null, source: "static", stale: true };
}

interface FxRow {
  id: string;
  base: string;
  rates: unknown;
  source: string;
  asOf: Date;
  stale: boolean;
  fetchedAt: Date;
}

function fromRow(row: FxRow, now: Date): FxTable {
  const maxAgeMs = getConfig().FX_STALE_HOURS * 3_600_000;
  return {
    id: row.id,
    base: "TRY",
    asOf: row.asOf.toISOString().slice(0, 10),
    rates: row.rates as FxSnapshot["rates"],
    source: row.source as FxTable["source"],
    stale: row.stale || now.getTime() - row.fetchedAt.getTime() > maxAgeMs,
  };
}

let cache: { table: FxTable; until: number } | null = null;

export function resetFxCacheForTests(): void {
  cache = null;
}

/** Kurları çeker ve yeni `FxRate` satırı yazar (ağ yoksa statik tablo, stale). */
export async function refreshFxRates(
  deps: { fetchImpl?: FetchLike; now?: Date } = {}
): Promise<FxTable> {
  const now = deps.now ?? new Date();
  const fetched = await fetchLatestRates(deps.fetchImpl);
  const fallback = getFxTable();
  const row = await prisma.fxRate.create({
    data: {
      base: "TRY",
      rates: fetched?.rates ?? fallback.rates,
      source: fetched?.source ?? "static",
      asOf: new Date(`${fetched?.asOf ?? fallback.asOf}T00:00:00Z`),
      stale: !fetched,
      fetchedAt: now,
    },
  });
  const table = fromRow(row, now);
  cache = { table, until: now.getTime() + getConfig().FX_CACHE_SECONDS * 1000 };
  logger.info({ source: table.source, stale: table.stale, asOf: table.asOf }, "kurlar yenilendi");
  return table;
}

/** En güncel kur tablosu; DB'de kayıt yoksa / DB erişilemezse statik yedek (stale). */
export async function getCurrentFx(now: Date = new Date()): Promise<FxTable> {
  if (cache && cache.until > now.getTime()) return cache.table;
  let table: FxTable;
  try {
    const row = await prisma.fxRate.findFirst({ orderBy: { fetchedAt: "desc" } });
    table = row ? fromRow(row, now) : staticTable();
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "kur tablosu okunamadı; statik yedek");
    return staticTable();
  }
  cache = { table, until: now.getTime() + getConfig().FX_CACHE_SECONDS * 1000 };
  return table;
}

/** Teklifin sabitlediği tablo; id yoksa (statik) statik tablo, satır silinmişse null. */
export async function getFxById(
  id: string | null,
  now: Date = new Date()
): Promise<FxTable | null> {
  if (id === null) return staticTable();
  const row = await prisma.fxRate.findUnique({ where: { id } });
  return row ? fromRow(row, now) : null;
}

/** Tahsilat para birimi: tesisinki ya da `FX_CHARGE_CURRENCIES` içindeki seçilen birim. */
export function resolveChargeCurrency(
  propertyCurrency: CurrencyCode,
  requested?: string
): CurrencyCode {
  if (!requested || requested.toUpperCase() === propertyCurrency) return propertyCurrency;
  const allowed = getConfig()
    .FX_CHARGE_CURRENCIES.split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const code = requested.toUpperCase();
  if (!allowed.includes(code)) {
    throw new ValidationError(`Bu para biriminde tahsilat yapılamaz: ${code}`);
  }
  return assertCurrency(code);
}

export interface ChargeAmount {
  currency: CurrencyCode;
  /** Tahsil edilecek tutar (minor-unit, tahsilat para biriminde). */
  total: number;
  /** Kullanılan kur tablosu (`FxRate.id`); dönüşüm yoksa da kayıt için tutulur. */
  fxSnapshotId: string | null;
}

/** Tesis para birimindeki toplamı verilen tabloyla tahsilat para birimine çevirir. */
export function chargeAmount(total: Money, currency: CurrencyCode, table: FxTable): ChargeAmount {
  const charged = total.currency === currency ? total : convert(total, currency, table);
  return { currency, total: money(charged.amount, currency).amount, fxSnapshotId: table.id };
}
