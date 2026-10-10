"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch, logout } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useAccountErrorText, useReauth } from "./ReauthDialog";

interface SessionView {
  id: string;
  current: boolean;
  device: string | null;
  ipHint: string | null;
  createdAt: string;
  lastSeenAt: string;
}

const fetchSessions = () =>
  apiFetch<{ sessions: SessionView[] }>("/api/account/sessions").then((r) => r.sessions);

/**
 * Hesap ▸ Oturumlar (P0-4): etkin oturumları listeler, tek oturumu veya mevcut dışındaki
 * tümünü uzaktan kapatır. Kapatma yakın zamanda yeniden doğrulama ister (REAUTH_REQUIRED).
 */
export default function SessionManager() {
  const t = useTranslations("account.sessions");
  const fmt = useFormat();
  const router = useRouter();
  const reauth = useReauth();
  const { confirm, confirmDialog } = useConfirm();
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // F191: sunucu/tarayıcı metni yerine arayüz dilinde hata.
  const errorText = useAccountErrorText();

  const load = useCallback(
    () =>
      fetchSessions()
        .then(setSessions)
        .catch((err: unknown) =>
          setStatus({ kind: "error", text: errorText(err, t("loadFailed")) })
        ),
    [errorText, t]
  );

  useEffect(() => {
    let cancelled = false;
    fetchSessions()
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if ((err as { status?: number }).status === 401) router.push("/login");
        else setStatus({ kind: "error", text: errorText(err, t("loadFailed")) });
      });
    return () => {
      cancelled = true;
    };
  }, [errorText, router, t]);

  async function revoke(query: string | null, confirmText: string) {
    if (busy) return;
    const ok = await confirm({
      title: confirmText,
      confirmLabel: query === null ? t("confirmLogoutLabel") : t("confirmRevokeLabel"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setStatus(null);
    try {
      if (query === null) {
        // F192: bu cihaz için yeniden doğrulama gerekmez; çıkış mevcut oturumu sunucuda kapatır.
        // (Yeniden doğrulama oturumu yenilediği için eski kimlikle DELETE 404 dönüyordu.)
        await logout();
        router.push("/login");
        return;
      }
      await reauth.run(() => apiFetch(`/api/account/sessions?${query}`, { method: "DELETE" }));
      setStatus({ kind: "ok", text: t("revokedOk") });
    } catch (err) {
      // 404: oturum zaten kapanmış; liste yenilenince kaybolur.
      if (err instanceof ApiError && err.code === "NOT_FOUND") {
        setStatus({ kind: "ok", text: t("alreadyClosed") });
      } else {
        setStatus({ kind: "error", text: errorText(err, t("revokeFailed")) });
      }
    } finally {
      setBusy(false);
    }
    await load();
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <section aria-labelledby="sessions-title" className="mt-8 rounded-xl bg-white p-6 shadow-sm">
      <h2 id="sessions-title" className="text-xl font-semibold text-gray-900">
        {t("listTitle")}
      </h2>
      {status && (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={`mt-3 text-sm ${status.kind === "error" ? "text-red-700" : "text-green-800"}`}
        >
          {status.text}
        </p>
      )}
      {sessions === null ? (
        <p className="mt-3 text-sm text-gray-500">{t("loading")}</p>
      ) : sessions.length === 0 ? (
        <p className="mt-3 text-sm text-gray-700">{t("empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-3 text-sm">
              <span>
                <span className="font-medium text-gray-900">
                  {s.device ?? t("unknownDevice")}
                  {s.current && (
                    <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
                      {t("current")}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-gray-600">
                  {t("started", { date: fmt.dateTime(s.createdAt) })}
                  {" · "}
                  {t("lastSeen", { date: fmt.dateTime(s.lastSeenAt) })}
                  {s.ipHint && ` · ${t("ip", { ip: s.ipHint })}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() =>
                  void revoke(
                    s.current ? null : `id=${encodeURIComponent(s.id)}`,
                    s.current ? t("confirmRevokeCurrent") : t("confirmRevoke")
                  )
                }
                aria-disabled={busy || undefined}
                className="min-h-[44px] shrink-0 rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 aria-disabled:opacity-50 sm:min-h-0"
              >
                {t("revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {others > 0 && (
        <button
          type="button"
          onClick={() => void revoke("scope=others", t("confirmRevokeOthers"))}
          aria-disabled={busy || undefined}
          className="mt-4 min-h-[44px] rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white aria-disabled:opacity-50 sm:min-h-0"
        >
          {t("revokeOthers")}
        </button>
      )}
      {reauth.dialog}
      {confirmDialog}
    </section>
  );
}
