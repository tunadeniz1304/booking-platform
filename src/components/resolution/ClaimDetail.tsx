"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
  ClaimStatusHelp,
  ClaimSteps,
  DepositSummary,
  useClaimErrorText,
  useDisputeText,
  usePartyLabel,
  type ClaimDetailResponse,
  type ClaimType,
} from "./shared";

/** Yükleme sonucu: sayfa başlığını talebe göre güncellemek isteyen çağıranlar için. */
export type ClaimDetailResult =
  { status: "found"; detail: ClaimDetailResponse } | { status: "notFound" };

/** Sunucu, geri çekilen talebi bu karar notuyla CLOSED olarak kapatır. */
const WITHDRAWN_NOTE = "withdrawn";

/** Hızlı yüklemeler sessiz kalsın; daha uzun sürerse "Yükleniyor…" duyurulur. */
const LOADING_ANNOUNCE_DELAY_MS = 400;

const skeletonBlock = "rounded-md bg-gray-100 motion-safe:animate-pulse";

const HOUR_MS = 3_600_000;

/** Kalan süre metni için dakikada bir güncellenen saat (sunucuda ve ilk çizimde yok). */
function subscribeMinute(onChange: () => void) {
  const id = setInterval(onChange, 60_000);
  return () => clearInterval(id);
}
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const noMinute = () => null;

/** Kart başlığı düzeyi: yönetici görünümünde ayrıntı "Seçili talep" h2'sinin altına girer. */
type HeadingLevel = 2 | 3;

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

/** Aynı hatanın tekrar alınıp alınmadığını anlamak için kaba imza. */
function errorSignature(error: unknown): string {
  if (error instanceof ApiError) return `${error.status}|${error.code ?? ""}|${error.message}`;
  return error instanceof Error ? `${error.name}|${error.message}` : String(error);
}

type LoadState = {
  claimId: string;
  data: ClaimDetailResponse | null;
  failed: boolean;
  error: unknown;
  /**
   * Her sonuçta artar; aynı hata yeniden alındığında uyarı yeniden duyurulur. Arka plan
   * yenilemesi (yazışma yoklaması) aynı hatayı yeniden alırsa artmaz; uyarı tekrar okunmaz.
   */
  seq: number;
};

/**
 * Talep ayrıntısını yükler. Yeniden yükleme başarısız olursa eldeki ayrıntı korunur
 * (yazışma ve az önceki başarı mesajı kaybolmaz); 404 ayrı bir "bulunamadı" durumudur.
 */
function useClaimDetail(claimId: string, onResult?: (result: ClaimDetailResult) => void) {
  const [state, setState] = useState<LoadState | null>(null);
  const [request, setRequest] = useState({ version: 0, quiet: false });
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
        setState((prev) => {
          const same = prev?.claimId === claimId ? prev : null;
          const seq =
            request.quiet && same?.failed && errorSignature(same.error) === errorSignature(error)
              ? same.seq
              : (prev?.seq ?? 0) + 1;
          return { claimId, data: same?.data ?? null, failed: true, error, seq };
        });
        if (isNotFound(error)) onResultRef.current?.({ status: "notFound" });
      })
      .finally(() => {
        if (active) setReloading(false);
      });
    return () => {
      active = false;
    };
  }, [claimId, request]);
  const current = state?.claimId === claimId ? state : null;
  return {
    data: current?.data ?? null,
    failed: current?.failed ?? false,
    error: current?.error ?? null,
    seq: current?.seq ?? 0,
    reloading,
    reload: () => {
      setReloading(true);
      setRequest((r) => ({ version: r.version + 1, quiet: false }));
    },
    /** Arka plan yenilemesi: aynı hata tekrar alınırsa uyarı yeniden duyurulmaz. */
    refreshQuietly: () => {
      setReloading(true);
      setRequest((r) => ({ version: r.version + 1, quiet: true }));
    },
  };
}

/**
 * Talep ayrıntısı: özet, karar sonucu, depozito, yazışma ve kanıtlar.
 * `readOnly` (yönetici görünümü) taraf eylemlerini (yanıt / yükleme / geri çekme) gizler;
 * yönetici, aktif ve ters ibraz olmayan taleplerde taraflara mesaj yazabilir
 * (`canAdminMessage={false}` ile kapatılır). `renderAdmin` ile karar formu gibi ek içerik
 * detay verisiyle birlikte (yazışma ve kanıtların ardından) eklenir; `onResult` yükleme sonucunu
 * (bulundu / bulunamadı) bildirir. `headingLevel={3}` kart başlıklarını h3 yapar.
 */
export default function ClaimDetail({
  claimId,
  readOnly = false,
  canAdminMessage = true,
  renderAdmin,
  onResult,
  headingLevel = 2,
}: {
  claimId: string;
  readOnly?: boolean;
  canAdminMessage?: boolean;
  renderAdmin?: (detail: ClaimDetailResponse, reload: () => void) => ReactNode;
  onResult?: (result: ClaimDetailResult) => void;
  headingLevel?: HeadingLevel;
}) {
  const t = useTranslations("resolution");
  const tc = useTranslations("common");
  const claimError = useClaimErrorText();
  const { data, failed, error, seq, reloading, reload, refreshQuietly } = useClaimDetail(
    claimId,
    onResult
  );
  const [announceLoading, setAnnounceLoading] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnounceLoading(true), LOADING_ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

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
    // Durum bölgesi metinsiz bağlanır, metin gecikmeyle yazılır; böylece duyurulur.
    return (
      <div>
        <p role="status" className="sr-only">
          {announceLoading ? t("loading") : null}
        </p>
        <div aria-hidden="true" className="space-y-6">
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className={`h-6 w-48 ${skeletonBlock}`} />
            <div className={`h-5 w-32 ${skeletonBlock}`} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className={`h-14 ${skeletonBlock}`} />
              <div className={`h-14 ${skeletonBlock}`} />
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className={`h-6 w-40 ${skeletonBlock}`} />
            <div className={`h-20 ${skeletonBlock}`} />
          </div>
        </div>
      </div>
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
  const sides = partySides(claim.type);
  const side = claim.role === "OPENER" ? sides.opener : sides.respondent;
  const depositViewer = claim.role === "ADMIN" ? "ADMIN" : side === "host" ? "HOST" : "GUEST";

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
        headingLevel={headingLevel}
      />
      {!active && <ClaimOutcome detail={data} headingLevel={headingLevel} />}
      {data.deposit && (
        <Card title={t("deposit.title")} headingLevel={headingLevel}>
          <DepositSummary
            deposit={data.deposit}
            currency={data.deposit.currency}
            viewerRole={depositViewer}
          />
        </Card>
      )}
      <Card id="claim-messages">
        {/* Talep aktifken yazışma 30 sn'de bir yenilenir; yeni mesajlar duyurulur. */}
        <ClaimMessages
          claimId={claim.id}
          messages={data.messages}
          canReply={partyCanReply || adminCanReply}
          viewerRole={claim.role}
          claimType={claim.type}
          onSent={reload}
          onRefresh={refreshQuietly}
          live={active}
          refreshing={reloading}
          headingLevel={headingLevel}
        />
        {replyNote && <p className="mt-2 text-sm text-gray-700">{replyNote}</p>}
      </Card>
      <Card id="claim-evidence">
        <ClaimEvidence
          claimId={claim.id}
          evidence={data.evidence}
          canUpload={isParty && active}
          onUploaded={reload}
          claimType={claim.type}
          headingLevel={headingLevel}
        />
        {isParty && !active && (
          <p className="mt-2 text-sm text-gray-700">{t("detail.uploadClosed")}</p>
        )}
      </Card>
      {renderAdmin?.(data, reload)}
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
  headingLevel,
}: {
  detail: ClaimDetailResponse;
  canWithdraw: boolean;
  canReply: boolean;
  onChanged: () => void;
  headingLevel: HeadingLevel;
}) {
  const t = useTranslations("resolution");
  const f = useFormat();
  const claimError = useClaimErrorText();
  const partyLabel = usePartyLabel();
  const dispute = useDisputeText();
  const { confirm, confirmDialog } = useConfirm();
  const { claim, booking } = detail;
  const now = useSyncExternalStore<number | null>(subscribeMinute, currentMinute, noMinute);
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
    // "Talebi açan" yerine tarafın adı (misafir / ev sahibi / kart sahibi) gösterilir.
    rows.push([t("detail.yourRole"), partyLabel(claim.type, claim.role)]);
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

  const SubHeading = headingLevel === 3 ? "h4" : "h3";
  // Kalan süre listedeki gibi öne yazılır; saat ilk çizimde yoksa yalnız tarih gösterilir.
  const timeLeft = (due: string) => {
    const ms = now === null ? NaN : new Date(due).getTime() - now;
    if (!Number.isFinite(ms)) return null;
    if (ms <= 0) return t("list.deadlinePassed");
    if (ms < HOUR_MS) return t("list.timeLeftUnderHour");
    if (ms < 48 * HOUR_MS) return t("list.timeLeftHours", { count: Math.floor(ms / HOUR_MS) });
    return t("list.timeLeftDays", { count: Math.floor(ms / (24 * HOUR_MS)) });
  };
  const left = claim.slaDueAt ? timeLeft(claim.slaDueAt) : null;

  return (
    <Card title={t(`type.${claim.type}`)} headingLevel={headingLevel}>
      <div ref={statusRef} tabIndex={-1} className="mb-3 space-y-2 focus:outline-none">
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
          <ClaimStatusBadge status={claim.status} />
          {claim.propertyTitle && <span>{claim.propertyTitle}</span>}
        </div>
        <ClaimStatusHelp status={claim.status} role={claim.role} type={claim.type} />
      </div>
      {claim.status === "AWAITING_RESPONSE" &&
        claim.slaDueAt &&
        (claim.role === "RESPONDENT" || claim.role === "OPENER") && (
          <div className="mb-3 text-sm">
            <p className="font-medium text-amber-800">
              {left && <span className="font-semibold">{left} · </span>}
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
      {claim.type !== "CHARGEBACK" && (
        <div className="mb-3">
          <ClaimSteps status={claim.status} />
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
        {claim.externalStatus && (
          <li>{t("detail.external", { status: dispute.status(claim.externalStatus) })}</li>
        )}
        {claim.externalReason && (
          <li>{t("detail.externalReason", { reason: dispute.reason(claim.externalReason) })}</li>
        )}
      </ul>
      <SubHeading className="mt-4 text-sm font-semibold text-gray-900">
        {t("detail.description")}
      </SubHeading>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800 [overflow-wrap:anywhere]">
        {claim.description}
      </p>
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
function ClaimOutcome({
  detail,
  headingLevel,
}: {
  detail: ClaimDetailResponse;
  headingLevel: HeadingLevel;
}) {
  const t = useTranslations("resolution.outcome");
  const f = useFormat();
  const { claim } = detail;
  const SubHeading = headingLevel === 3 ? "h4" : "h3";

  if (claim.status === "CLOSED" && claim.decisionNote === WITHDRAWN_NOTE && claim.decidedAt) {
    const date = f.dateTime(claim.decidedAt);
    return (
      <Card title={t("withdrawnTitle")} headingLevel={headingLevel}>
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
    <Card title={t("title")} headingLevel={headingLevel}>
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
          <SubHeading className="mt-3 text-sm font-semibold text-gray-900">{t("note")}</SubHeading>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800 [overflow-wrap:anywhere]">
            {claim.decisionNote}
          </p>
        </>
      )}
    </Card>
  );
}
