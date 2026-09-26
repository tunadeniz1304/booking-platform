"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import { useCompareSelection } from "./useCompareSelection";

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
  const { ids, clear } = useCompareSelection();
  if (ids.length === 0) return null;
  const params = new URLSearchParams({ ids: ids.join(",") });
  if (checkIn && checkOut) {
    params.set("checkIn", checkIn);
    params.set("checkOut", checkOut);
  }
  if (guests) params.set("guests", String(guests));
  return (
    <div
      role="region"
      aria-label={t("title")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-lg"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-sm">
        <span className="font-medium text-gray-900">{t("bar", { count: ids.length })}</span>
        <span className="flex items-center gap-3">
          <button type="button" onClick={clear} className={`text-gray-700 underline ${focusRing}`}>
            {t("clear")}
          </button>
          {ids.length >= 2 ? (
            <Link
              href={`/compare?${params.toString()}`}
              className={`rounded-md bg-[#003580] px-4 py-2 font-semibold text-white ${focusRing}`}
            >
              {t("open")}
            </Link>
          ) : (
            <span className="text-gray-700">{t("needMore")}</span>
          )}
        </span>
      </div>
    </div>
  );
}
