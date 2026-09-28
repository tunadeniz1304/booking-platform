/**
 * v5 P1-4 (ADR 0029) — destek ajanı için DETERMİNİSTİK niyet sınıflandırıcı.
 *
 * LLM'den bağımsız çalışır: devir kararı (para/iade talebi, hukuki/şikâyet sinyali, insan
 * isteği) ve prompt-injection tespiti burada, kurallarla verilir; LLM bunları değiştiremez.
 * Demo modunda yanıt şablonu da bu sınıflandırmaya göre seçilir.
 */

export type SupportIntent =
  | "booking_status"
  | "cancellation_quote"
  | "property_policy"
  | "refund_request"
  | "legal_or_complaint"
  | "human_request"
  | "prompt_injection"
  | "greeting"
  | "unknown";

export interface IntentSignals {
  /** Para/iade/tazminat TALEBİ (soru değil) — daima insana devredilir. */
  money: boolean;
  /** Hukuki süreç veya resmi şikâyet sinyali — daima insana devredilir. */
  legal: boolean;
  /** Kullanıcı açıkça insan temsilci istiyor. */
  human: boolean;
  /** Sistem talimatını değiştirme / rol yeniden tanımlama girişimi. */
  injection: boolean;
}

export interface IntentResult {
  intent: SupportIntent;
  /** 0..1 — kural eşleşmesinin gücü; `SUPPORT_HANDOFF_MIN_CONFIDENCE` altı → devir. */
  confidence: number;
  signals: IntentSignals;
}

/** Güven seviyeleri (kural gücü; eşik ayrı olarak ayarlardan gelir). */
export const INTENT_CONFIDENCE = {
  strong: 0.9,
  medium: 0.75,
  weak: 0.3,
} as const;

/** Türkçe karakterleri sadeleştirip küçük harfe çevirir (eşleşme dayanıklılığı). */
export function normalizeForIntent(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/\s+/g, " ")
    .trim();
}

const INJECTION_RE: readonly RegExp[] = [
  /(sistem|system)\s*(talimat|mesaj|prompt|instruction)/,
  /(onceki|yukaridaki|tum)\s*(talimat|kural)\w*\s*(yok\s*say|unut|gormezden)/,
  /\b(yok\s*say|gormezden\s*gel)\b.*\b(talimat|kural)/,
  /ignore\s*(all\s*)?(previous|prior|above|the)?\s*(instruction|rule|prompt)/,
  /disregard\s*(all\s*)?(previous|prior|above)/,
  /\b(developer|jailbreak|dan)\s*mode\b/,
  /\byou\s*are\s*now\b|\bartik\s*sen\b.*\b(bir|admin|yonetici)\b/,
  /\b(admin|yonetici)\s*(yetkisi|olarak|modu)/,
  /\bact\s*as\s*(an?\s*)?(admin|system|developer)/,
  /<\/?(system|assistant|tool)>/,
];

const MONEY_REQUEST_RE: readonly RegExp[] = [
  /\biade\w*\s+(?:\w+\s+){0,2}(onayla|yap|et|ver|gonder|baslat|istiyorum|talep)/,
  /\b(onayla|yap|baslat)\w*\s+(?:\w+\s+){0,2}(iade|geri\s*odeme)/,
  /\bparam\w*\s*(geri|iade)/,
  /\bgeri\s*odeme\w*\s*(istiyorum|yap|talep|onayla)/,
  /\b(tazminat|chargeback|ters\s*ibraz|indirim\s*istiyorum|ucret\w*\s*geri)/,
  /\b(approve|issue|process|give)\s*(me\s*)?(my\s*|a\s*)?refund/,
  /\brefund\s*me\b|\bi\s*want\s*(a|my)\s*refund|\bmoney\s*back\b|\bcompensation\b/,
];

const LEGAL_RE: readonly RegExp[] = [
  /\b(avukat|dava|mahkeme|hukuki|tuketici\s*hakem|savcilik|noter|ihtarname)/,
  /\bsikayet\w*|\bsikay?et\s*edecegim/,
  /\b(lawyer|attorney|lawsuit|sue|legal\s*action|court|formal\s*complaint|complain)/,
  /\bkvkk\s*(basvuru|sikayet)|\bgdpr\s*complaint/,
];

const HUMAN_RE: readonly RegExp[] = [
  /\b(insan|gercek\s*kisi|temsilci|canli\s*destek|yetkili)\w*/,
  /\b(human|real\s*person|representative|live\s*agent|operator)\b/,
];

const CANCEL_QUOTE_RE: readonly RegExp[] = [
  /\biptal\w*/,
  /\bne\s*kadar\s*(iade|geri)/,
  /\biade\s*(alir|alabilir|olur|oran|politika)/,
  /\bcancel\w*/,
  /\bhow\s*much\s*(refund|back)|\brefund\s*(policy|amount|would)/,
];

const BOOKING_RE: readonly RegExp[] = [
  /\brezervasyon\w*/,
  /\b(giris|cikis)\s*tarih/,
  /\b(booking|reservation|check-?in\s*date|my\s*stay)\b/,
];

const POLICY_RE: readonly RegExp[] = [
  /\b(giris|cikis)\s*saat/,
  /\b(kural|politika|evcil|sigara|check-?in\s*saat)/,
  /\b(check-?in|check-?out)\s*(time|hour)|\bhouse\s*rules?\b|\bpolicy\b|\bpets?\b/,
];

const GREETING_RE = /^(merhaba|selam|iyi\s*gunler|hello|hi|hey)\b[\s!.,]*$/;

const any = (res: readonly RegExp[], text: string) => res.some((re) => re.test(text));

/** Mesajın deterministik niyeti + devir sinyalleri. Saf fonksiyon (I/O yok). */
export function classifyIntent(message: string): IntentResult {
  const text = normalizeForIntent(message);
  const signals: IntentSignals = {
    money: any(MONEY_REQUEST_RE, text),
    legal: any(LEGAL_RE, text),
    human: any(HUMAN_RE, text),
    injection: any(INJECTION_RE, text),
  };
  const result = (intent: SupportIntent, confidence: number): IntentResult => ({
    intent,
    confidence,
    signals,
  });

  // Öncelik: hukuki > para talebi > injection > insan isteği > bilgi soruları.
  // (Injection + para talebi → para talebi: insan inceler, hiçbir şey onaylanmaz.)
  if (signals.legal) return result("legal_or_complaint", INTENT_CONFIDENCE.strong);
  if (signals.money) return result("refund_request", INTENT_CONFIDENCE.strong);
  if (signals.injection) return result("prompt_injection", INTENT_CONFIDENCE.strong);
  if (signals.human) return result("human_request", INTENT_CONFIDENCE.strong);
  if (any(CANCEL_QUOTE_RE, text)) return result("cancellation_quote", INTENT_CONFIDENCE.strong);
  if (any(POLICY_RE, text)) return result("property_policy", INTENT_CONFIDENCE.medium);
  if (any(BOOKING_RE, text)) return result("booking_status", INTENT_CONFIDENCE.medium);
  if (GREETING_RE.test(text)) return result("greeting", INTENT_CONFIDENCE.medium);
  return result("unknown", INTENT_CONFIDENCE.weak);
}
