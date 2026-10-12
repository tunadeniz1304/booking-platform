"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch, logout } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Button, Status, focusRing, loginHref } from "@/components/ui/ui";
import { withRedirect } from "@/components/auth/AuthCard";
import { useSessionUserCache } from "@/components/layout/useSessionUserCache";
import { rememberAuthEmail } from "@/lib/auth/auth-email-handoff";
import { ReauthCancelledError, useAccountErrorText, useReauth } from "./ReauthDialog";

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

/** "Diğer tüm oturumlar" sorgusu; `revoking` anahtarı olarak da kullanılır. */
const OTHERS = "scope=others";

/**
 * F793: şifre değişikliği "Şifremi unuttum" akışındaki e-posta bağlantısıyla yapılır.
 * F2-35: oturumun e-postası ve bu sayfaya dönüş adresi taşınır (form boş açılmaz).
 */
const CHANGE_PASSWORD_PATH = "/forgot-password";
const changePasswordClass = `text-sm font-semibold text-[#003580] hover:underline ${focusRing}`;

/** `info`: kullanıcının kendi vazgeçmesi gibi nötr bilgi; `changePassword`: şifre bağlantısı da. */
interface SessionStatus {
  kind: "ok" | "error" | "info";
  text: string;
  changePassword?: boolean;
}

const RELATIVE_STEPS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "3 gün önce" / "3 days ago"; `now` listenin alındığı andır (render sırasında saat okunmaz). */
function relativeTime(iso: string, now: number, locale: string): string {
  const diff = new Date(iso).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_STEPS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(0, "second");
}

/**
 * Hesap ▸ Oturumlar (P0-4): etkin oturumları listeler, tek oturumu veya mevcut dışındaki
 * tümünü uzaktan kapatır. Kapatma yakın zamanda yeniden doğrulama ister (REAUTH_REQUIRED).
 */
export default function SessionManager() {
  const t = useTranslations("account.sessions");
  const ta = useTranslations("account");
  const fmt = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const sessionUser = useSessionUserCache();
  const changePasswordHref = withRedirect(CHANGE_PASSWORD_PATH, pathname || "/");
  const rememberSessionEmail = () => {
    if (sessionUser?.email) rememberAuthEmail(sessionUser.email);
  };
  const reauth = useReauth();
  const { confirm, confirmDialog } = useConfirm();
  const [loaded, setLoaded] = useState<{ sessions: SessionView[]; at: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // İşlemdeki düğme: oturum kimliği ya da OTHERS (F634: yalnız o düğmenin metni değişir).
  const [revoking, setRevoking] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // F631: kaldırılan satırın sırası (-1: bölüm başlığı); yenilenen listede odak oraya taşınır.
  const pendingFocus = useRef<number | null>(null);

  // F191: sunucu/tarayıcı metni yerine arayüz dilinde hata.
  const errorText = useAccountErrorText();

  const onLoadError = useCallback(
    (err: unknown) => {
      pendingFocus.current = null;
      if ((err as { status?: number }).status === 401) router.push(loginHref());
      else setLoadError(errorText(err, t("loadFailed")));
    },
    [errorText, router, t]
  );

  const load = useCallback(() => {
    setLoading(true);
    return fetchSessions()
      .then((sessions) => {
        setLoaded({ sessions, at: Date.now() });
        setLoadError(null);
      })
      .catch(onLoadError)
      .finally(() => setLoading(false));
  }, [onLoadError]);

  useEffect(() => {
    let cancelled = false;
    fetchSessions()
      .then((sessions) => {
        if (!cancelled) setLoaded({ sessions, at: Date.now() });
      })
      .catch((err: unknown) => {
        if (!cancelled) onLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [onLoadError]);

  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null || !loaded) return;
    pendingFocus.current = null;
    // Yalnız odaktaki düğme DOM'dan kalktıysa taşı; kullanıcının başka yerdeki odağını çalma.
    if (document.activeElement && document.activeElement !== document.body) return;
    let target: HTMLElement | null | undefined = headingRef.current;
    if (index >= 0) {
      // Sonraki satırın düğmesi; son satır kalktıysa bir öncekinin, liste boşsa başlık.
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button");
      target = buttons?.item(index) ?? buttons?.item(index - 1) ?? target;
    }
    target?.focus();
  }, [loaded]);

  function retry() {
    pendingFocus.current = -1;
    void load();
  }

  async function revoke(key: string, query: string | null, confirmText: string, index = -1) {
    if (revoking) return;
    const ok = await confirm({
      title: confirmText,
      confirmLabel: query === null ? t("confirmLogoutLabel") : t("confirmRevokeLabel"),
      tone: "danger",
    });
    if (!ok) return;
    setRevoking(key);
    setStatus(null);
    try {
      if (query === null) {
        // F192: bu cihaz için yeniden doğrulama gerekmez; çıkış mevcut oturumu sunucuda kapatır.
        // (Yeniden doğrulama oturumu yenilediği için eski kimlikle DELETE 404 dönüyordu.)
        await logout();
        router.push("/login");
        return;
      }
      const res = await reauth.run(() =>
        apiFetch<{ revoked?: number }>(`/api/account/sessions?${query}`, { method: "DELETE" })
      );
      const count = res.revoked ?? 0;
      setStatus(
        key !== OTHERS
          ? { kind: "ok", text: t("revokedOk") }
          : count > 0
            ? { kind: "ok", text: t("revokedOthersOk"), changePassword: true }
            : { kind: "ok", text: t("revokedCount", { count }) }
      );
      pendingFocus.current = index;
    } catch (err) {
      // F1187: kullanıcı yeniden doğrulamadan kendisi vazgeçti; hata değil, liste de değişmedi.
      if (err instanceof ReauthCancelledError) {
        setStatus({ kind: "info", text: t("revokeCancelled") });
        setRevoking(null);
        return;
      }
      // 404: oturum zaten kapanmış; liste yenilenince kaybolur.
      if (err instanceof ApiError && err.code === "NOT_FOUND") {
        setStatus({ kind: "ok", text: t("alreadyClosed") });
        pendingFocus.current = index;
      } else {
        setStatus({ kind: "error", text: errorText(err, t("revokeFailed")) });
      }
    }
    await load();
    setRevoking(null);
  }

  const sessions = loaded?.sessions ?? null;
  const loadedAt = loaded?.at ?? 0;
  // F459: mevcut oturum her zaman ilk sırada; diğerleri sunucunun son etkinlik sırasında kalır.
  const ordered = sessions
    ? [...sessions].sort((a, b) => Number(b.current) - Number(a.current))
    : null;
  const others = sessions?.filter((s) => !s.current).length ?? 0;
  const busy = revoking !== null;

  return (
    <section aria-labelledby="sessions-title" className="mt-8 rounded-xl bg-white p-6 shadow-sm">
      <h2
        id="sessions-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-gray-900 focus:outline-none"
      >
        {t("listTitle")}
      </h2>
      {/* F632: başarı, her zaman DOM'da duran role="status" bölgesinde duyurulur. */}
      <div className="mt-2">
        <Status
          error={status?.kind === "error" ? status.text : null}
          message={status?.kind === "ok" ? status.text : null}
        />
        <p role="status" className="text-sm text-gray-700">
          {status?.kind === "info" ? status.text : null}
        </p>
        {status?.changePassword && (
          <Link
            href={changePasswordHref}
            onClick={rememberSessionEmail}
            className={`mt-1 inline-block ${changePasswordClass}`}
          >
            {t("changePassword")}
          </Link>
        )}
      </div>
      {loadError && (
        <div className="mt-2">
          <Status error={loadError} />
          <Button variant="secondary" busy={loading} onClick={retry} className="mt-2">
            {ta("retry")}
          </Button>
        </div>
      )}
      {ordered === null ? (
        loadError ? null : (
          <p className="mt-3 text-sm text-gray-500">{t("loading")}</p>
        )
      ) : ordered.length === 0 ? (
        <p className="mt-3 text-sm text-gray-700">{t("empty")}</p>
      ) : (
        <ul ref={listRef} aria-busy={busy || undefined} className="mt-3 divide-y divide-gray-100">
          {ordered.map((s, index) => {
            const device = s.device ?? t("unknownDevice");
            const lastSeen = fmt.dateTime(s.lastSeenAt);
            const isRevoking = revoking === s.id;
            // F635: mevcut cihaz görünür metinle, diğerleri cihaz + son etkinlikle ayırt edilir.
            const label =
              s.current || isRevoking ? undefined : t("revokeLabel", { device, date: lastSeen });
            return (
              <li
                key={s.id}
                className="flex flex-col items-start gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  <span className="font-medium text-gray-900">
                    {device}
                    {s.current && (
                      <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
                        {t("current")}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-gray-600">
                    {t("started", { date: fmt.dateTime(s.createdAt) })}
                    {" · "}
                    {t("lastSeen", {
                      ago: relativeTime(s.lastSeenAt, loadedAt, fmt.locale),
                      date: lastSeen,
                    })}
                    {s.ipHint && ` · ${t("ip", { ip: s.ipHint })}`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void revoke(
                      s.id,
                      s.current ? null : `id=${encodeURIComponent(s.id)}`,
                      s.current ? t("confirmRevokeCurrent") : t("confirmRevoke"),
                      index
                    )
                  }
                  aria-disabled={busy || undefined}
                  aria-busy={isRevoking || undefined}
                  aria-label={label}
                  className="min-h-[44px] shrink-0 rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 aria-disabled:opacity-50 sm:min-h-0"
                >
                  {isRevoking ? t("revoking") : s.current ? t("revokeCurrent") : t("revoke")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {others > 0 && (
        <>
          <button
            type="button"
            onClick={() => void revoke(OTHERS, OTHERS, t("confirmRevokeOthers"))}
            aria-disabled={busy || undefined}
            aria-busy={revoking === OTHERS || undefined}
            className="mt-4 min-h-[44px] rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white aria-disabled:opacity-50 sm:min-h-0"
          >
            {revoking === OTHERS ? t("revoking") : t("revokeOthers", { count: others })}
          </button>
          <p className="mt-4">
            <Link
              href={changePasswordHref}
              onClick={rememberSessionEmail}
              className={changePasswordClass}
            >
              {t("changePassword")}
            </Link>
          </p>
        </>
      )}
      {reauth.dialog}
      {confirmDialog}
    </section>
  );
}
