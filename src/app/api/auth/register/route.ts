import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { issueSession } from "@/lib/auth/session";
import { setSessionCookies } from "@/lib/auth/cookies";
import { ConflictError, toErrorResponse } from "@/lib/http/errors";

const registerSchema = z.object({
  firstName: z.string().trim().min(2, "Ad en az 2 karakter olmalıdır").max(60),
  lastName: z.string().trim().min(2, "Soyad en az 2 karakter olmalıdır").max(60),
  email: z.string().trim().email("Geçerli bir e-posta girin").max(254),
  password: z
    .string()
    .min(8, "Parola en az 8 karakter olmalıdır")
    .max(200)
    .regex(/[0-9]/, "Parola en az bir rakam içermelidir"),
});

export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName, email, password } = registerSchema.parse(await req.json());

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await prisma.user.create({
        data: { firstName, lastName, email: email.toLowerCase(), passwordHash, role: "USER" },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("Bu e-posta adresi zaten kayıtlı", "EMAIL_TAKEN");
      }
      throw error;
    }

    const session = await issueSession(user);
    const response = NextResponse.json(
      {
        user,
        accessToken: session.accessToken,
        accessExpiresAt: session.accessExpiresAt.toISOString(),
      },
      { status: 201 }
    );
    setSessionCookies(response, session);
    return response;
  } catch (error) {
    return toErrorResponse(error, "auth.register");
  }
}

export const dynamic = "force-dynamic";
