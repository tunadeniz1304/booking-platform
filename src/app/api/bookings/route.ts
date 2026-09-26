import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createBooking, listUserBookingsPage, presentBooking } from "@/lib/booking-service";
import { requireAuth, requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { assertIdentityRequirement } from "@/lib/trust/kyc";

const createBookingSchema = z.object({
  propertyId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guestCount: z.number().int().positive().max(20),
  /** Checkout'ta gösterilen teklif; fiyat değiştiyse 409 PRICE_CHANGED. */
  quoteId: z.string().uuid().optional(),
  /** Fiyat planı (yoksa varsayılan) ve oda adedi (v3 P0-2). */
  ratePlanId: z.string().min(1).max(64).optional(),
  units: z.number().int().min(1).max(10).optional(),
  /** Tahsilat para birimi (P0-5); yoksa teklifinki ya da tesisinki. */
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((c) => c.toUpperCase())
    .optional(),
});

export const POST = observed("bookings", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireVerifiedEmail(req);
    // P1-6: KYC_REQUIRED_FOR_GUESTS açıksa doğrulanmış kimlik gerekir.
    await assertIdentityRequirement(userId, "GUEST");
    const parsed = createBookingSchema.parse(await req.json());
    const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128) || undefined;

    const booking = await createBooking({ userId, ...parsed, idempotencyKey });
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "bookings.create");
  }
});

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * Cursor pagination (v4#14). Gövde geriye uyumlu olarak DİZİ kalır; sonraki sayfa
 * `X-Next-Cursor` başlığı ve `Link: <…?cursor=…>; rel="next"` ile bildirilir.
 */
export const GET = observed("bookings", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const url = new URL(req.url);
    const query = listQuerySchema.parse({
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
