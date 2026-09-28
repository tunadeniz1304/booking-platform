import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { payForBooking } from "@/lib/payment/payment-service";
import { reserveNowPayLater } from "@/lib/payment/rnpl";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { observed } from "@/lib/http/observed";
import { payBookingSchema } from "@/lib/http/api-schemas";
import { resolveDeviceId, setDeviceCookie } from "@/lib/risk/device-cookie";

/**
 * HELD rezervasyonun ödemesi: authorize → (3DS) → capture → CONFIRMED. `paymentOption: "rnpl"`
 * (P1-3) → bugün 0, kart kaydı + zamanlanmış tahsilat, CONFIRMED.
 */
export const POST = observed(
  "bookings.pay",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    // Kimlik hata yanıtlarında da yazılır (ör. STEP_UP_REQUIRED sonrası tekrar "yeni cihaz" olmasın).
    const device = resolveDeviceId(req.cookies);
    const withDevice = (res: NextResponse) => {
      if (device.issued) setDeviceCookie(res, device.deviceId);
      return res;
    };
    try {
      const { id } = await params;
      const { userId } = await requireVerifiedEmail(req);
      const { cardToken, stepUpToken, creditMinor, paymentOption } = payBookingSchema.parse(
        await req.json()
      );
      const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128);
      if (!idempotencyKey) throw new ValidationError("Idempotency-Key başlığı zorunludur");
      const config = getConfig();
      const hops = config.TRUSTED_PROXY_HOPS;
      const context = {
        // Hız kuralı istemci anahtarıyla sayılır (IP ya da parmak izi; tek "unknown" kovası yok).
        ip: clientKey(req.headers, {
          trustedProxyHops: hops,
          trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
        }),
        // Ülke başlığı yalnızca güvenilir bir CDN/proxy arkasında dikkate alınır.
        ipCountry: hops > 0 ? req.headers.get("cf-ipcountry") : null,
        deviceId: device.deviceId,
      };
      if (paymentOption === "rnpl") {
        // P1-3: RNPL_ENABLED=false ya da uygun değilse 409 RNPL_UNAVAILABLE.
        const scheduled = await reserveNowPayLater({
          bookingId: id,
          userId,
          cardToken,
          idempotencyKey,
          creditMinor,
          context,
        });
        return withDevice(NextResponse.json(scheduled, { status: 200 }));
      }
      const outcome = await payForBooking({
        bookingId: id,
        userId,
        cardToken,
        idempotencyKey,
        stepUpToken: stepUpToken ?? null,
        creditMinor,
        context,
      });
      return withDevice(
        NextResponse.json(outcome, { status: outcome.status === "confirmed" ? 200 : 202 })
      );
    } catch (error) {
      return withDevice(toErrorResponse(error, "bookings.pay"));
    }
  }
);

export const dynamic = "force-dynamic";
