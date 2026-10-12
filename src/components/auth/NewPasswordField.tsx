"use client";

import { cloneElement, isValidElement, type ReactElement } from "react";
import { useTranslations } from "next-intl";

/** Sunucuyla aynı yeni şifre kuralları: en az 8 karakter ve en az bir rakam. */
export const NEW_PASSWORD_RULES = {
  minLength: (value: string) => value.length >= 8,
  digit: (value: string) => /[0-9]/.test(value),
} as const;

export type NewPasswordRule = keyof typeof NEW_PASSWORD_RULES;

const RULE_ORDER: NewPasswordRule[] = ["minLength", "digit"];

/** Tüm kurallar karşılanıyor mu (kayıt ve şifre sıfırlamada aynı gönderim kontrolü). */
export function newPasswordOk(value: string): boolean {
  return RULE_ORDER.every((rule) => NEW_PASSWORD_RULES[rule](value));
}

/**
 * Yeni şifre alanı: alanın altında kalıcı kural listesi (✓/○ simgesi ve ekran okuyucu için
 * "karşılandı/karşılanmadı" metni; bilgi yalnız renge bağlı değil), `aria-describedby` ile
 * alana bağlı. Kural durumu değişince liste maddesi kibarca duyurulur. Hata metni ve
 * `aria-invalid` yalnız çağıran `error` verince (alandan çıkışta ya da gönderimde) görünür.
 * `AuthField` ile aynı görünüm; tek alt öğe input'tur (ör. `PasswordRevealInput`).
 */
export default function NewPasswordField({
  id,
  label,
  value,
  error,
  children,
}: {
  id: string;
  label: string;
  value: string;
  error?: string | null;
  children: ReactElement;
}) {
  const t = useTranslations("auth");
  const rulesId = `${id}-rules`;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [rulesId, errorId].filter(Boolean).join(" ");
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true } : {}),
      })
    : children;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      {control}
      <ul id={rulesId} aria-live="polite" className="mt-1 space-y-0.5 text-xs text-gray-600">
        {RULE_ORDER.map((rule) => {
          const met = NEW_PASSWORD_RULES[rule](value);
          return (
            <li key={rule} aria-atomic="true" className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block w-3 text-center">
                {met ? "✓" : "○"}
              </span>
              <span>
                {t(`passwordRules.${rule}`)}{" "}
                <span className="sr-only">
                  {met ? t("passwordRules.met") : t("passwordRules.unmet")}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
