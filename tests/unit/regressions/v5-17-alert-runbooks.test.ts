import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = path.resolve(__dirname, "../../..");
const obsDir = path.join(root, "docker/observability");

type Rule = {
  alert?: string;
  record?: string;
  expr: string;
  annotations?: Record<string, string>;
};
type RuleFile = { groups: { name: string; rules: Rule[] }[] };

const allRules = (
  parse(readFileSync(path.join(obsDir, "alerts.yml"), "utf8")) as RuleFile
).groups.flatMap((g) => g.rules);
const rules = allRules.filter((r): r is Rule & { alert: string } => typeof r.alert === "string");
const records = new Map(allRules.flatMap((r) => (r.record ? [[r.record, r.expr] as const] : [])));

/** Kaydedilmiş kural adlarını (recording rule) ifadeleriyle açar — tek seviye yeterli. */
function expand(expr: string): string {
  return expr.replace(/[a-z_]+:[a-z_]+:[a-z0-9_]+/g, (name) => records.get(name) ?? name);
}

const RUNBOOK_SECTIONS = ["Belirti", "Panel", "Sorgu", "Müdahale", "Geri alma"];

describe("regression: v5#17 her alarmın runbook'u ve promtool birim testi var", () => {
  it("alerts.yml en az 16 alarm içerir", () => {
    expect(rules.length).toBeGreaterThanOrEqual(16);
  });

  it("her alarmda docs/runbooks/<alarm>.md'yi gösteren annotations.runbook_url var", () => {
    const missing: string[] = [];
    for (const rule of rules) {
      const url = rule.annotations?.runbook_url ?? "";
      const rel = url.match(/(docs\/runbooks\/[a-z0-9-]+\.md)$/)?.[1];
      if (!rel || !existsSync(path.join(root, rel))) missing.push(`${rule.alert}: ${url || "—"}`);
    }
    expect(missing).toEqual([]);
  });

  it("runbook'lar belirti, panel, sorgu, müdahale ve geri alma bölümlerini içerir", () => {
    const incomplete: string[] = [];
    for (const rule of rules) {
      const rel = rule.annotations?.runbook_url?.match(/(docs\/runbooks\/[a-z0-9-]+\.md)$/)?.[1];
      if (!rel || !existsSync(path.join(root, rel))) continue;
      const body = readFileSync(path.join(root, rel), "utf8");
      for (const section of RUNBOOK_SECTIONS) {
        if (!new RegExp(`^## ${section}`, "m").test(body)) incomplete.push(`${rel}: ${section}`);
      }
      if (!body.includes(rule.alert)) incomplete.push(`${rel}: alarm adı yok`);
    }
    expect(incomplete).toEqual([]);
  });

  it("alerts.test.yml var ve her alarm en az bir promtool testinde beklenir", () => {
    const file = path.join(obsDir, "alerts.test.yml");
    expect(existsSync(file)).toBe(true);
    const suite = parse(readFileSync(file, "utf8")) as {
      rule_files: string[];
      tests: { alert_rule_test?: { alertname: string }[] }[];
    };
    expect(suite.rule_files).toContain("alerts.yml");
    const tested = new Set(
      suite.tests.flatMap((t) => (t.alert_rule_test ?? []).map((a) => a.alertname))
    );
    expect(rules.map((r) => r.alert).filter((name) => !tested.has(name))).toEqual([]);
  });

  it("SLO'lar için çok pencereli burn-rate alarmları var (booking başarı, ödeme onay p99, webhook)", () => {
    const burn = rules.filter((r) => /BurnRate/.test(r.alert));
    const exprs = burn.map((r) => expand(r.expr)).join("\n");
    expect(exprs).toMatch(/booking/);
    expect(exprs).toMatch(/pay\.confirm/);
    expect(exprs).toMatch(/payments\.webhook/);
    // Çok pencere: her burn-rate alarmı kısa ve uzun pencereyi birlikte ister.
    for (const rule of burn) expect(rule.expr, rule.alert).toMatch(/\band\b/);
  });

  it("Grafana paneli v5 metriklerini gösterir", () => {
    const dashboard = readFileSync(
      path.join(root, "docs/observability/grafana-dashboard.json"),
      "utf8"
    );
    for (const metric of [
      "payout_blocked_total",
      "deposit_capture_sweep_total",
      "rnpl_charge_total",
      "support_handoff_total",
      "support_chat_latency_seconds",
      "llm_eval_score",
    ]) {
      expect(dashboard, metric).toContain(metric);
    }
  });
});
