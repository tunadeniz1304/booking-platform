import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { payCart } from "@/lib/cart";
import { cartPaySchema } from "@/lib/cart/schemas";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { resolveDeviceId, setDeviceCookie } from "@/lib/risk/device-cookie";

/** Sepet toplamı TEK ödeme: authorize → (3DS) → capture → tüm kalemler CONFIRMED. */
export const POST = observed(
  "cart.pay",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const device = resolveDeviceId(req.cookies);
    const withDevice = (res: NextResponse) => {
      if (device.issued) setDeviceCookie(res, device.deviceId);
      return res;
    };
    try {
      const { id } = await params;
      const { userId } = await requireVerifiedEmail(req);
      const { cardToken } = cartPaySchema.parse(await req.json());
      const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128);
      if (!idempotencyKey) throw new ValidationError("Idempotency-Key başlığı zorunludur");
      const config = getConfig();
      const hops = config.TRUSTED_PROXY_HOPS;
      const outcome = await payCart({
        cartId: id,
        userId,
        cardToken,
        idempotencyKey,
        context: {
          ip: clientKey(req.headers, {
            trustedProxyHops: hops,
            trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
          }),
          ipCountry: hops > 0 ? req.headers.get("cf-ipcountry") : null,
          deviceId: device.deviceId,
        },
      });
      return withDevice(
        NextResponse.json(outcome, { status: outcome.status === "confirmed" ? 200 : 202 })
      );
    } catch (error) {
      return withDevice(toErrorResponse(error, "cart.pay"));
    }
  }
);

export const dynamic = "force-dynamic";
