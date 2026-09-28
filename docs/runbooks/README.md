# Runbook'lar

Her Prometheus alarmının `annotations.runbook_url` alanı buradaki bir dosyayı gösterir
(v5 P0-5). Her runbook beş bölümden oluşur: **Belirti**, **Panel**, **Sorgu**, **Müdahale**,
**Geri alma**. SLO tanımları ve eşik gerekçeleri: [SLO.md](../observability/SLO.md).

| Alarm                               | Önem                        | Runbook                                                                              |
| ----------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `BookingLatencyP99High`             | page                        | [booking-latency-p99-high.md](booking-latency-p99-high.md)                           |
| `PaymentSuccessRatioLow`            | page                        | [payment-success-ratio-low.md](payment-success-ratio-low.md)                         |
| `LedgerImbalanceDetected`           | page                        | [ledger-imbalance-detected.md](ledger-imbalance-detected.md)                         |
| `LedgerReconciliationNotRunning`    | ticket                      | [ledger-reconciliation-not-running.md](ledger-reconciliation-not-running.md)         |
| `TakedownSlaBreached`               | page                        | [takedown-sla-breached.md](takedown-sla-breached.md)                                 |
| `RefundRetryFailing`                | ticket                      | [refund-retry-failing.md](refund-retry-failing.md)                                   |
| `LatePaymentRefundSpike`            | ticket                      | [late-payment-refund-spike.md](late-payment-refund-spike.md)                         |
| `CaptureRaceCompensations`          | ticket                      | [capture-race-compensations.md](capture-race-compensations.md)                       |
| `SplitPlansAborting`                | ticket                      | [split-plans-aborting.md](split-plans-aborting.md)                                   |
| `SagaCompensationFailed`            | ticket                      | [saga-compensation-failed.md](saga-compensation-failed.md)                           |
| `SagaCompensationRetryNotScheduled` | page                        | [saga-compensation-retry-not-scheduled.md](saga-compensation-retry-not-scheduled.md) |
| `SagaCompensationRetryExhausted`    | page                        | [saga-compensation-retry-exhausted.md](saga-compensation-retry-exhausted.md)         |
| `ConfirmRetryRefunds`               | ticket                      | [confirm-retry-refunds.md](confirm-retry-refunds.md)                                 |
| `ConfirmRetryExhausted`             | page                        | [confirm-retry-exhausted.md](confirm-retry-exhausted.md)                             |
| `PayoutFailures`                    | ticket                      | [payout-failures.md](payout-failures.md)                                             |
| `LlmTokenBurnHigh`                  | ticket                      | [llm-token-burn-high.md](llm-token-burn-high.md)                                     |
| `BookingSuccessBurnRateFast`        | page (Fast) · ticket (Slow) | [booking-success-burn-rate.md](booking-success-burn-rate.md)                         |
| `BookingSuccessBurnRateSlow`        | page (Fast) · ticket (Slow) | [booking-success-burn-rate.md](booking-success-burn-rate.md)                         |
| `PaymentConfirmLatencyBurnRateFast` | page (Fast) · ticket (Slow) | [payment-confirm-latency-burn-rate.md](payment-confirm-latency-burn-rate.md)         |
| `PaymentConfirmLatencyBurnRateSlow` | page (Fast) · ticket (Slow) | [payment-confirm-latency-burn-rate.md](payment-confirm-latency-burn-rate.md)         |
| `WebhookLatencyBurnRateFast`        | page (Fast) · ticket (Slow) | [webhook-latency-burn-rate.md](webhook-latency-burn-rate.md)                         |
| `WebhookLatencyBurnRateSlow`        | page (Fast) · ticket (Slow) | [webhook-latency-burn-rate.md](webhook-latency-burn-rate.md)                         |
| `PayoutBlockedSpike`                | ticket                      | [payout-blocked-spike.md](payout-blocked-spike.md)                                   |
| `DepositCaptureSweepFailing`        | page                        | [deposit-capture-sweep-failing.md](deposit-capture-sweep-failing.md)                 |
| `RnplChargeFailures`                | ticket                      | [rnpl-charge-failures.md](rnpl-charge-failures.md)                                   |
| `SupportHandoffRatioHigh`           | ticket                      | [support-handoff-ratio-high.md](support-handoff-ratio-high.md)                       |
| `LlmEvalScoreLow`                   | ticket                      | [llm-eval-score-low.md](llm-eval-score-low.md)                                       |
