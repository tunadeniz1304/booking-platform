# Runbook — Çok sayıda yarış kaybı telafisi

- Alarm: `CaptureRaceCompensations`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

15 dakikada 20'den fazla yetkilendirme/tahsilat yarışı kaybedip telafi edildi (`payment_capture_race_total{action}`): çift ödeme denemesi.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- Yarış telafileri ve saga

## Sorgu

```promql
sum by (action) (increase(payment_capture_race_total[15m]))
```

## Müdahale

1. İstemci yeniden denemesi (çift tıklama, ağ yeniden denemesi) veya ajan istemcisi aynı ödemeyi tekrarlıyor mu? Loglarda `idempotencyKey` tekrarlarına bakın.
2. Telafilerin (void/iade) PSP'de tamamlandığını doğrulayın.

## Geri alma

- Geçici istemci engelleri (rate-limit) olay sonrası kaldırılır.
