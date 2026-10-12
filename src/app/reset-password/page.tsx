"use client";

import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import AuthCard, {
  Notice,
  authInputClass,
  submitButtonProps,
  useAuthErrorText,
  useSearchParam,
} from "@/components/auth/AuthCard";
import NewPasswordField, { newPasswordOk } from "@/components/auth/NewPasswordField";
import PasswordRevealInput from "@/components/auth/PasswordRevealInput";

/** Sunucunun kabul ettiği en kısa token (password/reset route: z.string().min(20)). */
const MIN_TOKEN_LENGTH = 20;
/** Asılı kalan sıfırlama isteği bu sürede `networkError` yoluna düşer. */
const RESET_TIMEOUT_MS = 20_000;

const noopSubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

const focusPassword = () => document.getElementById("password")?.focus();

/** E-postadaki bağlantıyla yeni şifre belirleme; başarılıysa tüm oturumlar kapanır. */
export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const authErrorText = useAuthErrorText();
  const token = useSearchParam("token");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "invalidLink">("idle");
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [networkFailed, setNetworkFailed] = useState(false);
  /** Bağlantının hesabı (ön kontrolden); parola yöneticisi yeni şifreyi bu hesaba kaydeder. */
  const [email, setEmail] = useState<string | null>(null);
  // Hidrasyondan önce gönder düğmesi devre dışı: Enter yerel GET gönderimiyle sayfayı yenilemez.
  const hydrated = useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot);

  // Token'ı tüketmeden ön kontrol: kullanılmış/süresi dolmuş bağlantıda form hiç gösterilmez.
  useEffect(() => {
    if (!token || token.length < MIN_TOKEN_LENGTH) return;
    let active = true;
    fetch("/api/auth/password/reset/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { email?: string; code?: string };
        if (!active) return;
        if (res.ok && body.email) setEmail(body.email);
        else if (body.code === "VALIDATION_ERROR") {
          setState((s) => (s === "idle" ? "invalidLink" : s));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === "saving") return;
    setError(null);
    setNetworkFailed(false);
    if (!newPasswordOk(password)) {
      setPasswordError(t("register.errors.password"));
      focusPassword();
      return;
    }
    setPasswordError(null);
    setState("saving");
    const res = await fetch("/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token ?? "", password }),
      signal: AbortSignal.timeout(RESET_TIMEOUT_MS),
    }).catch(() => null);
    if (res?.ok) {
      setState("done");
      return;
    }
    if (!res) {
      // İstek sunucuya ulaşmış olabilir (token tüketilmiş): önce yeni şifreyle girişi önerir.
      setError(t("reset.networkError"));
      setNetworkFailed(true);
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
      focusPassword();
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
      <AuthCard
        title={t("reset.doneTitle")}
        focusTitle
        status={
          <Notice kind="success" live={false}>
            {t("reset.doneMessage")}
          </Notice>
        }
      >
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
      <AuthCard title={t("reset.invalidTitle")} focusTitle>
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
    <AuthCard title={t("reset.title")}>
      <form
        onSubmit={submit}
        aria-busy={state === "saving" || undefined}
        className="mt-6 space-y-4"
      >
        {email && (
          <>
            <p className="text-sm text-gray-700">{t("reset.account", { email })}</p>
            <input
              type="email"
              name="username"
              autoComplete="username"
              value={email}
              readOnly
              hidden
            />
          </>
        )}
        <NewPasswordField
          id="password"
          label={t("reset.newPassword")}
          value={password}
          error={passwordError}
        >
          <PasswordRevealInput
            id="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
            }}
            onBlur={() => {
              // Hata yazarken değil, alandan çıkınca gösterilir.
              if (password && !newPasswordOk(password)) {
                setPasswordError(t("register.errors.password"));
              }
            }}
            className={authInputClass}
          />
        </NewPasswordField>
        <button {...submitButtonProps(state === "saving")} disabled={!hydrated}>
          {state === "saving" ? t("reset.submitting") : t("reset.submit")}
        </button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
      {networkFailed && (
        <p className="mt-4 text-center text-sm">
          <Link
            href="/forgot-password"
            className="inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]"
          >
            {t("reset.requestNew")}
          </Link>
        </p>
      )}
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
