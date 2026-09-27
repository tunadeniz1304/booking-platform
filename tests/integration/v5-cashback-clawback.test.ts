import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { confirmPaymentChallenge, payForBooking } from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { completeStays } from "@/lib/booking/complete-stays";
import type { BookingCompletedPayload } from "@/lib/events/events";
import type { AccessClaims } from "@/lib/auth";
import { account, getAccountBalance, isTrialBalanced, trialBalance } from "@/lib/ledger";
import { expireCredits, issueDueCashbacks, onStayCompleted } from "@/lib/wallet/wallet-service";
import { cashbackMinor } from "@/lib/wallet/rules";
import { decideClaim, openClaim } from "@/lib/resolution/claims";

/**
 * v5#20 (doğrulandı): cashback verildikten SONRA gelen iade (misafir iade talebi) krediyi
 * düşürmüyordu. Artık cashback yeni net tabana göre yeniden hesaplanır; fazlası önce
 * harcanmamış lot'tan geri alınır (`creditClawback`), yetmezse bakiye eksiye düşmez, kalan
 * `platform_loss`'a yazılır.
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const claimsOf = (userId: string, role: AccessClaims["role"]): AccessClaims => ({
  userId,
  role,
  jti: "j",
  exp: 0,
  tv: 0,
});

describeInt("v5#20 cashback geri alma (regression: v5#20)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let adminId = "";
  let seq = 0;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, {
      tag: "v5-cashback-clawback",
      days: 200,
      units: 3,
      policyId: "policy_flexible_v1",
    });
    adminId = (
      await prisma.user.create({
        data: {
          email: `v5cb-admin-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: "Yönetici",
          lastName: "Test",
          role: "ADMIN",
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
  });
  afterAll(() => prisma.$disconnect());

  const guestCredit = async (userId: string) =>
    (await getAccountBalance(prisma, account.guestCredit(userId), "TRY")).balanceMinor;
  const platformLoss = async () =>
    (await getAccountBalance(prisma, account.platformLoss(), "TRY")).balanceMinor;

  /** Ödenmiş + tamamlanmış + cashback'i verilmiş rezervasyon. */
  async function cashbackIssued() {
    const guest = await prisma.user.create({
      data: {
        email: `v5cb-guest-${Date.now()}-${++seq}@t.test`,
        passwordHash: "x",
        firstName: "Sadık",
        lastName: "Misafir",
        emailVerifiedAt: new Date(),
      },
    });
    const b = await fx.hold({ nights: 2, userId: guest.id });
    let out = await payForBooking({
      bookingId: b.id,
      userId: guest.id,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `v5cb-${seq}-${Date.now()}`,
    });
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({
        bookingId: b.id,
        userId: guest.id,
        code: MOCK_3DS_CODE,
      });
    }
    expect(out.status).toBe("confirmed");
    const checkout = new Date(`${b.checkOut}T00:00:00.000Z`);
    expect(
      await completeStays(new Date(checkout.getTime() + 2 * DAY), 10, { bookingIds: [b.id] })
    ).toBe(1);
    const msg = await prisma.outboxMessage.findFirstOrThrow({
      where: { aggregateId: b.id, eventType: "booking.completed" },
    });
    await onStayCompleted(msg.payload as unknown as BookingCompletedPayload);
    const cb = await prisma.loyaltyCashback.findUniqueOrThrow({ where: { bookingId: b.id } });
    await issueDueCashbacks(new Date(cb.dueAt.getTime() + 1000));
    const issued = await prisma.loyaltyCashback.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(issued.status).toBe("ISSUED");
    return { guestId: guest.id, booking: b, checkout, issued };
  }

  async function refundClaim(guestId: string, bookingId: string, at: Date, amountMinor: number) {
    const claim = await openClaim(
      claimsOf(guestId, "USER"),
      { bookingId, type: "GUEST_REFUND", amountMinor, description: "Klima hiç çalışmadı" },
      at
    );
    return decideClaim(
      claimsOf(adminId, "ADMIN"),
      claim.id,
      { decision: "APPROVE", note: "Haklı" },
      new Date(at.getTime() + HOUR)
    );
  }

  it("harcanmamış cashback: iade sonrası kredi yeni net tabana iner (lot + defter)", async () => {
    const { guestId, booking, checkout, issued } = await cashbackIssued();
    expect(await guestCredit(guestId)).toBe(issued.amountMinor!);
    const refund = Math.floor(booking.totalMinor / 2);
    const res = await refundClaim(
      guestId,
      booking.id,
      new Date(checkout.getTime() + 3 * DAY),
      refund
    );
    expect(res.settledMinor).toBe(BigInt(refund));

    const entitled = BigInt(cashbackMinor(booking.totalMinor - refund, issued.bps, "TRY"));
    expect(entitled).toBeLessThan(issued.amountMinor!);
    expect(await guestCredit(guestId)).toBe(entitled);
    const lot = await prisma.walletCredit.findUniqueOrThrow({ where: { id: issued.creditId! } });
    expect(lot.remainingMinor).toBe(entitled);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });

  it("harcanmış/düşmüş cashback: bakiye eksiye inmez, geri alınamayan kısım platform_loss", async () => {
    const { guestId, booking, checkout, issued } = await cashbackIssued();
    const lot = await prisma.walletCredit.findUniqueOrThrow({ where: { id: issued.creditId! } });
    await expireCredits(new Date(lot.expiresAt.getTime() + DAY));
    expect(await guestCredit(guestId)).toBe(0n);
    const lossBefore = await platformLoss();
    const refund = Math.floor(booking.totalMinor / 2);
    await refundClaim(guestId, booking.id, new Date(checkout.getTime() + 3 * DAY), refund);

    const entitled = BigInt(cashbackMinor(booking.totalMinor - refund, issued.bps, "TRY"));
    expect(await guestCredit(guestId)).toBe(0n);
    expect(await platformLoss()).toBe(lossBefore + (issued.amountMinor! - entitled));
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });
});
