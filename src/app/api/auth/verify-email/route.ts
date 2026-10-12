import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyEmail } from "@/lib/auth/account";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({ token: z.string().min(20).max(200) });

/** E-posta doğrulama bağlantısını tüketir (tek kullanımlık). */
export const POST = observed("auth.verify_email", async function postHandler(req: NextRequest) {
  try {
    const { token } = bodySchema.parse(await req.json());
    const { alreadyVerified } = await verifyEmail(token);
    // Önceden doğrulanmış hesapta kullanılmış bağlantı hata değil (F398).
    return NextResponse.json(
      alreadyVerified ? { verified: true, alreadyVerified: true } : { verified: true }
    );
  } catch (error) {
    return toErrorResponse(error, "auth.verify_email");
  }
});

export const dynamic = "force-dynamic";
