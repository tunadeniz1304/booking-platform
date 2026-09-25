// P1-8 / hata #3: imzalı claim linki, escrow ödemesi, tek kullanımlık token, yarış güvenliği.
import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { PrismaClient, Prisma, BookingStatus } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import {
  claimTransfer,
  discoverTransfers,
  listBookingForTransfer,
  listMyTransfers,
} from "@/lib/transfer/transfer-service";
import { cancelAndRefund } from "@/lib/payment/payment-service";
import { MockPsp } from "@/lib/payment/mock-psp";
import { setPaymentProviderForTests } from "@/lib/payment";
import { runPayouts } from "@/worker/jobs/payouts";
import type { Money } from "@/lib/money/money";

/** İadelerin hangi ödemeye gittiğini kaydeden MockPsp. */
class RefundSpyPsp extends MockPsp {
  refunds: Array<{ ref: string; amount: number }> = [];
  override async refund(ref: string, amount: Money, key: string) {
    this.refunds.push({ ref, amount: amount.amount });
    return super.refund(ref, amount, key);
  }
}

describeInt("regression: #3 P2P devir (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let seller = "";
  let buyer = "";
  let buyer2 = "";
  let propertyId = "";
  let roomId = "";

  async function confirmedBooking(daysAhead = 25) {
    const b = await prisma.booking.create({
      data: {
        userId: seller,
        propertyId,
        roomId,
        checkIn: utcDay(daysAhead),
        checkOut: utcDay(daysAhead + 2),
        guestCount: 1,
        totalPrice: new Prisma.Decimal(2000),
        status: BookingStatus.CONFIRMED,
      },
    });
    await prisma.payment.create({
      data: {
        bookingId: b.id,
        userId: seller,
        amount: new Prisma.Decimal(2000),
        provider: "mock",
        providerRef: `pi_seller_${b.id}`,
        status: "PAID",
      },
    });
    return b.id;
  }

  beforeAll(async () => {
    const mk = (n: string) =>
      prisma.user.create({
        data: {
          email: `tr-${n}-${stamp}@t.test`,
          passwordHash: "x",
          firstName: n,
          lastName: "Test",
        },
      });
    seller = (await mk("satici")).id;
    buyer = (await mk("alici")).id;
    buyer2 = (await mk("alici2")).id;
    const location = await prisma.location.create({
      data: { city: `TransCity-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        licenseStatus: "VERIFIED",
        hostId: seller,
        title: "Devir Oteli",
        description: "t",
        propertyType: "HOTEL",
        locationId: location.id,
        basePrice: new Prisma.Decimal(1000),
      },
    });
    propertyId = property.id;
    roomId = (
      await prisma.roomType.create({
        data: { propertyId, name: "Oda", maxOccupancy: 2, bedType: "Çift" },
      })
    ).id;
  });

  afterEach(() => setPaymentProviderForTests(null));
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("token yalnızca özetiyle saklanır; listeler token sızdırmaz", async () => {
    const bookingId = await confirmedBooking();
    const listed = await listBookingForTransfer(bookingId, seller, 200_000);
    const row = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });
    expect(JSON.stringify(row)).not.toContain(listed.claimToken);
    expect(JSON.stringify(await listMyTransfers(seller))).not.toContain("tokenHash");
    const discovered = await discoverTransfers();
    const mine = discovered.find((d) => d.id === listed.id);
    expect(mine?.seller).toBe("s*** T.");
  });

  it("token'sız / sahte token ile claim 403", async () => {
    await expect(
      claimTransfer({ token: "sahte.token", buyerId: buyer, cardToken: "tok_mock_ok_4242" })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("claim: ödeme alınır, sahiplik alıcıya geçer, satıcıya payout açılır; aynı token ikinci kez 409", async () => {
    const bookingId = await confirmedBooking();
    const listed = await listBookingForTransfer(bookingId, seller, 200_000);
    const res = await claimTransfer({
      token: listed.claimToken,
      buyerId: buyer,
      cardToken: "tok_mock_ok_4242",
    });
    expect(res.status).toBe("COMPLETED");
    const b = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { payment: true },
    });
    expect(b.userId).toBe(buyer);
    // Asıl ödeme satıcının kartıdır; alıcıya taşınmaz (#4).
    expect(b.payment?.userId).toBe(seller);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { transferId: listed.id } });
    expect(payout).toMatchObject({ userId: seller, status: "PENDING", currency: "TRY" });
    expect(Number(payout.amount)).toBe(2000);
    const ledger = await prisma.ledgerEntry.findMany({
      where: { bookingId },
      orderBy: { kind: "asc" },
    });
    expect(ledger.map((l) => l.kind).sort()).toEqual(["TRANSFER_PAYMENT", "TRANSFER_PAYOUT"]);
    await expect(
      claimTransfer({ token: listed.claimToken, buyerId: buyer2, cardToken: "tok_mock_ok_4242" })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("eşzamanlı 2 claim → tam 1 başarı", async () => {
    const bookingId = await confirmedBooking(40);
    // İptal satılmış envanteri iade eder → gecelerin sayaç satırları gerekir.
    await prisma.inventoryDay.createMany({
      data: [40, 41].map((d) => ({
        roomTypeId: roomId,
        date: utcDay(d),
        total: 1,
        sold: 1,
        price: new Prisma.Decimal(1000),
      })),
    });
    const listed = await listBookingForTransfer(bookingId, seller, 150_000);
    const results = await Promise.allSettled([
      claimTransfer({ token: listed.claimToken, buyerId: buyer, cardToken: "tok_mock_ok_4242" }),
      claimTransfer({ token: listed.claimToken, buyerId: buyer2, cardToken: "tok_mock_ok_4242" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("ödeme reddi → sahiplik değişmez", async () => {
    const bookingId = await confirmedBooking(50);
    const listed = await listBookingForTransfer(bookingId, seller, 100_000);
    await expect(
      claimTransfer({
        token: listed.claimToken,
        buyerId: buyer,
        cardToken: "tok_mock_decline_0002",
      })
    ).rejects.toMatchObject({ status: 402 });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId).toBe(
      seller
    );
    expect(
      (await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } })).status
    ).toBe("LISTED");
  });

  it("kurallar: satıcı olmayan 404, fiyat sınırı (oran 1.0), girişe yakın rezervasyon reddedilir", async () => {
    const bookingId = await confirmedBooking(60);
    await expect(listBookingForTransfer(bookingId, buyer, 100_000)).rejects.toMatchObject({
      status: 404,
    });
    await expect(listBookingForTransfer(bookingId, seller, 200_001)).rejects.toMatchObject({
      code: "ASK_TOO_HIGH",
    });
    const soon = await confirmedBooking(1);
    await expect(listBookingForTransfer(soon, seller, 100_000)).rejects.toMatchObject({
      code: "TOO_LATE",
    });
  });

  it("regression: v3#4 devir sonrası iptal iadesi alıcının ödemesine gider; payout işi satıcıyı öder", async () => {
    const psp = new RefundSpyPsp();
    setPaymentProviderForTests(psp);
    const bookingId = await confirmedBooking(40);
    const listed = await listBookingForTransfer(bookingId, seller, 150_000);
    await claimTransfer({
      token: listed.claimToken,
      buyerId: buyer,
      cardToken: "tok_mock_ok_4242",
    });
    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });

    const out = await cancelAndRefund(bookingId, buyer);
    expect(out.refund.refundMinor).toBeGreaterThan(0);
    // İade tavanı alıcının ödediği tutar (asıl tahsilat 200.000 olsa da).
    expect(out.refund.refundMinor).toBeLessThanOrEqual(150_000);
    expect(psp.refunds).toEqual([
      { ref: transfer.buyerPaymentRef, amount: out.refund.refundMinor },
    ]);
    expect(psp.refunds[0].ref).not.toBe(`pi_seller_${bookingId}`);

    const refund = await prisma.ledgerEntry.findFirstOrThrow({
      where: { bookingId, kind: "REFUND" },
    });
    expect(refund.userId).toBe(buyer);
    expect(refund.reference).toBe(transfer.buyerPaymentRef);

    await runPayouts();
    const payout = await prisma.payout.findUniqueOrThrow({ where: { transferId: listed.id } });
    expect(payout.status).toBe("PAID");
    expect(payout.reference).toMatch(/^po_mock_[0-9a-f]{24}$/);
    expect(payout.paidAt).not.toBeNull();
    // İkinci çalıştırma aynı payout'a dokunmaz.
    const again = await prisma.payout.findUniqueOrThrow({ where: { transferId: listed.id } });
    await runPayouts();
    expect(
      (await prisma.payout.findUniqueOrThrow({ where: { transferId: listed.id } })).attempts
    ).toBe(again.attempts);
  });
});
