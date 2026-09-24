# Changelog

Bu dosyadaki tüm önemli değişiklikler burada belgelenir. Biçim [Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) esaslıdır ve proje [Semantic Versioning](https://semver.org/lang/tr/) kullanır.

## [Unreleased]

- F8: modern arayüz (host/admin panelleri, `/plan`, `/transfers`, `/account/privacy`, harita), demo senaryoları, Playwright e2e ve k6 yük testi.

## [2.0.0] - 2026-09-24

v1'in prototip çekirdeği üretim kalitesinde bir rezervasyon platformuna dönüştürüldü. 22 bilinen hatanın her biri düzeltildi ve regresyon testiyle korunuyor.

### Added

- **F0 — Kalite kapısı:** Prettier + `.gitattributes` (LF), `typecheck` / `format:check` / `check` script'leri, Vitest `unit` ve `integration` projeleri (testcontainers: pgvector + redis), `@vitest/coverage-v8`, `.dockerignore`.
- **F1 — LLM sözleşmesi:** `src/lib/llm/*` (live/demo/fallback modları, JSON çıkarma, KVKK redaksiyonu, sayı ve atıf guard'ları, Prometheus metrikleri), `GET /api/llm/status`, `npm run llm:smoke`.
- **F2 — Rezervasyon çekirdeği:** `PENDING → HELD → CONFIRMED → COMPLETED | CANCELLED | EXPIRED` durum makinesi, `holdExpiresAt` + dakikalık `expire-holds` job'ı; tamsayı minor-unit para ve UTC gece tipleri; kart, PDP, checkout ve tahsilat için tek `computeTotal()` quote'u (`GET /api/quote`, `409 PRICE_CHANGED`); 100 paralel istek → 1 başarı / 99 `SOLD_OUT` entegrasyon testi.
- **F3 — Ödeme, iptal, bildirim:** `PaymentProvider` + `MockPsp` (3DS simülasyonu, capture-on-confirm, refund), HMAC imzalı idempotent webhook, opsiyonel Stripe sağlayıcısı; sürümlü iptal politikaları ve `computeRefund()`; SMTP veya dev mailbox (`/dev/mailbox`) üzerinden Türkçe rezervasyon e-postaları.
- **F3 — Rezervasyon devri:** imzalı, tek kullanımlık claim linki ve escrow'lu ödeme ile P2P transfer (`/api/transfers/*`).
- **F4 — Gözlemlenebilirlik:** pino loglama, OpenTelemetry (Prisma, ioredis), `/api/metrics`, `/api/health`, `/api/ready`, Grafana dashboard JSON, `observability` compose profili; gecelik availability rollover ve dinamik partisyon betiği (`npm run db:partitions`).
- **F5 — Arama ve GenAI I:** Smart Filter (`POST /api/search/smart`, golden set 20/20 demo), açıklanabilir ağırlıklı sıralama ve `/ranking` şeffaflık sayfası, takılabilir `Embedder` (hash varsayılan, opsiyonel model; yeni mülkte otomatik embedding), `next-intl` (tr/en) ve rezervasyona FX snapshot'lı yalnızca-görüntüleme döviz dönüşümü.
- **F6 — Yorumlar ve GenAI II:** doğrulanmış konaklama yorumları, host yanıtları, atıflı AI yorum özeti; araçlı ve grounded çok şehirli trip-planner (`POST /api/ai/trip-plan`); onaylı talep olayı sinyalleriyle sınırlı ve açıklanabilir yeniden fiyatlama, yield hold.
- **F7 — Host ve admin:** host extranet API'leri (mülk, oda, toplu ARI, rezervasyonlar), ilan metni copilot'u, `Property.licenseNumber` zorunluluğu; iCal export/import ve gRPC `AriService` kanal simülatörü; kural tabanlı fraud skoru; admin kuyrukları (outbox, olaylar, fraud, kullanıcı rolleri) ve audit log; KVKK veri dışa aktarım ve hesap silme API'si.
- Dokümantasyon: README, `docs/ARCHITECTURE.md`, ADR 0001–0009, `docs/METHODOLOGY.md`, `docs/MODEL_CARD.md`, `docs/COMPLIANCE.md`, `docs/DEMO_SCRIPT.md`, MIT lisansı.

### Changed

- Next.js 16, React 19, ESLint 9 (flat config) ve Vitest 5'e yükseltme; `src/middleware.ts` → `src/proxy.ts` (ADR 0009).
- Kimlik doğrulama yalnızca `jose`: 15 dk access token + rotating refresh token (yeniden kullanımda aile iptali), POST-only logout, sabit zamanlı login; localStorage'da token tutulmuyor.
- Kuyruk tanımı ile worker ayrıldı; arama cache'i `KEYS` taraması yerine sürüm anahtarlı.
- Rota optimizasyonu açık yol Held-Karp ve asimetrik maliyete güvenli yerel arama (2-opt + or-opt) ile yeniden yazıldı; modül dürüst adıyla belgelendi.
- Eski "sentiment trigger" modülü, admin onaylı ve tavanlı olay sinyali motoruyla değiştirildi.
- Docker imajları sırsız; compose sırları `secrets-init` ile üretir, Postgres/Redis host'a açılmaz, Redis parolalı; gRPC servisi compose'a eklendi.
- `.env.example` tüm ortam değişkenlerini belgeler.

### Fixed

- gRPC: JWT metadata zorunlu, istek sahibi token'dan türetilir (#1).
- İç uçlar: zayıf veya varsayılan sır kabul edilmez, timing-safe karşılaştırma, ADMIN JWT alternatifi (#2).
- Transfer: token doğrulaması, ödeme ve sızıntı sorunları (#3).
- Ödenmeyen rezervasyonların envanteri sonsuza dek tutması (#4).
- Rate-limit atlatma ve `x-user-id` başlık sahteciliği (#5, #6).
- İstemcinin para birimi seçebilmesi ve gösterilen ≠ tahsil edilen fiyat (#7, #8, #20).
- Outbox çift yayın, lease eksikliği ve sonsuz retry (#9).
- BullMQ worker'ın Next sunucusunda açılması (#10).
- SSE canlı uçta sınırsız aralık ve bağlantı (#11).
- Rota optimizasyonunda açık/kapalı yol tutarsızlığı, ay indeksi ve asimetrik maliyet hataları (#12).
- Olay fiyatlamasında bileşik ve sınırsız artış (#13).
- Docker build, compose ve CI hataları (#14, #15); kimlik doğrulama açıkları (#16); pricing ucu yetki kontrolü (#17); bloklayan cache taraması (#18); sorgu profil'leyicinin varsayılan açık olması (#19); eksik env belgeleri (#21); yeni mülkte embedding üretilmemesi (#22).

### Removed

- `jsonwebtoken` bağımlılığı, kullanılmayan saga / command bus / query bus kodu.
- `.github/workflows/deploy.yml`: gerçek bir deploy hedefi yoktu ve sırları build argümanı olarak geçiriyordu; yerine `ci.yml`.

## [1.0.0]

- İlk prototip: Next.js 14 arayüzü, Redlock + `FOR UPDATE` rezervasyon, çarpımsal fiyat motoru, pazarlık motoru, gRPC tanımları, deterministik seed.

[Unreleased]: https://github.com/tunadeniz1304/booking-platform/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/tunadeniz1304/booking-platform/releases/tag/v2.0.0
