import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { confirmPaymentChallenge, payForBooking } from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { claimTransfer, listBookingForTransfer } from "@/lib/transfer/transfer-service";
import { resetConfigForTests } from "@/lib/config/app-config";
import { onboardHostAccount } from "@/lib/payout/host-account";
import { registry } from "@/lib/observability/metrics";
import { runPayouts } from "@/worker/jobs/payouts";

/**
 * v5#4: devir satıcısının payout'u ev sahibi yolundaki `payoutBlockReason` kapısından geçer —
 * HostAccount yoksa / KYC gerekip doğrulanmamışsa PENDING bekler (AML vektörü kapanır),
 * engel `payout_blocked_total{reason}` ile sayılır; kapı açılınca aynı payout gönderilir.
 */
describeInt("v5#4 devir payout'u KYC/hesap kapısı (regression: v5#4)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let buyer = "";
  let seq = 0;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v5-transfer-payout", days: 90 });
    buyer = (
      await prisma.user.create({
        data: {
          email: `v5tp-buyer-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: "Alıcı",
          lastName: "Test",
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
  });
  afterEach(() => {
    delete process.env.PAYOUT_REQUIRE_IDENTITY_VERIFIED;
    resetConfigForTests();
  });
  afterAll(() => prisma.$disconnect());

  async function blocked(reason: string): Promise<number> {
    const metric = registry.getSingleMetric("payout_blocked_total");
    if (!metric) return 0;
    const values = (await metric.get()).values;
    return values
      .filter((v) => v.labels.reason === reason && v.labels.kind === "transfer")
      .reduce((s, v) => s + v.value, 0);
  }

  /** Satıcı (fx.userId) için PENDING devir payout'u üretir. */
  async function pendingTransferPayout() {
    const bk = await fx.hold({ nights: 1 });
    let out = await payForBooking({
      bookingId: bk.id,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `v5tp-${++seq}-${Date.now()}`,
    });
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({
        bookingId: bk.id,
        userId: fx.userId,
        code: MOCK_3DS_CODE,
      });
    }
    expect(out.status).toBe("confirmed");
    const listed = await listBookingForTransfer(
      bk.id,
      fx.userId,
      Math.max(1, Math.floor(bk.totalMinor / 2))
    );
    const claimed = await claimTransfer({
      token: listed.claimToken,
      buyerId: buyer,
      cardToken: "tok_mock_ok_4242",
    });
    expect(claimed.status).toBe("COMPLETED");
    const payout = await prisma.payout.findUniqueOrThrow({ where: { transferId: listed.id } });
    expect(payout.status).toBe("PENDING");
    return payout;
  }

  const statusOf = async (id: string) =>
    (await prisma.payout.findUniqueOrThrow({ where: { id } })).status;

  it("HostAccount yok → payout PENDING bekler (mock'ta destination=null ile bile gönderilmez)", async () => {
    const payout = await pendingTransferPayout();
    const before = await blocked("NO_ACCOUNT");
    await runPayouts(new Date(), { userIds: [fx.userId] });
    expect(await statusOf(payout.id)).toBe("PENDING");
    expect(await blocked("NO_ACCOUNT")).toBeGreaterThan(before);
  });

  it("KYC zorunlu + doğrulanmamış satıcı → gönderilmez; KYC sonrası gider", async () => {
    process.env.PAYOUT_REQUIRE_IDENTITY_VERIFIED = "true";
    resetConfigForTests();
    await onboardHostAccount(fx.userId);
    const payout = await pendingTransferPayout();
    const before = await blocked("IDENTITY_UNVERIFIED");
    await runPayouts(new Date(), { userIds: [fx.userId] });
    expect(await statusOf(payout.id)).toBe("PENDING");
    expect(await blocked("IDENTITY_UNVERIFIED")).toBeGreaterThan(before);

    await prisma.identityVerification.create({
      data: {
        userId: fx.userId,
        provider: "mock",
        providerRef: `kyc_v5tp_${Date.now()}`,
        status: "VERIFIED",
        verifiedAt: new Date(),
      },
    });
    await runPayouts(new Date(), { userIds: [fx.userId] });
    expect(await statusOf(payout.id)).toBe("PAID");
  });
});
