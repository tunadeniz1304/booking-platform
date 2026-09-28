# Runbook — Rezervasyon/tutma p99 gecikmesi 1 s üstünde

- Alarm: `BookingLatencyP99High`
- Önem: page
- SLO: SLO-1 (docs/observability/SLO.md)
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

`POST /api/bookings` ve `POST /api/cart/:id/hold` isteklerinin 99. yüzdeliği 10 dakikadır 1 saniyenin üstünde. Kullanıcı rezervasyon düğmesinde bekler; tutma TTL'i dolmadan ödeme adımına geçemeyebilir.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- SLO (P0-6) → Rezervasyon/tutma p99 (SLO < 1 s)
- API p95 gecikme (s)
- DB sorgu p95 (s)

## Sorgu

```promql
booking:create_latency_seconds:p99_5m
histogram_quantile(0.99, sum by (le, status) (rate(http_request_duration_seconds_bucket{route=~"bookings|cart.hold",method="POST"}[5m])))
sum by (outcome) (rate(booking_created_total[5m]))  # busy artışı = kilit çekişmesi
histogram_quantile(0.95, sum by (le) (rate(db_query_duration_seconds_bucket[5m])))
```

## Müdahale

1. `booking_created_total{outcome="busy"}` artıyorsa aynı oda için Redlock çekişmesi var: sıcak ilan(lar)ı loglardan (`route=bookings`) bulun.
2. DB p95 yüksekse bağlantı havuzunu ve uzun süren SERIALIZABLE işlemleri kontrol edin (`pg_stat_activity`).
3. Redis gecikmesi: `docker compose exec redis redis-cli --latency` ile ölçün; Redis düşerse kilit alınamaz.
4. Trafik anomalisiyse (bot) rate-limit kovalarını sıkılaştırın.

## Geri alma

- Son dağıtımdan sonra başladıysa önceki imaja dönün (`docker compose up -d app` ile önceki etiket).
- Geçici eşik/limit değişikliklerini (rate-limit) olay kapandıktan sonra geri alın.
