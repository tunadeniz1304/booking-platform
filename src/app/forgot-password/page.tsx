"use client";

import { FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { Button, Status } from "@/components/ui/ui";
import { postJsonWithPow } from "@/lib/auth/pow-fetch";

/** Giriş formuyla aynı kural: sunucunun reddettiği "a@b" gibi adresler gönderilmeden yakalanır. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 60;
const linkClass =
  "inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]";

const noopSubscribe = () => () => {};
/** Posta kutusu bağlantısı yalnız demo modunda (sunucu `<html data-demo>` yazar). */
const isDemoDocument = () => document.documentElement.dataset.demo === "true";

type RequestResult = { ok: true } | { ok: false; invalid: boolean; message: string };

/**
 * Şifre sıfırlama isteği — yanıt hesabın varlığını ele vermez (daima aynı mesaj). Başarıda form
 * yerine "e-postanızı kontrol edin" kartı: spam ipucu, yalnız son bağlantının geçerli olduğu,
 * 60 sn sonra etkinleşen yeniden gönderme ve farklı e-posta deneme.
 */
export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const tNav = useTranslations("nav");
  const authErrorText = useAuthErrorText();
  const redirect = safeRedirect(useSearchParam("redirect"));
  // Girişte yazılan adres `?email=` ile gelir; kullanıcı alanı değiştirene kadar o kullanılır.
  const emailParam = useSearchParam("email");
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const email = typedEmail ?? emailParam ?? "";
  const [state, setState] = useState<"idle" | "sending" | "sent" | "invalid" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const demo = useSyncExternalStore(noopSubscribe, isDemoDocument, () => false);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInputOnForm = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // "Farklı e-posta dene" ile forma dönünce odak alana taşınır.
  useEffect(() => {
    if (state !== "idle" || !focusInputOnForm.current) return;
    focusInputOnForm.current = false;
    inputRef.current?.focus();
  }, [state]);

  const requestLink = async (): Promise<RequestResult> => {
    const res = await postJsonWithPow("/api/auth/password/forgot", { email }).catch(() => null);
    if (res && res.status === 202) return { ok: true };
    if (res && res.status === 400) {
      return { ok: false, invalid: true, message: t("forgot.invalidEmail") };
    }
    const body = res
      ? ((await res.json().catch(() => ({}))) as { code?: string })
      : { code: "NETWORK" };
    return { ok: false, invalid: false, message: authErrorText(body.code, t("forgot.error")) };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setError(null);
    // Biçimsiz e-posta: hata alanın altında, odak alanda.
    if (!EMAIL_PATTERN.test(email.trim())) {
      setState("invalid");
      inputRef.current?.focus();
      return;
    }
    setState("sending");
    const result = await requestLink();
    if (result.ok) {
      setResendMessage(null);
      setResendError(null);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setState("sent");
      return;
    }
    if (result.invalid) {
      setState("invalid");
      inputRef.current?.focus();
      return;
    }
    setError(result.message);
    setState("error");
  };

  const resend = async () => {
    if (resending || cooldown > 0) return;
    setResending(true);
    setResendMessage(null);
    setResendError(null);
    const result = await requestLink();
    setResending(false);
    if (result.ok) {
      setResendMessage(t("forgot.resent"));
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      setResendError(result.message);
    }
  };

  const tryOtherEmail = () => {
    focusInputOnForm.current = true;
    setResendMessage(null);
    setResendError(null);
    setState("idle");
  };

  const backToLogin = (
    <p className="mt-6 text-center text-sm text-gray-600">
      <Link href={withRedirect("/login", redirect)} className={linkClass}>
        {t("backToLogin")}
      </Link>
    </p>
  );

  if (state === "sent") {
    const waiting = cooldown > 0;
    return (
      <AuthCard title={t("forgot.sentTitle")} focusTitle>
        <p className="mt-4 break-words text-sm text-gray-700">
          {t("forgot.sentTo", { email: email.trim() })}
        </p>
        <Notice kind="success" live={false}>
          {t("forgot.sent")}
        </Notice>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>{t("forgot.spamHint")}</li>
          <li>{t("forgot.latestOnly")}</li>
        </ul>
        {demo && (
          <p className="mt-2 text-sm">
            <Link href="/dev/mailbox" className={linkClass}>
              {tNav("mailbox")}
            </Link>
          </p>
        )}
        <div className="mt-6 space-y-3">
          <Button
            variant="secondary"
            busy={resending}
            aria-disabled={waiting || undefined}
            aria-describedby={waiting ? "forgot-resend-wait" : undefined}
            onClick={() => void resend()}
            className="min-h-[44px] w-full"
          >
            {resending ? t("forgot.sending") : t("forgot.resend")}
          </Button>
          {waiting && (
            <p id="forgot-resend-wait" className="text-xs text-gray-600">
              {t("verify.resendWait", { seconds: cooldown })}
            </p>
          )}
          <Status error={resendError} message={resendMessage} />
          <Button variant="secondary" onClick={tryOtherEmail} className="min-h-[44px] w-full">
            {t("forgot.otherEmail")}
          </Button>
        </div>
        {backToLogin}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("forgot.title")} subtitle={t("forgot.subtitle")}>
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
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
              setTypedEmail(e.target.value);
              if (state === "invalid") setState("idle");
            }}
            className={authInputClass}
          />
        </AuthField>
        <button {...submitButtonProps(state === "sending")}>
          {state === "sending" ? t("forgot.sending") : t("forgot.submit")}
        </button>
      </form>
      {state === "error" && <Notice kind="error">{error ?? t("forgot.error")}</Notice>}
      {backToLogin}
    </AuthCard>
  );
}
