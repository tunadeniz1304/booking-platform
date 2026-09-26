import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthTokenKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { applyDeviceCookie, startSession } from "@/lib/auth/user-sessions";
import { setSessionCookies } from "@/lib/auth/cookies";
import { issueEmailToken } from "@/lib/auth/account";
import { ConflictError, toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { passwordSchema } from "@/lib/auth/password-policy";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";

const registerSchema = z.object({
  firstName: z.string().trim().min(2, "Ad en az 2 karakter olmalıdır").max(60),
  lastName: z.string().trim().min(2, "Soyad en az 2 karakter olmalıdır").max(60),
  email: z.string().trim().email("Geçerli bir e-posta girin").max(254),
  password: passwordSchema,
});

/** Kayıt: oturum açılır ve doğrulama e-postası outbox'a yazılır (P0-8). */
export const POST = observed("auth.register", async function postHandler(req: NextRequest) {
  try {
    const { firstName, lastName, email, password } = registerSchema.parse(await req.json());

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await prisma.user.create({
        data: {
          firstName,
          lastName,
          email: email.toLowerCase(),
          passwordHash,
          role: "USER",
          locale: resolveLocale(req.cookies.get(LOCALE_COOKIE)?.value),
        },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("Bu e-posta adresi zaten kayıtlı", "EMAIL_TAKEN");
      }
      throw error;
    }
    await issueEmailToken(user, AuthTokenKind.EMAIL_VERIFY);

    const started = await startSession(req, { ...user, tokenVersion: 0 });
    const session = started.session;
    const response = NextResponse.json(
      {
        user: { ...user, emailVerified: false },
        accessToken: session.accessToken,
        accessExpiresAt: session.accessExpiresAt.toISOString(),
      },
      { status: 201 }
    );
    setSessionCookies(response, session);
    applyDeviceCookie(response, started);
    return response;
  } catch (error) {
    return toErrorResponse(error, "auth.register");
  }
});

export const dynamic = "force-dynamic";
