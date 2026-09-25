import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { payForBooking } from "@/lib/payment/payment-service";
import { setPaymentProviderForTests } from "@/lib/payment";
import { StripeProvider } from "@/lib/payment/stripe-provider";
import { POST as webhookPost } from "@/app/api/payments/webhook/route";
import { intent, stripeFake } from "../support/stripe-fake";

const WEBHOOK_ENV = "STRIPE_WEBHOOK_SECRET";
const SECRET = "whsec_integration_test";

function stripeWebhook(payload: string, header: string) {
  return webhookPost(
    new NextRequest("http://localhost/api/payments/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": header, "content-type": "application/json" },
    })
  );
}

describeInt("regression: v3#10 gerçek Stripe akışı (kayıtlı yanıtlar, ağsız)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let previousSecret: string | undefined;

  beforeAll(async () => {
    previousSecret = process.env[WEBHOOK_ENV];
    process.env[WEBHOOK_ENV] = SECRET;
    fx = await createStayFixture(prisma, { tag: "stripe" });
  });
  afterEach(() => setPaymentProviderForTests(null));
  afterAll(async () => {
    if (previousSecret === undefined) delete process.env[WEBHOOK_ENV];
    else process.env[WEBHOOK_ENV] = previousSecret;
    await prisma.$disconnect();
  });

  it("3DS → requires_action; imzalı payment_intent.succeeded → CONFIRMED; replay tek etki; kötü imza 400", async () => {
    const piId = `pi_it_${Date.now()}`;
    const { fetchImpl, calls } = stripeFake(() => intent(piId, "requires_action"));
    setPaymentProviderForTests(new StripeProvider("sk_test_x", fetchImpl));
    const b = await fx.hold();

    const out = await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "pm_card_threeDSecure2Required",
      idempotencyKey: "stripe-it-1",
    });
    expect(out).toMatchObject({
      status: "requires_action",
      challenge: { type: "stripe_next_action", clientSecret: `${piId}_secret_x` },
    });
    expect(calls[0].body.get("capture_method")).toBe("manual");

    const payload = JSON.stringify({
      id: `evt_${piId}`,
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: { id: piId, amount: b.totalMinor, amount_received: b.totalMinor, currency: "try" },
      },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });

    const bad = await stripeWebhook(payload, header.replace(/v1=[0-9a-f]+/, "v1=deadbeef"));
    expect(bad.status).toBe(400);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("HELD");

    const first = await stripeWebhook(payload, header);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, duplicate: false });
    const replay = await stripeWebhook(payload, header);
    expect(await replay.json()).toEqual({ received: true, duplicate: true });

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(booking.status).toBe("CONFIRMED");
    const charges = await prisma.ledgerEntry.count({ where: { bookingId: b.id, kind: "CHARGE" } });
    expect(charges).toBe(1);
    expect(await prisma.paymentEvent.count({ where: { id: `evt_${piId}` } })).toBe(1);
  });

  it("imzası geçerli ama ilgisiz olay türü → 200 ignored", async () => {
    const payload = JSON.stringify({
      id: `evt_ignored_${Date.now()}`,
      object: "event",
      type: "customer.created",
      data: { object: { id: "cus_1" } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await stripeWebhook(payload, header);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
  });
});
