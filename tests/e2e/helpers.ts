import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/** Yalnızca demo seed hesapları; parola README'de açıkça "demo" olarak belgelenmiştir. */
export const DEMO_PASS = "Password123!";
export const GUEST_EMAIL = "guest@booking.test";
export const HOST_EMAIL = "host@booking.test";

export const TEST_CARD_3DS = "4000 0000 0000 3220";
export const TEST_CARD_DECLINE = "4000 0000 0000 0002";
export const MOCK_3DS_CODE = "123456";

/**
 * Uygulamanın kendi hata/uyarı kutuları. Next.js'in sayfa geçişlerini okuyan
 * `__next-route-announcer__` da role="alert" taşır; `getByRole("alert")` onu da yakalayıp
 * strict-mode çakışması üretir → burada dışlanır.
 */
export function appAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

/** Çerez bandını kapatır (akış testlerinde tıklamaları örtmesin). */
export async function acceptNecessaryCookies(context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: "cookie_consent", value: "necessary", url: baseURL }]);
}

/** Tarayıcı bağlamıyla aynı çerez deposunu kullanan API girişi (Origin: CSRF kontrolü). */
export async function loginViaApi(page: Page, baseURL: string, email: string) {
  const res = await page.request.post("/api/auth/login", {
    headers: { origin: baseURL },
    data: { email, password: DEMO_PASS },
  });
  expect(res.status(), `login ${email}`).toBe(200);
}

export async function loginViaUi(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola").fill(DEMO_PASS);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export interface StayTarget {
  propertyId: string;
  roomId: string;
}

/** Seed'li bir mülk ve odası (arama API'si üzerinden, deterministik sıra). */
export async function findStay(request: APIRequestContext, index = 0): Promise<StayTarget> {
  const search = await request.get(
    `/api/search?destination=${encodeURIComponent("İstanbul")}&pageSize=12`
  );
  expect(search.ok()).toBeTruthy();
  const body = (await search.json()) as { results: Array<{ id: string }> };
  expect(body.results.length).toBeGreaterThan(index);
  const propertyId = body.results[index].id;
  const detail = await request.get(`/api/properties/${propertyId}`);
  expect(detail.ok()).toBeTruthy();
  const property = (await detail.json()) as { rooms: Array<{ id: string }> };
  return { propertyId, roomId: property.rooms[0].id };
}

/** UTC `YYYY-MM-DD`, bugünden `days` gün sonrası. */
export function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Tekrar koşumlarında çakışmasın diye rastgele ileri bir tarih (60–300 gün): iade penceresi
 * her politikada açık kalır, availability satırları 365 gün ileriye kadar seed'lidir.
 */
export function farFutureStay(): { checkIn: string; checkOut: string } {
  const offset = 60 + Math.floor(Math.random() * 240);
  return { checkIn: isoDaysFromNow(offset), checkOut: isoDaysFromNow(offset + 1) };
}

export function checkoutUrl(stay: StayTarget, dates: { checkIn: string; checkOut: string }) {
  const params = new URLSearchParams({
    propertyId: stay.propertyId,
    roomId: stay.roomId,
    checkIn: dates.checkIn,
    checkOut: dates.checkOut,
    guestCount: "1",
  });
  return `/checkout?${params.toString()}`;
}

/** Checkout'u onaylar ve HELD rezervasyon sayfasına geçer; rezervasyon id'sini döndürür. */
export async function completeCheckout(page: Page): Promise<string> {
  const submit = page.getByRole("button", { name: "Rezervasyonu Tamamla" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.waitForURL(/\/booking\/[^/?#]+$/);
  await expect(
    page.getByRole("heading", { name: "Oda sizin için tutuluyor — ödemeyi tamamlayın" })
  ).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop()!;
}

export async function payWithCard(page: Page, cardNumber: string) {
  const form = page.getByRole("form", { name: "Ödeme" });
  await form.getByLabel("Kart numarası").fill(cardNumber);
  await form.getByLabel("CVC").fill("123");
  await form.getByRole("button", { name: "Öde ve onayla" }).click();
}
