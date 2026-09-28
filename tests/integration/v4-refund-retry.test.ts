import { listBookingLedger } from "@/lib/ledger";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  cancelAndRefund,
  payForBooking,
  retryFailedRefund,
  REFUND_RETRY_JOB,
} from "@/lib/payment/payment-service";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import { PaymentProviderError } from "@/lib/payment/provider";
import type { Money } from "@/lib/money/money";
import { getConfig } from "@/lib/config/app-config";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { signAccessToken } from "@/lib/auth/tokens";
import { GET as refundsGet, POST as refundsPost } from "@/app/api/admin/refunds/route";

/** Capture'ı yavaşlatılabilen / iadesi düşürülebilen mock PSP. */
class ControlledPsp extends MockPsp {
  captureDelayMs = 0;
  failRefunds = false;
  refundCalls: string[] = [];
  override async capture(): Promise<{ status: "captured" }> {
    if (this.captureDelayMs) await new Promise((r) => setTimeout(r, this.captureDelayMs));
    return { status: "captured" };
  }
  override async refund(providerRef: string, amount: Money, idempotencyKey: string) {
    this.refundCalls.push(idempotencyKey);
    if (this.failRefunds) throw new PaymentProviderError("psp_down", "PSP erişilemez");
    return super.refund(providerRef, amount, idempotencyKey);
  }
}

describeInt("regression: v4#7 iptal–capture yarışı ve iade yeniden denemesi", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let psp: ControlledPsp;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v4-7", policyId: "policy_flexible_v1" });
  });
  afterEach(() => setPaymentProviderForTests(null));
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function usePsp(): ControlledPsp {
    psp = new ControlledPsp();
    setPaymentProviderForTests(psp);
    return psp;
  }

  it("regression: v4#7 capture sürerken gelen iptal pay kilidini bekler ve tahsilatı iade eder", async () => {
    usePsp().captureDelayMs = 700;
    const b = await fx.hold({ startInDays: 60 });
    const paying = payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "v4-7-race",
    });
    // Ödeme kilidi alındıktan sonra iptal gelir (capture devam ediyor).
    await new Promise((r) => setTimeout(r, 250));
    const cancelled = await cancelAndRefund(b.id, fx.userId);
    expect((await paying).status).toBe("confirmed");

    // İptal onaylanmış (PAID) rezervasyonu gördü → politika iadesi; "HELD iptali, 0 iade" değil.
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.refund.refundMinor).toBeGreaterThan(0);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(["REFUNDED", "PARTIALLY_REFUNDED"]).toContain(payment.status);
    const kinds = (await listBookingLedger(prisma, b.id)).map((e) => e.kind);
    expect(kinds.sort()).toEqual(["CHARGE", "REFUND"]);
    expect(psp.refundCalls).toEqual([`refund:${b.id}`]);
  });

  it("regression: v4#7 PSP iadesi düşerse REFUND_FAILED + refund-retry işi; yeniden deneme temizler", async () => {
    const ctl = usePsp();
    const b = await fx.hold({ startInDays: 70 });
    await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "v4-7-fail",
    });
    ctl.failRefunds = true;
    await cancelAndRefund(b.id, fx.userId);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } })).failureCode
    ).toBe("REFUND_FAILED");

    const queue = getQueue(QUEUE_NAMES.refundRetry);
    const job = await queue.getJob(`refund-${b.id}`);
    expect(job?.name).toBe(REFUND_RETRY_JOB);
    expect(job?.data).toEqual({ bookingId: b.id });
    expect(job?.opts.attempts).toBe(getConfig().REFUND_RETRY_MAX_ATTEMPTS);
    expect(job?.opts.backoff).toMatchObject({ type: "exponential" });
    await job?.remove();

    // PSP hâlâ düşük: deneme hata fırlatır (BullMQ yeniden dener), satır REFUND_FAILED kalır.
    await expect(retryFailedRefund(b.id)).rejects.toThrow(PaymentProviderError);

    // Yönetici kuyruğu: listede görünür; ADMIN olmayan erişemez.
    const admin = await prisma.user.create({
      data: {
        email: `admin-v4-7-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "A",
        lastName: "D",
        role: "ADMIN",
      },
    });
    const adminToken = (await signAccessToken(admin.id, "ADMIN", 300)).token;
    const userToken = (await signAccessToken(fx.userId, "USER", 300)).token;
    const call = (token: string, method = "GET", body?: unknown) =>
      new NextRequest("http://localhost:3000/api/admin/refunds", {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    expect((await refundsGet(call(userToken))).status).toBe(403);
    const list = await (await refundsGet(call(adminToken))).json();
    expect(list.failed.map((p: { bookingId: string }) => p.bookingId)).toContain(b.id);
    expect((await refundsPost(call(adminToken, "POST", { bookingId: b.id }))).status).toBe(502);

    // PSP düzeldi: yönetici yeniden denemesi iade eder, aynı idempotency anahtarı kullanılır.
    ctl.failRefunds = false;
    const retried = await refundsPost(call(adminToken, "POST", { bookingId: b.id }));
    expect(retried.status).toBe(200);
    expect((await retried.json()).result).toBe("refunded");
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } })).failureCode
    ).toBeNull();
    expect(new Set(ctl.refundCalls)).toEqual(new Set([`refund:${b.id}`]));
    // Temizlenmiş satır için tekrar deneme 404 (yapılacak iş yok).
    expect((await refundsPost(call(adminToken, "POST", { bookingId: b.id }))).status).toBe(404);
    expect(await retryFailedRefund(b.id)).toBe("noop");
  });
});
