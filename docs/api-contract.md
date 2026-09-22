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
{ "error": "Validation error", "details": [ { "path": "checkIn", "message": "..." } ] }
```

### 0.2 Durum Kodları
| Kod | Anlam | Senaryo |
|-----|-------|---------|
| 201 | Oluşturuldu | register, booking create (yeni) |
| 200 | Başarılı | login, listeler, detail, idempotent replay |
| 400 | Doğrulama | geçersiz tarih, süre sınırı, capacity |
| 401 | Yetkisiz | eksik/geçersiz token |
| 403 | Yasak | başkasının kaynağı (GET /bookings/:id) |
| 404 | Bulunamadı | mülk/rezervasyon yok |
| 409 | Çakışma | oda şu an başka biri tarafından rezerve ediliyor |
| 429 | Rate limit | limit aşıldı |
| 500 | Sunucu hatası | yakalanmamış hata |

### 0.3 Kimlik Doğrulama
- Giriş/kayıt yanıtı: `{ user, token }`. Token JWT'dir (algorithm HS256, `sub` = userId, `role` claim'i içerir).
- İstemci token'ı **`Authorization: Bearer <token>`** başlığında **veya** `token` httpOnly cookie'sinde gönderir.
- Middleware, korunan `/api` isteklerini doğrular ve `x-user-id` başlığını alt uçlara ekler.
- PUBLIC_PATHS (auth gerektirmez): `/api/auth/login`, `/api/auth/register`, `/api/properties`, `/api/search`, `/api/locations`.

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
{ "id": "cuid", "firstName": "Ayşe", "lastName": "Demir", "email": "user@example.com", "role": "USER", "avatarUrl": null }
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
      "id": "cuid", "title": "Grand Deluxe Hotel", "description": "...",
      "propertyType": "HOTEL", "basePrice": 2450, "currency": "TRY",
      "ratingAvg": 8.9, "ratingCount": 1240,
      "location": { "city": "İstanbul", "country": "Türkiye" },
      "amenities": ["Ücretsiz WiFi", "Havuz"],
      "availableRooms": 3,
      "totalPrice": 7350
    }
  ],
  "total": 10, "page": 1, "pageSize": 20, "totalPages": 1, "cached": false
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
{ "propertyId": "cuid", "roomId": "cuid", "checkIn": "2026-10-01", "checkOut": "2026-10-04", "guestCount": 2 }
```
Zod: `checkIn/checkOut` ISO tarih, `guestCount` pozitif. Servis: checkOut>checkIn, geçmiş tarih yok, ≤30 gece; mülk aktif; oda uygun ve kapasite yeterli; tarih aralığındaki tüm geceler `isAvailable=true`.

```json
// 201 (yeni) | 200 (idempotent replay)
{
  "booking": {
    "id": "cuid", "propertyId": "cuid", "roomId": "cuid",
    "checkIn": "2026-10-01T00:00:00.000Z", "checkOut": "2026-10-04T00:00:00.000Z",
    "guestCount": 2, "totalPrice": 7350, "currency": "TRY",
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
    "id": "cuid", "checkIn": "...", "checkOut": "...", "guestCount": 2,
    "totalPrice": 7350, "currency": "TRY", "status": "CONFIRMED",
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

