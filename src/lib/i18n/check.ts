import fs from "node:fs";
import path from "node:path";

/**
 * i18n anahtar denetimi (P1-12 KK). Saf fonksiyonlar + dosya okuyucu; `scripts/i18n-check.ts`
 * ve birim testi aynı mantığı kullanır. Hata = eksik/fazla anahtar, boş metin, farklı yer
 * tutucu kümesi ya da `NAMESPACES` listesiyle dizinin uyuşmaması.
 */
export type MessageTree = { [key: string]: string | MessageTree };

export function flattenKeys(tree: MessageTree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(full, value);
    else for (const [k, v] of flattenKeys(value, full)) out.set(k, v);
  }
  return out;
}

/** ICU üst düzey argüman adları: "{count}", "{count, plural, ...}" → "count". */
export function placeholders(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    if (ch === "{") {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z_][\w]*)/.exec(message.slice(i));
        if (m) names.add(m[1]);
      }
      depth++;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return [...names].sort();
}

export interface I18nIssue {
  namespace: string;
  key?: string;
  problem: string;
}

export function compareLocales(
  namespace: string,
  base: MessageTree,
  other: MessageTree,
  baseName = "tr",
  otherName = "en"
): I18nIssue[] {
  const issues: I18nIssue[] = [];
  const a = flattenKeys(base);
  const b = flattenKeys(other);
  for (const [key, value] of a) {
    if (!b.has(key)) issues.push({ namespace, key, problem: `${otherName} içinde eksik` });
    else {
      const pa = placeholders(value).join(",");
      const pb = placeholders(b.get(key)!).join(",");
      if (pa !== pb)
        issues.push({ namespace, key, problem: `yer tutucular farklı: {${pa}} ≠ {${pb}}` });
    }
    if (value.trim() === "") issues.push({ namespace, key, problem: `${baseName} metni boş` });
  }
  for (const [key, value] of b) {
    if (!a.has(key)) issues.push({ namespace, key, problem: `${baseName} içinde eksik` });
    if (value.trim() === "") issues.push({ namespace, key, problem: `${otherName} metni boş` });
  }
  return issues;
}

/** `messages/<locale>/*.json` dizinlerini `namespaces` listesine karşı denetler. */
export function checkMessagesDir(
  root: string,
  namespaces: readonly string[],
  locales: readonly string[] = ["tr", "en"]
): I18nIssue[] {
  const issues: I18nIssue[] = [];
  const expected = new Set(namespaces);
  const trees: Record<string, Record<string, MessageTree>> = {};
  for (const locale of locales) {
    trees[locale] = {};
    const dir = path.join(root, locale);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
    const present = new Set(files.map((f) => f.replace(/\.json$/, "")));
    for (const ns of expected) {
      if (!present.has(ns)) issues.push({ namespace: ns, problem: `${locale}/${ns}.json yok` });
    }
    for (const ns of present) {
      if (!expected.has(ns)) {
        issues.push({ namespace: ns, problem: `${locale}/${ns}.json NAMESPACES listesinde yok` });
        continue;
      }
      trees[locale][ns] = JSON.parse(fs.readFileSync(path.join(dir, `${ns}.json`), "utf8"));
    }
  }
  const [base, ...rest] = locales;
  for (const ns of namespaces) {
    for (const other of rest) {
      const a = trees[base][ns];
      const b = trees[other][ns];
      if (a && b) issues.push(...compareLocales(ns, a, b, base, other));
    }
  }
  return issues;
}
