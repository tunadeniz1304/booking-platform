"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { base64UrlToBytes, pushSupported } from "@/lib/pwa/client";
import { Button, Card, Status } from "@/components/ui/ui";

interface PushStatus {
  enabled: boolean;
  publicKey: string | null;
  reason: string | null;
  subscriptions: number;
}

type View = "loading" | "unsupported" | "server-off" | "denied" | "off" | "on";

async function detectPushState(): Promise<{ view: View; status: PushStatus | null }> {
  if (!pushSupported()) return { view: "unsupported", status: null };
  try {
    const status = await apiFetch<PushStatus>("/api/push/subscription");
    if (!status.enabled) return { view: "server-off", status };
    if (Notification.permission === "denied") return { view: "denied", status };
    const reg = await navigator.serviceWorker.getRegistration();
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

  async function enable() {
    if (!status?.publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setView(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
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
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
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
        {view === "unsupported" && <p>{t("unsupported")}</p>}
        {view === "server-off" && <p>{t("disabledServer")}</p>}
        {view === "denied" && <p>{t("denied")}</p>}
        {view === "on" && <p>{t("enabled")}</p>}
        {view === "off" && (
          <Button onClick={enable} disabled={busy}>
            {busy ? t("working") : t("enable")}
          </Button>
        )}
        {view === "on" && (
          <Button variant="secondary" onClick={disable} disabled={busy}>
            {busy ? t("working") : t("disable")}
          </Button>
        )}
      </div>
      <Status error={error} />
    </Card>
  );
}
