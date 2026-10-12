"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { parseAmountToMinor } from "@/lib/ui/amount-input";
import { useErrorText } from "@/components/ui/ui";
import type { ShareDTO, SplitPlanDTO } from "@/lib/cart/split-payment";

interface Row {
  email: string;
  amount: string;
}

/** Plan okumasının durumu: ilk yanıt gelene kadar "loading", okunamazsa "error". */
export type SplitLoadState = "loading" | "ready" | "error";

const field =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]";

const STATUS_TONE: Record<string, string> = {
  INVITED: "bg-gray-100 text-gray-700",
  REQUIRES_ACTION: "bg-amber-100 text-amber-800",
  AUTHORIZED: "bg-blue-100 text-blue-800",
  CAPTURED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-700",
  VOIDED: "bg-gray-100 text-gray-700",
  REFUNDED: "bg-gray-100 text-gray-700",
  EXPIRED: "bg-gray-100 text-gray-700",
};

/** Sunucu hata kodları → `cart.split.errors.*` (sunucunun Türkçe iletisi gösterilmez). */
const ERROR_CODES = new Set([
  "SPLIT_DUPLICATE_EMAIL",
  "SPLIT_AMOUNT_INVALID",
  "SPLIT_SHARE_COUNT",
  "SPLIT_EXISTS",
  "SPLIT_CLOSED",
  "SPLIT_DEADLINE_PASSED",
  "SHARE_EMAIL_REQUIRED",
  "SHARE_NOT_INVITABLE",
  "CART_NOT_HELD",
  "CART_PAYMENT_IN_PROGRESS",
  "VALIDATION_ERROR",
]);

/** Organizatör dışındaki en fazla katılımcı (SPLIT_PAY_MAX_SHARES = 10, organizatör dahil). */
const MAX_PARTICIPANTS = 9;
/** Açık planda pay durumlarının yoklama aralığı (yalnız sekme görünürken). */
const POLL_MS = 15_000;
const PAID = new Set<string>(["AUTHORIZED", "CAPTURED"]);

/** Para biriminin ondalık hane sayısı (TRY/USD/EUR → 2). */
function fractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Davet linkinden uygulama içi yol (/pay/share/<token>). */
function localPath(url: string): string {
  const i = url.indexOf("/pay/share/");
  return i >= 0 ? url.slice(i) : url;
}

/**
 * Bölünmüş ödeme (P1-2) paneli: plan yoksa (ya da son plan iptal edildiyse) organizatör payları
 * tanımlar (eşit / özel tutar); plan varsa pay durum listesi (görünür sekmede yoklanır), davet
 * linkini kopyala / e-postayla gönder ve organizatörün kendi payını ödeme bağlantısı.
 * `allowCreate=false` → yalnız durum listesi (sepet sayfası). `onLoadState` ilk okuma bitene
 * kadar "loading", okunamazsa "error" bildirir (checkout tek ödeme formunu o zamana dek gizler).
 */
export function SplitPayPanel({
  cartId,
  totalMinor,
  currency,
  allowCreate,
  onPlan,
  onLoadState,
}: {
  cartId: string;
  totalMinor: number;
  currency: string;
  allowCreate: boolean;
  onPlan?: (plan: SplitPlanDTO | null) => void;
  onLoadState?: (state: SplitLoadState) => void;
}) {
  const t = useTranslations("cart.split");
  const f = useFormat();
  const errText = useErrorText();
  const baseId = useId();
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);
  const justCreated = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const [plan, setPlan] = useState<SplitPlanDTO | null>(null);
  const [loadState, setLoadState] = useState<SplitLoadState>("loading");
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [update, setUpdate] = useState<string | null>(null);
  const [mode, setMode] = useState<"equal" | "custom">("equal");
  const [rows, setRows] = useState<Row[]>([{ email: "", amount: "" }]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [srNotice, setSrNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [maxParticipants, setMaxParticipants] = useState(MAX_PARTICIPANTS);
  const [manualId, setManualId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<{ id: string; text: string } | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const planRef = useRef<SplitPlanDTO | null>(null);
  const readyRef = useRef(false);
  const inFlight = useRef(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const focusRow = useRef<number | null>(null);
  const headingId = `${baseId}-title`;

  /** Bilinen kodu çevirir; genel kodlar `common.errors`, gerisi verilen yerel metin. */
  const apiText = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof ApiError) {
        if (err.code && ERROR_CODES.has(err.code)) return t(`errors.${err.code}`);
        const generic = errText(err);
        return generic !== err.message ? generic : fallback;
      }
      return err instanceof Error ? errText(err) : fallback;
    },
    [t, errText]
  );

  const shareName = (s: ShareDTO) =>
    s.isFallback
      ? t("fallbackLabel")
      : s.isOrganizer
        ? t("you")
        : (s.participantEmail ?? t("anonymous", { n: s.position }));

  /** Yoklamada değişen durumların kısa duyurusu ("… payını ödedi (2/3)"); yoksa null. */
  const describeChange = (prev: SplitPlanDTO | null, next: SplitPlanDTO | null) => {
    if (!prev || !next || prev.id !== next.id) return null;
    const before = new Map(prev.shares.map((s) => [s.id, s.status as string] as const));
    const counted = next.shares.filter((s) => s.status !== "EXPIRED");
    const paid = counted.filter((s) => PAID.has(s.status)).length;
    const parts: string[] = [];
    for (const s of next.shares) {
      const was = before.get(s.id);
      if (!s.isOrganizer && !s.isFallback && PAID.has(s.status) && was && !PAID.has(was)) {
        parts.push(t("sharePaid", { name: shareName(s), paid, count: counted.length }));
      }
    }
    if (next.status !== prev.status) {
      parts.push(t("planChanged", { status: t(`planStatus.${next.status}`) }));
    }
    return parts.length > 0 ? parts.join(" ") : null;
  };

  // Geri çağrılar ref'te tutulur: üst bileşen satır içi fonksiyon verse de `load` kararlı kalır.
  const latest = useRef({ onPlan, onLoadState, describeChange });
  useEffect(() => {
    latest.current = { onPlan, onLoadState, describeChange };
  });

  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach(clearTimeout);
  }, []);

  const apply = useCallback((next: SplitPlanDTO | null) => {
    planRef.current = next;
    setPlan(next);
    latest.current.onPlan?.(next);
  }, []);

  const report = useCallback((state: SplitLoadState) => {
    setLoadState(state);
    latest.current.onLoadState?.(state);
  }, []);

  /** Planı okur; ilk okuma başarısızsa "error", sonraki (yoklama) hatalarında eski plan kalır. */
  const load = useCallback(
    async (manual = false): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      if (manual) setRefreshing(true);
      else if (!readyRef.current) report("loading");
      try {
        const res = await apiFetch<{ plan: SplitPlanDTO | null; maxShares?: number }>(
          `/api/cart/${cartId}/split`,
          { cache: "no-store" }
        );
        const change = latest.current.describeChange(planRef.current, res.plan);
        apply(res.plan);
        // Sunucu sınırı (organizatör dahil) yanıtta varsa istemcideki varsayılanın yerine geçer.
        if (typeof res.maxShares === "number" && res.maxShares >= 2) {
          setMaxParticipants(res.maxShares - 1);
        }
        readyRef.current = true;
        report("ready");
        setRefreshFailed(false);
        setCheckedAt(Date.now());
        if (change) setUpdate(change);
        return true;
      } catch {
        if (readyRef.current) setRefreshFailed(true);
        else report("error");
        return false;
      } finally {
        inFlight.current = false;
        if (manual) setRefreshing(false);
      }
    },
    [cartId, apply, report]
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Plan oluşunca odak durum bölümünün başlığına taşınır (form DOM'dan kalkar).
  useEffect(() => {
    if (plan && justCreated.current) {
      justCreated.current = false;
      statusHeadingRef.current?.focus();
    }
  }, [plan]);

  // Son ödeme saatine kalan süre yarım dakikada bir güncellenir.
  const planOpen = plan?.status === "COLLECTING" || plan?.status === "FALLBACK";
  useEffect(() => {
    if (!planOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [planOpen]);

  // Açık planda pay durumları görünür sekmede yoklanır; sekmeye dönünce hemen yenilenir.
  useEffect(() => {
    if (!planOpen) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [planOpen, load]);

  // Paylaşım menüsü (Web Share) yalnız istemcide algılanır; sunucu çıktısıyla uyuşmazlık olmaz.
  useEffect(() => {
    const timer = setTimeout(() => setCanShare(typeof navigator.share === "function"), 0);
    return () => clearTimeout(timer);
  }, []);

  // Satır kaldırılınca odak, yerine geçen (ya da son) satırın e-posta alanına taşınır.
  useEffect(() => {
    if (focusRow.current === null) return;
    document.getElementById(`${baseId}-email-${focusRow.current}`)?.focus();
    focusRow.current = null;
  }, [rows, baseId]);

  // Pano izni yoksa açılan link alanı seçili gelir (kullanıcı Ctrl+C ile kopyalar).
  useEffect(() => {
    if (!manualId) return;
    const input = document.getElementById(`${baseId}-link-${manualId}`);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }, [manualId, baseId]);

  /** Anahtar başına tek zamanlayıcı; bileşen kalkınca hepsi temizlenir. */
  function later(key: string, fn: () => void, ms: number) {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, ms);
  }

  /** Canlı bölgeye geçici metin; aynı metin art arda gelse de yeniden duyurulur. */
  function flash(key: string, set: (v: string | null) => void, text: string, ms: number) {
    set(null);
    later(
      key,
      () => {
        set(text);
        later(key, () => set(null), ms);
      },
      100
    );
  }

  const digits = fractionDigits(currency);
  const people = rows.length + 1;
  const equalShare = Math.floor(totalMinor / people);
  const amounts = rows.map((r) =>
    mode === "custom" ? parseAmountToMinor(r.amount, digits) : null
  );
  const normalizedEmails = rows.map((r) => r.email.trim().toLowerCase());
  const rowErrors = rows.map((r, i) => {
    const email =
      normalizedEmails[i] !== "" && normalizedEmails.indexOf(normalizedEmails[i]) !== i
        ? t("errors.emailDuplicate")
        : null;
    let amount: string | null = null;
    if (mode === "custom") {
      const v = amounts[i];
      if (r.amount.trim() === "") amount = t("errors.amountRequired");
      else if (v === null || v <= 0) amount = t("errors.amountInvalid");
    }
    return { email, amount };
  });
  const customValid = mode === "custom" && rowErrors.every((e) => !e.amount);
  const customSum = amounts.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const organizerMinor =
    mode === "equal" ? totalMinor - equalShare * rows.length : totalMinor - customSum;
  const overTotal = customValid && organizerMinor < 0;
  const organizerKnown = mode === "equal" || (customValid && !overTotal);
  const hasRowError = rowErrors.some((e) => e.email || e.amount);
  const showError = (key: string) => attempted || !!touched[key];
  const fieldId = (kind: "email" | "amount", i: number) => `${baseId}-${kind}-${i}`;
  const touch = (key: string) =>
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));

  /** Ödeyecek kişi sayısı (organizatör dahil) → katılımcı satırları (sondan eklenir/çıkarılır). */
  function setPeople(next: number) {
    const count = Math.min(maxParticipants, Math.max(1, next - 1));
    if (count === rows.length) return;
    const added: Row[] = [];
    for (let i = rows.length; i < count; i++) added.push({ email: "", amount: "" });
    setRows([...rows.slice(0, count), ...added]);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setMessage(null);
    if (hasRowError || overTotal) {
      // Gönderim engellenir; nedeni alan altında yazar ve odak ilk hatalı alana gider.
      setAttempted(true);
      const first = rowErrors.findIndex((r) => r.email || r.amount);
      const target =
        first >= 0
          ? fieldId(rowErrors[first].email ? "email" : "amount", first)
          : fieldId("amount", 0);
      document.getElementById(target)?.focus();
      return;
    }
    setBusy(true);
    try {
      const participants = rows.map((r, i) => ({
        email: r.email.trim() || null,
        ...(mode === "custom" ? { amountMinor: amounts[i] ?? 0 } : {}),
      }));
      const res = await apiFetch<{ plan: SplitPlanDTO }>(`/api/cart/${cartId}/split`, {
        method: "POST",
        body: JSON.stringify({ mode, participants }),
      });
      justCreated.current = true;
      apply(res.plan);
      setUpdate(null);
      setCheckedAt(Date.now());
    } catch (err) {
      setMessage(apiText(err, t("createFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function copy(share: ShareDTO) {
    if (!share.inviteUrl) return;
    setMessage(null);
    try {
      await navigator.clipboard.writeText(share.inviteUrl);
      setManualId(null);
      setCopiedId(share.id);
      later("copied", () => setCopiedId(null), 2000);
      flash("sr", setSrNotice, t("copiedFor", { name: shareName(share) }), 5000);
    } catch {
      // Pano izni yok: ham prompt yerine satır içinde seçili, salt-okunur link alanı.
      setCopiedId(null);
      if (manualId === share.id) {
        const input = document.getElementById(`${baseId}-link-${share.id}`);
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      } else {
        setManualId(share.id);
      }
    }
  }

  /** Telefonun paylaşım menüsü (WhatsApp, SMS…); kapatılırsa sessiz, hatada kopyalamaya düşer. */
  async function shareLink(share: ShareDTO) {
    if (!share.inviteUrl) return;
    try {
      await navigator.share({
        title: t("share.title"),
        text: t("shareText", { amount: f.money(share.amountMinor, share.currency) }),
        url: share.inviteUrl,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      await copy(share);
    }
  }

  async function refresh() {
    if (await load(true)) {
      flash("sr", setSrNotice, t("lastUpdated", { time: f.time(new Date()) }), 5000);
    }
  }

  async function sendInvite(e: React.FormEvent, share: ShareDTO) {
    e.preventDefault();
    if (busy) return;
    setMessage(null);
    setInviteError(null);
    setSentId(null);
    const email = emails[share.id]?.trim() || share.participantEmail || null;
    if (!email) {
      setInviteError({ id: share.id, text: t("errors.SHARE_EMAIL_REQUIRED") });
      document.getElementById(`${baseId}-invite-${share.id}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ plan: SplitPlanDTO }>(
        `/api/cart/${cartId}/split/shares/${share.id}/invite`,
        { method: "POST", body: JSON.stringify({ email }) }
      );
      apply(res.plan);
      // Geri bildirim satırda (düğme etiketi) ve canlı bölgede; alıcıyla, tekrarda da duyurulur.
      setSentId(share.id);
      later("sent", () => setSentId(null), 3000);
      flash("sr", setSrNotice, t("sentTo", { name: email }), 5000);
    } catch (err) {
      setMessage(apiText(err, t("sendFailed")));
    } finally {
      setBusy(false);
    }
  }

  if (loadState === "loading") {
    if (!allowCreate) return null;
    return (
      <section
        className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        aria-labelledby={headingId}
        aria-busy="true"
        data-testid="split-loading"
      >
        <h2 id={headingId} className="text-lg font-semibold text-gray-900">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{t("loading")}</p>
        <div className="mt-4 space-y-3" aria-hidden="true">
          <div className="h-4 w-2/3 rounded bg-gray-100 motion-safe:animate-pulse" />
          <div className="h-10 rounded bg-gray-100 motion-safe:animate-pulse" />
        </div>
      </section>
    );
  }

  if (loadState === "error") {
    return (
      <section
        className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        aria-labelledby={headingId}
        data-testid="split-load-error"
      >
        <h2 id={headingId} className="text-lg font-semibold text-gray-900">
          {t("title")}
        </h2>
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {t("loadFailed")}
        </p>
        <button
          type="button"
          onClick={() => {
            if (!refreshing) void load(true);
          }}
          aria-busy={refreshing || undefined}
          className="mt-3 min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
        >
          {refreshing ? t("refreshing") : t("retry")}
        </button>
      </section>
    );
  }

  const alerts = (
    <div aria-live="polite">
      {message && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </p>
      )}
    </div>
  );

  const renderShares = (p: SplitPlanDTO, actions: boolean) => (
    <ul className="mt-4 divide-y divide-gray-100" aria-label={t("sharesTitle")}>
      {p.shares.map((s) => {
        const name = shareName(s);
        const copied = copiedId === s.id;
        const sent = sentId === s.id;
        const inviteId = `${baseId}-invite-${s.id}`;
        const linkId = `${baseId}-link-${s.id}`;
        const inviteErr = inviteError?.id === s.id ? inviteError.text : null;
        return (
          <li key={s.id} className="py-3" data-testid="split-share">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 text-gray-800 [overflow-wrap:anywhere]">{name}</span>
              <span className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">
                  {f.money(s.amountMinor, s.currency)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s.status] ?? ""}`}
                >
                  {t(`status.${s.status}`)}
                </span>
              </span>
            </div>
            {actions && s.inviteUrl && (
              <div className="mt-2 flex flex-wrap items-end gap-2 text-sm">
                {s.isOrganizer ? (
                  <Link
                    href={localPath(s.inviteUrl)}
                    className="rounded-md bg-[#003580] px-3 py-1 font-semibold text-white"
                  >
                    {s.isFallback ? t("payRemaining") : t("payMine")}
                  </Link>
                ) : (
                  <>
                    {canShare && (
                      <button
                        type="button"
                        onClick={() => void shareLink(s)}
                        aria-label={t("shareLinkFor", { name })}
                        className="rounded-md border border-gray-300 px-3 py-1 font-semibold text-gray-800"
                      >
                        {t("shareLink")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void copy(s)}
                      aria-label={copied ? t("copiedFor", { name }) : t("copyLinkFor", { name })}
                      className="rounded-md border border-gray-300 px-3 py-1 font-semibold text-gray-800"
                    >
                      {copied ? (
                        <>
                          {t("copied")} <span aria-hidden="true">✓</span>
                        </>
                      ) : (
                        t("copyLink")
                      )}
                    </button>
                    <form
                      onSubmit={(e) => void sendInvite(e, s)}
                      className="flex flex-wrap items-end gap-2"
                    >
                      {!s.participantEmail && (
                        <div className="flex flex-col">
                          <label htmlFor={inviteId} className="text-xs font-medium text-gray-700">
                            {t("inviteEmailLabel")}
                            <span className="sr-only"> · {name}</span>
                          </label>
                          <input
                            id={inviteId}
                            type="email"
                            autoComplete="off"
                            placeholder={t("invitePlaceholder")}
                            className="w-48 rounded-md border border-gray-300 px-2 py-1 text-sm"
                            value={emails[s.id] ?? ""}
                            aria-invalid={inviteErr ? true : undefined}
                            aria-describedby={inviteErr ? `${inviteId}-err` : undefined}
                            onChange={(e) => {
                              setEmails({ ...emails, [s.id]: e.target.value });
                              if (inviteErr) setInviteError(null);
                            }}
                          />
                        </div>
                      )}
                      <button
                        type="submit"
                        disabled={busy}
                        aria-label={sent ? t("sentTo", { name }) : t("sendEmailFor", { name })}
                        className="rounded-md border border-gray-300 px-3 py-1 font-semibold text-gray-800 disabled:text-gray-400"
                      >
                        {sent ? (
                          <>
                            {t("sent")} <span aria-hidden="true">✓</span>
                          </>
                        ) : (
                          t("sendEmail")
                        )}
                      </button>
                    </form>
                  </>
                )}
              </div>
            )}
            {actions && inviteErr && (
              <p id={`${inviteId}-err`} className="mt-1 text-xs text-red-700">
                {inviteErr}
              </p>
            )}
            {actions && s.inviteUrl && manualId === s.id && (
              <div className="mt-2">
                <label htmlFor={linkId} className="text-xs font-medium text-gray-700">
                  {t("inviteLink")}
                  <span className="sr-only"> · {name}</span>
                </label>
                <input
                  id={linkId}
                  type="text"
                  readOnly
                  value={s.inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-describedby={`${linkId}-hint`}
                  className={field}
                />
                <p id={`${linkId}-hint`} className="mt-1 text-xs text-gray-500">
                  {t("copyManual")}
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  // Son plan iptal edildiyse: paylar daraltılmış özet olarak kalır, yeni bölme kurulabilir.
  const aborted = plan?.status === "ABORTED";
  const abortedSummary =
    plan && aborted ? (
      <div className="rounded-lg border border-gray-200 px-3 py-2" data-testid="split-aborted">
        <p className="text-sm text-gray-800">{t("abortedSummary")}</p>
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer font-medium text-gray-700">
            {t("showPrevious")}
          </summary>
          {renderShares(plan, false)}
        </details>
      </div>
    ) : null;

  if (!plan || aborted) {
    if (!allowCreate) {
      if (!abortedSummary) return null;
      return (
        <section
          className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
          aria-labelledby={headingId}
          data-testid="split-status"
        >
          <h2 id={headingId} className="mb-3 text-lg font-semibold text-gray-900">
            {t("title")}
          </h2>
          {abortedSummary}
        </section>
      );
    }
    const countLabelId = `${baseId}-people-label`;
    const countHintId = `${baseId}-people-hint`;
    return (
      <form
        onSubmit={create}
        className="mt-6 space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        aria-labelledby={headingId}
        data-testid="split-create"
      >
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-gray-900">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-gray-600">{t("intro")}</p>
        </div>
        {abortedSummary}
        <div>
          <span id={countLabelId} className="text-sm font-medium text-gray-700">
            {t("peopleCount")}
          </span>
          <div
            role="group"
            aria-labelledby={countLabelId}
            aria-describedby={countHintId}
            className="mt-1 flex items-center gap-3"
          >
            <button
              type="button"
              onClick={() => setPeople(people - 1)}
              aria-label={t("peopleDecrease")}
              aria-disabled={rows.length <= 1 || undefined}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-gray-300 text-lg font-semibold text-gray-800 aria-disabled:cursor-not-allowed aria-disabled:text-gray-400"
            >
              −
            </button>
            <output
              aria-live="polite"
              className="min-w-[4rem] text-center text-sm font-semibold text-gray-900"
              data-testid="split-people"
            >
              {t("peopleValue", { count: people })}
            </output>
            <button
              type="button"
              onClick={() => setPeople(people + 1)}
              aria-label={t("peopleIncrease")}
              aria-disabled={rows.length >= maxParticipants || undefined}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-gray-300 text-lg font-semibold text-gray-800 aria-disabled:cursor-not-allowed aria-disabled:text-gray-400"
            >
              +
            </button>
          </div>
          <p id={countHintId} className="mt-1 text-xs text-gray-500">
            {t("maxHint", { max: maxParticipants, people: maxParticipants + 1 })}
          </p>
        </div>
        <fieldset className="flex flex-wrap gap-4 text-sm text-gray-800">
          <legend className="mb-2 w-full text-sm font-medium text-gray-700">
            {t("modeLegend")}
          </legend>
          {(["equal", "custom"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="radio"
                name="split-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {m === "equal" ? t("modeEqual") : t("modeCustom")}
            </label>
          ))}
        </fieldset>
        <ul className="space-y-3">
          {rows.map((row, i) => {
            const emailId = fieldId("email", i);
            const amountId = fieldId("amount", i);
            const emailErr = showError(`email-${i}`) ? rowErrors[i].email : null;
            const amountErr = showError(`amount-${i}`) ? rowErrors[i].amount : null;
            return (
              <li key={i} className="flex flex-wrap items-start gap-3">
                <div className="min-w-[12rem] flex-1">
                  <label htmlFor={emailId} className="text-sm font-medium text-gray-700">
                    {t("participant", { n: i + 1 })} · {t("emailLabel")}
                  </label>
                  <input
                    id={emailId}
                    type="email"
                    className={field}
                    value={row.email}
                    autoComplete="off"
                    aria-invalid={emailErr ? true : undefined}
                    aria-describedby={emailErr ? `${emailId}-err` : undefined}
                    onBlur={() => touch(`email-${i}`)}
                    onChange={(e) =>
                      setRows(rows.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))
                    }
                  />
                  {emailErr && (
                    <p id={`${emailId}-err`} className="mt-1 text-xs text-red-700">
                      {emailErr}
                    </p>
                  )}
                </div>
                {mode === "custom" ? (
                  <div className="w-40">
                    <label htmlFor={amountId} className="text-sm font-medium text-gray-700">
                      <span className="sr-only">{t("participant", { n: i + 1 })} · </span>
                      {t("amountLabel")} ({currency})
                    </label>
                    <input
                      id={amountId}
                      type="text"
                      inputMode="decimal"
                      className={field}
                      value={row.amount}
                      aria-invalid={amountErr ? true : undefined}
                      aria-describedby={
                        amountErr ? `${amountId}-err ${amountId}-hint` : `${amountId}-hint`
                      }
                      onBlur={() => touch(`amount-${i}`)}
                      onChange={(e) =>
                        setRows(
                          rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r))
                        )
                      }
                      required
                    />
                    {amountErr && (
                      <p id={`${amountId}-err`} className="mt-1 text-xs text-red-700">
                        {amountErr}
                      </p>
                    )}
                    <p id={`${amountId}-hint`} className="mt-1 text-xs text-gray-500">
                      {t("amountHint")}
                    </p>
                  </div>
                ) : (
                  <span className="pt-7 text-sm text-gray-700">
                    <span className="sr-only">{t("participant", { n: i + 1 })} · </span>
                    {t("equalShare", { amount: f.money(equalShare, currency) })}
                  </span>
                )}
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      focusRow.current = Math.min(i, rows.length - 2);
                      setRows(rows.filter((_, j) => j !== i));
                    }}
                    className="mt-5 min-h-[44px] min-w-[44px] text-sm font-semibold text-red-700 hover:underline"
                    aria-label={t("removeParticipantN", { n: i + 1 })}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="space-y-1 border-t border-gray-100 pt-3 text-sm">
          {mode === "equal" && (
            <p className="text-gray-700" data-testid="split-equal-summary">
              {t("equalSummary", {
                total: f.money(totalMinor, currency),
                people,
                share: f.money(equalShare, currency),
              })}
            </p>
          )}
          <div className="flex justify-between">
            <span className="text-gray-700">{t("organizerShare")}</span>
            <span className="font-semibold text-gray-900" data-testid="split-organizer-share">
              {organizerKnown ? f.money(organizerMinor, currency) : "—"}
            </span>
          </div>
        </div>
        <div aria-live="polite">
          {overTotal ? (
            <p className="text-sm text-red-700">
              {t("overTotal", {
                total: f.money(totalMinor, currency),
                excess: f.money(-organizerMinor, currency),
              })}
            </p>
          ) : (
            !organizerKnown && <p className="text-xs text-gray-500">{t("organizerPending")}</p>
          )}
        </div>
        <p className="text-xs text-gray-500">{t("remainderHint")}</p>
        <p id={`${baseId}-terms`} className="text-sm text-gray-700">
          {t("beforeCreate")}
        </p>
        {alerts}
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          aria-describedby={`${baseId}-terms`}
          className="w-full rounded-lg border border-[#003580] px-4 py-3 text-sm font-semibold text-[#003580] hover:bg-blue-50 disabled:border-gray-300 disabled:text-gray-500"
        >
          {busy ? t("creating") : t("create")}
        </button>
      </form>
    );
  }

  const open = planOpen;
  const minutesLeft = Math.max(0, Math.ceil((Date.parse(plan.deadlineAt) - now) / 60000));
  return (
    <section
      className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
      aria-labelledby={headingId}
      data-testid="split-status"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id={headingId}
          ref={statusHeadingRef}
          tabIndex={-1}
          className="text-lg font-semibold text-gray-900 focus:outline-none"
        >
          {t("title")}
        </h2>
        <span className="text-sm font-medium text-gray-700">{t(`planStatus.${plan.status}`)}</span>
      </div>
      {open && (
        <>
          <p className="mt-1 text-sm text-amber-700">
            {t("deadline", { time: f.dateTime(plan.deadlineAt) })}{" "}
            <span className="font-semibold">{t("deadlineLeft", { minutes: minutesLeft })}</span>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {plan.fallbackMode === "ORGANIZER_PAYS" ? t("fallbackOrganizer") : t("fallbackRefund")}
          </p>
        </>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-gray-800">
          {t("progress", {
            funded: f.money(plan.fundedMinor, plan.currency),
            total: f.money(plan.totalMinor, plan.currency),
          })}
        </p>
        <span className="flex items-center gap-2 text-xs text-gray-500">
          {checkedAt !== null && (
            <span data-testid="split-checked-at">
              {t("lastUpdated", { time: f.time(new Date(checkedAt)) })}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (!refreshing) void refresh();
            }}
            aria-busy={refreshing || undefined}
            className="min-h-[44px] px-1 text-sm font-semibold text-primary-600 hover:underline"
          >
            {refreshing ? t("refreshing") : t("refresh")}
          </button>
        </span>
      </div>
      <div aria-live="polite">
        {refreshFailed && <p className="mt-1 text-xs text-red-700">{t("refreshFailed")}</p>}
        {update && (
          <p className="mt-1 text-sm text-green-700" data-testid="split-update">
            {update}
          </p>
        )}
      </div>
      <p className="sr-only" role="status">
        {srNotice}
      </p>
      {renderShares(plan, true)}
      {alerts}
    </section>
  );
}
