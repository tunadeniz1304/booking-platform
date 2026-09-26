"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { LlmBadge, PageShell, focusRing, useLoader } from "@/components/ui/ui";

type PolicyKind = "FLEXIBLE" | "MODERATE" | "STRICT" | "NON_REFUNDABLE";
type Unavailable = "NO_DATES" | "NO_ROOM_FOR_GUESTS" | "UNAVAILABLE";

interface Listing {
  id: string;
  title: string;
  city: string;
  country: string;
  rating: { avg: number; count: number };
  amenities: string[];
  cancellation: { kind: PolicyKind; freeCancellationHours: number | null };
  price: {
    available: boolean;
    total: number | null;
    currency: string | null;
    nights: number | null;
    reason?: Unavailable;
  };
}

interface CompareResponse {
  checkIn: string | null;
  checkOut: string | null;
  guests: number;
  listings: Listing[];
  diff: {
    commonAmenities: string[];
    uniqueAmenities: Record<string, string[]>;
    cheapestId: string | null;
    bestRatedId: string | null;
    mostFlexibleId: string | null;
  };
  commentary: { text: string; llmMode: string };
  ai_generated: true;
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900">
      {children}
    </span>
  );
}

/** v4 P1-9: 2–4 ilanın yapılandırılmış farkı + teklif motoru toplamları + AI yorumu. */
function CompareContent() {
  const t = useTranslations("compare");
  const f = useFormat();
  const locale = useLocale();
  const sp = useSearchParams();
  const ids = (sp.get("ids") ?? "").split(",").filter(Boolean);
  const query = new URLSearchParams(sp.toString());
  query.set("locale", locale);
  const enough = ids.length >= 2;
  const res = useLoader(
    () =>
      enough
        ? apiFetch<CompareResponse>(`/api/compare?${query.toString()}`)
        : Promise.resolve(null),
    [query.toString(), enough]
  );

  if (!enough) {
    return (
      <p className="text-sm text-gray-700">
        {t("needMore")}{" "}
        <Link href="/search" className={`underline ${focusRing}`}>
          {t("backToSearch")}
        </Link>
      </p>
    );
  }
  if (res.error) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {res.error}
      </p>
    );
  }
  const data = res.data;
  if (!data) return <p className="text-sm text-gray-700">{t("loading")}</p>;

  const cell = "border-b border-gray-200 px-3 py-2 align-top text-sm text-gray-900";
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        {data.checkIn && data.checkOut
          ? t("dates", {
              checkIn: f.date(data.checkIn),
              checkOut: f.date(data.checkOut),
              guests: data.guests,
            })
          : t("noDates")}
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full border-collapse" data-testid="compare-table">
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                {t("title")}
              </th>
              {data.listings.map((l) => (
                <th key={l.id} scope="col" className={`${cell} text-left font-semibold`}>
                  <Link href={`/property/${l.id}`} className={`underline ${focusRing}`}>
                    {l.title}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className={`${cell} text-left font-medium text-gray-700`}>
                {t("rows.total")}
              </th>
              {data.listings.map((l) => (
                <td key={l.id} className={cell} data-testid={`compare-total-${l.id}`}>
                  {l.price.available && l.price.total !== null && l.price.currency ? (
                    <>
                      <span className="font-semibold">
                        {f.money(l.price.total, l.price.currency)}
                      </span>
                      {l.price.nights !== null && (
                        <span className="block text-xs text-gray-700">
                          {t("nights", { count: l.price.nights })}
                        </span>
                      )}
                      {data.diff.cheapestId === l.id && <Badge>{t("badges.cheapest")}</Badge>}
                    </>
                  ) : (
                    <span className="text-gray-700">
                      {t(`unavailable.${l.price.reason ?? "UNAVAILABLE"}`)}
                    </span>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={`${cell} text-left font-medium text-gray-700`}>
                {t("rows.rating")}
              </th>
              {data.listings.map((l) => (
                <td key={l.id} className={cell}>
                  {l.rating.count > 0
                    ? t("ratingValue", { avg: f.number(l.rating.avg), count: l.rating.count })
                    : t("noRating")}
                  {data.diff.bestRatedId === l.id && <Badge>{t("badges.bestRated")}</Badge>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={`${cell} text-left font-medium text-gray-700`}>
                {t("rows.cancellation")}
              </th>
              {data.listings.map((l) => (
                <td key={l.id} className={cell}>
                  {t(`policy.${l.cancellation.kind}`)}
                  {l.cancellation.freeCancellationHours !== null && (
                    <span className="block text-xs text-gray-700">
                      {t("freeCancel", { hours: l.cancellation.freeCancellationHours })}
                    </span>
                  )}
                  {data.diff.mostFlexibleId === l.id && <Badge>{t("badges.mostFlexible")}</Badge>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={`${cell} text-left font-medium text-gray-700`}>
                {t("rows.location")}
              </th>
              {data.listings.map((l) => (
                <td key={l.id} className={cell}>
                  {l.city}, {l.country}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={`${cell} text-left font-medium text-gray-700`}>
                {t("rows.amenities")}
              </th>
              {data.listings.map((l) => {
                const unique = new Set(data.diff.uniqueAmenities[l.id] ?? []);
                return (
                  <td key={l.id} className={cell}>
                    <ul className="space-y-0.5">
                      {l.amenities.map((a) => (
                        <li key={a}>
                          {a}
                          {unique.has(a) && (
                            <span className="ml-1 text-xs font-medium text-indigo-800">
                              ({t("onlyHere")})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <section
        aria-labelledby="compare-commentary"
        className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-gray-900"
        data-ai-generated="true"
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 id="compare-commentary" className="font-semibold">
            {t("commentary")}
          </h2>
          <LlmBadge mode={data.commentary.llmMode} />
        </div>
        <p>{data.commentary.text}</p>
      </section>
    </div>
  );
}

export default function ComparePage() {
  const t = useTranslations("compare");
  return (
    <PageShell title={t("title")} intro={t("intro")}>
      <Suspense fallback={<p className="text-sm text-gray-700">{t("loading")}</p>}>
        <CompareContent />
      </Suspense>
    </PageShell>
  );
}
