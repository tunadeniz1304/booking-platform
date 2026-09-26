"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

const KNOWN_STATUSES = [
  "APPLIED",
  "NOT_FOUND",
  "USAGE_LIMIT_REACHED",
  "EXPIRED",
  "NOT_STARTED",
  "INACTIVE",
];

/**
 * P1-8 kupon alanı: kodu teklife iletir; sonucu (uygulandı / gerekçe) sunucunun teklifinden
 * gösterir. Kullanım rezervasyon anında atomik sayılır.
 */
export default function CouponField({
  applied,
  status,
  onApply,
}: {
  applied: string;
  /** Teklifin kupon sonucu (`quote.coupon.status`). */
  status: string | null;
  onApply: (code: string) => void;
}) {
  const t = useTranslations("quote");
  const id = useId();
  const [value, setValue] = useState(applied);
  const apply = () => onApply(value.trim());
  const statusKey = status && KNOWN_STATUSES.includes(status) ? status : "other";
  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        {t("couponLabel")}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          value={value}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter kuponu uygular; rezervasyon formunu göndermez.
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          className="block w-full rounded-md border border-gray-400 px-3 py-2 text-sm uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]"
          aria-describedby={applied ? `${id}-status` : undefined}
        />
        <button
          type="button"
          onClick={apply}
          className="rounded-md border border-[#003580] px-3 py-2 text-sm font-semibold text-[#003580] hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]"
        >
          {t("couponApply")}
        </button>
        {applied && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              onApply("");
            }}
            className="px-2 py-2 text-sm text-gray-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]"
          >
            {t("couponRemove")}
          </button>
        )}
      </div>
      {applied && status && (
        <p
          id={`${id}-status`}
          data-testid="coupon-status"
          className={`mt-1 text-xs ${status === "APPLIED" ? "text-green-800" : "text-red-700"}`}
        >
          {t(`couponStatus.${statusKey}`)}
        </p>
      )}
    </div>
  );
}
