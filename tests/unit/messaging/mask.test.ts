import { describe, it, expect } from "vitest";
import { maskMessage, MASK_LABEL } from "@/lib/messaging/mask";

describe("P1-6 mesaj maskeleme", () => {
  it.each([
    ["Beni 0532 123 45 67 den arayın", "PHONE"],
    ["WhatsApp: +90 555 444 33 22", "PHONE"],
    ["Call me +44 20 7946 0958", "PHONE"],
    ["Mail: ali.veli@example.com", "EMAIL"],
    ["IBAN TR33 0006 1005 1978 6457 8413 26 hesabına", "IBAN"],
    ["IBAN DE89370400440532013000 please", "IBAN"],
    ["Detaylar https://evil.example/pay?x=1 adresinde", "URL"],
    ["www.kiralik-ev.net üzerinden yazın", "URL"],
    ["wa.me/905551112233", "URL"],
    ["Kart 4242 4242 4242 4242", "CARD"],
    ["TC 10000000146", "TCKN"],
  ] as const)("%s → %s maskelenir", (input, kind) => {
    const r = maskMessage(input);
    expect(r.kinds).toContain(kind);
    expect(r.text).toContain(MASK_LABEL[kind]);
  });

  it("maskeli metinde ham değer kalmaz", () => {
    const r = maskMessage("0532 123 45 67 / a@b.co / https://x.io");
    expect(r.text).not.toMatch(/0532|a@b\.co|x\.io/);
    expect(new Set(r.kinds)).toEqual(new Set(["PHONE", "EMAIL", "URL"]));
  });

  it("zararsız metin ve kısa sayılar değişmez", () => {
    const text = "Saat 15:00'te geliyoruz, 2 yetişkin 1 çocuk, oda 204. Teşekkürler!";
    expect(maskMessage(text)).toEqual({ text, kinds: [] });
  });

  it("kısa rezervasyon kodu kart/telefon sayılmaz", () => {
    expect(maskMessage("Rezervasyon kodu 1234-5678").kinds).toEqual([]);
  });
});
