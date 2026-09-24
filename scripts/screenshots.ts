/**
 * README ekran görüntüleri: `npm run docs:screenshots`
 *
 * Çalışan demo yığınına karşı (`docker compose up -d --build`, seed'li, LLM demo modu)
 * Playwright ile `docs/img/*.png` üretir. `SCREENSHOT_BASE_URL` varsayılanı http://localhost:3000.
 * Yalnızca demo seed hesaplarını kullanır.
 */
import path from "path";
import { mkdirSync } from "fs";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = path.resolve(process.cwd(), "docs/img");
const DEMO_PASS = "Password123!";

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function newContext(
  browser: import("@playwright/test").Browser,
  email?: string
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 1,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    reducedMotion: "reduce",
  });
  await context.addCookies([{ name: "cookie_consent", value: "necessary", url: BASE_URL }]);
  if (email) {
    const res = await context.request.post("/api/auth/login", {
      headers: { origin: BASE_URL },
      data: { email, password: DEMO_PASS },
    });
    if (res.status() !== 200) throw new Error(`login ${email} → ${res.status()}`);
  }
  return context;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  process.stdout.write(`docs/img/${name}.png\n`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const guest = await newContext(browser, "guest@booking.test");
    const page = await guest.newPage();

    await page.goto("/");
    await shot(page, "home");

    const checkIn = isoDaysFromNow(30);
    const checkOut = isoDaysFromNow(33);
    await page.goto(
      `/search?destination=İstanbul&checkIn=${checkIn}&checkOut=${checkOut}&guests=2`
    );
    await page
      .getByLabel(/Akıllı filtre/)
      .fill("İstanbul'da wifi olan, 2 kişi, gecesi 5000 TL altı");
    await page.getByRole("button", { name: "Filtrele" }).click();
    await page.getByRole("list", { name: "Çıkarılan filtreler" }).waitFor();
    await shot(page, "search-smart-filter");

    const search = await page.request.get(
      `/api/search?destination=${encodeURIComponent("İstanbul")}&pageSize=5`
    );
    const { results } = (await search.json()) as { results: Array<{ id: string }> };
    await page.goto(`/property/${results[0].id}?checkIn=${checkIn}&checkOut=${checkOut}&guests=2`);
    await shot(page, "property");

    await page.goto("/plan");
    await page.getByLabel(/Şehirler/).fill("İstanbul, Kapadokya, İzmir");
    await page.getByRole("button", { name: "Plan oluştur" }).click();
    await page.getByRole("button", { name: "Plan oluştur" }).waitFor();
    await page.waitForTimeout(500);
    await shot(page, "trip-planner");
    await guest.close();

    const host = await newContext(browser, "host@booking.test");
    const hostPage = await host.newPage();
    await hostPage.goto("/host");
    await shot(hostPage, "host-extranet");
    await host.close();

    const admin = await newContext(browser, "admin@booking.test");
    const adminPage = await admin.newPage();
    await adminPage.goto("/admin");
    await shot(adminPage, "admin");
    await admin.close();
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`screenshots failed: ${String(error)}\n`);
  process.exit(1);
});
