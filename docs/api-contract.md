# API Sözleşmesi — Booking Platform

Base URL: `/api`. Tüm istek/yanıtlar JSON'dur. UI kopyası Türkçe'dir; API alan adları İngilizce'dir.

> **Makine okunur sözleşme:** `GET /api/openapi.json` (oturumsuz) çekirdek misafir akışını — `/api/search`, `/api/quote`, `/api/bookings`, `/api/bookings/{id}` (GET, DELETE = iptal), `/api/bookings/{id}/pay` — OpenAPI 3.1 olarak yayımlar: Bearer (`bearerAuth`) şeması, `Idempotency-Key` başlığı, ortak `Error` zarfı ve `x-error-catalog` hata kodu kataloğu (`ERROR_CATALOG`, `src/lib/http/errors.ts`). İstek şemaları route'ların kullandığı zod şemalarından üretilir (`src/lib/http/api-schemas.ts` → `src/lib/http/openapi.ts`); belge ile route dosyalarının uyumu `tests/unit/lib/openapi-contract.test.ts` ile denetlenir. Bu dosya insan okunur ayrıntı ve belgelenmemiş diğer uçlar içindir.

## 0. Ortak Sözleşmeler

### 0.1 Hata Zarfı (Error Envelope)

Başarısız her yanıt şu şekildedir:

```json
{ "error": "İnsan okunur mesaj", "code": "MACHINE_CODE", "details": {} }
```

Zod doğrulama hatalarında:

```json
{ "error": "Validation error", "details": [{ "path": "checkIn", "message": "..." }] }
```

### 0.2 Durum Kodları

| Kod | Anlam         | Senaryo                                          |
| --- | ------------- | ------------------------------------------------ |
| 201 | Oluşturuldu   | register, booking create (yeni)                  |
| 200 | Başarılı      | login, listeler, detail, idempotent replay       |
| 400 | Doğrulama     | geçersiz tarih, süre sınırı, capacity            |
| 401 | Yetkisiz      | eksik/geçersiz token                             |
| 403 | Yasak         | başkasının kaynağı (GET /bookings/:id)           |
| 404 | Bulunamadı    | mülk/rezervasyon yok                             |
| 409 | Çakışma       | oda şu an başka biri tarafından rezerve ediliyor |
| 402 | Ödeme reddi   | kart reddi, SPT/mandate limiti (v4)              |
| 410 | Süresi doldu  | bölünmüş ödeme linki (v4)                        |
| 422 | İşlenemez     | geçersiz kart token'ı, engellenen mesaj (v4)     |
| 429 | Rate limit    | limit aşıldı                                     |
| 500 | Sunucu hatası | yakalanmamış hata                                |
| 502 | PSP hatası    | `PAYMENT_PROVIDER_ERROR` (v4)                    |
| 503 | Kullanılamaz  | Redis/rate-limit, yapılandırılmamış özellik      |

### 0.3 Kimlik Doğrulama

- Giriş/kayıt yanıtı: `{ user, token }`. Token JWT'dir (algorithm HS256, `sub` = userId, `role` claim'i içerir).
- İstemci token'ı **`Authorization: Bearer <token>`** başlığında **veya** `token` httpOnly cookie'sinde gönderir.
- Proxy (`src/proxy.ts`), korunan `/api` isteklerini doğrular ve `x-user-id` / `x-user-role` başlıklarını yalnızca doğrulanmış token'dan alt uçlara ekler.
- Oturum gerektirmeyen uçlar `src/lib/security/public-routes.ts` içindeki `PUBLIC_API` listesindedir: `/api/auth/*`, `/api/health`, `/api/ready`, `/api/metrics`, `/api/internal/*`, `/api/payments/webhook` (tüm metotlar); `/api/search` (GET, POST); `/api/properties*`, `/api/locations`, `/api/quote`, `/api/rooms/*`, `/api/routing/optimize`, `/api/transfers/discover`, `/api/openapi.json`, `/api/photos/*` (yalnız aktif ilanın görseli), `/api/price-insight`, `/api/compare` (yalnızca GET; v5#7). Route handler'lar ayrıca kendi yetki kontrolünü yapar.

### 0.4 Idempotency

- `POST /api/bookings` isteğinde opsiyonel `Idempotency-Key` başlığı (UUID) kullanılabilir.
- Aynı `userId + idempotencyKey` ile tekrar eden istek, aynı rezervasyonu **200** ile döndürür (yeni kayıt oluşturmaz).

### 0.5 Rate Limit Başlıkları

Tüm `/api` yanıtlarında:
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

## 1. Auth

### 1.1 POST /api/auth/register — Kayıt

Public.

```json
// Request
{ "firstName": "Ayşe", "lastName": "Demir", "email": "user@example.com", "password": "Password123!" }
// 201 Response
{ "user": { "id": "cuid", "firstName": "Ayşe", "lastName": "Demir", "email": "user@example.com", "role": "USER" }, "token": "<jwt>" }
```

Doğrulama: `email` geçerli e-posta, `password` min 8 karakter + en az 1 rakam, `firstName/lastName` min 1. Aynı e-posta varsa 409 yerine 409 `{error:"Bu e-posta zaten kayıtlı"}` veya 400 (uygulama kararı: 409).

### 1.2 POST /api/auth/login — Giriş

Public.

```json
// Request
{ "email": "user@example.com", "password": "Password123!" }
// 200 Response
{ "user": { "id", "firstName", "lastName", "email", "role" }, "token": "<jwt>" }
// 401
{ "error": "E-posta veya parola hatalı" }
```

### 1.3 GET /api/user/me — Oturum

Auth (Bearer veya cookie).

```json
// 200
{
  "id": "cuid",
  "firstName": "Ayşe",
  "lastName": "Demir",
  "email": "user@example.com",
  "role": "USER",
  "avatarUrl": null
}
```

## 2. Arama & Katalog

### 2.1 GET /api/search — Arama

Public. Sorgu parametreleri:
`destination` (şehir/ülke ve/veya metin), `checkIn`, `checkOut` (ISO tarih), `guests`, `minPrice`, `maxPrice`, `propertyType` (HOTEL|APARTMENT|VILLA|HOSTEL|BED_AND_BREAKFAST), `sort` (recommended|price_asc|price_desc|rating), `page` (1+), `pageSize` (1-50, varsayılan 20).

```json
// 200
{
  "results": [
    {
      "id": "cuid",
      "title": "Grand Deluxe Hotel",
      "description": "...",
      "propertyType": "HOTEL",
      "basePriceMinor": 245000,
      "currency": "TRY",
      "ratingAvg": 8.9,
      "ratingCount": 1240,
      "location": { "city": "İstanbul", "country": "Türkiye" },
      "amenities": ["Ücretsiz WiFi", "Havuz"],
      "availableRooms": 3,
      "quote": {
        "roomId": "cuid",
        "ratePlanId": "cuid",
        "total": 735000,
        "currency": "TRY",
        "nights": 3
      }
    }
  ],
  "total": 10,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1,
  "cached": false
}
```

`cached: true` ise Redis'ten döndü. `quote` yalnız checkIn+checkOut+guests verildiğinde hesaplanır (teklif motoru, vergi + promosyon dahil; `/api/quote` ile aynı toplam). Para alanları minor-unit'tir (v5, ADR 0033: ondalık `basePrice`/`totalPrice` kaldırıldı).

### 2.2 GET /api/properties — /api/search alias'ı

Public. `/api/search` ile aynı davranış (url query aynı). Katalog listeleme/ara sayfaları bu ucu da kullanabilir.

### 2.3 POST /api/properties — İlan Oluşturma (HOST/ADMIN)

Auth + rol HOST veya ADMIN.

```json
// Request
{
  "title": "Yeni Otel", "description": "Açıklama", "propertyType": "HOTEL",
  "city": "İstanbul", "country": "Türkiye",
  "basePrice": 2000, "currency": "TRY",
  "amenities": ["Ücretsiz WiFi", "Havuz"], "images": ["https://..."],
  "rooms": [ { "name": "Standart", "capacity": 2, "bedType": "Çift Kişilik Yatak", "priceModifier": 0 } ]
}
// 201
{ "id": "cuid", "title": "Yeni Otel", "propertyType": "HOTEL", "basePriceMinor": 200000, "isActive": true }
```

`city/country` için Location upsert yapılır. Amenity adları upsert edilir. Room oluşturulur; istekteki ondalık `basePrice`/`priceModifier` sunucuda minor-unit'e çevrilip `BigInt *Minor` olarak saklanır; yanıt yalnız `*Minor` döner.

### 2.4 GET /api/properties/:id — Detay

Public.

```json
// 200
{
  "id": "cuid", "title": "...", "description": "...", "propertyType": "HOTEL",
  "location": { "city": "İstanbul", "country": "Türkiye" },
  "basePriceMinor": 245000, "currency": "TRY", "ratingAvg": 8.9, "ratingCount": 1240,
  "amenities": [ { "name": "Ücretsiz WiFi", "icon": "wifi" } ],
  "images": ["https://..."],
  "rooms": [
    { "id": "cuid", "name": "Standart Oda", "description": null, "capacity": 2,
      "bedType": "Çift Kişilik Yatak", "priceModifierMinor": 0, "available": true }
  ]
}
// 404
{ "error": "Konaklama bulunamadı" }
```

Yalnız `isActive: true` mülk döner.

### 2.5 GET /api/locations — Konum önerileri

Public. `q` sorguyu (min 2 karakter) şehir veya ülke eşleşmesi ile yapar.

```json
// 200
[ { "city": "İstanbul", "country": "Türkiye" }, ... ]
```

### 3.1 POST /api/bookings — Rezervasyon Oluştur

Auth. Opsiyonel `Idempotency-Key: <uuid>` başlığı.

```json
{
  "propertyId": "cuid",
  "roomId": "cuid",
  "checkIn": "2026-10-01",
  "checkOut": "2026-10-04",
  "guestCount": 2
}
```

Zod: `checkIn/checkOut` ISO tarih, `guestCount` pozitif. Servis: checkOut>checkIn, geçmiş tarih yok, ≤30 gece; mülk aktif; oda uygun ve kapasite yeterli; tarih aralığındaki tüm geceler `isAvailable=true`.

```json
// 201 (yeni) | 200 (idempotent replay)
{
  "booking": {
    "id": "cuid",
    "propertyId": "cuid",
    "roomId": "cuid",
    "checkIn": "2026-10-01T00:00:00.000Z",
    "checkOut": "2026-10-04T00:00:00.000Z",
    "guestCount": 2,
    "totalMinor": 735000,
    "currency": "TRY",
    "status": "PENDING"
  },
  "paymentRequired": true
}
// 400 { "error": "checkOut must be after checkIn" } vb. (Türkçe mesajlar kullanılabilir)
// 409 { "error": "Oda şu anda başka bir misafir tarafından rezerve ediliyor" }
// 401 eksik/geçersiz token
```

İşlem: Redis kilidi → SERIALIZABLE tx + `FOR UPDATE` → Booking yarat → Availability `isAvailable=false` + `lockedBy` → arama cache invalidate → kilit serbest.

### 3.2 GET /api/bookings — Rezervasyon Listesi (kullanıcıya ait)

Auth.

```json
// 200
[
  {
    "id": "cuid",
    "checkIn": "...",
    "checkOut": "...",
    "guestCount": 2,
    "totalPriceMinor": 735000,
    "currency": "TRY",
    "status": "CONFIRMED",
    "property": { "id": "cuid", "title": "...", "location": { "city": "...", "country": "..." } },
    "room": { "name": "Standart Oda" }
  }
]
```

Sorgu: `listUserBookings(userId)` — `createdAt DESC`.

### 3.3 DELETE /api/bookings/:id — Rezervasyon İptal

Auth. `cancelBooking(id, userId)`.

```json
// 200
{ "success": true }
// 404 { "error": "Booking not found or cannot be cancelled" }
// 409 cancelable değilse
```

Yalnız durumu PENDING/CONFIRMED olan ve sahibine ait rezervasyon iptal edilebilir; availability geri açılır.

### 3.4 GET /api/bookings/:id — Detay

Auth. `getBooking(id, userId)` — var olmayan ya da başkasına ait kayıt 404/403.

## 4. Favoriler

### 4.1 GET /api/favorites — Listele

Auth (Bearer veya cookie). → `Prisma.favorite.findMany({ userId, include property+location })` `createdAt DESC`.

### 4.2 POST /api/favorites — Ekle

Auth. `{ "propertyId": "cuid" }` → upsert `userId+propertyId`, 201. Property yoksa 404, alan eksikse 400.

### 4.3 DELETE /api/favorites?propertyId=<id> — Çıkar

Auth. → `favorite.deleteMany({ userId, propertyId })`, 200 `{ "success": true }`. Eksik propertyId → 400.

## 5. Fiyatlandırma (Pricing)

### 5.1 POST /api/pricing — Tetikle

Auth (HOST/ADMIN tercihen). `{ "roomId": "...", "dates": ["2026-10-01","2026-10-02"], "basePrice": 2400, "currency": "TRY" }` → kuyruğa iş eklenir.

```json
// 202
{ "message": "Pricing update job queued successfully" }
```

### 5.2 GET /api/pricing — Bilgi

`{ "message": "Fiyat güncelleme için POST kullanın" }`.

## v3 Uç Noktaları (3.0.0)

Bu bölüm v3'te eklenen ve değişen uçları özetler. Hata gövdesi `src/lib/http/errors.ts` içindeki `toErrorResponse` biçimindedir: `{ error, code, details? }`. Aşağıdaki hatalar her uçta geçerlidir ve tablolarda tekrar edilmez:

- Zod hatası: **400 `VALIDATION_ERROR`** (`details` = `error.flatten()`)
- Geçersiz JSON: **400 `INVALID_JSON`**
- Serileştirme çakışması: **409 `TRANSACTION_CONFLICT`** (`Retry-After: 1`)
- Beklenmeyen hata: **500 `INTERNAL_ERROR`**

**Yetki gösterimi**

| Etiket     | Anlamı                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonim     | Uç, proxy'nin `PUBLIC_API` listesindedir ve route kimlik istemez.                                                                                                            |
| Oturum     | `requireAuth` oturum yoksa **401 `UNAUTHORIZED`** döner. `PUBLIC_API` listesinde olmayan uçlarda proxy de 401 `UNAUTHORIZED` döner.                                          |
| HOST/ADMIN | `requireRole` rol uymazsa **403 `FORBIDDEN`** döner. Başkasının mülkü veya odası **404 `NOT_FOUND`** alır (`assertPropertyAccess` / `assertRoomAccess`); varlık sızdırılmaz. |
| ADMIN      | `requireRole(req, ["ADMIN"])`; rol uymazsa **403 `FORBIDDEN`**.                                                                                                              |
| Bearer     | `Authorization: Bearer <access token>` başlığı zorunludur.                                                                                                                   |

Proxy (`src/proxy.ts`) tüm `/api` isteklerinde şu yanıtları da döndürebilir:

- **429 `RATE_LIMITED`** (`Retry-After` başlığıyla)
- **503 `RATE_LIMIT_UNAVAILABLE`** (Redis erişilemez)
- **403 `CSRF_REJECTED`** (Origin uyuşmazlığı; `/api/auth/*` için giriş-CSRF kontrolü de uygulanır)

`/api/mcp` ve `/api/agentic/*` `agentic` rate-limit kategorisindedir; Redis yoksa istek reddedilir (fail-closed).

### v3.1 Kimlik doğrulama ve hesap

Tüm `/api/auth/*` uçları proxy seviyesinde herkese açıktır. Oturum isteyen uçlar route içinde `requireAuth` çağırır.

| Uç                                        | Yetki  | İstek                                                            | Başarılı yanıt                                                                                             | Hatalar                                                                                                                                          |
| ----------------------------------------- | ------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/auth/passkey/login/options`    | Anonim | —                                                                | 200 `{ challengeId, options }`                                                                             | —                                                                                                                                                |
| `POST /api/auth/passkey/login/verify`     | Anonim | `{ challengeId: uuid, response: { id, ... } }` (WebAuthn yanıtı) | 200 `{ user: { id, role, email, firstName, lastName }, accessToken, accessExpiresAt }` ve oturum çerezleri | 400 `VALIDATION_ERROR` (passkey isteğinin süresi dolmuş); 401 `UNAUTHORIZED` (passkey tanınmadı, doğrulanamadı veya hesap geçici olarak kilitli) |
| `POST /api/auth/passkey/register/options` | Oturum | —                                                                | 200 WebAuthn kayıt (`create`) seçenekleri                                                                  | 401                                                                                                                                              |
| `POST /api/auth/passkey/register/verify`  | Oturum | `{ response, name?: string ≤60 }`                                | 201 `{ registered: true, credentialId }`                                                                   | 400 `VALIDATION_ERROR` (süresi dolmuş istek veya doğrulanamadı); 401                                                                             |
| `POST /api/auth/step-up/options`          | Oturum | —                                                                | 200 WebAuthn doğrulama seçenekleri (`userVerification: required`)                                          | 400 `VALIDATION_ERROR` (hesapta kayıtlı passkey yok); 401                                                                                        |
| `POST /api/auth/step-up/verify`           | Oturum | `{ response }`                                                   | 200 `{ validForSeconds }` (`STEP_UP_TTL_SECONDS`). İzin tek kullanımlıktır; ödeme ucu onu tüketir          | 401                                                                                                                                              |
| `POST /api/auth/password/forgot`          | Anonim | `{ email }` (≤254)                                               | **Her zaman** 202 `{ message }`; hesabın var olup olmadığı sızdırılmaz                                     | —                                                                                                                                                |
| `POST /api/auth/password/reset`           | Anonim | `{ token: 20–200, password }` (8–200 karakter, en az bir rakam)  | 200 `{ reset: true }`; oturum çerezleri silinir ve `tokenVersion` artırılır                                | 400 `VALIDATION_ERROR` ("Bağlantı geçersiz veya süresi dolmuş")                                                                                  |
| `POST /api/auth/verify-email`             | Anonim | `{ token: 20–200 }`                                              | 200 `{ verified: true }`                                                                                   | 400 `VALIDATION_ERROR` (geçersiz bağlantı)                                                                                                       |
| `POST /api/auth/verify-email/resend`      | Oturum | —                                                                | 202 `{ sent: true }`; e-posta zaten doğrulanmışsa 200 `{ alreadyVerified: true }`                          | 401                                                                                                                                              |
| `GET /api/account/passkeys`               | Oturum | —                                                                | 200 `{ passkeys: [{ id, name, createdAt, lastUsedAt }] }`                                                  | 401                                                                                                                                              |
| `DELETE /api/account/passkeys?id=`        | Oturum | `id` sorgu parametresi (≤1024)                                   | 200 `{ deleted: true }`                                                                                    | 400 `VALIDATION_ERROR` (id yok); 404 `NOT_FOUND` (passkey yok ya da başkasına ait)                                                               |
| `PUT /api/user/locale`                    | Oturum | `{ locale: "tr" \| "en" }`                                       | 200 `{ locale }`                                                                                           | 401                                                                                                                                              |

### v3.2 Rezervasyon: fatura ve mesajlaşma

Mesajlaşmaya yalnızca rezervasyonun misafiri (`GUEST`) ve ilanın ev sahibi (`HOST`) erişebilir. ADMIN dahil diğer herkes **404 `NOT_FOUND`** ("Rezervasyon bulunamadı") alır.

| Uç                                      | Yetki                                | İstek                                                     | Başarılı yanıt                                                                                                                                          | Hatalar                                                                                                                                                              |
| --------------------------------------- | ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/bookings/:id/invoice`         | Oturum (yalnızca rezervasyon sahibi) | —                                                         | 200 `application/pdf`; `content-disposition: inline; filename="<no>.pdf"`, `cache-control: private, no-store`                                           | 404 `NOT_FOUND` (rezervasyon yok ya da başkasına ait); 409 `NOT_INVOICEABLE` (durum `CONFIRMED` veya `COMPLETED` değil)                                              |
| `GET /api/bookings/:id/messages`        | Oturum (misafir veya ev sahibi)      | —                                                         | 200 `{ role: "GUEST" \| "HOST", canWrite, messages: MessageEvent[] }` (en fazla `MESSAGE_PAGE_SIZE` mesaj)                                              | 404 `NOT_FOUND`                                                                                                                                                      |
| `POST /api/bookings/:id/messages`       | Oturum (misafir veya ev sahibi)      | `{ body: string (trim, en az 1), fromAiDraft?: boolean }` | 201 `{ message: MessageEvent }`; gövde kaydedilmeden önce maskelenir                                                                                    | 400 `VALIDATION_ERROR` (`MESSAGE_MAX_LENGTH` aşıldı; `fromAiDraft` yalnızca HOST gönderebilir); 404; 409 `CONFLICT` (rezervasyon `CONFIRMED` veya `COMPLETED` değil) |
| `POST /api/bookings/:id/messages/draft` | Oturum (yalnızca ev sahibi)          | —                                                         | 200 `{ draft, llmMode }`; taslak kaydedilmez ve gönderilmez                                                                                             | 404 `NOT_FOUND` (ev sahibi olmayan herkes)                                                                                                                           |
| `GET /api/bookings/:id/messages/stream` | Oturum (misafir veya ev sahibi)      | —                                                         | 200 `text/event-stream`: bağlanınca `: connected`, yeni mesajda `event: message` + `data: MessageEvent`, `MESSAGE_SSE_HEARTBEAT_MS` aralığıyla `: ping` | 401; 404; 429 `TOO_MANY_STREAMS` (IP başına bağlantı sınırı)                                                                                                         |

`MessageEvent`: `{ id, senderId, senderRole, body, maskedKinds: string[], fromAiDraft, createdAt }`.

### v3.3 Ajan kanalı: checkout oturumları ve MCP

Akış ACP benzeridir (ADR 0015, `src/lib/agentic/checkout.ts`). Tüm uçlar oturum ister ve proxy'de herkese açık değildir.

- Üç `POST` ucunda **`Idempotency-Key` başlığı zorunludur**; yoksa 400 `VALIDATION_ERROR`. Değer 128 karakterde kesilir.
- Oturumu yalnızca sahibi görür; başkası 404 `NOT_FOUND` ("Checkout oturumu bulunamadı") alır.
- Gövdeler `.strict()` şemadır; bilinmeyen alan 400 döner.
- Oturumun ömrü `CHECKOUT_SESSION_TTL_MINUTES` ile belirlenir.

| Uç                                                 | İstek                                                                                                                        | Başarılı yanıt                                                                                                                                                       | Hatalar                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/agentic/checkout_sessions`              | `{ room_id: 1–64, check_in: YYYY-MM-DD, check_out: YYYY-MM-DD, guests: 1–20 }`                                               | Yeni oturumda 201 `CheckoutSession`; aynı anahtar ve aynı gövdeyle tekrarda 200. Durum `ready_for_payment`                                                           | 409 `IDEMPOTENCY_KEY_REUSED` (aynı anahtar, farklı gövde); teklif hataları: 400, 404 `NOT_FOUND`, 409 `SOLD_OUT` / `RESTRICTED`                                                                                                                                           |
| `GET /api/agentic/checkout_sessions/:id`           | —                                                                                                                            | 200 `CheckoutSession`                                                                                                                                                | 404 `NOT_FOUND`                                                                                                                                                                                                                                                           |
| `POST /api/agentic/checkout_sessions/:id`          | Oluşturma alanlarının hepsi opsiyonel; fiyat yeniden hesaplanır                                                              | 200 `CheckoutSession`                                                                                                                                                | 404; 409 `CHECKOUT_NOT_MODIFIABLE` (durum `ready_for_payment` değil); teklif hataları                                                                                                                                                                                     |
| `POST /api/agentic/checkout_sessions/:id/complete` | `{ payment_data: { token: 1–200, provider: "mock" } }`; `token` `spt_mock_ok`, `spt_mock_decline` veya `spt_mock_3ds` olmalı | Tamamlanınca 200. 3DS gerekiyorsa 202, `next_action: { type: "three_ds", challenge }` ve `messages` içinde `code: "REQUIRES_ACTION"`. Tamamlanmış oturum aynen döner | 400 `VALIDATION_ERROR` (tanınmayan token); 404; 402 `PAYMENT_DECLINED`; 403 `STEP_UP_REQUIRED` / `FRAUD_BLOCKED`; 409 `CHECKOUT_CANCELED`, `PRICE_CHANGED` (`details.session`), `PAYMENT_IN_PROGRESS`, `ALREADY_PAID`, rezervasyon hataları (`SOLD_OUT`, `ROOM_BUSY` vb.) |

`CheckoutSession` alanları:

```text
{
  id,
  status: "ready_for_payment" | "in_progress" | "completed" | "canceled",
  currency,
  stay: { property_id, room_id, check_in, check_out, guests },
  line_items: [{ id, quantity, base_amount, tax, total }],
  totals: [{ type: "subtotal" | "fees" | "tax" | "total", amount }],
  payment_provider: { provider: "mock", supported_payment_methods: ["card"] },
  order: { id } | null,
  expires_at,
  messages: [...],
  next_action?
}
```

Tamamlama, web checkout'uyla aynı akıştan geçer: `createQuote` → `createBooking` (HELD) → `payForBooking`.

**`POST /api/mcp`**: MCP streamable HTTP ucu. Durumsuzdur ve JSON yanıt döner.

- Yetki: **Bearer** zorunludur. Token yoksa veya geçersizse 401 döner ve gövde JSON-RPC biçimindedir: `{ jsonrpc: "2.0", error: { code: -32001, message }, id: null }`. Yanıtta `WWW-Authenticate: Bearer realm="booking-mcp"` başlığı bulunur. Mesaj "Bearer token gerekli" ya da "Geçersiz veya süresi dolmuş token" olur.
- `GET` ve `DELETE` isteklerine 405, `Allow: POST` başlığı ve JSON-RPC hata kodu `-32000` döner.
- Araçlar: `search_stays`, `get_quote`, `create_hold`, `get_price_insight`, `list_my_bookings`, `cancel_booking`.

### v3.4 Fiyat içgörüsü ve alarmlar

| Uç                             | Yetki                                                                   | İstek                                                         | Başarılı yanıt                                                                                                                                         | Hatalar                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/price-insight`       | Oturum (proxy ister; `PUBLIC_API`'de değil, route ayrıca kontrol etmez) | Sorgu: `roomId`, `checkIn`, `checkOut`                        | 200 `{ currency, nightlyMinor, predictedMinor, level, interval: { low, high } \| null, label: "low" \| "typical" \| "high" \| null, calibrationSize }` | 400 `VALIDATION_ERROR` (geçersiz tarih aralığı veya gece yok); 404 `NOT_FOUND` ("Oda bulunamadı" veya "Seçilen geceler için fiyat yok") |
| `GET /api/price-alerts`        | Oturum                                                                  | —                                                             | 200 `{ alerts: PriceAlert[] }`                                                                                                                         | 401                                                                                                                                     |
| `POST /api/price-alerts`       | Oturum                                                                  | `{ roomId, checkIn, checkOut, guests?: 1–20 }` (varsayılan 1) | 201 `PriceAlert`; aynı konaklama için tekrar gönderilirse mevcut alarm güncellenir                                                                     | 409 `PRICE_ALERT_LIMIT`; teklif hataları (400, 404, 409 `SOLD_OUT` / `RESTRICTED`)                                                      |
| `DELETE /api/price-alerts?id=` | Oturum                                                                  | `id` sorgu parametresi (≤64)                                  | 200 `{ deleted: true }`                                                                                                                                | 400 `VALIDATION_ERROR` (id yok); 404 `NOT_FOUND` ("Fiyat alarmı bulunamadı")                                                            |

`PriceAlert`: `{ id, roomId, checkIn, checkOut, guests, currency, lastTotalMinor, previousPriceMinor: number | null, active }`.

### v3.5 Ev sahibi: gelir yönetimi, takvim ve kanal

Bu tablodaki tüm uçlar HOST/ADMIN rolü ve mülk ya da oda sahipliği ister.

| Uç                                                        | İstek                                                                                      | Başarılı yanıt                                                                                                                                                                                                                                        | Hatalar                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/host/revenue?propertyId=`                       | Sorgu: `propertyId`                                                                        | 200 `{ property: { id, title, currency }, rooms: [{ id, name }], kpis: { currency, from, to, availableRoomNights, soldRoomNights, revenueMinor, occupancy, adrMinor, revparMinor }, pickup: [{ date, pickup, onBooks }], suggestions: Suggestion[] }` | 403; 404 `NOT_FOUND`                                                                                                             |
| `POST /api/host/revenue/suggestions`                      | `{ roomId }`                                                                               | 201 `{ suggestions: Suggestion[] }`; fiyatlar **değişmez**                                                                                                                                                                                            | 403; 404 `NOT_FOUND`                                                                                                             |
| `POST /api/host/revenue/suggestions/:id/accept`           | —                                                                                          | 200 `Suggestion`; gece fiyatı yazılır ve sabitlenir                                                                                                                                                                                                   | 403; 404 `NOT_FOUND` ("Öneri bulunamadı" veya "Gece envanteri bulunamadı"); 409 `INVALID_STATE` ("Öneri zaten karara bağlanmış") |
| `POST /api/host/revenue/suggestions/:id/reject`           | —                                                                                          | 200 `Suggestion`; hiçbir fiyat değişmez                                                                                                                                                                                                               | 403; 404; 409 `INVALID_STATE`                                                                                                    |
| `GET /api/rooms/:roomId/calendar/subscriptions`           | —                                                                                          | 200 `{ subscriptions: IcalSubscription[] }`                                                                                                                                                                                                           | 401; 403; 404 ("Oda bulunamadı")                                                                                                 |
| `POST /api/rooms/:roomId/calendar/subscriptions`          | `{ source: ^[a-z0-9-]{2,40}$, url: https URL (≤2048) }`                                    | 201 abonelik kaydı (kaynak başına upsert)                                                                                                                                                                                                             | 400 `VALIDATION_ERROR` (SSRF kontrolünden geçmeyen URL); 403; 404                                                                |
| `DELETE /api/rooms/:roomId/calendar/subscriptions/:subId` | —                                                                                          | 204 (gövde yok)                                                                                                                                                                                                                                       | 403; 404 `NOT_FOUND` ("Abonelik bulunamadı")                                                                                     |
| `GET /api/rooms/:roomId/calendar/token`                   | —                                                                                          | 200 `{ path: "/api/rooms/<id>/calendar.ics?token=…" }`                                                                                                                                                                                                | 401; 403; 404                                                                                                                    |
| `POST /api/rooms/:roomId/calendar/token`                  | —                                                                                          | 200 `{ path, version }`; token yenilenir ve eski akış URL'leri 403 alır                                                                                                                                                                               | 403; 404                                                                                                                         |
| `POST /api/rooms/:roomId/channel/parity`                  | `{ channel: 2–40 karakter, rates: [{ date: YYYY-MM-DD, price: "123.45" }] }` (1–366 satır) | 200 `{ channel, currency, enforced: false, warnings: [{ date, ours, theirs, diffBps, direction: "cheaper_elsewhere" \| "pricier_elsewhere" }] }`. Yalnızca uyarı üretir, fiyat değiştirmez; tolerans `CHANNEL_PARITY_TOLERANCE_BPS`                   | 403; 404                                                                                                                         |

`Suggestion`: `{ id, roomId, roomName, date, currency, currentMinor, suggestedMinor, floorMinor, ceilingMinor, contributions, explanation, llmMode, status }`.

`/api/rooms/*` altındaki GET istekleri proxy'de herkese açıktır. Yukarıdaki GET uçları anonim çağrıda route'taki `requireRole` nedeniyle 401 `UNAUTHORIZED` döner.

### v3.6 Yorum moderasyonu, deneyler ve ödeme yapılandırması

| Uç                             | Yetki                                       | İstek                                                                              | Başarılı yanıt                                                                                                                                                                                                                                                             | Hatalar                                                                                             |
| ------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /api/reviews/:id/report` | Oturum                                      | `{ reason: "SPAM" \| "OFFENSIVE" \| "FAKE" \| "PRIVACY" \| "OTHER", note?: ≤500 }` | 201 `{ reportCount, hidden }`; şikâyet sayısı `REVIEW_REPORT_HIDE_THRESHOLD` eşiğine ulaşınca yorum `HIDDEN` olur                                                                                                                                                          | 403 `FORBIDDEN` (kendi yorumu); 404 `NOT_FOUND` (yorum yok veya yayında değil); 409 `REPORT_EXISTS` |
| `GET /api/admin/reviews`       | ADMIN                                       | —                                                                                  | 200 `[{ id, propertyId, propertyTitle, rating, comment, status, reportCount, reasons: [{ code, detail }], explanation, createdAt }]`; `PENDING_REVIEW` veya `HIDDEN` durumunda en fazla 50 yorum. İlk 10 kaydın `explanation` metni LLM'den, kalanlarınki deterministiktir | 401; 403                                                                                            |
| `POST /api/admin/reviews`      | ADMIN                                       | `{ id: ≤64, action: "publish" \| "remove" }`                                       | 200 `{ ok: true }`; `review.<action>` audit kaydı yazılır                                                                                                                                                                                                                  | 403; 404 `NOT_FOUND` ("Kuyrukta böyle bir yorum yok")                                               |
| `GET /api/admin/experiments`   | ADMIN                                       | —                                                                                  | 200 `[{ flagKey, enabled, variants: [{ variant, exposures, users, conversions, rate, ci: { low, high } }] }]` (%95 Wilson aralığı)                                                                                                                                         | 401; 403                                                                                            |
| `GET /api/payments/config`     | Oturum (proxy ister; `PUBLIC_API`'de değil) | —                                                                                  | 200 `{ provider: "stripe" \| "mock", publishableKey: string \| null }`                                                                                                                                                                                                     | Proxy'den 401                                                                                       |

### v3.7 Değişen uç noktalar

| Uç                                         | v3 değişikliği                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/quote`                           | Yeni sorgu alanları: `ratePlanId`, `units` (1–10), `currency` (3 harf; izin verilmeyen para birimi 400). `Quote` yanıtına şu alanlar eklendi: `ratePlan { id, code, name, mealPlan, refundable, priceModifierBps }`, `units`, `fees[]` / `taxes[]` satırları (`inclusive` bayrağıyla), `fxSnapshotId`, `charge { currency, total }`.                                                                                                                                                                                                                |
| `POST /api/bookings/:id/pay`               | `Idempotency-Key` başlığı zorunludur. Gövdeye opsiyonel `cardBin` (6 hane) ve `deviceId` (`^[a-z0-9]{8,64}$`) eklendi. Yanıt 200 `{ status: "confirmed", bookingId, paymentId, amount, currency }` ya da 202 `{ status: "requires_action", bookingId, challenge }`. Yeni hatalar: rezervasyon başına Redis kilidi alınamazsa **409 `PAYMENT_IN_PROGRESS`**; ödeme başka yoldan alınmışsa 409 `ALREADY_PAID`; riskli ödemede **403 `STEP_UP_REQUIRED`** (`details.score`). Step-up `/api/auth/step-up/*` ile tamamlandıktan sonra istek tekrarlanır. |
| `POST /api/payments/webhook`               | `Stripe-Signature` başlığı varsa Stripe olayı doğrulanır; yoksa mock PSP HMAC imzası (`x-psp-signature`) kullanılır. Geçersiz imza 400 `INVALID_SIGNATURE` döner. İşlenmeyen olay türünde 200 `{ received: true, ignored: true }`, diğer durumlarda 200 `{ received: true, duplicate }` döner.                                                                                                                                                                                                                                                      |
| `GET /api/search`                          | Parametreler `SearchParamsSchema` (zod) ile doğrulanır. Geçersiz giriş artık **400 `VALIDATION_ERROR`** döner (v2'de NaN 500 hatasına yol açıyordu). Sınırlar: `guests` 1–30, `page` 1–1000; `pageSize` üst sınırı aşarsa reddedilmez, kırpılır. `currency` bir enum'dur. `checkIn` ve `checkOut` birlikte verilmelidir. "recommended" sıralamada `search-ranking` deneyi uygulanır ve `exp_sid` çerezi yazılabilir.                                                                                                                                |
| `/api/negotiate`                           | **Kaldırıldı** (ADR 0016). Yerine fiyat planları (`ratePlanId`) kullanılır.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /api/properties/:id`                  | Odalar artık `maxOccupancy`, `units` ve aktif `ratePlans[]` (`id, code, name, mealPlan, refundable, priceModifierBps, isDefault`) döner. Geriye uyumluluk için `capacity` da eklenir.                                                                                                                                                                                                                                                                                                                                                               |
| `POST` / `PATCH /api/properties/:id/rooms` | Girdi `roomSchema` / `roomPatchSchema` ile doğrulanır (`units` eklendi). Yanıt `withCapacityAlias` ile `capacity` alanını içerir.                                                                                                                                                                                                                                                                                                                                                                                                                   |

#### Geriye uyumluluk: `capacity` → `maxOccupancy`

v3'te oda kapasitesinin adı `maxOccupancy` oldu (ADR 0010). v2 istemcileri bozulmasın diye `capacity` adı **bir sürüm boyunca** korunur.

- **Okuma:** `GET /api/properties/:id` her odada `capacity` alanını `maxOccupancy` ile aynı değerle döner. `POST` ve `PATCH /api/properties/:id/rooms` yanıtları `withCapacityAlias` ile aynı alanı ekler.
- **Yazma:** `src/lib/host/host-service.ts` içindeki iki şema `capacity` alanını kabul eder ve `maxOccupancy` olarak kaydeder:
  - `roomSchema`: oda ekleme ve `POST /api/properties` içindeki `rooms[]` (en fazla 50). `maxOccupancy` ya da `capacity` (tam sayı, 1–20) verilmelidir; ikisi de yoksa 400 ("maxOccupancy (veya capacity) gerekli"). `units` 1–500, varsayılan 1.
  - `roomPatchSchema`: iki alanı da kabul eder; `units` 0–500.
- Yeni istemciler yalnızca `maxOccupancy` kullanmalıdır. `capacity` bir sonraki sürümde kaldırılacaktır.

## v4 Uç Noktaları

Bu bölüm v4'te eklenen ve değişen uçları özetler; route listesi `src/app/api/**/route.ts` ve `src/app/.well-known/ucp/route.ts` dosyalarından çıkarılmıştır. v3 bölümündeki ortak hatalar (400 `VALIDATION_ERROR`, 400 `INVALID_JSON`, 409 `TRANSACTION_CONFLICT`, 500 `INTERNAL_ERROR`) ve proxy yanıtları (429 `RATE_LIMITED`, 503 `RATE_LIMIT_UNAVAILABLE`, 403 `CSRF_REJECTED`) burada da geçerlidir. Tutarlar minor-unit tamsayıdır (`*Minor`, [ADR 0019](adr/0019-minor-unit-bigint-money.md)); eski ondalık alanlar geriye uyum için bazı yanıtlarda hâlâ bulunur.

**v4 yetki etiketleri** (v3 tablosuna ek)

| Etiket       | Anlamı                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doğrulanmış  | `requireVerifiedEmail`: oturum + doğrulanmış e-posta; aksi **403 `EMAIL_NOT_VERIFIED`** (v4#6)                                                                                                                                                                |
| Recent-auth  | `requireRecentAuth` / `assertRecentAuth`: son parola/passkey doğrulaması `RECENT_AUTH_MAX_AGE_SECONDS` (300) içinde; aksi **403 `REAUTH_REQUIRED`** (`details.maxAgeSeconds`) → `POST /api/auth/reauth` ([ADR 0024](adr/0024-recent-auth-step-up-binding.md)) |
| Sahiplik 404 | Başkasının sepeti, payı, talebi, mandate'i, abonelik uç noktası vb. **404** alır; varlık sızdırılmaz                                                                                                                                                          |

### v4.1 Hesap, oturumlar ve yeniden doğrulama

| Uç                                                                  | Yetki                        | İstek                                                                              | Başarılı yanıt                                                                                           | Hatalar                                                                                           |
| ------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /api/auth/reauth/options`                                     | Oturum                       | —                                                                                  | 200 WebAuthn `get()` seçenekleri                                                                         | 401                                                                                               |
| `POST /api/auth/reauth`                                             | Oturum                       | `{ method: "password", password }` \| `{ method: "passkey", response }`            | 200; eski refresh ailesi + erişim `jti`'si iptal, taze `auth_time`'lı oturum çerezleri ve `accessToken`  | 401; 429 `REAUTH_RATE_LIMITED` (`REAUTH_MAX_ATTEMPTS` / `REAUTH_WINDOW_SECONDS`)                  |
| `POST /api/auth/step-up/options`                                    | Oturum                       | `{ bookingId }` (tutar sunucuda hesaplanır)                                        | 200 WebAuthn seçenekleri; 24 saatten yeni passkey'ler hariç                                              | 400; 401; 404                                                                                     |
| `POST /api/auth/step-up/verify`                                     | Oturum                       | `{ response }`                                                                     | 200 `{ stepUpToken, bookingId, validForSeconds }` — rezervasyon + tutar + nonce'a bağlı, tek kullanımlık | 401                                                                                               |
| `GET /api/account/sessions`                                         | Oturum                       | —                                                                                  | 200 `{ sessions: [{ id, current, device, ipHint, createdAt, lastSeenAt }] }` (en çok 50 aktif oturum)    | 401                                                                                               |
| `DELETE /api/account/sessions?id=`                                  | Recent-auth                  | `id` \| `scope=others`                                                             | 200 `{ revoked: 1, current }` \| `{ revoked: n }`                                                        | 401; 403 `REAUTH_REQUIRED`; 404                                                                   |
| `DELETE /api/account`                                               | Recent-auth (v4 değişikliği) | —                                                                                  | v3 ile aynı                                                                                              | 403 `REAUTH_REQUIRED`                                                                             |
| `POST /api/auth/passkey/register/*`, `DELETE /api/account/passkeys` | Recent-auth (v4 değişikliği) | v3 ile aynı                                                                        | v3 ile aynı; kayıtta `auth.security_alert` e-postası                                                     | 403 `REAUTH_REQUIRED`                                                                             |
| `GET /api/account/identity`                                         | Oturum                       | —                                                                                  | 200 KYC durumu (`PENDING` \| `VERIFIED` \| `REQUIRES_INPUT` \| `FAILED` \| yok)                          | 401                                                                                               |
| `POST /api/account/identity`                                        | Doğrulanmış                  | Mock sağlayıcıda test belgesi seçimi                                               | 201 doğrulama oturumu                                                                                    | 409 `ALREADY_VERIFIED`; 429 `KYC_RATE_LIMITED`                                                    |
| `POST /api/trust/kyc/webhook`                                       | Anonim (imzalı)              | Aktif KYC sağlayıcısının olayı (`x-kyc-signature` / `Stripe-Signature`)            | 200 `{ received: true, ... }`                                                                            | 400 `INVALID_SIGNATURE`; 401 `WRONG_PROVIDER_SIGNATURE`                                           |
| `GET /api/account/wallet`                                           | Oturum                       | —                                                                                  | 200 seviye, cashback ve kredi lot'ları                                                                   | 401                                                                                               |
| `GET /api/account/agent-mandates`                                   | Oturum                       | —                                                                                  | 200 `{ mandates: [{ nonce, status: active\|expired\|revoked, used, ... }] }`                             | 401                                                                                               |
| `POST /api/account/agent-mandates`                                  | Doğrulanmış + Recent-auth    | `{ maxAmountMinor, currency, expiresInMinutes?, propertyIds?: string[] }` (strict) | 201 `{ mandate: <JWS>, claims }` — belge yalnız bir kez döner                                            | 400 (süre `AGENT_MANDATE_MAX_TTL_MINUTES`'i aşarsa); 403 `REAUTH_REQUIRED` / `EMAIL_NOT_VERIFIED` |
| `DELETE /api/account/agent-mandates/:nonce`                         | Oturum                       | —                                                                                  | 200 (idempotent)                                                                                         | 404 (başkasının mandate'i)                                                                        |

### v4.2 Grup sepeti ve bölünmüş ödeme

Sepet uçları `booking`, pay uçları `payment` rate-limit kategorisindedir. Sepet para birimi ilk kalemden gelir.

| Uç                                                | Yetki       | İstek                                                                                                                                           | Başarılı yanıt                                                                       | Hatalar                                                                                                                                                                                 |
| ------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/cart`                                   | Oturum      | —                                                                                                                                               | 200 `{ cart \| null }`                                                               | 401                                                                                                                                                                                     |
| `POST /api/cart/items`                            | Oturum      | `{ propertyId, roomTypeId, ratePlanId?, checkIn, checkOut, adults, children?, quantity?, currency? }`                                           | 201 `{ cart }` (sepet yoksa açılır)                                                  | 409 `CART_CURRENCY_MISMATCH`, `CART_LOCKED` (HELD sepet), `CART_NOT_OPEN`; teklif hataları (`SOLD_OUT`, `RESTRICTED`)                                                                   |
| `PATCH` / `DELETE /api/cart/items/:itemId`        | Oturum      | Kalem alanları (en az biri)                                                                                                                     | 200 `{ cart }`                                                                       | 404; 409 `CART_LOCKED`                                                                                                                                                                  |
| `GET` / `DELETE /api/cart/:id`                    | Oturum      | —                                                                                                                                               | 200 `{ cart }` / `{ cancelled: true }`                                               | 404                                                                                                                                                                                     |
| `POST /api/cart/:id/hold`                         | Doğrulanmış | `Idempotency-Key` (opsiyonel)                                                                                                                   | 200 `{ cart }` — tüm kalemler `HELD` (tümü-ya-hiç)                                   | 409 `PRICE_CHANGED` (kalem görüntüleri güncellenir), `SOLD_OUT` / `ROOM_BUSY` (`details.itemId`), `CART_NOT_OPEN`                                                                       |
| `POST /api/cart/:id/release`                      | Oturum      | —                                                                                                                                               | 200 `{ cart }` (tutmalar serbest, sepet `OPEN`; aktif bölünmüş plan iptal)           | 404                                                                                                                                                                                     |
| `POST /api/cart/:id/pay`                          | Doğrulanmış | `{ cardToken }`                                                                                                                                 | 200 `confirmed` \| 202 `requires_action` (3DS)                                       | 402 `PAYMENT_DECLINED`; 403 `FRAUD_BLOCKED`; 409 `CART_NOT_HELD`, `HOLD_EXPIRED`, `SPLIT_ACTIVE`, `CART_AMOUNT_MISMATCH`; 429 `PAYMENT_ATTEMPTS_EXCEEDED`; 502 `PAYMENT_PROVIDER_ERROR` |
| `POST /api/cart/:id/pay/confirm`                  | Doğrulanmış | `{ code? }` (3DS kodu)                                                                                                                          | 200 `confirmed`                                                                      | 409 `NO_PENDING_CHALLENGE`, `CHALLENGE_FAILED`                                                                                                                                          |
| `POST /api/cart/reopen`                           | Oturum      | —                                                                                                                                               | 200 `{ cart }` (süresi dolan sepetin kalemleri yeni sepete)                          | 404                                                                                                                                                                                     |
| `GET /api/cart/:id/split`                         | Oturum      | —                                                                                                                                               | 200 `{ plan: SplitPlan \| null }` (organizatöre `inviteUrl`'ler)                     | 404                                                                                                                                                                                     |
| `POST /api/cart/:id/split`                        | Doğrulanmış | `{ mode: "equal", participants: [{ email? }] }` \| `{ mode: "custom", participants: [{ email?, amountMinor }] }` (1–19 katılımcı + organizatör) | 201 `{ plan }`                                                                       | 400 `SPLIT_AMOUNT_INVALID`, `SPLIT_SHARE_COUNT`, `SPLIT_DUPLICATE_EMAIL`; 409 `SPLIT_EXISTS`, `SPLIT_AMOUNT_MISMATCH`, `CART_NOT_HELD`, `CART_PAYMENT_IN_PROGRESS`                      |
| `POST /api/cart/:id/split/shares/:shareId/invite` | Doğrulanmış | `{ email? }`                                                                                                                                    | 200 `{ plan }` (davet e-postası outbox'tan; e-posta değişirse eski link geçersiz)    | 400 `SHARE_EMAIL_REQUIRED`; 409 `SHARE_NOT_INVITABLE`, `SPLIT_CLOSED`                                                                                                                   |
| `GET /api/pay/share/:token`                       | Oturum      | —                                                                                                                                               | 200 `{ share }` (tutar, sepet özeti, durum)                                          | 403 `SHARE_EMAIL_MISMATCH`; 404 `SHARE_LINK_INVALID`; 410 `SHARE_LINK_EXPIRED`; 503 `SPLIT_PAY_UNAVAILABLE`                                                                             |
| `POST /api/pay/share/:token`                      | Doğrulanmış | `{ cardToken }`                                                                                                                                 | 200 \| 202 `requires_action`; yalnız yetkilendirme, son pay tüm payları capture eder | 403 `SHARE_EMAIL_MISMATCH`; 404; 409 `SHARE_ALREADY_PAID`, `SPLIT_DEADLINE_PASSED`, `SPLIT_CLOSED`; 410; 502 `PAYMENT_PROVIDER_ERROR`                                                   |
| `POST /api/pay/share/:token/confirm`              | Doğrulanmış | `{ code? }`                                                                                                                                     | 200                                                                                  | 409 `NO_PENDING_CHALLENGE`                                                                                                                                                              |

Sepet kalemi olan rezervasyon `POST /api/bookings/:id/pay` ile ödenemez: **409 `CART_BOOKING`**.

### v4.3 Arama, fiyat, karşılaştırma ve içerik

| Uç                                               | Yetki       | İstek                                                                                                                  | Başarılı yanıt                                                                                                                                                     | Hatalar                                                                                                                                                                               |
| ------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/properties/:id/calendar-prices`        | Anonim      | `month=YYYY-MM`, `taxes=included\|excluded`                                                                            | 200 ay ızgarası: gün başına `priceMinor`, `cheapest`, `band` (0–4), `minStay`, `closedToArrival`, `past`                                                           | 400; 404 (ilan yok / listelenemez)                                                                                                                                                    |
| `GET /api/search` (v4 ekleri)                    | Anonim      | `flexDays` (0–7, `SEARCH_FLEX_MAX_DAYS`'e kırpılır), `similarToPhotoId`, `accessibility=CODE,CODE`                     | Sonuçta `flexSuggestion`, `coverPhotoId`; yanıtta `flex`, `visual { enabled, applied, reason, message }`                                                           | 400 (bilinmeyen erişilebilirlik kodu)                                                                                                                                                 |
| `GET /api/quote` (v4 ekleri)                     | Anonim      | `couponCode`                                                                                                           | `discounts[]`, `discountTotal`, `promotionDecisions`, `coupon`, `lowestPrice30dMinor`, `omnibusDays`, `channel`                                                    | —                                                                                                                                                                                     |
| `GET /api/compare`                               | Anonim      | `ids=a,b[,c,d]` (`COMPARE_MIN_LISTINGS`–`COMPARE_MAX_LISTINGS`), `checkIn`, `checkOut`, `guests`, `currency`, `locale` | 200 karşılaştırma tablosu (toplamlar `createQuote`'tan) + LLM yorumu, `ai_generated: true`; `ai` rate-limit kategorisi                                             | 400                                                                                                                                                                                   |
| `GET /api/properties/:id/review-highlights`      | Anonim      | `locale`                                                                                                               | 200 `{ locale, reviewCount, clusters: [{ title, mentionCount, claims: [{ text, quote, reviewId, start, end }] }], rejectedClaims, llmMode }`, `ai_generated: true` | 404                                                                                                                                                                                   |
| `POST /api/coupons/validate`                     | Oturum      | Kupon + konaklama                                                                                                      | 200 kupon durumu (`APPLIED` \| `NOT_FOUND` \| gerekçe); kullanımı saymaz                                                                                           | 401                                                                                                                                                                                   |
| `GET /api/photos/:id`                            | Anonim      | —                                                                                                                      | 200 `image/webp` (yalnız aktif ilanın fotoğrafı)                                                                                                                   | 404                                                                                                                                                                                   |
| `GET /api/itinerary`                             | Oturum      | —                                                                                                                      | 200 kullanıcının gelecek `CONFIRMED` konaklamaları (en çok 20) + imzalı `BK1.` kodu ve QR; tutar yok                                                               | 401                                                                                                                                                                                   |
| `GET` / `POST` / `DELETE /api/push/subscription` | Oturum      | POST: `{ endpoint, keys: { p256dh, auth }, locale?, expirationTime? }`; DELETE: `{ endpoint }`                         | GET `{ enabled, reason? }`; POST 201; DELETE 204                                                                                                                   | 400 `PUSH_ENDPOINT_NOT_ALLOWED`; 404 (başkasının uç noktası); 503 `PUSH_DISABLED` (VAPID yok)                                                                                         |
| `POST /api/bookings` (v4 değişikliği)            | Doğrulanmış | `couponCode?`; `Idempotency-Key` gövdeye bağlı                                                                         | v3 ile aynı                                                                                                                                                        | 403 `EMAIL_NOT_VERIFIED`, `IDENTITY_VERIFICATION_REQUIRED` (`KYC_REQUIRED_FOR_GUESTS`); 409 `IDEMPOTENCY_KEY_REUSED`, `COUPON_EXHAUSTED`, `COUPON_NOT_APPLICABLE`                     |
| `GET /api/bookings` (v4 değişikliği)             | Oturum      | `limit`, `cursor`                                                                                                      | 200 dizi; sonraki sayfa `X-Next-Cursor` + `Link: <…>; rel="next"`                                                                                                  | 400                                                                                                                                                                                   |
| `POST /api/bookings/:id/pay` (v4 değişikliği)    | Doğrulanmış | `{ cardToken, stepUpToken?, creditMinor? }` (`cardBin`/`deviceId` artık yok sayılır)                                   | v3 ile aynı                                                                                                                                                        | 409 `CART_BOOKING`, `CREDIT_EXCEEDS_LIMIT`, `INSUFFICIENT_CREDIT`, `PAYMENT_AMOUNT_MISMATCH`; 422 `INVALID_CARD_TOKEN`; 429 `PAYMENT_ATTEMPTS_EXCEEDED`; 502 `PAYMENT_PROVIDER_ERROR` |
| `GET /api/bookings/:id/credit`                   | Oturum      | —                                                                                                                      | 200 kullanılabilir kredi (`maxUsableMinor`; sepet rezervasyonunda 0)                                                                                               | 404                                                                                                                                                                                   |

### v4.4 Ev sahibi: promosyon, fotoğraf, erişilebilirlik, depozito, payout, güven

Tüm uçlar HOST/ADMIN rolü ve mülk sahipliği ister (başkasının mülkü 404).

| Uç                                                    | İstek                                                            | Başarılı yanıt                                                            | Hatalar                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET` / `POST /api/host/promotions`                   | Promosyon kuralı (`src/lib/pricing/promotion-service.ts` şeması) | 200 `{ promotions }` / 201 `{ promotion }`                                | 409 `COUPON_CODE_TAKEN`, `PROMOTION_LIMIT`                        |
| `PATCH` / `DELETE /api/host/promotions/:id`           | Kısmi alanlar                                                    | 200 `{ promotion }` / kullanılmış promosyon silinmez, pasifleşir          | 404                                                               |
| `GET` / `POST /api/host/properties/:id/photos`        | POST `multipart/form-data` `file`                                | 200 `{ photos, visual }` / 201 fotoğraf + kalite skoru + duplikat bilgisi | 400 (tür/boyut/kenar sınırı)                                      |
| `DELETE /api/host/properties/:id/photos/:photoId`     | —                                                                | 200 `{ ok: true }`                                                        | 404                                                               |
| `GET` / `POST /api/host/properties/:id/accessibility` | Özellik kodu, oda tipi?, `widthCm?`, `evidencePhotoId?`          | 200 `{ features }` / 201 `{ feature }`                                    | 400 (kanıt başka ilanın); 404; 409 `ACCESSIBILITY_FEATURE_EXISTS` |
| `PATCH` / `DELETE …/accessibility/:featureId`         | Kısmi alanlar (değişiklik doğrulamayı düşürür)                   | 200 `{ feature }` / `{ ok: true }`                                        | 404                                                               |
| `GET` / `PUT /api/host/properties/:id/deposit`        | PUT `{ amountMinor \| null, roomTypeId? }`                       | 200 ayarlar / `{ setting }`                                               | 400 (`DEPOSIT_MAX_MINOR`); 404                                    |
| `GET` / `POST /api/host/payouts`                      | POST: onboarding / takvim                                        | 200 özet: emanette, serbest, rezerv, ödenen, geçmiş, `blockedReason`      | 403                                                               |
| `GET /api/host/trust/party-risk`                      | —                                                                | 200 `{ items }` (skor + gerekçe kodları; yalnız uyarı)                    | 403                                                               |
| `PATCH /api/properties/:id` (v4 değişikliği)          | `isActive: true`                                                 | v3 ile aynı                                                               | 409 `TAKEDOWN_ACTIVE`, `DSA_RESTRICTION_ACTIVE`                   |

### v4.5 Çözüm merkezi (depozito, talepler)

| Uç                                         | Yetki                             | İstek                                                                                      | Başarılı yanıt                                   | Hatalar                                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/claims`                          | Oturum                            | `bookingId?`                                                                               | 200 `{ claims }` (yalnız tarafı olduğu talepler) | 401                                                                                                                                                                                                          |
| `POST /api/claims`                         | Doğrulanmış (misafir / ev sahibi) | `{ bookingId, type: "GUEST_REFUND" \| "HOST_DAMAGE", amountMinor, description (10–4000) }` | 201 `{ id, status }`                             | 409 `CLAIM_BOOKING_NOT_ELIGIBLE`, `CLAIM_TOO_EARLY`, `CLAIM_WINDOW_CLOSED`, `CLAIM_NO_PAYMENT`, `CLAIM_ALREADY_OPEN`, `CLAIM_AMOUNT_EXCEEDS_REFUNDABLE`, `CLAIM_TRANSFERRED_BOOKING`, `CLAIM_SPLIT_CAPACITY` |
| `GET /api/claims/:id`                      | Taraf veya ADMIN                  | —                                                                                          | 200 talep detayı (mesajlar, kanıtlar, SLA)       | 404                                                                                                                                                                                                          |
| `POST /api/claims/:id/messages`            | Taraf                             | `{ body (1–4000) }`                                                                        | 201                                              | 404; 409 `CLAIM_CLOSED`                                                                                                                                                                                      |
| `POST /api/claims/:id/evidence`            | Taraf                             | `multipart/form-data` (görsel veya PDF; magic-byte kontrolü, WebP'ye yeniden kodlama)      | 201                                              | 400 (tür/boyut); 409 `CLAIM_EVIDENCE_LIMIT`, `CLAIM_CLOSED`                                                                                                                                                  |
| `GET /api/claims/:id/evidence/:evidenceId` | Taraf veya ADMIN                  | —                                                                                          | 200 dosya                                        | 404                                                                                                                                                                                                          |
| `POST /api/claims/:id/withdraw`            | Talep sahibi                      | —                                                                                          | 200 `{ ok: true }`                               | 409 `CLAIM_CLOSED`                                                                                                                                                                                           |
| `GET /api/bookings/:id/deposit`            | Rezervasyonun tarafı              | —                                                                                          | 200 depozito durumu                              | 404                                                                                                                                                                                                          |

Depozito capture hataları (karar sırasında): 422 `DEPOSIT_NOT_AUTHORIZED`, `DEPOSIT_EXPIRED`, `DEPOSIT_CAPTURE_EXCEEDS_AUTH`. PSP iadesi reddedilirse 502 `CLAIM_REFUND_FAILED`; bölünmüş ödemede eşzamanlı iade 409 `CLAIM_REFUND_IN_PROGRESS`.

### v4.6 Ajan kanalı: ACP (v4 değişiklikleri), UCP, MCP

| Uç                                                 | Yetki                | İstek                                                                                                                       | Başarılı yanıt                                                                                       | Hatalar                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/agentic/checkout_sessions`              | Doğrulanmış (v4)     | v3 ile aynı                                                                                                                 | v3 ile aynı; her okumada rezervasyon durumuyla uzlaştırılır (v4#10)                                  | 403 `EMAIL_NOT_VERIFIED`                                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/agentic/checkout_sessions/:id/complete` | Doğrulanmış (v4)     | `{ payment_data: { token, provider: "mock" \| "stripe" }, mandate? }` veya `AP2-Mandate` başlığı; `Idempotency-Key` zorunlu | 200 `completed` \| 202 3DS                                                                           | 400 (tanınmayan / Stripe aktifken demo token); 402 `SPT_INACTIVE`, `SPT_CURRENCY_MISMATCH`, `SPT_LIMIT_EXCEEDED`, `MANDATE_AMOUNT_EXCEEDED` (`details.stepUp`); 403 `MANDATE_REQUIRED`, `MANDATE_INVALID`, `MANDATE_EXPIRED`, `MANDATE_SUBJECT_MISMATCH`, `MANDATE_CURRENCY_MISMATCH`, `MANDATE_PROPERTY_MISMATCH`, `MANDATE_REVOKED`; 409 `MANDATE_REPLAYED` + v3 hataları |
| `GET /.well-known/ucp`                             | Anonim               | —                                                                                                                           | 200 UCP profil belgesi (servis uçları, lodging + `ap2_mandate` uzantıları)                           | —                                                                                                                                                                                                                                                                                                                                                                           |
| `POST /api/ucp/checkout-sessions`                  | Doğrulanmış          | UCP `line_items[0].item.id` (oda) + `lodging` (tarih, misafir); `Idempotency-Key`                                           | 201 \| 200 UCP görünümü (`ready_for_complete` \| `requires_escalation` \| `completed` \| `canceled`) | ACP ile aynı                                                                                                                                                                                                                                                                                                                                                                |
| `GET` / `PUT /api/ucp/checkout-sessions/:id`       | Oturum / Doğrulanmış | PUT: kısmi `lodging`                                                                                                        | 200 UCP görünümü                                                                                     | 404                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /api/ucp/checkout-sessions/:id/complete`     | Doğrulanmış          | `payment_data.credential` (SPT) + `ap2.intent_mandate`                                                                      | 200 UCP görünümü                                                                                     | ACP `complete` ile aynı                                                                                                                                                                                                                                                                                                                                                     |
| `POST /api/mcp` (v4)                               | Bearer               | Yeni araç `checkout_stay` (`roomId, checkIn, checkOut, guests, spt, mandate?, idempotencyKey`)                              | JSON-RPC                                                                                             | `create_hold` ve `checkout_stay` doğrulanmamış e-postada araç hatası                                                                                                                                                                                                                                                                                                        |

### v4.7 Yönetim (ADMIN)

| Uç                                                      | İstek                                                                                                             | Başarılı yanıt                                                                                        | Hatalar                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/admin/reconciliation?date=YYYY-MM-DD`         | UTC gün (varsayılan dün)                                                                                          | 200 `{ date, checked, differences[], imbalancedEntries, orphanEvents[], ok }` (tutarlar string minor) | 400                                                                                      |
| `GET /api/admin/refunds`                                | —                                                                                                                 | 200 `REFUND_FAILED` kuyruğu                                                                           | 403                                                                                      |
| `POST /api/admin/refunds`                               | `{ bookingId }`                                                                                                   | 200 `{ retried: true, result }`                                                                       | 404; 502 `REFUND_RETRY_FAILED`                                                           |
| `GET /api/admin/payouts`                                | —                                                                                                                 | 200 `{ accounts }`                                                                                    | 403                                                                                      |
| `POST /api/admin/payouts/:userId`                       | `{ paused: boolean, reason? }`                                                                                    | 200 hesap durumu (`payoutsPaused`, `pausedReason`); audit                                             | 404                                                                                      |
| `GET /api/admin/claims`                                 | Durum filtresi                                                                                                    | 200 `{ claims }`                                                                                      | 403                                                                                      |
| `POST /api/admin/claims/:id/decision`                   | `{ decision: "APPROVE" \| "PARTIAL" \| "REJECT", amountMinor? (PARTIAL'da zorunlu), note }`                       | 200 karar sonucu (iade / depozito capture, `uncollectedMinor`)                                        | 404; 409 `CLAIM_CLOSED`, `CLAIM_PSP_MANAGED`; 422 `DEPOSIT_*`; 502 `CLAIM_REFUND_FAILED` |
| `GET` / `POST /api/admin/takedowns`                     | POST `{ source: MINISTRY_7565 \| COURT_ORDER \| OTHER_AUTHORITY, referenceNo?, propertyId, reason, receivedAt? }` | 200 `{ takedowns }` / 201 `{ takedown }` (ilan aynı işlemde pasif, SLA işi planlanır)                 | 404                                                                                      |
| `POST /api/admin/takedowns/:id`                         | `{ resolution }`                                                                                                  | 200 `{ takedown }` (ilan otomatik açılmaz)                                                            | 409 `TAKEDOWN_CLOSED`                                                                    |
| `GET /api/admin/notices`, `POST /api/admin/notices/:id` | POST `{ decision: "REMOVED" \| "NO_ACTION", ground?, facts, legalReference?, … }`                                 | 200 `{ notices }` / `{ notice }` (md. 17 gerekçe beyanı + e-postalar)                                 | 400 (REMOVED'da `ground` yok / ilansız bildirim); 409 `NOTICE_DECIDED`                   |
| `GET /api/admin/notice-appeals`, `POST …/:id`           | POST `{ outcome: "UPHELD" \| "REJECTED", response, ground? }`                                                     | 200 `{ appeals }` / `{ appeal }`                                                                      | 409 `APPEAL_DECIDED`                                                                     |
| `GET /api/admin/compliance/transparency`                | `from`, `to`, `format=json\|csv`                                                                                  | 200 DSA/7565 şeffaflık raporu                                                                         | 400                                                                                      |
| `GET /api/admin/accessibility`, `POST …/:id`            | `status=pending\|verified`; POST `{ verified: boolean }`                                                          | 200 `{ features }` / `{ feature }`; audit `accessibility.verified\|unverified`                        | 409 `ACCESSIBILITY_EVIDENCE_REQUIRED`                                                    |
| `PATCH /api/admin/users/:id/role` (v4 değişikliği)      | v3 ile aynı                                                                                                       | v3 ile aynı                                                                                           | 409 `LAST_ADMIN`                                                                         |

### v4.8 Herkese açık uyum uçları

| Uç                              | Yetki                    | İstek                                                                                                              | Başarılı yanıt | Hatalar                                                                                            |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------- |
| `POST /api/notices`             | Anonim                   | `{ propertyId?, contentUrl, category, explanation (≥20), reporterName?, reporterEmail, goodFaith: true, locale? }` | 201            | 429 `NOTICE_RATE_LIMITED` (`DSA_NOTICE_MAX_PER_WINDOW`)                                            |
| `POST /api/notices/:id/appeals` | Anonim (imzalı bağlantı) | `{ role, token, reason (≥20), locale? }`                                                                           | 201            | 403 `APPEAL_TOKEN_INVALID`; 409 `NOTICE_NOT_DECIDED`, `APPEAL_EXISTS`, `APPEAL_WINDOW_CLOSED`; 429 |

### v4.9 Hata kodları (v4'te eklenen başlıcaları)

| HTTP | Kod                                                                                                                                                               | Anlamı                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 401  | `WRONG_PROVIDER_SIGNATURE`                                                                                                                                        | Webhook aktif sağlayıcının imzasını taşımıyor (ödeme ve KYC, v4#16)                      |
| 402  | `SPT_INACTIVE`, `SPT_CURRENCY_MISMATCH`, `SPT_LIMIT_EXCEEDED`                                                                                                     | Stripe Shared Payment Token siparişe uymuyor                                             |
| 402  | `MANDATE_AMOUNT_EXCEEDED`                                                                                                                                         | Tutar mandate limitini aşıyor; `details.stepUp` → kullanıcı yeni mandate imzalar         |
| 403  | `EMAIL_NOT_VERIFIED`                                                                                                                                              | Doğrulanmış e-posta gerekli (v4#6)                                                       |
| 403  | `REAUTH_REQUIRED`                                                                                                                                                 | Recent-auth gerekli (`details.maxAgeSeconds`)                                            |
| 403  | `IDENTITY_VERIFICATION_REQUIRED`                                                                                                                                  | KYC zorunluluğu açık ve kullanıcı doğrulanmamış                                          |
| 403  | `MANDATE_REQUIRED`, `MANDATE_INVALID`, `MANDATE_EXPIRED`, `MANDATE_SUBJECT_MISMATCH`, `MANDATE_CURRENCY_MISMATCH`, `MANDATE_PROPERTY_MISMATCH`, `MANDATE_REVOKED` | Mandate yok / geçersiz / süresi dolmuş / başka kullanıcı / para birimi / ilan / iptal    |
| 403  | `SHARE_EMAIL_MISMATCH`, `APPEAL_TOKEN_INVALID`                                                                                                                    | Pay linki başka e-postaya ait; DSA itiraz bağlantısı geçersiz                            |
| 404  | `SHARE_LINK_INVALID`                                                                                                                                              | Bölünmüş ödeme linki imzası geçersiz                                                     |
| 409  | `IDEMPOTENCY_KEY_REUSED`                                                                                                                                          | Aynı `Idempotency-Key` farklı gövdeyle (v4#9; rezervasyon ve ACP)                        |
| 409  | `MANDATE_REPLAYED`                                                                                                                                                | Mandate nonce'ı başka bir checkout oturumunda kullanılmış                                |
| 409  | `LAST_ADMIN`, `TAKEDOWN_ACTIVE`, `DSA_RESTRICTION_ACTIVE`, `TRANSFER_PENDING`                                                                                     | Son yönetici; açık 7565 talebi / DSA kısıtı varken yeniden yayın; devir capture bekliyor |
| 409  | `CART_*`, `SPLIT_*`, `SHARE_ALREADY_PAID`, `CLAIM_*`, `COUPON_*`, `CREDIT_EXCEEDS_LIMIT`, `INSUFFICIENT_CREDIT`, `PAYMENT_AMOUNT_MISMATCH`                        | Sepet, bölünmüş ödeme, talep, kupon ve cüzdan durum çakışmaları (tablolar yukarıda)      |
| 410  | `SHARE_LINK_EXPIRED`                                                                                                                                              | Bölünmüş ödeme süresi dolmuş                                                             |
| 422  | `INVALID_CARD_TOKEN`                                                                                                                                              | PSP kart token'ını reddetti                                                              |
| 422  | `MESSAGE_BLOCKED`                                                                                                                                                 | Yüksek riskli mesaj engellendi (`MESSAGE_SCAN_BLOCK_HIGH_RISK=true`)                     |
| 422  | `DEPOSIT_NOT_AUTHORIZED`, `DEPOSIT_EXPIRED`, `DEPOSIT_CAPTURE_EXCEEDS_AUTH`                                                                                       | Depozito capture edilemiyor                                                              |
| 429  | `LOGIN_DELAYED`, `POW_REQUIRED` (`details.pow`)                                                                                                                   | Giriş kademeli gecikmesi / proof-of-work gerekli (v4#12)                                 |
| 429  | `PAYMENT_ATTEMPTS_EXCEEDED`, `REAUTH_RATE_LIMITED`, `KYC_RATE_LIMITED`, `NOTICE_RATE_LIMITED`                                                                     | Deneme sınırları                                                                         |
| 502  | `PAYMENT_PROVIDER_ERROR` (`Retry-After: 5`, `details.providerCode`)                                                                                               | PSP hatası; ödeme `OPEN` kalır, deneme hakkı düşmez                                      |
| 502  | `TRANSFER_PAYMENT_FAILED`, `CLAIM_REFUND_FAILED`, `REFUND_RETRY_FAILED`                                                                                           | Devir capture'ı / talep iadesi / iade yeniden denemesi PSP'de başarısız                  |
| 503  | `PUSH_DISABLED`, `SPLIT_PAY_UNAVAILABLE`, `TRANSFER_UNAVAILABLE`                                                                                                  | Özellik yapılandırılmamış (VAPID / imza sırrı yok)                                       |
