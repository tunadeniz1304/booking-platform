"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Field,
  LlmBadge,
  focusRing,
  inputClass,
  loginHref,
  useErrorText,
  useLoader,
  useSession,
} from "@/components/ui/ui";
import ReviewHighlights, { focusHighlightTrigger, type HighlightQuote } from "./ReviewHighlights";
import ReviewHostReplyForm from "./ReviewHostReplyForm";

interface ReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  hostReply: string | null;
  /** Liste API'si döndürürse yanıt tarihi gösterilir. */
  hostRepliedAt?: string | null;
  createdAt: string;
  author: string;
  verifiedStay: boolean;
  subScores?: Record<SubScoreKey, number | null>;
}

type SubScoreKey = "cleanliness" | "location" | "staff" | "value";

const SUB_SCORE_KEYS: SubScoreKey[] = ["cleanliness", "location", "staff", "value"];

const REPORT_REASONS = ["OFFENSIVE", "SPAM", "FAKE", "PRIVACY", "OTHER"] as const;
/** report API `note` sınırı. */
const REPORT_NOTE_MAX = 500;

type ReportError = { kind: "login" } | { kind: "text"; text: string };

/** Girişten sonra aynı yoruma dönen giriş bağlantısı (yalnız istemcide, oturum bilinince). */
function reportLoginHref(reviewId: string): string {
  return loginHref(`${window.location.pathname}${window.location.search}#review-${reviewId}`);
}

/**
 * Yorum şikâyeti (P1-7): oturum gerekir; oturumsuz misafire baştan giriş bağlantısı gösterilir.
 * Neden önceden seçili gelmez; "Diğer" için açıklama zorunludur. Eşik aşılınca yorum
 * incelemeye alınır.
 */
function ReportButton({
  reviewId,
  signedIn,
  author,
  propertyId,
}: {
  reviewId: string;
  signedIn: boolean | null;
  author: string;
  /** Verilirse yasa dışı içerik bildirim formunda ilan önceden seçilir. */
  propertyId?: string;
}) {
  const t = useTranslations("reviews");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<"reason" | "note" | null>(null);
  const [error, setError] = useState<ReportError | null>(null);
  /** Şikâyet alındıysa (ya da daha önce yapılmışsa) tetikleyicinin yerine geçen metin. */
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  /** Kapanışta odağı tetikleyiciye (ya da sonuç metnine) döndürmek için (ilk render'da değil). */
  const wasOpen = useRef(false);
  const panelId = `report-panel-${reviewId}`;
  const noteId = `report-note-${reviewId}`;
  /** Tekrarlanan tetikleyicilerin ekran okuyucu adına yorumun yazarı eklenir. */
  const context = <span className="sr-only"> {t("report.openContext", { author })}</span>;

  useEffect(() => {
    if (open) selectRef.current?.focus();
    else if (wasOpen.current) (doneRef.current ?? triggerRef.current)?.focus();
    wasOpen.current = open;
  }, [open]);

  function finish(text: string) {
    setDone(text);
    setOpen(false);
  }

  async function submit() {
    if (busy) return;
    const trimmed = note.trim();
    if (!reason || (reason === "OTHER" && !trimmed)) {
      setFieldError(reason ? "note" : "reason");
      (reason ? noteRef : selectRef).current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/reviews/${reviewId}/report`, {
        method: "POST",
        body: JSON.stringify(trimmed ? { reason, note: trimmed } : { reason }),
      });
      finish(t("report.received"));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === "REPORT_EXISTS") finish(t("report.alreadyReported"));
      else if (e instanceof ApiError && e.status === 401) setError({ kind: "login" });
      else {
        setError({
          kind: "text",
          text:
            code === "FORBIDDEN"
              ? t("report.ownReview")
              : code === "NOT_FOUND"
                ? t("report.notFound")
                : errorText(e, t("report.failed")),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p ref={doneRef} tabIndex={-1} className={`mt-2 text-xs text-gray-700 ${focusRing}`}>
        <span aria-hidden="true">{"\u2713"} </span>
        {done}
      </p>
    );
  }

  if (signedIn === false && !open && !error) {
    return (
      <p className="mt-2 text-xs">
        <Link
          href={reportLoginHref(reviewId)}
          className={`inline-flex min-h-[44px] items-center text-gray-700 underline sm:min-h-0 ${focusRing}`}
        >
          {t("report.signIn")}
          {context}
        </Link>
      </p>
    );
  }

  return (
    <div className="mt-2 text-xs">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`inline-flex min-h-[44px] items-center text-gray-700 underline sm:min-h-0 ${focusRing}`}
      >
        {t("report.open")}
        {context}
      </button>
      {open && (
        <div
          id={panelId}
          className="mt-2 max-w-md space-y-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <Field
            id={`report-${reviewId}`}
            label={t("report.reasonLabel")}
            error={fieldError === "reason" ? t("report.reasonRequired") : null}
            required
          >
            <select
              ref={selectRef}
              id={`report-${reviewId}`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setFieldError(null);
              }}
              className={`min-h-[44px] rounded border border-gray-300 px-1 py-0.5 sm:min-h-0 ${focusRing}`}
            >
              <option value="" disabled>
                {t("report.reasonPlaceholder")}
              </option>
              {REPORT_REASONS.map((v) => (
                <option key={v} value={v}>
                  {t(`report.reasons.${v}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id={noteId}
            label={reason === "OTHER" ? t("report.noteLabel") : t("report.noteLabelOptional")}
            hint={t("report.noteCount", { count: note.length, max: REPORT_NOTE_MAX })}
            error={fieldError === "note" ? t("report.noteRequired") : null}
            required={reason === "OTHER"}
          >
            <textarea
              ref={noteRef}
              id={noteId}
              rows={3}
              maxLength={REPORT_NOTE_MAX}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (fieldError === "note") setFieldError(null);
              }}
              className={inputClass}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              className={`inline-flex min-h-[44px] items-center font-semibold text-red-800 underline aria-disabled:opacity-60 sm:min-h-0 ${focusRing}`}
            >
              {busy ? t("report.sending") : t("report.submit")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={`inline-flex min-h-[44px] items-center text-gray-700 underline sm:min-h-0 ${focusRing}`}
            >
              {t("report.cancel")}
            </button>
            <p className="w-full text-gray-700">
              {t.rich("report.illegalHint", {
                link: (chunks) => (
                  <Link
                    href={
                      propertyId
                        ? `/report?propertyId=${encodeURIComponent(propertyId)}`
                        : "/report"
                    }
                    className={`font-semibold underline ${focusRing}`}
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-gray-700">
          <span aria-hidden="true">{"\u26A0\uFE0E"} </span>
          <span className="font-semibold">{tc("errorPrefix")}</span>{" "}
          {error.kind === "login"
            ? t.rich("report.loginRequired", {
                link: (chunks) => (
                  <Link
                    href={reportLoginHref(reviewId)}
                    className={`font-semibold underline ${focusRing}`}
                  >
                    {chunks}
                  </Link>
                ),
              })
            : error.text}
        </p>
      )}
    </div>
  );
}

interface ReviewSummary {
  summary: string;
  pros: string[];
  cons: string[];
  citations: string[];
  llmMode: string;
  reviewCount: number;
}

const CITATION_RE = /\[r:([A-Za-z0-9_-]+)\]/g;

/** Metindeki `[r:<id>]` atıflarını ilgili yorum çapasına bağlantıya çevirir. */
function withCitations(
  text: string,
  order: Map<string, number>,
  sourceLabel: (n: number) => string,
  onJump?: (id: string) => void
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const id = match[1];
    const index = match.index ?? 0;
    out.push(text.slice(last, index));
    const n = order.get(id);
    out.push(
      n ? (
        <a
          key={`${id}-${index}`}
          href={`#review-${id}`}
          onClick={() => onJump?.(id)}
          className={`inline-block min-h-6 min-w-6 px-1 text-center align-super text-xs font-semibold text-[#003580] underline ${focusRing}`}
          aria-label={sourceLabel(n)}
        >
          [{n}]
        </a>
      ) : (
        ""
      )
    );
    last = index + match[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/** Yorum metni; öne çıkanlardan seçilen alıntı aralığı `<mark>` ile vurgulanır. */
function CommentText({ text, quote }: { text: string; quote: HighlightQuote | null }) {
  if (!quote || quote.start < 0 || quote.end > text.length || quote.start >= quote.end) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, quote.start)}
      <mark className="rounded bg-yellow-200 px-0.5 text-gray-900">
        {text.slice(quote.start, quote.end)}
      </mark>
      {text.slice(quote.end)}
    </>
  );
}

/** Yorum puanı 1–5 ölçeğindedir; ölçek dışı veri yanlış yıldız sayısı göstermesin. */
function clampRating(rating: number): number {
  return Math.min(5, Math.max(0, Math.round(rating)));
}

/** Yıldızlar destekleyicidir; ölçek görünür "4/5" metniyle de verilir. */
function Stars({ rating }: { rating: number }) {
  const t = useTranslations("reviews");
  const tp = useTranslations("property");
  const value = clampRating(rating);
  return (
    <span
      role="img"
      aria-label={t("starsLabel", { rating: value })}
      className="inline-flex items-baseline gap-1"
    >
      <span aria-hidden="true" className="text-amber-700">
        {"★".repeat(value)}
        <span className="text-gray-400">{"★".repeat(5 - value)}</span>
      </span>
      <span aria-hidden="true" className="text-xs font-semibold">
        {tp("ratingOutOf", { rating: value })}
      </span>
    </span>
  );
}

interface HostReplyData {
  text: string;
  /** ISO tarih; API vermezse gösterilmez. */
  at: string | null;
}

function HostReply({ reply }: { reply: HostReplyData | null }) {
  const t = useTranslations("reviews");
  const f = useFormat();
  if (!reply) return null;
  return (
    <div className="mt-3 border-l-4 border-[#003580] bg-gray-50 p-3">
      <p className="text-xs text-gray-900">
        <span className="font-semibold">{t("hostReply")}</span>
        {reply.at && (
          <span className="ml-2">{t("hostReplyDate", { date: f.date(reply.at, "medium") })}</span>
        )}
      </p>
      <p className="mt-1 text-gray-800">{reply.text}</p>
    </div>
  );
}

const PAGE_SIZE = 10;
/** review-service `listReviews` üst sınırı: bu kadar yorum geldiyse en yenileri listeleniyordur. */
const LIST_LIMIT = 50;
const SORT_KEYS = ["newest", "highest", "lowest"] as const;
type SortKey = (typeof SORT_KEYS)[number];
const STAR_VALUES = [5, 4, 3, 2, 1] as const;

/** API en yeniden eskiye döner; puan sıralamasında eşitler bu sırayı korur (kararlı sıralama). */
function sortReviews(items: ReviewItem[], sort: SortKey): ReviewItem[] {
  if (sort === "newest") return items;
  const dir = sort === "highest" ? -1 : 1;
  return [...items].sort((a, b) => dir * (clampRating(a.rating) - clampRating(b.rating)));
}

/** `index` sıradaki yorumun listede görünmesi için gereken (sayfa katı) öğe sayısı. */
function visibleFor(index: number): number {
  return Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE;
}

/** PDP: atıflı YZ yorum özeti + doğrulanmış yorumlar ve ev sahibi yanıtları (P1-4). */
export default function ReviewsSection({
  propertyId,
  totalCount,
}: {
  propertyId: string;
  /** İlanın yayımlanmış yorum sayısı; liste API sınırında kesildiyse bu toplam belirtilir. */
  totalCount?: number;
}) {
  const t = useTranslations("reviews");
  const f = useFormat();
  const locale = useLocale();
  const session = useSession();
  const signedIn = session.status === "ready" ? session.user !== null : null;
  const hostUserId =
    session.status === "ready" && session.user?.role === "HOST" ? session.user.id : null;
  /** Oturumdaki ev sahibi bu ilanın sahibi mi (yanıt arayüzü yalnız ona gösterilir). */
  const [isOwnerHost, setIsOwnerHost] = useState(false);
  /** Bu oturumda yayımlanan ev sahibi yanıtları (liste yeniden yüklenmeden gösterilir). */
  const [localReplies, setLocalReplies] = useState<Record<string, HostReplyData>>({});
  const controlsId = useId();
  const [sort, setSort] = useState<SortKey>("newest");
  const [stars, setStars] = useState<number | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  /** Sayfalanmış/filtrelenmiş bir yoruma atlama ya da "daha fazla" sonrası odaklanacak yorum. */
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);
  const requestFocus = (id: string) => setFocusRequest((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
  const sourceLabel = (n: number) => t("summary.sourceLabel", { n });
  const reviews = useLoader(
    () =>
      apiFetch<ReviewItem[]>(`/api/properties/${propertyId}/reviews`).then((items) => {
        // Girişten ya da bağlantıdan `#review-<id>` ile gelindiyse yorum ilk sayfada olmayabilir.
        const id = /^#review-([\w-]+)$/.exec(window.location.hash)?.[1];
        const index = id ? items.findIndex((r) => r.id === id) : -1;
        if (id && index >= 0) {
          setVisible((v) => Math.max(v, visibleFor(index)));
          requestFocus(id);
        }
        return items;
      }),
    [propertyId]
  );
  const summary = useLoader(
    () =>
      apiFetch<ReviewSummary>(
        `/api/properties/${propertyId}/reviews/summary?locale=${encodeURIComponent(locale)}`
      ),
    [propertyId, locale]
  );

  useEffect(() => {
    if (!hostUserId) return;
    let active = true;
    apiFetch<{ id: string }[]>("/api/host/properties")
      .then((list) => {
        if (active) setIsOwnerHost(list.some((p) => p.id === propertyId));
      })
      // Yanıt arayüzü ek özelliktir; alınamazsa ilan sayfası etkilenmez.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [hostUserId, propertyId]);

  useEffect(() => {
    if (!focusRequest) return;
    const el = document.getElementById(`review-${focusRequest.id}`);
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  }, [focusRequest, reviews.data]);

  const [activeQuote, setActiveQuote] = useState<HighlightQuote | null>(null);
  const citationOrder = new Map<string, number>();
  for (const id of summary.data?.citations ?? []) {
    if (!citationOrder.has(id)) citationOrder.set(id, citationOrder.size + 1);
  }

  const all = reviews.data ?? [];
  const starCounts = STAR_VALUES.map((value) => ({
    stars: value,
    count: all.filter((r) => clampRating(r.rating) === value).length,
  }));
  const matching = sortReviews(
    stars === null ? all : all.filter((r) => clampRating(r.rating) === stars),
    sort
  );
  const shown = matching.slice(0, visible);
  const truncationNote =
    all.length < LIST_LIMIT
      ? null
      : totalCount === undefined
        ? t("list.latestOnly", { count: all.length })
        : totalCount > all.length
          ? t("list.truncated", { count: all.length, total: totalCount })
          : null;

  /** Atıf ya da öne çıkan alıntı listede görünmeyen bir yorumu gösteriyorsa onu açar. */
  function revealReview(id: string) {
    const inMatching = matching.findIndex((r) => r.id === id);
    if (inMatching >= 0 && inMatching < visible) return;
    const index =
      inMatching >= 0 ? inMatching : sortReviews(all, sort).findIndex((r) => r.id === id);
    if (index < 0) return;
    if (inMatching < 0) setStars(null);
    setVisible((v) => Math.max(v, visibleFor(index)));
    requestFocus(id);
  }

  function showMore() {
    const next = matching[visible];
    setVisible((v) => v + PAGE_SIZE);
    if (next) requestFocus(next.id);
  }

  const summaryReady = summary.data !== null && summary.data.reviewCount > 0;
  const replyOf = (r: ReviewItem): HostReplyData | null =>
    localReplies[r.id] ?? (r.hostReply ? { text: r.hostReply, at: r.hostRepliedAt ?? null } : null);

  return (
    <section aria-labelledby="reviews-title" className="mt-8">
      <h2 id="reviews-title" className="text-xl font-semibold text-gray-900">
        {t("title")}
      </h2>
      <details className="mt-1 text-sm text-gray-700" data-testid="review-verification">
        <summary className={`cursor-pointer py-3 font-medium sm:py-1 ${focusRing}`}>
          {t("verificationTitle")}
        </summary>
        <p className="mt-1">{t("verificationBody")}</p>
      </details>

      {summary.data && summary.data.reviewCount > 0 && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-gray-900">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{t("summary.title")}</h3>
            <LlmBadge mode={summary.data.llmMode} />
            <span className="text-xs text-gray-700">
              {t("summary.basedOn", { count: summary.data.reviewCount })}
            </span>
          </div>
          {locale !== "tr" && (
            <p className="mb-2 text-xs text-gray-700">{t("summary.inTurkish")}</p>
          )}
          <p lang="tr">
            {withCitations(summary.data.summary, citationOrder, sourceLabel, revealReview)}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {summary.data.pros.length > 0 && (
              <div>
                <h4 className="font-semibold text-green-900">{t("summary.pros")}</h4>
                <ul lang="tr" className="mt-1 list-disc pl-5">
                  {summary.data.pros.map((p, i) => (
                    <li key={i}>{withCitations(p, citationOrder, sourceLabel, revealReview)}</li>
                  ))}
                </ul>
              </div>
            )}
            {summary.data.cons.length > 0 && (
              <div>
                <h4 className="font-semibold text-red-900">{t("summary.cons")}</h4>
                <ul lang="tr" className="mt-1 list-disc pl-5">
                  {summary.data.cons.map((c, i) => (
                    <li key={i}>{withCitations(c, citationOrder, sourceLabel, revealReview)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {citationOrder.size > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-700">
              <span>{t("summary.sources")}</span>
              {[...citationOrder.entries()].map(([id, n]) => (
                <a
                  key={id}
                  href={`#review-${id}`}
                  onClick={() => revealReview(id)}
                  aria-label={sourceLabel(n)}
                  className={`inline-flex min-h-6 min-w-6 items-center justify-center underline ${focusRing}`}
                >
                  [{n}]
                </a>
              ))}
            </p>
          )}
        </div>
      )}
      {/* Özet yüklenirken yer tutucu: özet sonradan gelince yorum listesi aşağı kaymasın. */}
      {summary.loading && !summary.data && !summary.error && (
        <div aria-hidden="true" className="mt-3 min-h-[8rem] rounded-lg border border-gray-200" />
      )}
      {/* Uzun özet canlı bölge değil; yalnız kısa "hazır" ya da hata metni duyurulur. */}
      <div role="status">
        {summaryReady && <p className="sr-only">{t("summary.ready")}</p>}
        {summary.error && <p className="mt-2 text-sm text-gray-700">{t("summary.unavailable")}</p>}
      </div>
      {summary.error && (
        <Button variant="secondary" className="mt-2" onClick={summary.reload}>
          {t("summary.retry")}
        </Button>
      )}

      <ReviewHighlights
        propertyId={propertyId}
        onQuote={(quote) => {
          setActiveQuote(quote);
          revealReview(quote.reviewId);
        }}
      />

      {reviews.error && (
        <div className="mt-3 text-sm">
          <p role="alert" className="text-red-700">
            {t("loadFailed")}
          </p>
          <Button variant="secondary" className="mt-2" onClick={reviews.reload}>
            {t("retry")}
          </Button>
        </div>
      )}
      {reviews.data === null && !reviews.error && (
        <p className="mt-3 text-sm text-gray-600">{t("loading")}</p>
      )}
      {reviews.data?.length === 0 && <p className="mt-3 text-sm text-gray-700">{t("empty")}</p>}
      {all.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <div className="w-full sm:w-48">
            <label htmlFor={`${controlsId}-sort`} className="block font-medium">
              {t("list.sortLabel")}
            </label>
            <select
              id={`${controlsId}-sort`}
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey);
                setVisible(PAGE_SIZE);
              }}
              className={inputClass}
            >
              {SORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`list.sort.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-48">
            <label htmlFor={`${controlsId}-stars`} className="block font-medium">
              {t("list.filterLabel")}
            </label>
            <select
              id={`${controlsId}-stars`}
              value={stars ?? "all"}
              onChange={(e) => {
                setStars(e.target.value === "all" ? null : Number(e.target.value));
                setVisible(PAGE_SIZE);
              }}
              className={inputClass}
            >
              <option value="all">{t("list.allRatings", { count: all.length })}</option>
              {starCounts
                .filter((c) => c.count > 0)
                .map((c) => (
                  <option key={c.stars} value={c.stars}>
                    {t("list.starsOption", c)}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}
      {all.length > 1 && (
        <div className="mt-3 text-xs text-gray-700">
          <p role="status">{t("list.showing", { shown: shown.length, total: matching.length })}</p>
          {truncationNote && <p className="mt-1">{truncationNote}</p>}
        </div>
      )}
      {shown.length > 0 && (
        <ul className="mt-3 space-y-3">
          {shown.map((r) => (
            <li
              key={r.id}
              id={`review-${r.id}`}
              tabIndex={-1}
              className={`scroll-mt-24 rounded-lg border border-gray-200 bg-white p-4 text-sm target:ring-2 target:ring-[#003580] ${focusRing}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-gray-900">
                <span className="font-semibold">{r.author}</span>
                <Stars rating={r.rating} />
                {r.verifiedStay && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900">
                    {t("verifiedStay")}
                  </span>
                )}
                {citationOrder.has(r.id) && (
                  <span className="text-xs text-gray-700">
                    {t("summary.cardSource", { n: citationOrder.get(r.id) ?? 0 })}
                  </span>
                )}
                <span className="text-xs text-gray-700">{f.date(r.createdAt, "medium")}</span>
              </div>
              {r.subScores && Object.values(r.subScores).some((v) => v !== null) && (
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
                  {SUB_SCORE_KEYS.filter((k) => r.subScores?.[k] != null).map((k) => (
                    <div key={k} className="flex gap-1">
                      <dt>{t(`subScores.${k}`)}:</dt>
                      <dd className="font-semibold text-gray-900">{r.subScores?.[k]}/5</dd>
                    </div>
                  ))}
                </dl>
              )}
              {r.comment && (
                <p className="mt-2 text-gray-800">
                  <CommentText
                    text={r.comment}
                    quote={activeQuote?.reviewId === r.id ? activeQuote : null}
                  />
                </p>
              )}
              {activeQuote?.reviewId === r.id && activeQuote.triggerId && (
                <button
                  type="button"
                  onClick={() => focusHighlightTrigger(activeQuote.triggerId!)}
                  className={`mt-2 inline-flex min-h-[44px] items-center text-xs text-gray-700 underline sm:min-h-0 ${focusRing}`}
                >
                  {t("highlights.backToHighlights")}
                </button>
              )}
              <HostReply reply={replyOf(r)} />
              {isOwnerHost && !r.hostReply && (
                <ReviewHostReplyForm
                  reviewId={r.id}
                  author={r.author}
                  onReplied={(text, at) =>
                    setLocalReplies((prev) => ({ ...prev, [r.id]: { text, at } }))
                  }
                />
              )}
              <ReportButton
                reviewId={r.id}
                signedIn={signedIn}
                author={r.author}
                propertyId={propertyId}
              />
            </li>
          ))}
        </ul>
      )}
      {matching.length > shown.length && (
        <Button variant="secondary" className="mt-4" onClick={showMore}>
          {t("list.loadMore", { shown: shown.length, total: matching.length })}
        </Button>
      )}
    </section>
  );
}
