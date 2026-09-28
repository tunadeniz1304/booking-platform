/**
 * v5 P1-5 — `npm run llm:eval` koşucusu.
 *
 *   npm run llm:eval            → demo modu (ağsız; CI'da çalışır)
 *   npm run llm:eval -- --live  → canlı LLM (YALNIZ yerel; CI'da reddedilir)
 *
 * promptfoo'yu (`evals/promptfooconfig.yaml`) alt süreçte çalıştırır, sonucu okuyup görev ve
 * red-team kırılımlı geçme oranını hesaplar, `LLM_EVAL_SUMMARY_PATH`'e özet yazar
 * (`llm_eval_score` göstergesinin kaynağı). Oran `LLM_EVAL_MIN_PASS_RATE` altındaysa çıkış 1.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config/app-config";
import { evalSummarySchema, type EvalSummary } from "@/lib/llm/eval-score";

const ROOT = path.resolve(import.meta.dirname, "..");
const EVAL_DIR = path.join(ROOT, "evals");
const RESULTS_DIR = path.join(EVAL_DIR, "results");
const RAW_OUTPUT = path.join(RESULTS_DIR, "promptfoo-latest.json");

interface PromptfooRow {
  success: boolean;
  vars?: { case?: string; task?: string };
  testCase?: { metadata?: { redTeam?: boolean } };
  gradingResult?: { reason?: string } | null;
  error?: string | null;
}

function promptfooBin(): string {
  // `promptfoo` paketi `./package.json` alt yolunu dışa açmaz → doğrudan node_modules'tan okunur.
  const pkgDir = path.join(ROOT, "node_modules", "promptfoo");
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.promptfoo!;
  return path.join(pkgDir, rel);
}

function rate(passed: number, total: number): number {
  return total === 0 ? 1 : passed / total;
}

function main(): number {
  const live = process.argv.includes("--live");
  if (live && process.env.CI) {
    console.error("llm:eval --live CI'da çalıştırılamaz (yalnız yerel).");
    return 2;
  }
  const mode: "demo" | "live" = live ? "live" : "demo";
  const config = getConfig();
  mkdirSync(RESULTS_DIR, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LLM_MODE: mode,
    LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
    PROMPTFOO_DISABLE_TELEMETRY: "1",
    PROMPTFOO_DISABLE_UPDATE: "1",
    PROMPTFOO_DISABLE_SHARING: "1",
    PROMPTFOO_CONFIG_DIR: path.join(EVAL_DIR, ".promptfoo"),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" "),
  };
  console.log(`LLM eval: ${mode === "live" ? "CANLI" : "DEMO"} modu`);
  const run = spawnSync(
    process.execPath,
    [
      promptfooBin(),
      "eval",
      "-c",
      "promptfooconfig.yaml",
      "--no-cache",
      "--no-write",
      "--no-progress-bar",
      "--no-table",
      "-o",
      RAW_OUTPUT,
    ],
    { cwd: EVAL_DIR, env, stdio: ["ignore", "inherit", "inherit"] }
  );
  if (run.error) {
    console.error(`promptfoo başlatılamadı: ${run.error.message}`);
    return 1;
  }

  const raw = JSON.parse(readFileSync(RAW_OUTPUT, "utf8")) as {
    results: { results: PromptfooRow[] };
  };
  const rows = raw.results.results;
  const byTask: EvalSummary["byTask"] = {};
  const red = { total: 0, passed: 0 };
  for (const r of rows) {
    const task = r.vars?.task ?? "unknown";
    const t = (byTask[task] ??= { total: 0, passed: 0, passRate: 0 });
    t.total += 1;
    if (r.success) t.passed += 1;
    if (r.testCase?.metadata?.redTeam) {
      red.total += 1;
      if (r.success) red.passed += 1;
    }
  }
  for (const t of Object.values(byTask)) t.passRate = rate(t.passed, t.total);
  const passed = rows.filter((r) => r.success).length;
  const summary: EvalSummary = evalSummarySchema.parse({
    mode,
    generatedAt: new Date().toISOString(),
    total: rows.length,
    passed,
    passRate: rate(passed, rows.length),
    threshold: config.LLM_EVAL_MIN_PASS_RATE,
    byTask,
    redTeam: { ...red, passRate: rate(red.passed, red.total) },
  });
  const summaryPath = path.resolve(ROOT, config.LLM_EVAL_SUMMARY_PATH);
  mkdirSync(path.dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");

  console.log("\nGörev                 Geçen/Toplam  Oran");
  for (const [task, t] of Object.entries(byTask)) {
    console.log(
      `${task.padEnd(22)}${`${t.passed}/${t.total}`.padEnd(14)}${(t.passRate * 100).toFixed(1)}%`
    );
  }
  console.log(
    `${"red-team".padEnd(22)}${`${red.passed}/${red.total}`.padEnd(14)}${(summary.redTeam.passRate * 100).toFixed(1)}%`
  );
  for (const r of rows.filter((x) => !x.success)) {
    console.log(`  ✗ ${r.vars?.case}: ${r.error ?? r.gradingResult?.reason ?? "başarısız"}`);
  }
  const pct = (summary.passRate * 100).toFixed(1);
  const min = (summary.threshold * 100).toFixed(0);
  if (summary.passRate < summary.threshold) {
    console.error(`\nLLM eval BAŞARISIZ: geçme oranı %${pct} < eşik %${min}`);
    return 1;
  }
  console.log(`\nLLM eval geçti: %${pct} (eşik %${min}); özet → ${config.LLM_EVAL_SUMMARY_PATH}`);
  return 0;
}

process.exit(main());
