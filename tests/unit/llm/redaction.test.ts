import { describe, it, expect } from "vitest";
import { Redactor, isLuhnValid, isValidTckn, redactText } from "@/lib/llm/redaction";

// Sentetik, checksum'ı geçerli TCKN ve Luhn-geçerli test kart numarası.
const TCKN = "10000000146";
const CARD = "4111 1111 1111 1111";

describe("KVKK redaksiyonu", () => {
  it("TCKN checksum doğrulaması", () => {
    expect(isValidTckn(TCKN)).toBe(true);
    expect(isValidTckn("10000000147")).toBe(false);
    expect(isValidTckn("01234567890")).toBe(false);
  });

  it("Luhn doğrulaması", () => {
    expect(isLuhnValid("4111111111111111")).toBe(true);
    expect(isLuhnValid("4111111111111112")).toBe(false);
  });

  it("pozitif: TCKN, IBAN, telefon, e-posta, kart ve ad maskelenir", () => {
    const r = new Redactor(["Ayşe Yılmaz"]);
    const input = `Ben Ayşe Yılmaz, TC ${TCKN}, IBAN TR33 0006 1005 1978 6457 8413 26, tel +90 532 123 45 67, e-posta ayse@example.com, kart ${CARD}.`;
    const out = r.redact(input);
    expect(out).not.toContain("Ayşe Yılmaz");
    expect(out).not.toContain(TCKN);
    expect(out).not.toContain("TR33");
    expect(out).not.toContain("532 123");
    expect(out).not.toContain("ayse@example.com");
    expect(out).not.toContain("4111");
    for (const label of [
      "<KISI_1>",
      "<TCKN_1>",
      "<IBAN_1>",
      "<TELEFON_1>",
      "<EPOSTA_1>",
      "<KART_1>",
    ]) {
      expect(out).toContain(label);
    }
  });

  it("telefon varyantları: 0532…, 532…", () => {
    expect(redactText("ara 05321234567")).toBe("ara <TELEFON_1>");
    expect(redactText("ara 532 123 4567")).toBe("ara <TELEFON_1>");
  });

  it("negatif: fiyat, tarih, geçersiz TCKN ve Luhn'suz uzun sayı korunur", () => {
    const text =
      "Gecelik 3500 TL, 2026-05-01 tarihinde, kod 12345678901, sipariş 4111111111111112.";
    expect(redactText(text)).toBe(text);
  });

  it("aynı değer aynı takma ada, restore geri çevirir", () => {
    const r = new Redactor(["Mehmet Kaya"]);
    const out = r.redact("mehmet kaya ve Mehmet Kaya; x@y.co ile x@y.co");
    expect(out).toBe("<KISI_1> ve <KISI_1>; <EPOSTA_1> ile <EPOSTA_1>");
    expect(r.restore("Merhaba <KISI_1>")).toBe("Merhaba mehmet kaya");
    expect(r.restoreDeep({ a: ["<EPOSTA_1>"], b: 3 })).toEqual({ a: ["x@y.co"], b: 3 });
  });

  it("ad eşleşmesi kelime sınırına duyarlı", () => {
    expect(redactText("Denizli ve Deniz Ak", ["Deniz Ak"])).toBe("Denizli ve <KISI_1>");
  });
});
