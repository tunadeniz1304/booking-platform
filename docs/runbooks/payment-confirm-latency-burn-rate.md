# Runbook — 3DS ödeme onayı p99 gecikme bütçesi yanıyor

- Alarm: `PaymentConfirmLatencyBurnRateFast`, `PaymentConfirmLatencyBurnRateSlow`
- Önem: page (Fast) · ticket (Slow)
- SLO: SLO-6 — `POST bookings.pay.confirm|cart.pay.confirm` isteklerinin ≥ %99'u < 2,5 s (p99 < 2,5 s; bütçe %1)
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

3DS onay isteklerinde 2,5 saniyeyi aşanların oranı bütçeyi hızlı (Fast) ya da sürekli (Slow) tüketiyor. Misafir onay ekranında bekler, çift gönderim riski artar.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- v5 SLO burn-rate → Burn-rate: 3DS onay gecikmesi
- API p95 gecikme (s)

## Sorgu

```promql
slo:payment_confirm_slow_ratio:rate1h / 0.01
histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_seconds_bucket{route=~"bookings.pay.confirm|cart.pay.confirm"}[5m])))
```

## Müdahale

1. PSP capture gecikmesini izlerde (Tempo) doğrulayın; PSP yavaşsa durum sayfasını kontrol edin.
2. `pay:<bookingId>` kilidi bekleme süresi uzun mu (eşzamanlı onay/iptal)? Loglarda kilit zaman aşımlarına bakın.
3. Onay kuyruğa düşüyorsa (`202 pending_confirmation`) `confirm_retry_total` artışını izleyin.

## Geri alma

- Ödeme yolunu etkileyen son dağıtımı geri alın.
