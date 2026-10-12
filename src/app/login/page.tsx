"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import PasskeyLoginButton from "@/components/auth/PasskeyLoginButton";
import PasswordRevealInput from "@/components/auth/PasswordRevealInput";
import {
  refreshSessionUser,
  setSessionUserCache,
  useSessionUserCache,
} from "@/components/layout/useSessionUserCache";
import { invalidateFavoriteIds } from "@/components/property/useFavoriteIds";
import { Button, ButtonLink, buttonClass } from "@/components/ui/ui";
import { logout } from "@/lib/api-client";
import { rememberAuthEmail } from "@/lib/auth/auth-email-handoff";
import { loginWithPasskeyAutofill } from "@/lib/auth/passkey-autofill-login";
import type { PowChallenge, PowSolution } from "@/lib/auth/pow-solver";
import { isAbortError, solvePowCancellable } from "@/lib/auth/pow-solve-cancellable";

interface LoginResponse {
  user: { id: string; firstName: string; lastName: string; email: string; role: string };
  token: string;
}

interface LoginError {
  error?: string;
  code?: string;
  details?: { pow?: PowChallenge; retryAfterSeconds?: number };
}

type LoginField = "email" | "password";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Rezervasyon akışından gelen dönüş adresleri (giriş nedeni formun üstünde açıklanır). */
const BOOKING_FLOW_PATTERN = /^\/(checkout|cart|pay)(?=[/?#]|$)/;

const cancelButtonClass = buttonClass({ variant: "secondary", fullWidth: true });

const noopSubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

type RedirectContext = "groupPay" | "booking" | "addToCart" | null;

/** Dönüş adresinden giriş nedeni (başlık ve formun üstündeki açıklama buna göre seçilir). */
function redirectContext(redirect: string): RedirectContext {
  if (redirect.startsWith("/pay/share/")) return "groupPay";
  if (BOOKING_FLOW_PATTERN.test(redirect)) return "booking";
  try {
    const intent = new URL(redirect, "http://localhost").searchParams.get("intent");
    if (intent === "add-to-cart") return "addToCart";
  } catch {
    // göreli yol çözülemedi: genel başlık
  }
  return null;
}

/** Dönüş adresi yoksa rolün kendi paneli: ev sahibi ve yönetici misafir ana sayfasına düşmez. */
function homeForRole(role?: string): string {
  if (role === "ADMIN") return "/admin";
  if (role === "HOST") return "/host";
  return "/";
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const authErrorText = useAuthErrorText();
  const redirect = safeRedirect(useSearchParam("redirect"));
  // Ödeme sayfası `reason=checkout` da gönderir: dönüş adresi tanınmasa da bağlam korunur.
  const reason = useSearchParam("reason");
  const context = redirectContext(redirect) ?? (reason === "checkout" ? "booking" : null);
  // Hidrasyondan önce gönder düğmesi devre dışı: Enter yerel GET gönderimiyle sayfayı yenilemez.
  const hydrated = useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot);
  // undefined: oturum bilinmiyor (form gösterilir); oturum açıksa form yerine devam seçenekleri.
  const sessionUser = useSessionUserCache();
  // Kayıt sayfasındaki "giriş yapın" bağlantısı adresi `?email=` ile getirir.
  const emailParam = useSearchParam("email");
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const email = typedEmail ?? emailParam ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LoginField, string>>>({});
  const [credentialError, setCredentialError] = useState(false);
  const [suggestReset, setSuggestReset] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ field: LoginField } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const autofillRef = useRef<AbortController | null>(null);
  const [autofillRound, setAutofillRound] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  // Passkey girişi beklenirken parola formu gönderilmez (iki giriş yarışmaz).
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  // Giriş sonrası yönlendirme sürerken önbellek dolsa da "oturum açık" görünümüne geçilmez.
  const [leaving, setLeaving] = useState(false);
  const waiting = retryIn > 0;
  const autofillReady = sessionUser === null;

  // Hata sonrası odak düzeltilecek alana taşınır (aria-invalid işlendikten sonra).
  useEffect(() => {
    if (!focusRequest) return;
    const input = document.getElementById(focusRequest.field);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }, [focusRequest]);

  // LOGIN_DELAYED: süre dolana kadar geri sayım; bitince durum bölgesinde duyurulur.
  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = setTimeout(() => {
      setRetryIn((s) => s - 1);
      if (retryIn === 1) {
        setError(null);
        setStatus(t("login.retryReady"));
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [retryIn, t]);

  const goBack = useCallback(
    async (role?: string) => {
      setLeaving(true);
      invalidateFavoriteIds();
      // Sonraki sayfanın başlığı kullanıcıyı hemen gösterir ("Giriş yap" yanıp sönmez).
      const user = await refreshSessionUser();
      // Açık yönlendirme yok: yalnız aynı kökendeki göreli yol (safeRedirect).
      const target = safeRedirect(new URLSearchParams(window.location.search).get("redirect"));
      router.push(target === "/" ? homeForRole(role ?? user?.role) : target);
      router.refresh();
    },
    [router]
  );

  // Passkey'i e-posta alanının otomatik doldurma önerisinde sun (oturum yokken; modal passkey
  // girişi başlarken iptal edilir, bitince yeniden kurulur).
  useEffect(() => {
    if (!autofillReady) return;
    const controller = new AbortController();
    autofillRef.current = controller;
    void loginWithPasskeyAutofill(controller.signal).then(
      (result) => {
        if (result) void goBack(result.user.role);
      },
      () => {
        if (!controller.signal.aborted) setError(t("passkey.failed"));
      }
    );
    return () => controller.abort();
  }, [autofillReady, autofillRound, goBack, t]);

  const attempt = async (signal: AbortSignal, pow?: PowSolution) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, ...(pow ? { pow } : {}) }),
      signal,
    });
    return {
      res,
      data: (await res.json().catch(() => ({}))) as Partial<LoginResponse> & LoginError,
    };
  };

  const validate = (): Partial<Record<LoginField, string>> => {
    const errors: Partial<Record<LoginField, string>> = {};
    if (!EMAIL_PATTERN.test(email.trim())) errors.email = t("forgot.invalidEmail");
    if (!password) errors.password = t("login.passwordRequired");
    return errors;
  };

  const showFailure = (data: LoginError, httpStatus: number) => {
    if (data.code === "LOGIN_DELAYED") {
      const seconds = Math.max(1, Math.ceil(data.details?.retryAfterSeconds ?? 1));
      setRetryIn(seconds);
      setError(t("login.delayed", { seconds }));
      setSuggestReset(true);
    } else if (data.code === "UNAUTHORIZED") {
      setCredentialError(true);
      setSuggestReset(true);
      setError(t("errors.invalidCredentials"));
      setFocusRequest({ field: "password" });
    } else {
      // Gövdesiz/bilinmeyen yanıt: 5xx için "hizmet kullanılamıyor", diğerleri genel metin.
      setError(
        authErrorText(data.code, httpStatus >= 500 ? t("errors.unavailable") : t("login.failed"))
      );
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || waiting || passkeyBusy || leaving) return;
    setError(null);
    setStatus(null);
    setCredentialError(false);
    setSuggestReset(false);
    const errors = validate();
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      setFocusRequest({ field: errors.email ? "email" : "password" });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitting(true);
    try {
      let { res, data } = await attempt(controller.signal);
      // v4#12: çok deneme sonrası sunucu hesabı kilitlemez, iş kanıtı ister —
      // tarayıcı bulmacayı otomatik çözüp bir kez yeniden dener (iptal edilebilir).
      if (data.code === "POW_REQUIRED" && data.details?.pow) {
        setVerifying(true);
        setStatus(t("login.verifyingInfo"));
        try {
          const pow = await solvePowCancellable(data.details.pow, { signal: controller.signal });
          ({ res, data } = await attempt(controller.signal, pow));
        } finally {
          // İptal düğmesi kalkarken odak kaybolmasın.
          if (document.activeElement === cancelRef.current) submitRef.current?.focus();
          setVerifying(false);
          setStatus(null);
        }
      }
      if (res.ok) {
        await goBack(data.user?.role);
        return;
      }
      showFailure(data, res.status);
    } catch (err) {
      // Ham istisna metni (ör. "Failed to fetch") gösterilmez.
      if (isAbortError(err)) setStatus(t("login.verifyCancelled"));
      else setError(err instanceof TypeError ? t("errors.network") : t("login.failed"));
    }
    if (abortRef.current === controller) abortRef.current = null;
    setSubmitting(false);
  };

  const credentialProps = (field: LoginField) =>
    credentialError && !fieldErrors[field]
      ? { "aria-invalid": true, "aria-describedby": "login-error" }
      : {};

  const switchAccount = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
    setSessionUserCache(null);
    invalidateFavoriteIds();
    setFocusRequest({ field: "email" });
    router.refresh();
  };

  if (sessionUser && !leaving) {
    const target = redirect === "/" ? homeForRole(sessionUser.role) : redirect;
    return (
      <AuthCard title={t("login.signedInTitle")} focusTitle>
        <p className="mt-4 text-sm text-gray-700">
          {t("login.signedInAs", {
            name: `${sessionUser.firstName} ${sessionUser.lastName}`,
            email: sessionUser.email,
          })}
        </p>
        <div className="mt-6 space-y-3">
          <ButtonLink href={target} size="lg" fullWidth>
            {t("login.continue")}
          </ButtonLink>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            busy={signingOut}
            onClick={() => void switchAccount()}
          >
            {signingOut ? t("login.signingOut") : t("login.switchAccount")}
          </Button>
        </div>
      </AuthCard>
    );
  }

  const contextNote =
    context === "groupPay"
      ? t("login.groupPayInvite")
      : context === "booking"
        ? t("login.continueBooking")
        : null;
  // Giriş nedeni notu varsa genel alt başlık ("Rezervasyonlarınıza...") gösterilmez.
  const subtitle =
    context === "addToCart"
      ? t("login.addToCartSubtitle")
      : contextNote
        ? undefined
        : t("login.subtitle");

  return (
    <AuthCard
      title={context === "addToCart" ? t("login.addToCartTitle") : t("login.title")}
      subtitle={subtitle}
    >
      {contextNote && (
        <p role="note" className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-[#003580]">
          {contextNote}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        <AuthField id="email" label={t("email")} error={fieldErrors.email}>
          <input
            id="email"
            type="email"
            required
            autoComplete="username webauthn"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setTypedEmail(e.target.value)}
            className={authInputClass}
            {...credentialProps("email")}
          />
        </AuthField>

        <AuthField id="password" label={t("password")} error={fieldErrors.password}>
          <PasswordRevealInput
            id="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
            {...credentialProps("password")}
          />
        </AuthField>

        <p className="text-right text-sm">
          <Link
            href={withRedirect("/forgot-password", redirect)}
            onClick={() => rememberAuthEmail(email)}
            className="inline-flex min-h-[44px] items-center text-[#003580] hover:underline sm:min-h-[24px]"
          >
            {t("login.forgotPassword")}
          </Link>
        </p>

        {error && (
          <Notice kind="error">
            <span id="login-error">{error}</span>
            {suggestReset && (
              <>
                {` ${t("login.forgotPrompt")} `}
                <Link
                  href={withRedirect("/forgot-password", redirect)}
                  onClick={() => rememberAuthEmail(email)}
                  className="font-semibold underline"
                >
                  {t("login.resetLink")}
                </Link>
              </>
            )}
          </Notice>
        )}

        <div>
          <button
            ref={submitRef}
            {...submitButtonProps(submitting || waiting || passkeyBusy)}
            disabled={!hydrated}
            aria-busy={submitting || undefined}
          >
            {verifying
              ? t("login.verifying")
              : submitting
                ? t("login.submitting")
                : waiting
                  ? t("login.retryIn", { seconds: retryIn })
                  : t("login.submit")}
          </button>
          <div role="status" className={status ? "mt-2 text-sm text-gray-700" : undefined}>
            {status}
          </div>
          {verifying && (
            <button
              ref={cancelRef}
              type="button"
              onClick={() => abortRef.current?.abort()}
              className={`mt-2 min-h-[44px] ${cancelButtonClass}`}
            >
              {t("login.cancelVerify")}
            </button>
          )}
        </div>
      </form>

      <PasskeyLoginButton
        onSuccess={goBack}
        disabled={submitting}
        onStart={() => {
          autofillRef.current?.abort();
          // Önceki parola hatası passkey denemesiyle ilgisiz: kutu ve alan işaretleri temizlenir.
          setError(null);
          setCredentialError(false);
        }}
        onBusyChange={(busy) => {
          setPasskeyBusy(busy);
          if (!busy) setAutofillRound((n) => n + 1);
        }}
      />

      <p className="mt-6 text-center text-sm text-gray-600">
        {t("login.noAccount")}{" "}
        <Link
          href={withRedirect("/register", redirect)}
          className="inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]"
        >
          {t("login.registerLink")}
        </Link>
      </p>
    </AuthCard>
  );
}
