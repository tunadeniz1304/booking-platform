/**
 * KVKK pseudonimleştirme — LLM'e giden HER metin buradan geçer.
 *
 * Tespit edilen kişisel veriler oturum-içi (tek `Redactor` örneği) tutarlı
 * takma adlarla değiştirilir: aynı değer → aynı etiket (`<KISI_1>`, `<EPOSTA_1>`…).
 * Yanıt geri geldiğinde `restore()` ile gerekirse orijinal değerlere döndürülür.
 *
 * Kapsam: e-posta, IBAN (ISO 13616, mod-97), kart numarası (Luhn), TCKN
 * (checksum), telefon (TR cep +90 / 0 / 5xx, TR sabit hat 0 2xx–4xx, uluslararası
 * +<ülke kodu> E.164), bilinen kişi adları (kullanıcı, ev sahibi, yorum yazarı).
 * Uygulama sırası çakışmaları önler (ör. 11 haneli TCKN telefon sanılmaz).
 */

export type PiiKind = "EPOSTA" | "IBAN" | "KART" | "TCKN" | "TELEFON" | "KISI";

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const IBAN_RE = /\bTR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi;
/** ISO 13616 adayı: ülke kodu + 2 kontrol hanesi + 4'lü (boşluklu/bitişik) BBAN grupları. */
export const IBAN_CANDIDATE_RE =
  /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])/g;
export const CARD_CANDIDATE_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
export const TCKN_CANDIDATE_RE = /(?<!\d)[1-9]\d{10}(?!\d)/g;
export const PHONE_RE =
  /(?<![\d+])(?:\+90[\s-]?|0)?\(?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g;
/** TR sabit hat: 0 veya +90 önekli, 2xx–4xx alan kodu + 7 hane (TCKN 0 ile başlamaz). */
export const LANDLINE_RE =
  /(?<![\d+])\(?(?:\+90[\s-]?|0)\(?[2-4]\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g;
/** Uluslararası (E.164): + ülke kodu ve ayraçlı rakamlar; hane sayısı `E164_DIGITS` ile sınanır. */
export const INTL_PHONE_RE = /(?<![\w+])\+[1-9](?:[ .-]?\(?\d\)?){6,14}(?!\d)/g;

/** ISO 13616 toplam uzunluk sınırları ve E.164 hane sınırları (ülke kodu dahil). */
const IBAN_LENGTH = { min: 15, max: 34 } as const;
const E164_DIGITS = { min: 8, max: 15 } as const;
const IBAN_CHECK_MODULUS = 97;

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

/** ISO 13616 IBAN doğrulaması: biçim + mod-97 (kalan 1). Boşluklar yok sayılır. */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/ /g, "").toUpperCase();
  if (iban.length < IBAN_LENGTH.min || iban.length > IBAN_LENGTH.max) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  let rem = 0;
  for (const ch of iban.slice(4) + iban.slice(0, 4)) {
    const n = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % IBAN_CHECK_MODULUS;
  }
  return rem === 1;
}

/**
 * Aday içindeki en uzun geçerli IBAN önekini döndürür (aday bitişikteki büyük harfli bir
 * kelimeyi de yutmuş olabilir: "DE89 … 00 ABCD"). Geçerli önek yoksa `null`.
 */
function longestIbanPrefix(candidate: string): string | null {
  for (let end = candidate.length; end > 0; end--) {
    if (candidate[end - 1] === " ") continue;
    const prefix = candidate.slice(0, end);
    if (isValidIban(prefix)) return prefix;
    if (prefix.replace(/ /g, "").length <= IBAN_LENGTH.min) break;
  }
  return null;
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
    out = out.replace(IBAN_CANDIDATE_RE, (m) => {
      const iban = longestIbanPrefix(m);
      return iban ? this.token("IBAN", iban) + m.slice(iban.length) : m;
    });
    out = out.replace(CARD_CANDIDATE_RE, (m) => {
      const digits = m.replace(/[ -]/g, "");
      return isLuhnValid(digits) ? this.token("KART", m) : m;
    });
    out = out.replace(TCKN_CANDIDATE_RE, (m) => (isValidTckn(m) ? this.token("TCKN", m) : m));
    out = out.replace(PHONE_RE, (m) => this.token("TELEFON", m));
    out = out.replace(LANDLINE_RE, (m) => this.token("TELEFON", m));
    out = out.replace(INTL_PHONE_RE, (m) => {
      const digits = m.replace(/\D/g, "").length;
      return digits >= E164_DIGITS.min && digits <= E164_DIGITS.max ? this.token("TELEFON", m) : m;
    });
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
