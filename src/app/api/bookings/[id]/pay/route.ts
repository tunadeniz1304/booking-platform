import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { payForBooking } from "@/lib/payment/payment-service";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { observed } from "@/lib/http/observed";
import { resolveDeviceId, setDeviceCookie } from "@/lib/risk/device-cookie";

const bodySchema = z.object({
  /** PSP hosted-field token'ı (kart numarası sunucuya gelmez). */
  cardToken: z.string().min(8).max(200),
  /** Passkey step-up token'ı (v4#2): bu rezervasyon + tutara bağlı, tek kullanımlık. */
  stepUpToken: z.string().min(16).max(64).optional(),
  // v4#13: `cardBin` / `deviceId` artık istemciden ALINMAZ (gönderilirse yok sayılır):
  // BIN PSP token metadata'sından, cihaz kimliği sunucu imzalı `did` çerezinden gelir.
});

/** HELD rezervasyonun ödemesi: authorize → (3DS) → capture → CONFIRMED. */
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
      const { cardToken, stepUpToken } = bodySchema.parse(await req.json());
      const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128);
      if (!idempotencyKey) throw new ValidationError("Idempotency-Key başlığı zorunludur");
      const config = getConfig();
      const hops = config.TRUSTED_PROXY_HOPS;
      const outcome = await payForBooking({
        bookingId: id,
        userId,
        cardToken,
        idempotencyKey,
        stepUpToken: stepUpToken ?? null,
        context: {
          // Hız kuralı istemci anahtarıyla sayılır (IP ya da parmak izi; tek "unknown" kovası yok).
          ip: clientKey(req.headers, {
            trustedProxyHops: hops,
            trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
          }),
          // Ülke başlığı yalnızca güvenilir bir CDN/proxy arkasında dikkate alınır.
          ipCountry: hops > 0 ? req.headers.get("cf-ipcountry") : null,
          deviceId: device.deviceId,
        },
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
