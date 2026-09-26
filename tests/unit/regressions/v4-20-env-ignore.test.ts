import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** `.gitignore` / `.dockerignore` satırlarını yorumsuz dizi olarak okur. */
function patterns(file: string): string[] {
  return readFileSync(resolve(process.cwd(), file), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

describe("regression: v4#20 .env varyantları commit/imaja girmez", () => {
  it.each([".gitignore", ".dockerignore"])(
    "%s: .env ve .env.* yok sayılır, .env.example hariç",
    (file) => {
      const lines = patterns(file);
      expect(lines).toContain(".env");
      expect(lines).toContain(".env.*");
      const negation = lines.indexOf("!.env.example");
      // Olumsuzlama genel kalıptan SONRA gelmeli, yoksa etkisizdir.
      expect(negation).toBeGreaterThan(lines.indexOf(".env.*"));
    }
  );
});
