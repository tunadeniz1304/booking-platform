"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api-client";
import { money, toDecimalString, toMinor } from "@/lib/money/money";
import { useFormat } from "@/i18n/use-format";
import { errorMessage } from "@/components/ui/ui";

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

/** Sunucudan gelen hata kodları; çevirisi olmayanlarda sunucu mesajı gösterilir. */
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
]);

/** Talep API hatasını kullanıcı diline çevirir (bilinmeyen kodda sunucu mesajına düşer). */
export function useClaimErrorText() {
  const t = useTranslations("resolution.errors");
  const tc = useTranslations("common");
  const f = useFormat();
  return useCallback(
    (err: unknown, currency?: string): string => {
      if (err instanceof ApiError && err.code && KNOWN_ERROR_CODES.has(err.code)) {
        if (err.code === "CLAIM_AMOUNT_EXCEEDS_REFUNDABLE") {
          const max = (err.details as { refundableMinor?: unknown } | undefined)?.refundableMinor;
          if (typeof max !== "number" || !currency) return err.message;
          return t(err.code, { amount: f.money(max, currency) });
        }
        return t(err.code);
      }
      return errorMessage(err, tc("unexpectedError"));
    },
    [t, tc, f]
  );
}

/** Ana birimdeki kullanıcı girdisini ("250,50") pozitif minor-unit'e çevirir; geçersizse null. */
export function parseMajorInput(value: string, currency: string): number | null {
  try {
    const minor = toMinor(value.trim().replace(",", "."), currency);
    return minor > 0 ? minor : null;
  } catch {
    return null;
  }
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

/** Depozito özeti: tutar, durum, provizyon ve serbest bırakma zamanları. */
export function DepositSummary({
  deposit,
  expectedMinor,
  currency,
}: {
  deposit: DepositView | null;
  expectedMinor?: number | null;
  currency: string;
}) {
  const t = useTranslations("resolution.deposit");
  const f = useFormat();
  if (!deposit) {
    return (
      <p className="text-sm text-gray-700">
        {expectedMinor ? t("expected", { amount: f.money(expectedMinor, currency) }) : t("none")}
      </p>
    );
  }
  const rows: Array<[string, string]> = [
    [t("status"), t(`statuses.${deposit.status}`)],
    [t("amount"), f.money(deposit.amountMinor, deposit.currency)],
  ];
  if (deposit.capturedMinor > 0) {
    rows.push([t("captured"), f.money(deposit.capturedMinor, deposit.currency)]);
  }
  rows.push(
    deposit.authorizedAt
      ? [t("authorizedAt"), f.dateTime(deposit.authorizedAt)]
      : [t("authorizeAfter"), f.dateTime(deposit.authorizeAfter)]
  );
  rows.push([t("voidAfter"), f.dateTime(deposit.voidAfter)]);
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
      <p className="text-xs text-gray-600">{t("note")}</p>
    </div>
  );
}
