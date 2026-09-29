import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createBooking } from "@/lib/booking-service";
import { listBookingLedger } from "@/lib/ledger";
import { setPaymentProviderForTests } from "@/lib/payment";
import type { PaymentProvider } from "@/lib/payment/provider";
import { loadPayable } from "@/lib/payment/payment-core";
import {
  applyConfirmation,
  captureAndConfirm,
  confirmableBookingSelect,
  confirmInTransaction,
  nextConfirmedState,
  retryPaymentCompensation,
  type ConfirmableBooking,
} from "@/lib/payment/confirm";

/**
 * src/lib/payment/confirm.ts: hata / yarış / idempotent tekrar yolları (saga telafileri,
 * onay yarışı, telafi yeniden denemesi). PSP ağsız sahte sağlayıcıyla değiştirilir.
 */
describeInt("ödeme onayı: hata, yarış ve idempotent yollar (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let userId = "";
  let propertyId = "";
  let roomId = "";
  let day = 3;

  const calls: string[] = [];
  const behavior: {
    captureFails?: boolean;
    voidFails?: boolean;
    onCapture?: () => Promise<void>;
  } = {};

  const fake: PaymentProvider = {
    name: "mock",
    async authorize() {
      throw new Error("authorize not used");
    },
    async confirmChallenge() {
      throw new Error("confirmChallenge not used");
    },
    async capture(ref) {
      calls.push(`capture:${ref}`);
      if (behavior.captureFails) throw new Error("psp capture down");
      if (behavior.onCapture) await behavior.onCapture();
      return { status: "captured" };
    },
    async refund(ref, _amount, key) {
      calls.push(`refund:${ref}:${key}`);
      return { status: "refunded", refundRef: `re_${ref}` };
    },
    async void(ref) {
      calls.push(`void:${ref}`);
      if (behavior.voidFails) throw new Error("psp void down");
      return { status: "voided" };
    },
  };

  async function hold() {
    const start = day;
    day += 2;
    const { booking } = await createBooking({
      userId,
      propertyId,
      roomId,
      checkIn: iso(utcDay(start)),
      checkOut: iso(utcDay(start + 1)),
      guestCount: 1,
    });
    return loadPayable(booking.id, userId);
  }

  async function row(bookingId: string) {
    return prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { payment: true },
    });
  }

  beforeAll(async () => {
    setPaymentProviderForTests(fake);
    const user = await prisma.user.create({
      data: { email: `pconf-${stamp}@t.test`, passwordHash: "x", firstName: "Can", lastName: "K" },
    });
    userId = user.id;
    const location = await prisma.location.create({
      data: { city: `PConfCity-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        licenseStatus: "VERIFIED",
        hostId: user.id,
        title: "Onay Oteli",
        description: "confirm test",
        propertyType: "HOTEL",
        locationId: location.id,
        basePriceMinor: 100000n,
        cancellationPolicyId: "policy_moderate_v1",
      },
    });
    propertyId = property.id;
    const room = await prisma.roomType.create({
      data: {
        propertyId,
        name: "Oda",
        maxOccupancy: 2,
        bedType: "Çift",
        ratePlans: { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] },
      },
    });
    roomId = room.id;
    await prisma.inventoryDay.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        roomTypeId: roomId,
        total: 1,
        date: utcDay(i + 1),
        priceMinor: 100000n,
      })),
    });
  });

  afterEach(() => {
    calls.length = 0;
    behavior.captureFails = false;
    behavior.voidFails = false;
    behavior.onCapture = undefined;
  });

  afterAll(async () => {
    setPaymentProviderForTests(null);
    await prisma.$disconnect();
  });

  it("mutlu yol: onaylar; aynı providerRef ile tekrar onay idempotent, farklı ref yarış kaybı", async () => {
    const b = await hold();
    const out = await captureAndConfirm(b, `pi_ok_${stamp}`);
    expect(out.status).toBe("confirmed");
    const r = await row(b.id);
    expect(r.status).toBe("CONFIRMED");
    expect(r.payment?.status).toBe("PAID");

    const again = await prisma.$transaction((tx) =>
      confirmInTransaction(tx, b.id, `pi_ok_${stamp}`)
    );
    expect(again).toBe(r.payment?.id);
    await expect(
      prisma.$transaction((tx) => confirmInTransaction(tx, b.id, `pi_other_${stamp}`))
    ).rejects.toMatchObject({ name: "CaptureRaceLostError" });
  });

  it("olmayan rezervasyon → BookingNotFoundError", async () => {
    await expect(
      prisma.$transaction((tx) => confirmInTransaction(tx, `missing-${stamp}`, "pi_x"))
    ).rejects.toMatchObject({ name: "BookingNotFoundError" });
  });

  it("capture düşerse: void + ödeme VOIDED(saga_aborted) + tutma bırakılır", async () => {
    const b = await hold();
    const ref = `pi_capfail_${stamp}`;
    behavior.captureFails = true;
    await expect(captureAndConfirm(b, ref)).rejects.toThrow("psp capture down");
    expect(calls).toContain(`void:${ref}`);
    expect(calls.some((c) => c.startsWith("refund:"))).toBe(false);
    const r = await row(b.id);
    expect(r.payment?.status).toBe("VOIDED");
    expect(r.payment?.failureCode).toBe("saga_aborted");
    expect(r.status).not.toBe("HELD");
  });

  it("capture + void düşerse: telafi yeniden deneme işi kuyruğa konur, hata yine fırlar", async () => {
    const b = await hold();
    const ref = `pi_voidfail_${stamp}`;
    behavior.captureFails = true;
    behavior.voidFails = true;
    await expect(captureAndConfirm(b, ref)).rejects.toThrow("psp capture down");
    expect(calls).toContain(`void:${ref}`);
  });

  it("tahsil sonrası onay düşerse (tutma süresi doldu): iade + REFUNDED + telafi jurnali", async () => {
    const b = await hold();
    const ref = `pi_expired_${stamp}`;
    await prisma.booking.update({
      where: { id: b.id },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(captureAndConfirm(b, ref)).rejects.toMatchObject({ code: "HOLD_EXPIRED" });
    expect(calls).toContain(`capture:${ref}`);
    expect(calls).toContain(`refund:${ref}:compensate:${ref}`);
    // Tahsil edildi → void telafisi atlanır.
    expect(calls).not.toContain(`void:${ref}`);
    const r = await row(b.id);
    expect(r.payment?.status).toBe("REFUNDED");
    expect(r.payment?.failureCode).toBe("BOOKING_NOT_CONFIRMABLE");
    expect(r.payment?.refundedAmountMinor).toBe(r.payment?.amountMinor);
    const ledger = await listBookingLedger(prisma, b.id);
    expect(ledger.filter((l) => l.kind === "CHARGE")).toHaveLength(1);
    expect(ledger.filter((l) => l.kind === "REFUND")).toHaveLength(1);
  });

  it("tahsil hakkı alınamazsa (başka yetkilendirme satırı): loser void + PAYMENT_IN_PROGRESS", async () => {
    const b = await hold();
    await prisma.payment.create({
      data: {
        bookingId: b.id,
        userId,
        amountMinor: b.totalPriceMinor,
        currency: b.currency,
        provider: "mock",
        status: "AUTHORIZED",
        providerRef: `pi_winner_${stamp}`,
      },
    });
    const ref = `pi_loser_${stamp}`;
    await expect(captureAndConfirm(b, ref)).rejects.toMatchObject({
      name: "PaymentInProgressError",
    });
    // voidLoser + authorize telafisi: PSP void anahtarsız ama idempotent; tahsil yok.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c === `void:${ref}`)).toBe(true);
    const r = await row(b.id);
    expect(r.payment?.status).toBe("AUTHORIZED");
    expect(r.payment?.providerRef).toBe(`pi_winner_${stamp}`);
  });

  it("regression: v5-F9 lost claim — winner's hold stays HELD, loser voided exactly once", async () => {
    const b = await hold();
    const winner = `pi_f9_winner_${stamp}`;
    await prisma.payment.create({
      data: {
        bookingId: b.id,
        userId,
        amountMinor: b.totalPriceMinor,
        currency: b.currency,
        provider: "mock",
        status: "AUTHORIZED",
        providerRef: winner,
      },
    });
    const ref = `pi_f9_loser_${stamp}`;
    await expect(captureAndConfirm(b, ref)).rejects.toMatchObject({
      name: "PaymentInProgressError",
    });
    const r = await row(b.id);
    expect(r.status).toBe("HELD");
    expect(calls).toEqual([`void:${ref}`]);
    expect(r.payment?.status).toBe("AUTHORIZED");
    expect(r.payment?.providerRef).toBe(winner);
  });

  it("tahsil sırasında başka ödeme onaylarsa: bizimki iade edilir, idempotent onay döner", async () => {
    const b = await hold();
    const ref = `pi_racer_${stamp}`;
    behavior.onCapture = async () => {
      await prisma.payment.update({
        where: { bookingId: b.id },
        data: { status: "PAID", providerRef: `pi_first_${stamp}`, paidAt: new Date() },
      });
      await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
    };
    const out = await captureAndConfirm(b, ref);
    expect(out).toMatchObject({ status: "confirmed", bookingId: b.id });
    expect(calls).toContain(`refund:${ref}:compensate:${ref}`);
    const r = await row(b.id);
    expect(r.payment?.providerRef).toBe(`pi_first_${stamp}`);
    expect(r.payment?.status).toBe("PAID");
  });

  it("nextConfirmedState: HELD dışı durum → BOOKING_NOT_CONFIRMABLE", () => {
    const fakeBooking = { status: "CANCELLED", holdExpiresAt: null } as ConfirmableBooking;
    expect(() => nextConfirmedState(fakeBooking)).toThrow(
      expect.objectContaining({ code: "BOOKING_NOT_CONFIRMABLE" })
    );
  });

  it("applyConfirmation: bayat sürüm → CONCURRENT_UPDATE (işlem geri alınır)", async () => {
    const b = await hold();
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: b.id },
      select: confirmableBookingSelect,
    });
    await expect(
      prisma.$transaction((tx) =>
        applyConfirmation(
          tx,
          { ...booking, version: booking.version + 5 },
          "CONFIRMED",
          { id: "pay_x", amountMinor: booking.totalPriceMinor },
          { journal: false }
        )
      )
    ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
    expect((await row(b.id)).status).toBe("HELD");
  });

  it("retryPaymentCompensation: tahsil hakkı yok → yalnız PSP void; tahsil edilmişse noop", async () => {
    const b = await hold();
    const ref = `pi_retry_unclaimed_${stamp}`;
    const base = { bookingId: b.id, userId, providerRef: ref };
    await expect(
      retryPaymentCompensation({ ...base, claimed: false, captured: false })
    ).resolves.toBe("compensated");
    expect(calls).toEqual([`void:${ref}`]);
    calls.length = 0;
    await expect(
      retryPaymentCompensation({ ...base, claimed: false, captured: true })
    ).resolves.toBe("noop");
    expect(calls).toEqual([]);
  });

  it("retryPaymentCompensation: onay kazanmış (PAID) ödeme için noop", async () => {
    const b = await hold();
    const ref = `pi_retry_paid_${stamp}`;
    await captureAndConfirm(b, ref);
    calls.length = 0;
    await expect(
      retryPaymentCompensation({
        bookingId: b.id,
        userId,
        providerRef: ref,
        claimed: true,
        captured: true,
      })
    ).resolves.toBe("noop");
    expect(calls).toEqual([]);
  });

  it("retryPaymentCompensation: REFUNDED satırda iade telafisi idempotent yeniden koşar", async () => {
    const b = await hold();
    const ref = `pi_retry_refunded_${stamp}`;
    await prisma.booking.update({
      where: { id: b.id },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(captureAndConfirm(b, ref)).rejects.toMatchObject({ code: "HOLD_EXPIRED" });
    const before = await row(b.id);
    calls.length = 0;
    await expect(
      retryPaymentCompensation({
        bookingId: b.id,
        userId,
        providerRef: ref,
        claimed: true,
        captured: true,
      })
    ).resolves.toBe("compensated");
    expect(calls).toEqual([`refund:${ref}:compensate:${ref}`]);
    const after = await row(b.id);
    expect(after.payment?.status).toBe("REFUNDED");
    // Satır zaten SETTLED → ikinci iade kümülatif alanı artırmaz.
    expect(after.payment?.refundedAmountMinor).toBe(before.payment?.refundedAmountMinor);
  });

  it("retryPaymentCompensation: tahsil edilmemiş AUTHORIZED satır → void + VOIDED", async () => {
    const b = await hold();
    const ref = `pi_retry_auth_${stamp}`;
    await prisma.payment.create({
      data: {
        bookingId: b.id,
        userId,
        amountMinor: b.totalPriceMinor,
        currency: b.currency,
        provider: "mock",
        status: "AUTHORIZED",
        providerRef: ref,
      },
    });
    await expect(
      retryPaymentCompensation({
        bookingId: b.id,
        userId,
        providerRef: ref,
        claimed: true,
        captured: false,
      })
    ).resolves.toBe("compensated");
    expect(calls).toEqual([`void:${ref}`]);
    const r = await row(b.id);
    expect(r.payment?.status).toBe("VOIDED");
    expect(r.payment?.failureCode).toBe("saga_aborted");
  });
});
