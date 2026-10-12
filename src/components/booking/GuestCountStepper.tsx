"use client";

import { useState, type ReactNode } from "react";

const stepButton =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-lg font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const field =
  "h-11 w-14 rounded-lg border border-gray-300 px-1 text-center text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm";

export interface GuestCountStepperProps {
  /** Sayı alanının kimliği (etiket buna bağlanır; hata metni `${id}-error`). */
  id: string;
  label: ReactNode;
  /** Alandaki metin (taslak; yazım sırasında geçersiz ara değer olabilir). */
  value: string;
  min: number;
  max: number;
  /** Elle yazım. */
  onChange: (value: string) => void;
  /** −/+ düğmesi ya da yukarı/aşağı ok tuşu ile yeni değer. */
  onStep: (next: number) => void;
  /** Alandan çıkış ya da Enter: yazılan değer kaydedilir. */
  onCommit?: () => void;
  decreaseLabel: string;
  increaseLabel: string;
  /** Adımdan sonra ekran okuyucuya okunan metin (ör. "Yetişkin: 3"). */
  valueText?: (n: number) => string;
  disabled?: boolean;
  /** Kayıt sürerken: alan salt okunur, düğmeler odakta kalır ama işlem yapmaz. */
  busy?: boolean;
  error?: ReactNode;
  /** Alana ek açıklama kimlikleri (ör. kalem hatası, kilit uyarısı). */
  describedBy?: string;
  className?: string;
}

/**
 * Kişi sayısı alanı: 44px −/+ düğmeleri ve elle yazılabilen sayı. Sınırda ya da meşgulken
 * düğmeler `aria-disabled` olur (odak düşmez); `disabled` iken hepsi devre dışıdır.
 */
export function GuestCountStepper({
  id,
  label,
  value,
  min,
  max,
  onChange,
  onStep,
  onCommit,
  decreaseLabel,
  increaseLabel,
  valueText,
  disabled = false,
  busy = false,
  error,
  describedBy,
  className = "",
}: GuestCountStepperProps) {
  const [stepped, setStepped] = useState("");
  const errorId = `${id}-error`;
  const parsed = Number(value);
  const current = value.trim() !== "" && Number.isInteger(parsed) ? parsed : null;
  const atMin = current !== null && current <= min;
  const atMax = current !== null && current >= max;
  const describedByIds = [error ? errorId : null, describedBy].filter(Boolean).join(" ");

  const step = (delta: 1 | -1) => {
    if (disabled || busy) return;
    const next = current === null ? min : Math.min(max, Math.max(min, current + delta));
    if (next === current) return;
    setStepped(valueText ? valueText(next) : "");
    onStep(next);
  };

  return (
    <div className={className}>
      <label htmlFor={id}>{label}</label>
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={disabled}
          aria-disabled={busy || atMin || undefined}
          aria-controls={id}
          aria-label={decreaseLabel}
          className={stepButton}
        >
          <span aria-hidden="true">−</span>
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className={field}
          value={value}
          disabled={disabled}
          readOnly={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds || undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit?.();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              step(e.key === "ArrowUp" ? 1 : -1);
            }
          }}
        />
        <button
          type="button"
          onClick={() => step(1)}
          disabled={disabled}
          aria-disabled={busy || atMax || undefined}
          aria-controls={id}
          aria-label={increaseLabel}
          className={stepButton}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {stepped}
      </span>
      {error && (
        <p id={errorId} className="mt-1 max-w-[12rem] text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export default GuestCountStepper;
