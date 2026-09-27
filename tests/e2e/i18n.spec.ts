import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { HOST_EMAIL, GUEST_EMAIL, loginViaApi } from "./helpers";

/**
 * P1-12 + P2-1: İngilizce arayüz (NEXT_LOCALE=en çerezi) ve ek sayfalarda axe taraması.
 * Türkçe varsayılan kalır; dil seçimi URL'yi değiştirmez.
 */
async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} :: ${n.failureSummary}`),
    }));
}

async function expectAxeClean(page: Page) {
  const serious = await seriousViolations(page);
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test("i18n: varsayılan dil Türkçe, <html lang> tr", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await expect(page.getByRole("link", { name: "Giriş yap" }).first()).toBeVisible();
});

test("i18n: NEXT_LOCALE=en İngilizce arayüz ve en-US biçimi", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Discover places to stay" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expectAxeClean(page);
});

test.describe("i18n: ilk ziyarette Accept-Language müzakeresi", () => {
  test.use({ extraHTTPHeaders: { "Accept-Language": "en-GB,en;q=0.9,tr;q=0.5" } });

  test("çerez yokken İngilizce tarayıcı İngilizce sayfa alır", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["vary"]).toMatch(/accept-language/i);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  });

  test("açık çerez seçimi (NEXT_LOCALE=tr) Accept-Language'i ezer", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "tr", url: baseURL! }]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  });
});

test.describe("i18n: desteklenmeyen tarayıcı dili", () => {
  test.use({ extraHTTPHeaders: { "Accept-Language": "ja-JP,ja;q=0.9" } });

  test("varsayılan Türkçeye düşer", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  });
});

test("i18n: dil seçici çerezi yazar ve sayfayı İngilizceye çevirir", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Dil").first().selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "NEXT_LOCALE")?.value).toBe("en");
});

test("a11y: hesap sayfası (misafir)", async ({ page, baseURL }) => {
  await loginViaApi(page, baseURL!, GUEST_EMAIL);
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expectAxeClean(page);
});

test("a11y: ev sahibi paneli", async ({ page, baseURL }) => {
  await loginViaApi(page, baseURL!, HOST_EMAIL);
  await page.goto("/host");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expectAxeClean(page);
});

test("a11y: gizlilik", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expectAxeClean(page);
});
