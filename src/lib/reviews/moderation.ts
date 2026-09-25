import { maskMessage, type MaskKind } from "@/lib/messaging/mask";

/**
 * P1-7 deterministik yorum filtresi. Karar kural tabanlıdır (LLM karar VERMEZ; yalnızca
 * admin kuyruğunda "neden işaretlendi" açıklamasını ifade eder). İsabet varsa yorum
 * PENDING_REVIEW olarak bekletilir ve admin onayı olmadan yayınlanmaz / puana katılmaz.
 */
export type ModerationCode =
  | "PROFANITY"
  | "PII_PHONE"
  | "PII_EMAIL"
  | "PII_IBAN"
  | "PII_URL"
  | "PII_CARD"
  | "PII_TCKN"
  | "REPORT_THRESHOLD";

export interface ModerationReason {
  code: ModerationCode;
  detail: string;
}

/**
 * Küçük, bilinçli olarak dar tutulmuş küfür/hakaret listesi (TR + EN). Kelime kökü
 * eşleşmesi; Türkçe ekler için kökten sonra harf gelebilir (ör. "salaklar").
 * Yanlış pozitif maliyeti düşüktür: yorum silinmez, admin incelemesine düşer.
 */
const PROFANITY_STEMS = [
  "orospu",
  "piç",
  "siktir",
  "sikik",
  "yavşak",
  "gerizekalı",
  "salak",
  "şerefsiz",
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
] as const;

/** Kısaltmalar yalnızca tam kelime olarak eşleşir ("aq" ≠ "aquapark"). */
const PROFANITY_WORDS = ["amk", "aq", "mk"] as const;

const WORD_CHARS = "a-zçğıöşüâîû0-9";
const PROFANITY_RE = new RegExp(
  `(?<![${WORD_CHARS}])(?:(?:${PROFANITY_STEMS.join("|")})[${WORD_CHARS}]*|(?:${PROFANITY_WORDS.join("|")})(?![${WORD_CHARS}]))`,
  "iu"
);

const PII_DETAIL: Record<MaskKind, string> = {
  PHONE: "Telefon numarası içeriyor",
  EMAIL: "E-posta adresi içeriyor",
  IBAN: "IBAN içeriyor",
  URL: "Harici bağlantı içeriyor",
  CARD: "Kart numarası içeriyor",
  TCKN: "T.C. kimlik numarası içeriyor",
};

/** Türkçe büyük/küçük harf duyarlı normalizasyon (İ/I → i/ı). */
function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR");
}

export function moderateText(text: string | null | undefined): ModerationReason[] {
  if (!text) return [];
  const reasons: ModerationReason[] = [];
  const profane = PROFANITY_RE.exec(normalize(text));
  if (profane) reasons.push({ code: "PROFANITY", detail: "Küfür/hakaret içeren ifade" });
  for (const kind of maskMessage(text).kinds) {
    reasons.push({ code: `PII_${kind}` as ModerationCode, detail: PII_DETAIL[kind] });
  }
  return reasons;
}
