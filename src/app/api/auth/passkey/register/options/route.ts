import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { passkeyRegistrationOptions } from "@/lib/auth/passkey";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

/** Oturum açmış kullanıcı için passkey kayıt seçenekleri (WebAuthn `create()`). */
export const POST = observed(
  "auth.passkey.register.options",
  async function postHandler(req: NextRequest) {
    try {
      const { userId } = await requireAuth(req);
      return NextResponse.json(await passkeyRegistrationOptions(userId));
    } catch (error) {
      return toErrorResponse(error, "auth.passkey.register.options");
    }
  }
);

export const dynamic = "force-dynamic";
