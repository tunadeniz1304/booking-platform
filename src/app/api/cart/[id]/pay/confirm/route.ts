import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { confirmCartChallenge } from "@/lib/cart";
import { cartConfirmSchema } from "@/lib/cart/schemas";

/** Sepet ödemesinin 3DS doğrulama kodu (mock PSP). */
export const POST = observed(
  "cart.pay.confirm",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireVerifiedEmail(req);
      const { code } = cartConfirmSchema.parse(await req.json());
      return NextResponse.json(
        await confirmCartChallenge({ cartId: id, userId, code: code ?? "" })
      );
    } catch (error) {
      return toErrorResponse(error, "cart.pay.confirm");
    }
  }
);

export const dynamic = "force-dynamic";
