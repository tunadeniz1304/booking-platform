/* eslint-disable */
/**
 * Booking PWA service worker (P1-12) — elle yazılmış, bağımlılıksız.
 *
 * Neden @serwist/next değil: @serwist/next bir webpack eklentisidir; Next 16 `next build`
 * varsayılan olarak Turbopack kullanır ve eklenti bu yolda çalışmaz (`--webpack`'e dönmek
 * derleme hattını değiştirirdi). Ayrıntı: docs / v4 ilerleme notu.
 *
 * Stratejiler:
 *  - /_next/static, /icons, /fonts: cache-first (içerik adresli, değişmez).
 *  - /trips (gezinme) ve /api/itinerary: network-first (+zaman aşımı) → önbellek → çevrimdışı.
 *  - Diğer gezinmeler: ağ; ağ yoksa /offline (önceden önbelleğe alınır). Diğer API'ler hiç önbelleğe alınmaz.
 * Oturum kapatılınca istemci CLEAR_USER_DATA mesajı gönderir → kişisel önbellekler silinir.
 */
const VERSION = "v1";
const STATIC_CACHE = "booking-static-" + VERSION;
const PAGES_CACHE = "booking-pages-" + VERSION;
const DATA_CACHE = "booking-data-" + VERSION;
const CURRENT = [STATIC_CACHE, PAGES_CACHE, DATA_CACHE];
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];
const OFFLINE_PAGES = ["/trips"];
const OFFLINE_APIS = ["/api/itinerary"];
const STATIC_PREFIXES = ["/_next/static/", "/icons/", "/fonts/"];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("booking-") && !CURRENT.includes(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isStatic(url) {
  return STATIC_PREFIXES.some((p) => url.pathname.startsWith(p));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Önbellekten dönen yanıtı işaretler (sayfa "çevrimdışı kopya" bandını gösterir). */
async function markCached(response) {
  const headers = new Headers(response.headers);
  headers.set("x-sw-cache", "hit");
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") cache.put(request, response.clone());
  return response;
}

/** Ağ önce; yalnızca 200 ve yönlendirilmemiş yanıt saklanır (401/302 önbelleği zehirlemez). */
async function networkFirst(request, cacheName, cacheKey) {
  const cache = await caches.open(cacheName);
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (response.status === 200 && !response.redirected && response.type === "basic") {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    const hit = await cache.match(cacheKey);
    if (hit) return markCached(hit);
    throw error;
  }
}

async function offlineFallback() {
  const hit = await caches.match(OFFLINE_URL);
  return hit || new Response("offline", { status: 503, headers: { "Content-Type": "text/plain" } });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isStatic(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (OFFLINE_APIS.includes(url.pathname)) {
    event.respondWith(
      networkFirst(request, DATA_CACHE, url.pathname).catch(
        () =>
          new Response(JSON.stringify({ error: "Çevrimdışı", code: "OFFLINE" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    return;
  }
  if (request.mode === "navigate") {
    if (OFFLINE_PAGES.includes(url.pathname)) {
      event.respondWith(networkFirst(request, PAGES_CACHE, url.pathname).catch(offlineFallback));
    } else {
      event.respondWith(fetch(request).catch(offlineFallback));
    }
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "CLEAR_USER_DATA") {
    event.waitUntil(Promise.all([caches.delete(DATA_CACHE), caches.delete(PAGES_CACHE)]));
    return;
  }
  // İlk ziyarette sayfa henüz SW denetiminde değilken yüklenen statik parçalar (JS/CSS).
  if (data.type === "CACHE_URLS" && Array.isArray(data.urls)) {
    const urls = data.urls
      .map((u) => {
        try {
          return new URL(u, self.location.origin);
        } catch (e) {
          return null;
        }
      })
      .filter((u) => u && u.origin === self.location.origin && isStatic(u))
      .slice(0, 200);
    event.waitUntil(
      caches.open(STATIC_CACHE).then((cache) =>
        Promise.all(
          urls.map((u) =>
            cache.match(u.href).then((hit) => (hit ? null : cache.add(u.href).catch(() => null)))
          )
        )
      )
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "Booking";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: typeof data.url === "string" ? data.url : "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/";
  let target;
  try {
    target = new URL(raw, self.location.origin);
  } catch (e) {
    target = new URL("/", self.location.origin);
  }
  // Yalnızca site içi adresler açılır (yükten açık yönlendirme yapılamaz).
  if (target.origin !== self.location.origin) target = new URL("/", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === target.href && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target.href);
    })
  );
});
