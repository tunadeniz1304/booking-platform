"use client";

/**
 * Tarayıcı tarafı PWA yardımcıları (P1-12): service worker kaydı, çevrimdışı önbelleği
 * doldurma/temizleme ve Web Push aboneliği. Tümü özellik algılamalıdır; destek yoksa sessizce
 * no-op (uygulama PWA olmadan da tam çalışır).
 */

export const SW_URL = "/sw.js";
const USER_CACHES = ["booking-data-", "booking-pages-"];

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export function pushSupported(): boolean {
  return (
    serviceWorkerSupported() &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** İlk ziyarette SW denetimi olmadan yüklenen statik parçaları SW'ye önbelleğe aldırır. */
function warmStaticCache(registration: ServiceWorkerRegistration): void {
  const urls = performance
    .getEntriesByType("resource")
    .map((e) => e.name)
    .filter((u) => u.startsWith(`${location.origin}/_next/static/`));
  registration.active?.postMessage({ type: "CACHE_URLS", urls });
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorkerSupported()) return null;
  try {
    await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    const ready = await navigator.serviceWorker.ready;
    warmStaticCache(ready);
    return ready;
  } catch {
    return null;
  }
}

/** Ortak cihazda önceki kullanıcının destek sohbeti (SupportChat) kalmasın. */
const SUPPORT_CHAT_STORAGE_PREFIX = "support-chat:";

function clearSupportChatStorage(): void {
  try {
    const storage = window.sessionStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(SUPPORT_CHAT_STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // depolama erişimi engelliyse silinecek bir şey de yok
  }
}

/** Oturum kapanınca kişisel çevrimdışı önbellekler (seyahat planı, destek sohbeti) silinir. */
export async function clearOfflineUserData(): Promise<void> {
  clearSupportChatStorage();
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_USER_DATA" });
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => USER_CACHES.some((p) => k.startsWith(p))).map((k) => caches.delete(k))
      );
    }
  } catch {
    // önbellek API'si yoksa silinecek bir şey de yok
  }
}

/** VAPID açık anahtarı (base64url) → `applicationServerKey`. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
