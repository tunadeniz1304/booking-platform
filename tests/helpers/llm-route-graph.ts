import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Statik import grafiği: `src/app/api/**\/route.ts` dosyalarından başlayarak (yalnız
 * `@/` ve göreli, tip-dışı import'lar) LLM istemcisini ÇAĞIRAN modüllere
 * (`getLlmClient(` / `createLlmClient(`) ulaşan route'ları bulur (v5#12 meta testi).
 */

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const API_DIR = path.join(SRC, "app", "api");
const LLM_CLIENT = path.join(SRC, "lib", "llm", "client.ts");
const LLM_CALL_RE = /\b(?:getLlmClient|createLlmClient)\(/;
const IMPORT_RE =
  /(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function resolveSpecifier(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (/\.(ts|tsx)$/.test(base) && existsSync(base)) return base;
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

const importCache = new Map<string, string[]>();
function importsOf(file: string): string[] {
  const cached = importCache.get(file);
  if (cached) return cached;
  const source = readFileSync(file, "utf8");
  const deps: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    if (m[2]) continue; // `import type` / `export type` çalışma zamanında yok
    const spec = m[3] ?? m[4];
    const resolved = spec ? resolveSpecifier(file, spec) : null;
    if (resolved) deps.push(resolved);
  }
  importCache.set(file, deps);
  return deps;
}

function callsLlm(file: string): boolean {
  return file !== LLM_CLIENT && LLM_CALL_RE.test(readFileSync(file, "utf8"));
}

function reachesLlm(entry: string): boolean {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (callsLlm(file)) return true;
    stack.push(...importsOf(file));
  }
  return false;
}

/** `src/app/api/a/[id]/b/route.ts` → `/api/a/[id]/b` */
export function routePathOf(file: string): string {
  const rel = path.relative(path.join(SRC, "app"), path.dirname(file)).split(path.sep).join("/");
  return `/${rel}`;
}

/** LLM çağıran modüllere statik olarak ulaşan tüm API route yolları (sıralı). */
export function llmCallingRoutes(): string[] {
  return walk(API_DIR)
    .filter((f) => path.basename(f) === "route.ts")
    .filter(reachesLlm)
    .map(routePathOf)
    .sort();
}
