// v4#14: bayat rezervasyon durumu (outbox ile önbellek silme) + cursor pagination.
import { beforeAll, afterAll, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { getBooking, listUserBookingsPage } from "@/lib/booking-service";
import { bookingCacheKey } from "@/lib/booking/booking-cache";
import { appendOutbox, relayOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type BookingExpiredPayload } from "@/lib/events/events";
import { registerEventHandlers } from "@/lib/events/register";
import { inlineFlow, setFulfilmentFlowForTests } from "@/lib/saga/booking-saga";
import { redis } from "@/lib/redis";
import { signAccessToken } from "@/lib/auth/tokens";
import { GET as bookingsGet } from "@/app/api/bookings/route";

describeInt("regression: v4#14 rezervasyon önbelleği ve sayfalama (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;

  beforeAll(async () => {
    registerEventHandlers();
    setFulfilmentFlowForTests(inlineFlow);
    fx = await createStayFixture(prisma, { tag: "v4page", units: 5 });
  });
  afterAll(async () => {
    setFulfilmentFlowForTests(null);
    await prisma.$disconnect();
  });

  it("durum değişimi: outbox tüketicisi detay önbelleğini siler (TTL beklenmez)", async () => {
    const held = await fx.hold();
    expect((await getBooking(held.id, fx.userId)).status).toBe("HELD");
    expect(await redis.get(bookingCacheKey(held.id))).not.toBeNull();

    // Yazan tarafın doğrudan silmesi düşmüş gibi: yalnızca DB + outbox.
    await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({ where: { id: held.id }, data: { status: "EXPIRED" } });
      await appendOutbox(
        tx,
        makeEvent<BookingExpiredPayload>(EventTypes.BookingExpired, b.id, "booking", {
          bookingId: b.id,
          propertyId: b.propertyId,
          roomId: b.roomId,
          checkIn: held.checkIn,
          checkOut: held.checkOut,
          userId: b.userId,
          reason: "hold_timeout",
        })
      );
    });
    // Tüketiciden önce önbellek bayat (hatanın kendisi).
    expect((await getBooking(held.id, fx.userId)).status).toBe("HELD");

    await relayOutbox(500);
    expect(await redis.get(bookingCacheKey(held.id))).toBeNull();
    expect((await getBooking(held.id, fx.userId)).status).toBe("EXPIRED");
  });

  it("ödeme durumu önbellekten değil her okumada tazedir", async () => {
    const held = await fx.hold();
    expect((await getBooking(held.id, fx.userId)).payment).toBeNull();
    await prisma.payment.create({
      data: {
        bookingId: held.id,
        userId: fx.userId,
        amount: new Prisma.Decimal(10),
        provider: "mock",
        status: "PAID",
      },
    });
    expect(await redis.get(bookingCacheKey(held.id))).not.toBeNull();
    const again = await getBooking(held.id, fx.userId);
    expect(again.payment?.status).toBe("PAID");
  });

  it("cursor pagination: tekrar/eksik yok, sıralı; geçersiz imleç 400", async () => {
    for (let i = 0; i < 3; i++) await fx.hold();
    const all = await prisma.booking.findMany({
      where: { userId: fx.userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    expect(all.length).toBeGreaterThanOrEqual(5);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listUserBookingsPage(fx.userId, { cursor, limit: 2 });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((b) => b.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);
    expect(seen).toEqual(all.map((b) => b.id));

    await expect(listUserBookingsPage(fx.userId, { cursor: "bozuk!" })).rejects.toMatchObject({
      status: 400,
    });
    // Başka kullanıcı bu imleçle yalnızca kendi kayıtlarını görür.
    const firstPage = await listUserBookingsPage(fx.userId, { limit: 1 });
    const other = await listUserBookingsPage(fx.hostId, { cursor: firstPage.nextCursor });
    expect(other.items).toEqual([]);
  });

  it("GET /api/bookings: gövde dizi (geriye uyum), sonraki sayfa başlıkta", async () => {
    const token = (await signAccessToken(fx.userId, "USER", 300)).token;
    const req = (path: string) =>
      new NextRequest(`http://localhost:3000${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });

    const first = await bookingsGet(req("/api/bookings?limit=2"), undefined);
    expect(first.status).toBe(200);
    const body = (await first.json()) as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    const next = first.headers.get("x-next-cursor");
    expect(next).toBeTruthy();
    expect(first.headers.get("link")).toContain('rel="next"');

    const second = await bookingsGet(
      req(`/api/bookings?limit=2&cursor=${encodeURIComponent(next!)}`),
      undefined
    );
    const body2 = (await second.json()) as Array<{ id: string }>;
    expect(body2.map((b) => b.id)).not.toContain(body[0].id);

    const unpaged = (await (
      await bookingsGet(req("/api/bookings"), undefined)
    ).json()) as unknown[];
    expect(unpaged.length).toBeGreaterThanOrEqual(5);
    expect((await bookingsGet(req("/api/bookings?limit=0"), undefined)).status).toBe(400);
  });
});
