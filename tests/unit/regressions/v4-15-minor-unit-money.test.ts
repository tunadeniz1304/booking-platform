import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backfillSql, MONEY_COLUMNS, multiplierCaseSql } from "@/lib/money/backfill";
import { minorFromDb, minorToDb, money, toDecimalString, toMinor } from "@/lib/money/money";

/**
 * v4#15: `Decimal(10,2)` para kolonları 3 haneli birimleri (KWD/BHD) ve büyük IDR/VND
 * tutarlarını taşıyamıyordu (en fazla 99.999.999,99; kesir 2 hane). Kolonlar artık
 * `BigInt *Minor` + ISO 4217 üs tablosu (ADR 0019).
 */
describe("regression: v4#15 Decimal(10,2) para kolonları → BigInt minor-unit", () => {
  const schema = readFileSync(path.resolve("prisma/schema.prisma"), "utf8");

  it("şemada Decimal para kolonu kalmadı; her eski kolonun *Minor BigInt karşılığı var", () => {
    expect(schema).not.toMatch(/@db\.Decimal\(10,\s*2\)/);
    for (const spec of MONEY_COLUMNS) {
      const model = new RegExp(`model ${spec.table} \\{[\\s\\S]*?\\n\\}`).exec(schema)?.[0] ?? "";
      expect(model, `${spec.table}.${spec.minor}`).toMatch(
        new RegExp(`\\n\\s+${spec.minor}\\s+BigInt\\b`)
      );
      expect(model).not.toMatch(new RegExp(`\\n\\s+${spec.legacy}\\s+Decimal\\b`));
    }
  });

  it("KWD 3. hanesi ve 10^8 üstü IDR tutarı kayıpsız saklanır", () => {
    const kwd = money(toMinor("1234.567", "KWD"), "KWD");
    expect(toDecimalString(money(minorFromDb(minorToDb(kwd.amount)), "KWD"))).toBe("1234.567");
    // 250.000.000,00 IDR — Decimal(10,2) sınırını (99.999.999,99) aşar.
    const idr = toMinor("250000000.00", "IDR");
    expect(minorFromDb(minorToDb(idr))).toBe(25_000_000_000);
  });

  it("expand/contract migration'ları ayrı; contract eski kolonları düşürür", () => {
    const dirs = readdirSync(path.resolve("prisma/migrations"));
    const expand = dirs.find((d) => d.endsWith("_money_minor_expand"));
    const contract = dirs.find((d) => d.endsWith("_money_minor_contract"));
    expect(expand && contract && expand < contract).toBe(true);
    const expandSql = readFileSync(
      path.resolve("prisma/migrations", expand!, "migration.sql"),
      "utf8"
    );
    const contractSql = readFileSync(
      path.resolve("prisma/migrations", contract!, "migration.sql"),
      "utf8"
    );
    for (const spec of MONEY_COLUMNS) {
      expect(expandSql).toContain(`ADD COLUMN "${spec.minor}" BIGINT`);
      expect(expandSql).toContain(backfillSql(spec));
      expect(expandSql).not.toContain(`DROP COLUMN "${spec.legacy}"`);
      expect(contractSql).toContain(`DROP COLUMN "${spec.legacy}"`);
    }
  });

  it("backfill çarpanı üs tablosundan üretilir (JPY ×1, KWD ×1000, varsayılan ×100)", () => {
    const sql = multiplierCaseSql("c");
    expect(sql).toMatch(/'JPY'[^)]*\) THEN 1 /);
    expect(sql).toMatch(/'KWD'[^)]*\) THEN 1000 /);
    expect(sql).toMatch(/ELSE 100 END/);
  });
});
