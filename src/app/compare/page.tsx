"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, LlmBadge, PageShell, focusRing, useErrorText } from "@/components/ui/ui";
import { propertyHref } from "@/components/property/PropertyCard";
import { useCompareSelection } from "@/components/compare/useCompareSelection";

type PolicyKind = "FLEXIBLE" | "MODERATE" | "STRICT" | "NON_REFUNDABLE";
type Unavailable = "NO_DATES" | "NO_ROOM_FOR_GUESTS" | "UNAVAILABLE";

interface Listing {
  id: string;
  title: string;
  city: string;
  country: string;
  rating: { avg: number; count: number };
  amenities: string[];
  /** F682: olanak adı → simge kodu (`property.amenityNames` anahtarı); eski yanıtlarda yok. */
  amenityIcons?: Record<string, string | null>;
  cancellation: { kind: PolicyKind; freeCancellationHours: number | null };
  price: {
    available: boolean;
    total: number | null;
    currency: string | null;
    nights: number | null;
    roomId?: string | null;
    ratePlanId?: string | null;
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

const FLEX_RANK: Record<PolicyKind, number> = {
  FLEXIBLE: 3,
  MODERATE: 2,
  STRICT: 1,
  NON_REFUNDABLE: 0,
};
const DAY_MS = 86_400_000;

/**
 * F681: rozet yalnızca gerçekten öndekilere. En az 2 karşılaştırılabilir ilan gerekir (`score`
 * null ise ilan dışarıda kalır); eşitlikte öndekilerin hepsi rozet alır, herkes eşitse kimse.
 */
function leaders(listings: readonly Listing[], score: (l: Listing) => number | null) {
  const scored = listings.flatMap((l) => {
    const s = score(l);
    return s === null ? [] : [{ id: l.id, s }];
  });
  if (scored.length < 2) return new Set<string>();
  const best = Math.max(...scored.map((x) => x.s));
  const top = scored.filter((x) => x.s === best);
  return new Set(top.length === scored.length ? [] : top.map((x) => x.id));
}

/** F681: görünen sütunlardan hesaplanır; iade edilemez ilan "en esnek" olamaz. */
function badgeIds(listings: readonly Listing[]) {
  const priced = listings.filter(
    (l) => l.price.available && l.price.total !== null && l.price.currency
  );
  const oneCurrency = new Set(priced.map((l) => l.price.currency)).size === 1;
  return {
    cheapest: oneCurrency ? leaders(priced, (l) => -(l.price.total ?? 0)) : new Set<string>(),
    bestRated: leaders(listings, (l) => (l.rating.count > 0 ? l.rating.avg : null)),
    // İade edilemez en alttadır: yalnızca hepsi iade edilemezse öne çıkar, o da eşitliktir.
    mostFlexible: leaders(listings, (l) =>
      l.cancellation.kind === "NON_REFUNDABLE"
        ? -Infinity
        : FLEX_RANK[l.cancellation.kind] * 10_000 - (l.cancellation.freeCancellationHours ?? 9_999)
    ),
  };
}

/**
 * F675/F677: "Aramaya dön" önceki aramayı korusun. `from` arama sorgu dizgesidir (CompareBar);
 * yoksa karşılaştırma adresindeki varış/tarih/misafir taşınır. Yol sabit: açık yönlendirme yok.
 */
function searchHref(sp: { get(name: string): string | null }): string {
  const from = sp.get("from");
  const params = new URLSearchParams(from ? from.slice(from.indexOf("?") + 1) : "");
  if (!from) {
    for (const key of ["destination", "checkIn", "checkOut", "guests"]) {
      const v = sp.get(key);
      if (v) params.set(key, v);
    }
  }
  const q = params.toString();
  return q ? `/search?${q}` : "/search";
}

interface CompareLoad {
  key: string | null;
  data: CompareResponse | null;
  failed: boolean;
  error: unknown;
}

/**
 * F672/F673: hata nesnesini korur (kod → arayüz dilinde metin); adres ya da dil değişince
 * `loading` verir, eski tablo göstergesiz kalmaz. setState yalnızca Promise geri çağrısında.
 */
function useCompareData(url: string | null) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<CompareLoad>({
    key: null,
    data: null,
    failed: false,
    error: null,
  });
  const key = url === null ? null : `${version}:${url}`;
  useEffect(() => {
    if (url === null) return;
    let active = true;
    const loadKey = `${version}:${url}`;
    apiFetch<CompareResponse>(url).then(
      (data) => {
        if (active) setState({ key: loadKey, data, failed: false, error: null });
      },
      (error: unknown) => {
        if (active) setState({ key: loadKey, data: null, failed: true, error });
      }
    );
    return () => {
      active = false;
    };
  }, [url, version]);
  return {
    data: state.data,
    failed: state.failed,
    error: state.error,
    loading: key !== null && state.key !== key,
    reload: () => setVersion((v) => v + 1),
  };
}

/** v4 P1-9: 2–4 ilanın yapılandırılmış farkı + teklif motoru toplamları + AI yorumu. */
function CompareContent() {
  const t = useTranslations("compare");
  const tSearch = useTranslations("search");
  const tProperty = useTranslations("property");
  const errorText = useErrorText();
  const f = useFormat();
  const locale = useLocale();
  const sp = useSearchParams();
  const router = useRouter();
  const { ids: selected, toggle, clear } = useCompareSelection();
  const regionRef = useRef<HTMLDivElement>(null);
  const needMoreRef = useRef<HTMLParagraphElement>(null);
  const focusNeedMore = useRef(false);
  const [diffOnly, setDiffOnly] = useState(false);
  const [now] = useState(() => Date.now());
  const idsParam = sp.get("ids");
  // F1202: adreste `ids` yoksa (yer imi, geçmiş) bu tarayıcıdaki kayıtlı seçim kullanılır.
  const ids =
    idsParam === null
      ? selected
      : idsParam
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
  const query = new URLSearchParams(sp.toString());
  // Adres tamamlanınca aynı sorgu oluşsun diye `ids`, `locale`'den önce eklenir (çift istek yok).
  if (idsParam === null) query.set("ids", ids.join(","));
  query.delete("from");
  query.set("locale", locale);
  const enough = ids.length >= 2;
  const res = useCompareData(enough ? `/api/compare?${query.toString()}` : null);
  const backHref = searchHref(sp);
  const storedIds = idsParam === null && enough ? ids.join(",") : "";

  // F1202: kayıtlı seçim adrese yazılır; bağlantı paylaşılabilir ve yer imi kalıcı olur.
  useEffect(() => {
    if (!storedIds) return;
    const next = new URLSearchParams(sp.toString());
    next.set("ids", storedIds);
    router.replace(`/compare?${next.toString()}`, { scroll: false });
  }, [storedIds, sp, router]);

  // F676: son ilanlar çıkarılınca odak <body>'ye düşmesin; "en az 2 ilan" iletisine taşınır.
  useEffect(() => {
    if (enough || !focusNeedMore.current) return;
    focusNeedMore.current = false;
    needMoreRef.current?.focus();
  }, [enough]);

  // F676: sütundan ilan çıkarma — adres ve (varsa) kayıtlı seçim güncellenir.
  const remove = (id: string) => {
    if (selected.includes(id)) toggle(id);
    const remaining = ids.filter((x) => x !== id);
    const next = new URLSearchParams(sp.toString());
    next.set("ids", remaining.join(","));
    if (remaining.length >= 2) regionRef.current?.focus();
    else focusNeedMore.current = true;
    router.replace(`/compare?${next.toString()}`, { scroll: false });
  };

  if (!enough) {
    return (
      <p ref={needMoreRef} tabIndex={-1} className="text-sm text-gray-700">
        {t("needMore")}{" "}
        <Link href={backHref} className={`underline ${focusRing}`}>
          {t("backToSearch")}
        </Link>
      </p>
    );
  }
  if (res.failed) {
    // F201: hata çıkmaz sokak olmasın — yeniden dene, aramaya dön ya da seçimi sıfırla.
    // F672: sunucu iletisi yerine hata kodunun arayüz dilindeki karşılığı gösterilir.
    const code = res.error instanceof ApiError ? res.error.code : undefined;
    const specific = code && t.has(`errors.${code}`) ? t(`errors.${code}`) : null;
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-700">
          {specific ?? errorText(res.error)}
        </p>
        {!specific && <p className="text-sm text-gray-700">{t("errorHelp")}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button busy={res.loading} onClick={res.reload}>
            {t("retry")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              clear();
              router.push(backHref);
            }}
          >
            {t("resetAndBack")}
          </Button>
          <Link
            href={backHref}
            className={`inline-flex min-h-[44px] items-center text-sm underline sm:min-h-[24px] ${focusRing}`}
          >
            {t("backToSearch")}
          </Link>
        </div>
      </div>
    );
  }
  const data = res.data;
  // Çıkarılan ilan yeni yanıt gelmeden sütundan kalkar (F676).
  const listings = data ? data.listings.filter((l) => !res.loading || ids.includes(l.id)) : [];
  if (!data || listings.length < 2) {
    return (
      <p role="status" className="text-sm text-gray-700">
        {t("loading")}
      </p>
    );
  }

  const ctx = { checkIn: data.checkIn, checkOut: data.checkOut, guests: data.guests };
  const badges = badgeIds(listings);

  // F680: saat yerine gün; tarihler biliniyorsa son ücretsiz iptal günü mutlak tarih olarak.
  const checkInMs = data.checkIn ? Date.parse(`${data.checkIn}T00:00:00.000Z`) : NaN;
  const freeCancelText = (hours: number): string => {
    if (hours % 24 === 0 && !Number.isNaN(checkInMs)) {
      const deadline = checkInMs - (hours / 24) * DAY_MS;
      // Son gün geçtiyse tarih vermek yanıltır.
      if (deadline + DAY_MS <= now) return t("freeCancelPassed");
      return t("freeCancelUntil", { date: f.date(new Date(deadline), "medium") });
    }
    if (hours === 0) return t("freeCancelAnytime");
    if (hours % 24 === 0) return t("freeCancelDays", { days: hours / 24 });
    return t("freeCancel", { hours });
  };

  // F682: olanak adları simge koduyla arayüz dilinde; çevirisi yoksa ad Türkçe işaretlenir.
  const amenityIcons: Record<string, string | null> = Object.assign(
    {},
    ...listings.map((l) => l.amenityIcons ?? {})
  );
  const amenityText = (name: string): string | null => {
    const code = amenityIcons[name];
    return code && tProperty.has(`amenityNames.${code}`) ? tProperty(`amenityNames.${code}`) : null;
  };
  const amenityLabel = (name: string): ReactNode =>
    amenityText(name) ?? (locale === "tr" ? name : <span lang="tr">{name}</span>);
  const byLabel = (a: string, b: string) =>
    (amenityText(a) ?? a).localeCompare(amenityText(b) ?? b, f.locale);
  // F1204: görünen sütunların hepsindeki olanaklar; "yalnızca farklar" açıkken bir kez gösterilir.
  const common = new Set(
    listings[0].amenities.filter((a) => listings.every((l) => l.amenities.includes(a)))
  );
  const showDiffOnly = diffOnly && common.size > 0;
  const cell = "border-b border-gray-200 px-3 py-2 align-top text-sm text-gray-900";
  // F587: yatay kaydırmada satır başlıkları görünür kalsın.
  const rowHead = `${cell} sticky left-0 z-10 bg-white text-left font-medium text-gray-700`;
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        {data.checkIn && data.checkOut
          ? t("dates", {
              checkIn: f.date(data.checkIn, "medium"),
              checkOut: f.date(data.checkOut, "medium"),
              guests: data.guests,
            })
          : t.rich("noDatesLink", {
              link: (chunks) => (
                <Link href={backHref} className={`underline ${focusRing}`}>
                  {chunks}
                </Link>
              ),
            })}
      </p>
      {/* F673: dil ya da ilan değişince eski tablo yenilenirken duyurulur. */}
      <p role="status" className={res.loading ? "text-sm text-gray-700" : "sr-only"}>
        {res.loading ? t("updating") : ""}
      </p>
      {common.size > 0 && (
        <label className="flex min-h-[44px] w-fit items-center gap-2 text-sm text-gray-800 sm:min-h-[24px]">
          <input
            type="checkbox"
            checked={diffOnly}
            onChange={(e) => setDiffOnly(e.target.checked)}
            className={`h-4 w-4 rounded border-gray-400 text-[#003580] ${focusRing}`}
          />
          {t("diffOnly")}
        </label>
      )}

      <div
        ref={regionRef}
        className={`overflow-x-auto rounded-lg border border-gray-200 bg-white ${focusRing}`}
        role="region"
        aria-label={t("tableLabel")}
        aria-busy={res.loading || undefined}
        tabIndex={0}
      >
        <table className="min-w-full border-separate border-spacing-0" data-testid="compare-table">
          <caption className="sr-only">{t("tableLabel")}</caption>
          <thead>
            <tr>
              {/* F1203: köşe boş veri hücresi; satır başlıklarına sütun başlığı eklenmesin. */}
              <td className={rowHead} />
              {listings.map((l) => (
                <th
                  key={l.id}
                  scope="col"
                  className={`${cell} min-w-[11rem] text-left font-semibold`}
                >
                  {/* F678: tarih/misafir ile karşılaştırılan oda ve fiyat seçeneği de taşınır. */}
                  <Link
                    href={propertyHref(l.id, {
                      ...ctx,
                      roomId: l.price.roomId,
                      ratePlanId: l.price.ratePlanId,
                    })}
                    className={`underline ${focusRing}`}
                  >
                    {l.title}
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(l.id)}
                    aria-label={t("removeNamed", { title: l.title })}
                    className={`mt-1 flex min-h-[44px] items-center text-xs font-normal text-gray-700 underline sm:min-h-[24px] ${focusRing}`}
                  >
                    {t("removeShort")}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className={rowHead}>
                {t("rows.total")}
              </th>
              {listings.map((l) => (
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
                      {/* F679: kartlardaki toplamla aynı niteleyici. */}
                      <span className="block text-xs text-gray-700">
                        {tSearch("card.taxesIncluded")}
                      </span>
                      {badges.cheapest.has(l.id) && <Badge>{t("badges.cheapest")}</Badge>}
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
              <th scope="row" className={rowHead}>
                {t("rows.rating")}
              </th>
              {listings.map((l) => (
                <td key={l.id} className={cell}>
                  {l.rating.count > 0
                    ? t("ratingValue", {
                        avg: f.number(l.rating.avg, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        }),
                        count: l.rating.count,
                      })
                    : t("noRating")}
                  {badges.bestRated.has(l.id) && <Badge>{t("badges.bestRated")}</Badge>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={rowHead}>
                {t("rows.cancellation")}
              </th>
              {listings.map((l) => (
                <td key={l.id} className={cell}>
                  {t(`policy.${l.cancellation.kind}`)}
                  {l.cancellation.freeCancellationHours !== null ? (
                    <span className="block text-xs text-gray-700">
                      {freeCancelText(l.cancellation.freeCancellationHours)}
                    </span>
                  ) : (
                    l.cancellation.kind !== "NON_REFUNDABLE" && (
                      <span className="block text-xs text-gray-700">{t("noFreeCancel")}</span>
                    )
                  )}
                  {badges.mostFlexible.has(l.id) && <Badge>{t("badges.mostFlexible")}</Badge>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={rowHead}>
                {t("rows.location")}
              </th>
              {listings.map((l) => (
                <td key={l.id} className={cell}>
                  {l.city}, {l.country}
                </td>
              ))}
            </tr>
            {showDiffOnly && (
              <tr>
                <th scope="row" className={rowHead}>
                  {t("rows.commonAmenities")}
                </th>
                <td colSpan={listings.length} className={cell}>
                  <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {[...common].sort(byLabel).map((a) => (
                      <li key={a}>{amenityLabel(a)}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            )}
            <tr>
              <th scope="row" className={rowHead}>
                {showDiffOnly ? t("rows.otherAmenities") : t("rows.amenities")}
              </th>
              {listings.map((l) => {
                const unique = new Set(data.diff.uniqueAmenities[l.id] ?? []);
                const shown = l.amenities
                  .filter((a) => !showDiffOnly || !common.has(a))
                  .sort(byLabel);
                return (
                  <td key={l.id} className={cell}>
                    {shown.length > 0 ? (
                      <ul className="space-y-0.5">
                        {shown.map((a) => (
                          <li key={a}>
                            {amenityLabel(a)}
                            {unique.has(a) && (
                              <span className="ml-1 text-xs font-medium text-indigo-800">
                                ({t("onlyHere")})
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-gray-700">
                        {showDiffOnly ? t("noOtherAmenities") : t("noAmenities")}
                      </span>
                    )}
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
      <Suspense
        fallback={
          <p role="status" className="text-sm text-gray-700">
            {t("loading")}
          </p>
        }
      >
        <CompareContent />
      </Suspense>
    </PageShell>
  );
}
