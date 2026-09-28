import { describe, expect, it } from "vitest";
import { parseAppConfig } from "@/lib/config/app-config";
import { LEGAL_HOLD_AUDIT_PREFIXES, retentionCutoffs } from "@/lib/privacy/retention";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-09-26T12:00:00Z");

describe("P0-5 saklama politikası (config + kesimler)", () => {
  it("varsayılan gün değerleri", () => {
    const c = parseAppConfig({});
    expect(c.RETENTION_AUDIT_LOG_DAYS).toBe(730);
    expect(c.RETENTION_PAYMENT_EVENT_DAYS).toBe(90);
    expect(c.RETENTION_OUTBOX_DAYS).toBe(30);
    expect(c.RETENTION_PRICE_HISTORY_DAYS).toBe(400);
    expect(c.RETENTION_MESSAGE_RISK_DAYS).toBe(365);
    expect(c.RETENTION_AUTH_TOKEN_DAYS).toBe(30);
    expect(c.RETENTION_CRON).toBe("15 3 * * *");
  });

  it("alt sınırlar: webhook tekilleştirme sağlayıcı yeniden deneme penceresinden kısa olamaz", () => {
    const c = parseAppConfig({ RETENTION_PAYMENT_EVENT_DAYS: "7", RETENTION_AUDIT_LOG_DAYS: "30" });
    expect(c.RETENTION_PAYMENT_EVENT_DAYS).toBe(90);
    expect(c.RETENTION_AUDIT_LOG_DAYS).toBe(730);
    expect(c.invalidKeys).toEqual(
      expect.arrayContaining(["RETENTION_PAYMENT_EVENT_DAYS", "RETENTION_AUDIT_LOG_DAYS"])
    );
  });

  it("kesim anları gün değerlerinden türetilir", () => {
    const c = parseAppConfig({ RETENTION_OUTBOX_DAYS: "10" });
    const cut = retentionCutoffs(c, NOW);
    expect(NOW.getTime() - cut.outbox.getTime()).toBe(10 * DAY_MS);
    expect(NOW.getTime() - cut.auditLog.getTime()).toBe(730 * DAY_MS);
    expect(cut.priceHistoryStayDate.toISOString().slice(0, 10)).toBe("2025-08-22");
  });

  it("fiyat geçmişi Omnibus penceresinden kısa tutulamaz", () => {
    const c = { ...parseAppConfig({}), RETENTION_PRICE_HISTORY_DAYS: 60 };
    const cut = retentionCutoffs(c, NOW, 90);
    expect(NOW.getTime() - cut.priceHistory.getTime()).toBe(91 * DAY_MS);
  });

  it("yasal saklamalı denetim eylemleri korunur (DSA, erişilebilirlik, KYC, talep, ödeme, mandate)", () => {
    for (const action of [
      "dsa.notice_decided",
      "dsa.appeal_received",
      "takedown.received",
      "accessibility.verified",
      "kyc.status_changed",
      "claim.decided",
      "agent_mandate.revoked",
      "payment.late_success",
      "cart.split_compensated",
      "transfer.capture_timeout",
      "ledger.reconciliation",
      "message.blocked",
      "user.role",
    ]) {
      expect(LEGAL_HOLD_AUDIT_PREFIXES.some((p) => action.startsWith(p))).toBe(true);
    }
    for (const action of ["auth.reauth", "auth.session_revoked", "message.risk_flagged"]) {
      expect(LEGAL_HOLD_AUDIT_PREFIXES.some((p) => action.startsWith(p))).toBe(false);
    }
  });
});
