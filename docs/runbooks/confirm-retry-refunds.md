# Runbook — Ertelenen ödeme onaylarından saatte 5+ iade

- Alarm: `ConfirmRetryRefunds`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Capture alınmış ama onaylanamayan ödemeler `confirm-retry` kuyruğunda iade ediliyor (tutma düştü / bütçe bitti).

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- Sepet tutma sonuçları
- Geç ödeme başarısı ve iade yeniden denemeleri

## Sorgu

```promql
sum by (outcome) (increase(confirm_retry_total[1h]))
```

## Müdahale

1. SERIALIZABLE çakışmalarını ve envanter baskısını (popüler tarih) inceleyin.
2. Yeniden deneme bütçesi (`CONFIRM_RETRY_JOB_ATTEMPTS`, `CONFIRM_RETRY_MAX_BACKOFF_MS`) yetersizse artırmayı değerlendirin.

## Geri alma

- Bütçe değişikliği olay sonrası geri alınabilir.
