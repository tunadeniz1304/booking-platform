# Booking Platform — Mimari Dokümanı

## 1. Genel Bakış

Bu doküman, Booking.com ölçeğinde çalışan, yüksek eşzamanlılığı kaldırabilen ve veri tutarlılığını koruyan bir konaklama & rezervasyon platformunun ("booking-platform") mimarisini tanımlar. Uygulama **modüler monolit** (modular monolith) olarak tasarlanmıştır: tek bir Next.js 14 (App Router) dağıtım birimi içinde, DDD bounded context'lerine göre ayrılmış servis katmanları barındırır. Bu yaklaşım, ileride microservice geçişini kolaylaştıracak sınırları korurken, geliştirme ve dağıtım sadeliği sağlar.

## 2. Teknoloji Yığını

| Katman                 | Teknoloji                                                      | Rol                                                       |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| Sunum                  | Next.js 14, React 18, Tailwind CSS                             | SSR/SSG + UI                                              |
| API                    | Next.js Route Handlers (`src/app/api`)                         | REST uçları                                               |
| Uygulama servisleri    | TypeScript (`src/lib/*`)                                       | Domain lojik, transaction, kilit                          |
| Veritabanı             | PostgreSQL 16 + Prisma ORM                                     | Kalıcı veri, transaction, FOR UPDATE                      |
| Cache & Kilit & Kuyruk | Redis 7 (ioredis) + BullMQ                                     | Arama/rezervasyon cache'i, dağıtık kilit, pricing kuyruğu |
| Auth                   | JWT (jose middleware + jsonwebtoken servis)                    | Stateless kimlik doğrulama                                |
| Arama indeksi          | PostgreSQL (varsayılan) + Elasticsearch (opsiyonel read model) | Metin arama                                               |
| Otomasyon              | GitHub Actions, Docker Compose                                 | CI/CD                                                     |

## 3. DDD Bounded Context'ler

### 3.1 Catalog (Katalog)

- Aggregate: `Property`, `Location`, `Amenity`.
- Sorumluluk: ilan CRUD, konum ve olanak yönetimi, aktif/pasif durumu.
- Servis: `src/lib/search.ts` (okuma tarafı), ilan yazımı route handler içinde `prisma` ile.

### 3.2 Inventory (Envanter)

- Aggregate: `Room`, `Availability`.
- Sorumluluk: oda kapasitesi, gecelik müsaitlik ve fiyat kayıtları. `@@unique(roomId, date)` tekilliği ile aynı oda/tarih için tek satır garantisi.
- Kilit: satır kilidi (`SELECT ... FOR UPDATE`) + Redis dağıtık kilit.

### 3.3 Booking (Rezervasyon)

- Aggregate: `Booking`, `Payment`.
- Sorumluluk: rezervasyon oluşturma/iptal, double-booking engelleme, ödeme ilişkisi, idempotency.
- Servis: `src/lib/booking-service.ts`.

### 3.4 Pricing (Fiyatlandırma)

- Aggregate: `Room` fiyat bileşenleri.
- Sorumluluk: mevsimsel, son dakika ve doluluk faktörleriyle dinamik fiyat.
- Servis: `src/lib/pricing-service.ts`, asenkron `queue.ts` (BullMQ).

### 3.5 Identity & Access (Kimlik)

- Aggregate: `User`.
- Sorumluluk: kayıt/giriş, JWT üretimi ve doğrulama, rol bazlı yetki (USER/HOST/ADMIN).
- Servis: `src/lib/auth.ts`, route: `/api/auth/register`, `/api/auth/login`.

### 3.6 Search & Discovery (Arama)

- Sorumluluk: filtreleme, sıralama, sayfalama; Redis cache ile sık tekrarlanan sorguların hızlı yanıtı.
- Servis: `src/lib/search.ts`.

> Context'ler arası iletişim doğrudan servis çağrısı (modüler monolit) ya da BullMQ kuyruğu (asenkron) ile yapılır. Örn. rezervasyon başarılı olduğunda arama cache'i geçersiz kılınır (event-driven invalidation).

## 4. Katmanlı Tasarım

```
┌─────────────────────────────────────────────────────┐
│ Sunum: src/app (SSR/SSG sayfalar, client compons)   │
├─────────────────────────────────────────────────────┤
│ API: src/app/api/** Router Handlers + src/middleware│
│      (auth + rate-limit + blacklist + x-user-id)    │
├─────────────────────────────────────────────────────┤
│ Uygulama Servisleri: src/lib/*                      │
│  booking-service | search | pricing-service | queue │
│  auth | rate-limit | prisma | redis                 │
├─────────────────────────────────────────────────────┤
│ Altyapı: PostgreSQL (Prisma) | Redis | BullMQ       │
└─────────────────────────────────────────────────────┘
```

### 4.1 Komut/Sorgu Ayrımı (CQRS-lite)

- **Yazma yolu (command):** `POST /api/bookings` → `createBooking` → Redis kilit + SERIALIZABLE transaction + `SELECT ... FOR UPDATE`. Yazdıktan sonra arama cache'i invalidate edilir.
- **Okuma yolu (query):** `GET /api/search` → `searchProperties` → Redis cache kontrolü; miss durumunda Prisma sorgusu + cache yazımı. Rezervasyon/fiyat değişimlerinde ilgili anahtarlar silinir.

## 5. Eşzamanlılık ve Tutarlılık Stratejisi

### 5.1 Double-booking Engelleme (çift kilit)

1. **Redis dağıtık kilit (lease):** `SET booking:lock:{roomId}:{checkIn}:{checkOut} NX EX 30`. Aynı oda+tarih aralığı için aynı anda yalnız bir istek kilidi alabilir; alınamayan istek `BookingConflictError` (409) alır. Kilit etiketi (lockToken) ile güvenli serbest bırakma yalnız sahibine tanınır (yanlışlıkla başkasının kilidini silmeyi önler).
2. **Veritabanı satır kilidi:** SERIALIZABLE izolasyon seviyesindeki transaction içinde, seçilen tarih aralığındaki `Availability` satırları `SELECT ... FOR UPDATE` ile kilitlenir. Count doğrulanır; eksik/uygun olmayan satır varsa transaction rollback + `BookingValidationError` (400).
3. **Atomic update:** Tüm geceler geçerliyse `Booking` oluşturulur ve müsaitlik `isAvailable=false, lockedBy=bookingId` olarak işaretlenir. Transaction commit edildikten sonra Redis kilit serbest bırakılır.
4. **İptal:** `cancelBooking` aynı SERIALIZABLE transaction içinde rezervasyonu CANCELLED yapar ve ilgili tarihleri `isAvailable=true, lockedBy=null` döndürür; ardından arama cache'i invalidate edilir ve `booking:{id}` anahtarı silinir.

> Neden her iki kilit? Redis kilidi aşırı eşzamanlı isteği daha ucuz ve hızlı filtreler; `FOR UPDATE` ise veritabanı düzeyinde kesin tutarlılık garantisi verir (dağıtık ortamda tek yetkili kaynak). İkisi birlikte hem performans hem doğruluk sağlar.

### 5.2 Idempotency

- `POST /api/bookings` çağırıcısı `Idempotency-Key` başlığı (UUID) gönderebilir.
- `Booking.idempotencyKey` alanı `@@unique(userId, idempotencyKey)` ile modellenmiştir. Aynı anahtar + kullanıcı ikinci kez gelirse aynı rezervasyon 200 ile döner (yeni kayıt açılmaz, 409 çakışması da üretilmez).
- Anahtar gönderilmezse mevcut davranış (her istek yeni rezervasyon + kilit + FOR UPDATE) korunur.

### 5.3 Başarısızlık Yolları

- Redis kilidi alınamadı → 409, kullanıcı tekrar deneyebilir.
- Kilit alındı ancak transaction hata verdi → rollback, `finally` içinde kilit serbest bırakılır.
- Fiyat/availability değişkenliği: `FOR UPDATE` aynı satırı bekleyen ikinci isteği sıraya alır; ilk commit sonrası ikinci istek güncel satırları görür ve count eşleşmezse 400 alır.

## 6. Cache Stratejisi

| Anahtar Şablonu                    | TTL     | İçerik               | Geçersiz Kılma                                            |
| ---------------------------------- | ------- | -------------------- | --------------------------------------------------------- |
| `search:{normalizedParams}`        | 5 dk    | Arama sonuçları      | `invalidateSearchCache` / `invalidatePropertySearchCache` |
| `search:popular`                   | 15 dk   | Popüler mülkler      | `invalidateSearchCache`                                   |
| `property:{id}`                    | —       | Mülk detay önbelleği | `invalidatePropertySearchCache`                           |
| `booking:{id}`                     | 10 dk   | Rezervasyon detayı   | iptalde `DEL`                                             |
| `price:{roomId}:{date}`            | 30 dk   | Güncel fiyat         | `invalidatePriceCache` / `invalidateRoomPriceCache`       |
| `booking:lock:{roomId}:{in}:{out}` | 30 sn   | Dağıtık kilit (NX)   | başarı sonrası `DEL` veya TTL dolumu                      |
| `pricing:queue`                    | —       | Kuyruk listesi       | `pricing:queue:lock` TTL 10 sn                            |
| `rate-limit:{path}:{user}:{ip}`    | pencere | Sayaç (zset)         | slayt pencerede otomatik temizlik                         |

Cache'ler Redis üzerinde tutulur; uygulama ioredis (`redis://`) veya Upstash (REST) istemcisini `REDIS_URL`'e göre seçer (`src/lib/redis.ts`).

## 7. Rate Limiting

- **Algoritma:** Redis sorted set ile sabit-yeşil (sliding window) sayaç: her istekte pencerenin dışındaki üyeler `ZREMRANGEBYSCORE` ile temizlenir, `ZCARD` ile sayaç okunur, `ZADD` + `EXPIRE`.
- **Anahtar:** `rate-limit:{pathname}:{userId|anonymous}:{ip}` şeklindedir (`getRateLimitKey`).
- **Limitler (dakika):** auth uçları 20, arama 60, rezervasyon 30, varsayılan 100.
- **Yanıt başlıkları:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- **Aşım:** `429 { error: "Too many requests..." }`.
- Middleware (`src/middleware.ts`) ayrıca JWT doğrulayıp `x-user-id` başlığını alt uçlara enjekte eder ve kara listeye alınmış token'ları reddeder.

## 8. Güvenilirlik ve Kuyruk

- **BullMQ "pricing" kuyruğu:** `pricing:queue` Redis listesine dayalı basit kuyruk (ioredis) + BullMQ `Queue/Worker` çifti. `attempts: 3`, `backoff: exponential 5s`, `repeat cron "0 3 * * *"` ile gecelik fiyat ön ısıtması.
- **İş yükü (contract):** `updateAvailabilityPrices(roomId, dates[], basePrice, currency)` — oda ve tarih dizisi bazlı. Worker payload'ı bu imzaya uygun olmalıdır (mevcut uyumsuzluk düzeltilecek).
- **Arıza yalıtımı:** Cache okuma/yazma hataları loglanır ancak ana akışı bozmaz (fail-open — okuma yolu DB'ye düşer).

## 9. Elasticsearch (Opsiyonel Gelecek Read Model)

- **Amaç:** yüksek hacimde metin arama + filtreleme.
- **Tasarım:** `properties` index'i; kayıt ekleme/güncelleme sonrası BullMQ üzerinden asenkron senkronizasyon; okuma yolu `searchProperties` önce ES'e fallback olarak PostgreSQL'e gider. ES kapalıyken mevcut PostgreSQL yolu kullanılır (kesinti yok).
- **Ön koşul:** docker-compose'a `elasticsearch` servisi + `@elastic/elasticsearch` istemcisi + index mapping/cron reindex.

## 10. Güvenlik (Özet)

- Parolalar `bcryptjs` ile hash'lenir (sadece hash DB'de).
- JWT imza anahtarı `JWT_SECRET`; cookie httpOnly + `token`; Authorization Bearer aynı token'ı taşır.
- Middleware tüm `/api` isteklerini auth + rate-limit'ten geçirir (PUBLIC_PATHS hariç).
- Zod ile input doğrulama; alanlara tip/kısıt uygulanır.
- Ayrıntılar OWASP review dokümanında (bkz. Review aşaması).
