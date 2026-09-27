import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { confirmPaymentChallenge, payForBooking } from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { claimTransfer, listBookingForTransfer } from "@/lib/transfer/transfer-service";
import { resetConfigForTests } from "@/lib/config/app-config";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import { registry } from "@/lib/observability/metrics";

/**
 * v5#5: devir talebi kart test kahini olamaz — ödeme yollarıyla aynı fraud skoru (deny → PSP'ye
 * gitmeden 403), (devir, alıcı) başına `PAYMENT_MAX_ATTEMPTS` ve alıcı başına günlük
 * `TRANSFER_CLAIM_MAX_ATTEMPTS_PER_DAY` başarısız deneme sınırı (aşımda 429 ATTEMPTS_EXHAUSTED,
 * PSP çağrısı yok), reddedilen denemeler `payment_attempts_total{flow="transfer",outcome}`.
 */
class SpyPsp extends MockPsp {
  authorizations = 0;
  override async authorize(input: Parameters<MockPsp["authorize"]>[0]) {
    // Yalnız devir talebi provizyonları (satıcının rezervasyon ödemesi sayılmaz).
    if (input.idempotencyKey.startsWith("transfer:")) this.authorizations += 1;
    return super.authorize(input);
  }
}

describeInt("v5#5 devir talebi risk ve deneme sınırı (regression: v5#5)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let seq = 0;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v5-claim-risk", days: 120 });
  });
  afterEach(() => {
    setPaymentProviderForTests(null);
    for (const k of [
      "PAYMENT_MAX_ATTEMPTS",
      "TRANSFER_CLAIM_MAX_ATTEMPTS_PER_DAY",
      "FRAUD_BLOCK_THRESHOLD",
    ]) {
      delete process.env[k];
    }
    resetConfigForTests();
  });
  afterAll(() => prisma.$disconnect());

  async function newBuyer(): Promise<string> {
    return (
      await prisma.user.create({
        data: {
          email: `v5cr-${Date.now()}-${++seq}@t.test`,
          passwordHash: "x",
          firstName: "Alıcı",
          lastName: "Test",
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
  }

  async function listing() {
    const bk = await fx.hold({ nights: 1 });
    let out = await payForBooking({
      bookingId: bk.id,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `v5cr-pay-${++seq}-${Date.now()}`,
    });
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({
        bookingId: bk.id,
        userId: fx.userId,
        code: MOCK_3DS_CODE,
      });
    }
    expect(out.status).toBe("confirmed");
    return listBookingForTransfer(bk.id, fx.userId, Math.max(1, Math.floor(bk.totalMinor / 2)));
  }

  async function attempts(outcome: string): Promise<number> {
    const metric = registry.getSingleMetric("payment_attempts_total");
    if (!metric) return 0;
    return (await metric.get()).values
      .filter((v) => v.labels.flow === "transfer" && v.labels.outcome === outcome)
      .reduce((s, v) => s + v.value, 0);
  }

  const claim = (token: string, buyerId: string, cardToken: string) =>
    claimTransfer({ token, buyerId, cardToken });

  it("(devir, alıcı) başına N başarısız denemeden sonra N+1'inci 429 ATTEMPTS_EXHAUSTED, PSP'ye gitmez", async () => {
    process.env.PAYMENT_MAX_ATTEMPTS = "3";
    resetConfigForTests();
    const psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const listed = await listing();
    const buyer = await newBuyer();
    for (let i = 1; i <= 3; i++) {
      await expect(
        claim(listed.claimToken, buyer, `tok_mock_decline_000${i}`)
      ).rejects.toMatchObject({ code: "PAYMENT_DECLINED" });
    }
    expect(psp.authorizations).toBe(3);
    const before = await attempts("attempts_exhausted");
    await expect(claim(listed.claimToken, buyer, "tok_mock_ok_4242")).rejects.toMatchObject({
      status: 429,
      code: "ATTEMPTS_EXHAUSTED",
    });
    expect(psp.authorizations).toBe(3);
    expect(await attempts("attempts_exhausted")).toBeGreaterThan(before);
    expect(await attempts("declined")).toBeGreaterThanOrEqual(3);
  });

  it("alıcı başına günlük sınır farklı devirlerde de uygulanır", async () => {
    process.env.TRANSFER_CLAIM_MAX_ATTEMPTS_PER_DAY = "2";
    resetConfigForTests();
    const psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const buyer = await newBuyer();
    for (let i = 1; i <= 2; i++) {
      const l = await listing();
      await expect(claim(l.claimToken, buyer, `tok_mock_decline_000${i}`)).rejects.toMatchObject({
        code: "PAYMENT_DECLINED",
      });
    }
    const third = await listing();
    await expect(claim(third.claimToken, buyer, "tok_mock_ok_4242")).rejects.toMatchObject({
      status: 429,
      code: "ATTEMPTS_EXHAUSTED",
    });
    expect(psp.authorizations).toBe(2);
  });

  it("fraud kararı deny → 403 FRAUD_BLOCKED, PSP'ye gitmez, FraudCheck kaydı yazılır", async () => {
    const listed = await listing(); // satıcının ödemesi eşik değişmeden önce
    process.env.FRAUD_BLOCK_THRESHOLD = "0";
    resetConfigForTests();
    const psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const buyer = await newBuyer();
    const before = await attempts("fraud_denied");
    await expect(claim(listed.claimToken, buyer, "tok_mock_ok_4242")).rejects.toMatchObject({
      status: 403,
      code: "FRAUD_BLOCKED",
    });
    expect(psp.authorizations).toBe(0);
    expect(await attempts("fraud_denied")).toBeGreaterThan(before);
    const transfer = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });
    expect(transfer.status).toBe("LISTED");
    expect(
      await prisma.fraudCheck.count({ where: { bookingId: transfer.bookingId, userId: buyer } })
    ).toBe(1);
  });
});
