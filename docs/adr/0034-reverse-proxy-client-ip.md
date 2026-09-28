# ADR 0034 — Ters vekil (Caddy) ve güvenilir istemci IP'si

- Durum: Kabul edildi (v5#6)
- Tarih: 2026-09-28
- İlgili: v4#4 (paylaşılan `anon` kovası), v4#12 (giriş PoW'u), `docs/SECURITY.md` §7

## Bağlam

Next.js 16'da `NextRequest.ip` kaldırıldı (bkz. `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-15.md`,
"`NextRequest` Geolocation"): IP'yi barındırma platformu sağlar. Kendi barındırdığımız
`next start` sunucusunda soket adresi Proxy'ye (`src/proxy.ts`) ulaşmaz. `src/proxy.ts`'teki
`(req as …).ip` bu yüzden her zaman `undefined` idi ve varsayılan kurulumda
(`TRUSTED_PROXY_HOPS=0`, uygulama portu doğrudan yayında) istemci IP'si hiç bilinmiyordu.

Sonuç: tüm anonimler tek `anon` rate-limit ve AI bütçesi kovasını paylaşıyordu. Tek saldırgan
kovayı doldurarak herkes için giriş/kayıt/şifre sıfırlamayı ve anonim AI'ı kilitleyebiliyordu
(global DoS); fraud IP hızı da UA parmak izine düşüyordu. `docs/SECURITY.md` bunu "bilinçli
ödünleşim" olarak kaydetmişti.

## Karar

1. **Compose'a ters vekil: Caddy** (`docker/Caddyfile`, servis `caddy`). Uygulama (`app`) artık
   host'a port açmaz (`expose: 3000`), tek giriş noktası Caddy'dir. Caddy istemcinin gönderdiği
   `X-Forwarded-For`/`X-Real-IP`'yi yok sayar ve yalnız TCP soket adresini yazar; compose ortak
   ortamında `TRUSTED_PROXY_HOPS: "1"` sabittir (`.env`'deki değer ezilir).
2. **Fail-closed yapılandırma denetimi** (`src/lib/security/exposure.ts`): üretimde (demo dışı)
   `TRUSTED_PROXY_HOPS=0`, `TRUST_REAL_IP_HEADER=false` ve `ALLOW_DIRECT_EXPOSURE` verilmemişse
   `/api/ready` 503 `DIRECT_EXPOSURE_UNSAFE` döner ve başlangıçta (`src/instrumentation.ts`) ERROR
   loglanır. Orkestratör trafiği yanlış yapılandırılmış örneğe yönlendirmez.
3. **Hizmet reddi yerine yavaşlatma** (`src/lib/security/auth-degraded.ts`): IP yine de
   bilinemezse (ör. `ALLOW_DIRECT_EXPOSURE=true`) e-postalı auth uçlarında (giriş, kayıt, şifre
   sıfırlama isteği) paylaşılan kova tükendiğinde — istemcinin kendi parmak izi kovası boşsa —
   proxy isteği 429 yerine `x-auth-degraded: 1` işaretiyle geçirir (istemcinin gönderdiği işaret
   silinir). Route e-posta anahtarlı ikincil kovayı (`RATE_LIMIT_AUTH_MAX`) ve mevcut v4#12 iş
   kanıtını (PoW) uygular; formlar bulmacayı otomatik çözer (`src/lib/auth/pow-fetch.ts`).

## Neden Caddy

| Seçenek                                            | Artı                                                                                                                                                                                           | Eksi                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Caddy** (seçildi)                                | Tek dosyalık okunur yapılandırma; otomatik HTTPS (ACME) yalnız `SITE_ADDRESS`'e alan adı vermekle; SSE'yi (`text/event-stream`) varsayılan olarak akıtır; resmi küçük alpine imajı; Apache-2.0 | Nginx kadar yaygın operasyon bilgisi yok                                                                   |
| Nginx                                              | Çok yaygın, olgun                                                                                                                                                                              | TLS için ayrı certbot/yenileme düzeni; SSE için `proxy_buffering off` gibi ek ayar; daha uzun yapılandırma |
| Traefik                                            | Docker etiketleriyle keşif, otomatik HTTPS                                                                                                                                                     | Tek servis için fazla hareketli parça; etiket tabanlı yapılandırma okunurluğu düşük                        |
| Proxy yok, `server.js` sarmalayıcı ile soket IP'si | Ek konteyner yok                                                                                                                                                                               | Next'in standalone sunucusunu çatallamak; TLS yine çözülmemiş; güncellemelerde kırılgan                    |

## Sonuçlar

- Compose ile çalıştırılan her kurulumda istemci başına kova vardır; paylaşılan kova yalnız
  bilinçli (`ALLOW_DIRECT_EXPOSURE=true`) doğrudan açık kurulumlarda kalır ve orada da auth
  kilitlenmesi yerine PoW'lu yavaşlatma olur.
- `docker compose` ile tek makinede `APP_PORT` (varsayılan 3000) artık Caddy'ye bağlıdır;
  adres değişmez (<http://localhost:3000>).
- Önde başka bir yük dengeleyici (bulut LB) + Caddy varsa `TRUSTED_PROXY_HOPS` halka sayısına göre
  artırılmalı ve Caddy'de `trusted_proxies` tanımlanmalıdır.
- Demo e2e koşusu tek istemci IP'sinden gelir; etkin sınır değişmez (önceden de aynı UA'nın
  ikincil kovası 1× idi, şimdi IP kovası 1×). Gerekirse `RATE_LIMIT_DEMO_RELAX_MULTIPLIER`.
- Sayfa yanıtlarındaki `Vary: Accept-Language, Cookie` (v5#15) da Caddy'de eklenir: Next'in
  app-page işleyicisi `Vary`'yi `setHeader` ile ezdiği için `proxy.ts`'ten eklenen değer yanıta
  ulaşmaz. Caddy'siz dağıtımda eşdeğer başlığı öndeki vekil eklemelidir (sayfalar zaten
  `private, no-store` olduğundan paylaşılan önbellek riski düşüktür).
