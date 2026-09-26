"use client";

import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import { useCompareSelection } from "./useCompareSelection";

/** Arama kartında "Karşılaştırmaya ekle" düğmesi (en fazla 4 ilan). */
export default function CompareToggle({ propertyId }: { propertyId: string }) {
  const t = useTranslations("compare");
  const { ids, toggle, full } = useCompareSelection();
  const selected = ids.includes(propertyId);
  const disabled = !selected && full;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={disabled ? t("full") : undefined}
      onClick={() => toggle(propertyId)}
      className={`mr-3 mt-1 inline-block text-sm font-medium underline disabled:cursor-not-allowed disabled:text-gray-400 ${
        selected ? "text-green-800" : "text-blue-700"
      } ${focusRing}`}
      data-testid="compare-toggle"
    >
      {selected ? t("remove") : t("add")}
    </button>
  );
}
