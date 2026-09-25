import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { stepUpOptions } from "@/lib/auth/passkey";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

/** Risk bazlı step-up (P1-8): oturumdaki kullanıcının kendi passkey'leriyle `get()` seçenekleri. */
export const POST = observed("auth.stepup.options", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return NextResponse.json(await stepUpOptions(userId));
  } catch (error) {
    return toErrorResponse(error, "auth.stepup.options");
  }
});

export const dynamic = "force-dynamic";
