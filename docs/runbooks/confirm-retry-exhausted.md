# Runbook — confirm-retry işi tüm denemelerde düştü

- Alarm: `ConfirmRetryExhausted`
- Önem: page
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Capture alınmış ödeme ne onaylandı ne iade edildi (`confirm_retry_total{outcome="exhausted"}`). Misafirden para çekilmiş, rezervasyon belirsiz.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- Sepet tutma sonuçları

## Sorgu

```promql
sum by (outcome) (increase(confirm_retry_total[30m]))
```

## Müdahale

1. Worker loglarından etkilenen sepet/rezervasyonu bulun; envanter uygunsa elle onaylayın, değilse iade edin.
2. Misafire bilgilendirme e-postası gönderin.

## Geri alma

- Elle onay sonrası iptal, normal iptal/iade akışıyla yapılır.
