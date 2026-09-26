"use client";

import { useLocale, useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { LlmBadge, focusRing, useLoader } from "@/components/ui/ui";

export interface HighlightQuote {
  reviewId: string;
  start: number;
  end: number;
}

interface Claim extends HighlightQuote {
  text: string;
  quote: string;
}

interface Cluster {
  id: string;
  title: string;
  sentiment: "positive" | "mixed" | "negative";
  mentionCount: number;
  claims: Claim[];
  llmMode: string;
}

interface HighlightsResponse {
  reviewCount: number;
  llmMode: string;
  clusters: Cluster[];
  ai_generated: true;
}

const SENTIMENT_CLASS: Record<Cluster["sentiment"], string> = {
  positive: "bg-green-100 text-green-900",
  mixed: "bg-amber-100 text-amber-900",
  negative: "bg-red-100 text-red-900",
};

/**
 * v4 P1-9: yorum temaları (AI üretimi, `ai_generated` rozeti). Her iddianın alıntısı
 * kaynak yorumdan birebir; tıklanınca ilgili yoruma kaydırılır ve alıntı vurgulanır.
 */
export default function ReviewHighlights({
  propertyId,
  onQuote,
}: {
  propertyId: string;
  onQuote: (quote: HighlightQuote) => void;
}) {
  const t = useTranslations("reviews.highlights");
  const locale = useLocale();
  const res = useLoader(
    () =>
      apiFetch<HighlightsResponse>(
        `/api/properties/${propertyId}/review-highlights?locale=${encodeURIComponent(locale)}`
      ),
    [propertyId, locale]
  );

  function jump(claim: Claim) {
    onQuote({ reviewId: claim.reviewId, start: claim.start, end: claim.end });
    const el = document.getElementById(`review-${claim.reviewId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    }
  }

  if (res.error) return <p className="mt-2 text-sm text-gray-700">{t("unavailable")}</p>;
  if (!res.data || res.data.clusters.length === 0) return null;
  return (
    <div
      className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-gray-900"
      data-testid="review-highlights"
      data-ai-generated="true"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{t("title")}</h3>
        <LlmBadge mode={res.data.llmMode} />
        <span className="text-xs text-gray-700">
          {t("basedOn", { count: res.data.reviewCount })}
        </span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {res.data.clusters.map((c) => (
          <li key={c.id} className="rounded-md border border-indigo-100 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold">{c.title}</h4>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${SENTIMENT_CLASS[c.sentiment]}`}
              >
                {t(`sentiment.${c.sentiment}`)}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-700">{t("mentions", { count: c.mentionCount })}</p>
            <ul className="mt-2 space-y-2">
              {c.claims.map((claim, i) => (
                <li key={`${claim.reviewId}-${i}`}>
                  {claim.text !== claim.quote && <p>{claim.text}</p>}
                  <button
                    type="button"
                    onClick={() => jump(claim)}
                    title={t("quoteLabel")}
                    className={`mt-1 block w-full border-l-4 border-indigo-400 pl-2 text-left italic text-gray-800 hover:bg-indigo-50 ${focusRing}`}
                  >
                    <span className="sr-only">{t("quoteLabel")}: </span>“{claim.quote}”
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
