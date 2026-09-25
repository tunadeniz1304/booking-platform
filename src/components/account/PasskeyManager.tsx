"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { apiFetch } from "@/lib/api-client";
import { passkeyErrorMessage, passkeySupported, registerPasskey } from "@/lib/auth/passkey-client";

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
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const supported = useSyncExternalStore(noopSubscribe, passkeySupported, () => true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(
    () =>
      fetchPasskeys()
        .then(setPasskeys)
        .catch((err: unknown) =>
          setStatus({ kind: "error", text: passkeyErrorMessage(err, "Passkey'ler yüklenemedi") })
        ),
    []
  );

  useEffect(() => {
    let cancelled = false;
    fetchPasskeys()
      .then((list) => {
        if (!cancelled) setPasskeys(list);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setStatus({ kind: "error", text: passkeyErrorMessage(err, "Passkey'ler yüklenemedi") });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await registerPasskey(name.trim() || undefined);
      setName("");
      setStatus({ kind: "ok", text: "Passkey eklendi." });
      await load();
    } catch (err) {
      setStatus({ kind: "error", text: passkeyErrorMessage(err, "Passkey eklenemedi") });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Bu passkey silinsin mi?")) return;
    setBusy(true);
    setStatus(null);
    try {
      await apiFetch(`/api/account/passkeys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setStatus({ kind: "ok", text: "Passkey silindi." });
      await load();
    } catch (err) {
      setStatus({ kind: "error", text: passkeyErrorMessage(err, "Passkey silinemedi") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="passkeys-title" className="mt-8 rounded-xl bg-white p-6 shadow-sm">
      <h2 id="passkeys-title" className="text-xl font-semibold text-gray-900">
        Passkey&apos;ler
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        Parolasız giriş ve riskli görünen ödemelerde ek doğrulama için kullanılır.
      </p>
      {status && (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={`mt-3 text-sm ${status.kind === "error" ? "text-red-700" : "text-green-800"}`}
        >
          {status.text}
        </p>
      )}
      {passkeys === null ? (
        <p className="mt-3 text-sm text-gray-500">Yükleniyor...</p>
      ) : passkeys.length === 0 ? (
        <p className="mt-3 text-sm text-gray-700">Kayıtlı passkey yok.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium text-gray-900">{p.name ?? "Adsız passkey"}</span>
                <span className="block text-xs text-gray-600">
                  Eklendi {new Date(p.createdAt).toLocaleDateString("tr-TR")}
                  {p.lastUsedAt &&
                    ` · son kullanım ${new Date(p.lastUsedAt).toLocaleDateString("tr-TR")}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void remove(p.id)}
                disabled={busy}
                className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
              >
                Sil
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <form onSubmit={add} className="mt-4 flex flex-wrap gap-2">
          <label htmlFor="passkey-name" className="sr-only">
            Passkey adı
          </label>
          <input
            id="passkey-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ad (ör. Dizüstü)"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Passkey ekle
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-gray-600">Bu tarayıcı passkey desteklemiyor.</p>
      )}
    </section>
  );
}
