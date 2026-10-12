"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api-client";
import { money, toDecimalString } from "@/lib/money/money";
import { currencyExponent } from "@/lib/money/currencies";
import { parseAmountToMinor } from "@/lib/ui/amount-input";
import { useFormat } from "@/i18n/use-format";
import { useErrorText } from "@/components/ui/ui";

/** Çözüm merkezi (P1-5) istemci tipleri — API sözleşmesinin birebir yansıması. */
export type ClaimType = "GUEST_REFUND" | "HOST_DAMAGE" | "CHARGEBACK";
export type ClaimStatus =
  | "OPEN"
  | "AWAITING_RESPONSE"
  | "ESCALATED"
  | "RESOLVED_APPROVED"
  | "RESOLVED_PARTIAL"
  | "RESOLVED_REJECTED"
  | "CLOSED";
export type ClaimRole = "OPENER" | "RESPONDENT" | "ADMIN";

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  "OPEN",
  "AWAITING_RESPONSE",
  "ESCALATED",
  "RESOLVED_APPROVED",
  "RESOLVED_PARTIAL",
  "RESOLVED_REJECTED",
  "CLOSED",
];

/** Taraflar arasında hâlâ işlem yapılabilen (sonuçlanmamış) durumlar. */
export const ACTIVE_STATUSES: readonly ClaimStatus[] = ["OPEN", "AWAITING_RESPONSE", "ESCALATED"];

export interface ClaimSummary {
  id: string;
  bookingId: string;
  type: ClaimType;
  status: ClaimStatus;
  amountRequestedMinor: number;
  awardedMinor: number | null;
  currency: string;
  slaDueAt: string | null;
  createdAt: string;
  role: ClaimRole;
  propertyTitle: string | null;
}

export type DepositStatus =
  "SCHEDULED" | "AUTHORIZED" | "CAPTURED_PARTIAL" | "CAPTURED" | "VOIDED" | "EXPIRED" | "FAILED";

export interface DepositView {
  id: string;
  amountMinor: number;
  capturedMinor: number;
  currency: string;
  status: DepositStatus;
  authorizeAfter: string;
  voidAfter: string;
  authorizedAt: string | null;
}

export interface ClaimDetailResponse {
  claim: ClaimSummary & {
    description: string;
    respondedAt: string | null;
    escalatedAt: string | null;
    settledMinor: number | null;
    uncollectedMinor: number | null;
    platformCoveredMinor: number | null;
    decisionNote: string | null;
    decidedAt: string | null;
    externalStatus: string | null;
    externalReason: string | null;
  };
  booking: {
    id: string;
    checkIn: string;
    checkOut: string;
    status: string;
    refundableMinor: number;
  } | null;
  deposit: DepositView | null;
  messages: Array<{
    id: string;
    role: ClaimRole | "SYSTEM";
    body: string;
    mine: boolean;
    createdAt: string;
  }>;
  evidence: Array<{
    id: string;
    role: ClaimRole | "SYSTEM";
    contentType: "image/webp" | "application/pdf";
    byteSize: number;
    width: number | null;
    height: number | null;
    createdAt: string;
  }>;
}

/**
 * Sunucu varsayılan sınırları (app-config: CLAIM_GUEST_WINDOW_DAYS, CLAIM_EVIDENCE_*).
 * Yalnızca kullanıcıya önceden bilgi vermek ve seçim anında erken uyarı için kullanılır;
 * asıl doğrulama sunucudadır.
 */
export const CLAIM_GUEST_WINDOW_DAYS = 14;
export const EVIDENCE_IMAGE_MAX_MB = 8;
export const EVIDENCE_PDF_MAX_MB = 5;
export const EVIDENCE_MAX_FILES = 10;

/** Sunucudan gelen ve arayüz dilinde çevirisi olan hata kodları. */
const KNOWN_ERROR_CODES = new Set([
  "CLAIM_TOO_EARLY",
  "CLAIM_WINDOW_CLOSED",
  "CLAIM_ALREADY_OPEN",
  "CLAIM_AMOUNT_EXCEEDS_REFUNDABLE",
  "CLAIM_BOOKING_NOT_ELIGIBLE",
  "CLAIM_TRANSFERRED_BOOKING",
  "CLAIM_REFUND_IN_PROGRESS",
  "CLAIM_SPLIT_CAPACITY",
  "CLAIM_EVIDENCE_LIMIT",
  "CLAIM_PSP_MANAGED",
  "CLAIM_CLOSED",
  "CLAIM_NO_PAYMENT",
  "CLAIM_REFUND_FAILED",
  "PAYMENT_IN_PROGRESS",
  "EMAIL_NOT_VERIFIED",
  "NOT_FOUND",
  "VALIDATION_ERROR",
]);

/** Genel (talebe özgü olmayan) kodlar ortak `useErrorText` ile çevrilir. */
const COMMON_ERROR_CODES = new Set([
  "UNAUTHORIZED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
  "INVALID_JSON",
  "TRANSACTION_CONFLICT",
]);

/**
 * Talep API hatasını kullanıcı diline çevirir. Bilinmeyen kodlarda sunucunun ham
 * (tek dilli) metni yerine arayüz dilinde genel bir ileti gösterilir.
 */
export function useClaimErrorText() {
  const t = useTranslations("resolution.errors");
  const commonError = useErrorText();
  const f = useFormat();
  return useCallback(
    (err: unknown, currency?: string): string => {
      if (!(err instanceof ApiError)) return commonError(err);
      if (err.code === "CLAIM_AMOUNT_EXCEEDS_REFUNDABLE") {
        // Sunucu tutarı string (BigInt) ya da sayı olarak gönderebilir.
        const raw = (err.details as { refundableMinor?: unknown } | undefined)?.refundableMinor;
        const max = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
        if (typeof max !== "number" || !Number.isSafeInteger(max) || !currency) {
          return t("CLAIM_AMOUNT_EXCEEDS_REFUNDABLE_NOAMOUNT");
        }
        try {
          return t(err.code, { amount: f.money(max, currency) });
        } catch {
          return t("CLAIM_AMOUNT_EXCEEDS_REFUNDABLE_NOAMOUNT");
        }
      }
      if (err.status === 413 || err.code === "PAYLOAD_TOO_LARGE") {
        return t("PAYLOAD_TOO_LARGE", {
          imageMb: EVIDENCE_IMAGE_MAX_MB,
          pdfMb: EVIDENCE_PDF_MAX_MB,
        });
      }
      if (err.code && KNOWN_ERROR_CODES.has(err.code)) return t(err.code);
      if (err.status === 404) return t("NOT_FOUND");
      if (!err.code || err.status >= 500 || COMMON_ERROR_CODES.has(err.code)) {
        return commonError(err);
      }
      return t("unknown");
    },
    [t, commonError, f]
  );
}

/** Sunucu "e-posta doğrulanmamış" dediyse (formda yeniden gönderme düğmesi gösterilir). */
export function isEmailNotVerifiedError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED";
}

/** Hata iletisinin yanında sunulacak çıkış yolu (`labelKey`, "resolution" ad alanında). */
export type ClaimErrorAction =
  | { href: string; labelKey: "errorAction.contactSupport" | "errorAction.viewClaims" }
  | "resendVerification"
  | null;

/**
 * Hata koduna göre kullanıcının atabileceği sonraki adım: doğrulama e-postasını yeniden
 * gönderme, desteğe yazma ya da zaten açık talebi çözüm merkezinde bulma. Yoksa null.
 */
export function claimErrorAction(err: unknown): ClaimErrorAction {
  if (!(err instanceof ApiError)) return null;
  switch (err.code) {
    case "EMAIL_NOT_VERIFIED":
      return "resendVerification";
    case "CLAIM_REFUND_IN_PROGRESS":
      return { href: "/support", labelKey: "errorAction.contactSupport" };
    case "CLAIM_ALREADY_OPEN":
      return { href: "/resolution", labelKey: "errorAction.viewClaims" };
    default:
      return null;
  }
}

/** Talebin tarafları: türüne göre açan/yanıtlayan rolünün kime karşılık geldiği. */
export type ClaimParty = "GUEST" | "HOST" | "CARDHOLDER";

const PARTY_SIDES: Record<ClaimType, { OPENER: ClaimParty; RESPONDENT: ClaimParty }> = {
  GUEST_REFUND: { OPENER: "GUEST", RESPONDENT: "HOST" },
  HOST_DAMAGE: { OPENER: "HOST", RESPONDENT: "GUEST" },
  CHARGEBACK: { OPENER: "CARDHOLDER", RESPONDENT: "HOST" },
};

/** Rolün talep türündeki tarafı (misafir / ev sahibi / kart sahibi); yönetici için null. */
export function partyKey(type: ClaimType, role: string): ClaimParty | null {
  if (role !== "OPENER" && role !== "RESPONDENT") return null;
  return PARTY_SIDES[type]?.[role] ?? null;
}

/**
 * Rol etiketi: taraf belliyse "Misafir" / "Ev sahibi" / "Kart sahibi" (`mine` ise "(siz)"
 * eklenir); değilse genel rol adı ("Yönetici", "Sistem").
 */
export function usePartyLabel() {
  const t = useTranslations("resolution");
  return useCallback(
    (type: ClaimType | null | undefined, role: string, mine = false): string => {
      const k = type ? partyKey(type, role) : null;
      const label = k ? t(`party.${k}`) : t(`role.${role}`);
      return mine && k ? t("party.you", { party: label }) : label;
    },
    [t]
  );
}

/** Ödeme sağlayıcısı (Stripe) itiraz durumları, gerekçeleri ve olayları; bilinmeyenler "Diğer". */
const DISPUTE_STATUSES = new Set([
  "warning_needs_response",
  "warning_under_review",
  "warning_closed",
  "needs_response",
  "under_review",
  "won",
  "lost",
  "prevented",
]);
const DISPUTE_REASONS = new Set([
  "bank_cannot_process",
  "check_returned",
  "credit_not_processed",
  "customer_initiated",
  "debit_not_authorized",
  "duplicate",
  "fraudulent",
  "general",
  "incorrect_account_details",
  "insufficient_funds",
  "noncompliant",
  "product_not_received",
  "product_unacceptable",
  "subscription_canceled",
  "unrecognized",
]);
const DISPUTE_EVENTS = new Set(["DISPUTE_CREATED", "DISPUTE_UPDATED", "DISPUTE_CLOSED"]);

/**
 * Ödeme sağlayıcısı kodlarını ("needs_response", "fraudulent", "PSP_DISPUTE_CREATED:…")
 * arayüz diline çevirir; ham kod kullanıcıya gösterilmez.
 */
export function useDisputeText() {
  const t = useTranslations("resolution.dispute");
  return useMemo(() => {
    const status = (code: string) =>
      t(DISPUTE_STATUSES.has(code) ? `status.${code}` : "status.other");
    const reason = (code: string) =>
      t(DISPUTE_REASONS.has(code) ? `reason.${code}` : "reason.other");
    /** Sistem mesajı gövdesi: `PSP_<OLAY>:<durum>` (durum boş olabilir). */
    const event = (body: string) => {
      const rest = body.startsWith("PSP_") ? body.slice(4) : body;
      const sep = rest.indexOf(":");
      const kind = sep === -1 ? rest : rest.slice(0, sep);
      const code = sep === -1 ? "" : rest.slice(sep + 1).trim();
      const eventText = t(DISPUTE_EVENTS.has(kind) ? `event.${kind}` : "event.other");
      return code ? t("eventWithStatus", { event: eventText, status: status(code) }) : eventText;
    };
    return { status, reason, event };
  }, [t]);
}

/**
 * Ana birimdeki kullanıcı girdisini ("1.250", "1.250,50", "250.5") pozitif minor-unit'e
 * çevirir; binlik ayırıcıyı ondalık sanmaz. Geçersiz ya da sıfırsa null.
 */
export function parseMajorInput(value: string, currency: string): number | null {
  let digits: number;
  try {
    digits = currencyExponent(currency.toUpperCase());
  } catch {
    return null;
  }
  const minor = parseAmountToMinor(value, digits);
  return minor !== null && Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** Minor-unit → form alanı için ana birim metni (ör. 25000 → "250.00"). */
export function minorToInput(amountMinor: number, currency: string): string {
  try {
    return toDecimalString(money(amountMinor, currency));
  } catch {
    return String(amountMinor);
  }
}

const STATUS_COLORS: Record<ClaimStatus, string> = {
  OPEN: "bg-blue-100 text-blue-900",
  AWAITING_RESPONSE: "bg-amber-100 text-amber-900",
  ESCALATED: "bg-purple-100 text-purple-900",
  RESOLVED_APPROVED: "bg-green-100 text-green-900",
  RESOLVED_PARTIAL: "bg-teal-100 text-teal-900",
  RESOLVED_REJECTED: "bg-red-100 text-red-900",
  CLOSED: "bg-gray-200 text-gray-900",
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const t = useTranslations("resolution.status");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? STATUS_COLORS.CLOSED}`}
    >
      {CLAIM_STATUSES.includes(status) ? t(status) : status}
    </span>
  );
}

const HELP_ROLES: readonly string[] = ["OPENER", "RESPONDENT", "ADMIN"];

/** Durumun role göre açıklaması: şimdi ne oluyor, sizden ne bekleniyor, sonra ne olacak. */
export function ClaimStatusHelp({
  status,
  role,
  type,
}: {
  status: ClaimStatus;
  role: string;
  type?: ClaimType | null;
}) {
  const t = useTranslations("resolution");
  let text: string | null = null;
  if (type === "CHARGEBACK" && ACTIVE_STATUSES.includes(status)) {
    text = t("statusHelp.chargebackActive");
  } else if (CLAIM_STATUSES.includes(status) && HELP_ROLES.includes(role)) {
    text = t(`statusHelp.${status}.${role}`);
  }
  return text ? <p className="text-sm text-gray-700">{text}</p> : null;
}

const CLAIM_STEPS = ["opened", "response", "review", "decision"] as const;

/** Sürecin hangi adımında olunduğu: yanıt bekleniyor → 1, incelemede → 2, sonuçlandı → 3. */
function claimStepIndex(status: ClaimStatus): number {
  if (status === "AWAITING_RESPONSE") return 1;
  if (status === "OPEN" || status === "ESCALATED") return 2;
  return 3;
}

/**
 * Talep süreci adım göstergesi. Geçerli adım `aria-current` ve kalın yazıyla, tamamlanan
 * adımlar onay işaretiyle belirtilir (yalnız renge dayanmaz).
 */
export function ClaimSteps({ status }: { status: ClaimStatus }) {
  const t = useTranslations("resolution");
  const current = claimStepIndex(status);
  const last = CLAIM_STEPS.length - 1;
  return (
    <ol
      aria-label={t("steps.label")}
      className="flex flex-wrap items-center gap-x-2 text-sm text-gray-600"
    >
      {CLAIM_STEPS.map((key, idx) => {
        const done = idx < current || (idx === last && current === last);
        return (
          <li
            key={key}
            aria-current={idx === current ? "step" : undefined}
            className={
              idx === current ? "font-semibold text-gray-900" : done ? "text-gray-900" : undefined
            }
          >
            {idx > 0 && <span aria-hidden="true">· </span>}
            {done && <span aria-hidden="true">✓ </span>}
            {t(`steps.${key}`)}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Depozito özeti: tutar, durum, provizyon ve serbest bırakma zamanları. `viewerRole` verilirse
 * açıklama role göre yazılır (misafire "kartınız", diğerlerine "misafirin kartı"); kesinleşmiş
 * durumlarda (tahsil / serbest bırakma / süre dolumu / hata) gelecek zamanlı satırlar yerine
 * duruma uygun açıklama gösterilir.
 */
export function DepositSummary({
  deposit,
  expectedMinor,
  currency,
  viewerRole,
}: {
  deposit: DepositView | null;
  expectedMinor?: number | null;
  currency: string;
  viewerRole?: "GUEST" | "HOST" | "ADMIN";
}) {
  const t = useTranslations("resolution.deposit");
  const f = useFormat();
  const otherParty = viewerRole === "HOST" || viewerRole === "ADMIN";
  if (!deposit) {
    return (
      <p className="text-sm text-gray-700">
        {expectedMinor
          ? t(otherParty ? "expectedOther" : "expected", {
              amount: f.money(expectedMinor, currency),
            })
          : t("none")}
      </p>
    );
  }
  const { status } = deposit;
  const pending = status === "SCHEDULED" || status === "AUTHORIZED";
  const rows: Array<[string, string]> = [
    [t("status"), t(`statuses.${status}`)],
    [t("amount"), f.money(deposit.amountMinor, deposit.currency)],
  ];
  if (deposit.capturedMinor > 0) {
    rows.push([t("captured"), f.money(deposit.capturedMinor, deposit.currency)]);
  }
  if (deposit.authorizedAt) {
    rows.push([t("authorizedAt"), f.dateTime(deposit.authorizedAt)]);
  } else if (status === "SCHEDULED") {
    // FAILED'da "Provizyon zamanı" geçmişte kalmış bir plandır; gösterilmez.
    rows.push([t("authorizeAfter"), f.dateTime(deposit.authorizeAfter)]);
  }
  if (pending) rows.push([t("voidAfter"), f.dateTime(deposit.voidAfter)]);
  let note: string;
  if (status === "CAPTURED" || status === "CAPTURED_PARTIAL") {
    note = t("noteCaptured", { amount: f.money(deposit.capturedMinor, deposit.currency) });
  } else if (status === "VOIDED") note = t("noteVoided");
  else if (status === "EXPIRED") note = t("noteExpired");
  else if (status === "FAILED") note = t("noteFailed");
  else note = viewerRole === "GUEST" ? t("noteGuest") : t("note");
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md bg-gray-50 p-2">
            <dt className="text-gray-600">{label}</dt>
            <dd className="font-medium text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-gray-600">{note}</p>
    </div>
  );
}
