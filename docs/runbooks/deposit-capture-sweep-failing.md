# Runbook — Takılı depozito tahsilatları taramada kapatılamıyor

- Alarm: `DepositCaptureSweepFailing`
- Önem: page
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

`deposit-capture-sweep` işi CAPTURING durumunda takılı hasar depozitolarını sonuçlandıramıyor (`deposit_capture_sweep_total{outcome="failed"}`). PSP'de askıda tahsilat olabilir.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- v5 para · destek · LLM → Depozito tahsilat taraması
- Payout · emanet · depozito

## Sorgu

```promql
sum by (outcome) (increase(deposit_capture_sweep_total[1h]))
sum by (outcome) (increase(damage_deposit_events_total[1h]))
```

## Müdahale

1. Worker loglarında `deposit capture sweep errored` satırlarından `depositId`'leri alın.
2. PSP panelinde capture durumunu okuyun: tamamlandıysa kaydı `completed`, düştüyse `reverted` yapacak şekilde taramanın yeniden koşmasını sağlayın.

## Geri alma

- Elle müdahale audit kaydıyla; PSP durumu okunmadan depozito durumu değiştirilmez.
