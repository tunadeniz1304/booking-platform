"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError } from "@/lib/api-client";
import { passkeySupported, reauthWithPasskey, reauthWithPassword } from "@/lib/auth/passkey-client";
import { useErrorText } from "@/components/ui/ui";

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

/**
 * Hassas işlem için yeniden doğrulama penceresi (v4#2): sunucu 403 `REAUTH_REQUIRED`
 * döndüğünde parola ya da passkey istenir. Doğrulama tamamen sunucudadır; başarılıysa
 * oturum çerezleri tazelenir ve çağıran işlemi tekrarlar.
 *
 * F76/F162: yerel `<dialog>` + `showModal()` — odak pencerede kalır, arka plan etkisizdir
 * (top layer, portal gerekmez), Escape vazgeçer; kapanınca odak pencereyi açan öğeye döner.
 */
export default function ReauthDialog({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("account.reauth");
  const errorText = useAccountErrorText();
  const supported = useSyncExternalStore(noopSubscribe, passkeySupported, () => false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();

  // Yalnız açılışta: tetikleyiciyi sakla, modal aç; kapanışta odağı geri ver.
  useEffect(() => {
    const el = dialog.current;
    const active = document.activeElement;
    const returnTo = active instanceof HTMLElement ? active : null;
    if (el && !el.open) el.showModal();
    input.current?.focus();
    return () => {
      if (el?.open) el.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, []);

  async function attempt(fn: () => Promise<unknown>, viaPassword: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "UNAUTHORIZED"
          ? t(viaPassword ? "wrongPassword" : "failed")
          : errorText(err, t("failed"))
      );
      setBusy(false);
      if (viaPassword) input.current?.focus();
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
      className="w-[calc(100%-2rem)] max-w-sm rounded-xl bg-white p-6 shadow-lg backdrop:bg-black/40"
    >
      <h2 id="reauth-title" className="text-lg font-semibold text-gray-900">
        {t("title")}
      </h2>
      <p id="reauth-desc" className="mt-2 text-sm text-gray-700">
        {t("description")}
      </p>
      <form
        className="mt-4 space-y-3"
        aria-busy={busy || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          if (password) void attempt(() => reauthWithPassword(password), true);
        }}
      >
        <label htmlFor="reauth-password" className="block text-sm font-medium text-gray-800">
          {t("password")}
        </label>
        <input
          ref={input}
          id="reauth-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="w-full rounded-lg border border-gray-500 px-3 py-2 text-sm"
        />
        {error && (
          <p id={errorId} role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {/* busy iken `disabled` yerine aria-disabled: odak pencere içinde kalır. */}
          <button
            type="submit"
            disabled={!password}
            aria-disabled={busy || undefined}
            className="min-h-[44px] flex-1 rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 aria-disabled:opacity-50"
          >
            {busy ? t("verifying") : t("verify")}
          </button>
          {supported && (
            <button
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => void attempt(reauthWithPasskey, false)}
              className="min-h-[44px] rounded-lg border border-[#003580] px-4 py-2 text-sm font-semibold text-[#003580] aria-disabled:opacity-50"
            >
              {t("withPasskey")}
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
export function useReauth() {
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

  const dialog = open ? <ReauthDialog onDone={onDone} onCancel={onCancel} /> : null;

  return { run, dialog };
}
