import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  GUEST_EMAIL,
  MOCK_3DS_CODE,
  TEST_CARD_3DS,
  acceptNecessaryCookies,
  checkoutUrl,
  completeCheckout,
  farFutureStay,
  findStay,
  loginViaApi,
  payWithCard,
} from "./helpers";

/**
 * P1-12 PWA: kurulabilir manifest + çevrimdışı seyahat planı. Service worker yalnızca üretim
 * derlemesinde kaydolur (docker compose yığını). Akış: onaylı rezervasyon → /trips (SW kurulur,
 * sayfa ve veri önbelleğe alınır) → tarayıcı bağlamı çevrimdışı → sayfa yeniden açılır ve QR
 * kartı "çevrimdışı" bandıyla görünür.
 */
test.describe("PWA (P1-12)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await acceptNecessaryCookies(context, baseURL!);
  });

  test("manifest kurulabilirlik alanlarını ve ikonları sunar", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest"
    );
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const manifest = (await res.json()) as {
      name: string;
      display: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string }>;
    };
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url.startsWith("/")).toBeTruthy();
    for (const size of ["192x192", "512x512"]) {
      const icon = manifest.icons.find((i) => i.sizes === size);
      expect(icon, size).toBeTruthy();
      expect((await request.get(icon!.src)).ok()).toBeTruthy();
    }
    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBeTruthy();
    expect(sw.headers()["service-worker-allowed"]).toBe("/");
  });

  test("çevrimdışı bağlamda seyahatlerim sayfası QR kartıyla açılır", async ({
    page,
    context,
    baseURL,
  }) => {
    await loginViaApi(page, baseURL!, GUEST_EMAIL);
    const stay = await findStay(page.request, 1);
    await page.goto(checkoutUrl(stay, farFutureStay()));
    const bookingId = await completeCheckout(page);
    await payWithCard(page, TEST_CARD_3DS);
    const challenge = page.getByRole("form", { name: "3D Secure doğrulaması" });
    await challenge.getByLabel("Doğrulama kodu").fill(MOCK_3DS_CODE);
    await challenge.getByRole("button", { name: "Doğrula" }).click();
    await expect(page.getByRole("heading", { name: "Rezervasyonunuz onaylandı" })).toBeVisible();

    // Çevrimiçi: service worker kurulur ve sayfayı denetler; ikinci yükleme önbelleği doldurur.
    await page.goto("/trips");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    const card = page.getByTestId("trip-card").filter({ hasText: `BK1.${bookingId}.` });
    await expect(card).toBeVisible();
    await expect(card.getByRole("img", { name: /QR/ })).toBeVisible();
    // Yeni sayfa da WCAG 2.1 AA'da ciddi ihlal içermez (P2-1 kapısı).
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => v.id)).toEqual([]);

    // Çevrimdışı: sayfa ve veri önbellekten gelir.
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Seyahatlerim" })).toBeVisible();
      await expect(page.getByTestId("offline-banner")).toBeVisible();
      await expect(card).toBeVisible();
      await expect(card.getByTestId("booking-code")).toHaveText(
        new RegExp(`^BK1\\.${bookingId}\\.`)
      );
    } finally {
      await context.setOffline(false);
    }
  });
});
