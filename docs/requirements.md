# Gereksinim Analizi — Booking Platform

Bu doküman, booking-platform deposunun ürün gereksinimlerini ve mimari kararlarını özetler.

## 1. Ürün Amacı

Booking.com ölçeğinde, yüksek trafik kaldırabilen ve eşzamanlı rezervasyon çakışmalarını önleyen bir konaklama/rezervasyon platformu.

## 2. Teknoloji Yığını

| Katman             | Teknoloji                                        |
| ------------------ | ------------------------------------------------ |
| Frontend           | Next.js 14 (App Router), React 18, Tailwind CSS  |
| Backend            | Next.js Route Handlers + `src/lib/*` servisleri  |
| Veritabanı         | PostgreSQL 16 + Prisma ORM                       |
| Cache/Kilit/Kuyruk | Redis 7 (ioredis/Upstash), BullMQ                |
| Auth               | JWT (HS256) + bcryptjs, httpOnly cookie + Bearer |
| Infra              | Docker Compose, GitHub Actions                   |

## 3. Kullanıcı Hikayeleri

### 3.1 Misafir (Kullanıcı)

- Şehir/tarih/misafir sayısına göre konaklama aramak.
- Konaklama detaylarını (fotoğraf, olanaklar, oda seçenekleri) görüntülemek.
- Uygun odayı seçip rezervasyon oluşturmak.
- Rezervasyonlarını görüntülemek ve iptal etmek.
- Konaklamaları favorilerine eklemek.

### 3.2 Ev Sahibi (Host)

- Konaklama ilanı oluşturmak.
- Oda ve fiyat bilgilerini yönetmek.

### 3.3 Yönetici (Admin)

- Kullanıcıları ve ilanları yönetmek.

## 4. Fonksiyonel Gereksinimler (MVP)

- Kullanıcı kaydı ve girişi (JWT tabanlı) — `/api/auth/register`, `/api/auth/login`, `/api/user/me`, `/api/auth/logout`
- Konaklama arama ve listeleme — `/api/search`, `/api/properties`
- Konaklama detay sayfası — `/api/properties/:id`
- Oda bazlı rezervasyon oluşturma — `POST /api/bookings` (Idempotency-Key destekli)
- Rezervasyon listeleme/iptal — `GET /api/bookings`, `GET/DELETE /api/bookings/:id`
- Favoriler — `GET/POST/DELETE /api/favorites`
- Kullanıcı paneli — profil, rezervasyonlar, favoriler

## 5. Teknik Kalite Gereksinimleri

- **Eşzamanlılık:** Redis dağıtık kilit + SERIALIZABLE transaction + `SELECT ... FOR UPDATE` ile double-booking engelleme.
- **Idempotency:** `Idempotency-Key` başlığı ile yinelenen isteklerin aynı rezervasyonu döndürmesi.
- **Rate limiting:** Orta katmanda Redis sliding-window; uç başına farklı limit.
- **Cache:** Arama, rezervasyon ve fiyat cache'leri; yazma sonrası invalidation.
- **Güvenlik:** bcrypt parola hashing, JWT imza doğrulama, zodiac input doğrulama, rol bazlı yetki.
- **Dinamik fiyatlandırma:** mevsim + son dakika + doluluk faktörler; BullMQ kuyruğu ve cron.

## 6. Mimariden Bağımsız Kararlar

Detaylı mimari ve API sözleşmesi güncel kaynaklardır:

- [Mimari Dokümanı](ARCHITECTURE.md)
- [API Sözleşmesi](api-contract.md)

## 7. Açık Sorular (Gelecek)

- Ödeme sağlayıcısı entegrasyonu
- E-posta bildirimleri
- Elasticsearch odaklı arama (opsiyonel read model)
- Mobil uygulama
- A/B test ve analitik altyapısı
