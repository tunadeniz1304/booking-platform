# ADR 0001 — Modüler monolit ve bounded context'ler

- Durum: Kabul edildi
- Tarih: 2026-09-24

## Bağlam

Platformun rezervasyon, envanter, fiyat, ödeme, yorum, transfer ve GenAI özellikleri var. Tek geliştiricili bir portföy projesinde mikroservis dağıtımı (ayrı veritabanları, ağ üzerinden tutarlılık, dağıtık işlem) çözdüğünden fazla sorun üretir; öte yandan her şeyin tek yerde karışması çift rezervasyon garantisi gibi kritik kuralların denetlenmesini zorlaştırır.

## Karar

- Tek dağıtım birimi: Next.js 16 uygulaması (`src/app`) + aynı kod tabanını kullanan süreçler: BullMQ worker'ı (`src/worker/index.ts`), iç gRPC servisi (`services/grpc/main.ts`), migration görevi.
- İş mantığı `src/lib/<context>/` klasörlerinde (Identity, Catalog, Inventory, Booking, Pricing, Payment, Transfer, Search, Reviews, AI/LLM, Risk, Notifications, Messaging, Admin/Privacy, Observability). Route handler'lar incedir.
- Context'ler arası yan etkiler transactional outbox olaylarıyla (ADR 0003) iletilir; ör. `PropertyCreated` → embedding, rezervasyon onayı → e-posta.
- Kuyruk tanımı (producer, `src/lib/queue.ts`) ile worker ayrıdır; Next sunucusu import sırasında Worker veya kuyruk bağlantısı açmaz.
- Kullanılmayan kod silindi (eski saga, command/query bus, boş routing dosyası, ölü fiyat kuyruğu fonksiyonları).
- Eski `.github/workflows/deploy.yml` **kaldırıldı**: gerçek bir deploy hedefi yoktu ve sırları Docker build argümanı olarak imaj katmanlarına geçiriyordu. Yerine yalnızca `ci.yml` var (lint → typecheck → format → unit + coverage → integration → `next build` → `docker compose build` → `npm audit`).

## Sonuçlar

- Tek Postgres transaction'ı içinde güçlü tutarlılık (rezervasyon + envanter + outbox) mümkün.
- Bir context ileride ayrılmak istenirse sınır zaten klasör ve olay seviyesinde çizili; gRPC servisi bu yönde bir örnek.
- Dezavantaj: tüm süreçler aynı şemayı paylaşır; şema değişiklikleri hepsini etkiler (Prisma migration disiplini ile yönetilir).
