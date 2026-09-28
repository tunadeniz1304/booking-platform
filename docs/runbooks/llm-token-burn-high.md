# Runbook — LLM token tüketimi rota başına saatlik 2M üstünde

- Alarm: `LlmTokenBurnHigh`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Bir rota saatte 2 milyon tokenın üstünde tüketiyor: maliyet artışı, olası kötüye kullanım.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- LLM token (rota)
- LLM çağrıları (mod/sonuç)

## Sorgu

```promql
sum by (route) (increase(llm_tokens_total[1h]))
sum by (route) (increase(llm_budget_exceeded_total[1h]))
```

## Müdahale

1. Kullanıcı başına bütçe (`withAiSubject`) aşımları artıyor mu? Tek kullanıcı/IP yoğunluğunu loglardan bulun.
2. Gerekirse `LLM_MODE=demo` ile canlı çağrıları geçici kapatın.

## Geri alma

- `LLM_MODE` ve bütçe değişikliklerini olay sonrası eski değere alın.
