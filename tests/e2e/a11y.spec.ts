import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  GUEST_EMAIL,
  HOST_EMAIL,
  checkoutUrl,
  findStay,
  isoDaysFromNow,
  loginViaApi,
} from "./helpers";

const ADMIN_EMAIL = "admin@booking.test";

/**
 * P2-1 KK: sayfalarda WCAG 2.0/2.1/2.2 A + AA kurallarında 0 serious/critical ihlal
 * (2.2: hedef boyutu 2.5.8 dahil). Kural kapatılmaz; ihlaller kaynakta düzeltilir. Çerez
 * bandı açık hâliyle taranır (ilk ziyaret deneyimi).
 */
async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
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

// ---------------------------------------------------------------------------
// P2-1a: v4 sayfaları (sepet, karşılaştırma, seyahatler, bildirim/itiraz, oturumlar,
// fiyat takvimi, promosyon + erişilebilirlik panelleri) ve karanlık tema.
// ---------------------------------------------------------------------------

test("a11y: sepet", async ({ page, baseURL }) => {
  await loginViaApi(page, baseURL!, GUEST_EMAIL);
  await page.goto("/cart");
  await expect(page.locator("main h1")).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: karşılaştırma", async ({ page }) => {
  const [a, b] = [await findStay(page.request, 0), await findStay(page.request, 1)];
  await page.goto(`/compare?ids=${a.propertyId},${b.propertyId}`);
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator("main table, main [role='table']").first()).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: seyahatlerim", async ({ page, baseURL }) => {
  await loginViaApi(page, baseURL!, GUEST_EMAIL);
  await page.goto("/trips");
  await expect(page.locator("main h1")).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: DSA bildirim formu ve itiraz sayfası", async ({ page }) => {
  await page.goto("/report");
  await expect(page.locator("main form")).toBeVisible();
  await expectNoSeriousViolations(page);
  // Geçersiz bağlantı durumu (imzalı belirteç yok) da erişilebilir olmalı.
  await page.goto("/report/appeal?notice=x&role=host&token=invalid-token");
  await expect(page.locator("main [role='alert']")).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: hesap (ajan yetkileri) ve oturumlar", async ({ page, baseURL }) => {
  await loginViaApi(page, baseURL!, GUEST_EMAIL);
  await page.goto("/account");
  await expect(page.locator("#agent-mandates")).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.goto("/account/sessions");
  await expect(page.locator("main h1")).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: fiyat takvimi", async ({ page }) => {
  const stay = await findStay(page.request);
  await page.goto(`/property/${stay.propertyId}`);
  const calendar = page.locator("section[aria-labelledby='price-calendar-title']");
  await calendar.scrollIntoViewIfNeeded();
  await expect(calendar).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: ev sahibi paneli (promosyonlar + erişilebilirlik)", async ({ page, baseURL }) => {
  await loginViaApi(page, baseURL!, HOST_EMAIL);
  await page.goto("/host");
  await expect(page.locator("#host-accessibility")).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: uyum paneli (itiraz + erişilebilirlik kuyruğu)", async ({ page, baseURL }) => {
  await loginViaApi(page, baseURL!, ADMIN_EMAIL);
  await page.goto("/admin/compliance");
  await expect(page.locator("#appeals")).toBeVisible();
  await expect(page.locator("#accessibility-review")).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("a11y: erişilebilirlik filtresiyle arama", async ({ page }) => {
  await page.goto(
    `/search?destination=${encodeURIComponent("İstanbul")}&accessibility=STEP_FREE_ENTRANCE`
  );
  await expect(page.locator("main h1, main h2").first()).toBeVisible();
  await expectNoSeriousViolations(page);
});

test.describe("karanlık tema", () => {
  test.use({ colorScheme: "dark" });

  test("a11y (koyu): ana sayfa, arama ve checkout", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    await expectNoSeriousViolations(page);
    await page.goto(`/search?destination=${encodeURIComponent("İstanbul")}`);
    await expect(page.locator('main a[href^="/property/"]').first()).toBeVisible();
    await expectNoSeriousViolations(page);
    const stay = await findStay(page.request);
    await page.goto(
      checkoutUrl(stay, { checkIn: isoDaysFromNow(44), checkOut: isoDaysFromNow(46) })
    );
    await expect(page.getByRole("button", { name: "Rezervasyonu Tamamla" })).toBeEnabled();
    await expectNoSeriousViolations(page);
  });

  test("tema anahtarı: çerezle koyu tema sistem tercihini ezer ve yeniden yüklemede kalır", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.getByLabel("Tema").first().selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(3, 7, 18)");
  });
});

test("atlama bağlantısı: ilk Tab ile görünür olur ve ana içeriğe götürür", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "İçeriğe geç" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await skip.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});
