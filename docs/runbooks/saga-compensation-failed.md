# Runbook — Saga telafisi başarısız — otomatik yeniden deneme planlandı

- Alarm: `SagaCompensationFailed`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Bir saga adımının telafisi (ör. PSP void/iade) düştü; `saga-compensation-retry` işine devredildi. Tek başına bilgi amaçlı.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- Yarış telafileri ve saga

## Sorgu

```promql
sum by (saga, step) (increase(saga_compensation_total{outcome="failed"}[15m]))
sum by (saga, outcome) (increase(saga_compensation_retry_total[15m]))
```

## Müdahale

1. `SagaCompensationRetryNotScheduled` / `SagaCompensationRetryExhausted` eşlik ediyor mu bakın; etmiyorsa yeniden denemenin başarıyla kapanmasını izleyin.

## Geri alma

- Eylem gerekmez; yeniden deneme işi idempotenttir.
