import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { getShareView, payShare } from "@/lib/cart";
import { cartPaySchema } from "@/lib/cart/schemas";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { resolveDeviceId, setDeviceCookie } from "@/lib/risk/device-cookie";

type Ctx = { params: Promise<{ token: string }> };

/** Katılımcı ödeme sayfası verisi: imzalı + süreli link, oturum ve (varsa) e-posta eşleşmesi. */
export const GET = observed("pay.share", async function getHandler(req: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const { userId } = await requireAuth(req);
    return NextResponse.json({ share: await getShareView(decodeURIComponent(token), userId) });
  } catch (error) {
    return toErrorResponse(error, "pay.share.get");
  }
});

/** Payı öder (yalnız yetkilendirme; son pay gelince hepsi tahsil edilir ve sepet onaylanır). */
export const POST = observed("pay.share", async function postHandler(req: NextRequest, ctx: Ctx) {
  const device = resolveDeviceId(req.cookies);
  const withDevice = (res: NextResponse) => {
    if (device.issued) setDeviceCookie(res, device.deviceId);
    return res;
  };
  try {
    const { token } = await ctx.params;
    const { userId } = await requireVerifiedEmail(req);
    const { cardToken } = cartPaySchema.parse(await req.json());
    const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128);
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key başlığı zorunludur");
    const config = getConfig();
    const hops = config.TRUSTED_PROXY_HOPS;
    const outcome = await payShare({
      token: decodeURIComponent(token),
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
      NextResponse.json(outcome, { status: outcome.status === "requires_action" ? 202 : 200 })
    );
  } catch (error) {
    return withDevice(toErrorResponse(error, "pay.share"));
  }
});

export const dynamic = "force-dynamic";
