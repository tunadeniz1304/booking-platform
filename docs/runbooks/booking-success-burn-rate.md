# Runbook — Rezervasyon başarısı hata bütçesi yanıyor

- Alarm: `BookingSuccessBurnRateFast`, `BookingSuccessBurnRateSlow`
- Önem: page (Fast) · ticket (Slow)
- SLO: SLO-5 — `POST bookings|cart.hold` isteklerinin ≥ %99,5'i 5xx değil (30 günlük bütçe %0,5)
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Rezervasyon/tutma isteklerinde 5xx oranı bütçeyi normalin 14,4 katı (1 s & 5 dk) veya 6 katı (6 s & 30 dk) hızla tüketiyor (Fast); ya da 1 gün & 2 saat boyunca 3 katı (Slow). 409 (dolu/meşgul) iş sonucu olduğu için sayılmaz.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- v5 SLO burn-rate → Burn-rate: rezervasyon başarısı
- İstek oranı (route/status)

## Sorgu

```promql
slo:booking_error_ratio:rate1h / 0.005
slo:booking_error_ratio:rate5m / 0.005
sum by (route, status) (rate(http_request_duration_seconds_count{route=~"bookings|cart.hold",method="POST",status=~"5.."}[5m]))
```

## Müdahale

1. Uygulama loglarında `route=bookings` / `cart.hold` ve `status>=500` satırlarını `requestId` ile Tempo izine bağlayın.
2. DB (`/api/ready`), Redis ve Redlock hatalarını kontrol edin; 503 baskınsa bağımlılık kesintisi.
3. Fast: sayfa — son dağıtımı hemen şüpheli sayın. Slow: iş günü içinde kök neden.

## Geri alma

- Son dağıtımı geri alın; bütçe yanması durduğunda (kısa pencere eşiğin altına iner) alarm kendiliğinden kapanır.
