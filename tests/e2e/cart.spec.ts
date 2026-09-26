import { expect, test, type Page } from "@playwright/test";
import {
  GUEST_EMAIL,
  MOCK_3DS_CODE,
  TEST_CARD_DECLINE,
  acceptNecessaryCookies,
  farFutureStay,
  findStay,
  loginViaApi,
  type StayTarget,
} from "./helpers";

const TEST_CARD_OK = "4242 4242 4242 4242";

/** Önceki koşumdan kalan aktif sepeti boşaltır (kullanıcı başına tek aktif sepet). */
async function clearCart(page: Page, baseURL: string) {
  const res = await page.request.get("/api/cart");
  expect(res.ok()).toBeTruthy();
  const { cart } = (await res.json()) as { cart: { id: string } | null };
  if (cart) {
    const del = await page.request.delete(`/api/cart/${cart.id}`, {
      headers: { origin: baseURL },
    });
    expect(del.ok()).toBeTruthy();
  }
}

async function addItem(page: Page, baseURL: string, stay: StayTarget) {
  const dates = farFutureStay();
  const res = await page.request.post("/api/cart/items", {
    headers: { origin: baseURL },
    data: {
      propertyId: stay.propertyId,
      roomTypeId: stay.roomId,
      checkIn: dates.checkIn,
      checkOut: dates.checkOut,
      adults: 1,
      children: 0,
      quantity: 1,
    },
  });
  expect(res.status(), "sepete ekleme").toBe(201);
}

async function payCartWithCard(page: Page, cardNumber: string) {
  const form = page.getByRole("form", { name: "Ödeme" });
  await form.getByLabel("Kart numarası").fill(cardNumber);
  await form.getByLabel("CVC").fill("123");
  await form.getByRole("button", { name: "Öde ve onayla" }).click();
}

test.describe("grup sepeti (P1-1)", () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    await acceptNecessaryCookies(context, baseURL!);
    await loginViaApi(page, baseURL!, GUEST_EMAIL);
    await clearCart(page, baseURL!);
  });

  test("PDP'den sepete ekle → sepet sayfasında kalem görünür", async ({ page, baseURL }) => {
    const stay = await findStay(page.request, 0);
    await page.goto(`/property/${stay.propertyId}`);
    const add = page.getByRole("button", { name: "Sepete ekle" });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.getByText("Sepete eklendi.")).toBeVisible();
    await page.getByRole("link", { name: "Sepete git" }).click();
    await page.waitForURL(/\/cart$/);
    await expect(page.getByTestId("cart-item")).toHaveCount(1);
    await clearCart(page, baseURL!);
  });

  test("iki tesis → tümü-ya-hiç tut → tek ödeme → iki rezervasyon onaylı", async ({
    page,
    baseURL,
  }) => {
    await addItem(page, baseURL!, await findStay(page.request, 0));
    await addItem(page, baseURL!, await findStay(page.request, 1));

    await page.goto("/cart");
    await expect(page.getByTestId("cart-item")).toHaveCount(2);
    await expect(page.getByTestId("cart-total")).not.toBeEmpty();
    await page.getByRole("link", { name: "Ödemeye geç" }).click();
    await page.waitForURL(/\/checkout\/cart$/);

    await page.getByRole("button", { name: "Odaları tut" }).click();
    await expect(page.getByText(/Tüm odalar .+ sizin için tutuluyor\./)).toBeVisible();

    await payCartWithCard(page, TEST_CARD_OK);
    // Hız kuralları demo kullanıcısında 3DS isteyebilir → mock kodla tamamla.
    const challenge = page.getByRole("form", { name: "3D Secure doğrulaması" });
    const success = page.getByRole("heading", { name: "Rezervasyonlarınız onaylandı!" });
    await expect(challenge.or(success)).toBeVisible();
    if (await challenge.isVisible()) {
      await challenge.getByLabel("Doğrulama kodu").fill(MOCK_3DS_CODE);
      await challenge.getByRole("button", { name: "Doğrula" }).click();
    }
    await expect(success).toBeVisible();
    await expect(page.getByRole("link", { name: "Rezervasyonu görüntüle" })).toHaveCount(2);
  });

  test("ret kartı → tüm tutmalar bırakılır, sepet yeniden tutulabilir", async ({
    page,
    baseURL,
  }) => {
    await addItem(page, baseURL!, await findStay(page.request, 2));
    await addItem(page, baseURL!, await findStay(page.request, 3));

    await page.goto("/checkout/cart");
    await page.getByRole("button", { name: "Odaları tut" }).click();
    await payCartWithCard(page, TEST_CARD_DECLINE);
    await expect(page.getByRole("alert")).toContainText("Ödeme reddedildi");
    await expect(page.getByRole("button", { name: "Odaları tut" })).toBeVisible();

    const res = await page.request.get("/api/cart");
    const { cart } = (await res.json()) as {
      cart: { status: string; items: Array<{ bookingStatus: string | null }> };
    };
    expect(cart.status).toBe("OPEN");
    expect(cart.items.every((i) => i.bookingStatus === "EXPIRED")).toBe(true);
    await clearCart(page, baseURL!);
  });
});
