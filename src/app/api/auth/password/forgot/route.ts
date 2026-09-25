import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestPasswordReset } from "@/lib/auth/account";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta girin").max(254),
});

/**
 * Şifre sıfırlama isteği. Yanıt, hesabın var olup olmadığından bağımsız olarak
 * daima 202'dir (kullanıcı numaralandırma yok).
 */
export const POST = observed("auth.password.forgot", async function postHandler(req: NextRequest) {
  try {
    const { email } = bodySchema.parse(await req.json());
    await requestPasswordReset(email);
    return NextResponse.json(
      { message: "Hesap varsa şifre sıfırlama bağlantısı e-postayla gönderildi." },
      { status: 202 }
    );
  } catch (error) {
    return toErrorResponse(error, "auth.password.forgot");
  }
});

export const dynamic = "force-dynamic";
