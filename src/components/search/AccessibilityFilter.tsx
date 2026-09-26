"use client";

import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import {
  ACCESSIBILITY_CODES,
  type AccessibilityCodeValue,
} from "@/lib/compliance/accessibility-codes";

/** P1-13(e): doğrulanmış erişilebilirlik özellikleri filtresi (AND; `accessibility=` URL'de). */
export default function AccessibilityFilter({
  selected,
  onChange,
}: {
  selected: readonly AccessibilityCodeValue[];
  onChange: (codes: AccessibilityCodeValue[]) => void;
}) {
  const t = useTranslations("compliance.accessibility");
  const toggle = (code: AccessibilityCodeValue) =>
    onChange(
      selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code].sort()
    );

  return (
    <fieldset className="mt-4" aria-describedby="a11y-filter-hint">
      <legend className="text-sm font-medium text-gray-800">{t("filterTitle")}</legend>
      <p id="a11y-filter-hint" className="mt-1 text-xs text-gray-600">
        {t("filterHint")}
      </p>
      <div className="mt-2 space-y-2">
        {ACCESSIBILITY_CODES.map((code) => (
          <label key={code} className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={selected.includes(code)}
              onChange={() => toggle(code)}
              className={`h-4 w-4 rounded border-gray-400 text-[#003580] ${focusRing}`}
            />
            {t(`codes.${code}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
