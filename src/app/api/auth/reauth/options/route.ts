import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { reauthPasskeyOptions } from "@/lib/auth/passkey";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

/** Passkey ile yeniden doğrulama (v4#2): kullanıcının kendi passkey'leriyle `get()` seçenekleri. */
export const POST = observed("auth.reauth.options", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return NextResponse.json(await reauthPasskeyOptions(userId));
  } catch (error) {
    return toErrorResponse(error, "auth.reauth.options");
  }
});

export const dynamic = "force-dynamic";
