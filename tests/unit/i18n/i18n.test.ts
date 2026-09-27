import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFormatter, intlLocale } from "@/lib/i18n/format";
import { checkMessagesDir, compareLocales, flattenKeys, placeholders } from "@/lib/i18n/check";
import { NAMESPACES, loadMessages } from "@/i18n/messages";
import { negotiateLocale, resolveRequestLocale } from "@/i18n/config";

describe("P1-12 i18n biçimlendirme (Intl)", () => {
  it("arayüz dili BCP-47 etiketine eşlenir; bilinmeyen dil tr'ye düşer", () => {
    expect(intlLocale("tr")).toBe("tr-TR");
    expect(intlLocale("en")).toBe("en-US");
    expect(intlLocale("de")).toBe("tr-TR");
  });

  it("para: minor-unit tamsayı dile göre biçimlenir, hesap yapılmaz", () => {
    const tr = createFormatter("tr");
    const en = createFormatter("en");
    expect(tr.money(123456, "TRY")).toBe(
      new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(1234.56)
    );
    expect(en.money(123456, "USD")).toBe("$1,234.56");
    expect(en.money(150000, "EUR")).toBe("€1,500.00");
    expect(en.money(12.5, "USD")).toBe("12.5 USD");
    expect(en.money(100, "XXX")).toBe("100 XXX");
    expect(en.decimal("1500.00", "EUR")).toBe("€1,500.00");
    expect(en.decimal("abc", "EUR")).toBe("abc EUR");
  });

  it("tarih: salt tarih UTC gün olarak yorumlanır (gün kaymaz); dile göre biçim", () => {
    const tr = createFormatter("tr");
    const en = createFormatter("en");
    expect(tr.date("2026-09-24")).toBe("24.09.2026");
    expect(en.date("2026-09-24")).toBe("09/24/2026");
    expect(en.date("2026-09-24", "long")).toBe("September 24, 2026");
    expect(tr.date("2026-09-24", "long")).toBe("24 Eylül 2026");
    expect(en.date("2026-09-24", "medium")).toBe("Sep 24, 2026");
    expect(tr.date("geçersiz")).toBe("geçersiz");
    expect(en.date(new Date("2026-01-02T23:30:00Z"), "short", "Asia/Tokyo")).toBe("01/03/2026");
  });

  it("saat ve tarih-saat saat dilimine göre", () => {
    const en = createFormatter("en");
    const tr = createFormatter("tr");
    expect(tr.time("2026-09-24T10:05:00Z", "Europe/Istanbul")).toBe("13:05");
    expect(en.dateTime("2026-09-24T10:05:00Z", "UTC")).toBe("9/24/26, 10:05 AM");
    expect(en.time("x")).toBe("x");
    expect(en.dateTime("x")).toBe("x");
    expect(en.number(1234.5)).toBe("1,234.5");
    expect(tr.number(0.25, { style: "percent" })).toBe(
      new Intl.NumberFormat("tr-TR", { style: "percent" }).format(0.25)
    );
  });
});

describe("P1-12 i18n anahtar denetimi", () => {
  it("regression: v3#20 tr/en ad alanları ve anahtarlar birebir eşit (gerçek mesaj dosyaları)", async () => {
    expect(checkMessagesDir(path.resolve("messages"), NAMESPACES)).toEqual([]);
    const [tr, en] = await Promise.all([loadMessages("tr"), loadMessages("en")]);
    expect(Object.keys(tr).sort()).toEqual([...NAMESPACES].sort());
    for (const ns of NAMESPACES) {
      expect([...flattenKeys(en[ns] as never).keys()].sort()).toEqual(
        [...flattenKeys(tr[ns] as never).keys()].sort()
      );
    }
  });

  it("ICU yer tutucuları: iç içe plural gövdesi sayılmaz", () => {
    expect(placeholders("{count, plural, one {# gece} other {# gece {x}}} · {name}")).toEqual([
      "count",
      "name",
    ]);
    expect(placeholders("düz metin")).toEqual([]);
  });

  it("eksik anahtar, boş metin ve farklı yer tutucu yakalanır", () => {
    const issues = compareLocales(
      "ns",
      { a: "A {n}", b: { c: "C" }, e: "" },
      { a: "A {m}", d: "D", e: "E" }
    );
    const problems = issues.map((i) => `${i.key}:${i.problem}`);
    expect(problems).toContain("a:yer tutucular farklı: {n} ≠ {m}");
    expect(problems).toContain("b.c:en içinde eksik");
    expect(problems).toContain("d:tr içinde eksik");
    expect(problems).toContain("e:tr metni boş");
  });

  it("dizin ile NAMESPACES listesi uyuşmazsa hata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-"));
    fs.mkdirSync(path.join(root, "tr"));
    fs.mkdirSync(path.join(root, "en"));
    fs.writeFileSync(path.join(root, "tr", "a.json"), '{"k":"v"}');
    fs.writeFileSync(path.join(root, "en", "a.json"), '{"k":"v", "x": ""}');
    fs.writeFileSync(path.join(root, "en", "extra.json"), "{}");
    const issues = checkMessagesDir(root, ["a", "b"]);
    const problems = issues.map((i) => i.problem);
    expect(problems).toContain("tr/b.json yok");
    expect(problems).toContain("en/extra.json NAMESPACES listesinde yok");
    expect(problems).toContain("tr içinde eksik");
    expect(problems).toContain("en metni boş");
    expect(checkMessagesDir(path.join(root, "nope"), ["a"]).length).toBe(2);
  });
});

describe("v2-P1-3 Accept-Language dil müzakeresi", () => {
  it("başlık yoksa ya da boşsa varsayılan tr", () => {
    expect(negotiateLocale(undefined)).toBe("tr");
    expect(negotiateLocale(null)).toBe("tr");
    expect(negotiateLocale("")).toBe("tr");
  });

  it("bölge alt etiketi ana dile eşlenir; büyük/küçük harf duyarsız", () => {
    expect(negotiateLocale("en-GB,en;q=0.9,tr;q=0.5")).toBe("en");
    expect(negotiateLocale("EN-us")).toBe("en");
    expect(negotiateLocale("tr-TR,tr;q=0.9,en;q=0.8")).toBe("tr");
  });

  it("desteklenmeyen dil tr'ye düşer", () => {
    expect(negotiateLocale("ja-JP")).toBe("tr");
    expect(negotiateLocale("ja-JP,ja;q=0.9,de;q=0.8")).toBe("tr");
  });

  it("q-değerleri sırayı belirler; eşit q'da başlıktaki sıra", () => {
    expect(negotiateLocale("tr;q=0.4,en;q=0.8")).toBe("en");
    expect(negotiateLocale("de,tr;q=0.5,en;q=0.7")).toBe("en");
    expect(negotiateLocale("en;q=0.5,tr;q=0.5")).toBe("en");
    expect(negotiateLocale("ja,en;q=0.1")).toBe("en");
  });

  it("q=0 dili dışlar", () => {
    expect(negotiateLocale("en;q=0")).toBe("tr");
    expect(negotiateLocale("en-GB,en;q=0")).toBe("tr");
    expect(negotiateLocale("tr;q=0,en;q=0.1")).toBe("en");
  });

  it("joker (*) anılmamış ve dışlanmamış ilk desteklenen dile eşlenir", () => {
    expect(negotiateLocale("*")).toBe("tr");
    expect(negotiateLocale("ja,*;q=0.5")).toBe("tr");
    expect(negotiateLocale("tr;q=0,*")).toBe("en");
    expect(negotiateLocale("tr;q=0.1,*;q=0.5")).toBe("en");
    expect(negotiateLocale("*;q=0")).toBe("tr");
  });

  it("bozuk başlık ve girdiler yok sayılır", () => {
    expect(negotiateLocale(",,;")).toBe("tr");
    expect(negotiateLocale("en;q=abc")).toBe("tr");
    expect(negotiateLocale("en;q=1.5,ja")).toBe("tr");
    expect(negotiateLocale("en;q=-1")).toBe("tr");
    expect(negotiateLocale("<script>,en_US")).toBe("tr");
    expect(negotiateLocale("en-, ;q=0.9")).toBe("tr");
    expect(negotiateLocale("garbage===;;, en;q=0.3")).toBe("en");
    expect(negotiateLocale(" en ; q = 0.8 ")).toBe("en");
    expect(negotiateLocale("x".repeat(5000))).toBe("tr");
  });

  it("açık çerez seçimi Accept-Language'i her zaman ezer; geçersiz çerez müzakereye bırakır", () => {
    expect(resolveRequestLocale("tr", "en-US,en;q=0.9")).toBe("tr");
    expect(resolveRequestLocale("en", "tr-TR")).toBe("en");
    expect(resolveRequestLocale(undefined, "en-GB,en;q=0.9,tr;q=0.5")).toBe("en");
    expect(resolveRequestLocale(undefined, "ja-JP")).toBe("tr");
    expect(resolveRequestLocale("de", "en")).toBe("en");
    expect(resolveRequestLocale("", null)).toBe("tr");
  });
});
