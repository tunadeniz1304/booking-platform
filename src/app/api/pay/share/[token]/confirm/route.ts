import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { confirmShareChallenge } from "@/lib/cart";
import { cartConfirmSchema } from "@/lib/cart/schemas";

/** Pay ödemesinin 3DS doğrulama kodu (mock PSP). */
export const POST = observed(
  "pay.share.confirm",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    try {
      const { token } = await params;
      const { userId } = await requireVerifiedEmail(req);
      const { code } = cartConfirmSchema.parse(await req.json());
      return NextResponse.json(
        await confirmShareChallenge({
          token: decodeURIComponent(token),
          userId,
          code: code ?? "",
        })
      );
    } catch (error) {
      return toErrorResponse(error, "pay.share.confirm");
    }
  }
);

export const dynamic = "force-dynamic";
