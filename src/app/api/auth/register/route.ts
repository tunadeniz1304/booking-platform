import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, signToken, getUserFromRequest } from "@/lib/auth";

const registerSchema = z.object({
  firstName: z.string().trim().min(2, "Ad en az 2 karakter olmalıdır"),
  lastName: z.string().trim().min(2, "Soyad en az 2 karakter olmalıdır"),
  email: z.string().trim().email("Geçerli bir e-posta girin"),
  password: z
    .string()
    .min(8, "Parola en az 8 karakter olmalıdır")
    .regex(/[0-9]/, "Parola en az bir rakam içermelidir"),
});

export async function POST(req: NextRequest) {
  try {
    // Zaten giriş yapmış kullanıcı tekrar kayıt olamaz
    if (getUserFromRequest(req)) {
      return NextResponse.json({ error: "Zaten giriş yapmış durumdasınız" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { firstName, lastName, email, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return NextResponse.json({ error: "Bu e-posta adresi zaten kayıtlı" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email: email.toLowerCase(),
        passwordHash,
        role: "USER",
      },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
    });

    const token = signToken(user.id, user.role);
    const response = NextResponse.json({ user, token }, { status: 201 });
    response.cookies.set("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
