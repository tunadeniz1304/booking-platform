import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { confirmPaymentChallenge, payForBooking } from "@/lib/payment/payment-service";
import { signAccessToken } from "@/lib/auth/tokens";
import { DEVICE_COOKIE, readDeviceId, signDeviceId } from "@/lib/risk/device-cookie";
import { POST as payPost } from "@/app/api/bookings/[id]/pay/route";

/**
 * v4#13: 3DS/ödeme deneme sınırı ve sunucu kaynaklı fraud sinyalleri.
 */
describeInt("regression: v4#13 ödeme deneme sınırı ve sunucu tarafı fraud sinyalleri", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v4-13", days: 60 });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("regression: v4#13 5 başarısız 3DS denemesinden sonra ödeme FAILED ve yeni deneme 429", async () => {
    const b = await fx.hold();
    for (let i = 1; i <= 5; i++) {
      const out = await payForBooking({
        bookingId: b.id,
        userId: fx.userId,
        cardToken: "tok_mock_3ds_3220",
        idempotencyKey: `v4-13-${i}`,
      });
      expect(out.status).toBe("requires_action");
      const attempt = confirmPaymentChallenge({
        bookingId: b.id,
        userId: fx.userId,
        code: "000000",
      });
      await expect(attempt).rejects.toMatchObject({
        status: i < 5 ? 402 : 429,
        ...(i === 5 ? { code: "PAYMENT_ATTEMPTS_EXCEEDED" } : {}),
      });
    }
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(payment.status).toBe("FAILED");
    expect(payment.failureCode).toBe("ATTEMPTS_EXCEEDED");
    // Yeni Idempotency-Key ile döngü (pay → confirm) artık açılamaz.
    await expect(
      payForBooking({
        bookingId: b.id,
        userId: fx.userId,
        cardToken: "tok_mock_3ds_3220",
        idempotencyKey: "v4-13-again",
      })
    ).rejects.toMatchObject({ status: 429, code: "PAYMENT_ATTEMPTS_EXCEEDED" });
    expect(
      await prisma.auditLog.count({
        where: { action: "payment.attempts_exceeded", entityId: b.id },
      })
    ).toBe(1);
  });

  it("regression: v4#13 BIN istemciden değil PSP token metadata'sından okunur", async () => {
    const b = await fx.hold();
    await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      // 424242 → US; IP ülkesi TR → BIN–IP uyumsuzluğu token'dan tespit edilir.
      cardToken: "tok_mock_ok_424242_4242",
      idempotencyKey: "v4-13-bin",
      context: { ip: "203.0.113.9", ipCountry: "TR" },
    }).catch(() => undefined);
    const check = await prisma.fraudCheck.findFirstOrThrow({
      where: { bookingId: b.id },
      orderBy: { createdAt: "desc" },
    });
    const rules = (check.reasons as Array<{ rule: string }>).map((r) => r.rule);
    expect(rules).toContain("bin_ip_country_mismatch");
  });

  it("regression: v4#13 cihaz kimliği sunucu imzalı çerezden; sahte çerez/gövde yok sayılır", async () => {
    const { token } = await signAccessToken(fx.userId, "USER", 300);
    const pay = async (bookingId: string, cookie?: string, key = "k") =>
      payPost(
        new NextRequest(`http://localhost:3000/api/bookings/${bookingId}/pay`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "idempotency-key": key,
            ...(cookie ? { cookie: `${DEVICE_COOKIE}=${cookie}` } : {}),
          },
          // İstemcinin gönderdiği deviceId / cardBin yok sayılır.
          body: JSON.stringify({
            cardToken: "tok_mock_decline_0002",
            deviceId: "attackerchosen01",
            cardBin: "454360",
          }),
        }),
        { params: Promise.resolve({ id: bookingId }) }
      );

    const didOf = (r: Response) => (r as NextResponse).cookies.get(DEVICE_COOKIE)?.value;
    const b = await fx.hold();
    const forged = await pay(b.id, `${"a".repeat(32)}.forged`, "d1");
    expect(forged.status).toBe(402);
    const issued = didOf(forged);
    expect(issued).toBeTruthy();
    const deviceId = readDeviceId(issued);
    expect(deviceId).toMatch(/^[a-f0-9]{32}$/);
    expect(deviceId).not.toBe("a".repeat(32));

    // Geçerli imzalı çerezle gelen istek yeni çerez almaz; aynı kimlik fraud'a gider.
    const again = await pay(b.id, signDeviceId(deviceId!), "d2");
    expect(again.status).toBe(402);
    expect(didOf(again)).toBeUndefined();
    expect(readDeviceId(`${deviceId}.x`)).toBeNull();
    expect(readDeviceId("attackerchosen01")).toBeNull();
  });
});
