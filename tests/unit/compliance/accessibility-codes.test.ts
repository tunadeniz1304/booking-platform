import { describe, it, expect } from "vitest";
import { AccessibilityCode } from "@prisma/client";
import {
  ACCESSIBILITY_CODES,
  isAccessibilityCode,
  parseAccessibilityParam,
} from "@/lib/compliance/accessibility-codes";
import { accessibilityWhere } from "@/lib/search/accessibility-filter";
import { SearchParamsSchema, searchParamsFromUrl } from "@/lib/search/params";

describe("P1-13(e) erişilebilirlik kodları", () => {
  it("istemci listesi Prisma enum'u ile birebir aynı", () => {
    expect([...ACCESSIBILITY_CODES].sort()).toEqual(Object.values(AccessibilityCode).sort());
  });

  it("URL değeri: büyük harf, tekil, sıralı; bilinmeyen ayrı döner", () => {
    expect(parseAccessibilityParam(" elevator,ROLL_IN_SHOWER,elevator,,nope ")).toEqual({
      codes: ["ELEVATOR", "ROLL_IN_SHOWER"],
      invalid: ["nope"],
    });
    expect(parseAccessibilityParam(null)).toEqual({ codes: [], invalid: [] });
    expect(isAccessibilityCode("GRAB_BARS")).toBe(true);
    expect(isAccessibilityCode("grab_bars")).toBe(false);
  });

  it("arama parametresi: küçük harf kabul, bilinmeyen kod reddedilir", () => {
    const ok = SearchParamsSchema.parse(
      searchParamsFromUrl(new URLSearchParams("accessibility=elevator,grab_bars"))
    );
    expect(ok.accessibility).toEqual(["ELEVATOR", "GRAB_BARS"]);
    expect(
      SearchParamsSchema.safeParse(searchParamsFromUrl(new URLSearchParams("accessibility=X")))
        .success
    ).toBe(false);
    expect(
      SearchParamsSchema.parse(searchParamsFromUrl(new URLSearchParams(""))).accessibility
    ).toBeUndefined();
  });

  it("filtre: boşsa koşul yok; her kod aynı oda tipinde (veya ilan düzeyinde) doğrulanmış olmalı", () => {
    expect(accessibilityWhere([])).toBeNull();
    const where = accessibilityWhere(["ELEVATOR", "GRAB_BARS"], 3);
    const some = (where as { rooms: { some: Record<string, unknown> } }).rooms.some;
    expect(some).toMatchObject({ available: true, maxOccupancy: { gte: 3 } });
    const and = some.AND as Array<{ OR: unknown[] }>;
    expect(and).toHaveLength(2);
    expect(JSON.stringify(and[0])).toContain('"verifiedAt":{"not":null}');
    expect(JSON.stringify(and[0])).toContain('"roomTypeId":null');
  });
});
