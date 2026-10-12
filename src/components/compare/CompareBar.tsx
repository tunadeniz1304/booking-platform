"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import { COMPARE_MAX, useCompareBaseline, useCompareSelection } from "./useCompareSelection";
import { useCompareListingTitles } from "./useCompareListingTitles";

/** "Geri al" şeridinin süresi; odak şeritteyken süre işlemez (WCAG 2.2.1). */
const UNDO_MS = 8000;
/** F684: çerez bandı görünürken yüksekliğini bu değişkenle yayınlar; çubuk bandın üstünde durur. */
const COOKIE_OFFSET = "var(--cookie-banner-h, 0px)";

/** Seçili ilanlar için yapışkan alt çubuk; arama tarih/misafir bilgisini taşır. */
export default function CompareBar({
  checkIn,
  checkOut,
  guests,
  adults,
  childCount,
  from,
}: {
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  /** F2-19: yetişkin/çocuk dağılımı karşılaştırma adresine taşınır (isteğe bağlı). */
  adults?: number;
  /** `children` React'in ayrılmış prop adı olduğu için çocuk sayısı bu adla gelir. */
  childCount?: number;
  /** Arama sorgusu (filtreler dahil); karşılaştırmadaki "Aramaya dön" bu aramaya döner. */
  from?: string;
}) {
  const t = useTranslations("compare");
  const { ids, toggle, clear, full } = useCompareSelection();
  const titles = useCompareListingTitles(ids);
  const barRef = useRef<HTMLDivElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  /** Seçim değişince odağın gideceği yer (kaldırılan öğenin odağı <body>'ye düşmesin). */
  const focusAfter = useRef<{ chip: string } | "clear" | "undo" | null>(null);
  // F687: temizlenen seçim geri alınabilir; yeni bir seçim yapılınca geri alma düşer.
  const [undo, setUndo] = useState<readonly string[] | null>(null);
  const [prevCount, setPrevCount] = useState(ids.length);
  if (ids.length !== prevCount) {
    setPrevCount(ids.length);
    if (ids.length > 0 && undo) setUndo(null);
  }
  const undoIds = ids.length === 0 ? undo : null;
  // F2-51: açılışta localStorage'dan dolan seçim duyurulmaz; yalnızca seçim değişince duyurulur.
  const { initialKey, hydrated } = useCompareBaseline();
  const [selectionChanged, setSelectionChanged] = useState(false);
  if (hydrated && !selectionChanged && ids.join(",") !== initialKey) setSelectionChanged(true);
  const visible = ids.length > 0 || undoIds !== null;

  // F89/F165: çubuk görünürken yüksekliği kadar sayfa sonuna boşluk ve kaydırma payı ayır;
  // böylece odaktaki öğeler ve footer bağlantıları çubuğun altında kalmaz (WCAG 2.4.11).
  // F684: pay çerez bandının yüksekliğini de içerir; bant kendi payını yazıp silince
  // (aynı stil alanları) çubuğun payı yeniden kurulur, çubuk kalkınca bandın değeri geri yüklenir.
  useEffect(() => {
    const el = barRef.current;
    if (!visible || !el) return;
    const body = document.body;
    const root = document.documentElement;
    const outer = { padding: body.style.paddingBottom, scroll: root.style.scrollPaddingBottom };
    const applied = { padding: "", scroll: "" };
    const apply = () => {
      const barH = `${Math.ceil(el.getBoundingClientRect().height)}px`;
      const h = `calc(${barH} + ${COOKIE_OFFSET})`;
      // F2-22: yapışkan (sticky) alt öğeler çubuğun üstünde kalsın diye yükseklik değişkeni.
      root.style.setProperty("--compare-bar-h", h);
      body.style.paddingBottom = h;
      root.style.scrollPaddingBottom = h;
      applied.padding = body.style.paddingBottom;
      applied.scroll = root.style.scrollPaddingBottom;
    };
    apply();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    ro?.observe(el);
    const mo =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            const padding = body.style.paddingBottom;
            const scroll = root.style.scrollPaddingBottom;
            if (padding === applied.padding && scroll === applied.scroll) return;
            if (padding !== applied.padding) outer.padding = padding;
            if (scroll !== applied.scroll) outer.scroll = scroll;
            apply();
          });
    mo?.observe(body, { attributes: true, attributeFilter: ["style"] });
    mo?.observe(root, { attributes: true, attributeFilter: ["style"] });
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      body.style.paddingBottom = outer.padding;
      root.style.scrollPaddingBottom = outer.scroll;
      root.style.removeProperty("--compare-bar-h");
    };
  }, [visible]);

  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    if (target === "undo") undoRef.current?.focus();
    else if (target === "clear") clearRef.current?.focus();
    else chipRefs.current.get(target.chip)?.focus();
  }, [ids, undoIds]);

  // Geri alma şeridi süre dolunca kapanır; odak şeritteyse bir sonraki tura kalır.
  useEffect(() => {
    if (!undoIds) return;
    const timer = window.setInterval(() => {
      if (barRef.current?.contains(document.activeElement)) return;
      setUndo(null);
    }, UNDO_MS);
    return () => window.clearInterval(timer);
  }, [undoIds]);

  /** Tümünü temizle ya da son ilanı çıkar: seçim saklanır, odak "Geri al"a taşınır. */
  function clearAll() {
    setUndo(ids);
    focusAfter.current = "undo";
    clear();
  }

  function removeOne(id: string, index: number) {
    if (ids.length === 1) {
      clearAll();
      return;
    }
    const next = ids[index + 1] ?? ids[index - 1];
    focusAfter.current = next ? { chip: next } : null;
    toggle(id);
  }

  function restore() {
    if (!undoIds) return;
    focusAfter.current = "clear";
    undoIds.forEach((id) => toggle(id));
    setUndo(null);
  }

  const params = new URLSearchParams({ ids: ids.join(",") });
  if (checkIn && checkOut) {
    params.set("checkIn", checkIn);
    params.set("checkOut", checkOut);
  }
  if (guests) params.set("guests", String(guests));
  if (adults) params.set("adults", String(adults));
  if (childCount) params.set("children", String(childCount));
  if (from) params.set("from", from);

  const announcement = undoIds
    ? t("cleared")
    : !visible || !selectionChanged
      ? ""
      : full
        ? `${t("bar", { count: ids.length })} ${t("fullHint", { max: COMPARE_MAX })}`
        : ids.length >= 2
          ? `${t("bar", { count: ids.length })} ${t("ready")}`
          : `${t("bar", { count: ids.length })} ${t("needMore")}`;

  return (
    <>
      {/* F90: seçim sayısı her zaman bağlı bir canlı bölgeden duyurulur. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {visible && (
        <div
          ref={barRef}
          role="region"
          aria-label={t("title")}
          style={{ bottom: COOKIE_OFFSET }}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-lg"
        >
          {undoIds ? (
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="font-medium text-gray-900">{t("cleared")}</span>
              <button
                ref={undoRef}
                type="button"
                onClick={restore}
                className={`inline-flex min-h-[44px] items-center px-1 font-semibold text-gray-900 underline sm:min-h-[24px] ${focusRing}`}
              >
                {t("undo")}
              </button>
            </div>
          ) : (
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium text-gray-900">
                  {t("bar", { count: ids.length })}
                  {full && (
                    <span className="block text-xs font-normal text-gray-700">
                      {t("fullHint", { max: COMPARE_MAX })}
                    </span>
                  )}
                </span>
                {/* F686: hangi ilanların seçili olduğu görünür ve tek tek çıkarılabilir. */}
                <ul className="mt-1 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
                  {ids.map((id, index) => {
                    const label = titles[id] ?? t("chipFallback", { n: index + 1 });
                    return (
                      <li
                        key={id}
                        className="inline-flex max-w-[14rem] shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-white py-0.5 pl-3 pr-1 text-xs text-gray-900"
                      >
                        <span className="truncate" title={label}>
                          {label}
                        </span>
                        <button
                          ref={(node) => {
                            if (node) chipRefs.current.set(id, node);
                            else chipRefs.current.delete(id);
                          }}
                          type="button"
                          onClick={() => removeOne(id, index)}
                          aria-label={t("removeNamed", { title: label })}
                          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-700 sm:h-6 sm:w-6 ${focusRing}`}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <span className="flex min-w-0 flex-wrap items-center gap-3">
                <button
                  ref={clearRef}
                  type="button"
                  onClick={clearAll}
                  className={`inline-flex min-h-[44px] items-center px-1 text-gray-700 underline sm:min-h-[24px] ${focusRing}`}
                >
                  {t("clear")}
                </button>
                {ids.length >= 2 ? (
                  <Link
                    href={`/compare?${params.toString()}`}
                    className={`inline-flex min-h-[44px] items-center rounded-md bg-[#003580] px-4 py-2 font-semibold text-white sm:min-h-0 ${focusRing}`}
                  >
                    {t("open")}
                  </Link>
                ) : (
                  <span className="text-gray-700">{t("needMore")}</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
