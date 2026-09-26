import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1-12 Web Push birim testleri: yapılandırma (VAPID yoksa kapalı), uç nokta izin listesi
 * (SSRF), gönderim, 404/410 temizleme, hata sayacı, tekilleştirme ve bildirim metinleri.
 * `web-push` mock'lanır — testler ağa çıkmaz.
 */

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification } }));

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis(), getRedisConnection: () => ({}) };
});

interface Sub {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: string;
  failureCount: number;
  lastSuccessAt: Date | null;
}
const store = vi.hoisted(() => ({ subs: [] as Sub[], bookings: [] as unknown[] }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        store.subs.filter((s) => s.userId === where.userId)
      ),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        const before = store.subs.length;
        store.subs = store.subs.filter((s) => s.id !== where.id);
        return { count: before - store.subs.length };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { failureCount?: number | { increment: number }; lastSuccessAt?: Date };
        }) => {
          const sub = store.subs.find((s) => s.id === where.id);
          if (!sub) return { count: 0 };
          if (typeof data.failureCount === "number") sub.failureCount = data.failureCount;
          else if (data.failureCount) sub.failureCount += data.failureCount.increment;
          if (data.lastSuccessAt) sub.lastSuccessAt = data.lastSuccessAt;
          return { count: 1 };
        }
      ),
    },
    booking: { findMany: vi.fn(async () => store.bookings) },
  },
}));

import { resetConfigForTests } from "@/lib/config/app-config";
import { getPushSettings, isAllowedPushEndpoint } from "@/lib/push/config";
import { sendPushToUser, toLocale } from "@/lib/push/send";
import {
  checkinReminderMessage,
  priceDropMessage,
  pushPriceDrop,
  runCheckinReminders,
} from "@/lib/push/notifications";
import { prisma } from "@/lib/prisma";
import type { PriceDroppedPayload } from "@/lib/events/events";

const VAPID = {
  VAPID_PUBLIC_KEY: "BPubKeyForTestsOnly_abcdefghijklmnopqrstuvwxyz",
  VAPID_PRIVATE_KEY: "privKeyTestOnly",
  VAPID_SUBJECT: "mailto:ops@booking.test",
};

function setVapid(values: Partial<typeof VAPID>) {
  for (const key of Object.keys(VAPID) as Array<keyof typeof VAPID>) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  resetConfigForTests();
}

function sub(id: string, userId = "u1", locale = "tr"): Sub {
  return {
    id,
    userId,
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    p256dh: "p256dh-key",
    auth: "auth-key",
    locale,
    failureCount: 0,
    lastSuccessAt: null,
  };
}

const drop: PriceDroppedPayload = {
  alertId: "alert1",
  userId: "u1",
  to: "guest@booking.test",
  name: "Ayşe",
  propertyId: "prop1",
  propertyTitle: "Boğaz Evi",
  roomName: "Deluxe",
  checkIn: "2026-10-10",
  checkOut: "2026-10-12",
  currency: "TRY",
  previousMinor: 500000,
  currentMinor: 450000,
  observedOn: "2026-09-26",
};

beforeEach(async () => {
  store.subs = [];
  store.bookings = [];
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201 });
  vi.mocked(prisma.booking.findMany).mockClear();
  vi.mocked(prisma.pushSubscription.findMany).mockClear();
  setVapid(VAPID);
});

afterEach(() => {
  setVapid({});
});

describe("P1-12 push yapılandırması", () => {
  it("VAPID anahtarlarından biri yoksa push kapalıdır", () => {
    setVapid({ ...VAPID, VAPID_PRIVATE_KEY: undefined });
    expect(getPushSettings()).toEqual({ enabled: false, reason: "VAPID_MISSING" });
  });

  it("VAPID_SUBJECT mailto:/https: değilse kapalıdır", () => {
    setVapid({ ...VAPID, VAPID_SUBJECT: "ops@booking.test" });
    expect(getPushSettings()).toEqual({ enabled: false, reason: "VAPID_SUBJECT_INVALID" });
  });

  it("üç değer de geçerliyse açıktır", () => {
    expect(getPushSettings()).toMatchObject({ enabled: true, subject: VAPID.VAPID_SUBJECT });
  });

  it("uç nokta yalnızca izinli push servislerine (https, 443) işaret edebilir", () => {
    const hosts = "fcm.googleapis.com,*.push.apple.com";
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/x", hosts)).toBe(true);
    expect(isAllowedPushEndpoint("https://api.push.apple.com/3/device/x", hosts)).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x", hosts)).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.test/x", hosts)).toBe(false);
    expect(isAllowedPushEndpoint("https://evilfcm.googleapis.com/x", hosts)).toBe(false);
    expect(isAllowedPushEndpoint("https://push.apple.com/x", hosts)).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x", hosts)).toBe(false);
    expect(isAllowedPushEndpoint("https://u:p@fcm.googleapis.com/x", hosts)).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest", hosts)).toBe(false);
    expect(isAllowedPushEndpoint("not a url", hosts)).toBe(false);
  });
});

describe("P1-12 push gönderimi", () => {
  it("push kapalıyken hiçbir şey göndermez (config kapalı)", async () => {
    setVapid({});
    store.subs = [sub("s1")];
    const result = await sendPushToUser("u1", "test", () => priceDropMessage(drop, "tr"));
    expect(result).toEqual({ sent: 0, removed: 0, failed: 0, skipped: "disabled" });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("aboneliği olmayan kullanıcı atlanır", async () => {
    const result = await sendPushToUser("u1", "test", () => priceDropMessage(drop, "tr"));
    expect(result.skipped).toBe("no_subscriptions");
  });

  it("her cihaza kendi dilinde, VAPID ve TTL ile gönderir; başarı sayacı sıfırlanır", async () => {
    store.subs = [sub("s1", "u1", "tr"), sub("s2", "u1", "en")];
    store.subs[0].failureCount = 3;
    const result = await sendPushToUser("u1", "price_drop", (l) => priceDropMessage(drop, l));
    expect(result).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [target, payload, options] = sendNotification.mock.calls[0];
    expect(target).toEqual({
      endpoint: store.subs[0].endpoint,
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    expect(JSON.parse(payload)).toMatchObject({ title: "Fiyat düştü", url: "/property/prop1" });
    expect(JSON.parse(sendNotification.mock.calls[1][1]).title).toBe("Price drop");
    expect(options).toMatchObject({
      vapidDetails: {
        subject: VAPID.VAPID_SUBJECT,
        publicKey: VAPID.VAPID_PUBLIC_KEY,
        privateKey: VAPID.VAPID_PRIVATE_KEY,
      },
      TTL: 86400,
    });
    expect(store.subs[0].failureCount).toBe(0);
    expect(store.subs[0].lastSuccessAt).toBeInstanceOf(Date);
  });

  it("404/410 dönen abonelik silinir, diğer hatalar sayaç artırır", async () => {
    store.subs = [sub("gone410"), sub("gone404"), sub("flaky"), sub("ok")];
    sendNotification.mockImplementation(async (target: { endpoint: string }) => {
      if (target.endpoint.endsWith("gone410"))
        throw Object.assign(new Error("Gone"), { statusCode: 410 });
      if (target.endpoint.endsWith("gone404"))
        throw Object.assign(new Error("NF"), { statusCode: 404 });
      if (target.endpoint.endsWith("flaky"))
        throw Object.assign(new Error("5xx"), { statusCode: 503 });
      return { statusCode: 201 };
    });
    const result = await sendPushToUser("u1", "test", (l) => priceDropMessage(drop, l));
    expect(result).toEqual({ sent: 1, removed: 2, failed: 1 });
    expect(store.subs.map((s) => s.id).sort()).toEqual(["flaky", "ok"]);
    expect(store.subs.find((s) => s.id === "flaky")?.failureCount).toBe(1);
  });

  it("aynı dedupeKey ikinci kez gönderilmez (at-least-once olay teslimi)", async () => {
    store.subs = [sub("s1")];
    const build = () => priceDropMessage(drop, "tr");
    expect((await sendPushToUser("u1", "t", build, { dedupeKey: "k1" })).sent).toBe(1);
    expect((await sendPushToUser("u1", "t", build, { dedupeKey: "k1" })).skipped).toBe("duplicate");
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("pushPriceDrop hata fırlatmaz (e-posta tüketicisini etkilemez)", async () => {
    vi.mocked(prisma.pushSubscription.findMany).mockRejectedValueOnce(new Error("db down"));
    await expect(pushPriceDrop(drop)).resolves.toBeUndefined();
  });

  it("pushPriceDrop alarm+gün başına tekildir", async () => {
    store.subs = [sub("s1")];
    await pushPriceDrop(drop);
    await pushPriceDrop(drop);
    await pushPriceDrop({ ...drop, observedOn: "2026-09-27" });
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });
});

describe("P1-12 bildirim metinleri ve check-in hatırlatma işi", () => {
  it("TR/EN metinler kişisel veri ve tutar içermez", () => {
    for (const locale of ["tr", "en"] as const) {
      const m = priceDropMessage(drop, locale);
      expect(m.body).not.toContain("guest@booking.test");
      expect(m.body).not.toContain("4500");
      expect(m.tag).toBe("price-drop:alert1");
    }
    const b = { id: "b1", propertyTitle: "Boğaz Evi", checkIn: "2026-09-27" };
    expect(checkinReminderMessage(b, 1, "tr").title).toBe("Yarın check-in");
    expect(checkinReminderMessage(b, 0, "en").title).toBe("Check-in today");
    expect(checkinReminderMessage(b, 3, "tr").title).toBe("3 gün sonra check-in");
    expect(checkinReminderMessage(b, 2, "en")).toMatchObject({
      title: "Check-in in 2 days",
      url: "/trips",
      tag: "checkin:b1",
    });
    expect(toLocale("de")).toBe("tr");
  });

  it("push kapalıyken iş veritabanına bile bakmaz", async () => {
    setVapid({});
    const run = await runCheckinReminders(new Date("2026-09-26T07:00:00Z"));
    expect(run.disabled).toBe(true);
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it("yarın girişi olan onaylı rezervasyonlara bir kez hatırlatır", async () => {
    store.subs = [sub("s1", "u1"), sub("s2", "u2")];
    store.bookings = [
      {
        id: "b1",
        userId: "u1",
        checkIn: new Date("2026-09-27T00:00:00Z"),
        property: { title: "Boğaz Evi" },
      },
      {
        id: "b2",
        userId: "u2",
        checkIn: new Date("2026-09-27T00:00:00Z"),
        property: { title: "Kapadokya" },
      },
    ];
    const now = new Date("2026-09-26T07:00:00Z");
    const first = await runCheckinReminders(now);
    expect(first).toMatchObject({ candidates: 2, sent: 2, skipped: 0, disabled: false });
    const where = vi.mocked(prisma.booking.findMany).mock.calls[0][0] as {
      where: { status: string; checkIn: Date };
    };
    expect(where.where.status).toBe("CONFIRMED");
    expect(where.where.checkIn.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    const second = await runCheckinReminders(now);
    expect(second).toMatchObject({ sent: 0, skipped: 2 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });
});
