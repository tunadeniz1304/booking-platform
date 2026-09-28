# Runbook — Günlük defter mutabakatı 26 saattir koşmadı

- Alarm: `LedgerReconciliationNotRunning`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

`ledger_reconciliation_runs_total` 26 saattir artmadı: `ledger-reconcile` zamanlanmış işi koşmuyor. Dengesizlikler fark edilmeden birikebilir.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- SLO (P0-6) → Defter dengesizliği 24 s

## Sorgu

```promql
sum(increase(ledger_reconciliation_runs_total[26h]))
up{job=~".*worker.*"}
```

## Müdahale

1. Worker süreci ayakta mı ve Prometheus onu kazıyor mu (`up`) kontrol edin.
2. BullMQ tekrarlayan iş kaydını ve Redis bağlantısını worker loglarından doğrulayın.
3. İşi elle tetikleyip sayaç artışını izleyin.

## Geri alma

- Worker yapılandırması (cron) değiştiyse önceki değere dönün.
