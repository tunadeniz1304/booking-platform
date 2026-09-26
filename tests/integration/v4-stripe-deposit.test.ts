// fix-sweep-2: Stripe'ta hasar depozitosu — depozito gereken rezervasyonun ödemesi PSP
// müşterisine bağlanır + `setup_future_usage=off_session`; depozito ön provizyonu aynı müşteri +
// kayıtlı ödeme yöntemiyle off-session alınır. Depozitosuz rezervasyonda müşteri/kayıt yok.
// Stripe ağsız taklitle (tests/support/stripe-fake.ts); MockPsp akışı değişmez.
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { payForBooking } from "@/lib/payment/payment-service";
import { setPaymentProviderForTests } from "@/lib/payment";
import { StripeProvider } from "@/lib/payment/stripe-provider";
import { authorizeDeposit } from "@/lib/resolution/deposit";
import { intent, stripeFake, type StripeCall } from "../support/stripe-fake";

/** Durumlu Stripe taklidi: oluşturulan PaymentIntent'lerin müşterisi/kartı saklanır. */
function statefulStripe() {
  const intents = new Map<string, { customer: string | null; payment_method: string | null }>();
  let seq = 0;
  const fake = stripeFake((call: StripeCall) => {
    if (call.method === "POST" && call.path === "/v1/customers") {
      return { body: { id: `cus_fake_${call.idempotencyKey}`, object: "customer" } };
    }
    if (call.method === "POST" && call.path === "/v1/payment_intents") {
      const id = `pi_fake_${++seq}_${Date.now()}`;
      const hold = call.body.get("off_session") === "true";
      intents.set(id, {
        customer: call.body.get("customer"),
        payment_method: call.body.get("payment_method"),
      });
      return intent(id, "requires_capture", { off_session: hold });
    }
    const capture = /^\/v1\/payment_intents\/([^/]+)\/capture$/.exec(call.path);
    if (call.method === "POST" && capture) return intent(capture[1], "succeeded");
    const get = /^\/v1\/payment_intents\/([^/]+)$/.exec(call.path);
    if (call.method === "GET" && get) {
      const pi = intents.get(get[1]);
      return pi ? intent(get[1], "succeeded", pi) : undefined;
    }
    return undefined;
  });
  return { ...fake, intents };
}

describeInt("fix-sweep-2: Stripe depozito — müşteri + kayıtlı kart", () => {
  const prisma = new PrismaClient();
  let withDeposit: StayFixture;
  let withoutDeposit: StayFixture;
  let key = 0;

  beforeAll(async () => {
    withDeposit = await createStayFixture(prisma, { tag: "fs2-stripe-dep" });
    withoutDeposit = await createStayFixture(prisma, { tag: "fs2-stripe-nodep" });
    await prisma.damageDepositSetting.create({
      data: { propertyId: withDeposit.propertyId, roomTypeId: null, amountMinor: 30_000n },
    });
  });
  afterEach(() => setPaymentProviderForTests(null));
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const pay = (bookingId: string, userId: string) =>
    payForBooking({
      bookingId,
      userId,
      cardToken: "pm_card_visa",
      idempotencyKey: `fs2-stripe-${++key}`,
    });

  it("depozito gereken ödeme müşteriye bağlanır + off_session kayıt; depozito kayıtlı kartla off-session", async () => {
    const stripe = statefulStripe();
    setPaymentProviderForTests(new StripeProvider("sk_test_x", stripe.fetchImpl));

    const b1 = await withDeposit.hold({ nights: 1 });
    expect((await pay(b1.id, withDeposit.userId)).status).toBe("confirmed");
    const customerCalls = stripe.calls.filter((c) => c.path === "/v1/customers");
    expect(customerCalls).toHaveLength(1);
    expect(customerCalls[0].body.get("metadata[userId]")).toBe(withDeposit.userId);
    expect(customerCalls[0].idempotencyKey).toBe(`customer:stripe:${withDeposit.userId}`);
    const saved = await prisma.paymentCustomer.findUniqueOrThrow({
      where: { userId_provider: { userId: withDeposit.userId, provider: "stripe" } },
    });
    const auth = stripe.calls.find((c) => c.method === "POST" && c.path === "/v1/payment_intents")!;
    expect(auth.body.get("customer")).toBe(saved.customerRef);
    expect(auth.body.get("setup_future_usage")).toBe("off_session");
    expect(auth.body.get("payment_method")).toBe("pm_card_visa");

    // Aynı kullanıcının ikinci ödemesi mevcut müşteriyi kullanır (yeni Customer yok).
    const b2 = await withDeposit.hold({ nights: 1 });
    expect((await pay(b2.id, withDeposit.userId)).status).toBe("confirmed");
    expect(stripe.calls.filter((c) => c.path === "/v1/customers")).toHaveLength(1);

    // Depozito ön provizyonu: kaynak PI'nin müşterisi + kayıtlı kartı, off-session.
    const deposit = await prisma.damageDeposit.create({
      data: {
        bookingId: b1.id,
        amountMinor: 30_000n,
        currency: "TRY",
        provider: "stripe",
        authorizeAfter: new Date(Date.now() - 1000),
        voidAfter: new Date(Date.now() + 10 * 86_400_000),
      },
    });
    expect(await authorizeDeposit(deposit.id)).toBe("authorized");
    const hold = stripe.calls.filter(
      (c) => c.method === "POST" && c.path === "/v1/payment_intents"
    );
    const holdCall = hold[hold.length - 1];
    expect(holdCall.body.get("off_session")).toBe("true");
    expect(holdCall.body.get("confirm")).toBe("true");
    expect(holdCall.body.get("capture_method")).toBe("manual");
    expect(holdCall.body.get("customer")).toBe(saved.customerRef);
    expect(holdCall.body.get("payment_method")).toBe("pm_card_visa");
    expect(holdCall.idempotencyKey).toBe(`deposit:${deposit.id}`);
    const row = await prisma.damageDeposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(row.status).toBe("AUTHORIZED");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b1.id } });
    expect(row.sourcePaymentRef).toBe(payment.providerRef);
  });

  it("depozitosuz rezervasyonda müşteri açılmaz, kart kaydedilmez", async () => {
    const stripe = statefulStripe();
    setPaymentProviderForTests(new StripeProvider("sk_test_x", stripe.fetchImpl));
    const b = await withoutDeposit.hold({ nights: 1 });
    expect((await pay(b.id, withoutDeposit.userId)).status).toBe("confirmed");
    expect(stripe.calls.filter((c) => c.path === "/v1/customers")).toHaveLength(0);
    const auth = stripe.calls.find((c) => c.method === "POST" && c.path === "/v1/payment_intents")!;
    expect(auth.body.get("customer")).toBeNull();
    expect(auth.body.get("setup_future_usage")).toBeNull();
    expect(await prisma.paymentCustomer.count({ where: { userId: withoutDeposit.userId } })).toBe(
      0
    );
  });
});
