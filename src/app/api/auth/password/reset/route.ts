import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetPassword } from "@/lib/auth/account";
import { passwordSchema } from "@/lib/auth/password-policy";
import { clearSessionCookies } from "@/lib/auth/cookies";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

/** Yeni şifreyi ayarlar; tüm cihazlardaki oturumlar kapanır (tokenVersion++). */
export const POST = observed("auth.password.reset", async function postHandler(req: NextRequest) {
  try {
    const { token, password } = bodySchema.parse(await req.json());
    await resetPassword(token, password);
    const res = NextResponse.json({ reset: true });
    clearSessionCookies(res);
    return res;
  } catch (error) {
    return toErrorResponse(error, "auth.password.reset");
  }
});

export const dynamic = "force-dynamic";
