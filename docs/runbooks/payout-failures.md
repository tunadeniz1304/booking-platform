# Runbook — Ev sahibi / devir payout hatası

- Alarm: `PayoutFailures`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Son 1 saatte `payouts_total{outcome=~"failed|error"}` arttı: ev sahibine ya da devir alıcısına ödeme gönderilemedi.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- Payout · emanet · depozito

## Sorgu

```promql
sum by (kind, outcome) (increase(payouts_total[1h]))
```

## Müdahale

1. `/admin/payouts` ekranında başarısız kayıtları ve PSP hata kodunu inceleyin.
2. Hesap/IBAN hatasıysa ev sahibinden bilgi güncellemesi isteyin; sonraki koşu yeniden dener.

## Geri alma

- Başarısız payout PENDING'e döner; elle tekrar gönderim yapılmaz (çift ödeme riski).
