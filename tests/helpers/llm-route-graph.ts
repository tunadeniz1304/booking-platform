import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Statik import grafiği: `src/app/api/**\/route.ts` dosyalarından başlayarak (yalnız
 * `@/` ve göreli, tip-dışı import'lar) LLM istemcisini ÇAĞIRAN modüllere
 * (`getLlmClient(` / `createLlmClient(`) ulaşan route'ları bulur (v5#12 meta testi).
 */

/**
 * LLM modülünü import eden ama bu route'un isteğinde LLM ÇAĞIRMAYAN (ya da çağrısı
 * varsayılan kapalı bir bayrağa bağlı yan sinyal olan) route'lar — gerekçeli istisna.
 */
export const LLM_IMPORT_ONLY_ROUTES: Readonly<Record<string, string>> = {
  "/api/bookings/[id]/messages":
    "Mesaj gönderimi; LLM risk sinyali MESSAGE_SCAN_LLM_ENABLED (varsayılan kapalı) ve bütçeye tabi, kova booking (fail-closed)",
  "/api/bookings/[id]/messages/stream": "Yalnız resolveThreadAccess (SSE); LLM çağrısı yok",
  "/api/host/revenue": "getRevenueOverview deterministik KPI; LLM açıklaması yalnız suggestions",
  "/api/host/revenue/suggestions/[id]/accept": "acceptSuggestion deterministik; LLM çağrısı yok",
  "/api/host/revenue/suggestions/[id]/reject": "rejectSuggestion deterministik; LLM çağrısı yok",
};

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

/** `/api/a/[id]/b` → route dosyasının mutlak yolu. */
export function routeFileOf(route: string): string {
  return path.join(SRC, "app", ...route.split("/").filter(Boolean), "route.ts");
}

let memo: string[] | null = null;
/** LLM çağıran modüllere statik olarak ulaşan tüm API route yolları (sıralı, önbellekli). */
export function llmCallingRoutes(): string[] {
  memo ??= walk(API_DIR)
    .filter((f) => path.basename(f) === "route.ts")
    .filter(reachesLlm)
    .map(routePathOf)
    .sort();
  return [...memo];
}
