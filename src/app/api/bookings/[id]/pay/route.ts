import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { payForBooking } from "@/lib/payment/payment-service";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({
  /** PSP hosted-field token'ı (kart numarası sunucuya gelmez). */
  cardToken: z.string().min(8).max(200),
  /** Kartın ilk 6 hanesi (BIN; hosted field'dan) — BIN–IP ülke uyumsuzluğu kuralı için. */
  cardBin: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  /** İstemci cihaz izi (`device-fingerprint.ts`; ekran + saat dilimi + dil hash'i). */
  deviceId: z
    .string()
    .regex(/^[a-z0-9]{8,64}$/)
    .optional(),
});

/** HELD rezervasyonun ödemesi: authorize → (3DS) → capture → CONFIRMED. */
export const POST = observed(
  "bookings.pay",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      const { cardToken, cardBin, deviceId } = bodySchema.parse(await req.json());
      const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128);
      if (!idempotencyKey) throw new ValidationError("Idempotency-Key başlığı zorunludur");
      const config = getConfig();
      const hops = config.TRUSTED_PROXY_HOPS;
      const outcome = await payForBooking({
        bookingId: id,
        userId,
        cardToken,
        idempotencyKey,
        context: {
          // Hız kuralı istemci anahtarıyla sayılır (IP ya da parmak izi; tek "unknown" kovası yok).
          ip: clientKey(req.headers, {
            trustedProxyHops: hops,
            trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
          }),
          // Ülke başlığı yalnızca güvenilir bir CDN/proxy arkasında dikkate alınır.
          ipCountry: hops > 0 ? req.headers.get("cf-ipcountry") : null,
          cardBin: cardBin ?? null,
          deviceId: deviceId ?? null,
        },
      });
      return NextResponse.json(outcome, { status: outcome.status === "confirmed" ? 200 : 202 });
    } catch (error) {
      return toErrorResponse(error, "bookings.pay");
    }
  }
);

export const dynamic = "force-dynamic";
