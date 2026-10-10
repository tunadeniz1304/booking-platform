"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import AuthCard, {
  AuthField,
  Notice,
  authInputClass,
  submitButtonProps,
  useAuthErrorText,
  useSearchParam,
} from "@/components/auth/AuthCard";

/** Sunucunun kabul ettiği en kısa token (password/reset route: z.string().min(20)). */
const MIN_TOKEN_LENGTH = 20;
const passwordOk = (v: string) => v.length >= 8 && /[0-9]/.test(v);

/** E-postadaki bağlantıyla yeni şifre belirleme; başarılıysa tüm oturumlar kapanır. */
export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const authErrorText = useAuthErrorText();
  const token = useSearchParam("token");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "invalidLink">("idle");
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === "saving") return;
    setError(null);
    if (!passwordOk(password)) {
      setPasswordError(t("register.errors.password"));
      inputRef.current?.focus();
      return;
    }
    setPasswordError(null);
    setState("saving");
    const res = await fetch("/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token ?? "", password }),
    }).catch(() => null);
    if (res?.ok) {
      setState("done");
      return;
    }
    if (!res) {
      setError(authErrorText("NETWORK", t("reset.failed")));
      setState("idle");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      details?: { fieldErrors?: Record<string, string[] | undefined> };
    };
    const fieldErrors = body.details?.fieldErrors;
    if (fieldErrors?.password?.length) {
      setPasswordError(t("register.errors.password"));
      setState("idle");
      inputRef.current?.focus();
      return;
    }
    // Biçimsiz, kullanılmış ya da süresi dolmuş token: sunucu VALIDATION_ERROR döner.
    if (body.code === "VALIDATION_ERROR") {
      setState("invalidLink");
      return;
    }
    setError(authErrorText(body.code, t("reset.failed")));
    setState("idle");
  };

  if (state === "done") {
    return (
      <AuthCard title={t("reset.doneTitle")}>
        <Notice kind="success">{t("reset.doneMessage")}</Notice>
        <p className="mt-6 text-center text-sm">
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]"
          >
            {t("reset.loginLink")}
          </Link>
        </p>
      </AuthCard>
    );
  }

  // Eksik/biçimsiz bağlantıda form hiç gösterilmez; yeni bağlantı isteme yolu verilir.
  const tokenInvalid = token !== undefined && (token ?? "").length < MIN_TOKEN_LENGTH;
  if (state === "invalidLink" || tokenInvalid) {
    return (
      <AuthCard title={t("reset.invalidTitle")}>
        <Notice kind="error">{t("reset.invalidLink")}</Notice>
        <Link
          href="/forgot-password"
          className="mt-6 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66]"
        >
          {t("reset.requestNew")}
        </Link>
        <p className="mt-4 text-center text-sm">
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]"
          >
            {t("backToLogin")}
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("reset.title")} subtitle={t("reset.subtitle")}>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <AuthField id="password" label={t("reset.newPassword")} error={passwordError}>
          <input
            ref={inputRef}
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
            }}
            className={authInputClass}
          />
        </AuthField>
        <button {...submitButtonProps(state === "saving")}>
          {state === "saving" ? t("saving") : t("reset.submit")}
        </button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
      <p className="mt-6 text-center text-sm">
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]"
        >
          {t("backToLogin")}
        </Link>
      </p>
    </AuthCard>
  );
}
