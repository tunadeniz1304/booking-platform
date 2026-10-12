"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiFetch, fetchCurrentUser } from "@/lib/api-client";
import { passkeySupported, reauthWithPasskey, reauthWithPassword } from "@/lib/auth/passkey-client";
import { Button, ErrorText, focusRing, inputClass, useErrorText } from "@/components/ui/ui";
import { withRedirect } from "@/components/auth/AuthCard";
import PasswordRevealInput from "@/components/auth/PasswordRevealInput";
import { rememberAuthEmail } from "@/lib/auth/auth-email-handoff";

/** Kullanıcı yeniden doğrulama penceresini kapattı. */
export class ReauthCancelledError extends Error {
  constructor() {
    super("REAUTH_CANCELLED");
    this.name = "ReauthCancelledError";
  }
}

const noopSubscribe = () => () => {};

/** Hesap ekranlarında sunucu metni yerine arayüz dilinde gösterilen hata kodları. */
const ACCOUNT_ERROR_CODES: ReadonlySet<string> = new Set([
  "RATE_LIMITED",
  "REAUTH_RATE_LIMITED",
  "KYC_RATE_LIMITED",
]);

/**
 * Hesap bileşenleri için hata metni (F187/F191): yeniden doğrulama iptali, WebAuthn hataları ve
 * bilinen kodlar `account.*` çevirileriyle; genel kodlar ve ağ hataları `useErrorText` ile
 * gösterilir. Alana özgü sunucu iletileri yalnız Türkçe olduğundan başka dillerde çağıranın
 * verdiği (çevrilmiş) `fallback` metni kullanılır; ham "Failed to fetch" hiç gösterilmez.
 */
export function useAccountErrorText(): (err: unknown, fallback?: string) => string {
  const t = useTranslations("account");
  const locale = useLocale();
  const generic = useErrorText();
  return useCallback(
    (err: unknown, fallback?: string): string => {
      if (err instanceof ReauthCancelledError) return t("reauth.cancelled");
      if (err instanceof Error && err.name === "NotAllowedError") return t("passkeys.cancelled");
      if (err instanceof Error && err.name === "InvalidStateError")
        return t("passkeys.alreadyRegistered");
      if (err instanceof ApiError && err.code && ACCOUNT_ERROR_CODES.has(err.code))
        return t(`errors.codes.${err.code}`);
      const text = generic(err);
      if (err instanceof Error && text === err.message) {
        // İstemci içi (API dışı) hata metinleri kullanıcıya gösterilmez.
        if (!(err instanceof ApiError) || locale !== "tr") return fallback ?? t("errors.generic");
      }
      return text;
    },
    [generic, locale, t]
  );
}

type ReauthMode = "password" | "passkey";

/** `empty`: parola boş gönderildi (yazmaya başlayınca kalkar). */
type ReauthErrorState = { text: string; offerReset: boolean; empty?: boolean };

const PASSWORD_ID = "reauth-password";
/** PasswordRevealInput ref almaz; alan kimlikle bulunur. */
const passwordInput = () => document.getElementById(PASSWORD_ID) as HTMLInputElement | null;

/** Sunucunun `details.retryAfterSeconds` değeri dakikaya (yukarı) yuvarlanır; yoksa null. */
function retryAfterMinutes(err: ApiError): number | null {
  const details = err.details;
  const seconds =
    typeof details === "object" && details !== null && "retryAfterSeconds" in details
      ? details.retryAfterSeconds
      : undefined;
  return typeof seconds === "number" && seconds > 0 ? Math.ceil(seconds / 60) : null;
}

/**
 * Hassas işlem için yeniden doğrulama penceresi (v4#2): sunucu 403 `REAUTH_REQUIRED`
 * döndüğünde parola ya da passkey istenir. Doğrulama tamamen sunucudadır; başarılıysa
 * oturum çerezleri tazelenir ve çağıran işlemi tekrarlar.
 *
 * F76/F162: yerel `<dialog>` + `showModal()` — odak pencerede kalır, arka plan etkisizdir
 * (top layer, portal gerekmez), Escape vazgeçer; kapanınca odak pencereyi açan öğeye döner.
 * F630: passkey yolu yalnız hesapta kayıtlı passkey varsa gösterilir (`hasPasskey` verilmezse
 * pencere `/api/account/passkeys` ile öğrenir).
 */
export default function ReauthDialog({
  onDone,
  onCancel,
  hasPasskey,
}: {
  onDone: () => void;
  onCancel: () => void;
  /** Hesapta kayıtlı passkey var mı; verilmezse pencere açılışta sorgular. */
  hasPasskey?: boolean;
}) {
  const t = useTranslations("account.reauth");
  const tAuth = useTranslations("auth");
  const errorText = useAccountErrorText();
  const supported = useSyncExternalStore(noopSubscribe, passkeySupported, () => false);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<ReauthMode | null>(null);
  const [error, setError] = useState<ReauthErrorState | null>(null);
  const [fetchedHasPasskey, setFetchedHasPasskey] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const errorId = useId();
  // F2-35: "Şifremi unuttum" bu sayfaya dönüş adresini ve hesabın e-postasını taşır.
  const pathname = usePathname();
  const forgotHref = withRedirect("/forgot-password", pathname || "/");
  const busy = mode !== null;
  const passkeyAvailable = supported && (hasPasskey ?? fetchedHasPasskey) === true;
  const needPasskeyInfo = supported && hasPasskey === undefined;

  // Yalnız açılışta: tetikleyiciyi sakla, modal aç, arka plan kaydırmasını kilitle (F629);
  // kapanışta odağı geri ver.
  useEffect(() => {
    const el = dialog.current;
    const active = document.activeElement;
    const returnTo = active instanceof HTMLElement ? active : null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    if (el && !el.open) el.showModal();
    passwordInput()?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (el?.open) el.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, []);

  // F1185: gizli e-posta alanı parola yöneticisine hangi hesabın parolası olduğunu bildirir.
  useEffect(() => {
    let active = true;
    void fetchCurrentUser().then((user) => {
      if (active && user) setEmail(user.email);
    });
    return () => {
      active = false;
    };
  }, []);

  // F630: passkey listesi alınamazsa seçenek eskisi gibi gösterilir.
  useEffect(() => {
    if (!needPasskeyInfo) return;
    let active = true;
    void apiFetch<{ passkeys?: unknown[] }>("/api/account/passkeys").then(
      (res) => {
        if (active) setFetchedHasPasskey(Array.isArray(res.passkeys) && res.passkeys.length > 0);
      },
      () => {
        if (active) setFetchedHasPasskey(true);
      }
    );
    return () => {
      active = false;
    };
  }, [needPasskeyInfo]);

  function describeError(err: unknown, via: ReauthMode): ReauthErrorState {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
      return via === "password"
        ? { text: t("wrongPassword"), offerReset: true }
        : { text: t("failed"), offerReset: false };
    }
    // F628: kilitlenen kullanıcı bekleme süresini görür; parolasını unuttuysa sıfırlayabilir.
    if (err instanceof ApiError && err.code === "REAUTH_RATE_LIMITED") {
      const minutes = retryAfterMinutes(err);
      return {
        text: minutes ? t("rateLimitedFor", { minutes }) : t("rateLimited"),
        offerReset: true,
      };
    }
    return { text: errorText(err, t("failed")), offerReset: false };
  }

  async function attempt(fn: () => Promise<unknown>, via: ReauthMode) {
    if (busy) return;
    setMode(via);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(describeError(err, via));
      setMode(null);
      if (via === "password") {
        passwordInput()?.focus();
        passwordInput()?.select();
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="reauth-title"
      aria-describedby="reauth-desc"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto overscroll-contain rounded-xl bg-white p-6 shadow-lg backdrop:bg-black/40"
    >
      <h2 id="reauth-title" className="text-lg font-semibold text-gray-900">
        {t("title")}
      </h2>
      <p id="reauth-desc" className="mt-2 text-sm text-gray-700">
        {passkeyAvailable ? t("description") : t("descriptionPasswordOnly")}
      </p>
      <form
        className="mt-4 space-y-3"
        aria-busy={busy || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          // F2-37: boş gönderim sessiz kalmaz; hata alana bağlanır ve odak alana döner.
          if (!password) {
            setError({ text: tAuth("login.passwordRequired"), offerReset: false, empty: true });
            passwordInput()?.focus();
            return;
          }
          void attempt(() => reauthWithPassword(password), "password");
        }}
      >
        {email && (
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
        )}
        <label htmlFor={PASSWORD_ID} className="block text-sm font-medium text-gray-800">
          {t("password")}
        </label>
        {/* F2-37: giriş/kayıt/sıfırlama ile aynı göster/gizle düğmeli alan. */}
        <PasswordRevealInput
          id={PASSWORD_ID}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error?.empty) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={inputClass}
        />
        {error && (
          <div className="space-y-1">
            <ErrorText id={errorId}>{error.text}</ErrorText>
            {error.offerReset && (
              <p className="text-sm">
                <Link
                  href={forgotHref}
                  onClick={() => {
                    if (email) rememberAuthEmail(email);
                  }}
                  className={`inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-[24px] ${focusRing}`}
                >
                  {tAuth("login.forgotPassword")}
                </Link>
              </p>
            )}
          </div>
        )}
        {/* F1186: hangi yolun beklediği ekran okuyucuya da bildirilir. */}
        <p role="status" className="sr-only">
          {mode === "passkey" ? t("passkeyPrompt") : mode === "password" ? t("verifying") : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {/* F2-37/F2-11: `disabled` yok; busy iken aria-disabled, odak pencere içinde kalır. */}
          <Button
            type="submit"
            busy={mode === "password"}
            aria-disabled={busy || undefined}
            className="min-h-[44px] flex-1"
          >
            {mode === "password" ? t("verifying") : t("verify")}
          </Button>
          {passkeyAvailable && (
            <Button
              variant="secondary"
              busy={mode === "passkey"}
              aria-disabled={busy || undefined}
              onClick={() => void attempt(reauthWithPasskey, "passkey")}
              className="min-h-[44px]"
            >
              {mode === "passkey" ? t("passkeyPrompt") : t("withPasskey")}
            </Button>
          )}
          <Button
            variant="secondary"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onCancel();
            }}
            className="min-h-[44px]"
          >
            {t("cancel")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Hassas işlemi 403 `REAUTH_REQUIRED` gelirse yeniden doğrulama sonrası BİR kez tekrarlar.
 * Kullanım: `const reauth = useReauth(); await reauth.run(() => apiFetch(...)); {reauth.dialog}`
 */
export function useReauth(options?: { hasPasskey?: boolean }) {
  const hasPasskey = options?.hasPasskey;
  const [open, setOpen] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (err: Error) => void } | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "REAUTH_REQUIRED")) throw err;
      await new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setOpen(true);
      });
      return fn();
    }
  }, []);

  // F162: sabit geri çağrılar — üst bileşen yeniden render edilince pencere etkisi tekrar çalışmaz.
  const onDone = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    setOpen(false);
    p?.resolve();
  }, []);
  const onCancel = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    setOpen(false);
    p?.reject(new ReauthCancelledError());
  }, []);

  const dialog = open ? (
    <ReauthDialog onDone={onDone} onCancel={onCancel} hasPasskey={hasPasskey} />
  ) : null;

  return { run, dialog };
}
