"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

/** Bağlantı geri gelince yayınlanan pencere olayı: veri yükleyiciler bu olayda yeniden çeker. */
export const APP_RECONNECT_EVENT = "app:reconnect";

/** "Bağlantı geri geldi" iletisinin ekranda kalma süresi. */
const RECONNECTED_VISIBLE_MS = 4000;

function subscribeConnectivity(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const readOnline = () => navigator.onLine;
const serverOnline = () => true;

/**
 * Uygulama geneli bağlantı göstergesi (F422/F423): çevrimdışıyken kalıcı, bağlantı dönünce
 * birkaç saniyelik bant. Canlı bölge her zaman DOM'da durur (ekran okuyucu duyurusu); bant
 * tıklamaları engellemez. Bağlantı dönünce `APP_RECONNECT_EVENT` yayınlanır.
 */
export default function NetworkStatusBanner() {
  const t = useTranslations("pwa.network");
  const online = useSyncExternalStore(subscribeConnectivity, readOnline, serverOnline);
  const [reconnected, setReconnected] = useState(false);

  useEffect(() => {
    let timer = 0;
    const onOnline = () => {
      window.clearTimeout(timer);
      setReconnected(true);
      timer = window.setTimeout(() => setReconnected(false), RECONNECTED_VISIBLE_MS);
      window.dispatchEvent(new Event(APP_RECONNECT_EVENT));
    };
    const onOffline = () => {
      window.clearTimeout(timer);
      setReconnected(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const message = !online ? t("offline") : reconnected ? t("online") : null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-testid="network-status"
      data-state={online ? "online" : "offline"}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[55] flex justify-center px-4"
    >
      {message && (
        <p className="max-w-md rounded-lg border border-gray-300 bg-white px-4 py-2 text-center text-sm font-medium text-gray-900 shadow-lg">
          <span aria-hidden="true">{online ? "✓" : "⚠︎"} </span>
          {message}
        </p>
      )}
    </div>
  );
}
