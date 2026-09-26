import type { PrismaClient } from "@prisma/client";
import { ISO_CURRENCY_EXPONENTS } from "./currencies";

/**
 * P0-2 expand/contract backfill'i (ADR 0019): eski `Decimal(10,2)` kolonlarını
 * `BigInt *Minor` kolonlarına ISO 4217 üssüne göre (JPY ×1, TRY ×100, KWD ×1000) taşır.
 *
 * İdempotent: yalnızca `*Minor IS NULL AND eski IS NOT NULL` satırlar güncellenir; ikinci
 * koşu 0 satır yazar. Yuvarlama PostgreSQL `ROUND(numeric)` = yarım sıfırdan uzağa, yani
 * `roundHalfUp` ile aynı kural (ör. JPY 1500.50 → 1501). Eski kolon artık yoksa (contract
 * migration'ı uygulanmış) sütun atlanır.
 */
export interface MoneyColumnSpec {
  table: string;
  legacy: string;
  minor: string;
  /** Satırın para birimini veren SQL ifadesi; tablo takma adı `t`. */
  currencySql: string;
}

const viaProperty = (propertyRef: string) =>
  `(SELECT p."currency" FROM "Property" p WHERE p."id" = ${propertyRef})`;

export const MONEY_COLUMNS: readonly MoneyColumnSpec[] = [
  { table: "Property", legacy: "basePrice", minor: "basePriceMinor", currencySql: `t."currency"` },
  {
    table: "RoomType",
    legacy: "priceModifier",
    minor: "priceModifierMinor",
    currencySql: viaProperty(`t."propertyId"`),
  },
  {
    table: "InventoryDay",
    legacy: "price",
    minor: "priceMinor",
    currencySql: `(SELECT p."currency" FROM "RoomType" r JOIN "Property" p ON p."id" = r."propertyId" WHERE r."id" = t."roomTypeId")`,
  },
  { table: "Booking", legacy: "totalPrice", minor: "totalPriceMinor", currencySql: `t."currency"` },
  { table: "Payment", legacy: "amount", minor: "amountMinor", currencySql: `t."currency"` },
  {
    table: "Payment",
    legacy: "refundedAmount",
    minor: "refundedAmountMinor",
    currencySql: `t."currency"`,
  },
  { table: "LedgerEntry", legacy: "amount", minor: "amountMinor", currencySql: `t."currency"` },
  {
    table: "PriceHistory",
    legacy: "avgNightlyPrice",
    minor: "avgNightlyPriceMinor",
    currencySql: viaProperty(`t."propertyId"`),
  },
  {
    table: "BookingTransfer",
    legacy: "askPrice",
    minor: "askPriceMinor",
    currencySql: `t."currency"`,
  },
  { table: "Payout", legacy: "amount", minor: "amountMinor", currencySql: `t."currency"` },
  { table: "Invoice", legacy: "amount", minor: "amountMinor", currencySql: `t."currency"` },
  { table: "Invoice", legacy: "taxAmount", minor: "taxAmountMinor", currencySql: `t."currency"` },
];

const ident = (name: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    throw new Error(`Geçersiz SQL tanımlayıcısı: ${name}`);
  return `"${name}"`;
};

/**
 * Para birimi → 10^üs çarpanı (numeric). Tablo `currencies.ts`'ten üretilir; bilinmeyen
 * birim 2 basamak sayılır (v3'te desteklenen tüm birimler 2 basamaklıdır).
 */
export function multiplierCaseSql(currencyExpr: string): string {
  const groups = new Map<number, string[]>();
  for (const [code, exp] of Object.entries(ISO_CURRENCY_EXPONENTS)) {
    if (exp === 2) continue;
    groups.set(exp, [...(groups.get(exp) ?? []), `'${code}'`]);
  }
  const whens = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([exp, codes]) => `WHEN ${currencyExpr} IN (${codes.join(", ")}) THEN ${10 ** exp}`);
  return `(CASE ${whens.join(" ")} ELSE 100 END)`;
}

/** Tek bir kolon için idempotent backfill UPDATE cümlesi. */
export function backfillSql(spec: MoneyColumnSpec): string {
  const legacy = ident(spec.legacy);
  const minor = ident(spec.minor);
  return (
    `UPDATE ${ident(spec.table)} t SET ${minor} = ROUND(t.${legacy} * ${multiplierCaseSql(spec.currencySql)})::BIGINT ` +
    `WHERE t.${minor} IS NULL AND t.${legacy} IS NOT NULL`
  );
}

type Db = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

async function columnExists(db: Db, table: string, column: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    table,
    column
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

export interface BackfillResult {
  table: string;
  minor: string;
  /** Güncellenen satır; eski kolon yoksa `skipped`. */
  updated: number;
  skipped: boolean;
}

export async function backfillMoneyColumns(
  db: Db,
  specs: readonly MoneyColumnSpec[] = MONEY_COLUMNS
): Promise<BackfillResult[]> {
  const results: BackfillResult[] = [];
  for (const spec of specs) {
    const present =
      (await columnExists(db, spec.table, spec.legacy)) &&
      (await columnExists(db, spec.table, spec.minor));
    if (!present) {
      results.push({ table: spec.table, minor: spec.minor, updated: 0, skipped: true });
      continue;
    }
    const updated = await db.$executeRawUnsafe(backfillSql(spec));
    results.push({ table: spec.table, minor: spec.minor, updated, skipped: false });
  }
  return results;
}

export interface ColumnTotals {
  /** Eski kolonun minor-unit karşılığı toplamı (Σ ROUND(eski × 10^üs)). */
  legacyMinor: bigint;
  minor: bigint;
  /** Eski değeri olup `*Minor`'u boş kalan satır sayısı (0 olmalı). */
  missing: number;
}

/** Mutabakat: eski ve yeni kolonun minor-unit toplamları (backfill sonrası eşit olmalı). */
export async function moneyColumnTotals(db: Db, spec: MoneyColumnSpec): Promise<ColumnTotals> {
  const legacy = ident(spec.legacy);
  const minor = ident(spec.minor);
  const rows = await db.$queryRawUnsafe<
    { legacy_minor: string | null; minor: string | null; missing: bigint }[]
  >(
    `SELECT COALESCE(SUM(ROUND(t.${legacy} * ${multiplierCaseSql(spec.currencySql)})), 0)::text AS legacy_minor,
            COALESCE(SUM(t.${minor}), 0)::text AS minor,
            COUNT(*) FILTER (WHERE t.${legacy} IS NOT NULL AND t.${minor} IS NULL)::bigint AS missing
     FROM ${ident(spec.table)} t`
  );
  const row = rows[0];
  return {
    legacyMinor: BigInt(row?.legacy_minor ?? "0"),
    minor: BigInt(row?.minor ?? "0"),
    missing: Number(row?.missing ?? 0),
  };
}
