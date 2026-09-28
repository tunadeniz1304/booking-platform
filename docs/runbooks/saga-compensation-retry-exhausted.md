# Runbook — Saga telafisi tüm denemelerde düştü

- Alarm: `SagaCompensationRetryExhausted`
- Önem: page
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Yeniden deneme bütçesi bitti (`saga_compensation_retry_total{outcome="exhausted"}`); audit `saga.compensation_exhausted`. Elle void/iade gerekir.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- Yarış telafileri ve saga

## Sorgu

```promql
sum by (saga) (increase(saga_compensation_retry_total{outcome="exhausted"}[30m]))
```

## Müdahale

1. Audit kaydından ödeme referansını alın, PSP panelinde void/iade edin.
2. Kök nedeni (PSP kesintisi, geçersiz referans) belirleyip postmortem açın.

## Geri alma

- Elle işlem geri alınamaz; çift iadeyi önlemek için önce PSP durumunu okuyun.
