"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { passkeyErrorMessage, passkeySupported, registerPasskey } from "@/lib/auth/passkey-client";
import { ReauthCancelledError, useReauth } from "./ReauthDialog";

interface Passkey {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

const noopSubscribe = () => () => {};
const fetchPasskeys = () =>
  apiFetch<{ passkeys: Passkey[] }>("/api/account/passkeys").then((r) => r.passkeys);

/** Hesap ▸ Passkey'ler: listele, ekle, sil. Riskli ödemelerde step-up için gereklidir. */
export default function PasskeyManager() {
  const t = useTranslations("account");
  const fmt = useFormat();
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const supported = useSyncExternalStore(noopSubscribe, passkeySupported, () => true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // v4#2: ekleme/silme yakın zamanda yeniden doğrulama ister (403 REAUTH_REQUIRED → pencere).
  const reauth = useReauth();

  // WebAuthn hata adları çeviri anahtarına eşlenir; API hataları olduğu gibi gösterilir.
  const errorText = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof Error && err.name === "NotAllowedError") return t("passkeys.cancelled");
      if (err instanceof Error && err.name === "InvalidStateError")
        return t("passkeys.alreadyRegistered");
      if (err instanceof ReauthCancelledError) return t("reauth.cancelled");
      return passkeyErrorMessage(err, fallback);
    },
    [t]
  );

  const load = useCallback(
    () =>
      fetchPasskeys()
        .then(setPasskeys)
        .catch((err: unknown) =>
          setStatus({ kind: "error", text: errorText(err, t("passkeys.loadFailed")) })
        ),
    [errorText, t]
  );

  useEffect(() => {
    let cancelled = false;
    fetchPasskeys()
      .then((list) => {
        if (!cancelled) setPasskeys(list);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setStatus({ kind: "error", text: errorText(err, t("passkeys.loadFailed")) });
      });
    return () => {
      cancelled = true;
    };
  }, [errorText, t]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await reauth.run(() => registerPasskey(name.trim() || undefined));
      setName("");
      setStatus({ kind: "ok", text: t("passkeys.addedOk") });
      await load();
    } catch (err) {
      setStatus({ kind: "error", text: errorText(err, t("passkeys.addFailed")) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("passkeys.confirmDelete"))) return;
    setBusy(true);
    setStatus(null);
    try {
      await reauth.run(() =>
        apiFetch(`/api/account/passkeys?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      );
      setStatus({ kind: "ok", text: t("passkeys.deletedOk") });
      await load();
    } catch (err) {
      setStatus({ kind: "error", text: errorText(err, t("passkeys.deleteFailed")) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="passkeys-title" className="mt-8 rounded-xl bg-white p-6 shadow-sm">
      <h2 id="passkeys-title" className="text-xl font-semibold text-gray-900">
        {t("passkeys.title")}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t("passkeys.description")}</p>
      {status && (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={`mt-3 text-sm ${status.kind === "error" ? "text-red-700" : "text-green-800"}`}
        >
          {status.text}
        </p>
      )}
      {passkeys === null ? (
        <p className="mt-3 text-sm text-gray-500">{t("passkeys.loading")}</p>
      ) : passkeys.length === 0 ? (
        <p className="mt-3 text-sm text-gray-700">{t("passkeys.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium text-gray-900">{p.name ?? t("passkeys.unnamed")}</span>
                <span className="block text-xs text-gray-600">
                  {t("passkeys.added", { date: fmt.date(p.createdAt) })}
                  {p.lastUsedAt && t("passkeys.lastUsed", { date: fmt.date(p.lastUsedAt) })}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void remove(p.id)}
                disabled={busy}
                className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
              >
                {t("passkeys.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <form onSubmit={add} className="mt-4 flex flex-wrap gap-2">
          <label htmlFor="passkey-name" className="sr-only">
            {t("passkeys.nameLabel")}
          </label>
          <input
            id="passkey-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("passkeys.namePlaceholder")}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t("passkeys.add")}
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-gray-600">{t("passkeys.unsupported")}</p>
      )}
      {reauth.dialog}
    </section>
  );
}
