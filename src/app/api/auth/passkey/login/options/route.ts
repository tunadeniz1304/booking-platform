import { NextResponse } from "next/server";
import { passkeyLoginOptions } from "@/lib/auth/passkey";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

/** Passkey ile giriş seçenekleri (discoverable credential; kullanıcı adı gerekmez). */
export const POST = observed("auth.passkey.login.options", async function postHandler() {
  try {
    return NextResponse.json(await passkeyLoginOptions());
  } catch (error) {
    return toErrorResponse(error, "auth.passkey.login.options");
  }
});

export const dynamic = "force-dynamic";
