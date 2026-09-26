import { createHash } from "node:crypto";

/**
 * P1-13c — Özel entegratör adaptör arayüzü (e-Arşiv / e-Fatura).
 *
 * GİB'e doğrudan bağlanmak yerine lisanslı bir özel entegratör kullanılır: XML'i imzalar
 * (mali mühür / XAdES), GİB'e raporlar ve durum sorgusu sağlar. Gerçek sağlayıcı
 * (ör. SOAP/REST istemcisi) bu arayüzü uygular; testler ve demo `MockEInvoiceIntegrator`
 * ile ağa çıkmadan çalışır.
 */

export type EInvoiceStatus = "QUEUED" | "ACCEPTED" | "REJECTED" | "CANCELLED";

export interface EInvoiceSubmission {
  /** ETTN (UUID) — entegratörde idempotency anahtarıdır. */
  uuid: string;
  invoiceNumber: string;
  profile: "EARSIVFATURA" | "TEMELFATURA" | "TICARIFATURA";
  xml: string;
}

export interface EInvoiceResult {
  uuid: string;
  status: EInvoiceStatus;
  /** Entegratör tarafındaki kayıt kimliği. */
  integratorRef: string;
  /** Reddedildiyse kod/mesaj. */
  error?: { code: string; message: string };
}

export interface EInvoiceIntegrator {
  readonly name: string;
  /** Aynı UUID ile tekrar çağrı yeni belge üretmez, ilk sonucu döner (idempotent). */
  submit(doc: EInvoiceSubmission): Promise<EInvoiceResult>;
  status(uuid: string): Promise<EInvoiceResult | null>;
  /** e-Arşiv iptali (GİB kuralları: raporlama döneminden önce). */
  cancel(uuid: string, reason: string): Promise<EInvoiceResult>;
}

export class EInvoiceIntegratorError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "EInvoiceIntegratorError";
  }
}

/**
 * Bellek içi mock entegratör: temel yapısal kontrolleri yapar (kök eleman, profil, UUID ve
 * fatura no XML'dekiyle aynı), geçerli belgeyi ACCEPTED işaretler. Ağ yok, deterministik.
 */
export class MockEInvoiceIntegrator implements EInvoiceIntegrator {
  readonly name = "mock";
  private readonly docs = new Map<string, EInvoiceResult & { xml: string }>();

  async submit(doc: EInvoiceSubmission): Promise<EInvoiceResult> {
    const existing = this.docs.get(doc.uuid.toUpperCase());
    if (existing) return strip(existing);
    const integratorRef = `MOCK-${createHash("sha256").update(doc.xml).digest("hex").slice(0, 16)}`;
    const error = checkStructure(doc);
    const result: EInvoiceResult = {
      uuid: doc.uuid.toUpperCase(),
      status: error ? "REJECTED" : "ACCEPTED",
      integratorRef,
      ...(error ? { error } : {}),
    };
    this.docs.set(result.uuid, { ...result, xml: doc.xml });
    return result;
  }

  async status(uuid: string): Promise<EInvoiceResult | null> {
    const found = this.docs.get(uuid.toUpperCase());
    return found ? strip(found) : null;
  }

  async cancel(uuid: string, reason: string): Promise<EInvoiceResult> {
    const found = this.docs.get(uuid.toUpperCase());
    if (!found) throw new EInvoiceIntegratorError("NOT_FOUND", "Belge bulunamadı");
    if (found.status !== "ACCEPTED") {
      throw new EInvoiceIntegratorError("NOT_CANCELLABLE", `Durum ${found.status} iptal edilemez`);
    }
    if (!reason.trim())
      throw new EInvoiceIntegratorError("REASON_REQUIRED", "İptal gerekçesi zorunlu");
    found.status = "CANCELLED";
    return strip(found);
  }
}

function strip(r: EInvoiceResult & { xml?: string }): EInvoiceResult {
  const { xml: _xml, ...rest } = r;
  void _xml;
  return rest;
}

function tag(xml: string, name: string): string | undefined {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(xml)?.[1];
}

function checkStructure(doc: EInvoiceSubmission): EInvoiceResult["error"] {
  if (
    !/<Invoice\s[^>]*xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/.test(doc.xml)
  ) {
    return { code: "SCHEMA", message: "UBL Invoice kök elemanı yok" };
  }
  if (tag(doc.xml, "cbc:CustomizationID") !== "TR1.2") {
    return { code: "SCHEMA", message: "CustomizationID TR1.2 olmalı" };
  }
  if (tag(doc.xml, "cbc:ProfileID") !== doc.profile) {
    return { code: "PROFILE", message: "ProfileID gönderimle uyuşmuyor" };
  }
  if (tag(doc.xml, "cbc:UUID")?.toUpperCase() !== doc.uuid.toUpperCase()) {
    return { code: "UUID", message: "UUID XML ile uyuşmuyor" };
  }
  if (tag(doc.xml, "cbc:ID") !== doc.invoiceNumber) {
    return { code: "NUMBER", message: "Fatura no XML ile uyuşmuyor" };
  }
  return undefined;
}
