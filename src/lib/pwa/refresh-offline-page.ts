"use client";

/**
 * Dil ya da tema tercihi değişince service worker'dan /offline sayfasını yeni çerezlerle yeniden
 * önbelleğe almasını ister (F1056). SW yoksa ya da sayfayı denetlemiyorsa sessizce no-op.
 */
export function requestOfflinePageRefresh(): void {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.controller?.postMessage({ type: "REFRESH_OFFLINE" });
  } catch {
    // SW mesajlaşması desteklenmiyorsa çevrimdışı sayfa bir sonraki SW güncellemesinde yenilenir
  }
}
