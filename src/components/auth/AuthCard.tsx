"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button, Status } from "@/components/ui/ui";
import { ApiError, apiFetch } from "@/lib/api-client";

/**
 * Kimlik sayfaları (giriş, kayıt, sıfırlama, doğrulama) için ortak kart düzeni.
 * `status`: ilk render'dan beri DOM'da duran `role="status"` bölgesinin içeriği (yükleniyor ve
 * başarı metinleri; içerikle birlikte eklenen bölgeler güvenilir duyurulmaz). Görünür başarı
 * kutusu için `<Notice kind="success" live={false}>`, yalnız duyuru için `sr-only` metin verin;
 * hatalar (`role="alert"`) bu bölgenin dışında kalmalı (iç içe canlı bölge yok).
 * `focusTitle`: true olduğunda (ör. işlem tamamlandı görünümü) odak başlığa taşınır.
 */
export default function AuthCard({
  title,
  subtitle,
  children,
  status,
  focusTitle = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  status?: ReactNode;
  focusTitle?: boolean;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) titleRef.current?.focus();
  }, [focusTitle, title]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main
        id="main"
        className="mx-auto flex w-full max-w-md flex-1 items-center justify-center px-4 py-16"
      >
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1
            ref={titleRef}
            tabIndex={focusTitle ? -1 : undefined}
            className="text-2xl font-bold text-gray-900 focus:outline-none"
          >
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
          {children}
          <div role="status" aria-live="polite" aria-atomic="true">
            {status}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/**
 * Sonuç / hata mesajı kutusu (ekran okuyucu için canlı bölge). `live={false}`: rolsüz, yalnız
 * görsel kutu; duyuruyu kalıcı bir bölge (ör. `AuthCard` `status`) yapıyorsa kullanın.
 */
export function Notice({
  kind,
  children,
  live = true,
}: {
  kind: "error" | "success";
  children: ReactNode;
  live?: boolean;
}) {
  return (
    <div
      role={live ? (kind === "error" ? "alert" : "status") : undefined}
      className={`mt-4 rounded-lg px-4 py-3 text-sm ${
        kind === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"
      }`}
    >
      {children}
    </div>
  );
}

/** Kimlik formlarındaki alanların ortak (değişmeyen) görünümü. */
export const authInputClass =
  "mt-1 w-full rounded-lg border border-gray-500 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]";

/** Birincil gönder düğmesi; `aria-disabled` iken odak düğmede kalır (bkz. `submitButtonProps`). */
export const authSubmitClass =
  "w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700 aria-disabled:cursor-not-allowed aria-disabled:bg-gray-300 aria-disabled:text-gray-700";

/**
 * Gönderim sürerken `disabled` yerine `aria-disabled` + `aria-busy`: `disabled` klavye
 * odağını <body>'ye düşürür. Çift gönderimi çağıran `if (busy) return` ile engeller.
 */
export function submitButtonProps(busy: boolean) {
  return {
    type: "submit" as const,
    "aria-disabled": busy || undefined,
    "aria-busy": busy || undefined,
    className: authSubmitClass,
  };
}

/**
 * Etiketli alan: `hint` ve `error` tek alt öğeye `aria-describedby` ile bağlanır,
 * hata varken `aria-invalid` (WCAG 1.3.1 / 3.3.1). ui.tsx `Field` ile aynı desen,
 * kimlik sayfalarının mevcut görünümüyle.
 */
export function AuthField({
  label,
  id,
  hint,
  error,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control =
    isValidElement(children) && describedBy
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
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-gray-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Yalnız aynı kökene giden göreli yollar kabul edilir (açık yönlendirme yok):
 * '/' ile başlamalı, '//' ya da '/\' ile başlamamalı; aksi halde '/'.
 */
export function safeRedirect(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (typeof window !== "undefined") {
    try {
      if (new URL(raw, window.location.origin).origin !== window.location.origin) return "/";
    } catch {
      return "/";
    }
  }
  return raw;
}

const noopSubscribe = () => () => {};
const readSearch = () => window.location.search;
const serverSearch = () => null;

/**
 * Sorgu parametresi; SSR ve hidrasyon sırasında `undefined` (henüz bilinmiyor),
 * sonra değer ya da null. Suspense gerektirmeden hidrasyon uyumlu.
 */
export function useSearchParam(name: string): string | null | undefined {
  const search = useSyncExternalStore<string | null>(noopSubscribe, readSearch, serverSearch);
  return search === null ? undefined : new URLSearchParams(search).get(name);
}

/** Güvenli dönüş adresini taşıyan kimlik sayfası bağlantısı. */
export function withRedirect(base: string, redirect: string): string {
  return redirect === "/" ? base : `${base}?redirect=${encodeURIComponent(redirect)}`;
}

type AuthErrorKey =
  | "invalidCredentials"
  | "emailTaken"
  | "rateLimited"
  | "validation"
  | "unavailable"
  | "emailNotVerified"
  | "network";

const CODE_TO_KEY: Record<string, AuthErrorKey> = {
  EMAIL_TAKEN: "emailTaken",
  RATE_LIMITED: "rateLimited",
  POW_REQUIRED: "rateLimited",
  VALIDATION_ERROR: "validation",
  SERVICE_UNAVAILABLE: "unavailable",
  EMAIL_NOT_VERIFIED: "emailNotVerified",
};

/**
 * Sunucu hata kodunu arayüz dilindeki metne çevirir (sunucu metinleri sabit Türkçe).
 * Bilinmeyen kodlarda sayfanın kendi `fallback` metni gösterilir.
 */
export function useAuthErrorText() {
  const t = useTranslations("auth");
  return (code: string | null | undefined, fallback: string): string => {
    if (code === "UNAUTHORIZED") return t("errors.invalidCredentials");
    if (code === "NETWORK") return t("errors.network");
    const key = code ? CODE_TO_KEY[code] : undefined;
    return key ? t(`errors.${key}`) : fallback;
  };
}

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * "Doğrulama e-postasını yeniden gönder" (oturum gerekir). Gönderimden sonra 60 sn bekleme;
 * sonuç `Status` canlı bölgesinde duyurulur.
 */
export function ResendVerificationButton({ className = "" }: { className?: string }) {
  const t = useTranslations("auth");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch<{ sent?: boolean; alreadyVerified?: boolean }>(
        "/api/auth/verify-email/resend",
        { method: "POST", body: "{}" }
      );
      if (res.alreadyVerified) {
        setMessage(t("verify.alreadyVerified"));
      } else {
        setMessage(t("verify.resent"));
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t("verify.loginToResend"));
      else if (err instanceof ApiError && err.code === "RATE_LIMITED")
        setError(t("errors.rateLimited"));
      else if (err instanceof TypeError) setError(t("errors.network"));
      else setError(t("verify.resendFailed"));
    } finally {
      setBusy(false);
    }
  }

  const waiting = cooldown > 0;
  return (
    <div className={`space-y-2 ${className}`}>
      <Button
        variant="secondary"
        busy={busy}
        aria-disabled={waiting || undefined}
        onClick={() => void resend()}
        className="min-h-[44px] w-full"
      >
        {busy ? t("verify.resending") : t("verify.resend")}
      </Button>
      {waiting && (
        <p className="text-xs text-gray-600">{t("verify.resendWait", { seconds: cooldown })}</p>
      )}
      <Status error={error} message={message} />
    </div>
  );
}
