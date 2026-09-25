import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken } from "@/lib/auth/tokens";
import { feedToken, verifyFeedToken } from "@/lib/channel/channel";
import {
  pollDueSubscriptions,
  pollSubscription,
  upsertSubscription,
  type IcalFetcher,
} from "@/lib/channel/ical-poller";
import { GET as calendarGet } from "@/app/api/rooms/[roomId]/calendar.ics/route";
import { POST as rotatePost } from "@/app/api/rooms/[roomId]/calendar/token/route";
import { POST as subscriptionsPost } from "@/app/api/rooms/[roomId]/calendar/subscriptions/route";
import { POST as parityPost } from "@/app/api/rooms/[roomId]/channel/parity/route";

/** Kanal yöneticisi (P1-9, v3#21): token döndürme, iCal yoklayıcı, parite uyarısı. */

const BASE = "http://localhost:3000";
const ymd = (d: Date) => iso(d).replaceAll("-", "");
const feed = (uid: string, from: number, to: number) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${ymd(utcDay(from))}`,
    `DTEND;VALUE=DATE:${ymd(utcDay(to))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

function req(path: string, token?: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${BASE}${path}`, {
    method: body !== undefined || path.includes("/token") ? "POST" : "GET",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describeInt("kanal yöneticisi (integration)", () => {
  const prisma = new PrismaClient();
  const saved = process.env.CHANNEL_FEED_SECRET;
  let fx: StayFixture;
  let hostToken: string;
  let otherToken: string;

  beforeAll(async () => {
    process.env.CHANNEL_FEED_SECRET = "feed-test-only-".padEnd(40, "x");
    fx = await createStayFixture(prisma, { tag: "chan", nightlyPrice: 1000 });
    hostToken = (await signAccessToken(fx.hostId, "HOST", 300)).token;
    otherToken = (await signAccessToken(fx.userId, "HOST", 300)).token;
  });

  afterAll(async () => {
    if (saved === undefined) delete process.env.CHANNEL_FEED_SECRET;
    else process.env.CHANNEL_FEED_SECRET = saved;
    await prisma.$disconnect();
  });

  const room = () => ({ params: Promise.resolve({ roomId: fx.roomId }) });

  it("regression: v3#21 token döndürülünce eski akış URL'si 403, yenisi 200", async () => {
    const legacy = feedToken(fx.roomId);
    expect(await verifyFeedToken(fx.roomId, legacy)).toBe(true);

    expect(
      (await rotatePost(req(`/api/rooms/${fx.roomId}/calendar/token`, otherToken), room())).status
    ).toBe(404);
    const res = await rotatePost(req(`/api/rooms/${fx.roomId}/calendar/token`, hostToken), room());
    expect(res.status).toBe(200);
    const { path, version } = (await res.json()) as { path: string; version: number };
    expect(version).toBe(1);

    const old = await calendarGet(
      req(`/api/rooms/${fx.roomId}/calendar.ics?token=${legacy}`),
      room()
    );
    expect(old.status).toBe(403);
    const fresh = await calendarGet(req(path), room());
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toContain("BEGIN:VCALENDAR");
  });

  it("regression: v3#21 abonelik iç ağ URL'sini reddeder", async () => {
    const bad = await subscriptionsPost(
      req(`/api/rooms/${fx.roomId}/calendar/subscriptions`, hostToken, {
        source: "evil",
        url: "https://169.254.169.254/latest/meta-data",
      }),
      room()
    );
    expect(bad.status).toBe(400);
    expect(await prisma.icalSubscription.count({ where: { roomTypeId: fx.roomId } })).toBe(0);
  });

  it("regression: v3#21 yoklayıcı: 200 içe aktarır + ETag saklar, 304 dokunmaz, hata durumu yazar", async () => {
    const sub = await upsertSubscription(fx.roomId, "airbnb", "https://ical.example.com/r.ics");
    const calls: Array<{ etag?: string | null }> = [];
    let mode: "ok" | "304" | "fail" = "ok";
    const fetcher: IcalFetcher = async (_url, cond) => {
      calls.push(cond);
      if (mode === "304") return { status: "not_modified" };
      if (mode === "fail") throw new Error("ağ yok");
      return { status: "ok", body: feed("ext-1", 20, 22), etag: '"v1"', lastModified: null };
    };

    const first = await pollDueSubscriptions(fetcher);
    expect(first).toMatchObject({ polled: 1, ok: 1 });
    const blocks = () => prisma.externalBlock.count({ where: { roomTypeId: fx.roomId } });
    expect(await blocks()).toBe(2);

    // Aralık dolmadan tekrar tur → yoklanmaz.
    expect((await pollDueSubscriptions(fetcher)).polled).toBe(0);

    mode = "304";
    const row = await prisma.icalSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.etag).toBe('"v1"');
    expect(await pollSubscription(row, fetcher)).toEqual({ status: "not_modified" });
    expect(calls.at(-1)?.etag).toBe('"v1"');
    expect(await blocks()).toBe(2);

    mode = "fail";
    expect(await pollSubscription(row, fetcher)).toMatchObject({ status: "error" });
    const failed = await prisma.icalSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(failed).toMatchObject({ lastStatus: "error", lastError: "ağ yok", active: true });
    expect(await blocks()).toBe(2);
  });

  it("parite kontrolü yalnızca uyarır, fiyatı değiştirmez", async () => {
    const date = iso(utcDay(3));
    const res = await parityPost(
      req(`/api/rooms/${fx.roomId}/channel/parity`, hostToken, {
        channel: "booking-x",
        rates: [{ date, price: "800.00" }],
      }),
      room()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enforced: boolean; warnings: Array<{ diffBps: number }> };
    expect(body.enforced).toBe(false);
    expect(body.warnings).toEqual([expect.objectContaining({ date, diffBps: -2000 })]);
    const day = await prisma.inventoryDay.findFirstOrThrow({
      where: { roomTypeId: fx.roomId, date: utcDay(3) },
    });
    expect(Number(day.price)).toBe(1000);
  });
});
