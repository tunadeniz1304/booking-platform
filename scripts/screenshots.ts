/**
 * README ekran görüntüleri: `npm run docs:screenshots`
 *
 * Çalışan demo yığınına karşı (`docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build`, seed'li, LLM demo modu)
 * Playwright ile `docs/img/*.png` üretir. `SCREENSHOT_BASE_URL` varsayılanı http://localhost:3000.
 * Yalnızca demo seed hesaplarını kullanır. `SCREENSHOT_SET=v3|v4|v5` yalnız o kümeyi üretir
 * (varsayılan: hepsi). v4 kümesi demo yığınında örnek sepet, bölünmüş ödeme planı ve (uygun
 * rezervasyon varsa) iade talebi oluşturur. v5 kümesi RNPL'li bir rezervasyon ve destek
 * sohbetinden bir insan devri talebi oluşturur.
 */
import path from "path";
import { mkdirSync, writeFileSync } from "fs";
import sharp from "sharp";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = path.resolve(process.cwd(), "docs/img");
const DEMO_PASS = "Password123!";
const SET = process.env.SCREENSHOT_SET ?? "all";

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function newContext(
  browser: import("@playwright/test").Browser,
  email?: string,
  colorScheme: "light" | "dark" = "light"
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    colorScheme,
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 1,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    reducedMotion: "reduce",
  });
  await context.addCookies([{ name: "cookie_consent", value: "necessary", url: BASE_URL }]);
  if (email) {
    const res = await context.request.post("/api/auth/login", {
      headers: { origin: BASE_URL },
      data: { email, password: DEMO_PASS },
    });
    if (res.status() !== 200) throw new Error(`login ${email} → ${res.status()}`);
  }
  return context;
}

async function shot(page: Page, name: string, optimize = false): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const png = await page.screenshot();
  // v4 görüntüleri paletli PNG'ye indirgenir (README/depo boyutunu küçük tutar).
  const out = optimize
    ? await sharp(png)
        .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
        .toBuffer()
    : png;
  writeFileSync(path.join(OUT_DIR, `${name}.png`), out);
  process.stdout.write(`docs/img/${name}.png (${Math.round(out.length / 1024)} KB)\n`);
}

interface BookingRow {
  id: string;
  status: string;
}

interface Thread {
  messages: Array<{ senderRole: string }>;
  canWrite: boolean;
}

/**
 * Misafirin yazılabilir (CONFIRMED) bir rezervasyon yazışmasını bulur; boşsa misafir ve
 * ev sahibi adına birer örnek mesaj yazar (telefon numarası PII maskelemesini gösterir).
 * Yeniden çalıştırıldığında mevcut yazışmayı olduğu gibi kullanır.
 */
async function prepareThread(guest: BrowserContext, host: BrowserContext): Promise<string> {
  const res = await guest.request.get("/api/bookings");
  const bookings = (await res.json()) as BookingRow[];
  for (const b of bookings.filter((x) => x.status === "CONFIRMED")) {
    const thread = await guest.request.get(`/api/bookings/${b.id}/messages`);
    if (thread.status() !== 200) continue;
    const data = (await thread.json()) as Thread;
    if (!data.canWrite) continue;
    if (data.messages.length === 0) {
      const post = (ctx: BrowserContext, body: string) =>
        ctx.request.post(`/api/bookings/${b.id}/messages`, {
          headers: { origin: BASE_URL },
          data: { body },
        });
      const first = await post(
        guest,
        "Merhaba, 22:00 civarı giriş yapabilir miyiz? Ulaşamazsanız 0532 123 45 67 numaramdan arayabilirsiniz."
      );
      if (first.status() !== 201) throw new Error(`guest message → ${first.status()}`);
      const reply = await post(
        host,
        "Merhaba, tabii. Resepsiyon 24 saat açık; geç girişinizi not aldık. İyi yolculuklar!"
      );
      if (reply.status() !== 201) throw new Error(`host message → ${reply.status()}`);
    }
    return b.id;
  }
  throw new Error("Yazılabilir rezervasyon yazışması bulunamadı (CONFIRMED rezervasyon yok)");
}

/** Oturum açan kullanıcının Bearer access token'ı (MCP HTTP için). */
async function accessToken(context: BrowserContext, email: string): Promise<string> {
  const res = await context.request.post("/api/auth/login", {
    headers: { origin: BASE_URL },
    data: { email, password: DEMO_PASS },
  });
  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) throw new Error(`accessToken alınamadı (${res.status()})`);
  return body.accessToken;
}

/**
 * MCP `ui://booking/stay-card` widget'ı: şablon ve `search_stays` çıktısı gerçek `POST /api/mcp`
 * (streamable HTTP, JSON-RPC) üzerinden alınır; şablon, ChatGPT Apps SDK'nın sağladığı
 * `window.openai.toolOutput` ile aynı biçimde beslenerek boş bir sayfada çizilir.
 * (ChatGPT/Claude istemcisinin kendisinin ekran görüntüsü DEĞİLDİR.)
 */
async function renderStayCard(
  browser: import("@playwright/test").Browser,
  token: string,
  checkIn: string,
  checkOut: string
): Promise<void> {
  const context = await newContext(browser);
  const rpc = async (id: number, method: string, params: unknown) => {
    const res = await context.request.post("/api/mcp", {
      headers: {
        origin: BASE_URL,
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      data: { jsonrpc: "2.0", id, method, params },
    });
    if (res.status() !== 200) throw new Error(`mcp ${method} → ${res.status()}`);
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(`mcp ${method}: ${body.error.message}`);
    return body.result as Record<string, unknown>;
  };
  const resource = await rpc(1, "resources/read", { uri: "ui://booking/stay-card" });
  const html = (resource.contents as Array<{ text: string }>)[0].text;
  const call = await rpc(2, "tools/call", {
    name: "search_stays",
    arguments: { city: "İstanbul", checkIn, checkOut, guests: 2, pageSize: 3 },
  });
  const output =
    call.structuredContent ?? JSON.parse((call.content as Array<{ text: string }>)[0].text);
  const page = await context.newPage();
  await page.setViewportSize({ width: 420, height: 420 });
  // Apps SDK ana makinesinin yaptığı gibi `window.openai.toolOutput` şablon betiğinden önce tanımlanır.
  const json = JSON.stringify(output).replace(/</g, "\\u003c");
  const bootstrap = `<script>window.openai={toolOutput:${json}};</script>`;
  await page.setContent(html.replace("</head>", `${bootstrap}</head>`));
  await page.locator(".card").first().waitFor();
  await page.screenshot({ path: path.join(OUT_DIR, "mcp-stay-card.png"), fullPage: true });
  process.stdout.write("docs/img/mcp-stay-card.png\n");
  await context.close();
}

const ORIGIN = { origin: BASE_URL };

interface StayRef {
  propertyId: string;
  roomId: string;
}

async function stays(context: BrowserContext, count: number): Promise<StayRef[]> {
  const search = await context.request.get(
    `/api/search?destination=${encodeURIComponent("İstanbul")}&pageSize=12`
  );
  const { results } = (await search.json()) as { results: Array<{ id: string }> };
  const out: StayRef[] = [];
  for (const r of results.slice(0, count)) {
    const detail = await context.request.get(`/api/properties/${r.id}`);
    const { rooms } = (await detail.json()) as { rooms: Array<{ id: string }> };
    out.push({ propertyId: r.id, roomId: rooms[0].id });
  }
  return out;
}

/** Kullanıcının aktif sepetini boşaltır (kullanıcı başına tek aktif sepet). */
async function clearCart(context: BrowserContext): Promise<void> {
  const res = await context.request.get("/api/cart");
  const { cart } = (await res.json()) as { cart: { id: string } | null };
  if (cart) await context.request.delete(`/api/cart/${cart.id}`, { headers: ORIGIN });
}

/** Paylaşım bağlantısıyla bir payı öder (risk 3DS isterse demo koduyla onaylar). */
async function payShare(context: BrowserContext, inviteUrl: string): Promise<void> {
  const token = inviteUrl.split("/pay/share/")[1];
  const res = await context.request.post(`/api/pay/share/${token}`, {
    headers: { ...ORIGIN, "idempotency-key": `shots-${token.slice(0, 24)}` },
    data: { cardToken: "tok_mock_ok_424242_4242" },
  });
  if (res.status() === 202) {
    await context.request.post(`/api/pay/share/${token}/confirm`, {
      headers: ORIGIN,
      data: { code: "123456" },
    });
  } else if (res.status() !== 200) {
    throw new Error(`share pay → ${res.status()}`);
  }
}

/**
 * Misafirin konaklaması başlamış, tahsilatlı bir rezervasyonunda örnek iade talebi açar
 * (zaten talebi varsa onu kullanır). Uygun rezervasyon yoksa null (liste gösterilir).
 */
async function ensureClaim(guest: BrowserContext): Promise<string | null> {
  const existing = await guest.request.get("/api/claims");
  const { claims } = (await existing.json()) as { claims: Array<{ id: string }> };
  if (claims.length > 0) return claims[0].id;
  const res = await guest.request.get("/api/bookings");
  const bookings = (await res.json()) as Array<{ id: string; status: string; checkIn: string }>;
  const started = bookings.filter(
    (b) => ["CONFIRMED", "COMPLETED"].includes(b.status) && Date.parse(b.checkIn) < Date.now()
  );
  for (const b of started) {
    const open = await guest.request.post("/api/claims", {
      headers: ORIGIN,
      data: {
        bookingId: b.id,
        type: "GUEST_REFUND",
        amountMinor: 50000,
        description:
          "Klima iki gece boyunca çalışmadı; resepsiyona bildirmemize rağmen onarılmadı.",
      },
    });
    if (open.status() === 201) return ((await open.json()) as { id: string }).id;
  }
  return null;
}

/**
 * v4 ekranları: grup sepeti, checkout + bölünmüş ödeme, fiyat takvimi, karşılaştırma,
 * çözüm merkezi, cüzdan, payout paneli ve koyu tema.
 */
async function v4Screens(browser: import("@playwright/test").Browser): Promise<void> {
  const guest = await newContext(browser, "guest@booking.test");
  const page = await guest.newPage();
  const [a, b] = await stays(guest, 2);

  // Grup sepeti: iki tesis, aynı tarihler (her koşumda farklı ileri tarih → çakışma yok).
  await clearCart(guest);
  const offset = 150 + Math.floor(Math.random() * 150);
  for (const s of [a, b]) {
    const add = await guest.request.post("/api/cart/items", {
      headers: ORIGIN,
      data: {
        propertyId: s.propertyId,
        roomTypeId: s.roomId,
        checkIn: isoDaysFromNow(offset),
        checkOut: isoDaysFromNow(offset + 2),
        adults: 2,
        children: 0,
        quantity: 1,
      },
    });
    if (add.status() !== 201) throw new Error(`cart add → ${add.status()}`);
  }
  await page.goto("/cart");
  await page.getByTestId("cart-item").nth(1).waitFor();
  await shot(page, "v4-cart", true);

  // Checkout: tümü-ya-hiç tutma → ödeme formu + bölünmüş ödeme paneli.
  await page.goto("/checkout/cart");
  await page.getByTestId("cart-hold").click();
  await page.getByTestId("cart-pay").waitFor();
  await shot(page, "v4-checkout-cart", true);

  // Bölünmüş ödeme: organizatör + 2 katılımcı eşit; bir katılımcı payını öder.
  const cartRes = await guest.request.get("/api/cart");
  const { cart } = (await cartRes.json()) as { cart: { id: string } };
  const split = await guest.request.post(`/api/cart/${cart.id}/split`, {
    headers: ORIGIN,
    data: { mode: "equal", participants: [{ email: "elif@test.com" }, { email: null }] },
  });
  if (split.status() !== 201) throw new Error(`split → ${split.status()}`);
  const { plan } = (await split.json()) as {
    plan: { shares: Array<{ isOrganizer: boolean; inviteUrl: string }> };
  };
  const elif = await newContext(browser, "elif@test.com");
  await payShare(elif, plan.shares.find((s) => !s.isOrganizer)!.inviteUrl);
  await elif.close();
  await page.goto("/checkout/cart");
  const status = page.getByTestId("split-status");
  await status.waitFor();
  await status.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, "v4-split-payment", true);

  // PDP fiyat takvimi (esnek tarih, gece fiyatları).
  await page.goto(`/property/${a.propertyId}`);
  const calendar = page.locator("section[aria-labelledby='price-calendar-title']");
  await calendar.waitFor();
  // Gelecek ay: geçmiş günler (üstü çizili) yerine tam bir fiyat ısı haritası.
  await calendar.getByRole("button", { name: /Sonraki/ }).click();
  await calendar.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  await shot(page, "v4-price-calendar", true);

  // İlan karşılaştırma.
  await page.goto(
    `/compare?ids=${a.propertyId},${b.propertyId}&checkIn=${isoDaysFromNow(offset)}&checkOut=${isoDaysFromNow(offset + 2)}&guests=2`
  );
  await page.locator("main table, main [role='table']").first().waitFor();
  await shot(page, "v4-compare", true);

  // Çözüm merkezi: misafir talebi açılabildiyse ayrıntısı; yoksa yönetici talep kuyruğu
  // (`demo:scenarios` senaryo 10'un hasar talepleri burada görünür).
  const claimId = await ensureClaim(guest);
  if (claimId) {
    await page.goto(`/resolution/${claimId}`);
    await page.locator("main h1").waitFor();
    await page.waitForTimeout(500);
    await shot(page, "v4-resolution", true);
  } else {
    const admin = await newContext(browser, "admin@booking.test");
    const adminPage = await admin.newPage();
    await adminPage.goto("/admin/claims");
    await adminPage.locator("main h1").waitFor();
    await adminPage.waitForTimeout(800);
    await shot(adminPage, "v4-resolution", true);
    await admin.close();
  }

  // Cüzdan (sadakat kredisi lotları).
  await page.goto("/account");
  const wallet = page.locator("section[aria-labelledby='wallet-title']");
  await wallet.waitFor();
  await wallet.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(300);
  await shot(page, "v4-wallet", true);
  await guest.close();

  // Ev sahibi payout paneli (emanet / serbest / rezerv / ödenen).
  const host = await newContext(browser, "host@booking.test");
  const hostPage = await host.newPage();
  await hostPage.goto("/host/payouts");
  await hostPage.locator("main h1").waitFor();
  await hostPage.waitForTimeout(800);
  await shot(hostPage, "v4-host-payouts", true);
  await host.close();

  // Koyu tema örneği (sistem tercihi `prefers-color-scheme: dark`).
  const dark = await newContext(browser, undefined, "dark");
  const darkPage = await dark.newPage();
  await darkPage.goto(`/property/${a.propertyId}`);
  await darkPage.locator("main h1").waitFor();
  await darkPage.waitForTimeout(500);
  await shot(darkPage, "v4-dark-mode", true);
  await dark.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    if (SET === "all" || SET === "v3") await v3Screens(browser);
    if (SET === "all" || SET === "v4") await v4Screens(browser);
    if (SET === "all" || SET === "v5") await v5Screens(browser);
  } finally {
    await browser.close();
  }
}

/** v3 ekranları (ana sayfa, akıllı filtre, PDP, checkout, planlayıcı, mesajlaşma, host, MCP, admin). */
async function v3Screens(browser: import("@playwright/test").Browser): Promise<void> {
  const guest = await newContext(browser, "guest@booking.test");
  const page = await guest.newPage();

  await page.goto("/");
  await shot(page, "home");

  const checkIn = isoDaysFromNow(30);
  const checkOut = isoDaysFromNow(33);
  await page.goto(`/search?destination=İstanbul&checkIn=${checkIn}&checkOut=${checkOut}&guests=2`);
  await page.getByLabel(/Akıllı filtre/).fill("İstanbul'da wifi olan, 2 kişi, gecesi 5000 TL altı");
  await page.getByRole("button", { name: "Filtrele" }).click();
  await page.getByRole("list", { name: "Çıkarılan filtreler" }).waitFor();
  await shot(page, "search-smart-filter");

  const search = await page.request.get(
    `/api/search?destination=${encodeURIComponent("İstanbul")}&pageSize=5`
  );
  const { results } = (await search.json()) as { results: Array<{ id: string }> };
  const propertyId = results[0].id;
  await page.goto(`/property/${propertyId}?checkIn=${checkIn}&checkOut=${checkOut}&guests=2`);
  await shot(page, "property");

  // Fiyat içgörüsü (conformal aralık, "normal fiyat" etiketi) PDP'de rezervasyon kutusunun altında.
  const insight = page.getByTestId("price-insight");
  await insight.waitFor();
  await insight.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, "price-insight");

  // Checkout: gece, hizmet bedeli, KDV (dahil) ve konaklama vergisi satırlarıyla toplam.
  const detail = await page.request.get(`/api/properties/${propertyId}`);
  const { rooms } = (await detail.json()) as { rooms: Array<{ id: string }> };
  await page.goto(
    `/checkout?propertyId=${propertyId}&roomId=${rooms[0].id}&checkIn=${checkIn}&checkOut=${checkOut}&guestCount=2`
  );
  await page.getByTestId("quote-total").waitFor();
  await shot(page, "checkout-breakdown");

  await page.goto("/plan");
  await page.getByLabel(/Şehirler/).fill("İstanbul, Kapadokya, İzmir");
  await page.getByRole("button", { name: "Plan oluştur" }).click();
  await page.getByRole("button", { name: "Plan oluştur" }).waitFor();
  await page.waitForTimeout(500);
  await shot(page, "trip-planner");

  const host = await newContext(browser, "host@booking.test");
  const threadBookingId = await prepareThread(guest, host);
  await page.goto(`/booking/${threadBookingId}`);
  const messages = page.locator("section[aria-labelledby='msg-title'] ol");
  await messages.waitFor();
  await messages.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, "messaging");
  const token = await accessToken(guest, "guest@booking.test");
  await guest.close();

  const hostPage = await host.newPage();
  await hostPage.goto("/host");
  await shot(hostPage, "host-extranet");

  await hostPage.goto("/host/revenue");
  await hostPage.locator("main dl").first().waitFor();
  await hostPage.waitForTimeout(500);
  await shot(hostPage, "host-revenue");
  await host.close();

  await renderStayCard(browser, token, checkIn, checkOut);

  const admin = await newContext(browser, "admin@booking.test");
  const adminPage = await admin.newPage();
  await adminPage.goto("/admin");
  await shot(adminPage, "admin");
  await admin.close();
}

/**
 * v5 ekranları: RNPL ödeme adımı + rezervasyon detayındaki ödeme planı, PDP kayıt no, destek
 * sohbeti + "İnsana bağlan" devri, admin destek kuyruğu, güven merkezi ve (yalnız v5 kümesi
 * istendiğinde) MCP stay-card.
 */
async function v5Screens(browser: import("@playwright/test").Browser): Promise<void> {
  const guest = await newContext(browser, "guest@booking.test");
  const page = await guest.newPage();

  // RNPL: seed'deki PAY_LATER tarifesiyle HELD rezervasyon → "sonra öde" seçimi.
  const [stay] = await stays(guest, 1);
  const detail = await guest.request.get(`/api/properties/${stay.propertyId}`);
  const { rooms } = (await detail.json()) as {
    rooms: Array<{ id: string; ratePlans?: Array<{ id: string; code: string }> }>;
  };
  const room = rooms.find((r) => r.ratePlans?.some((p) => p.code === "PAY_LATER"));
  if (!room) throw new Error("seed'de PAY_LATER tarifesi yok");
  const plan = room.ratePlans!.find((p) => p.code === "PAY_LATER")!;
  const offset = 60 + Math.floor(Math.random() * 200);
  const params = new URLSearchParams({
    propertyId: stay.propertyId,
    roomId: room.id,
    ratePlanId: plan.id,
    checkIn: isoDaysFromNow(offset),
    checkOut: isoDaysFromNow(offset + 2),
    guestCount: "2",
  });
  await page.goto(`/checkout?${params.toString()}`);
  await page.getByRole("button", { name: "Rezervasyonu Tamamla" }).click();
  await page.waitForURL(/\/booking\/[^/?#]+$/);
  const option = page.getByTestId("rnpl-option");
  await option.getByRole("radio", { name: /sonra öde/ }).check();
  await page.getByTestId("rnpl-timeline").waitFor();
  await option.scrollIntoViewIfNeeded();
  await shot(page, "v5-rnpl-checkout", true);
  const form = page.getByRole("form", { name: "Ödeme" });
  await form.getByLabel("Kart numarası").fill("4242 4242 4242 4242");
  await form.getByLabel("CVC").fill("123");
  await form.getByRole("button", { name: /Şimdi rezerve et/ }).click();
  const planCard = page.getByTestId("rnpl-plan");
  await planCard.waitFor();
  await planCard.scrollIntoViewIfNeeded();
  await shot(page, "v5-rnpl-plan", true);

  // PDP: kayıt/belge numarası.
  await page.goto(`/property/${stay.propertyId}`);
  await page.getByTestId("registration-number").waitFor();
  await shot(page, "v5-pdp-registration", true);

  // Destek sohbeti: soru + "İnsana bağlan".
  await page.goto("/support");
  const input = page.getByLabel("Mesajınız");
  await input.fill("Check-in saati kaçta?");
  await page.getByRole("button", { name: "Gönder" }).click();
  await page.getByText("Asistan").first().waitFor();
  await page.getByRole("button", { name: "İnsana bağlan" }).click();
  await page.getByText(/Konu insan destek ekibine devredildi/).waitFor();
  await shot(page, "v5-support-chat", true);
  await guest.close();

  const admin = await newContext(browser, "admin@booking.test");
  const adminPage = await admin.newPage();
  await adminPage.goto("/admin/support");
  await adminPage.locator("#support-admin").waitFor();
  await shot(adminPage, "v5-admin-support", true);
  await admin.close();

  const anon = await newContext(browser);
  const trustPage = await anon.newPage();
  await trustPage.goto("/trust");
  await trustPage.getByTestId("trust-sbom").waitFor();
  await shot(trustPage, "v5-trust", true);
  await anon.close();

  if (SET === "v5") {
    const token = await accessToken(await newContext(browser), "guest@booking.test");
    await renderStayCard(browser, token, isoDaysFromNow(offset + 5), isoDaysFromNow(offset + 7));
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`screenshots failed: ${String(error)}\n`);
  process.exit(1);
});
