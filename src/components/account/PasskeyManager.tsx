"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Button, Status } from "@/components/ui/ui";
import { passkeySupported, registerPasskey } from "@/lib/auth/passkey-client";
import { ReauthCancelledError, useAccountErrorText, useReauth } from "./ReauthDialog";

interface Passkey {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

const noopSubscribe = () => () => {};
const fetchPasskeys = () =>
  apiFetch<{ passkeys: Passkey[] }>("/api/account/passkeys").then((r) => r.passkeys);

type StatusKind = "ok" | "error" | "info";

const STATUS_TONE: Record<StatusKind, string> = {
  ok: "text-green-800",
  error: "text-red-700",
  info: "text-gray-700",
};

/** Kullanıcı yeniden doğrulamadan ya da cihazdaki passkey isteminden vazgeçti (hata değil). */
function isCancellation(err: unknown): boolean {
  return (
    err instanceof ReauthCancelledError || (err instanceof Error && err.name === "NotAllowedError")
  );
}

/** Hesap ▸ Passkey'ler: listele, ekle, sil. Riskli ödemelerde step-up için gereklidir. */
export default function PasskeyManager() {
  const t = useTranslations("account");
  const fmt = useFormat();
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  // F720: liste yüklenemezse "Yükleniyor…" yerine hata ve yeniden deneme gösterilir.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const supported = useSyncExternalStore(noopSubscribe, passkeySupported, () => true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: StatusKind; text: string } | null>(null);
  // v4#2: ekleme/silme yakın zamanda yeniden doğrulama ister (403 REAUTH_REQUIRED → pencere).
  // F630: yüklenen liste pencereye verilir; ilk passkey eklenirken passkey yolu gizli kalır.
  const reauth = useReauth({ hasPasskey: passkeys ? passkeys.length > 0 : undefined });
  const { confirm, confirmDialog } = useConfirm();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);

  // F191: WebAuthn hata adları ve API hataları arayüz dilinde gösterilir.
  const errorText = useAccountErrorText();

  const load = useCallback(
    () =>
      fetchPasskeys()
        .then((list) => {
          setPasskeys(list);
          setLoadError(null);
          return true;
        })
        .catch((err: unknown) => {
          setLoadError(errorText(err, t("passkeys.loadFailed")));
          return false;
        }),
    [errorText, t]
  );

  useEffect(() => {
    let cancelled = false;
    fetchPasskeys()
      .then((list) => {
        if (!cancelled) setPasskeys(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorText(err, t("passkeys.loadFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, [errorText, t]);

  useEffect(() => {
    if (!focusHeading.current || passkeys === null) return;
    focusHeading.current = false;
    // Yeniden deneme düğmesi kalktı; odak kaybolduysa bölüm başlığına taşınır.
    if (!document.activeElement || document.activeElement === document.body)
      headingRef.current?.focus();
  }, [passkeys]);

  async function retry() {
    setReloading(true);
    focusHeading.current = true;
    if (!(await load())) focusHeading.current = false;
    setReloading(false);
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await reauth.run(() => registerPasskey(name.trim() || undefined));
      setName("");
      setStatus({ kind: "ok", text: t("passkeys.addedOk") });
      await load();
    } catch (err) {
      // F1084: vazgeçmek hata değildir; nötr bilgi verilir, hiçbir şey değişmedi.
      setStatus(
        isCancellation(err)
          ? { kind: "info", text: t("passkeys.addCancelled") }
          : { kind: "error", text: errorText(err, t("passkeys.addFailed")) }
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Passkey) {
    if (busy) return;
    // F626: onay hangi passkey'in silineceğini ve sonucunu söyler; sonuncusu ayrıca uyarılır
    const isLast = passkeys?.length === 1;
    const ok = await confirm({
      title: t("passkeys.confirmDelete", { name: p.name ?? t("passkeys.unnamed") }),
      body: (
        <>
          <p>{t("passkeys.confirmDeleteBody", { date: fmt.dateTime(p.createdAt) })}</p>
          {isLast && <p className="mt-2 font-medium">{t("passkeys.confirmDeleteLast")}</p>}
        </>
      ),
      confirmLabel: t("passkeys.confirmDeleteAction"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setStatus(null);
    try {
      await reauth.run(() =>
        apiFetch(`/api/account/passkeys?id=${encodeURIComponent(p.id)}`, { method: "DELETE" })
      );
      setStatus({ kind: "ok", text: t("passkeys.deletedOk") });
      await load();
    } catch (err) {
      setStatus(
        isCancellation(err)
          ? { kind: "info", text: t("passkeys.deleteCancelled") }
          : { kind: "error", text: errorText(err, t("passkeys.deleteFailed")) }
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="passkeys-title" className="mt-8 rounded-xl bg-white p-6 shadow-sm">
      <h2
        id="passkeys-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-gray-900 focus:outline-none"
      >
        {t("passkeys.title")}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t("passkeys.description")}</p>
      {status?.kind === "error" && (
        <p role="alert" className={`mt-3 text-sm ${STATUS_TONE.error}`}>
          {status.text}
        </p>
      )}
      {/* Başarı ve nötr bilgi her zaman DOM'da duran role="status" bölgesinde duyurulur. */}
      <div role="status" className="text-sm">
        {status && status.kind !== "error" && (
          <p className={`mt-3 ${STATUS_TONE[status.kind]}`}>{status.text}</p>
        )}
      </div>
      {loadError && (
        <div className="mt-3">
          <Status error={loadError} />
          <Button
            variant="secondary"
            busy={reloading}
            onClick={() => void retry()}
            className="mt-2"
          >
            {t("retry")}
          </Button>
        </div>
      )}
      {passkeys === null ? (
        loadError ? null : (
          <p className="mt-3 text-sm text-gray-500">{t("passkeys.loading")}</p>
        )
      ) : passkeys.length === 0 ? (
        <p className="mt-3 text-sm text-gray-700">{t("passkeys.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium text-gray-900">{p.name ?? t("passkeys.unnamed")}</span>
                <span className="block text-xs text-gray-600">
                  {t("passkeys.added", { date: fmt.dateTime(p.createdAt) })}
                  {p.lastUsedAt && t("passkeys.lastUsed", { date: fmt.dateTime(p.lastUsedAt) })}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void remove(p)}
                aria-disabled={busy || undefined}
                aria-label={t("passkeys.deleteLabel", {
                  name: p.name ?? t("passkeys.unnamed"),
                  date: fmt.dateTime(p.createdAt),
                })}
                className="min-h-[44px] rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 aria-disabled:opacity-50 sm:min-h-0"
              >
                {t("passkeys.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <form onSubmit={add} className="mt-4">
          {/* F436: görünür etiket; ipucu alanın isteğe bağlı olduğunu söyler. */}
          <label htmlFor="passkey-name" className="block text-sm font-medium text-gray-800">
            {t("passkeys.nameLabel")}
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              id="passkey-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("passkeys.namePlaceholder")}
              aria-describedby="passkey-name-hint"
              className="flex-1 rounded-lg border border-gray-500 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              aria-disabled={busy || undefined}
              className="rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white aria-disabled:opacity-50"
            >
              {t("passkeys.add")}
            </button>
          </div>
          <p id="passkey-name-hint" className="mt-1 text-xs text-gray-600">
            {t("passkeys.nameHint", { unnamed: t("passkeys.unnamed") })}
          </p>
        </form>
      ) : (
        <p className="mt-4 text-sm text-gray-600">{t("passkeys.unsupported")}</p>
      )}
      {reauth.dialog}
      {confirmDialog}
    </section>
  );
}
