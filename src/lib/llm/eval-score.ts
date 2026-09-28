import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { gauge } from "@/lib/observability/metrics";
import { getConfig } from "@/lib/config/app-config";

/**
 * v5 P1-5 — `llm_eval_score` göstergesi. `npm run llm:eval` özet dosyası yazar
 * (`LLM_EVAL_SUMMARY_PATH`); `/api/metrics` her kazımada dosyayı okuyup göstergeyi günceller.
 * Dosya yoksa/bozuksa gösterge boş kalır (hata fırlatılmaz). Etiketler sabit küme: görev + mod.
 */
export const llmEvalScore = gauge(
  "llm_eval_score",
  "Son LLM eval koşusunun geçme oranı (0-1; task=all genel)",
  ["task", "mode"] as const
);

export const evalSummarySchema = z.object({
  mode: z.enum(["demo", "live"]),
  generatedAt: z.string(),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  byTask: z.record(
    z.string(),
    z.object({ total: z.number(), passed: z.number(), passRate: z.number().min(0).max(1) })
  ),
  redTeam: z.object({ total: z.number(), passed: z.number(), passRate: z.number().min(0).max(1) }),
});

export type EvalSummary = z.infer<typeof evalSummarySchema>;

/** Özetten göstergeleri yazar (runner ve metrik ucu ortak kullanır). */
export function applyEvalSummary(summary: EvalSummary): void {
  llmEvalScore.reset();
  llmEvalScore.set({ task: "all", mode: summary.mode }, summary.passRate);
  llmEvalScore.set({ task: "red_team", mode: summary.mode }, summary.redTeam.passRate);
  for (const [task, s] of Object.entries(summary.byTask)) {
    llmEvalScore.set({ task, mode: summary.mode }, s.passRate);
  }
}

/** Özet dosyası varsa göstergeleri tazeler; yoksa sessizce geçer. */
export function refreshLlmEvalScore(file = getConfig().LLM_EVAL_SUMMARY_PATH): boolean {
  const full = path.resolve(process.cwd(), file);
  if (!existsSync(full)) return false;
  try {
    const parsed = evalSummarySchema.safeParse(JSON.parse(readFileSync(full, "utf8")));
    if (!parsed.success) return false;
    applyEvalSummary(parsed.data);
    return true;
  } catch {
    return false;
  }
}
