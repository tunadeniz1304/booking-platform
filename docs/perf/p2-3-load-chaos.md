# P2-3 — Yük ve kaos testi raporu

Tarih: 2026-09-26 · k6 (`grafana/k6` Docker imajı) · tek makine: Windows 11 + Docker Desktop (aynı
VM'de başka iki proje yığını da çalışıyordu — mutlak gecikmeler üretim ölçeği değildir).

İlgili: [SLO ve alarmlar](../observability/SLO.md) · [önceki k6 sonuçları](k6-results.md)

## Ortam ve koşum

```sh
# Yığın (demo + yük override'ı; Grafana/Tempo gerekmez, Prometheus yeter)
docker compose -p p23 -f docker-compose.yml -f docker-compose.demo.yml -f docker-compose.load.yml \
  up -d --build app worker grpc prometheus
# Yük verisi: 120 doğrulanmış hesap + stok sınırlı otel (4 oda tipi × 5 birim) → son satır LOAD_ROOMS=
docker compose -p p23 exec -T worker sh /usr/local/bin/entrypoint.sh npx tsx scripts/seed-load.ts
# k6 (compose iç ağından)
docker run --rm -i --network p23_default -e BASE_URL=http://app:3000 -e LOAD_ACCOUNTS=120 \
  -e LOAD_ROOMS=<...> grafana/k6 run - < load/<betik>.js
# Değişmezler (ihlalde çıkış kodu 1)
docker compose -p p23 exec -T worker sh /usr/local/bin/entrypoint.sh \
  npx tsx --conditions=react-server scripts/load-assert.ts
```

- `docker-compose.load.yml`: `RATE_LIMIT_DEMO_RELAX_MULTIPLIER=1000` (tüm kategoriler + hesap başına
  giriş; yalnız DEMO_MODE'da etkin), fraud hız sınırları gevşek, `SPLIT_PAY_DEADLINE_MINUTES=5`,
  `SPLIT_PAY_FALLBACK=refund`, `MOCK_PSP_*` kaos ayarları host ortamından (varsayılan 0 = kapalı).
- `docker compose exec` giriş noktasını atlar; sırların (DATABASE_URL vb.) yüklenmesi için komutlar
  `entrypoint.sh` üzerinden çalıştırılır.
- Test verisi tüm koşumlarda aynı 4 oda tipini kullanır: **bilerek sıcak nokta** (gecede 20 birim).

## Değişmezler — tüm koşumlardan sonra (`scripts/load-assert.ts`)

| Kontrol                                                                                | Sonuç                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Aşırı satış (sayaç `sold + held ≤ total` + bağımsız rezervasyon sayımı)                | **0 / 0** ✓                                          |
| Defter: mizan (Σborç = Σalacak) · dengesiz jurnal                                      | dengeli · **0** ✓                                    |
| Mutabakat (PSP olayları ↔ jurnal, bugün)                                               | 1 198 kayıt denetlendi · **0 fark · 0 yetim olay** ✓ |
| Çift capture (jurnal · eski çift tahsilat · açık planda capture · SETTLED uyuşmazlığı) | **0 / 0 / 0 / 0** ✓                                  |

Her koşumdan sonra ayrıca çalıştırıldı (cart-spike, split, webhook-storm, PSP kaosu, Redis kaosu);
hiçbirinde ihlal yok. Son durum: 360 CONFIRMED · 239 CANCELLED (239 REFUNDED ödeme) · 120
SETTLED / 154 ABORTED bölünmüş plan · 347 capture edilmiş / 267 iade edilmiş pay · 853 jurnal kaydı.

## Sonuçlar (normal PSP)

### Sepet ani yükü — `load/cart-spike.js` (`PAY=1`, 2 kalem × 2 gece)

| VU / süre  | Tutma 200 / 409 | Ödenen sepet | Kısmi tutma | 5xx |      Atomiklik |   Tutma p95 | Eşik (p95 < 2 s) |
| ---------- | --------------: | -----------: | ----------: | --: | -------------: | ----------: | ---------------- |
| 100 / 30 s |        15 / 202 |           10 |           0 |   0 | %100 (217/217) | **10.07 s** | ✗                |
| 20 / 30 s  |         15 / 43 |           10 |           0 |   0 |   %100 (58/58) |  **5.72 s** | ✗                |

- 10 ödenen sepet = kapasite (20 birim ÷ 2 kalem); geri kalan 409'lar doğru "tükendi" yanıtı.
- **Bulgu (gecikme):** tutma p95 eşiği aşıyor. Tüm VU'lar aynı 4 envanter satırında; sepet ödemesi
  onay adımında `40001 could not serialize access` çakışmaları (22 "serialization conflict after
  retries", 10 "saga step failed", 1 "saga compensation failed") görüldü. Para/değişmez ihlali yok
  (başarısız sepetler CANCELLED + tutmalar serbest), ama sıcak noktada kuyruklanma ciddi.

### Bölünmüş ödeme yarışı — `load/split-payment-race.js`

`share_race`: 10 VU × 5 plan; her planın aynı payını 4 farklı hesap aynı anda öder.

| Koşum                                                                           |  Kazanan / kaybeden | Çift yetkilendirme | 5xx | SETTLED / plan |      Pay ödeme p95 |
| ------------------------------------------------------------------------------- | ------------------: | -----------------: | --: | -------------: | -----------------: |
| deadline senaryosuyla birlikte (`DB_SERIALIZABLE_RETRY_ATTEMPTS=6`, varsayılan) |            50 / 150 |              **0** |   0 |    **18 / 50** |             1.30 s |
| yalnız share_race, deneme = 6 (kontrol)                                         |            50 / 150 |              **0** |   0 |    **13 / 50** |             1.72 s |
| yalnız share_race, deneme = 12 (deney)                                          |            50 / 150 |              **0** |   0 |    **50 / 50** | 1.75 s (maks 52 s) |
| son koşum (betik düzeltmeleri sonrası, deneme = 6)                              | 34 / 110 (36 yarış) |              **0** |   0 |    **18 / 36** |             1.18 s |

- Son koşumda 14 yineleme plan kuramadı (`CART_NOT_HELD` / `CART_INCOMPLETE`: organizatör hesaplarında
  önceki koşumlardan kalan açık sepetler — test verisi kirliliği); 2 yarışta hiç kazanan çıkmadı
  (plan yarıştan önce kapanmış, muhtemelen aynı neden). Temiz veritabanında ilk üç koşum 50/50 yarış.
- ✓ Aynı paya **her zaman tek yetkilendirme** (200 × 1, diğerleri 409), çift capture yok.
- **Bulgu (ürün, önemli):** tüm payları ödenmiş planların %64–74'ü `SPLIT_NOT_CONFIRMABLE` ile
  iptal oluyor. Nedeni: SERIALIZABLE onay (pivot) işlemi, aynı envanter/defter satırlarına eşzamanlı
  yazan planlarla çakışıyor (`booking`, `cartPayment`, `splitPlan`, `ledgerEntry`, `journalLine`
  güncellemelerinde "write conflict or deadlock"); 6 deneme (~1 s toplam geri çekilme) tükenince saga
  telafiye geçiyor → capture edilen paylar **iade**, tutmalar serbest. Para güvenli, ama ödeme yapmış
  katılımcılar rezervasyonu kaybediyor. Deneme sayısı 12'ye çıkınca 50/50 SETTLED — sorun geçici
  çakışmanın kalıcı hata sayılması. Global varsayılanı yükseltmek önerilmez (12 denemede en kötü
  geri çekilme 30–60 s, tüm SERIALIZABLE işlemler etkilenir); öneri: pivot onayına özel, üst sınırlı
  geri çekilmeli daha uzun deneme bütçesi ya da onayı kuyruğa alıp yeniden denemek (telafiye geçmeden).
  Aynı desen tekil sepet ödemesinde (`cart_payment` saga, `confirm` adımı) de görüldü.

`deadline_race`: 18 plan (organizatör payı ödenmiş, 1 pay açık); açık pay süre sonunun ±4 s
çevresinde ödenir.

| Plan | Süreden önce ödendi (200) → SETTLED | Süreden sonra reddedildi (409/410) → kapalı | Tutarsız | 5xx |
| ---: | ----------------------------------: | ------------------------------------------: | -------: | --: |
|   20 |                 10 → **10 SETTLED** |      10 → **10 ABORTED** (`SPLIT_DEADLINE`) |    **0** |   0 |

- ✓ Süre sonu işi ile son ödeme yarışında karma durum yok: ödeme kabul edildiyse plan SETTLED,
  reddedildiyse hiçbir pay CAPTURED kalmıyor (`capturedOnOpenPlan = 0`, `settledMismatch = 0`).

### PSP webhook fırtınası — `load/webhook-storm.js`

200 rezervasyon (3DS ile başlatılmış); ~%20'si webhook'tan önce iptal edilir. Her rezervasyon için
karışık sırada ve eşzamanlı: aynı `payment.succeeded` 3 kez, farklı kimlikle ikinci başarı,
`payment.failed`, %10 bozuk imzalı kopya.

| Gönderilen | Tekrar (duplicate) onayı | Bozuk imza (400) |   5xx | Son durum                             | Webhook p95 |
| ---------: | -----------------------: | ---------------: | ----: | ------------------------------------- | ----------: |
|      1 023 |                      400 |               23 | **0** | 159 CONFIRMED · 41 CANCELLED (iade) ✓ |      1.94 s |

- İptal edilen 41 rezervasyonun tamamı `REFUNDED`; beklenmeyen son durum 0.
- **Bulgu (metrik):** `payment_late_success_total{outcome="refunded"}` 184 (41 rezervasyon için).
  Eşzamanlı tekrar teslimler, çakışan onay işlemiyle birlikte olay kaydı da geri alındığı için
  yeniden işleniyor; iade PSP'de idempotent (`compensate:<ref>`) ve jurnal tek sefer
  (`marked.count === 1`) — para güvenli, sayaç "teslim" sayıyor, "ödeme" değil. Alarm eşiği bu
  yüzden `increase() > 10` (adet değil eğilim).

## Kaos

### PSP gecikmesi + hata (`MOCK_PSP_LATENCY_MS=300`, `MOCK_PSP_JITTER_MS=200`, `MOCK_PSP_FAILURE_RATE=0.1`, `FAILURE_OPS=capture,refund`)

MockPsp süreç içidir; toxiproxy araya giremez → kaos `src/lib/payment/chaos-psp.ts` sarmalayıcısıyla
(yalnız mock sağlayıcı, varsayılan kapalı).

| Senaryo                                               | Sonuç                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| webhook-storm (200 rez., 42 iptal)                    | 53 × 500 (hepsi geç başarı iadesinde PSP `refund` hatası → PSP yeniden teslimine bırakılır); 42/42 iptal sonunda REFUNDED; **3 rezervasyon HELD + ödeme FAILED** kaldı (tüm teslimlerde iade düştü; k6 yeniden teslim etmez) |
| cart-spike (50 VU, `PAY=1`)                           | 2 × 500 (`cart.pay` capture hatası `PaymentProviderError` → 500); 6 saga telafisi başarısız (4 `hold` serileştirme, 2 `capture` → PSP iadesi düştü) → **2 sepet CANCELLED + CartPayment AUTHORIZED** kaldı                   |
| 156 CONFIRMED rezervasyonu iptal (iade kaosu altında) | 156 × 200; 16 iade yeniden denemeye planlandı → worker 16'sını başardı (1 ara hata) · `refund_retry_total{scheduled}=16, {succeeded}=16, {failed}=1` · 198/198 REFUNDED ✓                                                    |

Değişmezler kaos sonrası da temiz (aşırı satış 0, defter dengeli, mutabakat 0 fark, çift capture 0).

Bulgular:

1. **PSP hatası 500 dönüyor** (`PaymentProviderError` bir `HttpError` değil) — istemci için 502/503 +
   `Retry-After` daha doğru olur; webhook'ta 5xx ise bilinçli (PSP yeniden teslim etsin).
2. **Başarısız saga telafisi kendiliğinden yeniden denenmez** (tasarım: log + metrik + elle müdahale).
   Kaosta PSP'de askıda yetkilendirme kaldı. Bu durum için alarm yoktu → `SagaCompensationFailed`
   (page) eklendi (`docker/observability/alerts.yml`, promtool ✓ 14 kural; runbook SLO.md'de).
3. Geç başarı iadesi (webhook yolu) iç yeniden deneme kuyruğunu kullanmıyor; yalnız PSP yeniden
   teslimine güveniyor. Üretim PSP'lerinde (Stripe: 3 gün) kabul edilebilir; mock/kaos testinde 3
   rezervasyon bu yüzden askıda kaldı.

### Redis kesintisi (`docker compose pause redis`, 15 s, cart-spike 30 VU / 60 s ortasında)

- Kesinti penceresinde (22:00:44–22:00:58) JWT denylist kontrolü **fail-closed** (240 log satırı;
  istek reddedilir) ve rate-limit `503` → k6: 210 × 5xx, hepsi pencere içinde.
- `unpause` sonrası **anında toparlanma** (health 200; sonraki istekler normal). Atomiklik %100,
  kısmi tutma 0, değişmezler temiz.

## Metrikler (P0-6) — koşumlar sırasında gözlenen maksimum değer

| Seri                                                                                                                    |                               Değer | Not                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------: | ------------------------------------------------------------------------------------------------------------------------------ |
| `booking_created_total`                                                                                                 |                               1 128 |                                                                                                                                |
| `cart_hold_total` / `cart_hold_items` (_count)                                                                          |                            328 / 83 |                                                                                                                                |
| `cart_payment_total`                                                                                                    |                                  30 |                                                                                                                                |
| `split_plan_total` / `split_share_payment_total`                                                                        |                           100 / 300 |                                                                                                                                |
| `split_settlement_duration_seconds` (_count)                                                                            |                                  13 |                                                                                                                                |
| `payment_attempts_total`                                                                                                |                                 201 |                                                                                                                                |
| `payment_capture_race_total`                                                                                            |                                 469 | webhook fırtınası                                                                                                              |
| `payment_late_success_total`                                                                                            |                                 286 | reconfirmed + refunded                                                                                                         |
| `refund_retry_total`                                                                                                    | 16 planlandı · 16 başarılı · 1 hata | app + worker (PSP kaosu)                                                                                                       |
| `saga_compensation_total{outcome="failed"}`                                                                             |                                   6 | PSP kaosu                                                                                                                      |
| `ledger_imbalance_total`                                                                                                |                                   0 | beklenen (dengesizlik yok)                                                                                                     |
| `takedown_sla_breach_total`, `llm_tokens_total`, `payouts_total`, `escrow_release_total`, `damage_deposit_events_total` |                                   0 | bu betiklerle tetiklenmez (demo: canlı LLM yok); sıfırdan farklı değer `tests/integration/p0-6-metrics.test.ts` ile doğrulanır |

Prometheus (`booking-web`, `booking-worker` hedefleri `up`): koşum sonunda `SplitPlansAborting`,
`CaptureRaceCompensations`, `LatePaymentRefundSpike` **firing**, `BookingLatencyP99High` pending —
alarm kuralları gerçek trafikle tetikleniyor.

## Yük betiklerinde düzeltilen hatalar (koşum sırasında bulundu)

- Giriş yanıtının oturum çerezi k6 VU kavanozuna girip sonraki Bearer isteklerini çerezli yapıyordu →
  uygulama doğru biçimde `403 CSRF_REJECTED` döndü. Girişler artık geçici `CookieJar` ile yapılıyor.
- `POST /api/bookings` yanıtı `{ booking: {...} }` sarmalı; MockPsp referansı cüzdan kredisini de
  içeriyor (`auth:<id>:<key>:<creditMinor>`).
- `__VU` senaryolar arası global → deadline planları yanlış indekslenmişti; erişim token'ı (5 dk)
  plan süresiyle aynı → deadline ödemeleri süresi dolmuş token'la gidiyordu (ilk koşumun "0 tutarsız"
  sonucu bu yüzden geçersiz; son durum okunamazsa artık tutarsız sayılıyor).
- `seed-load.ts`: ülke adı `"Türkiye"` (kod değil).

## fix-sweep-3 sonrası

Tarih: 2026-09-27 · Docker yığını **kurulmadı** (C: diskinde ~2 GB boş; app/worker imajlarının
yeniden derlenmesi sığmıyordu). Bunun yerine aynı kod `next build` + `next start` ve
`npm run worker` olarak host'ta, tek `pgvector/pgvector:pg16` + `redis:7-alpine` konteynerine
karşı koşuldu; ortam `docker-compose.load.yml` ile aynı (DEMO_MODE, gevşek rate-limit/fraud,
`SPLIT_PAY_DEADLINE_MINUTES=5`, `SPLIT_PAY_FALLBACK=refund`), veri `prisma/seed.ts` +
`scripts/seed-load.ts`. k6 `grafana/k6` konteynerinden `host.docker.internal`'a. Global
`DB_SERIALIZABLE_RETRY_ATTEMPTS` **6 (varsayılan)** tüm koşumlarda. Mutlak gecikmeler önceki
tabloyla karşılaştırılamaz (Docker ağ katmanı yok, iki başka proje yığını yine açıktı).

Değişiklik: capture sonrası SERIALIZABLE onay (pivot) artık iade sebebi değildir — ayrı bütçe
`CONFIRM_SERIALIZABLE_RETRY_ATTEMPTS` (12, her bekleme ≤ `CONFIRM_RETRY_MAX_BACKOFF_MS` = 500 ms,
en kötü ≈ 4 s); o da tükenirse `CartPayment.failureCode = CONFIRM_PENDING`, tutmalar tutma süresi
kadar uzatılır, BullMQ `confirm-retry` onaylar (tutma düştüyse aynı işlemde yeniden tutar; envanter
yoksa ya da son denemede iade + iptal). `load/split-payment-race.js` plan `COLLECTING` iken en çok
`CONFIRM_POLL_S` (60) sn bekler.

### Bölünmüş ödeme yarışı — `share_race` (`DEADLINE_PLANS=0`)

| Koşum                                               | Plan (yarış kazananı) | Onay ertelendi → `confirm-retry` | SETTLED (herkes ödedi) | İade | Çift yetk. | 5xx |
| --------------------------------------------------- | --------------------: | -------------------------------: | ---------------------: | ---: | ---------: | --: |
| 10 VU × 5, onay bütçesi 12 (varsayılan)             |                    50 |                          3 → 3 ✓ |          **50 / 50** ✓ |    0 |          0 |   0 |
| 20 VU × 5, onay bütçesi **6** (eski bütçe, kontrol) |                    97 |                        52 → 52 ✓ |          **97 / 97** ✓ |    0 |          0 |   0 |
| 20 VU × 5, onay bütçesi 12 (varsayılan)             |                   100 |                        21 → 21 ✓ |          **99 / 99** ✓ |    0 |          0 |   0 |

- Kontrol koşumu eski davranışın ölçüsüdür: 6 denemelik bütçede 97 planın **52'si (%54)** onayda
  tükendi — fix-sweep-3 öncesi bunların hepsi iade edilirdi (P2-3: %64–74). Şimdi tamamı
  `confirm-retry` ile birkaç saniye içinde SETTLED; iade 0. Hedef (herkesin ödediği planların
  ≥%95'i SETTLED) → **%100**.
- 12 denemelik bütçe ertelemeyi 52 → 21'e indiriyor (yol daha kısa, iş kuyruğu daha az).
- Son koşumdaki 1 SETTLED-olmayan plan "herkes ödedi" değildi: bir yarışçının pay **sahiplenme**
  işlemi (`claimAuthorizedShare`) global 6 denemede tükendi → 409 `TRANSACTION_CONFLICT`, pay açık
  kaldı, k6 teardown sepeti iptal etti. **Yeni bulgu (düzeltildi):** bu durumda PSP yetkilendirmesi
  void edilmiyordu (açık yetkilendirme sızıntısı) → artık void + pay yeniden ödenebilir
  (`v4-fix-sweep-3` testi).
- `load-assert`: aşırı satış 0 · mizan dengede, jurnal dengesizliği 0 · mutabakat 560 kontrol / 0
  fark / 0 yetim olay · çift capture 0, `capturedOnOpenPlan` 0, `settledMismatch` 0.

### PSP kaosu — cart-spike 50 VU, `PAY=1`

| Ayar                                                        | Sonuç                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 300±200 ms, %10 hata, `authorize,capture,refund,void`, 30 s | 3 × 5xx = **3 × 502** `cart.pay` (`PAYMENT_PROVIDER_ERROR`, `Retry-After: 5`; önceden 500); sepet ödemesi `FAILED provider_error:psp_unavailable`, tutmalar korunur                                                                                 |
| 300±200 ms, **%40** hata, `capture,refund,void`, 60 s       | 2 × 502; 2 telafi düştü (1 void, 1 iade) → 2 `saga-compensation-retry` işi: iade 4. denemede, void 8. (son) denemede tamamlandı → **açık yetkilendirme / iade edilmemiş tahsilat 0** (önceden "sepet CANCELLED + CartPayment AUTHORIZED" kalıyordu) |

Değişmezler kaos sonrası da temiz. Tüm konteynerler ve süreçler koşum sonunda kaldırıldı.

### Geç başarı sayacı

`payment_late_success_total{outcome="refunded"}` (ve `cart_late_success_total`) artık yalnız
ödemenin İLK işlenmesinde artar; eşzamanlı / farklı kimlikli tekrar teslimler
`{outcome="redelivered"}`. Webhook fırtınası tekrar koşulmadı; P2-3'teki desen (1 ödeme, 4
eşzamanlı teslim) `tests/integration/v4-fix-sweep-3.test.ts`'te doğrulandı: düzeltme öncesi
`refunded` +4, sonrası +1.
