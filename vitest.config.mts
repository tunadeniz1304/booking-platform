import { defineConfig } from "vitest/config";
import path from "path";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  // `server-only` testlerde (Node) boş modüle çözülür; Next'te react-server koşulu kullanılır.
  "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
};

/**
 * İki test projesi (P0-10):
 * - `unit`: altyapısız (DB/Redis gerektirmez), `tests/unit/**`.
 * - `integration`: testcontainers ile gerçek Postgres (pgvector) + Redis,
 *   `tests/integration/**`. Docker yoksa suite açık bir mesajla atlanır.
 *
 * Çalıştırma: `npm run test:unit` / `npm run test:int`.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/lib/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.test.ts"],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/setup.ts"],
          testTimeout: 20000,
          hookTimeout: 30000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/setup.ts", "tests/integration/setup-env.ts"],
          testTimeout: 90000,
          hookTimeout: 180000,
        },
      },
    ],
  },
});
