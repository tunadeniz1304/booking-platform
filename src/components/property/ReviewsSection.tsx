"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { formatDate } from "@/lib/ui/format";
import { LlmBadge, focusRing, useLoader } from "@/components/ui/ui";

interface ReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  hostReply: string | null;
  createdAt: string;
  author: string;
  verifiedStay: boolean;
  subScores?: Record<SubScoreKey, number | null>;
}

type SubScoreKey = "cleanliness" | "location" | "staff" | "value";

const SUB_SCORE_LABEL: Record<SubScoreKey, string> = {
  cleanliness: "Temizlik",
  location: "Konum",
  staff: "Personel",
  value: "Fiyat/performans",
};

const REPORT_REASONS = [
  ["OFFENSIVE", "Saldırgan / uygunsuz"],
  ["SPAM", "Spam / reklam"],
  ["FAKE", "Sahte yorum"],
  ["PRIVACY", "Kişisel bilgi içeriyor"],
  ["OTHER", "Diğer"],
] as const;

/** Yorum şikâyeti (P1-7): oturum gerekir; eşik aşılınca yorum incelemeye alınır. */
function ReportButton({ reviewId }: { reviewId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("OFFENSIVE");
  const [status, setStatus] = useState<string | null>(null);

  async function submit() {
    setStatus(null);
    try {
      await apiFetch(`/api/reviews/${reviewId}/report`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setStatus("Şikâyetiniz alındı, teşekkürler.");
      setOpen(false);
    } catch (e) {
      setStatus(
        e instanceof ApiError && e.status === 401
          ? "Şikâyet için giriş yapmalısınız."
          : e instanceof ApiError
            ? e.message
            : "Şikâyet gönderilemedi"
      );
    }
  }

  return (
    <div className="mt-2 text-xs">
      {open ? (
        <span className="flex flex-wrap items-center gap-2">
          <label htmlFor={`report-${reviewId}`} className="sr-only">
            Şikâyet nedeni
          </label>
          <select
            id={`report-${reviewId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded border border-gray-300 px-1 py-0.5"
          >
            {REPORT_REASONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void submit()}
            className={`font-semibold text-red-800 underline ${focusRing}`}
          >
            Gönder
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={`text-gray-700 underline ${focusRing}`}
          >
            Vazgeç
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`text-gray-700 underline ${focusRing}`}
        >
          Şikâyet et
        </button>
      )}
      {status && (
        <p role="status" className="mt-1 text-gray-700">
          {status}
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
function withCitations(text: string, order: Map<string, number>): ReactNode[] {
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
          className={`align-super text-xs font-semibold text-[#003580] underline ${focusRing}`}
          aria-label={`Kaynak yorum ${n}`}
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

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`5 üzerinden ${rating} puan`} className="text-amber-700">
      {"★".repeat(rating)}
      <span aria-hidden="true" className="text-gray-400">
        {"★".repeat(Math.max(0, 5 - rating))}
      </span>
    </span>
  );
}

/** PDP: atıflı YZ yorum özeti + doğrulanmış yorumlar ve ev sahibi yanıtları (P1-4). */
export default function ReviewsSection({ propertyId }: { propertyId: string }) {
  const reviews = useLoader(
    () => apiFetch<ReviewItem[]>(`/api/properties/${propertyId}/reviews`),
    [propertyId]
  );
  const summary = useLoader(
    () => apiFetch<ReviewSummary>(`/api/properties/${propertyId}/reviews/summary`),
    [propertyId]
  );

  const citationOrder = new Map<string, number>();
  for (const id of summary.data?.citations ?? []) {
    if (!citationOrder.has(id)) citationOrder.set(id, citationOrder.size + 1);
  }

  return (
    <section aria-labelledby="reviews-title" className="mt-8">
      <h2 id="reviews-title" className="text-xl font-semibold text-gray-900">
        Misafir yorumları
      </h2>
      <p className="mt-1 text-xs text-gray-700" data-testid="review-verification">
        Yorumlar nasıl doğrulanır? Yalnızca bu platformda rezervasyon yapıp konaklamasını tamamlamış
        misafir, o rezervasyon için bir kez yorum yazabilir. Küfür veya kişisel bilgi içeren
        yorumlar yayından önce incelenir; şikâyet eşiğini aşan yorumlar gizlenir. Yorumlar için
        ödeme veya teşvik verilmez; olumsuz yorumlar da yayımlanır.
      </p>

      <div aria-live="polite">
        {summary.data && summary.data.reviewCount > 0 && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-gray-900">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Yorumların özeti</h3>
              <LlmBadge mode={summary.data.llmMode} />
              <span className="text-xs text-gray-700">
                {summary.data.reviewCount} yoruma dayanır; köşeli numaralar kaynak yorumlardır.
              </span>
            </div>
            <p>{withCitations(summary.data.summary, citationOrder)}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {summary.data.pros.length > 0 && (
                <div>
                  <h4 className="font-semibold text-green-900">Olumlu</h4>
                  <ul className="mt-1 list-disc pl-5">
                    {summary.data.pros.map((p, i) => (
                      <li key={i}>{withCitations(p, citationOrder)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.data.cons.length > 0 && (
                <div>
                  <h4 className="font-semibold text-red-900">Olumsuz</h4>
                  <ul className="mt-1 list-disc pl-5">
                    {summary.data.cons.map((c, i) => (
                      <li key={i}>{withCitations(c, citationOrder)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {citationOrder.size > 0 && (
              <p className="mt-2 text-xs text-gray-700">
                Kaynaklar:{" "}
                {[...citationOrder.entries()].map(([id, n], i) => (
                  <Fragment key={id}>
                    {i > 0 && ", "}
                    <a href={`#review-${id}`} className={`underline ${focusRing}`}>
                      [{n}]
                    </a>
                  </Fragment>
                ))}
              </p>
            )}
          </div>
        )}
        {summary.error && (
          <p className="mt-2 text-sm text-gray-700">Yorum özeti şu an kullanılamıyor.</p>
        )}
      </div>

      {reviews.error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {reviews.error}
        </p>
      )}
      {reviews.data === null && !reviews.error && (
        <p className="mt-3 text-sm text-gray-600">Yorumlar yükleniyor…</p>
      )}
      {reviews.data?.length === 0 && <p className="mt-3 text-sm text-gray-700">Henüz yorum yok.</p>}
      {reviews.data && reviews.data.length > 0 && (
        <ul className="mt-4 space-y-3">
          {reviews.data.map((r) => (
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
                    Doğrulanmış konaklama
                  </span>
                )}
                {citationOrder.has(r.id) && (
                  <span className="text-xs text-gray-700">[{citationOrder.get(r.id)}]</span>
                )}
                <span className="text-xs text-gray-700">{formatDate(r.createdAt)}</span>
              </div>
              {r.subScores && Object.values(r.subScores).some((v) => v !== null) && (
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
                  {(Object.keys(SUB_SCORE_LABEL) as SubScoreKey[])
                    .filter((k) => r.subScores?.[k] != null)
                    .map((k) => (
                      <div key={k} className="flex gap-1">
                        <dt>{SUB_SCORE_LABEL[k]}:</dt>
                        <dd className="font-semibold text-gray-900">{r.subScores?.[k]}/5</dd>
                      </div>
                    ))}
                </dl>
              )}
              {r.comment && <p className="mt-2 text-gray-800">{r.comment}</p>}
              {r.hostReply && (
                <div className="mt-3 border-l-4 border-[#003580] bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-900">Ev sahibinin yanıtı</p>
                  <p className="mt-1 text-gray-800">{r.hostReply}</p>
                </div>
              )}
              <ReportButton reviewId={r.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
