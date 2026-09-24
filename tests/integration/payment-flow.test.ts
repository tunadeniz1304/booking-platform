import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createBooking, expireHolds } from "@/lib/booking-service";
import {
  cancelAndRefund,
  confirmPaymentChallenge,
  handleWebhookEvent,
  payForBooking,
} from "@/lib/payment/payment-service";
import { relayOutbox } from "@/lib/cqrs";
import { registerEventHandlers } from "@/lib/events/register";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";

describeInt("ödeme, iptal, iade ve bildirim (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let userId = "";
  let propertyId = "";
  let roomId = "";
  let day = 5;

  async function hold(nights = 2) {
    const start = day;
    day += nights + 1;
    const { booking } = await createBooking({
      userId,
      propertyId,
      roomId,
      checkIn: iso(utcDay(start)),
      checkOut: iso(utcDay(start + nights)),
      guestCount: 1,
    });
    return booking;
  }

  beforeAll(async () => {
    registerEventHandlers();
    const user = await prisma.user.create({
      data: { email: `pay-${stamp}@t.test`, passwordHash: "x", firstName: "Ayşe", lastName: "Ö" },
    });
    userId = user.id;
    const location = await prisma.location.create({
      data: { city: `PayCity-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        hostId: user.id,
        title: "Ödeme Oteli",
        description: "payment test",
        propertyType: "HOTEL",
        locationId: location.id,
        basePrice: new Prisma.Decimal(1000),
        cancellationPolicyId: "policy_moderate_v1",
      },
    });
    propertyId = property.id;
    const room = await prisma.room.create({
      data: { propertyId, name: "Oda", capacity: 2, bedType: "Çift" },
    });
    roomId = room.id;
    await prisma.availability.createMany({
      data: Array.from({ length: 90 }, (_, i) => ({
        roomId,
        date: utcDay(i + 1),
        price: new Prisma.Decimal(1000),
      })),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("checkout → authorize → capture → HELD→CONFIRMED; tutar = teklif; defter kaydı", async () => {
    const b = await hold();
    const out = await payForBooking({
      bookingId: b.id,
      userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "k1",
    });
    expect(out.status).toBe("confirmed");
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: b.id },
      include: { payment: true },
    });
    expect(row.status).toBe("CONFIRMED");
    expect(row.payment?.status).toBe("PAID");
    expect(Number(row.payment?.amount)).toBe(b.totalPrice); // Payment.amount = gösterilen toplam
    expect((row.policySnapshot as { kind: string }).kind).toBe("MODERATE");
    expect(await prisma.ledgerEntry.count({ where: { bookingId: b.id, kind: "CHARGE" } })).toBe(1);
    // Tekrar ödeme idempotent
    const again = await payForBooking({
      bookingId: b.id,
      userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "k1",
    });
    expect(again.status).toBe("confirmed");
  });

  it("ret: booking HELD kalır (402), süre dolunca EXPIRED olur", async () => {
    const b = await hold();
    await expect(
      payForBooking({
        bookingId: b.id,
        userId,
        cardToken: "tok_mock_decline_0002",
        idempotencyKey: "k2",
      })
    ).rejects.toMatchObject({ status: 402, code: "PAYMENT_DECLINED" });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("HELD");
    await expireHolds(new Date(Date.now() + 20 * 60_000));
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      "EXPIRED"
    );
    await expect(
      payForBooking({
        bookingId: b.id,
        userId,
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: "k3",
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("3DS: requires_action → doğru kod ile CONFIRMED", async () => {
    const b = await hold();
    const out = await payForBooking({
      bookingId: b.id,
      userId,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: "k4",
    });
    expect(out.status).toBe("requires_action");
    await expect(
      confirmPaymentChallenge({ bookingId: b.id, userId, code: "000000" })
    ).rejects.toMatchObject({ status: 402 });
    const b2 = await hold();
    await payForBooking({
      bookingId: b2.id,
      userId,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: "k5",
    });
    const ok = await confirmPaymentChallenge({ bookingId: b2.id, userId, code: MOCK_3DS_CODE });
    expect(ok.status).toBe("confirmed");
  });

  it("başkasının rezervasyonu için ödeme 404", async () => {
    const b = await hold();
    await expect(
      payForBooking({
        bookingId: b.id,
        userId: "baskasi",
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: "x",
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("webhook replay'i ikinci kez etki etmez", async () => {
    const b = await hold();
    await payForBooking({
      bookingId: b.id,
      userId,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: "k6",
    });
    const ref = (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } }))
      .providerRef!;
    const event = {
      id: `evt_${stamp}`,
      type: "payment.succeeded" as const,
      data: { providerRef: ref },
    };
    expect(await handleWebhookEvent(event)).toEqual({ duplicate: false });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      "CONFIRMED"
    );
    expect(await handleWebhookEvent(event)).toEqual({ duplicate: true });
    expect(await prisma.ledgerEntry.count({ where: { bookingId: b.id, kind: "CHARGE" } })).toBe(1);
  });

  it("DELETE: iptal iade tutarını politikaya göre döner; tek onay + tek iptal e-postası", async () => {
    const b = await hold();
    await payForBooking({
      bookingId: b.id,
      userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "k7",
    });
    // Check-in ≥ 5 gün uzakta → MODERATE %100
    const res = await cancelAndRefund(b.id, userId);
    expect(res.refund.refundPercent).toBe(100);
    expect(res.refund.refundMinor).toBe(b.totalMinor);
    const pay = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(pay.status).toBe("REFUNDED");

    // Outbox iki kez tüketilse bile tek e-posta
    await relayOutbox(500);
    await prisma.outboxMessage.updateMany({
      where: { aggregateId: b.id },
      data: { status: "PENDING", attempts: 0 },
    });
    await relayOutbox(500);
    const mails = await prisma.notification.findMany({ where: { dedupeKey: { endsWith: b.id } } });
    expect(mails.map((m) => m.dedupeKey).sort()).toEqual([
      `booking.cancelled:${b.id}`,
      `booking.confirmed:${b.id}`,
    ]);
    expect(mails.find((m) => m.dedupeKey.startsWith("booking.cancelled"))?.text).toContain(
      "İade tutarı"
    );
  });

  it("geç iptal: MODERATE, girişe 48 saat → %50 iade", async () => {
    const b = await hold();
    await payForBooking({
      bookingId: b.id,
      userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "k8",
    });
    const checkIn = new Date(`${b.checkIn}T12:00:00.000Z`);
    const res = await cancelAndRefund(b.id, userId, new Date(checkIn.getTime() - 48 * 3_600_000));
    expect(res.refund.refundPercent).toBe(50);
    expect((await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } })).status).toBe(
      "PARTIALLY_REFUNDED"
    );
  });
});
