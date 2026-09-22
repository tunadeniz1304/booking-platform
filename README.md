# booking-platform

Booking.com ölçeğinde, yüksek eşzamanlılık kaldırabilen ve veri tutarlılığını koruyan bir konaklama & rezervasyon platformu.

## Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS |
| Backend | Next.js Route Handlers, TypeScript `src/lib/*` servisleri |
| Veritabanı | PostgreSQL 16 + Prisma ORM |
| Cache / Kilit / Kuyruk | Redis 7, BullMQ |
| Auth | JWT (HS256) + bcryptjs, httpOnly cookie + Bearer |
| Infra | Docker Compose, GitHub Actions |

## Mimari

Modüler monolit: DDD bounded context'ler (`src/lib/` içinde ayrı servisler) — Catalog, Inventory, Booking, Pricing, Identity, Search. Ayrıntılar: [`docs/architecture.md`](docs/architecture.md). API sözleşmesi: [`docs/api-contract.md`](docs/api-contract.md).

Öne çıkan yönler:

- **Double-booking engelleme:** Redis dağıtık kilit (`booking:lock:`) + SERIALIZABLE transaction + `SELECT ... FOR UPDATE` çift katmanı.
- **Idempotency:** `POST /api/bookings` isteğinde `Idempotency-Key` başlığı; `userId+idempotencyKey` unique'i ile tekrarlanan istek aynı rezervasyonu döndürür.
- **Rate limiting:** Next.js middleware içinde Redis sliding-window; uç başına farklı limit (auth 20, arama 60, rezervasyon 30, varsayılan 100/dk).
- **Cache:** arama `search:`, popüler `search:popular`, rezervasyon `booking:`, fiyat `price:` anahtarları; rezervasyon değişiminde ilgili cache'ler geçersiz kılınır.
- **Dinamik fiyatlandırma:** mevsim + son dakika + doluluk faktörleriyle gecelik fiyat; BullMQ kuyruğu ve günlük cron ile ön ısıtma.

## Başlangıç

Gereksinimler: Node 20+, Docker Desktop.

```bash
# 1) Bağımlılıklar
npm install

# 2) Ortam değişkenleri
cp .env.example .env

# 3) PostgreSQL + Redis + Uygulama
docker compose up -d db redis

# 4) Veritabanı göçü + örnek veri
npm run db:migrate
npm run db:seed

# 5) Geliştirme sunucusu
npm run dev
```

Uygulama: http://localhost:3000

### Örnek hesaplar (seed)

| Rol | E-posta | Parola |
|-----|---------|--------|
| Admin | admin@booking.test | `Password123!` |
| Host | host@booking.test | `Password123!` |
| Kullanıcı | guest@booking.test | `Password123!` |

## Scriptler

| Komut | Açıklama |
|-------|----------|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Üretim build'i |
| `npm run start` | Üretim sunucusu |
| `npm run lint` | ESLint |
| `npm test` | Vitest (concurrency/idempotency) |
| `npm run db:migrate` | Prisma migrate deploy |
| `npm run db:seed` | Örnek veri |
| `npm run db:up` | Docker ile db+redis ayağa kaldır |

> `npm test` için PostgreSQL ve Redis'in çalışıyor olması gerekir (bkz. adım 3).

## API

Tam sözleşme: [`docs/api-contract.md`](docs/api-contract.md). Özet:

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/user/me`, `POST /api/auth/logout`
- `GET /api/search`, `GET /api/properties`, `POST /api/properties` (HOST), `GET /api/properties/:id`, `GET /api/locations`
- `POST /api/bookings` (Idempotency-Key destekli), `GET /api/bookings`, `GET/DELETE /api/bookings/:id`
- `GET/POST/DELETE /api/favorites`
- `POST/GET /api/pricing`

## Testler

`tests/booking-concurrency.test.ts` eşzamanlı çift rezervasyonu (yalnız bir kayıt) ve idempotency anahtarının tekrarını (aynı rezervasyon) doğrular.

## Docker / CI

- `docker-compose.yml`: postgres, redis, Next.js standalone.
- `Dockerfile`: multi-stage, prisma migrate deploy + server.js.
- `.github/workflows/deploy.yml`: CI (lint, test, build) + ghcr.io görüntüsü + SSH dağıtımı.

## Proje Yapısı

```
prisma/            # Şema, migration, seed
src/
  app/             # Sayfalar + API route'ları (App Router)
  components/      # UI bileşenleri
  lib/             # Servisler: booking, search, pricing, queue, auth, redis, prisma
  middleware.ts    # Auth + rate-limit + token kara liste
tests/             # Vitest
docs/              # Mimari ve API sözleşmesi
```
