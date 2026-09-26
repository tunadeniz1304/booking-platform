/**
 * README ekran görüntüleri: `npm run docs:screenshots`
 *
 * Çalışan demo yığınına karşı (`docker compose up -d --build`, seed'li, LLM demo modu)
 * Playwright ile `docs/img/*.png` üretir. `SCREENSHOT_BASE_URL` varsayılanı http://localhost:3000.
 * Yalnızca demo seed hesaplarını kullanır.
 */
import path from "path";
import { mkdirSync } from "fs";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = path.resolve(process.cwd(), "docs/img");
const DEMO_PASS = "Password123!";

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function newContext(
  browser: import("@playwright/test").Browser,
  email?: string
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
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

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  process.stdout.write(`docs/img/${name}.png\n`);
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
 * MCP `ui://stay-card` widget'ı: şablon ve `search_stays` çıktısı gerçek `POST /api/mcp`
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
  const resource = await rpc(1, "resources/read", { uri: "ui://stay-card" });
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

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const guest = await newContext(browser, "guest@booking.test");
    const page = await guest.newPage();

    await page.goto("/");
    await shot(page, "home");

    const checkIn = isoDaysFromNow(30);
    const checkOut = isoDaysFromNow(33);
    await page.goto(
      `/search?destination=İstanbul&checkIn=${checkIn}&checkOut=${checkOut}&guests=2`
    );
    await page
      .getByLabel(/Akıllı filtre/)
      .fill("İstanbul'da wifi olan, 2 kişi, gecesi 5000 TL altı");
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
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`screenshots failed: ${String(error)}\n`);
  process.exit(1);
});
