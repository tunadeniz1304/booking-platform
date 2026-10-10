"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import { COMPARE_MAX, useCompareSelection } from "./useCompareSelection";

/** Seçili ilanlar için yapışkan alt çubuk; arama tarih/misafir bilgisini taşır. */
export default function CompareBar({
  checkIn,
  checkOut,
  guests,
}: {
  checkIn?: string;
  checkOut?: string;
  guests?: number;
}) {
  const t = useTranslations("compare");
  const { ids, clear, full } = useCompareSelection();
  const barRef = useRef<HTMLDivElement>(null);
  const visible = ids.length > 0;

  // F89/F165: çubuk görünürken yüksekliği kadar sayfa sonuna boşluk ve kaydırma payı ayır;
  // böylece odaktaki öğeler ve footer bağlantıları çubuğun altında kalmaz (WCAG 2.4.11).
  useEffect(() => {
    const el = barRef.current;
    if (!visible || !el) return;
    const body = document.body;
    const root = document.documentElement;
    const prevPadding = body.style.paddingBottom;
    const prevScrollPadding = root.style.scrollPaddingBottom;
    const apply = () => {
      const h = `${Math.ceil(el.getBoundingClientRect().height)}px`;
      body.style.paddingBottom = h;
      root.style.scrollPaddingBottom = h;
    };
    apply();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      body.style.paddingBottom = prevPadding;
      root.style.scrollPaddingBottom = prevScrollPadding;
    };
  }, [visible]);

  const params = new URLSearchParams({ ids: ids.join(",") });
  if (checkIn && checkOut) {
    params.set("checkIn", checkIn);
    params.set("checkOut", checkOut);
  }
  if (guests) params.set("guests", String(guests));

  const announcement = !visible
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
          className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-lg"
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
            <span className="min-w-0 font-medium text-gray-900">
              {t("bar", { count: ids.length })}
              {full && (
                <span className="block text-xs font-normal text-gray-700">
                  {t("fullHint", { max: COMPARE_MAX })}
                </span>
              )}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={clear}
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
        </div>
      )}
    </>
  );
}
