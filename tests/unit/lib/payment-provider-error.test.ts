import { describe, expect, it } from "vitest";
import { toErrorResponse } from "@/lib/http/errors";
import { PaymentProviderError } from "@/lib/payment/provider";

describe("P2-3 bulgusu: PSP hatası 500 değil", () => {
  it("sağlayıcı hatası → 502 PAYMENT_PROVIDER_ERROR + Retry-After, iç mesaj sızmaz", async () => {
    const res = toErrorResponse(new PaymentProviderError("api_connection_error", "iç ayrıntı"));
    expect(res.status).toBe(502);
    expect(res.headers.get("retry-after")).toBe("5");
    const body = await res.json();
    expect(body).toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      details: { providerCode: "api_connection_error" },
    });
    expect(JSON.stringify(body)).not.toContain("iç ayrıntı");
  });

  it("geçersiz kart token'ı istemci hatasıdır → 422", async () => {
    const res = toErrorResponse(new PaymentProviderError("invalid_token", "x"));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "INVALID_CARD_TOKEN" });
  });
});
