import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signToken, getUserFromRequest } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta girin"),
  password: z.string().min(1, "Parola boş olamaz"),
});

export async function POST(req: NextRequest) {
  try {
    if (getUserFromRequest(req)) {
      return NextResponse.json({ error: "Zaten giriş yapmış durumdasınız" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    const valid = user && (await verifyPassword(password, user.passwordHash));

    if (!user || !valid) {
      return NextResponse.json({ error: "E-posta veya parola hatalı" }, { status: 401 });
    }

    const token = signToken(user.id, user.role);
    const response = NextResponse.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      },
      token,
    });
    response.cookies.set("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
