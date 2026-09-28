import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { llmEvalScore, refreshLlmEvalScore } from "@/lib/llm/eval-score";

/** v5 P1-5 — `llm_eval_score` göstergesi eval özet dosyasından yazılır; dosya yoksa sessiz. */
describe("P1-5 llm_eval_score", () => {
  it("özet dosyasından görev + red-team + genel oran", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "llm-eval-"));
    const file = path.join(dir, "summary.json");
    writeFileSync(
      file,
      JSON.stringify({
        mode: "demo",
        generatedAt: "2026-09-28T00:00:00Z",
        total: 20,
        passed: 19,
        passRate: 0.95,
        threshold: 0.95,
        byTask: { support_agent: { total: 10, passed: 10, passRate: 1 } },
        redTeam: { total: 5, passed: 4, passRate: 0.8 },
      })
    );
    expect(refreshLlmEvalScore(file)).toBe(true);
    const values = (await llmEvalScore.get()).values;
    const v = (task: string) => values.find((x) => x.labels.task === task)?.value;
    expect(v("all")).toBe(0.95);
    expect(v("support_agent")).toBe(1);
    expect(v("red_team")).toBe(0.8);
  });

  it("dosya yok / bozuk → false, fırlatmaz", () => {
    expect(refreshLlmEvalScore(path.join(tmpdir(), "yok-boyle-bir-dosya.json"))).toBe(false);
    const dir = mkdtempSync(path.join(tmpdir(), "llm-eval-"));
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "{bozuk");
    expect(refreshLlmEvalScore(bad)).toBe(false);
  });
});
