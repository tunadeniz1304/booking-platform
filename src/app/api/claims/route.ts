import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { listClaims, openClaim, openClaimSchema } from "@/lib/resolution/claims";

/** Çözüm merkezi (P1-5): kullanıcının taraf olduğu talepler (`?bookingId=` ile süzülür). */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req);
    const bookingId = req.nextUrl.searchParams.get("bookingId") ?? undefined;
    return NextResponse.json({ claims: await listClaims(actor, { bookingId }) });
  } catch (error) {
    return toErrorResponse(error, "claims.list");
  }
}

/** Talep aç: misafir → GUEST_REFUND, ev sahibi → HOST_DAMAGE (taraf değilse 404). */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireVerifiedEmail(req);
    const parsed = openClaimSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Geçersiz talep", parsed.error.flatten());
    const claim = await openClaim(actor, parsed.data);
    return NextResponse.json({ id: claim.id, status: claim.status }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "claims.open");
  }
}

export const dynamic = "force-dynamic";
