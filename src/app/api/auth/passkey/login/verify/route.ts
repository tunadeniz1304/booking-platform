import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyPasskeyLogin } from "@/lib/auth/passkey";
import { applyDeviceCookie, startSession } from "@/lib/auth/user-sessions";
import { setSessionCookies } from "@/lib/auth/cookies";
import { recordSuccessfulLogin } from "@/lib/auth/account";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({
  challengeId: z.string().uuid(),
  response: z.object({ id: z.string().min(1).max(1024) }).passthrough(),
});

export const POST = observed(
  "auth.passkey.login.verify",
  async function postHandler(req: NextRequest) {
    try {
      const body = bodySchema.parse(await req.json());
      const user = await verifyPasskeyLogin(
        body.challengeId,
        body.response as unknown as AuthenticationResponseJSON
      );
      await recordSuccessfulLogin(user.id);
      const started = await startSession(req, user, { alertNewDevice: true });
      const session = started.session;
      const response = NextResponse.json({
        user,
        accessToken: session.accessToken,
        accessExpiresAt: session.accessExpiresAt.toISOString(),
      });
      setSessionCookies(response, session);
      applyDeviceCookie(response, started);
      return response;
    } catch (error) {
      return toErrorResponse(error, "auth.passkey.login.verify");
    }
  }
);

export const dynamic = "force-dynamic";
