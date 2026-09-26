import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";

/**
 * P1-12 PWA + Web Push entegrasyonu: abonelik API'si (yetki + sahiplik + SSRF izin listesi +
 * push kapalıyken 503), seyahat planı API'si (yalnızca kendi yaklaşan onaylı rezervasyonları,
 * imzalı kod), check-in hatırlatma işi ve 410 temizliği gerçek Postgres üzerinde.
 */
const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification } }));

import {
  GET as pushGet,
  POST as pushPost,
  DELETE as pushDelete,
} from "@/app/api/push/subscription/route";
import { GET as itineraryGet } from "@/app/api/itinerary/route";
import { signAccessToken } from "@/lib/auth";
import { resetConfigForTests } from "@/lib/config/app-config";
import { verifyBookingCode } from "@/lib/booking/booking-code";
import { runCheckinReminders, pushPriceDrop } from "@/lib/push/notifications";

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;

const VAPID = {
  VAPID_PUBLIC_KEY: "BPubKeyForIntegrationTests_abcdefghijklmnop",
  VAPID_PRIVATE_KEY: "privKeyIntTestOnly",
  VAPID_SUBJECT: "mailto:ops@booking.test",
};

function setVapid(on: boolean) {
  for (const [k, v] of Object.entries(VAPID)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
  resetConfigForTests();
}

describeInt("P1-12 PWA + Web Push", () => {
  const prisma = new PrismaClient();
  let stay: StayFixture;
  let otherUserId: string;
  let tokenA: string;
  let tokenB: string;

  const endpoint = (id: string) => `https://fcm.googleapis.com/fcm/send/p112-${id}-${Date.now()}`;
  const body = (ep: string, locale = "tr") => ({
    endpoint: ep,
    keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA", auth: "tBHItJI5svbpez7KI4CCXg" },
    locale,
    expirationTime: null,
  });
  const call = (handler: unknown, method: string, token: string | null, payload?: unknown) =>
    (handler as Handler)(
      new NextRequest(`http://localhost:3000/api/push/subscription`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      })
    );

  beforeAll(async () => {
    stay = await createStayFixture(prisma, { tag: "p112", days: 30 });
    const other = await prisma.user.create({
      data: {
        email: `p112-other-${Date.now()}@t.test`,
        passwordHash: "x",
        emailVerifiedAt: new Date(),
        firstName: "Diğer",
        lastName: "Kullanıcı",
      },
    });
    otherUserId = other.id;
    tokenA = (await signAccessToken(stay.userId, "USER", 900)).token;
    tokenB = (await signAccessToken(otherUserId, "USER", 900)).token;
  });

  beforeEach(() => {
    setVapid(true);
    sendNotification.mockReset();
    sendNotification.mockResolvedValue({ statusCode: 201 });
  });

  afterEach(() => setVapid(false));

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("oturumsuz 401; VAPID yokken abonelik 503 PUSH_DISABLED ve GET nedeni açıklar", async () => {
    expect((await call(pushPost, "POST", null, body(endpoint("anon")))).status).toBe(401);
    setVapid(false);
    const res = await call(pushPost, "POST", tokenA, body(endpoint("off")));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("PUSH_DISABLED");
    const status = (await (await call(pushGet, "GET", tokenA)).json()) as {
      enabled: boolean;
      publicKey: string | null;
      reason: string;
    };
    expect(status).toMatchObject({ enabled: false, publicKey: null, reason: "VAPID_MISSING" });
  });

  it("izinli olmayan uç nokta (SSRF) ve bozuk gövde reddedilir", async () => {
    const evil = await call(pushPost, "POST", tokenA, {
      ...body("https://169.254.169.254/latest/meta-data"),
    });
    expect(evil.status).toBe(400);
    expect(((await evil.json()) as { code: string }).code).toBe("PUSH_ENDPOINT_NOT_ALLOWED");
    const bad = await call(pushPost, "POST", tokenA, { endpoint: endpoint("x"), keys: {} });
    expect(bad.status).toBe(400);
  });

  it("abonelik sahibine yazılır; başkası silemez (404), sahibi silebilir (204)", async () => {
    const ep = endpoint("own");
    const created = await call(pushPost, "POST", tokenA, body(ep, "en"));
    expect(created.status).toBe(201);
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: ep } });
    expect(row).toMatchObject({ userId: stay.userId, locale: "en" });

    const status = (await (await call(pushGet, "GET", tokenA)).json()) as {
      enabled: boolean;
      publicKey: string;
      subscriptions: number;
    };
    expect(status.enabled).toBe(true);
    expect(status.publicKey).toBe(VAPID.VAPID_PUBLIC_KEY);
    expect(status.subscriptions).toBeGreaterThanOrEqual(1);

    expect((await call(pushDelete, "DELETE", tokenB, { endpoint: ep })).status).toBe(404);
    expect(await prisma.pushSubscription.count({ where: { endpoint: ep } })).toBe(1);
    expect((await call(pushDelete, "DELETE", tokenA, { endpoint: ep })).status).toBe(204);
    expect(await prisma.pushSubscription.count({ where: { endpoint: ep } })).toBe(0);
  });

  it("aynı tarayıcı uç noktasıyla başka hesap abone olursa kayıt yeni hesaba geçer", async () => {
    const ep = endpoint("shared");
    expect((await call(pushPost, "POST", tokenA, body(ep))).status).toBe(201);
    expect((await call(pushPost, "POST", tokenB, body(ep))).status).toBe(201);
    const rows = await prisma.pushSubscription.findMany({ where: { endpoint: ep } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(otherUserId);
    await prisma.pushSubscription.deleteMany({ where: { endpoint: ep } });
  });

  it("cihaz sınırı aşılınca en eski abonelik düşer", async () => {
    process.env.PUSH_MAX_SUBSCRIPTIONS_PER_USER = "2";
    resetConfigForTests();
    try {
      const eps = [endpoint("c1"), endpoint("c2"), endpoint("c3")];
      for (const ep of eps) {
        expect((await call(pushPost, "POST", tokenB, body(ep))).status).toBe(201);
        await new Promise((r) => setTimeout(r, 5));
      }
      const left = await prisma.pushSubscription.findMany({ where: { userId: otherUserId } });
      expect(left.map((s) => s.endpoint).sort()).toEqual([eps[1], eps[2]].sort());
    } finally {
      delete process.env.PUSH_MAX_SUBSCRIPTIONS_PER_USER;
      await prisma.pushSubscription.deleteMany({ where: { userId: otherUserId } });
    }
  });

  it("seyahat planı yalnızca kendi yaklaşan ONAYLI rezervasyonlarını ve imzalı kodu döndürür", async () => {
    const confirmed = await stay.hold({ nights: 2, startInDays: 3 });
    await prisma.booking.update({ where: { id: confirmed.id }, data: { status: "CONFIRMED" } });
    const held = await stay.hold({ nights: 1, startInDays: 8 });
    const foreign = await stay.hold({ nights: 1, startInDays: 10, userId: otherUserId });
    await prisma.booking.update({ where: { id: foreign.id }, data: { status: "CONFIRMED" } });

    const res = await (itineraryGet as unknown as Handler)(
      new NextRequest("http://localhost:3000/api/itinerary", {
        headers: { authorization: `Bearer ${tokenA}` },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const data = (await res.json()) as {
      items: Array<{ id: string; code: string; qrDataUrl: string; checkIn: string }>;
    };
    const ids = data.items.map((i) => i.id);
    expect(ids).toContain(confirmed.id);
    expect(ids).not.toContain(held.id);
    expect(ids).not.toContain(foreign.id);
    const item = data.items.find((i) => i.id === confirmed.id)!;
    expect(verifyBookingCode(item.code)).toBe(confirmed.id);
    expect(item.qrDataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
    // Kod ve yanıt kişisel veri taşımaz.
    expect(JSON.stringify(data)).not.toMatch(/@t\.test/);

    const anon = await (itineraryGet as unknown as Handler)(
      new NextRequest("http://localhost:3000/api/itinerary")
    );
    expect(anon.status).toBe(401);
  });

  it("check-in hatırlatma: yarınki onaylı rezervasyona push, 410 dönen abonelik silinir", async () => {
    const booking = await stay.hold({ nights: 1, startInDays: 1 });
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } });
    const live = endpoint("live");
    const dead = endpoint("dead");
    await prisma.pushSubscription.createMany({
      data: [live, dead].map((ep) => ({
        userId: stay.userId,
        endpoint: ep,
        p256dh: "p",
        auth: "a",
      })),
    });
    sendNotification.mockImplementation(async (target: { endpoint: string }) => {
      if (target.endpoint === dead) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });

    const now = new Date(utcDay(0).getTime() + 7 * 3600_000);
    const run = await runCheckinReminders(now);
    expect(run.sent).toBeGreaterThanOrEqual(1);
    expect(run.removed).toBeGreaterThanOrEqual(1);
    const payloads = sendNotification.mock.calls
      .filter(([t]) => (t as { endpoint: string }).endpoint === live)
      .map(([, p]) => JSON.parse(p as string) as { tag: string; url: string });
    expect(payloads.some((p) => p.tag === `checkin:${booking.id}` && p.url === "/trips")).toBe(
      true
    );
    expect(await prisma.pushSubscription.count({ where: { endpoint: dead } })).toBe(0);
    expect(
      (await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: live } })).lastSuccessAt
    ).not.toBeNull();

    // İkinci koşu aynı rezervasyonu tekrar bildirmez.
    sendNotification.mockClear();
    await runCheckinReminders(now);
    expect(
      sendNotification.mock.calls.filter(([t]) => (t as { endpoint: string }).endpoint === live)
    ).toHaveLength(0);
  });

  it("fiyat düşüşü olayı abone cihaza push olarak gider", async () => {
    sendNotification.mockClear();
    await pushPriceDrop({
      alertId: `alert-${Date.now()}`,
      userId: stay.userId,
      to: "x@t.test",
      name: "Test",
      propertyId: stay.propertyId,
      propertyTitle: "Test Evi",
      roomName: "Oda",
      checkIn: "2026-12-01",
      checkOut: "2026-12-03",
      currency: "TRY",
      previousMinor: 1000,
      currentMinor: 900,
      observedOn: "2026-09-26",
    });
    expect(sendNotification).toHaveBeenCalled();
    const payload = JSON.parse(sendNotification.mock.calls[0][1] as string) as { url: string };
    expect(payload.url).toBe(`/property/${stay.propertyId}`);
  });
});
