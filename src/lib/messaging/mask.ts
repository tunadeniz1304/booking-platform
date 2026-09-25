import {
  EMAIL_RE,
  IBAN_RE,
  CARD_CANDIDATE_RE,
  TCKN_CANDIDATE_RE,
  PHONE_RE,
  isLuhnValid,
  isValidTckn,
} from "@/lib/llm/redaction";

/**
 * P1-6 mesaj maskeleme: platform dışı iletişim/ödeme yönlendirmesini ve kişisel veriyi
 * engellemek için telefon, e-posta, IBAN, URL (ve kart / TCKN) mesaj KAYDEDİLMEDEN önce
 * maskelenir — DB'de yalnızca maskeli metin durur. Desenler `redaction.ts` ile ortaktır;
 * TR dışı numara/IBAN ve alan adları için ek, daha geniş desenler burada.
 */
export type MaskKind = "PHONE" | "EMAIL" | "IBAN" | "URL" | "CARD" | "TCKN";

export const MASK_LABEL: Record<MaskKind, string> = {
  EMAIL: "[e-posta gizlendi]",
  IBAN: "[IBAN gizlendi]",
  URL: "[bağlantı gizlendi]",
  CARD: "[kart no gizlendi]",
  TCKN: "[kimlik no gizlendi]",
  PHONE: "[telefon gizlendi]",
};

/** Uluslararası IBAN (ülke kodu + 2 kontrol + 11–30 alfanümerik, boşluklu da olabilir). */
const INTL_IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/gi;
/** Şema/www ile ya da yaygın TLD ile biten alan adları (wa.me, bit.ly, t.me dahil). */
const URL_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|me|tr|co|app|link|ly|info|biz|site|online|xyz)\b(?:\/\S*)?/gi;
/** Genel telefon: + ile başlayabilir, 9–15 hane, boşluk/nokta/tire/parantez ayraçlı. */
const INTL_PHONE_RE = /(?<![\w+])\+?\(?\d(?:[\s().-]?\d){8,14}(?!\d)/g;

const digitsOf = (s: string) => s.replace(/\D/g, "");

export interface MaskResult {
  text: string;
  kinds: MaskKind[];
}

export function maskMessage(input: string): MaskResult {
  const kinds = new Set<MaskKind>();
  const sub = (kind: MaskKind) => () => {
    kinds.add(kind);
    return MASK_LABEL[kind];
  };
  let out = input.replace(EMAIL_RE, sub("EMAIL"));
  out = out.replace(IBAN_RE, sub("IBAN"));
  out = out.replace(INTL_IBAN_RE, (m) => (/\d{6,}/.test(m.replace(/\s/g, "")) ? sub("IBAN")() : m));
  out = out.replace(URL_RE, sub("URL"));
  out = out.replace(CARD_CANDIDATE_RE, (m) => (isLuhnValid(digitsOf(m)) ? sub("CARD")() : m));
  out = out.replace(TCKN_CANDIDATE_RE, (m) => (isValidTckn(m) ? sub("TCKN")() : m));
  out = out.replace(PHONE_RE, sub("PHONE"));
  out = out.replace(INTL_PHONE_RE, sub("PHONE"));
  return { text: out, kinds: [...kinds] };
}
