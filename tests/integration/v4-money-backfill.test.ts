// v4 P0-2 / v4#15: Decimal(10,2) → BigInt *Minor expand/contract migration'ı ve backfill.
// Gerçek migration SQL'i, eski şemanın (Decimal kolonlar) kopyası olan ayrı bir PostgreSQL
// şemasında koşturulur; böylece asıl test veritabanı (contract uygulanmış) etkilenmez.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { backfillMoneyColumns, MONEY_COLUMNS, moneyColumnTotals } from "@/lib/money/backfill";

const SCHEMA = "v4_money_probe";

const LEGACY_DDL = [
  `CREATE TABLE "Property" (id text PRIMARY KEY, currency text NOT NULL, "basePrice" numeric(10,2) NOT NULL)`,
  `CREATE TABLE "RoomType" (id text PRIMARY KEY, "propertyId" text NOT NULL, "priceModifier" numeric(10,2) NOT NULL DEFAULT 0)`,
  `CREATE TABLE "InventoryDay" (id text PRIMARY KEY, "roomTypeId" text NOT NULL, price numeric(10,2) NOT NULL)`,
  `CREATE TABLE "Booking" (id text PRIMARY KEY, currency text NOT NULL, "totalPrice" numeric(10,2) NOT NULL)`,
  `CREATE TABLE "Payment" (id text PRIMARY KEY, currency text NOT NULL, amount numeric(10,2) NOT NULL, "refundedAmount" numeric(10,2) NOT NULL DEFAULT 0)`,
  `CREATE TABLE "LedgerEntry" (id text PRIMARY KEY, currency text NOT NULL, amount numeric(10,2) NOT NULL)`,
  `CREATE TABLE "PriceHistory" (id text PRIMARY KEY, "propertyId" text NOT NULL, "avgNightlyPrice" numeric(10,2) NOT NULL)`,
  `CREATE TABLE "BookingTransfer" (id text PRIMARY KEY, currency text NOT NULL, "askPrice" numeric(10,2) NOT NULL)`,
  `CREATE TABLE "Payout" (id text PRIMARY KEY, currency text NOT NULL, amount numeric(10,2) NOT NULL)`,
  `CREATE TABLE "Invoice" (id text PRIMARY KEY, currency text NOT NULL, amount numeric(10,2) NOT NULL, "taxAmount" numeric(10,2) NOT NULL)`,
];

const SEED = [
  `INSERT INTO "Property" VALUES ('p-try','TRY',1234.56),('p-jpy','JPY',15000.50),('p-kwd','KWD',45.25)`,
  `INSERT INTO "RoomType" VALUES ('r-try','p-try',100.10),('r-jpy','p-jpy',2000.00),('r-kwd','p-kwd',5.50)`,
  `INSERT INTO "InventoryDay" VALUES ('d1','r-try',999.99),('d2','r-jpy',12000.49),('d3','r-kwd',60.01)`,
  `INSERT INTO "Booking" VALUES ('b1','TRY',2469.12),('b2','JPY',30001.00),('b3','KWD',90.50)`,
  `INSERT INTO "Payment" VALUES ('pay1','TRY',2469.12,100.00),('pay2','JPY',30001.00,0),('pay3','KWD',90.50,10.25)`,
  `INSERT INTO "LedgerEntry" VALUES ('l1','TRY',2469.12),('l2','KWD',-10.25)`,
  `INSERT INTO "PriceHistory" VALUES ('h1','p-try',1100.00),('h2','p-kwd',44.44)`,
  `INSERT INTO "BookingTransfer" VALUES ('t1','TRY',2000.00),('t2','JPY',25000.00)`,
  `INSERT INTO "Payout" VALUES ('o1','TRY',2000.00)`,
  `INSERT INTO "Invoice" VALUES ('i1','TRY',2469.12,24.45),('i2','KWD',90.50,0.90)`,
];

function migrationSql(suffix: string): string[] {
  const dir = readdirSync(path.resolve("prisma/migrations")).find((d) => d.endsWith(suffix));
  if (!dir) throw new Error(`migration yok: ${suffix}`);
  return readFileSync(path.resolve("prisma/migrations", dir, "migration.sql"), "utf8")
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

async function inProbe<T>(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      return fn(tx);
    },
    { timeout: 60_000 }
  );
}

async function allTotals(tx: Prisma.TransactionClient) {
  const out: Record<string, Awaited<ReturnType<typeof moneyColumnTotals>>> = {};
  for (const spec of MONEY_COLUMNS) {
    out[`${spec.table}.${spec.minor}`] = await moneyColumnTotals(tx, spec);
  }
  return out;
}

describeInt("P0-2 minor-unit para backfill (expand/contract)", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it("expand migration'ı eski/yeni toplamları eşitler; backfill idempotent; contract eski kolonları düşürür", async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);

    await inProbe(prisma, async (tx) => {
      for (const sql of [...LEGACY_DDL, ...SEED]) await tx.$executeRawUnsafe(sql);
      // Eski Decimal toplamı (ana birim) — göç sonrası kıyas için.
      const legacyMajor = await tx.$queryRawUnsafe<{ s: string }[]>(
        `SELECT SUM("totalPrice")::text AS s FROM "Booking" WHERE currency = 'TRY'`
      );
      expect(legacyMajor[0].s).toBe("2469.12");

      // EXPAND: kolon ekle + satır içi backfill (gerçek migration dosyası).
      for (const sql of migrationSql("_money_minor_expand")) await tx.$executeRawUnsafe(sql);

      const totals = await allTotals(tx);
      for (const [col, t] of Object.entries(totals)) {
        expect(t.missing, col).toBe(0);
        expect(t.minor, col).toBe(t.legacyMinor);
      }
      // ISO üssü: TRY ×100, JPY ×1 (half-up: 15000.50 → 15001), KWD ×1000.
      const props = await tx.$queryRawUnsafe<{ id: string; m: bigint }[]>(
        `SELECT id, "basePriceMinor" AS m FROM "Property" ORDER BY id`
      );
      expect(props.map((p) => [p.id, Number(p.m)])).toEqual([
        ["p-jpy", 15001],
        ["p-kwd", 45250],
        ["p-try", 123456],
      ]);
      const days = await tx.$queryRawUnsafe<{ id: string; m: bigint }[]>(
        `SELECT id, "priceMinor" AS m FROM "InventoryDay" ORDER BY id`
      );
      expect(days.map((d) => Number(d.m))).toEqual([99999, 12000, 60010]);

      // Expand ile contract arasında ESKİ kod yalnız Decimal kolonu yazar.
      await tx.$executeRawUnsafe(
        `INSERT INTO "Booking" (id, currency, "totalPrice") VALUES ('b4','TRY',10.05),('b5','KWD',1.5)`
      );
      const first = await backfillMoneyColumns(tx);
      const booking = first.find((r) => r.minor === "totalPriceMinor")!;
      expect(booking).toMatchObject({ updated: 2, skipped: false });
      expect(first.filter((r) => r.minor !== "totalPriceMinor").every((r) => r.updated === 0)).toBe(
        true
      );

      // İdempotent: ikinci koşu hiçbir satırı değiştirmez, toplamlar yine eşit.
      const second = await backfillMoneyColumns(tx);
      expect(second.every((r) => r.updated === 0 && !r.skipped)).toBe(true);
      const again = await allTotals(tx);
      for (const [col, t] of Object.entries(again)) expect(t.minor, col).toBe(t.legacyMinor);
      expect(again["Booking.totalPriceMinor"].minor).toBe(
        246912n + 30001n + 90500n + 1005n + 1500n
      );

      // Yeni kod *Minor'u doğrudan yazar; backfill onu EZMEZ.
      await tx.$executeRawUnsafe(
        `INSERT INTO "Payout" (id, currency, "amountMinor") VALUES ('o2','JPY',777)`
      );
      await backfillMoneyColumns(tx);
      const o2 = await tx.$queryRawUnsafe<{ m: bigint }[]>(
        `SELECT "amountMinor" AS m FROM "Payout" WHERE id = 'o2'`
      );
      expect(Number(o2[0].m)).toBe(777);

      // CONTRACT: eski kolonlar düşer, *Minor NOT NULL; sonrasında backfill her kolonu atlar.
      for (const sql of migrationSql("_money_minor_contract")) await tx.$executeRawUnsafe(sql);
      const legacyLeft = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::bigint AS n FROM information_schema.columns
         WHERE table_schema = '${SCHEMA}' AND data_type = 'numeric'`
      );
      expect(Number(legacyLeft[0].n)).toBe(0);
      const after = await backfillMoneyColumns(tx);
      expect(after.every((r) => r.skipped)).toBe(true);
      await tx.$executeRawUnsafe(`SAVEPOINT not_null_check`);
      await expect(
        tx.$executeRawUnsafe(`INSERT INTO "Booking" (id, currency) VALUES ('b6','TRY')`)
      ).rejects.toThrow();
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT not_null_check`);
    });
  });

  it("asıl test veritabanında (contract uygulanmış) script güvenle no-op'tur", async () => {
    const results = await backfillMoneyColumns(prisma);
    expect(results).toHaveLength(MONEY_COLUMNS.length);
    expect(results.every((r) => r.skipped && r.updated === 0)).toBe(true);
  });
});
