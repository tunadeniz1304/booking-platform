import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { previewPasswordResetToken } from "@/lib/auth/password-reset-preview";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({ token: z.string().min(20).max(200) });

/**
 * Sıfırlama bağlantısı ön kontrolü (token tüketilmez): geçerliyse hesabın e-postası,
 * değilse 400 VALIDATION_ERROR (reset ucuyla aynı yanıt).
 */
export const POST = observed(
  "auth.password.reset.preview",
  async function postHandler(req: NextRequest) {
    try {
      const { token } = bodySchema.parse(await req.json());
      const account = await previewPasswordResetToken(token);
      if (!account) throw new ValidationError("Bağlantı geçersiz veya süresi dolmuş");
      return NextResponse.json(
        { email: account.email },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (error) {
      return toErrorResponse(error, "auth.password.reset.preview");
    }
  }
);

export const dynamic = "force-dynamic";
