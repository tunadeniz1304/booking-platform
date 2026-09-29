import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  GUEST_EMAIL,
  HOST_EMAIL,
  checkoutUrl,
  completeCheckout,
  farFutureStay,
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

test("a11y: karşılaştırma", async ({ page, baseURL }) => {
  await loginViaApi(page, baseURL!, GUEST_EMAIL);
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

// ---------------------------------------------------------------------------
// v5 P2-1: destek sohbeti (+ insana bağlan), admin destek kuyruğu, güven merkezi ve RNPL'li
// checkout / rezervasyon detayı.
// ---------------------------------------------------------------------------

test("a11y: güven merkezi (/trust) — SBOM, JWKS, OpenAPI, Scorecard, politika bağlantıları", async ({
  page,
}) => {
  await page.goto("/trust");
  await expect(page.locator("main h1")).toHaveText("Güven merkezi");
  await expect(page.getByRole("link", { name: /JWKS/ })).toHaveAttribute(
    "href",
    "/.well-known/jwks.json"
  );
  await expect(page.getByRole("link", { name: /OpenAPI/ })).toHaveAttribute(
    "href",
    "/api/openapi.json"
  );
  await expect(page.getByTestId("trust-sbom")).toContainText("artefakt");
  await expect(page.getByTestId("trust-scorecard")).toContainText("Yayınlanmadı");
  await expectNoSeriousViolations(page);
});

test("a11y: destek sohbeti — AI bildirimi ve 'İnsana bağlan' devri", async ({ page, baseURL }) => {
  await loginViaApi(page, baseURL!, GUEST_EMAIL);
  await page.goto("/support");
  await expect(page.locator("[data-ai-disclosure='true']")).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.getByRole("button", { name: "İnsana bağlan" }).click();
  await expect(page.getByText(/Konu insan destek ekibine devredildi/)).toBeVisible();
  await expect(page.getByRole("button", { name: "İnsana bağlan" })).toBeDisabled();
  await expectNoSeriousViolations(page);
});

test("a11y: admin destek kuyruğu", async ({ page, baseURL }) => {
  await loginViaApi(page, baseURL!, ADMIN_EMAIL);
  await page.goto("/admin/support");
  await expect(page.locator("main h1")).toHaveText("Destek kuyruğu");
  await expect(page.locator("#support-admin")).toBeVisible();
  await expectNoSeriousViolations(page);
});

/** RNPL'e uygun tarife (seed: PAY_LATER, orta iptal politikası) ile HELD rezervasyon sayfası. */
async function rnplHeldBooking(page: Page, baseURL: string): Promise<string> {
  await loginViaApi(page, baseURL, GUEST_EMAIL);
  const stay = await findStay(page.request);
  const detail = await page.request.get(`/api/properties/${stay.propertyId}`);
  const property = (await detail.json()) as {
    rooms: Array<{ id: string; ratePlans?: Array<{ id: string; code: string }> }>;
  };
  const room = property.rooms.find((r) => r.ratePlans?.some((p) => p.code === "PAY_LATER"));
  expect(room, "seed'de PAY_LATER tarifesi").toBeTruthy();
  const plan = room!.ratePlans!.find((p) => p.code === "PAY_LATER")!;
  const url = `${checkoutUrl({ propertyId: stay.propertyId, roomId: room!.id }, farFutureStay())}&ratePlanId=${plan.id}`;
  await page.goto(url);
  return completeCheckout(page);
}

test("a11y: RNPL'li ödeme adımı ve rezervasyon detayında ödeme planı", async ({
  page,
  baseURL,
}) => {
  await rnplHeldBooking(page, baseURL!);
  const option = page.getByTestId("rnpl-option");
  await expect(option).toBeVisible();
  await option.getByRole("radio", { name: /sonra öde/ }).check();
  await expect(page.getByTestId("rnpl-timeline")).toBeVisible();
  await expectNoSeriousViolations(page);

  const form = page.getByRole("form", { name: "Ödeme" });
  await form.getByLabel("Kart numarası").fill("4242 4242 4242 4242");
  await form.getByLabel("CVC").fill("123");
  await form.getByRole("button", { name: /Şimdi rezerve et/ }).click();
  const plan = page.getByTestId("rnpl-plan");
  await expect(plan).toBeVisible();
  await expect(plan).toContainText("Planlandı");
  await expect(plan).toContainText(/Bugün ₺?0/);
  await expect(page.getByTestId("rnpl-plan-timeline")).toBeVisible();
  await expectNoSeriousViolations(page);

  // Karanlık tema: aynı detay sayfası.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByTestId("rnpl-plan")).toBeVisible();
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

  test("a11y (koyu): güven merkezi ve destek sohbeti", async ({ page, baseURL }) => {
    await page.goto("/trust");
    await expect(page.locator("main h1")).toBeVisible();
    await expectNoSeriousViolations(page);
    await loginViaApi(page, baseURL!, GUEST_EMAIL);
    await page.goto("/support");
    await expect(page.locator("[data-ai-disclosure='true']")).toBeVisible();
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
