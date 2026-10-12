"use client";

import { FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import AuthCard, {
  AuthField,
  Notice,
  ResendVerificationButton,
  safeRedirect,
  submitButtonProps,
  useAuthErrorText,
  useSearchParam,
  withRedirect,
} from "@/components/auth/AuthCard";
import NewPasswordField, { newPasswordOk } from "@/components/auth/NewPasswordField";
import PasswordRevealInput from "@/components/auth/PasswordRevealInput";
import { setSessionUserCache, useSessionUserCache } from "@/components/layout/useSessionUserCache";
import { invalidateFavoriteIds } from "@/components/property/useFavoriteIds";
import { Button, ButtonLink, Status, buttonClass, focusRing, inputClass } from "@/components/ui/ui";
import { logout } from "@/lib/api-client";
import { postJsonWithPowCancellable } from "@/lib/auth/pow-fetch-cancellable";
import { isAbortError } from "@/lib/auth/pow-solve-cancellable";

interface RegisterResponse {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    emailVerified?: boolean;
  };
}

interface RegisterError {
  error?: string;
  code?: string;
  details?: { fieldErrors?: Record<string, string[] | undefined> };
}

type FieldName = "firstName" | "lastName" | "email" | "password";
const FIELD_ORDER: FieldName[] = ["firstName", "lastName", "email", "password"];

/** E-posta doğrulandıktan sonra dönülecek adres; verify-email sayfası okuyup siler. */
const POST_VERIFY_REDIRECT_KEY = "postVerifyRedirect";

/** Rezervasyon akışından gelen dönüş adresleri (kayıt nedeni formun üstünde açıklanır). */
const BOOKING_FLOW_PATTERN = /^\/(checkout|cart|pay)(?=[/?#]|$)/;

const cancelButtonClass = buttonClass({ variant: "secondary", fullWidth: true });

const noopSubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

const inlineLinkClass = `font-semibold text-[#003580] underline ${focusRing}`;
const recoveryClass = `inline-flex min-h-[44px] items-center sm:min-h-[24px] ${inlineLinkClass}`;

export default function RegisterPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const authErrorText = useAuthErrorText();
  const redirect = safeRedirect(useSearchParam("redirect"));
  const reason = useSearchParam("reason");
  const bookingContext = reason === "checkout" || BOOKING_FLOW_PATTERN.test(redirect);
  // Hidrasyondan önce gönder düğmesi devre dışı: Enter yerel GET gönderimiyle sayfayı yenilemez.
  const hydrated = useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot);
  // undefined: oturum bilinmiyor (form gösterilir); oturum açıksa form yerine devam seçenekleri.
  const sessionUser = useSessionUserCache();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  /** Zaten kayıtlı çıkan adres: giriş ve şifre sıfırlama bağlantıları bu adresle açılır. */
  const [takenEmail, setTakenEmail] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Sayfadan çıkılınca süren doğrulama arka planda çalışmaya devam etmez.
  useEffect(() => {
    const pending = abortRef;
    return () => pending.current?.abort();
  }, []);

  const fieldMessage = (name: FieldName) => t(`register.errors.${name}`);

  const focusField = (name: FieldName) =>
    formRef.current?.querySelector<HTMLInputElement>(`#${name}`)?.focus();

  /** Alan hatalarını gösterir ve ilk hatalı alana odaklanır. */
  const showFieldErrors = (names: FieldName[]) => {
    const next: Partial<Record<FieldName, string>> = {};
    for (const name of names) next[name] = fieldMessage(name);
    setFieldErrors(next);
    const first = FIELD_ORDER.find((n) => names.includes(n));
    if (first) focusField(first);
  };

  const clearFieldError = (name: FieldName) =>
    setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));

  /** Kayıtlı e-posta için kurtarma bağlantısı: dönüş adresi ve e-posta (ön doldurma) taşınır. */
  const recoveryHref = (base: "/login" | "/forgot-password", address: string) => {
    const href = withRedirect(base, redirect);
    return `${href}${href.includes("?") ? "&" : "?"}email=${encodeURIComponent(address)}`;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setStatus(null);
    // Sunucuyla aynı kurallar (ad/soyad en az 2 karakter, parola 8+ karakter ve bir rakam).
    const clientInvalid: FieldName[] = [];
    if (firstName.trim().length < 2) clientInvalid.push("firstName");
    if (lastName.trim().length < 2) clientInvalid.push("lastName");
    if (!newPasswordOk(password)) clientInvalid.push("password");
    if (clientInvalid.length > 0) {
      showFieldErrors(clientInvalid);
      return;
    }
    setFieldErrors({});
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitting(true);
    try {
      const res = await postJsonWithPowCancellable(
        "/api/auth/register",
        { firstName, lastName, email, password },
        {
          signal: controller.signal,
          onChallenge: () => {
            setVerifying(true);
            setStatus(t("login.verifyingInfo"));
          },
        }
      ).finally(() => {
        // İptal düğmesi kalkarken odak kaybolmasın.
        if (document.activeElement === cancelRef.current) submitRef.current?.focus();
        setVerifying(false);
        setStatus(null);
      });
      const data = (await res.json().catch(() => ({}))) as RegisterResponse & RegisterError;
      if (!res.ok) {
        const serverFields = FIELD_ORDER.filter(
          (n) => (data.details?.fieldErrors?.[n]?.length ?? 0) > 0
        );
        if (data.code === "VALIDATION_ERROR" && serverFields.length > 0) {
          showFieldErrors(serverFields);
          setSubmitting(false);
          return;
        }
        if (data.code === "EMAIL_TAKEN") {
          setFieldErrors({ email: authErrorText("EMAIL_TAKEN", t("register.failed")) });
          setTakenEmail(email.trim());
          focusField("email");
          setSubmitting(false);
          return;
        }
        // Gövdesiz/bilinmeyen yanıt: 5xx için "hizmet kullanılamıyor", diğerleri genel metin.
        setError(
          authErrorText(
            data.code,
            res.status >= 500 ? t("errors.unavailable") : t("register.failed")
          )
        );
        setSubmitting(false);
        return;
      }
      // Oturum açıldı: başlık güncellensin; doğrulama e-postası ayrıca bildirilsin.
      router.refresh();
      if (data.user?.emailVerified === false) {
        // Doğrulama bağlantısı açılınca kaldığı yere dönebilsin (verify-email okur).
        try {
          if (redirect === "/") localStorage.removeItem(POST_VERIFY_REDIRECT_KEY);
          else localStorage.setItem(POST_VERIFY_REDIRECT_KEY, redirect);
        } catch {
          // Depolama kapalıysa yalnız doğrulama sonrası dönüş bağlantısı gösterilmez.
        }
        setRegisteredEmail(data.user.email);
        return;
      }
      router.push(redirect);
    } catch (err) {
      // Ham istisna metni (ör. "Failed to fetch", çözücü hatası) gösterilmez.
      if (isAbortError(err)) setStatus(t("register.verifyCancelled"));
      else setError(err instanceof TypeError ? t("errors.network") : t("register.failed"));
      setSubmitting(false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

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
    router.push(withRedirect("/login", redirect));
  };

  if (registeredEmail) {
    return (
      // F2-36: form ve odaklı gönder düğmesi kalkar; odak başlığa taşınır, duyuru formdan beri
      // DOM'daki AuthCard bölgesinden yapılır (görünür kutu rolsüz).
      <AuthCard
        title={t("register.successTitle")}
        focusTitle
        status={
          <span className="sr-only">{t("register.successBody", { email: registeredEmail })}</span>
        }
      >
        <Notice kind="success" live={false}>
          {t("register.successBody", { email: registeredEmail })}
        </Notice>
        <Link
          href={redirect}
          className="mt-6 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66]"
        >
          {t("register.continue")}
        </Link>
        <p className="mt-6 text-sm text-gray-600">{t("register.notReceived")}</p>
        <ResendVerificationButton className="mt-2" />
      </AuthCard>
    );
  }

  // Gönderim sürerken (başarılı kayıtta yönlendirme dahil) oturum görünümüne geçilmez.
  if (sessionUser && !submitting) {
    return (
      <AuthCard title={t("login.signedInTitle")} focusTitle>
        <p className="mt-4 text-sm text-gray-700">
          {t("login.signedInAs", {
            name: `${sessionUser.firstName} ${sessionUser.lastName}`,
            email: sessionUser.email,
          })}
        </p>
        <div className="mt-6 space-y-3">
          <ButtonLink href={redirect} size="lg" fullWidth>
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

  return (
    <AuthCard title={t("register.title")} subtitle={t("register.subtitle")}>
      {bookingContext && (
        <p role="note" className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-[#003580]">
          {t("register.continueBooking")}
        </p>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <AuthField
            id="firstName"
            label={t("register.firstName")}
            hint={t("register.nameHint")}
            error={fieldErrors.firstName}
          >
            <input
              id="firstName"
              type="text"
              required
              minLength={2}
              autoComplete="given-name"
              autoCapitalize="words"
              spellCheck={false}
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                clearFieldError("firstName");
              }}
              className={inputClass}
            />
          </AuthField>
          <AuthField
            id="lastName"
            label={t("register.lastName")}
            hint={t("register.nameHint")}
            error={fieldErrors.lastName}
          >
            <input
              id="lastName"
              type="text"
              required
              minLength={2}
              autoComplete="family-name"
              autoCapitalize="words"
              spellCheck={false}
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                clearFieldError("lastName");
              }}
              className={inputClass}
            />
          </AuthField>
        </div>

        <div>
          <AuthField id="email" label={t("email")} error={fieldErrors.email}>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setTakenEmail(null);
                clearFieldError("email");
              }}
              className={inputClass}
            />
          </AuthField>
          {takenEmail && (
            <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
              <Link href={recoveryHref("/login", takenEmail)} className={recoveryClass}>
                {t("register.loginInstead")}
              </Link>
              <Link href={recoveryHref("/forgot-password", takenEmail)} className={recoveryClass}>
                {t("login.forgotPassword")}
              </Link>
            </p>
          )}
        </div>

        <NewPasswordField
          id="password"
          label={t("password")}
          value={password}
          error={fieldErrors.password}
        >
          <PasswordRevealInput
            id="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearFieldError("password");
            }}
            onBlur={() => {
              // Hata yazarken değil, alandan çıkınca gösterilir.
              if (password.length > 0 && !newPasswordOk(password)) {
                setFieldErrors((prev) => ({ ...prev, password: fieldMessage("password") }));
              }
            }}
            className={inputClass}
          />
        </NewPasswordField>

        {/* F2-44: ortak Status (simge + gizli "Hata:" öneki). */}
        {error && <Status error={error} />}

        <p className="text-xs text-gray-600">
          {t.rich("register.privacy", {
            link: (chunks) => (
              <Link
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className={inlineLinkClass}
              >
                {chunks}
                <span className="sr-only"> {t("register.newTab")}</span>
              </Link>
            ),
          })}
        </p>

        <div>
          <button ref={submitRef} {...submitButtonProps(submitting)} disabled={!hydrated}>
            {verifying
              ? t("login.verifying")
              : submitting
                ? t("register.submitting")
                : t("register.submit")}
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

      <p className="mt-6 text-center text-sm text-gray-600">
        {t("register.haveAccount")}{" "}
        <Link
          href={withRedirect("/login", redirect)}
          className="inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]"
        >
          {t("register.loginLink")}
        </Link>
      </p>
    </AuthCard>
  );
}
