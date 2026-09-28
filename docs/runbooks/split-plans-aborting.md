# Runbook — Bölünmüş ödeme planları iptal oluyor

- Alarm: `SplitPlansAborting`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Saatte 5'ten fazla bölünmüş ödeme planı `aborted` (süre sonu ya da onayda serileştirme çakışması).

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- Bölünmüş ödeme: plan ve pay sonuçları
- Bölünmüş ödeme onay süresi p50 / p95

## Sorgu

```promql
sum by (outcome) (increase(split_plan_total[1h]))
sum by (outcome) (increase(split_share_payment_total[1h]))
```

## Müdahale

1. Loglarda `abortReason` dağılımına bakın: süre sonuysa pay linkleri geç paylaşılıyor; çakışmaysa onay adımında SERIALIZABLE yeniden deneme bütçesi yetmiyor.
2. Alınan paylar otomatik iade edilmeli: `split_share_payment_total{outcome="refunded"}` artışını doğrulayın.

## Geri alma

- Plan süresi artırıldıysa olay sonrası eski değere dönün.
