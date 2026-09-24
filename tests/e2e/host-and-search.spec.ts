import { expect, test } from "@playwright/test";
import { HOST_EMAIL, acceptNecessaryCookies, isoDaysFromNow, loginViaUi } from "./helpers";

test.beforeEach(async ({ context, baseURL }) => {
  await acceptNecessaryCookies(context, baseURL!);
});

test("host paneli: toplu takvim güncellemesi", async ({ page }) => {
  await loginViaUi(page, HOST_EMAIL);
  await page.goto("/host");

  const calendar = page.getByRole("form", { name: "Toplu takvim güncellemesi" }).first();
  await expect(calendar).toBeVisible();
  await calendar.getByLabel("Başlangıç").fill(isoDaysFromNow(320));
  await calendar.getByLabel("Bitiş (dahil)").fill(isoDaysFromNow(322));
  await calendar.getByLabel("Gecelik fiyat (boş = değişmez)").fill("2750");
  await calendar.getByRole("button", { name: "Takvimi güncelle" }).click();

  await expect(calendar.getByText(/Güncellenen gece: \d+, eklenen: \d+/)).toBeVisible();
  await expect(calendar.getByRole("alert")).toHaveCount(0);
});

test("Smart Filter (demo): doğal dil sorgusu filtre çiplerine dönüşür", async ({ page }) => {
  await page.goto("/search");
  await page
    .getByLabel("Akıllı filtre — ne aradığınızı yazın")
    .fill("Kadıköy'de denize yakın, kahvaltılı, 2 kişi, gecesi 3000 TL altı");
  await page.getByRole("button", { name: "Filtrele" }).click();

  const chips = page.getByRole("list", { name: "Çıkarılan filtreler" });
  await expect(chips).toBeVisible();
  await expect(chips.getByRole("button", { name: /Şehir: İstanbul/ })).toBeVisible();
  await expect(chips.getByRole("button", { name: /2 misafir/ })).toBeVisible();
  await expect(chips.getByRole("button", { name: /En çok 3000/ })).toBeVisible();
  await expect(chips.getByRole("button", { name: /Kahvaltı Dahil/ })).toBeVisible();

  // Çip kaldırılabilir (kullanıcı düzeltebilir).
  await chips.getByRole("button", { name: /2 misafir filtresini kaldır/ }).click();
  await expect(chips.getByRole("button", { name: /2 misafir/ })).toHaveCount(0);
});

test("harita görünümü: kümeleme ve liste ↔ işaretçi senkronu", async ({ page }) => {
  await page.goto("/search");
  await page
    .getByRole("group", { name: "Görünüm" })
    .getByRole("button", { name: "Harita" })
    .click();

  const list = page.getByRole("list", { name: "Haritadaki sonuçlar" });
  const fallback = page.getByText(/Harita yüklenemedi/);
  await expect(list.or(fallback).first()).toBeVisible();
  test.skip(
    await fallback.isVisible(),
    "Harita karoları yüklenemedi (çevrimdışı) → liste görünümü"
  );

  // Türkiye geneli görünümde aynı şehirdeki mülkler kümelenir.
  const clusters = page.getByRole("button", { name: /konaklama; yakınlaştırmak için tıklayın/ });
  await expect(clusters.first()).toBeVisible();

  // Liste → harita: seçim işaretçiyi vurgular ve açılır pencerede mülkü gösterir.
  const firstItem = list.getByRole("button").first();
  const title = (await firstItem.locator("span").first().innerText()).trim();
  await firstItem.click();
  await expect(firstItem).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  const marker = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(title)}, `) });
  await expect(marker).toHaveAttribute("aria-pressed", "true");

  // Seçimi kaldır, ardından harita → liste: işaretçiye tıklamak liste öğesini seçer.
  await firstItem.click();
  await expect(firstItem).toHaveAttribute("aria-pressed", "false");
  await marker.click();
  await expect(firstItem).toHaveAttribute("aria-pressed", "true");
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
