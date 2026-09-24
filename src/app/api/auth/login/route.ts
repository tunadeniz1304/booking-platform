import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPasswordConstantTime } from "@/lib/auth";
import { issueSession } from "@/lib/auth/session";
import { setSessionCookies } from "@/lib/auth/cookies";
import { UnauthorizedError, toErrorResponse } from "@/lib/http/errors";

const loginSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta girin").max(254),
  password: z.string().min(1, "Parola boş olamaz").max(200),
});

export async function POST(req: NextRequest) {
  try {
    const { email, password } = loginSchema.parse(await req.json());

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        passwordHash: true,
      },
    });

    // Kullanıcı yoksa da bcrypt karşılaştırması yapılır (zamanlama e-posta varlığını ele vermez).
    const valid = await verifyPasswordConstantTime(password, user?.passwordHash);
    if (!user || !valid) throw new UnauthorizedError("E-posta veya parola hatalı");

    const session = await issueSession(user);
    const response = NextResponse.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
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
}

export const dynamic = "force-dynamic";
