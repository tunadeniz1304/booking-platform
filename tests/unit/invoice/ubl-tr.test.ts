import { describe, expect, it } from "vitest";
import {
  TAX_CODES,
  UblValidationError,
  buildEArchiveInvoiceXml,
  computeUblTotals,
  formatMinor,
  type EArchiveInvoiceInput,
} from "@/lib/invoice/ubl-tr";
import { MockEInvoiceIntegrator } from "@/lib/invoice/e-invoice-integrator";

/**
 * P1-13c UBL-TR 1.2 e-Arşiv: GİB XSD/Schematron dosyaları repoda yok (lisans/dağıtım
 * belirsiz — docs/compliance/UBL-TR.md), bu yüzden yapısal snapshot + kurallı kontroller.
 */

const base = (): EArchiveInvoiceInput => ({
  uuid: "3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b",
  invoiceNumber: "BKG2026000000042",
  issueDate: "2026-06-15",
  issueTime: "14:30:00",
  currency: "TRY",
  supplier: {
    taxId: "1234567890",
    name: "Demo Konaklama A.Ş.",
    taxOffice: "Kadıköy",
    street: "Moda Cad. No:1",
    district: "Kadıköy",
    city: "İstanbul",
    postalZone: "34710",
    country: "Türkiye",
    email: "fatura@demo.test",
  },
  customer: {
    taxId: "11111111111",
    firstName: "Ayşe",
    familyName: "Yılmaz & Co <test>",
    city: "Ankara",
    country: "Türkiye",
  },
  lines: [
    {
      name: "Konaklama — Deniz manzaralı oda",
      description: "2026-06-15 → 2026-06-18",
      quantity: 3,
      unitCode: "DAY",
      unitPriceMinor: 100_000,
      lineExtensionMinor: 300_000,
      taxes: [
        { ...TAX_CODES.VAT, rateBps: 1000, taxableMinor: 300_000, amountMinor: 30_000 },
        { ...TAX_CODES.ACCOMMODATION, rateBps: 100, taxableMinor: 300_000, amountMinor: 3_000 },
      ],
    },
    {
      name: "Kahvaltı",
      quantity: 2,
      unitCode: "C62",
      unitPriceMinor: BigInt(12_550),
      lineExtensionMinor: BigInt(25_100),
      taxes: [{ ...TAX_CODES.VAT, rateBps: 1000, taxableMinor: 25_100, amountMinor: 2_510 }],
    },
  ],
  notes: ["Yalnız üç bin altı yüz altı TL on kuruştur."],
  internetSale: {
    website: "https://booking.demo.test",
    paymentMethod: "KREDIKARTI/BANKAKARTI",
    paymentDate: "2026-06-15",
  },
});

/** Etiket dengesi (bağımlılıksız iyi biçimlilik kontrolü). */
function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing) continue;
    if (closing) expect(stack.pop()).toBe(name);
    else stack.push(name);
  }
  expect(stack).toEqual([]);
}

describe("P1-13c UBL-TR 1.2 e-Arşiv üretici", () => {
  it("yapısal snapshot (deterministik çıktı)", () => {
    const xml = buildEArchiveInvoiceXml(base());
    expect(buildEArchiveInvoiceXml(base())).toBe(xml);
    assertWellFormed(xml);
    expect(xml).toMatchSnapshot();
  });

  it("zorunlu UBL-TR başlık alanları doğru sırada", () => {
    const xml = buildEArchiveInvoiceXml(base());
    const order = [
      "<ext:UBLExtensions>",
      "<cbc:UBLVersionID>2.1<",
      "<cbc:CustomizationID>TR1.2<",
      "<cbc:ProfileID>EARSIVFATURA<",
      "<cbc:ID>BKG2026000000042<",
      "<cbc:CopyIndicator>false<",
      "<cbc:UUID>3F2B8C1E-5D4A-4B6F-9A7E-1C2D3E4F5A6B<",
      "<cbc:IssueDate>2026-06-15<",
      "<cbc:InvoiceTypeCode>SATIS<",
      "<cbc:DocumentCurrencyCode>TRY<",
      "<cbc:LineCountNumeric>2<",
      "<cac:AdditionalDocumentReference>",
      "<cac:Signature>",
      "<cac:AccountingSupplierParty>",
      "<cac:AccountingCustomerParty>",
      "<cac:TaxTotal>",
      "<cac:LegalMonetaryTotal>",
      "<cac:InvoiceLine>",
    ];
    const idx = order.map((s) => xml.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("toplamlar minor-unit tamsayıdan: matrah + KDV + konaklama vergisi", () => {
    const xml = buildEArchiveInvoiceXml(base());
    expect(xml).toContain(
      '<cbc:LineExtensionAmount currencyID="TRY">3251.00</cbc:LineExtensionAmount>'
    );
    expect(xml).toContain(
      '<cbc:TaxInclusiveAmount currencyID="TRY">3606.10</cbc:TaxInclusiveAmount>'
    );
    expect(xml).toContain('<cbc:PayableAmount currencyID="TRY">3606.10</cbc:PayableAmount>');
    // KDV satırları tek alt toplamda birleşir (0015, %10), konaklama vergisi ayrı (0059, %1).
    expect(xml).toContain("<cbc:TaxTypeCode>0059</cbc:TaxTypeCode>");
    expect(xml).toMatch(
      /<cbc:TaxableAmount currencyID="TRY">3251\.00<\/cbc:TaxableAmount>\s*<cbc:TaxAmount currencyID="TRY">325\.10<\/cbc:TaxAmount>\s*<cbc:Percent>10<\/cbc:Percent>/
    );
    expect(xml).toContain("<cbc:Percent>1</cbc:Percent>");
    const totals = computeUblTotals(base().lines);
    expect(totals.taxTotal).toBe(BigInt(35_510));
    expect(totals.groups).toHaveLength(2);
  });

  it("gerçek kişi alıcı TCKN + Person; metinler XML-escape", () => {
    const xml = buildEArchiveInvoiceXml(base());
    expect(xml).toContain('<cbc:ID schemeID="TCKN">11111111111</cbc:ID>');
    expect(xml).toContain('<cbc:ID schemeID="VKN">1234567890</cbc:ID>');
    expect(xml).toContain("<cbc:FamilyName>Yılmaz &amp; Co &lt;test&gt;</cbc:FamilyName>");
  });

  it("formatMinor: tamsayı → ondalık, üs 0 ve negatif", () => {
    expect(formatMinor(5)).toBe("0.05");
    expect(formatMinor(BigInt("900719925474099312"))).toBe("9007199254740993.12");
    expect(formatMinor(1500, 0)).toBe("1500");
    expect(formatMinor(-1234)).toBe("-12.34");
    expect(() => formatMinor(12.5)).toThrow(UblValidationError);
  });

  it("geçersiz girdiler reddedilir", () => {
    const bad: Array<Partial<EArchiveInvoiceInput>> = [
      { uuid: "x" },
      { invoiceNumber: "BKG26" },
      { invoiceNumber: "BKG2025000000042" },
      { currency: "try" },
      { lines: [] },
      { customer: { taxId: "123", city: "A", country: "TR" } },
      { customer: { taxId: "11111111111", city: "A", country: "TR" } },
      { supplier: { taxId: "1234567890", city: "A", country: "TR" } },
    ];
    for (const b of bad) {
      expect(() => buildEArchiveInvoiceXml({ ...base(), ...b })).toThrow(UblValidationError);
    }
    const floaty = base();
    floaty.lines[0].lineExtensionMinor = 3000.5;
    expect(() => buildEArchiveInvoiceXml(floaty)).toThrow(UblValidationError);
  });
});

describe("P1-13c EInvoiceIntegrator (mock)", () => {
  it("gönderim → ACCEPTED, idempotent, durum ve iptal", async () => {
    const integrator = new MockEInvoiceIntegrator();
    const input = base();
    const xml = buildEArchiveInvoiceXml(input);
    const doc = {
      uuid: input.uuid,
      invoiceNumber: input.invoiceNumber,
      profile: "EARSIVFATURA" as const,
      xml,
    };
    const first = await integrator.submit(doc);
    expect(first.status).toBe("ACCEPTED");
    expect(await integrator.submit(doc)).toEqual(first);
    expect(await integrator.status(input.uuid)).toEqual(first);
    await expect(integrator.cancel(input.uuid, " ")).rejects.toMatchObject({
      code: "REASON_REQUIRED",
    });
    expect((await integrator.cancel(input.uuid, "Müşteri iptali")).status).toBe("CANCELLED");
    await expect(integrator.cancel(input.uuid, "tekrar")).rejects.toMatchObject({
      code: "NOT_CANCELLABLE",
    });
    await expect(integrator.cancel("yok", "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await integrator.status("yok")).toBeNull();
  });

  it("yapısal uyuşmazlık → REJECTED", async () => {
    const integrator = new MockEInvoiceIntegrator();
    const input = base();
    const xml = buildEArchiveInvoiceXml(input);
    const cases = [
      {
        uuid: "11111111-1111-4111-8111-111111111111",
        invoiceNumber: input.invoiceNumber,
        profile: "EARSIVFATURA" as const,
        xml,
        code: "UUID",
      },
      {
        uuid: "22222222-2222-4222-8222-222222222222",
        invoiceNumber: input.invoiceNumber,
        profile: "EARSIVFATURA" as const,
        xml: "<x/>",
        code: "SCHEMA",
      },
      {
        uuid: "33333333-3333-4333-8333-333333333333",
        invoiceNumber: input.invoiceNumber,
        profile: "TICARIFATURA" as const,
        xml,
        code: "PROFILE",
      },
    ];
    for (const { code, ...doc } of cases) {
      const r = await integrator.submit(doc);
      expect(r.status).toBe("REJECTED");
      expect(r.error?.code).toBe(code);
    }
    const wrongNo = await integrator.submit({
      uuid: input.uuid,
      invoiceNumber: "BKG2026000000001",
      profile: "EARSIVFATURA",
      xml,
    });
    expect(wrongNo.error?.code).toBe("NUMBER");
  });
});
