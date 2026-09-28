# Runbook — PSP webhook gecikme bütçesi yanıyor

- Alarm: `WebhookLatencyBurnRateFast`, `WebhookLatencyBurnRateSlow`
- Önem: page (Fast) · ticket (Slow)
- SLO: SLO-7 — `payments.webhook` isteklerinin ≥ %99'u < 1 s (p99 < 1 s; bütçe %1)
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

PSP webhook işleme süresi 1 saniyeyi aşıyor. PSP zaman aşımında yeniden dener; geç onaylar `LatePaymentRefundSpike`'a yol açabilir.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- v5 SLO burn-rate → Burn-rate: webhook gecikmesi
- İstek oranı (route/status)

## Sorgu

```promql
slo:webhook_slow_ratio:rate1h / 0.01
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{route="payments.webhook"}[5m])))
sum by (status) (rate(http_request_duration_seconds_count{route="payments.webhook"}[5m]))
```

## Müdahale

1. Webhook işleyicisi olay kimliğiyle tekilleştirir; yavaşlık genelde DB kilidi veya itiraz (dispute) akışındadır — izlerde en uzun span'e bakın.
2. 400/401 oranı artıyorsa imza sırrı/sağlayıcı uyumsuzluğu (v4#16) — gecikme değil yapılandırma sorunu.

## Geri alma

- Son dağıtımı geri alın; PSP yeniden denemeleri idempotent olduğundan kayıp olay olmaz.
