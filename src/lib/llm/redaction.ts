/**
 * KVKK pseudonimleştirme — LLM'e giden HER metin buradan geçer.
 *
 * Tespit edilen kişisel veriler oturum-içi (tek `Redactor` örneği) tutarlı
 * takma adlarla değiştirilir: aynı değer → aynı etiket (`<KISI_1>`, `<EPOSTA_1>`…).
 * Yanıt geri geldiğinde `restore()` ile gerekirse orijinal değerlere döndürülür.
 *
 * Kapsam: e-posta, IBAN (TR), kart numarası (Luhn), TCKN (checksum), cep
 * telefonu (+90 / 0 / 5xx), bilinen kişi adları (kullanıcı adı, yorum yazarı).
 * Uygulama sırası çakışmaları önler (ör. 11 haneli TCKN telefon sanılmaz).
 */

export type PiiKind = "EPOSTA" | "IBAN" | "KART" | "TCKN" | "TELEFON" | "KISI";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN_RE = /\bTR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi;
const CARD_CANDIDATE_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const TCKN_CANDIDATE_RE = /(?<!\d)[1-9]\d{10}(?!\d)/g;
const PHONE_RE = /(?<![\d+])(?:\+90[\s-]?|0)?\(?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g;

/** Luhn (mod 10) doğrulaması — kart numaraları için. */
export function isLuhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** T.C. Kimlik No checksum doğrulaması (10. ve 11. hane kuralları). */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = value.split("").map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  if (d10 !== d[9]) return false;
  const d11 = d.slice(0, 10).reduce((s, n) => s + n, 0) % 10;
  return d11 === d[10];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class Redactor {
  private readonly forward = new Map<string, string>();
  private readonly backward = new Map<string, string>();
  private readonly counters = new Map<PiiKind, number>();
  private readonly names: string[];

  /** @param knownNames tam adıyla eşleştirilecek kişi adları (kullanıcılar, yorum yazarları) */
  constructor(knownNames: readonly string[] = []) {
    this.names = [...new Set(knownNames.map((n) => n.trim()).filter((n) => n.length >= 3))].sort(
      (a, b) => b.length - a.length
    );
  }

  private token(kind: PiiKind, original: string): string {
    const key = `${kind}:${kind === "KISI" ? original.toLocaleLowerCase("tr-TR") : original.replace(/[\s-]/g, "")}`;
    const existing = this.forward.get(key);
    if (existing) return existing;
    const next = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, next);
    const label = `<${kind}_${next}>`;
    this.forward.set(key, label);
    this.backward.set(label, original);
    return label;
  }

  /** Metindeki kişisel verileri takma adlarla değiştirir. */
  redact(text: string): string {
    let out = text.replace(EMAIL_RE, (m) => this.token("EPOSTA", m));
    out = out.replace(IBAN_RE, (m) => this.token("IBAN", m));
    out = out.replace(CARD_CANDIDATE_RE, (m) => {
      const digits = m.replace(/[ -]/g, "");
      return isLuhnValid(digits) ? this.token("KART", m) : m;
    });
    out = out.replace(TCKN_CANDIDATE_RE, (m) => (isValidTckn(m) ? this.token("TCKN", m) : m));
    out = out.replace(PHONE_RE, (m) => this.token("TELEFON", m));
    for (const name of this.names) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "giu");
      out = out.replace(re, (m) => this.token("KISI", m));
    }
    return out;
  }

  /** Takma adları orijinal değerlere geri çevirir (de-pseudonimleştirme). */
  restore(text: string): string {
    return text.replace(/<(EPOSTA|IBAN|KART|TCKN|TELEFON|KISI)_\d+>/g, (label) => {
      return this.backward.get(label) ?? label;
    });
  }

  /** Nesne ağacındaki tüm string değerlere `restore` uygular. */
  restoreDeep<T>(value: T): T {
    if (typeof value === "string") return this.restore(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.restoreDeep(v)) as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.restoreDeep(v);
      return out as T;
    }
    return value;
  }

  /** Bu oturumda üretilen takma ad sayısı (tür bazında). */
  stats(): Partial<Record<PiiKind, number>> {
    return Object.fromEntries(this.counters) as Partial<Record<PiiKind, number>>;
  }
}

/** Tek seferlik kısa yol. */
export function redactText(text: string, knownNames: readonly string[] = []): string {
  return new Redactor(knownNames).redact(text);
}
