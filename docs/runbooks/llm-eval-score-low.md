# Runbook — LLM eval geçme oranı %95 altında

- Alarm: `LlmEvalScoreLow`
- Önem: ticket
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

`npm run llm:eval` özetinden yüklenen `llm_eval_score{task,mode}` göstergesi CI kapısıyla aynı eşiğin (`LLM_EVAL_MIN_PASS_RATE`, 0,95) altında. Özet/taslak/destek yanıtlarının kalitesi gerilemiş olabilir.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- v5 para · destek · LLM → LLM eval geçme oranı

## Sorgu

```promql
min by (task, mode) (llm_eval_score)
```

## Müdahale

1. `npm run llm:eval` yerelde koşturup düşen görevi ve iddiayı (şema, grounding, PII, dil, red-team) bulun.
2. `mode="live"` düşüşü model/sağlayıcı değişikliği olabilir; son prompt/model değişikliğini inceleyin.

## Geri alma

- Son prompt veya model değişikliğini geri alın; gerekirse `LLM_MODE=demo`.
