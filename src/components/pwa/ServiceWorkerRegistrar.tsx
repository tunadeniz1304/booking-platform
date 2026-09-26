"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa/client";

/**
 * Service worker kaydı (P1-12). Yalnızca üretim derlemesinde: geliştirmede HMR parçalarını
 * önbelleğe almak bayat kod gösterirdi. `NEXT_PUBLIC_PWA_DISABLED=true` ile kapatılabilir.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (process.env.NEXT_PUBLIC_PWA_DISABLED === "true") return;
    void registerServiceWorker();
  }, []);
  return null;
}
