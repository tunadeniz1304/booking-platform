"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa/client";
import NetworkStatusBanner from "@/components/pwa/NetworkStatusBanner";

/** Bu derlemede service worker kaydı yapılıyor mu (geliştirmede ve PWA kapalıyken hayır). */
export function serviceWorkerRegistrationEnabled(): boolean {
  return process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_PWA_DISABLED !== "true";
}

/**
 * Service worker kaydı (P1-12). Yalnızca üretim derlemesinde: geliştirmede HMR parçalarını
 * önbelleğe almak bayat kod gösterirdi. `NEXT_PUBLIC_PWA_DISABLED=true` ile kapatılabilir.
 * Kökte her sayfada render edildiği için uygulama geneli bağlantı bandını da taşır (F423).
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!serviceWorkerRegistrationEnabled()) return;
    void registerServiceWorker();
  }, []);
  return <NetworkStatusBanner />;
}
