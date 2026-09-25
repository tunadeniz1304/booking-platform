import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPasswordConstantTime } from "@/lib/auth";
import { issueSession } from "@/lib/auth/session";
import { setSessionCookies } from "@/lib/auth/cookies";
import {
  AccountLockedError,
  checkLoginAttemptLimit,
  lockRemainingSeconds,
  recordFailedLogin,
  recordSuccessfulLogin,
} from "@/lib/auth/account";
import { UnauthorizedError, toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const loginSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta girin").max(254),
  password: z.string().min(1, "Parola boş olamaz").max(200),
});

export const POST = observed("auth.login", async function postHandler(req: NextRequest) {
  try {
    const { email, password } = loginSchema.parse(await req.json());
    // Hesap bazlı limit (IP'den bağımsız; parmak izi değiştirerek aşılamaz) — v3#3.
    await checkLoginAttemptLimit(email);

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        passwordHash: true,
        tokenVersion: true,
        lockedUntil: true,
        deletedAt: true,
        emailVerifiedAt: true,
      },
    });

    // Kullanıcı yoksa da bcrypt karşılaştırması yapılır (zamanlama e-posta varlığını ele vermez).
    const valid = await verifyPasswordConstantTime(password, user?.passwordHash);
    const locked = lockRemainingSeconds(user?.lockedUntil ?? null);
    // Kilitliyken doğru parola da kabul edilmez (kaba kuvvet kilit süresince durur).
    if (user && locked > 0) throw new AccountLockedError(locked);
    if (!user || user.deletedAt || !valid) {
      if (user && !user.deletedAt) await recordFailedLogin(user.id);
      throw new UnauthorizedError("E-posta veya parola hatalı");
    }
    await recordSuccessfulLogin(user.id);

    const session = await issueSession(user);
    const response = NextResponse.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        emailVerified: Boolean(user.emailVerifiedAt),
      },
      // Tarayıcı dışı istemciler için (Bearer). Tarayıcı çerezi kullanır, bunu saklamaz.
      accessToken: session.accessToken,
      accessExpiresAt: session.accessExpiresAt.toISOString(),
    });
    setSessionCookies(response, session);
    return response;
  } catch (error) {
    return toErrorResponse(error, "auth.login");
  }
});

export const dynamic = "force-dynamic";
