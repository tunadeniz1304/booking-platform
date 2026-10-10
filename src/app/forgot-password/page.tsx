"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import AuthCard, {
  AuthField,
  Notice,
  authInputClass,
  safeRedirect,
  submitButtonProps,
  useAuthErrorText,
  useSearchParam,
  withRedirect,
} from "@/components/auth/AuthCard";
import { postJsonWithPow } from "@/lib/auth/pow-fetch";

/** Şifre sıfırlama isteği — yanıt hesabın varlığını ele vermez (daima aynı mesaj). */
export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const authErrorText = useAuthErrorText();
  const redirect = safeRedirect(useSearchParam("redirect"));
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "invalid" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setError(null);
    setState("sending");
    const res = await postJsonWithPow("/api/auth/password/forgot", { email }).catch(() => null);
    if (res && res.status === 202) {
      setState("sent");
      return;
    }
    if (res && res.status === 400) {
      // Biçimsiz e-posta: hata alanın altında, odak alanda.
      setState("invalid");
      inputRef.current?.focus();
      return;
    }
    const body = res
      ? ((await res.json().catch(() => ({}))) as { code?: string })
      : { code: "NETWORK" };
    setError(authErrorText(body.code, t("forgot.error")));
    setState("error");
  };

  return (
    <AuthCard title={t("forgot.title")} subtitle={t("forgot.subtitle")}>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <AuthField
          id="email"
          label={t("email")}
          error={state === "invalid" ? t("forgot.invalidEmail") : null}
        >
          <input
            ref={inputRef}
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === "invalid") setState("idle");
            }}
            className={authInputClass}
          />
        </AuthField>
        <button {...submitButtonProps(state === "sending")}>
          {state === "sending" ? t("forgot.sending") : t("forgot.submit")}
        </button>
      </form>
      {state === "sent" && <Notice kind="success">{t("forgot.sent")}</Notice>}
      {state === "error" && <Notice kind="error">{error ?? t("forgot.error")}</Notice>}
      <p className="mt-6 text-center text-sm text-gray-600">
        <Link
          href={withRedirect("/login", redirect)}
          className="inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]"
        >
          {t("backToLogin")}
        </Link>
      </p>
    </AuthCard>
  );
}
