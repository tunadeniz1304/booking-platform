import { NextRequest, NextResponse } from "next/server";
import { BookingStatus } from "@prisma/client";
import { createBooking, listUserBookingsPage, presentBooking } from "@/lib/booking-service";
import { requireAuth, requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { createBookingSchema, listBookingsQuerySchema } from "@/lib/http/api-schemas";
import { assertIdentityRequirement } from "@/lib/trust/kyc";
import { channelFromHeaders } from "@/lib/pricing/promotions";
import { getConfig } from "@/lib/config/app-config";
import { minorFromDb, money, multiplyRate } from "@/lib/money/money";

export const POST = observed("bookings", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireVerifiedEmail(req);
    // P1-6: KYC_REQUIRED_FOR_GUESTS açıksa doğrulanmış kimlik gerekir.
    await assertIdentityRequirement(userId, "GUEST");
    const parsed = createBookingSchema.parse(await req.json());
    const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128) || undefined;

    const booking = await createBooking({
      userId,
      ...parsed,
      idempotencyKey,
      channel: channelFromHeaders(req.headers),
    });
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "bookings.create");
  }
});

/**
 * Devir ipuçları (F910/F911): `transferable` ve `maxAskMinor` sunucu yapılandırmasından,
 * `listBookingForTransfer` ile aynı kurallarla hesaplanır (istemci 48 saat / oran 1 varsaymaz).
 */
function transferHints(
  row: { status: BookingStatus; checkIn: Date; totalPriceMinor: bigint | number; currency: string },
  now: number
): { transferable: boolean; maxAskMinor?: number } {
  const config = getConfig();
  const transferable =
    config.FEATURE_TRANSFER &&
    row.status === BookingStatus.CONFIRMED &&
    (row.checkIn.getTime() - now) / 3_600_000 > config.TRANSFER_MIN_HOURS_BEFORE_CHECKIN;
  try {
    const paid = money(minorFromDb(row.totalPriceMinor), row.currency);
    const maxAsk = multiplyRate(paid, config.TRANSFER_MAX_ASK_RATIO);
    return { transferable, maxAskMinor: maxAsk.amount };
  } catch {
    // Desteklenmeyen para birimi vb.: liste bozulmaz, istemci ödenen tutarı üst sınır alır.
    return { transferable };
  }
}

/**
 * Cursor pagination (v4#14). Gövde geriye uyumlu olarak DİZİ kalır; sonraki sayfa
 * `X-Next-Cursor` başlığı ve `Link: <…?cursor=…>; rel="next"` ile bildirilir.
 */
export const GET = observed("bookings", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const url = new URL(req.url);
    const query = listBookingsQuerySchema.parse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const page = await listUserBookingsPage(userId, query);
    const now = Date.now();
    const res = NextResponse.json(
      page.items.map((b) => ({ ...presentBooking(b), ...transferHints(b, now) }))
    );
    if (page.nextCursor) {
      const next = new URL(url);
      next.searchParams.set("cursor", page.nextCursor);
      res.headers.set("X-Next-Cursor", page.nextCursor);
      res.headers.set("Link", `<${next.pathname}${next.search}>; rel="next"`);
    }
    return res;
  } catch (error) {
    return toErrorResponse(error, "bookings.list");
  }
});

export const dynamic = "force-dynamic";
