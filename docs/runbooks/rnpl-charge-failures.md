# Runbook — RNPL tahsilatlarında saatte 5+ başarısızlık/temerrüt

- Alarm: `RnplChargeFailures`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Şimdi rezerve et, sonra öde planlı tahsilatları düşüyor (`rnpl_charge_total{outcome=~"failed|defaulted"}`). `RNPL_GRACE_HOURS` sonunda rezervasyonlar otomatik iptal edilir.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- v5 para · destek · LLM → RNPL tahsilatları (sonuç)

## Sorgu

```promql
sum by (outcome) (increase(rnpl_charge_total[1h]))
```

## Müdahale

1. `failed` artışı PSP `chargeSaved` hatası olabilir: PSP durumunu ve kayıtlı kart (SetupIntent) geçerliliğini kontrol edin.
2. `defaulted` artışı beklenen müşteri davranışı olabilir; `risk_rejected` ile birlikte risk eşiğini değerlendirin.

## Geri alma

- `RNPL_ENABLED=false` yeni RNPL seçimini kapatır; mevcut planlar işlemeye devam eder. Olay sonrası geri açın.
