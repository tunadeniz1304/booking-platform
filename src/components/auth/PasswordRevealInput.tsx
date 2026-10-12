"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";

export interface PasswordRevealInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  id: string;
}

/**
 * Göster/gizle düğmeli parola alanı: `aria-pressed` + `aria-controls`, ≥44px dokunma alanı.
 * Form gönderilince alan yeniden gizlenir. `AuthField` / `Field` içinde tek alt öğe olarak
 * kullanılabilir: verilen `aria-describedby` / `aria-invalid` input'a geçer.
 */
export default function PasswordRevealInput({
  id,
  className = "",
  ...rest
}: PasswordRevealInputProps) {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const form = buttonRef.current?.form;
    if (!form) return;
    const hide = () => setVisible(false);
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);

  return (
    <div className="relative">
      <input
        {...rest}
        id={id}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={`${className} pr-12`}
      />
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("passwordReveal.show")}
        aria-pressed={visible}
        aria-controls={id}
        onClick={() => setVisible((v) => !v)}
        className={`absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-gray-600 hover:text-gray-900 ${focusRing}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          {visible ? (
            <path d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
          ) : (
            <>
              <path d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
              <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
