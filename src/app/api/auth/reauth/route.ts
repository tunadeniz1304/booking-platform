import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { requireAuth } from "@/lib/auth";
import { refreshAuthTime, verifyReauthProof } from "@/lib/auth/recent-auth";
import { setSessionCookies } from "@/lib/auth/cookies";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const bodySchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: z.string().min(1).max(200) }),
  z.object({
    method: z.literal("passkey"),
    response: z.object({ id: z.string().min(1).max(1024) }).passthrough(),
  }),
]);

/**
 * Yeniden doğrulama (v4#2): parola ya da kendi passkey'i ile. Başarılıysa `auth_time`
 * tazelenmiş yeni oturum çerezleri yazılır; hassas işlem ardından tekrarlanır.
 */
export const POST = observed("auth.reauth", async function postHandler(req: NextRequest) {
  try {
    const claims = await requireAuth(req);
    const body = bodySchema.parse(await req.json());
    await verifyReauthProof(
      claims.userId,
      body.method === "password"
        ? { method: "password", password: body.password }
        : {
            method: "passkey",
            response: body.response as unknown as AuthenticationResponseJSON,
          }
    );
    const session = await refreshAuthTime(req, claims);
    // Tarayıcı dışı istemciler için (Bearer); tarayıcı çerezleri kullanır.
    const res = NextResponse.json({
      reauthenticated: true,
      accessToken: session.accessToken,
      accessExpiresAt: session.accessExpiresAt.toISOString(),
    });
    setSessionCookies(res, session);
    return res;
  } catch (error) {
    return toErrorResponse(error, "auth.reauth");
  }
});

export const dynamic = "force-dynamic";
