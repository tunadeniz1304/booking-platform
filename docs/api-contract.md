# API Sözleşmesi — Booking Platform

Base URL: `/api`. Tüm istek/yanıtlar JSON'dur. UI kopyası Türkçe'dir; API alan adları İngilizce'dir.

## 0. Ortak Sözleşmeler

### 0.1 Hata Zarfı (Error Envelope)

Başarısız her yanıt şu şekildedir:

```json
{ "error": "İnsan okunur mesaj", "code": "OPTIONAL_MACHINE_CODE" }
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
| 429 | Rate limit    | limit aşıldı                                     |
| 500 | Sunucu hatası | yakalanmamış hata                                |

### 0.3 Kimlik Doğrulama

- Giriş/kayıt yanıtı: `{ user, token }`. Token JWT'dir (algorithm HS256, `sub` = userId, `role` claim'i içerir).
- İstemci token'ı **`Authorization: Bearer <token>`** başlığında **veya** `token` httpOnly cookie'sinde gönderir.
- Proxy (`src/proxy.ts`), korunan `/api` isteklerini doğrular ve `x-user-id` / `x-user-role` başlıklarını yalnızca doğrulanmış token'dan alt uçlara ekler.
- Oturum gerektirmeyen uçlar `src/lib/security/public-routes.ts` içindeki `PUBLIC_API` listesindedir: `/api/auth/*`, `/api/health`, `/api/ready`, `/api/metrics`, `/api/internal/*`, `/api/payments/webhook` (tüm metotlar); `/api/search` (GET, POST); `/api/properties*`, `/api/locations`, `/api/quote`, `/api/rooms/*`, `/api/routing/optimize`, `/api/transfers/discover` (yalnızca GET). Route handler'lar ayrıca kendi yetki kontrolünü yapar.

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
      "basePrice": 2450,
      "currency": "TRY",
      "ratingAvg": 8.9,
      "ratingCount": 1240,
      "location": { "city": "İstanbul", "country": "Türkiye" },
      "amenities": ["Ücretsiz WiFi", "Havuz"],
      "availableRooms": 3,
      "totalPrice": 7350
    }
  ],
  "total": 10,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1,
  "cached": false
}
```

`cached: true` ise Redis'ten döndü. `totalPrice` yalnız checkIn+checkOut+guests verildiğinde hesaplanır (gece başına ortalama müsaitlik fiyatı × gece sayısı).

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
{ "id": "cuid", "title": "Yeni Otel", "propertyType": "HOTEL", "basePrice": 2000, "isActive": true }
```

`city/country` için Location upsert yapılır. Amenity adları upsert edilir. Room oluşturulur; `money` (`basePrice`, `priceModifier`) Decimal olarak saklanır.

### 2.4 GET /api/properties/:id — Detay

Public.

```json
// 200
{
  "id": "cuid", "title": "...", "description": "...", "propertyType": "HOTEL",
  "location": { "city": "İstanbul", "country": "Türkiye" },
  "basePrice": 2450, "currency": "TRY", "ratingAvg": 8.9, "ratingCount": 1240,
  "amenities": [ { "name": "Ücretsiz WiFi", "icon": "wifi" } ],
  "images": ["https://..."],
  "rooms": [
    { "id": "cuid", "name": "Standart Oda", "description": null, "capacity": 2,
      "bedType": "Çift Kişilik Yatak", "priceModifier": 0, "available": true }
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
    "totalPrice": 7350,
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
    "totalPrice": 7350,
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
