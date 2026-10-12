"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch, logout } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  ButtonLink,
  Card,
  Status,
  focusRing,
  loginHref,
  useSession,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ClaimEvidence from "./ClaimEvidence";
import ClaimMessages from "./ClaimMessages";
import {
  ACTIVE_STATUSES,
  ClaimStatusBadge,
  DepositSummary,
  useClaimErrorText,
  type ClaimDetailResponse,
  type ClaimType,
} from "./shared";

/** Yükleme sonucu: sayfa başlığını talebe göre güncellemek isteyen çağıranlar için. */
export type ClaimDetailResult =
  { status: "found"; detail: ClaimDetailResponse } | { status: "notFound" };

/** Sunucu, geri çekilen talebi bu karar notuyla CLOSED olarak kapatır. */
const WITHDRAWN_NOTE = "withdrawn";

type PartySide = "guest" | "host" | "cardholder";

/** Talebi açan ve yanıtlayan tarafın kim olduğu talep türünden çıkar. */
function partySides(type: ClaimType): { opener: PartySide; respondent: PartySide } {
  if (type === "HOST_DAMAGE") return { opener: "host", respondent: "guest" };
  if (type === "CHARGEBACK") return { opener: "cardholder", respondent: "host" };
  return { opener: "guest", respondent: "host" };
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

type LoadState = {
  claimId: string;
  data: ClaimDetailResponse | null;
  failed: boolean;
  error: unknown;
  /** Her sonuçta artar; aynı hata yeniden alındığında uyarı yeniden duyurulur. */
  seq: number;
};

/**
 * Talep ayrıntısını yükler. Yeniden yükleme başarısız olursa eldeki ayrıntı korunur
 * (yazışma ve az önceki başarı mesajı kaybolmaz); 404 ayrı bir "bulunamadı" durumudur.
 */
function useClaimDetail(claimId: string, onResult?: (result: ClaimDetailResult) => void) {
  const [state, setState] = useState<LoadState | null>(null);
  const [version, setVersion] = useState(0);
  const [reloading, setReloading] = useState(false);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);
  useEffect(() => {
    let active = true;
    apiFetch<ClaimDetailResponse>(`/api/claims/${encodeURIComponent(claimId)}`)
      .then((data) => {
        if (!active) return;
        setState((prev) => ({
          claimId,
          data,
          failed: false,
          error: null,
          seq: (prev?.seq ?? 0) + 1,
        }));
        onResultRef.current?.({ status: "found", detail: data });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState((prev) => ({
          claimId,
          data: prev?.claimId === claimId ? prev.data : null,
          failed: true,
          error,
          seq: (prev?.seq ?? 0) + 1,
        }));
        if (isNotFound(error)) onResultRef.current?.({ status: "notFound" });
      })
      .finally(() => {
        if (active) setReloading(false);
      });
    return () => {
      active = false;
    };
  }, [claimId, version]);
  const current = state?.claimId === claimId ? state : null;
  return {
    data: current?.data ?? null,
    failed: current?.failed ?? false,
    error: current?.error ?? null,
    seq: current?.seq ?? 0,
    reloading,
    reload: () => {
      setReloading(true);
      setVersion((v) => v + 1);
    },
  };
}

/**
 * Talep ayrıntısı: özet, karar sonucu, depozito, yazışma ve kanıtlar.
 * `readOnly` (yönetici görünümü) taraf eylemlerini (yanıt / yükleme / geri çekme) gizler;
 * yönetici, aktif ve ters ibraz olmayan taleplerde taraflara mesaj yazabilir
 * (`canAdminMessage={false}` ile kapatılır). `renderAdmin` ile karar formu gibi ek içerik
 * detay verisiyle birlikte eklenir; `onResult` yükleme sonucunu (bulundu / bulunamadı) bildirir.
 */
export default function ClaimDetail({
  claimId,
  readOnly = false,
  canAdminMessage = true,
  renderAdmin,
  onResult,
}: {
  claimId: string;
  readOnly?: boolean;
  canAdminMessage?: boolean;
  renderAdmin?: (detail: ClaimDetailResponse, reload: () => void) => ReactNode;
  onResult?: (result: ClaimDetailResult) => void;
}) {
  const t = useTranslations("resolution");
  const tc = useTranslations("common");
  const claimError = useClaimErrorText();
  const { data, failed, error, seq, reloading, reload } = useClaimDetail(claimId, onResult);

  if (failed && !data) {
    if (!readOnly && isNotFound(error)) return <ClaimNotFound />;
    return (
      <div className="space-y-2">
        <Status key={seq} error={claimError(error)} />
        <Button variant="secondary" busy={reloading} onClick={reload}>
          {tc("retry")}
        </Button>
      </div>
    );
  }
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
  const writable = active && claim.type !== "CHARGEBACK";
  const partyCanReply = isParty && writable;
  const adminCanReply = canAdminMessage && claim.role === "ADMIN" && writable;
  const replyNote =
    isParty && !partyCanReply ? t(active ? "detail.replyChargeback" : "detail.replyClosed") : null;

  return (
    <div className="space-y-6">
      {failed && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Status key={seq} error={t("detail.stale", { error: claimError(error) })} />
          <Button variant="secondary" busy={reloading} onClick={reload}>
            {tc("retry")}
          </Button>
        </div>
      )}
      <ClaimOverview
        detail={data}
        canWithdraw={isParty && active && claim.role === "OPENER"}
        canReply={partyCanReply}
        onChanged={reload}
      />
      {!active && <ClaimOutcome detail={data} />}
      {renderAdmin?.(data, reload)}
      {data.deposit && (
        <Card title={t("deposit.title")}>
          <DepositSummary deposit={data.deposit} currency={data.deposit.currency} />
        </Card>
      )}
      <Card id="claim-messages">
        <ClaimMessages
          claimId={claim.id}
          messages={data.messages}
          canReply={partyCanReply || adminCanReply}
          viewerRole={claim.role}
          onSent={reload}
        />
        {replyNote && <p className="mt-2 text-sm text-gray-700">{replyNote}</p>}
      </Card>
      <Card id="claim-evidence">
        <ClaimEvidence
          claimId={claim.id}
          evidence={data.evidence}
          canUpload={isParty && active}
          onUploaded={reload}
        />
        {isParty && !active && (
          <p className="mt-2 text-sm text-gray-700">{t("detail.uploadClosed")}</p>
        )}
      </Card>
    </div>
  );
}

/**
 * Talep bulunamadı (404): sunucu, taraf olmayan kullanıcıya da kasıtlı olarak aynı yanıtı
 * verir; bu yüzden olası nedenler, oturumdaki hesap ve sonraki adımlar gösterilir.
 */
function ClaimNotFound() {
  const t = useTranslations("resolution.detail.notFound");
  const session = useSession();
  const [switching, setSwitching] = useState(false);
  const email = session.status === "ready" ? session.user?.email : undefined;
  const title = t("title");

  useEffect(() => {
    const previous = document.title;
    document.title = `${title} – ${previous}`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  async function switchAccount() {
    setSwitching(true);
    await logout();
    window.location.assign(loginHref(window.location.pathname));
  }

  return (
    <section
      aria-labelledby="claim-not-found-title"
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <h2 id="claim-not-found-title" className="text-lg font-semibold text-gray-900">
        {title}
      </h2>
      <p className="mt-2 text-sm text-gray-800">{t("body")}</p>
      {email && <p className="mt-2 text-sm text-gray-700">{t("signedInAs", { email })}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <ButtonLink href="/resolution">{t("back")}</ButtonLink>
        <Button variant="secondary" busy={switching} onClick={() => void switchAccount()}>
          {t("switchAccount")}
        </Button>
        <ButtonLink href="/support" variant="secondary">
          {t("support")}
        </ButtonLink>
      </div>
    </section>
  );
}

function ClaimOverview({
  detail,
  canWithdraw,
  canReply,
  onChanged,
}: {
  detail: ClaimDetailResponse;
  canWithdraw: boolean;
  canReply: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("resolution");
  const f = useFormat();
  const claimError = useClaimErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const { claim, booking } = detail;
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const statusRef = useRef<HTMLDivElement>(null);

  async function withdraw() {
    if (busy) return;
    const ok = await confirm({
      title: t("detail.withdrawConfirmTitle"),
      body:
        claim.type === "HOST_DAMAGE"
          ? t("detail.withdrawConfirmDamage")
          : t("detail.withdrawConfirm"),
      confirmLabel: t("detail.withdraw"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setFeedback({});
    try {
      await apiFetch(`/api/claims/${encodeURIComponent(claim.id)}/withdraw`, { method: "POST" });
      setFeedback({ message: t("detail.withdrawn") });
      // Geri çekme düğmesi yeniden yüklemede kalkar; odak durum satırına taşınır.
      statusRef.current?.focus();
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
  ];
  if (claim.role === "ADMIN") {
    // Yönetici için "Rolünüz" bilgi taşımaz; tarafların kim olduğu gösterilir.
    const sides = partySides(claim.type);
    rows.push(
      [t("role.OPENER"), t(`detail.party.${sides.opener}`)],
      [t("role.RESPONDENT"), t(`detail.party.${sides.respondent}`)]
    );
  } else {
    rows.push([t("detail.yourRole"), t(`role.${claim.role}`)]);
  }
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
      <div
        ref={statusRef}
        tabIndex={-1}
        className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-700 focus:outline-none"
      >
        <ClaimStatusBadge status={claim.status} />
        {claim.propertyTitle && <span>{claim.propertyTitle}</span>}
      </div>
      {claim.status === "AWAITING_RESPONSE" &&
        claim.slaDueAt &&
        (claim.role === "RESPONDENT" || claim.role === "OPENER") && (
          <div className="mb-3 text-sm">
            <p className="font-medium text-amber-800">
              {claim.role === "RESPONDENT"
                ? t("list.respondCta", { date: f.dateTime(claim.slaDueAt) })
                : t("list.awaitingOther", { date: f.dateTime(claim.slaDueAt) })}
            </p>
            {claim.role === "RESPONDENT" && canReply && (
              <a
                href={`#claim-msg-${claim.id}`}
                className={`inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-0 ${focusRing}`}
              >
                {t("list.respondNow")}
              </a>
            )}
          </div>
        )}
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
          <Button variant="danger" busy={busy} onClick={() => void withdraw()}>
            {busy ? t("detail.withdrawing") : t("detail.withdraw")}
          </Button>
        </div>
      )}
      <Status error={feedback.error} message={feedback.message} />
      {confirmDialog}
    </Card>
  );
}

type OutcomeRow = { label: string; value: number | null; hint?: string; always?: boolean };

/**
 * Sonuçlanmış talebin karar özeti. Tutar etiketleri talep türüne ve bakanın tarafına göre
 * yazılır (misafir / ev sahibi); platformun karşıladığı tutar yalnız yöneticiye gösterilir.
 * Geri çekilen talepte karar kartı yerine geri çekme bilgisi gösterilir.
 */
function ClaimOutcome({ detail }: { detail: ClaimDetailResponse }) {
  const t = useTranslations("resolution.outcome");
  const f = useFormat();
  const { claim } = detail;

  if (claim.status === "CLOSED" && claim.decisionNote === WITHDRAWN_NOTE && claim.decidedAt) {
    const date = f.dateTime(claim.decidedAt);
    return (
      <Card title={t("withdrawnTitle")}>
        <p className="text-sm text-gray-800">
          {claim.role === "OPENER"
            ? t("withdrawnByYou", { date })
            : t("withdrawnByOpener", { date })}
        </p>
      </Card>
    );
  }

  const sides = partySides(claim.type);
  const side =
    claim.role === "ADMIN" ? null : claim.role === "OPENER" ? sides.opener : sides.respondent;
  const guest = side === "guest";
  let settled: Pick<OutcomeRow, "label" | "hint"> = { label: t("settled") };
  let uncollected: Pick<OutcomeRow, "label" | "hint"> = { label: t("uncollected") };
  if (claim.type === "GUEST_REFUND") {
    settled = guest
      ? { label: t("settledRefundGuest"), hint: t("refundHint") }
      : { label: t("settledRefund") };
  } else if (claim.type === "HOST_DAMAGE") {
    settled = { label: guest ? t("settledDamageGuest") : t("settledDamage") };
    if (guest) uncollected = { label: t("uncollectedGuest"), hint: t("uncollectedGuestHint") };
    else if (side === "host") uncollected = { label: t("uncollectedHost") };
  }
  const amounts: OutcomeRow[] = [
    { label: t("awarded"), value: claim.awardedMinor, always: true },
    { ...settled, value: claim.settledMinor },
    { ...uncollected, value: claim.uncollectedMinor },
  ];
  if (claim.role === "ADMIN") {
    amounts.push({ label: t("platformCovered"), value: claim.platformCoveredMinor });
  }
  // Onaylanan tutar her zaman, diğerleri yalnızca sıfırdan büyükse gösterilir.
  const shown = amounts.filter((a) => a.value !== null && (a.always || a.value > 0));
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
          {shown.map(({ label, value, hint }) => (
            <div key={label} className="rounded-md bg-gray-50 p-2">
              <dt className="text-gray-600">{label}</dt>
              <dd className="font-medium text-gray-900">
                {f.money(value ?? 0, claim.currency)}
                {hint && (
                  <span className="mt-1 block text-xs font-normal text-gray-600">{hint}</span>
                )}
              </dd>
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
