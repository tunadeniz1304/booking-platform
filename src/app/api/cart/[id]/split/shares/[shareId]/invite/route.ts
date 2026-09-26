import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { sendShareInvite } from "@/lib/cart";
import { splitInviteSchema } from "@/lib/cart/schemas";

type Ctx = { params: Promise<{ id: string; shareId: string }> };

/** Pay davetini e-postayla (yeniden) gönderir; e-posta verilirse paya yazılır. */
export const POST = observed(
  "cart.split.invite",
  async function postHandler(req: NextRequest, ctx: Ctx) {
    try {
      const { id, shareId } = await ctx.params;
      const { userId } = await requireVerifiedEmail(req);
      const { email } = splitInviteSchema.parse(await req.json().catch(() => ({})));
      const plan = await sendShareInvite({ cartId: id, userId, shareId, email });
      return NextResponse.json({ plan });
    } catch (error) {
      return toErrorResponse(error, "cart.split.invite");
    }
  }
);

export const dynamic = "force-dynamic";
