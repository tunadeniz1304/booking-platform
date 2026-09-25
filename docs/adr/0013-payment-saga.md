# ADR 0013 — Ödeme sagası, telafiler, devir ledger'ı ve payout

- Durum: Kabul edildi (v3, F4)
- Tarih: 2026-09-25
- İlgili: ADR 0002 (iki katmanlı kilit), ADR 0003 (transactional outbox), ADR 0007 (devir)

## Bağlam

Ödeme akışı birden çok sistemi kapsar: envanter tutma (DB), PSP provizyonu ve tahsilatı
(Stripe / mock), rezervasyon onayı ve defter (DB), fatura ve e-posta. v2'de adımlar tek
fonksiyonda sıralıydı; ortadaki bir hata tutmayı açıkta, provizyonu askıda ya da parayı
çekilmiş ama rezervasyonu onaysız bırakabiliyordu. Devredilen rezervasyonun iadesi yeni sahibe
gidiyor, satıcıya ödeme (payout) kaydı tutulmuyordu (v3#4).

## Karar

### Saga (P0-7)

- Adımlar: `hold → authorize → capture → confirm` (senkron, `payment-service`), ardından
  `invoice → notify` (asenkron). Orkestrasyon süreç içindedir (`src/lib/saga/saga.ts`):
  hata olursa o ana kadarki adımların telafileri **ters sırada** çalışır: iade (capture) →
  void (authorize) → tutmayı bırak (hold, `HELD → EXPIRED`, envanter geri, outbox olayı).
- Telafiler idempotent ve bağlama duyarlıdır (tahsil yoksa iade yok; iade anahtarı
  `compensate:<providerRef>`). Başarısız telafi diğerlerini durdurmaz; `saga_compensation_total
{saga, step, outcome}` metriği ve hata logu ile elle müdahaleye düşer.
- **Sıra sapması:** plan `confirm → capture` diyordu; `capture → confirm` seçildi. Böylece
  "CONFIRMED ⇒ para çekilmiş" değişmezi (v3#1) korunur, onay pivot adımı olur ve onaydan
  sonra para asla geri alınmaz.
- Onay aynı işlemde outbox'a `BookingConfirmed` yazar (outbox korunur). Tüketicisi BullMQ
  **FlowProducer** ile `invoice` (çocuk) → `notify` (ebeveyn) akışı kurar; job id'leri
  deterministiktir (`invoice:<id>`), işler idempotenttir (fatura `bookingId` üzerinde unique,
  e-posta dedupe anahtarı). Pivot sonrası hata ileri-kurtarmadır: yeniden deneme, iade değil.
  Redis yoksa akış süreç içinde çalışır (çevrimdışı yedek).
- Her adım için hata enjeksiyonu testi (`tests/integration/v3-saga.test.ts`): tutma bırakılır,
  para void/iade edilir, defter net 0; fatura hatasında rezervasyon onaylı kalır ve yeniden
  deneme tek fatura + tek e-posta üretir.

### BullMQ FlowProducer vs Temporal

Temporal kalıcı iş akışı geçmişi, zaman aşımları ve görselleştirme sunar; fakat ayrı bir küme
(sunucu + DB), yeni SDK ve deterministik iş akışı kodu kısıtı getirir. Saganın telafili kısmı
kısa ve senkron (kullanıcı isteği içinde, ödeme kilidi altında); asenkron kısmı iki idempotent
iş. Mevcut Redis/BullMQ ve outbox bu ihtiyacı karşılıyor → Temporal reddedildi. Adım sayısı
ve süresi (ör. çok günlü onay akışları) büyürse yeniden değerlendirilir.

### Devir iadesi ve payout ledger'ı (#4)

- Devirden sonra iptal iadesi, ödemeyi yapan **alıcının** ödeme aracına gider (`refundTarget`);
  defter kaydı alıcı ödemesine bağlanır.
- Devir talebinde satıcı için `Payout{PENDING}` açılır; mock `payouts` işi (`PAYOUT_CRON`)
  koşullu güncellemeyle (yalnız PENDING) `po_mock_…` referansı yazarak PAID yapar.
- Mock e-Arşiv fatura: GİB entegrasyonu yok; deterministik numara, "DEMO — mali değeri yoktur"
  damgalı PDF (gömülü Geist, OFL).

## Sonuçlar

- (+) Her hata noktasında tutarlı son durum; telafiler ölçülüyor.
- (+) Ek altyapı yok; outbox ve BullMQ yeniden kullanıldı.
- (−) Capture hatası artık ödemeyi `VOIDED/saga_aborted` yapar ve tutmayı bırakır (önceden
  `FAILED`, tutma süresi dolana kadar kalırdı); kullanıcı yeniden rezervasyon yapmalıdır.
- (−) Süreç çökmesi telafi ortasında olursa kalan iş `expireHolds` ve PSP provizyon süresine
  kalır; kalıcı saga günlüğü yoktur.
