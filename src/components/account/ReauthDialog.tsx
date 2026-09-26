"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api-client";
import {
  passkeyErrorMessage,
  passkeySupported,
  reauthWithPasskey,
  reauthWithPassword,
} from "@/lib/auth/passkey-client";

/** Kullanıcı yeniden doğrulama penceresini kapattı. */
export class ReauthCancelledError extends Error {
  constructor() {
    super("Yeniden doğrulama iptal edildi");
    this.name = "ReauthCancelledError";
  }
}

const noopSubscribe = () => () => {};

/**
 * Hassas işlem için yeniden doğrulama penceresi (v4#2): sunucu 403 `REAUTH_REQUIRED`
 * döndüğünde parola ya da passkey istenir. Doğrulama tamamen sunucudadır; başarılıysa
 * oturum çerezleri tazelenir ve çağıran işlemi tekrarlar.
 */
export default function ReauthDialog({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("account.reauth");
  const supported = useSyncExternalStore(noopSubscribe, passkeySupported, () => false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function attempt(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "REAUTH_RATE_LIMITED"
          ? t("rateLimited")
          : passkeyErrorMessage(err, t("failed"))
      );
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        aria-describedby="reauth-desc"
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg"
      >
        <h2 id="reauth-title" className="text-lg font-semibold text-gray-900">
          {t("title")}
        </h2>
        <p id="reauth-desc" className="mt-2 text-sm text-gray-700">
          {t("description")}
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(() => reauthWithPassword(password));
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
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy || !password}
              className="flex-1 rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? t("verifying") : t("verify")}
            </button>
            {supported && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void attempt(reauthWithPasskey)}
                className="rounded-lg border border-[#003580] px-4 py-2 text-sm font-semibold text-[#003580] disabled:opacity-50"
              >
                {t("withPasskey")}
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Hassas işlemi 403 `REAUTH_REQUIRED` gelirse yeniden doğrulama sonrası BİR kez tekrarlar.
 * Kullanım: `const reauth = useReauth(); await reauth.run(() => apiFetch(...)); {reauth.dialog}`
 */
export function useReauth() {
  const [pending, setPending] = useState<{
    resolve: () => void;
    reject: (err: Error) => void;
  } | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "REAUTH_REQUIRED")) throw err;
      await new Promise<void>((resolve, reject) => setPending({ resolve, reject }));
      return fn();
    }
  }, []);

  const dialog = pending ? (
    <ReauthDialog
      onDone={() => {
        pending.resolve();
        setPending(null);
      }}
      onCancel={() => {
        pending.reject(new ReauthCancelledError());
        setPending(null);
      }}
    />
  ) : null;

  return { run, dialog };
}
