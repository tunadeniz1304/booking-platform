# Runbook — Destek ajanında insana devir oranı %50 üstünde

- Alarm: `SupportHandoffRatioHigh`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Son 1 saatte (≥ 20 konuşma) destek ajanı konuşmalarının yarısından fazlası insana devredildi (`support_handoff_total{reason}`). Destek kuyruğu şişer.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- v5 para · destek · LLM → Destek ajanı: konuşma ve insana devir
- Destek ajanı p95 gecikme

## Sorgu

```promql
sum by (reason) (increase(support_handoff_total[1h]))
sum by (intent, outcome) (increase(support_chat_total[1h]))
```

## Müdahale

1. `reason` dağılımı: para/iade talebi veya hukuki sinyal artışı gerçek bir olayın (ör. toplu iptal) belirtisi olabilir.
2. Düşük güven devirleri artıyorsa LLM sağlayıcısı/demo moduna düşme veya `SUPPORT_HANDOFF_MIN_CONFIDENCE` değişikliği.
3. `/admin/support` kuyruğunu personelle karşılayın.

## Geri alma

- Eşik değiştiyse eski değere dönün; devir güvenli varsayılandır, kapatılmaz.
