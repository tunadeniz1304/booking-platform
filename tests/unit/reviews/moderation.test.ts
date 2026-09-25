import { describe, expect, it } from "vitest";
import { moderateText } from "@/lib/reviews/moderation";
import { demoModerationExplain } from "@/lib/llm/demo";

describe("P1-7 deterministik yorum filtresi", () => {
  it.each([
    ["Tam bir SALAK ev sahibi", "PROFANITY"],
    ["Şerefsizler parayı iade etmedi", "PROFANITY"],
    ["What a shitty place", "PROFANITY"],
    ["Beni 0532 123 45 67 den arayın", "PII_PHONE"],
    ["Yazın: ali@example.com", "PII_EMAIL"],
    ["Daha ucuzu www.kiralik-ev.net adresinde", "PII_URL"],
  ] as const)("%s → %s", (text, code) => {
    expect(moderateText(text).map((r) => r.code)).toContain(code);
  });

  it("zararsız metin ve alt-kelime eşleşmeleri işaretlenmez", () => {
    expect(moderateText("Oda tertemizdi, konum harika, personel çok ilgiliydi.")).toEqual([]);
    // kısaltmalar ("aq") yalnızca tam kelimeyken işaretlenir
    expect(moderateText("Aquapark ve plaj çok yakındı")).toEqual([]);
    expect(moderateText(null)).toEqual([]);
    expect(moderateText("")).toEqual([]);
  });

  it("birden çok gerekçe birlikte döner; demo açıklama gerekçeleri ifade eder", () => {
    const reasons = moderateText("Amk, bana a@b.co adresinden yazın");
    expect(reasons.map((r) => r.code)).toEqual(["PROFANITY", "PII_EMAIL"]);
    const { explanation } = demoModerationExplain(reasons);
    expect(explanation).toContain("E-posta");
    expect(explanation).toContain("yöneticiye");
    expect(demoModerationExplain([]).explanation).toMatch(/gerekçe/);
  });
});
