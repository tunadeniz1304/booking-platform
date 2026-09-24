import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { checkoutUrl, findStay, isoDaysFromNow } from "./helpers";

/**
 * P2-1 KK: ana 6 sayfada WCAG 2.0/2.1 A + AA kurallarında 0 serious/critical ihlal.
 * Kural kapatılmaz; ihlaller kaynakta düzeltilir. Çerez bandı açık hâliyle taranır
 * (ilk ziyaret deneyimi).
 */
async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes
        .slice(0, 5)
        .map((n) => `${n.target.join(" ")} :: ${n.html} :: ${n.failureSummary}`),
    }));
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test("a11y: ana sayfa", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: arama", async ({ page }) => {
  await page.goto(`/search?destination=${encodeURIComponent("İstanbul")}`);
  await expect(page.locator('main a[href^="/property/"]').first()).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: ürün sayfası", async ({ page }) => {
  const stay = await findStay(page.request);
  await page.goto(`/property/${stay.propertyId}`);
  await expect(page.getByRole("button", { name: "Rezervasyonu Onayla" })).toBeEnabled();
  await expectNoSeriousViolations(page);
});

test("a11y: checkout", async ({ page }) => {
  const stay = await findStay(page.request);
  await page.goto(checkoutUrl(stay, { checkIn: isoDaysFromNow(40), checkOut: isoDaysFromNow(42) }));
  await expect(page.getByText("Konaklama vergisi")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rezervasyonu Tamamla" })).toBeEnabled();
  await expectNoSeriousViolations(page);
});

test("a11y: giriş", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("E-posta", { exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: seyahat planlayıcı", async ({ page }) => {
  await page.goto("/plan");
  await expect(page.locator("main h1")).toBeVisible();
  await expectNoSeriousViolations(page);
});
