# Runbook — Ödeme başarı oranı %97 altında

- Alarm: `PaymentSuccessRatioLow`
- Önem: page
- SLO: SLO-2
- Kural: `docker/observability/alerts.yml` · Test: `docker/observability/alerts.test.yml`

## Belirti

Son 30 dakikada sistem kaynaklı ödeme başarı oranı %97'nin altında (kullanıcı reddi ve 3DS hariç). Misafirler ödeme adımında hata görür; saga telafileri artar.

## Panel

Grafana → `booking-platform` panosu (`docs/observability/grafana-dashboard.json`):

- SLO (P0-6) → Ödeme başarı oranı 30 dk
- Ödeme denemeleri
- Yarış telafileri ve saga

## Sorgu

```promql
payment:success_ratio:30m
sum by (outcome, flow) (increase(payment_attempts_total[30m]))
sum by (saga, step, outcome) (increase(saga_compensation_total[30m]))
```

## Müdahale

1. PSP durum sayfasını ve `PAYMENT_PROVIDER` ayarını kontrol edin; mock/chaos PSP yanlışlıkla etkin mi?
2. `capture_failed` baskınsa PSP capture hatası; `compensated` baskınsa envanter/tutma süresi yarışları.
3. Webhook gecikmesini de kontrol edin (`WebhookLatencyBurnRateFast`); geç webhook'lar onayları geciktirir.

## Geri alma

- Ödeme yolunu etkileyen son dağıtımı geri alın.
- PSP kesintisinde `RNPL_ENABLED` ile şimdi-öde yerine sonra-öde yolunu geçici öne çıkarmak değerlendirilebilir; kesinti bitince eski ayara dönün.
