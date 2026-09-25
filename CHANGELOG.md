# Changelog

Bu dosyadaki tüm önemli değişiklikler burada belgelenir. Biçim [Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) esaslıdır ve proje [Semantic Versioning](https://semver.org/lang/tr/) kullanır.

## [Unreleased]

### Added

- **v3 F0/F1:** genişletilmiş kapsam (route handler, gRPC/MCP, worker; satır 80 / dal 70), CI'da Docker zorunlu entegrasyon testleri; LLM bütçeleri, redakte prompt logu, `ai_generated` etiketi; auth sertleştirme (tokenVersion, lockout, e-posta doğrulama, şifre sıfırlama, passkey), `DEMO_MODE`.
- **v3 F2 — Envanter v2 (ADR 0010):** `RoomType{units}`, `RatePlan` (iade edilemez / kahvaltılı), `Restriction` (minStay/maxStay/CTA/CTD/stopSell), `InventoryDay{total, sold, held}` (`CHECK sold+held<=total`), `ExternalBlock`; `Availability` verisi tek migration'da taşındı. units=3 odada 100 paralel istek → tam 3 başarı.
- **v3 F2 — Tesis saat dilimi (ADR 0011):** `Property.timeZone/checkInTime/checkOutTime`, Temporal yardımcıları; iCal içe aktarma ve `complete-stays` job'ı tesisin yerel gününde çalışır.
- **v3 F2 — Arama doğruluğu:** tek zod arama şeması (`src/lib/search/params.ts`), geçersiz girdi 400; fiyat filtresi toplam fiyat üzerinden; `pageSize` 50'ye kırpılır.
- **v3 F3 — Vergi/ücret motoru (ADR 0012):** veri tabanlı kurallar (`data/tax-rules.json` / `TAX_RULES_JSON`), dahil/hariç vergiler, tarih aralıklı kurallar, `SERVICE_FEE_BPS`; arama kartı, PDP, checkout ve tahsilat aynı vergiler dahil toplamı gösterir.
- **v3 F3 — Kalıcı FX (ADR 0012):** `FxRate` tablosu, günlük `fx-refresh` işi (TCMB → ECB → statik yedek, bayat işareti); teklif kur tablosunu sabitler (`fxSnapshotId`), tahsilat teklifteki tutarla yapılır.
- **v3 F3 — Fiyat içgörüsü ve alarmı:** split conformal tahmin aralığı (%90, `PRICE_INSIGHT_ALPHA`) ile düşük/tipik/yüksek etiketi (`GET /api/price-insight`); `PriceAlert` ve günlük `price-alerts` işi, toplam Omnibus referansının (son 30 günün en düşüğü, "önceki fiyat") altına inince e-posta gönderir (`/api/price-alerts`).
- **v3 F4 — Gerçek Stripe (P0-6, #10):** Stripe SDK sağlayıcısı, imzalı webhook ve Payment Element; ödeme kilidi ile tek tahsilat.
- **v3 F4 — Ödeme sagası (P0-7, ADR 0013):** `hold → authorize → capture → confirm` telafili saga (iade → void → tutmayı bırak), onay sonrası BullMQ FlowProducer ile `invoice → notify`; `saga_compensation_total` metriği, adım başına hata enjeksiyonu testleri.
- **v3 F4 — Payout ve fatura (#4):** devir sonrası satıcı `Payout` kaydı ve mock `payouts` işi (`PAYOUT_CRON`); mock e-Arşiv PDF fatura (`GET /api/bookings/:id/invoice`, "DEMO — mali değeri yoktur").
- **v3 F4 — FX saklama:** eski `FxRate` satırları saklama penceresine göre budanır.

### Changed

- Tahsilat hatası artık provizyonu void eder, ödemeyi `VOIDED` yapar ve tutmayı hemen bırakır (ADR 0013).
- Oda API yanıtları `maxOccupancy` döner; `capacity` bir sürüm boyunca takma ad olarak korunur.
- Pazarlık özelliği kaldırıldı, tek fiyat kaynağı `priceStay` (ADR 0016).
- Legacy fiyat motoru (`src/lib/pricing/engine.ts`) `event-signals` içine katlandı; `pricing-service` ve canlı ısı haritası tek motoru kullanır (#9).

### Fixed

- Devredilen rezervasyonun iptal iadesi yeni sahibe değil ödemeyi yapan alıcıya gider (v3#4).

### Removed

- Aylık `Availability` partisyon betiği (`scripts/partitions.ts`, `migrations/manual/…`): sayaçlı envanterde gerekmez; eski geceler `pruneInventory` ile budanır.

## [2.0.0] - 2026-09-25

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
- **F8 — Portföy arayüzü:** `/host` extranet paneli (mülk düzenleme, oda ekleme, toplu takvim, rezervasyonlar, ilan metni önerisi), `/admin` paneli, `/plan` trip-planner, `/transfers` + claim sayfası, `/account/privacy` KVKK self-servis, aydınlatma metni ve çerez onay bandı; Smart Filter çipleri, "neden bu sırada" açıklaması ve MapLibre harita görünümü; PDP'de atıflı yorum özeti, rol farkında menü, atlama bağlantısı; `npm run demo:reset`, lisans numaraları ve 365 günlük demo envanteri.
- **F8 — Test ve performans:** Playwright e2e (`npm run test:e2e`: arama → PDP → checkout → 3DS → onay e-postası → iptal → iade; ret kartı; host takvimi; Smart Filter) ve `@axe-core/playwright` ile 6 ana sayfada WCAG A/AA taraması; k6 yük testi `load/booking-spike.js` ve raporları `docs/perf/k6-results.md`, `docs/perf/lighthouse.md`; CI'da compose demo yığınına karşı e2e job'ı.
- **P1-12 — MCP sunucusu:** `npm run mcp:server` (stdio, `@modelcontextprotocol/sdk`) ile `search_stays`, `get_quote` ve access token'lı `create_hold` araçları; `npm run mcp:smoke` duman testi.
- Harita görünümünde `supercluster` ile işaretçi kümelemesi ve harita ↔ liste iki yönlü seçim senkronu (`src/lib/search/map-cluster.ts`).
- README ekran görüntüleri (`docs/img/`, `npm run docs:screenshots`).
- `npm run test:coverage` unit + entegrasyon testlerini birlikte koşar; `src/lib` için %80 satır kapsam eşiği CI'da zorlanır.
- `docs/FINAL_REPORT.md`: faz faz yapılanlar, hata → test eşlemesi, metrikler, sınırlamalar.
- Dokümantasyon: README, `docs/ARCHITECTURE.md`, ADR 0001–0009, `docs/METHODOLOGY.md`, `docs/MODEL_CARD.md`, `docs/COMPLIANCE.md`, `docs/DEMO_SCRIPT.md`, MIT lisansı.

### Changed

- Next.js 16, React 19, ESLint 9 (flat config) ve Vitest 5'e yükseltme; `src/middleware.ts` → `src/proxy.ts` (ADR 0009).
- Kimlik doğrulama yalnızca `jose`: 15 dk access token + rotating refresh token (yeniden kullanımda aile iptali), POST-only logout, sabit zamanlı login; localStorage'da token tutulmuyor.
- Kuyruk tanımı ile worker ayrıldı; arama cache'i `KEYS` taraması yerine sürüm anahtarlı.
- Rota optimizasyonu açık yol Held-Karp ve asimetrik maliyete güvenli yerel arama (2-opt + or-opt) ile yeniden yazıldı; modül dürüst adıyla belgelendi.
- Eski "sentiment trigger" modülü, admin onaylı ve tavanlı olay sinyali motoruyla değiştirildi.
- Docker imajları sırsız; compose sırları `secrets-init` ile üretir, Postgres/Redis host'a açılmaz, Redis parolalı; gRPC servisi compose'a eklendi.
- `.env.example` tüm ortam değişkenlerini belgeler.
- PDP galerisi Unsplash CDN'inde boyutlandırılmış `srcset` kullanır (önceden optimize edilmemiş 1200 px görseller); küçük resimler düşük öncelikli yüklenir.
- `LOG_TO_STDERR=true` ile loglar stderr'e yazılabilir (stdio protokollü süreçler için).

### Fixed

- Compose demosunda çerezli tüm POST/PUT/DELETE istekleri `403 CSRF_REJECTED` alıyordu (standalone sunucunun `0.0.0.0` origin'i); hedef origin artık `Host` başlığından türetilir.
- `.env.example`'daki `DEMO_SEED=false`, `cp .env.example .env` sonrası compose demosunun seed yüklemesini engelliyordu.
- Erişilebilirlik: arama çubuğu etiket kontrastı, devre dışı buton kontrastı, footer başlık sırası, `prefers-reduced-motion` desteği.

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
