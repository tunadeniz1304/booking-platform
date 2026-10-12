"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import { COMPARE_MAX, useCompareSelection } from "./useCompareSelection";

/**
 * İlan kartında/sayfasında "Karşılaştırmaya ekle" düğmesi (en fazla 4 ilan).
 * F90: etiket durumu anlatır (ekle/çıkar), bu yüzden aria-pressed kullanılmaz; seçim sayısı
 * CompareBar'daki canlı bölgeden duyurulur. Sınır dolunca düğme odaklanabilir kalır
 * (aria-disabled) ve nedeni görünür bir açıklamayla verilir.
 * F1209: bağlantıdan ayırt edilsin diye onay kutusu görünümlü, çerçeveli bir düğmedir.
 * F698/F972: `title` verilince erişilebilir ad görünen etiketle başlar ve ilan adını içerir.
 */
export default function CompareToggle({
  propertyId,
  className = "",
  title,
}: {
  propertyId: string;
  /** Ek yerleşim sınıfları; ör. kartı kaplayan bağlantının üstünde kalmak için `relative z-[2]`. */
  className?: string;
  /** İlan adı; listelerde aynı etiketli düğmeleri ayırt etmek için erişilebilir ada eklenir. */
  title?: string;
}) {
  const t = useTranslations("compare");
  const hintId = useId();
  const { ids, toggle, full } = useCompareSelection();
  const selected = ids.includes(propertyId);
  const blocked = !selected && full;
  return (
    <>
      <button
        type="button"
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? hintId : undefined}
        aria-label={
          title ? (selected ? t("removeNamed", { title }) : t("addNamed", { title })) : undefined
        }
        onClick={() => {
          if (blocked) return;
          toggle(propertyId);
        }}
        className={`mr-3 mt-1 inline-flex min-h-[44px] items-center gap-2 rounded-md border border-current px-3 py-1 text-sm font-medium aria-disabled:cursor-not-allowed aria-disabled:text-gray-400 sm:min-h-[24px] ${
          selected ? "text-green-800" : "text-blue-700"
        } ${focusRing} ${className}`}
        data-testid="compare-toggle"
      >
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2" />
          {selected && (
            <path
              d="M4.5 8.25l2.25 2.25 4.75-5"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
        {selected ? t("remove") : t("add")}
      </button>
      {blocked && (
        <span id={hintId} className="block text-xs text-gray-700">
          {t("fullHint", { max: COMPARE_MAX })}
        </span>
      )}
    </>
  );
}
