import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import { httpRequestDuration } from "@/lib/http/observed";
import { POST as webhookPost } from "@/app/api/payments/webhook/route";
import { POST as payConfirmPost } from "@/app/api/bookings/[id]/pay/confirm/route";

/** `http_request_duration_seconds_count` örnek sayısı (route + status). */
async function sampleCount(route: string, status: string): Promise<number> {
  const { values } = await httpRequestDuration.get();
  return values
    .filter(
      (v) =>
        v.metricName === "http_request_duration_seconds_count" &&
        v.labels.route === route &&
        v.labels.status === status
    )
    .reduce((sum, v) => sum + v.value, 0);
}

describe("v5 P0-5: burn-rate SLO'larının ölçtüğü rotalar gecikme histogramına yazar", () => {
  afterEach(() => setPaymentProviderForTests(null));

  it("PSP webhook'u route=payments.webhook olarak ölçülür", async () => {
    setPaymentProviderForTests(new MockPsp());
    const before = await sampleCount("payments.webhook", "400");
    const res = await webhookPost(
      new NextRequest("http://localhost/api/payments/webhook", {
        method: "POST",
        headers: { "x-psp-signature": "t=1,v1=zz" },
        body: "{}",
      })
    );
    expect(res.status).toBe(400);
    expect(await sampleCount("payments.webhook", "400")).toBe(before + 1);
  });

  it("3DS ödeme onayı route=bookings.pay.confirm olarak ölçülür", async () => {
    const before = await sampleCount("bookings.pay.confirm", "401");
    const res = await payConfirmPost(
      new NextRequest("http://localhost/api/bookings/b1/pay/confirm", {
        method: "POST",
        body: JSON.stringify({ code: "123456" }),
      }),
      { params: Promise.resolve({ id: "b1" }) }
    );
    expect(res.status).toBe(401);
    expect(await sampleCount("bookings.pay.confirm", "401")).toBe(before + 1);
  });
});
