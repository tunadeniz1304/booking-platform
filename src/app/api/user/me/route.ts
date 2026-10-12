import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";
import { logger, errorFields } from "@/lib/observability/logger";

export async function GET(req: NextRequest) {
  const user = await getAuth(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const record = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
        emailVerifiedAt: true,
      },
    });

    if (!record) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Ham zaman damgası yerine yalnız doğrulama durumu (hesap ve başlık rozeti için).
    const { emailVerifiedAt, ...profile } = record;
    return NextResponse.json({ ...profile, emailVerified: emailVerifiedAt != null });
  } catch (error) {
    logger.error(errorFields(error), "Failed to fetch user");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
