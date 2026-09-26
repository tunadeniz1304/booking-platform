import { Counter } from "prom-client";
import { registry } from "./metrics";

/**
 * P0-6 iş metrikleri kataloğu.
 *
 * Metrikler tanımlandıkları modülde (ör. `ledger/journal.ts`) kaydedilir; bu dosya yalnızca
 * (1) `/api/metrics` ve worker `/metrics` uçlarının döndürmesi ZORUNLU serilerin listesini ve
 * (2) bilinen etiket kombinasyonlarını 0 ile önceden oluşturmayı (priming) tutar. Önceden
 * oluşturma sayesinde `increase(x[5m])` / `absent()` tabanlı alarm kuralları olay hiç
 * yaşanmamışken de seri görür ("veri yok" ≠ "sıfır").
 *
 * Etiket değerleri kaynak koddaki `.inc({...})` çağrılarıyla aynıdır; yeni değer eklenirse
 * burada listelenmesi yalnızca seriyi önceden görünür kılar (zorunlu değildir).
 */
export const PRIMED_COUNTER_SERIES: Readonly<
  Record<string, ReadonlyArray<Record<string, string>>>
> = {
  ledger_imbalance_total: [{ source: "app" }, { source: "db" }, { source: "reconciliation" }],
  refund_retry_total: [
    { outcome: "scheduled" },
    { outcome: "succeeded" },
    { outcome: "failed" },
    { outcome: "exhausted" },
  ],
  payment_late_success_total: [{ outcome: "reconfirmed" }, { outcome: "refunded" }],
  takedown_sla_breach_total: [
    { source: "MINISTRY_7565" },
    { source: "COURT_ORDER" },
    { source: "OTHER_AUTHORITY" },
  ],
  payment_capture_race_total: [{ action: "void" }, { action: "refund" }],
  cart_hold_total: [
    { outcome: "held" },
    { outcome: "busy" },
    { outcome: "unavailable" },
    { outcome: "price_changed" },
    { outcome: "failed" },
  ],
  cart_payment_total: [
    { outcome: "confirmed" },
    { outcome: "declined" },
    { outcome: "compensated" },
  ],
  cart_late_success_total: [
    { subject: "cart", outcome: "refunded" },
    { subject: "share", outcome: "applied" },
    { subject: "share", outcome: "refunded" },
  ],
  split_plan_total: [
    { outcome: "created" },
    { outcome: "settled" },
    { outcome: "fallback" },
    { outcome: "aborted" },
  ],
  split_share_payment_total: [{ outcome: "authorized" }, { outcome: "declined" }],
  payouts_total: [
    { kind: "host", outcome: "paid" },
    { kind: "host", outcome: "failed" },
    { kind: "transfer", outcome: "paid" },
  ],
  escrow_release_total: [{ kind: "escrow" }, { kind: "reserve" }],
  damage_deposit_events_total: [
    { outcome: "authorized" },
    { outcome: "captured" },
    { outcome: "voided" },
  ],
};

/** `/api/metrics` yanıtında bulunması zorunlu seri adları (P0-6 kabul kriteri). */
export const REQUIRED_SERIES: readonly string[] = [
  "ledger_imbalance_total",
  "refund_retry_total",
  "payment_late_success_total",
  "llm_tokens_total",
  "takedown_sla_breach_total",
  "http_request_duration_seconds",
  "booking_created_total",
  "payment_attempts_total",
  "payment_capture_race_total",
  "cart_hold_total",
  "cart_hold_items",
  "cart_payment_total",
  "cart_late_success_total",
  "split_plan_total",
  "split_share_payment_total",
  "split_settlement_duration_seconds",
  "payouts_total",
  "escrow_release_total",
  "damage_deposit_events_total",
];

/**
 * Kayıtlı sayaçların bilinen etiket kombinasyonlarını 0 değerle oluşturur (idempotent:
 * `inc(0)` mevcut değeri değiştirmez). Kayıtta olmayan metrik sessizce atlanır.
 */
export function primeBusinessMetrics(): void {
  for (const [name, series] of Object.entries(PRIMED_COUNTER_SERIES)) {
    const metric = registry.getSingleMetric(name);
    if (!(metric instanceof Counter)) continue;
    for (const labels of series) {
      try {
        metric.inc(labels, 0);
      } catch {
        // Etiket kümesi kaynakta değiştiyse (ör. yeni etiket) önceden oluşturma atlanır.
      }
    }
  }
}
