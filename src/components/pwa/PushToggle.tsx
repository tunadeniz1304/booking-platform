"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { base64UrlToBytes, pushSupported } from "@/lib/pwa/client";
import { serviceWorkerRegistrationEnabled } from "@/components/pwa/ServiceWorkerRegistrar";
import { Button, Card, Status } from "@/components/ui/ui";

interface PushStatus {
  enabled: boolean;
  publicKey: string | null;
  reason: string | null;
  subscriptions: number;
}

type View = "loading" | "unsupported" | "ios-install" | "server-off" | "denied" | "off" | "on";

/** Service worker hazır olmazsa (kayıt başarısız/kapalı) düğme sonsuza dek beklemesin. */
const SW_READY_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

/** iOS/iPadOS'ta Web Push yalnız ana ekrana eklenmiş uygulamada (16.4+) vardır. */
function iosNeedsHomeScreen(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function detectPushState(): Promise<{ view: View; status: PushStatus | null }> {
  const supported = pushSupported();
  const iosInstall = !supported && iosNeedsHomeScreen();
  if (!supported && !iosInstall) return { view: "unsupported", status: null };
  try {
    const status = await apiFetch<PushStatus>("/api/push/subscription");
    if (!status.enabled) return { view: "server-off", status };
    if (iosInstall) return { view: "ios-install", status };
    if (Notification.permission === "denied") return { view: "denied", status };
    const reg = await navigator.serviceWorker.getRegistration();
    // Bu derlemede service worker kaydı kapalıysa abonelik kurulamaz (F573).
    if (!reg && !serviceWorkerRegistrationEnabled()) return { view: "server-off", status };
    const sub = await reg?.pushManager.getSubscription();
    return { view: sub ? "on" : "off", status };
  } catch {
    // Oturum yok veya çevrimdışı: bildirim kartı gösterilmez.
    return { view: "loading", status: null };
  }
}

/** Bu cihazda Web Push aç/kapat (P1-12). Sunucuda VAPID yoksa nedenini açıklar. */
export default function PushToggle() {
  const t = useTranslations("pwa.push");
  const locale = useLocale();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [view, setView] = useState<View>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Kullanıcı eylemi sonrası duyurulacak durum (her zaman mount edilen canlı bölgede). */
  const [notice, setNotice] = useState<string | null>(null);
  /** Eylem sonrası odak hedefi: yeni düğme ya da (düğme kalktıysa) durum metni. */
  const pendingFocus = useRef(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const stateTextRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!pendingFocus.current || busy) return;
    pendingFocus.current = false;
    const action = actionRef.current;
    // Aynı düğme yerinde kaldıysa odak zaten orada; "reddedildi"de önce açıklama okunur.
    if (action && action === document.activeElement) return;
    const target = view === "denied" ? stateTextRef.current : action;
    (target ?? stateTextRef.current)?.focus();
  }, [view, busy]);

  useEffect(() => {
    let active = true;
    void detectPushState().then((result) => {
      if (!active) return;
      setStatus(result.status);
      setView(result.view);
    });
    return () => {
      active = false;
    };
  }, []);

  // Reddedildiyken tarayıcı ayarından izin verilirse kart kendiliğinden güncellenir (F1382).
  useEffect(() => {
    if (view !== "denied" || !("permissions" in navigator)) return;
    let active = true;
    let permission: PermissionStatus | null = null;
    const onChange = () => {
      if (permission?.state === "denied") return;
      void detectPushState().then((result) => {
        if (!active || result.view === "loading") return;
        const focused = document.activeElement;
        if (focused && (focused === actionRef.current || focused === stateTextRef.current)) {
          pendingFocus.current = true;
        }
        setStatus(result.status);
        setView(result.view);
        if (result.view === "off") setNotice(t("allowedNow"));
      });
    };
    navigator.permissions
      .query({ name: "notifications" })
      .then((p) => {
        if (!active) return;
        permission = p;
        p.addEventListener("change", onChange);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      permission?.removeEventListener("change", onChange);
    };
  }, [view, t]);

  async function enable() {
    if (!status?.publicKey) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    pendingFocus.current = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        if (permission === "denied") {
          setView("denied");
        } else {
          setView("off");
          setNotice(t("dismissed"));
        }
        return;
      }
      let reg: ServiceWorkerRegistration;
      try {
        reg = await withTimeout(navigator.serviceWorker.ready, SW_READY_TIMEOUT_MS);
      } catch {
        setError(t("notReady"));
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(status.publicKey),
      });
      await apiFetch("/api/push/subscription", {
        method: "POST",
        body: JSON.stringify({ ...sub.toJSON(), locale: locale === "en" ? "en" : "tr" }),
      });
      setView("on");
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setNotice(null);
    pendingFocus.current = true;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await apiFetch("/api/push/subscription", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setView("off");
      setNotice(t("disabledDone"));
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  /** Tarayıcı ayarından izin verildikten sonra sayfayı yenilemeden yeniden kontrol (F1382). */
  async function recheck() {
    setBusy(true);
    setError(null);
    setNotice(null);
    pendingFocus.current = true;
    const result = await detectPushState();
    if (result.view === "loading") {
      setError(t("recheckError"));
    } else {
      setStatus(result.status);
      setView(result.view);
      if (result.view === "denied") setNotice(t("stillDenied"));
      if (result.view === "off") setNotice(t("allowedNow"));
    }
    setBusy(false);
  }

  if (view === "loading") return null;

  return (
    <Card title={t("title")} id="push">
      <p className="text-sm text-gray-700">{t("description")}</p>
      <div
        className="mt-3 space-y-2 text-sm text-gray-800"
        data-testid="push-state"
        data-state={view}
      >
        {/* Her zaman mount edilen canlı bölge: durum değişince ekran okuyucuya duyurulur. */}
        <div aria-live="polite" className="space-y-2">
          {view === "unsupported" && <p>{t("unsupported")}</p>}
          {view === "ios-install" && <p>{t("iosInstall")}</p>}
          {view === "server-off" && <p>{t("disabledServer")}</p>}
          {view === "denied" && (
            <>
              <p ref={stateTextRef} tabIndex={-1}>
                {t("denied")}
              </p>
              <p className="text-gray-700">{t("deniedHelp")}</p>
            </>
          )}
          {view === "on" && <p>{t("enabled")}</p>}
        </div>
        {view === "denied" && (
          <Button ref={actionRef} variant="secondary" onClick={recheck} busy={busy}>
            {busy ? t("working") : t("recheck")}
          </Button>
        )}
        {view === "off" && (
          <Button ref={actionRef} onClick={enable} busy={busy}>
            {busy ? t("working") : t("enable")}
          </Button>
        )}
        {view === "on" && (
          <Button ref={actionRef} variant="secondary" onClick={disable} busy={busy}>
            {busy ? t("working") : t("disable")}
          </Button>
        )}
      </div>
      <Status error={error} message={notice} />
    </Card>
  );
}
