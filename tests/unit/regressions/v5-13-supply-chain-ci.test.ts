import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = path.resolve(__dirname, "../../..");
const workflowsDir = path.join(root, ".github/workflows");

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
};
type Job = { uses?: string; if?: string; steps?: Step[]; permissions?: Record<string, string> };
type Workflow = { on?: unknown; jobs?: Record<string, Job> };

function loadWorkflow(file: string): Workflow {
  return parse(readFileSync(path.join(workflowsDir, file), "utf8")) as Workflow;
}

function workflowFiles(): string[] {
  return readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f));
}

/** İş akışındaki tüm adımlar (iş sırası korunur). */
function allSteps(wf: Workflow): Step[] {
  return Object.values(wf.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

/** Adım ya da iş düzeyindeki tüm `uses:` referansları. */
function allUses(wf: Workflow): string[] {
  const jobs = Object.values(wf.jobs ?? {});
  return [
    ...jobs.flatMap((job) => (job.uses ? [job.uses] : [])),
    ...jobs.flatMap((job) => (job.steps ?? []).flatMap((s) => (s.uses ? [s.uses] : []))),
  ];
}

/** Adımın `uses` + `run` + `name` metni — araç adını aramak için. */
function stepText(step: Step): string {
  return [step.name, step.uses, step.run].filter(Boolean).join("\n");
}

describe("regression: v5#13 tedarik zinciri CI'ı (her push/PR, SHA pin, SAST/secret/SBOM/provenance)", () => {
  it("ci.yml tüm dallarda her push ve PR'da tetiklenir (dal filtresi yok)", () => {
    const on = loadWorkflow("ci.yml").on as Record<string, unknown> | string[] | string;
    const events = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on);
    expect(events).toEqual(expect.arrayContaining(["push", "pull_request"]));
    if (!Array.isArray(on) && typeof on === "object") {
      for (const event of ["push", "pull_request"]) {
        const cfg = (on[event] ?? {}) as Record<string, unknown>;
        expect(cfg.branches, `${event} dal filtresi olmamalı`).toBeUndefined();
      }
    }
  });

  it("tüm üçüncü taraf action'lar tam 40 haneli commit SHA ile pinli (yerel ./ hariç)", () => {
    const offenders: string[] = [];
    for (const file of workflowFiles()) {
      for (const uses of allUses(loadWorkflow(file))) {
        if (uses.startsWith("./") || uses.startsWith("docker://")) continue;
        if (!/^[^@\s]+@[0-9a-f]{40}$/.test(uses)) offenders.push(`${file}: ${uses}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("security.yml SAST (CodeQL/Semgrep), gitleaks, CycloneDX SBOM, OSV-Scanner ve provenance içerir", () => {
    expect(existsSync(path.join(workflowsDir, "security.yml"))).toBe(true);
    const texts = allSteps(loadWorkflow("security.yml")).map(stepText);
    const has = (re: RegExp) => texts.some((t) => re.test(t));
    expect(has(/github\/codeql-action\/analyze|semgrep/i)).toBe(true);
    expect(has(/gitleaks/i)).toBe(true);
    expect(has(/@cyclonedx\/cyclonedx-npm/)).toBe(true);
    expect(has(/osv-scanner/i)).toBe(true);
    expect(has(/actions\/attest-build-provenance@/)).toBe(true);
    expect(has(/ossf\/scorecard-action@/)).toBe(true);
  });

  it("SBOM her koşuda artefakt olarak yüklenir", () => {
    const steps = allSteps(loadWorkflow("security.yml"));
    const upload = steps.find(
      (s) => s.uses?.startsWith("actions/upload-artifact@") && /sbom/i.test(String(s.with?.name))
    );
    expect(upload).toBeDefined();
  });

  it("provenance ve Scorecard yalnız public repoda koşar (V-6: private repoda atlanır)", () => {
    const wf = loadWorkflow("security.yml");
    const guard = /github\.event\.repository\.private\s*==\s*false/;
    for (const [re, label] of [
      [/actions\/attest-build-provenance@/, "attest"],
      [/ossf\/scorecard-action@/, "scorecard"],
    ] as const) {
      const job = Object.values(wf.jobs ?? {}).find((j) =>
        (j.steps ?? []).some((s) => re.test(s.uses ?? ""))
      );
      expect(job, label).toBeDefined();
      const step = job!.steps!.find((s) => re.test(s.uses ?? ""))!;
      expect(`${job!.if ?? ""} ${step.if ?? ""}`, label).toMatch(guard);
    }
  });

  it("CI'da actionlint ve promtool check/test rules koşar", () => {
    const texts = allSteps(loadWorkflow("ci.yml")).map(stepText).join("\n");
    expect(texts).toMatch(/actionlint/);
    expect(texts).toMatch(/promtool[\s\S]*check rules/);
    expect(texts).toMatch(/promtool[\s\S]*test rules/);
  });

  it("dependabot.yml npm ve github-actions ekosistemlerini izler", () => {
    const file = path.join(root, ".github/dependabot.yml");
    expect(existsSync(file)).toBe(true);
    const cfg = parse(readFileSync(file, "utf8")) as {
      version: number;
      updates: { "package-ecosystem": string }[];
    };
    expect(cfg.version).toBe(2);
    const ecosystems = cfg.updates.map((u) => u["package-ecosystem"]);
    expect(ecosystems).toEqual(expect.arrayContaining(["npm", "github-actions"]));
  });

  it("kökte SECURITY.md bildirim politikası var ve docs/SECURITY.md'ye bağlanır", () => {
    const file = path.join(root, "SECURITY.md");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(/\(docs\/SECURITY\.md\)/);
  });
});
