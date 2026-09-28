# ADR 0028 — Şimdi rezerve et, sonra öde (RNPL)

- Durum: Kabul edildi (v5 P1-3)
- Tarih: 2026-09-28
- İlgili: ADR 0013 (ödeme sagası), ADR 0020 (çift girişli defter), ADR 0027 (ödeme servisi bölünmesi)

## Bağlam

Sektör liderleri (Airbnb "Reserve Now, Pay Later", Booking "pay at property") iade edilebilir
rezervasyonlarda tahsilatı ücretsiz iptal süresinin sonuna erteliyor. Platform yalnız anında
tahsilat (authorize → capture) biliyordu.

## Karar

1. **Uygunluk** (`src/lib/payment/rnpl-terms.ts`, saf): `RNPL_ENABLED`, tekil (sepetsiz) HELD
   rezervasyon, iade edilebilir tarife, politika snapshot'ında %100 iade basamağı (ücretsiz iptal
   bitişi = giriş anı − en büyük `hoursBefore`), vade = bitiş − `RNPL_CHARGE_DAYS_BEFORE_DEADLINE`
   gün ve vade en az `RNPL_MIN_LEAD_HOURS` sonra. Cüzdan kredisiyle birlikte kullanılmaz. Fraud:
   yalnız risk kararı `allow` (3DS/step-up/review gerektiren ödeme şimdi ödenir).
2. **Kart kaydı**: PSP arayüzüne opsiyonel `setupCard` (Stripe SetupIntent, `usage=off_session`;
   MockPsp `pm_mock_…`) ve `chargeSaved` (off-session, otomatik capture'lı PaymentIntent). Kaos
   sarmalayıcısı iki metodu da bozabilir. Metot yoksa RNPL sunulmaz.
3. **Rezervasyon anı** (tek SERIALIZABLE işlem): HELD→CONFIRMED + envanter held→sold
   (`applyConfirmation`, `journal: false`), ödeme satırı `PENDING` (providerRef yok),
   `PaymentSchedule` `SCHEDULED`. Jurnal yazılmaz: para hareketi yok (Σ=0).
4. **Tahsilat** (`rnpl-charge` gecikmeli BullMQ işi + `rnpl-sweep` yedek cron'u, `rnpl` kuyruğu):
   ödeme kilidi altında; deneme numarası PSP çağrısından ÖNCE yazılır (`in_flight` işareti) ve
   idempotency anahtarı `rnpl:<plan>:<deneme>` olur — çökme sonrası aynı anahtar yeniden
   kullanılır (çift tahsilat yok), başarısız deneme sonrası yeni anahtar (Stripe ret sonucunu
   önbelleğe aldığından aynı anahtarla yeniden deneme anlamsız). Başarı: ödeme PAID + plan
   CAPTURED + `booking-captured` jurnali tek işlemde.
5. **Başarısızlık**: plan `RETRYING`, outbox `payment.rnpl_charge_failed` → misafire e-posta,
   `RNPL_RETRY_INTERVAL_HOURS` aralıkla yeniden deneme; ilk başarısızlıktan `RNPL_GRACE_HOURS`
   sonra hâlâ ödenmemişse rezervasyon otomatik iptal (`BookingCancelled`, gerekçe `rnpl_payment_failed`), envanter bırakılır, ödeme VOIDED, plan `DEFAULTED`.
6. **İptal**: misafir iptali (`cancelAndRefund`) aynı işlemde açık planı `CANCELLED` yapar; ödeme
   PENDING olduğundan iade 0 ve PSP çağrısı yok. Tahsilattan sonra iptal normal iade yolundan
   geçer (ücretsiz iptal süresi hâlâ açıksa %100). İş, rezervasyon CONFIRMED değilse planı
   iptal eder (başka iptal yolları için güvenlik ağı).
7. **Gözlemlenebilirlik**: `rnpl_charge_total{outcome=scheduled|captured|failed|defaulted|cancelled|risk_rejected}`.
8. **API/UI**: `GET /api/bookings/{id}/rnpl` teklif; `POST /api/bookings/{id}/pay` gövdesinde
   `paymentOption: "rnpl"` → 200 `status: scheduled`; uygun değilse 409 `RNPL_UNAVAILABLE`.
   Checkout (mock form) "bugün 0, <tarih>'te X" seçeneği + iptal zaman çizelgesi (tr/en).

## Sonuçlar

- Vadeye kadar envanter satılı, para hareketi yok; mutabakat `paidAt` dolu ödemeleri
  karşılaştırdığından PENDING RNPL satırı fark üretmez.
- Stripe'ta istemci tarafı SetupIntent (Payment Element `mode: setup`) bu fazda yok: RNPL
  seçeneği yalnız mock formda gösterilir; sunucu Stripe sağlayıcısını destekler.
- Otomatik iptal ücretsiz iptal bitişine yakın gerçekleşir (vade + ek süre ≈ bitiş); misafir
  iptal ücreti ödemez çünkü hiç tahsilat yapılmamıştır.
