"use client";

import { useEffect, useId, useRef, useState } from "react";
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
 * Sunucu kodu `toUpperCase` ile eşler; alan da aynı biçimi gösterir. CSS `uppercase` TR'de
 * "i"yi "İ" yapıyordu (F1158).
 */
const normalizeCode = (code: string) => code.toUpperCase();

/**
 * P1-8 kupon alanı: kodu teklife iletir; sonucu (uygulandı / gerekçe) sunucunun teklifinden
 * gösterir. Kullanım rezervasyon anında atomik sayılır.
 */
export default function CouponField({
  applied,
  status,
  onApply,
  loading,
}: {
  applied: string;
  /** Teklifin kupon sonucu (`quote.coupon.status`). */
  status: string | null;
  onApply: (code: string) => void;
  /** Teklif yeniden hesaplanıyor; verilirse "Uygula" meşgul görünür (F1013). */
  loading?: boolean;
}) {
  const t = useTranslations("quote");
  const tc = useTranslations("common");
  const id = useId();
  const statusId = `${id}-status`;
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() => normalizeCode(applied));
  const [hint, setHint] = useState<"empty" | "unapplied" | null>(null);
  const appliedCode = normalizeCode(applied.trim());
  const code = value.trim();
  // Yazılıp uygulanmamış kod: rezervasyon yalnız uygulanmış kuponu gönderir (F579).
  const dirty = code !== "" && code !== appliedCode;
  const busy = !!loading && appliedCode !== "" && code === appliedCode;
  const statusKey = status && KNOWN_STATUSES.includes(status) ? status : "other";
  const statusText =
    !appliedCode || !status
      ? ""
      : status === "APPLIED"
        ? t("couponAppliedCode", { code: appliedCode })
        : t(`couponStatus.${statusKey}`);
  const invalid = (!!statusText && status !== "APPLIED") || hint !== null;
  const describedBy = [statusText ? statusId : "", hint ? hintId : ""].filter(Boolean).join(" ");

  // Alan kirliyken rezervasyon formu gönderilmez; odak alana döner ve neden yazılır (F579).
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!dirty || !form) return;
    const guard = (e: SubmitEvent) => {
      e.preventDefault();
      // Formun React onSubmit'i (rezervasyon isteği) hiç çalışmasın.
      e.stopPropagation();
      inputRef.current?.focus();
      setHint("unapplied");
    };
    form.addEventListener("submit", guard);
    return () => form.removeEventListener("submit", guard);
  }, [dirty]);

  const apply = () => {
    if (busy) return;
    if (!code && !appliedCode) {
      setHint("empty");
      return;
    }
    setHint(null);
    onApply(code);
  };

  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        {t("couponLabel")}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          ref={inputRef}
          id={id}
          value={value}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          onChange={(e) => {
            const el = e.currentTarget;
            const next = normalizeCode(el.value);
            if (next !== el.value) {
              // Büyük harfe çevirirken imleç sona atlamasın.
              const { selectionStart, selectionEnd } = el;
              el.value = next;
              el.setSelectionRange(selectionStart, selectionEnd);
            }
            setValue(next);
            setHint(null);
          }}
          onKeyDown={(e) => {
            // Enter kuponu uygular; rezervasyon formunu göndermez.
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          className="block min-w-0 flex-1 rounded-md border border-gray-400 px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] sm:text-sm"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
        />
        <button
          type="button"
          onClick={apply}
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          className="shrink-0 whitespace-nowrap rounded-md border border-[#003580] px-3 py-2 text-sm font-semibold text-[#003580] hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] aria-disabled:cursor-wait"
        >
          {busy ? t("couponApplying") : t("couponApply")}
        </button>
      </div>
      {appliedCode && (
        // Dar ekranda taşmasın diye "Kaldır" sonuç satırında durur (F1159).
        <div className="mt-1 flex flex-wrap items-center gap-x-3">
          {statusText && (
            // Sonuç, checkout'un fiyat duyurusunda okunur (F591); burada ikinci kez duyurulmaz.
            <p
              id={statusId}
              data-testid="coupon-status"
              className={`text-xs ${status === "APPLIED" ? "text-green-800" : "text-red-700"}`}
            >
              {/* Sonuç yalnız renkle ayrılmasın (F376). */}
              <span aria-hidden="true">{status === "APPLIED" ? "\u2713" : "\u26A0\uFE0E"} </span>
              <span className="sr-only">
                {tc(status === "APPLIED" ? "successPrefix" : "errorPrefix")}{" "}
              </span>
              {statusText}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setValue("");
              setHint(null);
              onApply("");
              // Düğme kaybolunca odak sayfa başına düşmesin.
              inputRef.current?.focus();
            }}
            aria-label={t("couponRemoveLabel", { code: appliedCode })}
            className="shrink-0 whitespace-nowrap px-2 py-2 text-sm text-gray-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]"
          >
            {t("couponRemove")}
          </button>
        </div>
      )}
      <div role="status">
        {hint && (
          <p id={hintId} className="mt-1 text-xs text-red-700">
            {hint === "empty" ? t("couponEmpty") : t("couponUnapplied")}
          </p>
        )}
      </div>
    </div>
  );
}
