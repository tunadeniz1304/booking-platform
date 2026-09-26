import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * §3 v3-e / v4#3: LLM sağlayıcı SDK'ları YALNIZCA `src/lib/llm/client.ts` içinden
 * kullanılabilir (embeddings dahil; `src/lib/llm`'in diğer dosyaları da kısıtlı).
 * Diğer her yer (yeni AI özellikleri dahil) redaksiyon, bütçe, guard ve demo/fallback
 * sözleşmesini uygulayan `@/lib/llm` istemcisini kullanmak zorundadır.
 */
const LLM_SDK_RESTRICTION = {
  paths: [
    { name: "openai", message: "LLM'e yalnızca @/lib/llm istemcisiyle erişin (LLM sözleşmesi)." },
    {
      name: "@anthropic-ai/sdk",
      message: "LLM'e yalnızca @/lib/llm istemcisiyle erişin (LLM sözleşmesi).",
    },
  ],
  patterns: [
    {
      group: ["openai/*", "@anthropic-ai/*"],
      message: "LLM'e yalnızca @/lib/llm istemcisiyle erişin (LLM sözleşmesi).",
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["src/lib/llm/client.ts", "tests/**"],
    rules: { "no-restricted-imports": ["error", LLM_SDK_RESTRICTION] },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "archive/**",
    "public/vendor/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
