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
| `npm run worker` | Arka plan işçisi (outbox relay + pricing) |
| `npm run grpc:server` | Bağımsız gRPC sunucusu |
| `npm run grpc:client` | gRPC istemci bağlantı testi |
| `npm run embeddings:backfill` | pgvector gömme (yeniden) hesaplama |

> `npm test` için PostgreSQL ve Redis'in çalışıyor olması gerekir (bkz. adım 3).

## Phase-2 — Next-Generation Altyapı

Booking.com'un limitlerini aşan dağıtık + yapay zeka destekli katmanlar. Mimari: [`docs/architecture-phase2.md`](docs/architecture-phase2.md).

| Modül | Klasör | Açıklama |
|-------|--------|----------|
| CQRS + Event Bus | `src/lib/cqrs/` | CommandBus/QueryBus/EventBus + trace |
| Transactional Outbox | `src/lib/cqrs/outbox.ts` | iş ile atomik olay yayını, at-least-once |
| Saga | `src/lib/saga/` | booking→payment orkestrasyonu + telafi |
| Redlock | `src/lib/distributed-lock/` | fencing token'lı dağıtık kilit |
| gRPC/Protobuf | `proto/`, `services/grpc/` | iç servis sözleşmesi (inventory/booking/payment) |
| pgvector | `src/lib/embedding/`, `src/lib/search/vector.ts` | semantik arama + kişiselleştirme |
| Talep Motoru | `src/lib/pricing/engine.ts` | etkinlik korelasyonlu dinamik fiyat |
| Fuzzy Arama | `src/lib/search/fuzzy.ts` (`pg_trgm`) | imla hatası toleransı |
| Elasticsearch | `src/lib/search/elastic.ts` | opsiyonel ES adaptörü |
| Pazarlık | `src/lib/negotiation/` | çok-etmenli rule-engine (`POST /api/negotiate`) |
| Canlı Talep (SSE) | `src/lib/live/`, `/api/rooms/[id]/live` | gerçek zamanlı ısı haritası akışı |
| Circuit Breaker | `src/lib/resilience/` | CLOSED/OPEN/HALF_OPEN + fallback |
| Güvenlik | `src/lib/security/` | IP-spoof koruması + BOLA denetimi |

### Phase-2 scriptleri

| Komut | Açıklama |
|-------|----------|
| `npm run worker` | Arka plan işçisi: outbox relay + pricing kuyruğu |
| `npm run grpc:server` | Bağımsız gRPC sunucusu (port 50051) |
| `npm run grpc:client` | gRPC istemci bağlantı testi |
| `npm run embeddings:backfill` | pgvector gömme vektörlerini (yeniden) hesaplar |

Semantik aramayı açmak için: `GET /api/search?destination=...&semantic=1`.
Elasticsearch'i aktifleştirmek için `docker compose --profile es up -d` + `ELASTICSEARCH_URL=http://localhost:9200`.

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
