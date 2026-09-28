# Runbook — Geç gelen başarılı ödemeler topluca iade ediliyor

- Alarm: `LatePaymentRefundSpike`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Tutma süresi dolduktan sonra gelen başarılı ödemeler saatte 10'dan fazla iade ediliyor (`payment_late_success_total`, `cart_late_success_total`). Misafir para çekilip iade edildiğini görür.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- Geç ödeme başarısı ve iade yeniden denemeleri

## Sorgu

```promql
sum by (outcome) (increase(payment_late_success_total[1h]))
sum by (outcome) (increase(cart_late_success_total[1h]))
```

## Müdahale

1. PSP webhook gecikmesini kontrol edin (`WebhookLatencyBurnRate*`).
2. Tutma TTL'i çok kısa mı? `BOOKING_HOLD_TTL_MINUTES` / `CART_HOLD_TTL_MINUTES` ayarlarını ve 3DS süresini karşılaştırın.

## Geri alma

- TTL artırıldıysa olay sonrası eski değere dönmeyi değerlendirin (envanter kilitlenme süresi uzar).
