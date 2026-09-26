/**
 * P1-13c — UBL-TR 1.2 e-Arşiv fatura XML üreticisi (GİB e-Arşiv, `EARSIVFATURA` profili).
 *
 * Saf ve deterministik: aynı girdi → bayt bayt aynı XML. Bağımlılık yok (string şablon,
 * tüm metinler XML-escape). Tutarlar MINOR-UNIT TAMSAYI (`number` güvenli tamsayı ya da
 * `bigint`) olarak gelir; ondalık gösterim yalnızca burada, para birimi üssüyle üretilir —
 * kayan nokta aritmetiği yoktur. Para modülünden bağımsızdır (çağıran minor-unit verir).
 *
 * Toplamlar satırlardan hesaplanır: LineExtension = Σ satır matrahı, TaxInclusive =
 * matrah + Σ vergi, Payable = TaxInclusive. Vergi toplamı (kod, oran) çiftine göre gruplanır.
 * KDV kodu 0015, konaklama vergisi 0059 (GİB vergi kod listesi).
 *
 * İmza (XAdES) ve GİB'e iletim özel entegratörün işidir (`e-invoice-integrator.ts`):
 * `ext:ExtensionContent` imza için boş bırakılır. XSD doğrulaması için bkz.
 * docs/compliance/UBL-TR.md (şema lisansı → yapısal snapshot testi).
 */

export type MinorAmount = number | bigint;

export const TAX_CODES = {
  VAT: { code: "0015", name: "KDV" },
  ACCOMMODATION: { code: "0059", name: "KONAKLAMA VERGİSİ" },
} as const;

export interface UblTax {
  /** GİB vergi kodu (ör. 0015 KDV, 0059 konaklama vergisi). */
  code: string;
  name: string;
  /** Yüzde oranı baz puan olarak (ör. %10 → 1000, %1 → 100). */
  rateBps: number;
  taxableMinor: MinorAmount;
  amountMinor: MinorAmount;
}

export interface UblLine {
  name: string;
  description?: string;
  quantity: number;
  /** UN/ECE birim kodu: gece için "DAY", adet için "C62". */
  unitCode: string;
  /** Vergiler hariç birim fiyat. */
  unitPriceMinor: MinorAmount;
  /** Vergiler hariç satır tutarı (matrah). */
  lineExtensionMinor: MinorAmount;
  taxes: UblTax[];
}

export interface UblParty {
  /** 10 haneli VKN ya da 11 haneli TCKN. */
  taxId: string;
  /** Tüzel kişi unvanı (VKN) — gerçek kişide firstName/familyName kullanılır. */
  name?: string;
  firstName?: string;
  familyName?: string;
  taxOffice?: string;
  street?: string;
  district?: string;
  city: string;
  postalZone?: string;
  country: string;
  email?: string;
}

export interface EArchiveInvoiceInput {
  /** RFC 4122 UUID (ETTN). */
  uuid: string;
  /** 16 karakter: 3 harf/rakam seri + 4 hane yıl + 9 hane sıra (ör. BKG2026000000001). */
  invoiceNumber: string;
  issueDate: string;
  issueTime: string;
  currency: string;
  /** Para biriminin ondalık basamak sayısı (TRY/EUR 2, JPY 0). */
  currencyExponent?: number;
  supplier: UblParty;
  customer: UblParty;
  lines: UblLine[];
  notes?: string[];
  /** e-Arşiv gönderim şekli. */
  sendingType?: "ELEKTRONIK" | "KAGIT";
  /** İnternet satışı bilgileri (e-Arşiv'de internet satışlarında zorunlu). */
  internetSale?: { website: string; paymentMethod: string; paymentDate: string };
}

export class UblValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UblValidationError";
  }
}

const INVOICE_NO_RE = /^[A-Z0-9]{3}\d{4}\d{9}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

function toBig(v: MinorAmount, field: string): bigint {
  if (typeof v === "bigint") return v;
  if (!Number.isSafeInteger(v)) throw new UblValidationError(`${field} tamsayı minor-unit olmalı`);
  return BigInt(v);
}

/** Minor-unit → "1234.50" (yalnız tamsayı işlemleri; negatif desteklenir). */
export function formatMinor(v: MinorAmount, exponent = 2): string {
  const n = toBig(v, "amount");
  const neg = n < BigInt(0);
  const abs = neg ? -n : n;
  if (exponent === 0) return `${neg ? "-" : ""}${abs}`;
  const base = BigInt(10) ** BigInt(exponent);
  const frac = (abs % base).toString().padStart(exponent, "0");
  return `${neg ? "-" : ""}${abs / base}.${frac}`;
}

/** Baz puan → yüzde metni (1000 → "10", 150 → "1.5"). */
function percent(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) throw new UblValidationError("rateBps geçersiz");
  const whole = Math.trunc(bps / 100);
  const frac = String(bps % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function schemeOf(taxId: string): "VKN" | "TCKN" {
  if (/^\d{10}$/.test(taxId)) return "VKN";
  if (/^\d{11}$/.test(taxId)) return "TCKN";
  throw new UblValidationError("VKN 10, TCKN 11 haneli olmalı");
}

function validate(input: EArchiveInvoiceInput): void {
  if (!UUID_RE.test(input.uuid)) throw new UblValidationError("uuid (ETTN) geçersiz");
  if (!INVOICE_NO_RE.test(input.invoiceNumber)) {
    throw new UblValidationError("Fatura no 16 karakter olmalı (SSSYYYYNNNNNNNNN)");
  }
  if (input.invoiceNumber.slice(3, 7) !== input.issueDate.slice(0, 4)) {
    throw new UblValidationError("Fatura no yılı düzenleme tarihiyle aynı olmalı");
  }
  if (!DATE_RE.test(input.issueDate) || !TIME_RE.test(input.issueTime)) {
    throw new UblValidationError("issueDate YYYY-AA-GG, issueTime SS:DD:ss olmalı");
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new UblValidationError("currency ISO 4217 olmalı");
  if (input.lines.length === 0) throw new UblValidationError("En az bir fatura satırı gerekli");
  for (const party of [input.supplier, input.customer]) {
    const scheme = schemeOf(party.taxId);
    if (scheme === "VKN" && !party.name)
      throw new UblValidationError("VKN'li tarafın unvanı zorunlu");
    if (scheme === "TCKN" && !(party.firstName && party.familyName)) {
      throw new UblValidationError("TCKN'li tarafın adı ve soyadı zorunlu");
    }
  }
  for (const line of input.lines) {
    if (!(line.quantity > 0)) throw new UblValidationError("Satır miktarı pozitif olmalı");
    for (const tax of line.taxes) {
      if (!/^\d{4}$/.test(tax.code)) throw new UblValidationError("Vergi kodu 4 hane olmalı");
    }
  }
}

interface Totals {
  lineExtension: bigint;
  taxTotal: bigint;
  taxInclusive: bigint;
  groups: Array<{ code: string; name: string; rateBps: number; taxable: bigint; amount: bigint }>;
}

export function computeUblTotals(lines: readonly UblLine[]): Totals {
  let lineExtension = BigInt(0);
  let taxTotal = BigInt(0);
  const groups = new Map<string, Totals["groups"][number]>();
  for (const line of lines) {
    lineExtension += toBig(line.lineExtensionMinor, "lineExtensionMinor");
    for (const tax of line.taxes) {
      const amount = toBig(tax.amountMinor, "amountMinor");
      const taxable = toBig(tax.taxableMinor, "taxableMinor");
      taxTotal += amount;
      const key = `${tax.code}:${tax.rateBps}`;
      const g = groups.get(key) ?? {
        code: tax.code,
        name: tax.name,
        rateBps: tax.rateBps,
        taxable: BigInt(0),
        amount: BigInt(0),
      };
      g.taxable += taxable;
      g.amount += amount;
      groups.set(key, g);
    }
  }
  return {
    lineExtension,
    taxTotal,
    taxInclusive: lineExtension + taxTotal,
    groups: [...groups.values()],
  };
}

const NS = [
  'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"',
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"',
  'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"',
  'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
  'xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"',
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
  'xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 UBL-Invoice-2.1.xsd"',
].join(" ");

/** Basit girintili eleman yazıcısı. */
class Xml {
  private readonly out: string[] = [];
  private depth = 0;
  open(tag: string, attrs = ""): this {
    this.out.push(`${"  ".repeat(this.depth)}<${tag}${attrs ? ` ${attrs}` : ""}>`);
    this.depth++;
    return this;
  }
  close(tag: string): this {
    this.depth--;
    this.out.push(`${"  ".repeat(this.depth)}</${tag}>`);
    return this;
  }
  leaf(tag: string, value: string | undefined, attrs = ""): this {
    if (value === undefined || value === "") return this;
    this.out.push(
      `${"  ".repeat(this.depth)}<${tag}${attrs ? ` ${attrs}` : ""}>${escapeXml(value)}</${tag}>`
    );
    return this;
  }
  empty(tag: string): this {
    this.out.push(`${"  ".repeat(this.depth)}<${tag}/>`);
    return this;
  }
  toString(): string {
    return this.out.join("\n");
  }
}

function party(x: Xml, wrapper: string, p: UblParty): void {
  const scheme = schemeOf(p.taxId);
  x.open(wrapper).open("cac:Party");
  x.open("cac:PartyIdentification").leaf("cbc:ID", p.taxId, `schemeID="${scheme}"`);
  x.close("cac:PartyIdentification");
  if (p.name) x.open("cac:PartyName").leaf("cbc:Name", p.name).close("cac:PartyName");
  x.open("cac:PostalAddress")
    .leaf("cbc:StreetName", p.street)
    .leaf("cbc:CitySubdivisionName", p.district ?? p.city)
    .leaf("cbc:CityName", p.city)
    .leaf("cbc:PostalZone", p.postalZone)
    .open("cac:Country")
    .leaf("cbc:Name", p.country)
    .close("cac:Country")
    .close("cac:PostalAddress");
  if (p.taxOffice) {
    x.open("cac:PartyTaxScheme").open("cac:TaxScheme").leaf("cbc:Name", p.taxOffice);
    x.close("cac:TaxScheme").close("cac:PartyTaxScheme");
  }
  if (p.email) x.open("cac:Contact").leaf("cbc:ElectronicMail", p.email).close("cac:Contact");
  if (scheme === "TCKN") {
    x.open("cac:Person").leaf("cbc:FirstName", p.firstName).leaf("cbc:FamilyName", p.familyName);
    x.close("cac:Person");
  }
  x.close("cac:Party").close(wrapper);
}

function taxSubtotal(
  x: Xml,
  cur: string,
  exp: number,
  t: { code: string; name: string; rateBps: number; taxable: bigint; amount: bigint }
): void {
  const amt = (v: bigint) => formatMinor(v, exp);
  x.open("cac:TaxSubtotal")
    .leaf("cbc:TaxableAmount", amt(t.taxable), `currencyID="${cur}"`)
    .leaf("cbc:TaxAmount", amt(t.amount), `currencyID="${cur}"`)
    .leaf("cbc:Percent", percent(t.rateBps))
    .open("cac:TaxCategory")
    .open("cac:TaxScheme")
    .leaf("cbc:Name", t.name)
    .leaf("cbc:TaxTypeCode", t.code)
    .close("cac:TaxScheme")
    .close("cac:TaxCategory")
    .close("cac:TaxSubtotal");
}

/** UBL-TR 1.2 e-Arşiv fatura XML'i (UTF-8, imzasız). */
export function buildEArchiveInvoiceXml(input: EArchiveInvoiceInput): string {
  validate(input);
  const cur = input.currency;
  const exp = input.currencyExponent ?? 2;
  const amt = (v: MinorAmount) => formatMinor(v, exp);
  const totals = computeUblTotals(input.lines);
  const x = new Xml();

  x.open("Invoice", NS);
  x.open("ext:UBLExtensions").open("ext:UBLExtension").empty("ext:ExtensionContent");
  x.close("ext:UBLExtension").close("ext:UBLExtensions");
  x.leaf("cbc:UBLVersionID", "2.1")
    .leaf("cbc:CustomizationID", "TR1.2")
    .leaf("cbc:ProfileID", "EARSIVFATURA")
    .leaf("cbc:ID", input.invoiceNumber)
    .leaf("cbc:CopyIndicator", "false")
    .leaf("cbc:UUID", input.uuid.toUpperCase())
    .leaf("cbc:IssueDate", input.issueDate)
    .leaf("cbc:IssueTime", input.issueTime)
    .leaf("cbc:InvoiceTypeCode", "SATIS");
  for (const note of input.notes ?? []) x.leaf("cbc:Note", note);
  x.leaf("cbc:DocumentCurrencyCode", cur).leaf("cbc:LineCountNumeric", String(input.lines.length));

  const docRef = (id: string, type: string) =>
    x
      .open("cac:AdditionalDocumentReference")
      .leaf("cbc:ID", id)
      .leaf("cbc:IssueDate", input.issueDate)
      .leaf("cbc:DocumentType", type)
      .close("cac:AdditionalDocumentReference");
  docRef(input.sendingType ?? "ELEKTRONIK", "GONDERIM_SEKLI");
  if (input.internetSale) {
    docRef(input.internetSale.website, "INTERNET_SATIS_WEB_ADRESI");
    docRef(input.internetSale.paymentMethod, "INTERNET_SATIS_ODEME_SEKLI");
    docRef(input.internetSale.paymentDate, "INTERNET_SATIS_ODEME_TARIHI");
  }

  x.open("cac:Signature")
    .leaf("cbc:ID", input.supplier.taxId, 'schemeID="VKN_TCKN"')
    .open("cac:SignatoryParty")
    .open("cac:PartyIdentification")
    .leaf("cbc:ID", input.supplier.taxId, `schemeID="${schemeOf(input.supplier.taxId)}"`)
    .close("cac:PartyIdentification")
    .close("cac:SignatoryParty")
    .open("cac:DigitalSignatureAttachment")
    .open("cac:ExternalReference")
    .leaf("cbc:URI", `#Signature_${input.invoiceNumber}`)
    .close("cac:ExternalReference")
    .close("cac:DigitalSignatureAttachment")
    .close("cac:Signature");

  party(x, "cac:AccountingSupplierParty", input.supplier);
  party(x, "cac:AccountingCustomerParty", input.customer);

  x.open("cac:TaxTotal").leaf("cbc:TaxAmount", amt(totals.taxTotal), `currencyID="${cur}"`);
  for (const g of totals.groups) taxSubtotal(x, cur, exp, g);
  x.close("cac:TaxTotal");

  x.open("cac:LegalMonetaryTotal")
    .leaf("cbc:LineExtensionAmount", amt(totals.lineExtension), `currencyID="${cur}"`)
    .leaf("cbc:TaxExclusiveAmount", amt(totals.lineExtension), `currencyID="${cur}"`)
    .leaf("cbc:TaxInclusiveAmount", amt(totals.taxInclusive), `currencyID="${cur}"`)
    .leaf("cbc:AllowanceTotalAmount", amt(0), `currencyID="${cur}"`)
    .leaf("cbc:PayableAmount", amt(totals.taxInclusive), `currencyID="${cur}"`)
    .close("cac:LegalMonetaryTotal");

  input.lines.forEach((line, i) => {
    const lineTax = line.taxes.reduce((s, t) => s + toBig(t.amountMinor, "amountMinor"), BigInt(0));
    x.open("cac:InvoiceLine")
      .leaf("cbc:ID", String(i + 1))
      .leaf("cbc:InvoicedQuantity", String(line.quantity), `unitCode="${escapeXml(line.unitCode)}"`)
      .leaf("cbc:LineExtensionAmount", amt(line.lineExtensionMinor), `currencyID="${cur}"`);
    x.open("cac:TaxTotal").leaf("cbc:TaxAmount", amt(lineTax), `currencyID="${cur}"`);
    for (const t of line.taxes) {
      taxSubtotal(x, cur, exp, {
        code: t.code,
        name: t.name,
        rateBps: t.rateBps,
        taxable: toBig(t.taxableMinor, "taxableMinor"),
        amount: toBig(t.amountMinor, "amountMinor"),
      });
    }
    x.close("cac:TaxTotal");
    x.open("cac:Item").leaf("cbc:Description", line.description).leaf("cbc:Name", line.name);
    x.close("cac:Item");
    x.open("cac:Price")
      .leaf("cbc:PriceAmount", amt(line.unitPriceMinor), `currencyID="${cur}"`)
      .close("cac:Price");
    x.close("cac:InvoiceLine");
  });
  x.close("Invoice");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${x.toString()}\n`;
}
