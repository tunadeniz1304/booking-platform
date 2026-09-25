import { expect, test } from "@playwright/test";
import { acceptNecessaryCookies, isoDaysFromNow } from "./helpers";

/**
 * P0-4 FTC "all-in" kuralı: tarih seçiliyken arama kartında vergisiz / gecelik fiyat, vergi ve
 * ücret dahil toplamdan DAHA BELİRGİN gösterilmez; karttaki toplam PDP teklifiyle aynıdır.
 */
test.beforeEach(async ({ context, baseURL }) => {
  await acceptNecessaryCookies(context, baseURL!);
});

test("regression: v3#9 kart toplamı vergi dahil, en belirgin fiyat ve PDP ile aynı", async ({
  page,
}) => {
  const checkIn = isoDaysFromNow(60);
  const checkOut = isoDaysFromNow(62);
  await page.goto(
    `/search?${new URLSearchParams({ destination: "İstanbul", checkIn, checkOut, guests: "2" })}`
  );

  const prices = page.getByTestId("card-price");
  await expect(prices.first()).toBeVisible();
  const count = await prices.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const card = prices.nth(i);
    await expect(card.getByTestId("card-total")).toBeVisible();
    await expect(card).toContainText("vergi ve ücretler dahil");
    await expect(card).not.toContainText("gecelik");
    // Kartın içindeki en büyük yazı tipi toplam tutara ait olmalı.
    const biggest = await card.evaluate((el) => {
      let best: { size: number; testId: string | null } = { size: 0, testId: null };
      for (const node of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
        if (!node.textContent?.trim()) continue;
        const size = parseFloat(getComputedStyle(node).fontSize);
        if (size > best.size) best = { size, testId: node.getAttribute("data-testid") };
      }
      return best.testId;
    });
    expect(biggest).toBe("card-total");
  }

  const firstTotal = (await prices.first().getByTestId("card-total").innerText()).trim();
  await page.getByRole("link", { name: "Fırsatı Gör" }).first().click();
  await page.waitForURL(/\/property\/.+checkIn=/);
  await expect(page.getByTestId("quote-total")).toHaveText(firstTotal);
});
