# Runbook — Başarısız iade yeniden denemeleri birikiyor

- Alarm: `RefundRetryFailing`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

`refund-retry` kuyruğunda 30 dakikada 5'ten fazla başarısız/tükenen deneme. Misafir iadesi gecikir.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- Geç ödeme başarısı ve iade yeniden denemeleri

## Sorgu

```promql
sum by (outcome) (increase(refund_retry_total[30m]))
```

## Müdahale

1. PSP iade uç noktası hata döndürüyor mu (worker logları, `refund-retry`)?
2. `exhausted` olanlar `REFUND_FAILED` durumunda kalır: elle iade edip audit kaydı düşün.

## Geri alma

- Elle yapılan iade PSP panelinden geri alınamaz; yalnız doğrulanmış kayıtlar için yapın.
