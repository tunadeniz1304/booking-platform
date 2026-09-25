import { NextRequest, NextResponse } from "next/server";
import { AuthTokenKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { issueEmailToken } from "@/lib/auth/account";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

/** Doğrulama e-postasını yeniden gönderir (önceki bağlantı geçersizleşir). */
export const POST = observed(
  "auth.verify_email.resend",
  async function postHandler(req: NextRequest) {
    try {
      const { userId } = await requireAuth(req);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, firstName: true, emailVerifiedAt: true },
      });
      if (user.emailVerifiedAt) return NextResponse.json({ alreadyVerified: true });
      await issueEmailToken(user, AuthTokenKind.EMAIL_VERIFY);
      return NextResponse.json({ sent: true }, { status: 202 });
    } catch (error) {
      return toErrorResponse(error, "auth.verify_email.resend");
    }
  }
);

export const dynamic = "force-dynamic";
