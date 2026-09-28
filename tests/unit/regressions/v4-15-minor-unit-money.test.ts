import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { minorFromDb, minorToDb, money, toDecimalString, toMinor } from "@/lib/money/money";

/**
 * v4#15: `Decimal(10,2)` para kolonları 3 haneli birimleri (KWD/BHD) ve büyük IDR/VND
 * tutarlarını taşıyamıyordu (en fazla 99.999.999,99; kesir 2 hane). Kolonlar artık
 * `BigInt *Minor` + ISO 4217 üs tablosu (ADR 0019).
 *
 * v5 P0-3 (ADR 0033): expand/contract tamamlandı; ölü backfill modülü kaldırıldı. Regresyon
 * artık doğrudan şemayı denetler: hiçbir modelde `Decimal` para kolonu yok, her para alanı
 * `BigInt *Minor`.
 */
const MONEY_COLUMNS = [
  { table: "Property", legacy: "basePrice", minor: "basePriceMinor" },
  { table: "RoomType", legacy: "priceModifier", minor: "priceModifierMinor" },
  { table: "InventoryDay", legacy: "price", minor: "priceMinor" },
  { table: "Booking", legacy: "totalPrice", minor: "totalPriceMinor" },
  { table: "Payment", legacy: "amount", minor: "amountMinor" },
  { table: "Payment", legacy: "refundedAmount", minor: "refundedAmountMinor" },
  { table: "PriceHistory", legacy: "avgNightlyPrice", minor: "avgNightlyPriceMinor" },
  { table: "BookingTransfer", legacy: "askPrice", minor: "askPriceMinor" },
  { table: "Payout", legacy: "amount", minor: "amountMinor" },
  { table: "Invoice", legacy: "amount", minor: "amountMinor" },
  { table: "Invoice", legacy: "taxAmount", minor: "taxAmountMinor" },
] as const;

describe("regression: v4#15 Decimal(10,2) para kolonları → BigInt minor-unit", () => {
  const schema = readFileSync(path.resolve("prisma/schema.prisma"), "utf8");

  it("şemada Decimal para kolonu yok; her para alanı *Minor BigInt", () => {
    // Hiçbir alan tipi Decimal değil (para tutarı yalnız BigInt minor-unit).
    expect(schema).not.toMatch(/^\s+\w+\s+Decimal\??(\s|$)/m);
    expect(schema).not.toMatch(/@db\.Decimal/);
    for (const spec of MONEY_COLUMNS) {
      const model = new RegExp(`model ${spec.table} \\{[\\s\\S]*?\\n\\}`).exec(schema)?.[0] ?? "";
      expect(model, `${spec.table}.${spec.minor}`).toMatch(
        new RegExp(`\\n\\s+${spec.minor}\\s+BigInt\\b`)
      );
      expect(model).not.toMatch(new RegExp(`\\n\\s+${spec.legacy}\\s+\\w`));
    }
  });

  it("KWD 3. hanesi ve 10^8 üstü IDR tutarı kayıpsız saklanır", () => {
    const kwd = money(toMinor("1234.567", "KWD"), "KWD");
    expect(toDecimalString(money(minorFromDb(minorToDb(kwd.amount)), "KWD"))).toBe("1234.567");
    // 250.000.000,00 IDR — Decimal(10,2) sınırını (99.999.999,99) aşar.
    const idr = toMinor("250000000.00", "IDR");
    expect(minorFromDb(minorToDb(idr))).toBe(25_000_000_000);
  });

  it("expand/contract migration'ları ayrı; contract eski ondalık kolonları düşürür", () => {
    const dirs = readdirSync(path.resolve("prisma/migrations"));
    const expand = dirs.find((d) => d.endsWith("_money_minor_expand"));
    const contract = dirs.find((d) => d.endsWith("_money_minor_contract"));
    expect(expand && contract && expand < contract).toBe(true);
    const contractSql = readFileSync(
      path.resolve("prisma/migrations", contract!, "migration.sql"),
      "utf8"
    );
    for (const spec of MONEY_COLUMNS) {
      expect(contractSql).toContain(`DROP COLUMN "${spec.legacy}"`);
    }
  });
});
