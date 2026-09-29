import { defineConfig, devices } from "@playwright/test";

/**
 * Uçtan uca testler (P2-3). Çalışan bir yığına karşı koşar; sunucuyu kendisi başlatmaz:
 *
 *   docker compose -f docker-compose.yml -f docker-compose.demo.yml  *     -f docker-compose.e2e.yml up -d --build
 *                                       # seed'li demo ortamı (DEMO_MODE); e2e katmanı
 *                                       # LLM_MODE=demo'yu sabitler (.env'de anahtar olsa da)
 *   npm run test:e2e                    # E2E_BASE_URL varsayılanı http://localhost:3000
 *
 * Vitest bu klasörü yüklemez (`vitest.config.mts` yalnızca tests/unit ve tests/integration).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    // Geçiş animasyonları ortasında kontrast ölçülmesin (globals.css reduced-motion).
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
