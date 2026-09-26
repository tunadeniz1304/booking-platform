import { getConfig, type AppConfig } from "@/lib/config/app-config";
import { IBAN_RE } from "@/lib/llm/redaction";

/**
 * P1-6 mesajlarda dolandırıcılık tespiti — KARAR TAMAMEN KURALLARDA.
 *
 * Tipik kalıp: "Komisyon ödemeyin, WhatsApp'tan yazın, IBAN'a havale edin" veya kısaltılmış /
 * platform dışı ödeme linki. Kurallar (regex + config'teki alan adı listeleri) ham metin
 * üzerinde (maskelemeden ÖNCE) çalışır; her eşleşme bir gerekçe kodu ve sabit bir ağırlık
 * ekler, skor = ağırlıkların toplamı (üst sınır 100). Seviye eşikleri config'te.
 *
 * Opsiyonel LLM sınıflandırması yalnızca EK SİNYALDİR: `llmSignal` olarak kaydedilir
 * (denetim/moderasyon için) ama seviye, uyarı bandı ve engelleme kararına girmez →
 * LLM kapalıyken/demo modundayken sonuç birebir aynıdır.
 */

export type MessageRiskReason =
  | "IBAN"
  | "BANK_TRANSFER_REQUEST"
  | "OFF_PLATFORM_PAYMENT_REQUEST"
  | "OFF_PLATFORM_CONTACT"
  | "MESSENGER_LINK"
  | "SHORTENED_LINK"
  | "PAYMENT_LINK"
  | "CRYPTO_PAYMENT"
  | "EXTERNAL_LINK"
  | "URGENCY_PRESSURE";

export type MessageRiskLevel = "NONE" | "WARN" | "HIGH";

/**
 * Gerekçe ağırlıkları (0–100). Kural tablosunun parçasıdır (eşik değil): tek başına
 * IBAN veya ödeme linki "yüksek risk", mesajlaşma uygulamasına davet tek başına "uyarı".
 */
export const REASON_WEIGHTS: Readonly<Record<MessageRiskReason, number>> = {
  IBAN: 60,
  PAYMENT_LINK: 60,
  OFF_PLATFORM_PAYMENT_REQUEST: 45,
  CRYPTO_PAYMENT: 45,
  BANK_TRANSFER_REQUEST: 35,
  SHORTENED_LINK: 35,
  MESSENGER_LINK: 30,
  OFF_PLATFORM_CONTACT: 30,
  EXTERNAL_LINK: 10,
  URGENCY_PRESSURE: 10,
};

export interface MessageScanResult {
  score: number;
  level: MessageRiskLevel;
  /** Ağırlığa göre azalan, tekil gerekçe kodları. */
  reasons: MessageRiskReason[];
  /** Yüksek risk + config ile engelleme açık. */
  blocked: boolean;
  /** Opsiyonel LLM sınıflandırması (yalnızca bilgi): SUSPICIOUS | BENIGN | null. */
  llmSignal: "SUSPICIOUS" | "BENIGN" | null;
}

type ScanConfig = Pick<
  AppConfig,
  | "MESSAGE_SCAN_ENABLED"
  | "MESSAGE_SCAN_WARN_SCORE"
  | "MESSAGE_SCAN_HIGH_SCORE"
  | "MESSAGE_SCAN_BLOCK_HIGH_RISK"
  | "MESSAGE_SCAN_SHORTENER_DOMAINS"
  | "MESSAGE_SCAN_PAYMENT_DOMAINS"
  | "MESSAGE_SCAN_MESSENGER_DOMAINS"
>;

/**
 * Türkçe/İngilizce anahtar kelime eşleşmesi için normalleştirme: küçük harf (tr), aksanlar
 * sadeleşir (ç→c, ş→s, ğ→g, ı→i, ö→o, ü→u), kesme işareti ve tırnaklar atılır.
 */
export function normalizeForScan(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[çćč]/g, "c")
    .replace(/[şś]/g, "s")
    .replace(/ğ/g, "g")
    .replace(/[ıîí]/g, "i")
    .replace(/[öó]/g, "o")
    .replace(/[üûú]/g, "u")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`´"]/g, "");
}

/** Normalleştirilmiş metinde aranan kalıplar (TR + EN). */
const KEYWORD_RULES: ReadonlyArray<[MessageRiskReason, RegExp]> = [
  [
    "BANK_TRANSFER_REQUEST",
    /\b(havale|eft|fast ile|banka hesab\w*|hesap (no|numara\w*)|iban\w*|wire transfer|bank transfer|bank account|account number|western union|moneygram|swift code)\b/,
  ],
  [
    "OFF_PLATFORM_PAYMENT_REQUEST",
    /(platform dis\w*|site dis\w*|siteden (degil|disari)|uygulama dis\w*|komisyon (odeme|vermey|kesilme)\w*|komisyonsuz|direkt (bana )?ode\w*|dogrudan (bana )?ode\w*|elden ode\w*|nakit ode\w*|kapora\w*|on odeme\w*|pay (me )?(directly|outside|off[- ]platform)|outside (the )?(platform|app|site)|avoid (the )?(service )?fees?|save (the )?fees?|cash only|pay (in )?cash|deposit (via|to|by))/,
  ],
  [
    "OFF_PLATFORM_CONTACT",
    /\b(whats ?app\w*|watsap\w*|vatsap\w*|wp den|wpden|telegram\w*|signal (uzerinden|app)|viber\w*|dm (at|me)|text me (on|at)|message me on|contact me on|add me on)\b/,
  ],
  [
    "CRYPTO_PAYMENT",
    /\b(bitcoin|btc|usdt|tether|ethereum|kripto\w*|crypto\w*|cuzdan adres\w*|wallet address)\b/,
  ],
  [
    "URGENCY_PRESSURE",
    /\b(acil|hemen ode\w*|son sans|bugun ode\w*|urgent\w*|immediately|right now|within (an|1|one) hour)\b/,
  ],
];

/** Uluslararası IBAN (ör. DE89 3704 0044 0532 0130 00); en az 6 ardışık rakam şartı. */
const INTL_IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/gi;
/** Ham metinden alan adı çıkarımı (şemalı/şemasız). */
const HOST_RE =
  /(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})(?=[/:?#\s)\],.!]|$)/gi;

export function parseDomainList(csv: string): string[] {
  return csv
    .split(",")
    .map((d) =>
      d
        .trim()
        .toLowerCase()
        .replace(/^www\./, "")
    )
    .filter(Boolean);
}

const matchesDomain = (host: string, list: readonly string[]) =>
  list.some((d) => host === d || host.endsWith(`.${d}`));

/** Şemasız yazılmış alan adının link sayılması için yaygın TLD'ler ("evet.tamam" link değildir). */
const COMMON_TLDS = new Set(
  "com net org io me tr co app link ly info biz site online xyz gl gd at cc id us to gg sh store shop page".split(
    " "
  )
);

/**
 * Metindeki alan adları (küçük harf, `www.` atılmış); e-posta adreslerinin alan adı hariç.
 * `explicit`: şema (http/https) veya `www.` ile yazılmış.
 */
export function extractHosts(text: string): Array<{ host: string; explicit: boolean }> {
  const withoutEmails = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ");
  const hosts = new Map<string, boolean>();
  for (const m of withoutEmails.matchAll(HOST_RE)) {
    const host = m[1].toLowerCase();
    const explicit = /^(https?:\/\/|www\.)/i.test(m[0]);
    hosts.set(host, (hosts.get(host) ?? false) || explicit);
  }
  return [...hosts].map(([host, explicit]) => ({ host, explicit }));
}

function hasIban(text: string): boolean {
  IBAN_RE.lastIndex = 0;
  if (IBAN_RE.test(text)) return true;
  for (const m of text.matchAll(INTL_IBAN_RE)) {
    if (/\d{6,}/.test(m[0].replace(/\s/g, ""))) return true;
  }
  return false;
}

function levelFor(score: number, cfg: ScanConfig): MessageRiskLevel {
  if (score >= cfg.MESSAGE_SCAN_HIGH_SCORE) return "HIGH";
  if (score >= cfg.MESSAGE_SCAN_WARN_SCORE) return "WARN";
  return "NONE";
}

/**
 * Deterministik kural taraması. `ownHosts`: platformun kendi alan adları (link sayılmaz).
 */
export function scanMessageRules(
  text: string,
  opts: { config?: ScanConfig; ownHosts?: readonly string[] } = {}
): MessageScanResult {
  const cfg = opts.config ?? getConfig();
  if (!cfg.MESSAGE_SCAN_ENABLED) {
    return { score: 0, level: "NONE", reasons: [], blocked: false, llmSignal: null };
  }
  const reasons = new Set<MessageRiskReason>();
  if (hasIban(text)) reasons.add("IBAN");

  const shorteners = parseDomainList(cfg.MESSAGE_SCAN_SHORTENER_DOMAINS);
  const payments = parseDomainList(cfg.MESSAGE_SCAN_PAYMENT_DOMAINS);
  const messengers = parseDomainList(cfg.MESSAGE_SCAN_MESSENGER_DOMAINS);
  const own = (opts.ownHosts ?? []).map((h) => h.toLowerCase().replace(/^www\./, ""));
  for (const { host, explicit } of extractHosts(text)) {
    if (matchesDomain(host, own)) continue;
    if (matchesDomain(host, payments)) reasons.add("PAYMENT_LINK");
    else if (matchesDomain(host, shorteners)) reasons.add("SHORTENED_LINK");
    else if (matchesDomain(host, messengers)) reasons.add("MESSENGER_LINK");
    else if (explicit || COMMON_TLDS.has(host.slice(host.lastIndexOf(".") + 1))) {
      reasons.add("EXTERNAL_LINK");
    }
  }

  const normalized = normalizeForScan(text);
  for (const [reason, re] of KEYWORD_RULES) {
    if (re.test(normalized)) reasons.add(reason);
  }
  // Mesajlaşma linki zaten platform dışı iletişim daveti; aynı sinyali iki kez sayma.
  if (reasons.has("MESSENGER_LINK")) reasons.delete("OFF_PLATFORM_CONTACT");

  const ordered = [...reasons].sort(
    (a, b) => REASON_WEIGHTS[b] - REASON_WEIGHTS[a] || a.localeCompare(b)
  );
  const score = Math.min(
    100,
    ordered.reduce((sum, r) => sum + REASON_WEIGHTS[r], 0)
  );
  const level = levelFor(score, cfg);
  return {
    score,
    level,
    reasons: ordered,
    blocked: level === "HIGH" && cfg.MESSAGE_SCAN_BLOCK_HIGH_RISK,
    llmSignal: null,
  };
}

/** LLM sınıflandırıcı: yalnızca ek sinyal döndürür; hata/devre dışı → null. */
export type MessageRiskClassifier = (text: string) => Promise<"SUSPICIOUS" | "BENIGN" | null>;

/**
 * Kural taraması + (verilirse) LLM ek sinyali. LLM sonucu `llmSignal` alanına yazılır;
 * skor/seviye/engelleme kurallardan gelir ve LLM'den bağımsızdır.
 */
export async function scanMessage(
  text: string,
  opts: { config?: ScanConfig; ownHosts?: readonly string[]; classify?: MessageRiskClassifier } = {}
): Promise<MessageScanResult> {
  const result = scanMessageRules(text, opts);
  if (!opts.classify) return result;
  let llmSignal: MessageScanResult["llmSignal"] = null;
  try {
    llmSignal = await opts.classify(text);
  } catch {
    llmSignal = null;
  }
  return { ...result, llmSignal };
}
