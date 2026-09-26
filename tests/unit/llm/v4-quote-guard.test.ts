import { describe, it, expect } from "vitest";
import {
  GuardError,
  assertClaimQuoted,
  buildFactSet,
  filterQuotedClaims,
  locateQuote,
} from "@/lib/llm/guards";

/**
 * v4 P1-9 alıntı span guard'ı: yorum öne çıkanlarındaki her iddia kaynak yorumdan
 * BİREBİR alıntı taşımalı; alıntısız veya uydurma alıntılı iddia reddedilir.
 */
const sources = [
  { id: "r1", text: "Oda tertemizdi ve yatak çok rahattı. Kahvaltı  ise vasattı." },
  { id: "r2", text: "Konum harika, metroya 5 dakika. Personel güler yüzlüydü." },
];

describe("locateQuote", () => {
  it("birebir alıntıyı özgün aralığıyla bulur", () => {
    const hit = locateQuote("yatak çok rahattı", sources[0].text);
    expect(hit).not.toBeNull();
    expect(sources[0].text.slice(hit!.start, hit!.end)).toBe("yatak çok rahattı");
  });

  it("yalnızca boşluk farkını tolere eder; özgün metni döndürür", () => {
    const hit = locateQuote("Kahvaltı ise   vasattı.", sources[0].text);
    expect(hit).not.toBeNull();
    expect(sources[0].text.slice(hit!.start, hit!.end)).toBe("Kahvaltı  ise vasattı.");
  });

  it("harf/sözcük değişikliği, büyük-küçük harf farkı ve boş alıntı eşleşmez", () => {
    expect(locateQuote("yatak cok rahattı", sources[0].text)).toBeNull();
    expect(locateQuote("Yatak çok rahattı", sources[0].text)).toBeNull();
    expect(locateQuote("yatak son derece rahattı", sources[0].text)).toBeNull();
    expect(locateQuote("   ", sources[0].text)).toBeNull();
  });
});

describe("filterQuotedClaims", () => {
  const facts = buildFactSet(sources.map((s) => s.text));

  it("alıntısız iddia reddedilir", () => {
    const res = filterQuotedClaims([{ text: "Oda temiz", quote: "" }], sources);
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected[0].reason).toBe("missing_quote");
  });

  it("uydurma alıntılı iddia reddedilir; gerçek alıntılı iddia kabul edilir", () => {
    const res = filterQuotedClaims(
      [
        { text: "Oda çok temiz", quote: "Oda tertemizdi", sourceId: "r1" },
        { text: "Havuz büyük", quote: "Havuz çok büyüktü", sourceId: "r1" },
      ],
      sources,
      { facts }
    );
    expect(res.accepted.map((c) => c.text)).toEqual(["Oda çok temiz"]);
    expect(res.accepted[0]).toMatchObject({ sourceId: "r1", start: 0, end: 14 });
    expect(res.rejected).toEqual([
      { claim: expect.objectContaining({ text: "Havuz büyük" }), reason: "quote_not_found" },
    ]);
  });

  it("alıntı başka bir yorumdaysa (yanlış kaynak) reddedilir; kaynak verilmezse hepsinde aranır", () => {
    const wrong = filterQuotedClaims(
      [{ text: "Konum iyi", quote: "Konum harika", sourceId: "r1" }],
      sources
    );
    expect(wrong.rejected[0].reason).toBe("quote_not_found");
    const any = filterQuotedClaims([{ text: "Konum iyi", quote: "Konum harika" }], sources);
    expect(any.accepted[0].sourceId).toBe("r2");
  });

  it("bilinmeyen kaynak kimliği ve çok kısa alıntı reddedilir", () => {
    const res = filterQuotedClaims(
      [
        { text: "a", quote: "Konum harika", sourceId: "r999" },
        { text: "b", quote: "Oda", sourceId: "r1" },
      ],
      sources,
      { minQuoteLength: 8 }
    );
    expect(res.rejected.map((r) => r.reason)).toEqual(["unknown_source", "quote_too_short"]);
  });

  it("sayı guard'ı: iddia metnindeki sayı kaynakta yoksa alıntı doğru olsa da reddedilir", () => {
    const res = filterQuotedClaims(
      [
        { text: "Metroya 5 dakika", quote: "metroya 5 dakika", sourceId: "r2" },
        { text: "Metroya 3 dakika", quote: "metroya 5 dakika", sourceId: "r2" },
      ],
      sources,
      { facts }
    );
    expect(res.accepted.map((c) => c.text)).toEqual(["Metroya 5 dakika"]);
    expect(res.rejected[0].reason).toBe("ungrounded_number");
  });
});

describe("assertClaimQuoted", () => {
  it("geçerli alıntıda span döner, uydurmada GuardError(ungrounded_quote)", () => {
    expect(assertClaimQuoted({ text: "x", quote: "Personel güler yüzlüydü." }, sources)).toEqual({
      sourceId: "r2",
      start: 32,
      end: 56,
    });
    try {
      assertClaimQuoted({ text: "x", quote: "Personel kabaydı" }, sources);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GuardError);
      expect((e as GuardError).code).toBe("ungrounded_quote");
    }
  });
});
