# Runbook — Çift girişli defterde dengesizlik

- Alarm: `LedgerImbalanceDetected`
- Önem: page
- SLO: SLO-3 (sıfır tolerans)
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

`ledger_imbalance_total{source}` arttı: bir jurnal kaydı ya da mutabakat borç ≠ alacak buldu. Para doğruluğu ihlali; postmortem zorunlu.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- SLO (P0-6) → Defter dengesizliği 24 s (SLO = 0)

## Sorgu

```promql
sum by (source) (increase(ledger_imbalance_total[15m]))
sum(increase(ledger_reconciliation_runs_total[26h]))
```

## Müdahale

1. Worker loglarında `ledger` + `imbalance` satırından etkilenen `bookingId`/jurnal anahtarını bulun.
2. Etkilenen rezervasyonlar için yeni payout'ları durdurmayı değerlendirin (ev sahibi hesabını `PAUSED`).
3. Mutabakatı (`ledger-reconcile` işi) elle tetikleyip farkı doğrulayın; düzeltici kaydı yalnız telafi jurnaliyle yazın (ADR 0026) — satır silme/güncelleme yok.

## Geri alma

- Düzeltici jurnal kaydı ters kayıtla geri alınabilir; doğrudan UPDATE/DELETE yapılmaz.
- Durdurulan payout hesaplarını fark kapandıktan sonra yeniden etkinleştirin.
