import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { requireAuth } from "@/lib/auth";
import { verifyStepUp } from "@/lib/auth/passkey";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({
  response: z.object({ id: z.string().min(1).max(1024) }).passthrough(),
});

/** Step-up doğrulaması: başarılıysa kısa ömürlü, tek kullanımlık ödeme izni bırakır. */
export const POST = observed("auth.stepup.verify", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = bodySchema.parse(await req.json());
    return NextResponse.json(
      await verifyStepUp(userId, body.response as unknown as AuthenticationResponseJSON)
    );
  } catch (error) {
    return toErrorResponse(error, "auth.stepup.verify");
  }
});

export const dynamic = "force-dynamic";
