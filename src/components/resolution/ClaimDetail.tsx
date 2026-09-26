"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Card, Status, useLoader } from "@/components/ui/ui";
import ClaimEvidence from "./ClaimEvidence";
import ClaimMessages from "./ClaimMessages";
import {
  ACTIVE_STATUSES,
  ClaimStatusBadge,
  DepositSummary,
  useClaimErrorText,
  type ClaimDetailResponse,
} from "./shared";

/**
 * Talep ayrıntısı: özet, karar sonucu, depozito, yazışma ve kanıtlar.
 * `readOnly` (yönetici görünümü) yanıt / yükleme / geri çekme eylemlerini gizler;
 * `renderAdmin` ile karar formu gibi ek içerik detay verisiyle birlikte eklenir.
 */
export default function ClaimDetail({
  claimId,
  readOnly = false,
  renderAdmin,
}: {
  claimId: string;
  readOnly?: boolean;
  renderAdmin?: (detail: ClaimDetailResponse, reload: () => void) => ReactNode;
}) {
  const t = useTranslations("resolution");
  const { data, error, reload } = useLoader(
    () => apiFetch<ClaimDetailResponse>(`/api/claims/${encodeURIComponent(claimId)}`),
    [claimId]
  );

  if (error) return <Status error={error} />;
  if (!data) {
    return (
      <p aria-live="polite" className="text-sm text-gray-600">
        {t("loading")}
      </p>
    );
  }
  const { claim } = data;
  const active = ACTIVE_STATUSES.includes(claim.status);
  const isParty = !readOnly && claim.role !== "ADMIN";
  // Ters ibrazda yazışma ödeme sağlayıcısı üzerinden yürür; taraflar yalnızca kanıt ekler.
  const canReply = isParty && active && claim.type !== "CHARGEBACK";

  return (
    <div className="space-y-6">
      <ClaimOverview
        detail={data}
        canWithdraw={isParty && active && claim.role === "OPENER"}
        onChanged={reload}
      />
      {!active && <ClaimOutcome detail={data} />}
      {renderAdmin?.(data, reload)}
      {data.deposit && (
        <Card title={t("deposit.title")}>
          <DepositSummary deposit={data.deposit} currency={data.deposit.currency} />
        </Card>
      )}
      <Card>
        <ClaimMessages
          claimId={claim.id}
          messages={data.messages}
          canReply={canReply}
          onSent={reload}
        />
      </Card>
      <Card>
        <ClaimEvidence
          claimId={claim.id}
          evidence={data.evidence}
          canUpload={isParty && active}
          onUploaded={reload}
        />
      </Card>
    </div>
  );
}

function ClaimOverview({
  detail,
  canWithdraw,
  onChanged,
}: {
  detail: ClaimDetailResponse;
  canWithdraw: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("resolution");
  const f = useFormat();
  const claimError = useClaimErrorText();
  const { claim, booking } = detail;
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});

  async function withdraw() {
    if (!window.confirm(t("detail.withdrawConfirm"))) return;
    setBusy(true);
    setFeedback({});
    try {
      await apiFetch(`/api/claims/${encodeURIComponent(claim.id)}/withdraw`, { method: "POST" });
      setFeedback({ message: t("detail.withdrawn") });
      onChanged();
    } catch (err) {
      setFeedback({ error: claimError(err) });
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<[string, string]> = [
    [t("detail.requested"), f.money(claim.amountRequestedMinor, claim.currency)],
    [t("detail.created"), f.dateTime(claim.createdAt)],
    [t("detail.yourRole"), t(`role.${claim.role}`)],
  ];
  if (claim.status === "AWAITING_RESPONSE" && claim.slaDueAt) {
    rows.push([t("detail.sla"), f.dateTime(claim.slaDueAt)]);
  }
  if (booking) {
    rows.push([
      t("detail.booking"),
      t("detail.stay", {
        checkIn: f.date(booking.checkIn, "medium"),
        checkOut: f.date(booking.checkOut, "medium"),
      }),
    ]);
  }

  return (
    <Card title={t(`type.${claim.type}`)}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <ClaimStatusBadge status={claim.status} />
        {claim.propertyTitle && <span>{claim.propertyTitle}</span>}
      </div>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md bg-gray-50 p-2">
            <dt className="text-gray-600">{label}</dt>
            <dd className="font-medium text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
      <ul className="mt-2 space-y-1 text-xs text-gray-600">
        {booking && claim.type === "GUEST_REFUND" && (
          <li>
            {t("detail.refundable", { amount: f.money(booking.refundableMinor, claim.currency) })}
          </li>
        )}
        {claim.respondedAt && (
          <li>{t("detail.responded", { date: f.dateTime(claim.respondedAt) })}</li>
        )}
        {claim.escalatedAt && (
          <li>{t("detail.escalated", { date: f.dateTime(claim.escalatedAt) })}</li>
        )}
        {claim.externalStatus && <li>{t("detail.external", { status: claim.externalStatus })}</li>}
        {claim.externalReason && (
          <li>{t("detail.externalReason", { reason: claim.externalReason })}</li>
        )}
      </ul>
      <h3 className="mt-4 text-sm font-semibold text-gray-900">{t("detail.description")}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{claim.description}</p>
      {canWithdraw && (
        <div className="mt-4">
          <Button variant="danger" disabled={busy} onClick={() => void withdraw()}>
            {t("detail.withdraw")}
          </Button>
        </div>
      )}
      <Status error={feedback.error} message={feedback.message} />
    </Card>
  );
}

/** Sonuçlanmış talebin karar özeti (onaylanan / ödenen / tahsil edilemeyen tutarlar). */
function ClaimOutcome({ detail }: { detail: ClaimDetailResponse }) {
  const t = useTranslations("resolution.outcome");
  const f = useFormat();
  const { claim } = detail;
  const amounts: Array<[string, number | null]> = [
    [t("awarded"), claim.awardedMinor],
    [t("settled"), claim.settledMinor],
    [t("uncollected"), claim.uncollectedMinor],
    [t("platformCovered"), claim.platformCoveredMinor],
  ];
  // Onaylanan tutar her zaman, diğerleri yalnızca sıfırdan büyükse gösterilir.
  const shown = amounts.filter(([, v], i) => v !== null && (i === 0 || v > 0));
  if (!claim.decidedAt && shown.length === 0 && !claim.decisionNote) return null;
  return (
    <Card title={t("title")}>
      {claim.decidedAt && (
        <p className="mb-2 text-sm text-gray-700">
          {t("decidedAt", { date: f.dateTime(claim.decidedAt) })}
        </p>
      )}
      {shown.length > 0 && (
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {shown.map(([label, value]) => (
            <div key={label} className="rounded-md bg-gray-50 p-2">
              <dt className="text-gray-600">{label}</dt>
              <dd className="font-medium text-gray-900">{f.money(value ?? 0, claim.currency)}</dd>
            </div>
          ))}
        </dl>
      )}
      {claim.decisionNote && (
        <>
          <h3 className="mt-3 text-sm font-semibold text-gray-900">{t("note")}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{claim.decisionNote}</p>
        </>
      )}
    </Card>
  );
}
