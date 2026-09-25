import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { requireAuth } from "@/lib/auth";
import { verifyPasskeyRegistration } from "@/lib/auth/passkey";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({
  response: z.object({ id: z.string().min(1).max(1024) }).passthrough(),
  name: z.string().trim().max(60).optional(),
});

export const POST = observed(
  "auth.passkey.register.verify",
  async function postHandler(req: NextRequest) {
    try {
      const { userId } = await requireAuth(req);
      const body = bodySchema.parse(await req.json());
      const result = await verifyPasskeyRegistration(
        userId,
        body.response as unknown as RegistrationResponseJSON,
        body.name
      );
      return NextResponse.json({ registered: true, ...result }, { status: 201 });
    } catch (error) {
      return toErrorResponse(error, "auth.passkey.register.verify");
    }
  }
);

export const dynamic = "force-dynamic";
