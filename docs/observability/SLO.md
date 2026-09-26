# SLO'lar ve alarmlar (P0-6)

Bu belge platformun servis seviyesi hedeflerini (SLO), her birinin **nasıl ölçüldüğünü**
(Prometheus sorgusu), alarm kurallarını ve ilk müdahale adımlarını tanımlar. Kurallar
`docker/observability/alerts.yml` dosyasındadır (`promtool check rules` ile doğrulanır) ve
`docker compose --profile observability up` ile Prometheus'a yüklenir. Paneller:
`docs/observability/grafana-dashboard.json` ("SLO (P0-6)" ve "Sepet · bölünmüş ödeme · para"
satırları).

Metrik uçları:

- Web: `GET /api/metrics` — `Authorization: Bearer <METRICS_TOKEN>` (token < 16 karakterse uç
  kapalıdır, 503). İş sayaçlarının bilinen etiket kombinasyonları **0 ile önceden oluşturulur**
  (`primeBusinessMetrics`), böylece `increase()` tabanlı kurallar olay hiç yaşanmamışken de
  seri görür ("veri yok" ile "sıfır" karışmaz).
- Worker: `:9464/metrics` (aynı token). Zamanlanmış işlerin sayaçları (mutabakat, iade
  yeniden denemesi, kaldırma SLA taraması, payout) worker sürecinde artar; Prometheus iki
  hedefi de kazır ve kurallar `sum()` ile birleştirir.

## Özet tablo

| #   | SLO                         | Hedef                             | Pencere | Alarm (alerts.yml)                                | Önem   |
| --- | --------------------------- | --------------------------------- | ------- | ------------------------------------------------- | ------ |
| 1   | Rezervasyon/tutma gecikmesi | p99 < 1 s                         | 5 dk    | `BookingLatencyP99High` (10 dk sürerse)           | page   |
| 2   | Ödeme başarı oranı          | ≥ %97 (sistem kaynaklı hatalar)   | 30 dk   | `PaymentSuccessRatioLow` (15 dk, ≥ 20 deneme)     | page   |
| 3   | Defter dengesi              | `ledger_imbalance_total` artışı 0 | 15 dk   | `LedgerImbalanceDetected` (beklemesiz)            | page   |
| 3b  | Günlük mutabakat koşuyor    | 26 saatte ≥ 1 koşu                | 26 s    | `LedgerReconciliationNotRunning`                  | ticket |
| 4   | 7565 kaldırma SLA'sı        | ihlal 0 (varsayılan 24 saat)      | 1 s     | `TakedownSlaBreached` (beklemesiz)                | page   |
| —   | Para hijyeni (bilgi)        | —                                 | —       | `RefundRetryFailing`, `LatePaymentRefundSpike`, … | ticket |

Hata bütçesi: SLO-1 ve SLO-2 için aylık %1 (≈ 7 saat 18 dk) ihlal süresi. SLO-3 ve SLO-4
**sıfır toleranslıdır**: tek olay bütçeyi tüketir ve olay sonrası inceleme (postmortem)
gerektirir.

## SLO-1 — Rezervasyon p99 < 1 s

**SLI:** `POST /api/bookings` (route etiketi `bookings`) ve `POST /api/cart/:id/hold`
(`cart.hold`) yanıt süresinin 99. yüzdeliği. Kaynak histogram
`http_request_duration_seconds{route,method,status}` (kovalar 5 ms … 10 s). 409 (dolu /
kilit meşgul) yanıtları da sayılır: kullanıcı bekleme süresi açısından eşdeğerdir.

```promql
histogram_quantile(0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket{route=~"bookings|cart.hold",method="POST"}[5m])))
```

Kayıt kuralı: `booking:create_latency_seconds:p99_5m`.

**İlk müdahale:** Grafana "DB sorgu p95" ve Redis sağlığı (`/api/ready`); `cart_hold_total{outcome="busy"}`
artıyorsa kilit çekişmesi (aynı oda tipine yoğun talep) — ölçek değil, beklenen davranış;
`TRANSACTION_CONFLICT` (409) artışı serileştirme yeniden denemelerinin tükendiğini gösterir.

## SLO-2 — Ödeme başarı oranı ≥ %97

**SLI:** tekil rezervasyon (`payment_attempts_total`) ve sepet (`cart_payment_total`)
ödemelerinde `confirmed` / (`confirmed` + `capture_failed` + `compensated`). **Kullanıcı
kaynaklı sonuçlar paydada yok:** kart reddi (`declined`), 3DS bekleyen (`requires_action`),
fraud engeli ve step-up istemi sistem arızası değildir.

```promql
sum(increase(payment_attempts_total{outcome="confirmed"}[30m]) + increase(cart_payment_total{outcome="confirmed"}[30m]))
/ clamp_min(sum(increase(payment_attempts_total{outcome=~"confirmed|capture_failed|compensated"}[30m])
  + increase(cart_payment_total{outcome=~"confirmed|capture_failed|compensated"}[30m])), 1)
```

Alarm düşük hacimde gürültü üretmesin diye en az 20 deneme şartı vardır.

**İlk müdahale:** PSP durum sayfası; `saga_compensation_total` (tahsilat sonrası telafi) ve
`refund_retry_total{outcome="failed"}`; bölünmüş ödemede `split_share_payment_total`. PSP
yavaşlaması/kısmi kesintisi `MOCK_PSP_*` kaos ayarlarıyla yeniden üretilebilir
(`docs/perf/p2-3-load-chaos.md`).

## SLO-3 — Defter dengesizliği = 0

**SLI:** `ledger_imbalance_total{source}` — `app` (uygulama jurnal yazımında Σborç ≠ Σalacak
yakaladı), `db` (veritabanı tetikleyicisi dengesiz jurnali reddetti), `reconciliation`
(günlük mutabakatın bulduğu dengesiz jurnal sayısı). Mutabakatın kendisi
`ledger_reconciliation_runs_total` ile izlenir (26 saatte hiç koşmadıysa ticket).

```promql
sum by (source) (increase(ledger_imbalance_total[15m])) > 0
```

**İlk müdahale:** ilgili jurnali (`JournalEntry.idempotencyKey`) bulun; yeni para hareketini
(payout) durdurmayı değerlendirin; `GET /api/admin/reconciliation` raporundaki
`differences` satırlarını PSP kayıtlarıyla karşılaştırın. Yük testinde bu değer ve mizan
farkı **0** olmalıdır (bkz. `scripts/load-assert.ts`).

## SLO-4 — 7565 kaldırma SLA'sı

**SLI:** `takedown_sla_breach_total{source}` (MINISTRY_7565 | COURT_ORDER | OTHER_AUTHORITY);
`takedown_received_total` ile oranlanabilir. Tarama `compliance` kuyruğunda periyodik koşar.

```promql
sum by (source) (increase(takedown_sla_breach_total[1h])) > 0
```

**İlk müdahale:** `/admin/compliance` kuyruğundaki açık talebi işleyin; ihlal kaydı denetim
izine (AuditLog) yazılmıştır.

## Saga telafisi (page)

`SagaCompensationFailed` — 15 dk içinde herhangi bir `saga_compensation_total{outcome="failed"}`.
Telafi adımı (PSP iadesi/void'i, tutma serbest bırakma) düştüğünde saga yeniden denemez; PSP'de
yetkilendirilmiş ya da tahsil edilmiş tutar askıda kalabilir (P2-3 kaos koşusunda 2 sepet
`CANCELLED` + `CartPayment AUTHORIZED` kaldı).

**İlk müdahale:** logda `saga compensation failed` satırının `saga`/`step`'i → ilgili sepet/
rezervasyonun `CartPayment`/`Payment` durumu → PSP panelinden void/iade; ardından
`scripts/load-assert.ts` benzeri mutabakat.

## Para hijyeni alarmları (ticket)

| Alarm                      | Koşul                                           | Anlamı                                                                                                                             |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `RefundRetryFailing`       | 30 dk'da > 5 başarısız/tükenmiş iade denemesi   | PSP iade uç noktası sorunlu; müşteri parası bekliyor                                                                               |
| `LatePaymentRefundSpike`   | 1 saatte > 10 geç başarı iadesi (tekil + sepet) | Tutma TTL'i PSP gecikmesine göre kısa kalıyor olabilir                                                                             |
| `CaptureRaceCompensations` | 15 dk'da > 20 yarış telafisi                    | İstemci/ajan agresif yeniden deniyor (çift ödeme girişimi)                                                                         |
| `SplitPlansAborting`       | 1 saatte > 5 iptal edilen bölünmüş ödeme planı  | Süre kaçırılıyor ya da onay adımı serileştirme çakışmasında düşüyor (`abortReason`; bkz. [yük raporu](../perf/p2-3-load-chaos.md)) |
| `PayoutFailures`           | 1 saatte payout hatası                          | Ev sahibi/devir ödemesi başarısız                                                                                                  |
| `LlmTokenBurnHigh`         | bir rotada saatlik > 2M token                   | Bütçe sızıntısı / kötüye kullanım (`llm_tokens_total{route}`)                                                                      |

## Metrik kataloğu (P0-6)

| Metrik                                  | Tür                 | Etiketler             | Nerede artar                                        |
| --------------------------------------- | ------------------- | --------------------- | --------------------------------------------------- |
| `http_request_duration_seconds`         | histogram           | route, method, status | `observed()` sarmalayıcılı her API uç noktası       |
| `ledger_imbalance_total`                | counter             | source                | jurnal yazımı / DB tetikleyicisi / mutabakat        |
| `refund_retry_total`                    | counter             | outcome               | iade yeniden deneme kuyruğu (worker)                |
| `payment_late_success_total`            | counter             | outcome               | onay penceresi sonrası PSP webhook'u (v4#8)         |
| `llm_tokens_total`                      | counter             | route, task, kind     | canlı LLM çağrısı (demo/fallback token harcamaz)    |
| `takedown_sla_breach_total`             | counter             | source                | kaldırma SLA taraması (worker)                      |
| `payment_attempts_total`                | counter             | outcome               | tekil rezervasyon ödemesi                           |
| `payment_capture_race_total`            | counter             | action                | yarışı kaybeden yetkilendirme/tahsilat telafisi     |
| `cart_hold_total` / `cart_hold_items`   | counter / histogram | outcome / —           | grup sepeti tutması; başarılı tutmanın kalem sayısı |
| `cart_payment_total`                    | counter             | outcome               | sepetin tek ödemesi                                 |
| `cart_late_success_total`               | counter             | subject, outcome      | sepet / pay geç webhook'u                           |
| `split_plan_total`                      | counter             | outcome               | bölünmüş ödeme planı yaşam döngüsü                  |
| `split_share_payment_total`             | counter             | outcome               | pay ödemesi                                         |
| `split_settlement_duration_seconds`     | histogram           | —                     | plan kuruluşundan onaya süre                        |
| `payouts_total`, `escrow_release_total` | counter             | kind, outcome / kind  | payout motoru, emanet/rezerv serbest bırakma        |
| `damage_deposit_events_total`           | counter             | outcome               | hasar depozitosu ön provizyon/tahsil/iptal          |

`llm_tokens_total{route}`: görev → API rotası eşlemesi `src/lib/llm/metrics.ts`
(`LLM_TASK_ROUTE`); etiket kümesi sabittir (kardinalite sınırlı). Demo modunda sağlayıcıya
gidilmediği için bu seri **0 kalır**; canlı çağrıda arttığı entegrasyon testiyle doğrulanır
(`tests/integration/p0-6-metrics.test.ts`).
