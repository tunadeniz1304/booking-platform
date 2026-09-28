# Runbook — Saatte 10+ payout engellendi

- Alarm: `PayoutBlockedSpike`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

`payout_blocked_total{kind,reason}` hızla artıyor: payout'lar hesap yok (`NO_ACCOUNT`), durdurulmuş (`PAUSED`), kimlik doğrulanmamış (`IDENTITY_UNVERIFIED`) veya sağlayıcı kapalı (`PROVIDER_DISABLED`) nedeniyle PENDING'de bekliyor (v5#4 AML kapısı).

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- v5 para · destek · LLM → Payout engelleri (tür/neden)

## Sorgu

```promql
sum by (kind, reason) (increase(payout_blocked_total[1h]))
```

## Müdahale

1. `reason` dağılımına bakın: `IDENTITY_UNVERIFIED` toplu artışı KYC sağlayıcı webhook'unun düştüğünü gösterebilir.
2. `PROVIDER_DISABLED` → payout sağlayıcı ayarını kontrol edin.
3. Engeller kasıtlıdır (başarısızlık sayılmaz); kapıyı gevşetmeyin, kök nedeni düzeltin.

## Geri alma

- Engel kalkınca sonraki payout koşusu bekleyenleri otomatik gönderir; ek geri alma gerekmez.
