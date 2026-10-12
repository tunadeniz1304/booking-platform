"use client";

import { startTransition, useOptimistic, useState } from "react";
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
  // F977: seçim URL güncellenene kadar iyimser gösterilir (yavaş ağda kutu hemen işaretlenir).
  const [current, setCurrent] = useOptimistic(selected);
  // Seçim yoksa uzun liste kapalı başlar; kullanıcının aç/kapa tercihi korunur.
  const [open, setOpen] = useState(selected.length > 0);
  const toggle = (code: AccessibilityCodeValue) => {
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code].sort();
    startTransition(() => {
      setCurrent(next);
      onChange(next);
    });
  };

  return (
    <fieldset className="mt-4" aria-describedby="a11y-filter-hint">
      <legend className="text-sm font-medium text-gray-800">{t("filterTitle")}</legend>
      <p id="a11y-filter-hint" className="mt-1 text-xs text-gray-600">
        {t("filterHint")}
      </p>
      <details
        className="mt-1"
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary
          className={`min-h-[44px] cursor-pointer rounded-sm py-3 text-sm font-medium text-gray-800 ${focusRing}`}
        >
          {t("filterSummary", { count: current.length })}
        </summary>
        {/* F553: 44px satırlar (motor engelli ve dokunmatik kullanıcılar için geniş hedef). */}
        <div>
          {ACCESSIBILITY_CODES.map((code) => (
            <label
              key={code}
              className="flex min-h-[44px] items-center gap-2 py-2 text-sm text-gray-800"
            >
              <input
                type="checkbox"
                checked={current.includes(code)}
                onChange={() => toggle(code)}
                className={`h-5 w-5 shrink-0 rounded border-gray-400 text-[#003580] ${focusRing}`}
              />
              {t(`codes.${code}`)}
            </label>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
