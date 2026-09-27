import { NextRequest, NextResponse } from "next/server";
import { createBooking, listUserBookingsPage, presentBooking } from "@/lib/booking-service";
import { requireAuth, requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { createBookingSchema, listBookingsQuerySchema } from "@/lib/http/api-schemas";
import { assertIdentityRequirement } from "@/lib/trust/kyc";
import { channelFromHeaders } from "@/lib/pricing/promotions";

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
    const res = NextResponse.json(page.items.map(presentBooking));
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
