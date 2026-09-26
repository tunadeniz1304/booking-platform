// v4#9: rezervasyon Idempotency-Key'i istek gövdesine bağlı olmalı.
import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { createBooking } from "@/lib/booking-service";

describeInt("regression: v4#9 rezervasyon idempotency gövde özeti (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;

  const body = (start: number, extra: { guestCount?: number } = {}) => ({
    userId: fx.userId,
    propertyId: fx.propertyId,
    roomId: fx.roomId,
    checkIn: iso(utcDay(start)),
    checkOut: iso(utcDay(start + 2)),
    guestCount: extra.guestCount ?? 1,
  });

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v4idem", units: 3 });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("aynı anahtar + aynı gövde → aynı rezervasyon (replay)", async () => {
    const key = `idem-same-${Date.now()}`;
    const first = await createBooking({ ...body(10), idempotencyKey: key });
    const again = await createBooking({ ...body(10), idempotencyKey: key });
    expect(again.booking.id).toBe(first.booking.id);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: first.booking.id } });
    expect(row.idempotencyRequestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("aynı anahtar + farklı tarih/misafir → 409 IDEMPOTENCY_KEY_REUSED, yeni kayıt yok", async () => {
    const key = `idem-diff-${Date.now()}`;
    const first = await createBooking({ ...body(20), idempotencyKey: key });
    await expect(createBooking({ ...body(30), idempotencyKey: key })).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    await expect(
      createBooking({ ...body(20, { guestCount: 2 }), idempotencyKey: key })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const rows = await prisma.booking.findMany({
      where: { userId: fx.userId, idempotencyKey: key },
    });
    expect(rows.map((r) => r.id)).toEqual([first.booking.id]);
  });

  it("özeti olmayan (v4 öncesi) kayıt geriye uyumlu olarak döner", async () => {
    const key = `idem-legacy-${Date.now()}`;
    const first = await createBooking({ ...body(40), idempotencyKey: key });
    await prisma.booking.update({
      where: { id: first.booking.id },
      data: { idempotencyRequestHash: null },
    });
    const again = await createBooking({ ...body(50), idempotencyKey: key });
    expect(again.booking.id).toBe(first.booking.id);
  });

  it("anahtarsız isteklerde özet yazılmaz", async () => {
    const res = await createBooking(body(60));
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(row.idempotencyRequestHash).toBeNull();
  });
});
