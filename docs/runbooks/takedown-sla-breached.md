# Runbook — Kaldırma talebi SLA'sı aşıldı

- Alarm: `TakedownSlaBreached`
- Önem: page
- SLO: SLO-4 (7565 / DSA; sıfır tolerans)
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Yasal süre (varsayılan 24 saat) içinde işlenmemiş kaldırma talebi var (`takedown_sla_breach_total{source}`). Hukuki risk.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- SLO (P0-6) → Kaldırma SLA ihlali 7 g

## Sorgu

```promql
sum by (source) (increase(takedown_sla_breach_total[1h]))
sum by (source) (increase(takedown_received_total[24h]))
```

## Müdahale

1. `/admin/compliance` kuyruğunu açın; süresi dolan talepleri önceliklendirip işleyin.
2. Tekrarlıyorsa `takedown-sla-sweep` işinin koştuğunu ve bildirim e-postalarının gittiğini doğrulayın.

## Geri alma

- Yanlış kaldırılan ilan, itiraz akışıyla (DSA appeal) geri yayına alınır.
