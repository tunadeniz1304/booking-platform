# Runbook — Saga telafisi başarısız ve yeniden deneme planlanamadı

- Alarm: `SagaCompensationRetryNotScheduled`
- Önem: page
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Telafi düştü ve `saga-compensation-retry` işi kuyruğa alınamadı (Redis/BullMQ). PSP'de askıda yetkilendirme/tahsilat kalmış olabilir.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- Yarış telafileri ve saga

## Sorgu

```promql
sum by (saga) (increase(saga_compensation_total{outcome="failed"}[15m]))
sum by (saga) (increase(saga_compensation_retry_total{outcome="scheduled"}[15m]))
```

## Müdahale

1. Redis erişimini ve BullMQ bağlantısını doğrulayın (`/api/ready`).
2. Audit `saga.compensation_failed` kayıtlarından etkilenen ödemeleri bulun; PSP panelinde void/iade durumunu kontrol edip gerekirse elle kapatın.

## Geri alma

- Elle yapılan void/iade audit kaydıyla belgelenir; geri alınamaz.
