"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiFetch, fetchCurrentUser } from "@/lib/api-client";
import { passkeySupported, reauthWithPasskey, reauthWithPassword } from "@/lib/auth/passkey-client";
import { focusRing, useErrorText } from "@/components/ui/ui";

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

type ReauthErrorState = { text: string; offerReset: boolean };

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
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<ReauthMode | null>(null);
  const [error, setError] = useState<ReauthErrorState | null>(null);
  const [fetchedHasPasskey, setFetchedHasPasskey] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
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
    input.current?.focus();
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
        input.current?.focus();
        input.current?.select();
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
          if (password) void attempt(() => reauthWithPassword(password), "password");
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
        <label htmlFor="reauth-password" className="block text-sm font-medium text-gray-800">
          {t("password")}
        </label>
        <input
          ref={input}
          id="reauth-password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="w-full rounded-lg border border-gray-500 px-3 py-2 text-base sm:text-sm"
        />
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
            className="h-4 w-4"
          />
          {t("showPassword")}
        </label>
        {error && (
          <div className="space-y-1">
            <p id={errorId} role="alert" className="text-sm text-red-700">
              {error.text}
            </p>
            {error.offerReset && (
              <p className="text-sm">
                <Link
                  href="/forgot-password"
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
          {/* busy iken `disabled` yerine aria-disabled: odak pencere içinde kalır. */}
          <button
            type="submit"
            disabled={!password}
            aria-disabled={busy || undefined}
            className="min-h-[44px] flex-1 rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 aria-disabled:opacity-50"
          >
            {mode === "password" ? t("verifying") : t("verify")}
          </button>
          {passkeyAvailable && (
            <button
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => void attempt(reauthWithPasskey, "passkey")}
              className="min-h-[44px] rounded-lg border border-[#003580] px-4 py-2 text-sm font-semibold text-[#003580] aria-disabled:opacity-50"
            >
              {mode === "passkey" ? t("passkeyPrompt") : t("withPasskey")}
            </button>
          )}
          <button
            type="button"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onCancel();
            }}
            className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 aria-disabled:opacity-50"
          >
            {t("cancel")}
          </button>
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
