"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import { COMPARE_MAX, useCompareSelection } from "./useCompareSelection";

/**
 * Arama kartında "Karşılaştırmaya ekle" düğmesi (en fazla 4 ilan).
 * F90: etiket durumu anlatır (ekle/çıkar), bu yüzden aria-pressed kullanılmaz; seçim sayısı
 * CompareBar'daki canlı bölgeden duyurulur. Sınır dolunca düğme odaklanabilir kalır
 * (aria-disabled) ve nedeni görünür bir açıklamayla verilir.
 */
export default function CompareToggle({ propertyId }: { propertyId: string }) {
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
        onClick={() => {
          if (blocked) return;
          toggle(propertyId);
        }}
        className={`mr-3 mt-1 inline-flex min-h-[44px] items-center text-sm font-medium underline aria-disabled:cursor-not-allowed aria-disabled:text-gray-400 sm:min-h-[24px] ${
          selected ? "text-green-800" : "text-blue-700"
        } ${focusRing}`}
        data-testid="compare-toggle"
      >
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
