import { expect, test } from "@playwright/test";
import {
  appAlert,
  GUEST_EMAIL,
  MOCK_3DS_CODE,
  TEST_CARD_3DS,
  TEST_CARD_DECLINE,
  acceptNecessaryCookies,
  checkoutUrl,
  completeCheckout,
  farFutureStay,
  findStay,
  loginViaApi,
  loginViaUi,
  payWithCard,
} from "./helpers";

test.describe("rezervasyon akışı (misafir)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await acceptNecessaryCookies(context, baseURL!);
  });

  test("arama → PDP → checkout → 3DS ödeme → CONFIRMED → e-posta → iptal → iade", async ({
    page,
  }) => {
    await loginViaUi(page, GUEST_EMAIL);

    // Arama → ilk sonucun ürün sayfası
    await page.goto(`/search?destination=${encodeURIComponent("İstanbul")}`);
    const firstResult = page.locator('main a[href^="/property/"]').first();
    await expect(firstResult).toBeVisible();
    await firstResult.click();
    await page.waitForURL(/\/property\/[^/]+$/);

    // PDP: teklif yüklenince onay butonu etkinleşir → checkout
    const reserve = page.getByRole("button", { name: "Rezervasyonu Onayla" });
    await expect(reserve).toBeEnabled();
    await reserve.click();
    await page.waitForURL(/\/checkout\?/);

    // Tekrar koşumlarda çakışmamak ve iade penceresinde kalmak için ileri bir tarihe taşı.
    const url = new URL(page.url());
    const dates = farFutureStay();
    url.searchParams.set("checkIn", dates.checkIn);
    url.searchParams.set("checkOut", dates.checkOut);
    url.searchParams.delete("quoteId");
    await page.goto(url.pathname + url.search);
    await expect(page.getByText("Konaklama vergisi")).toBeVisible();

    const bookingId = await completeCheckout(page);
    const propertyTitle = (await page.locator("main h2").first().textContent())!.trim();
    expect(propertyTitle.length).toBeGreaterThan(0);

    // Ödeme: 3DS test kartı → doğrulama kodu
    await payWithCard(page, TEST_CARD_3DS);
    const challenge = page.getByRole("form", { name: "3D Secure doğrulaması" });
    await challenge.getByLabel("Doğrulama kodu").fill(MOCK_3DS_CODE);
    await challenge.getByRole("button", { name: "Doğrula" }).click();
    await expect(page.getByRole("heading", { name: "Rezervasyonunuz onaylandı" })).toBeVisible();
    const bookingUrl = page.url();

    // Worker outbox'ı işleyince onay e-postası dev mailbox'a düşer.
    await expect(async () => {
      await page.goto("/dev/mailbox");
      const mail = page.getByRole("listitem").filter({ hasText: `Rezervasyon no: ${bookingId}` });
      await expect(
        mail.getByRole("heading", { name: `Rezervasyonunuz onaylandı — ${propertyTitle}` })
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 45_000 });

    // İptal → iade tutarı gösterilir
    await page.goto(bookingUrl);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Rezervasyonu iptal et" }).click();
    await expect(page.getByRole("status")).toHaveText(/İptal edildi\. İade: .+ \(%\d+\)\./);
    await expect(page.getByRole("heading", { name: "Rezervasyon iptal edildi" })).toBeVisible();
  });

  test("ret kartıyla ödeme başarısız olur, rezervasyon HELD kalır", async ({ page, baseURL }) => {
    await loginViaApi(page, baseURL!, GUEST_EMAIL);
    const stay = await findStay(page.request, 1);
    await page.goto(checkoutUrl(stay, farFutureStay()));
    const bookingId = await completeCheckout(page);

    await payWithCard(page, TEST_CARD_DECLINE);
    await expect(appAlert(page)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Oda sizin için tutuluyor — ödemeyi tamamlayın" })
    ).toBeVisible();

    const res = await page.request.get(`/api/bookings/${bookingId}`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { booking: { status: string } };
    expect(body.booking.status).toBe("HELD");

    // Envanteri gereksiz tutmamak için hold'u bırak.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Rezervasyonu iptal et" }).click();
    await expect(page.getByRole("heading", { name: "Rezervasyon iptal edildi" })).toBeVisible();
  });
});
