import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { ForbiddenError, toErrorResponse } from "@/lib/http/errors";
import { audit } from "@/lib/admin/audit";

/** Kullanıcı rolü değiştirme (ADMIN; kendi rolünü değiştiremez). Yeni rol en geç 15 dk'da yansır. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = await requireRole(req, ["ADMIN"]);
    const { role } = z.object({ role: z.enum(["USER", "HOST", "ADMIN"]) }).parse(await req.json());
    if (id === admin.userId) throw new ForbiddenError("Kendi rolünüzü değiştiremezsiniz");
    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, role: true },
    });
    await audit(admin.userId, "user.role", "User", id, { role });
    return NextResponse.json(user);
  } catch (error) {
    return toErrorResponse(error, "admin.users.role");
  }
}

export const dynamic = "force-dynamic";
