import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { ForbiddenError, toErrorResponse } from "@/lib/http/errors";
import { audit } from "@/lib/admin/audit";
import { bumpTokenVersion, publishTokenVersion } from "@/lib/auth/token-version";

/**
 * Kullanıcı rolü değiştirme (ADMIN; kendi rolünü değiştiremez). Rol değişimi kullanıcının
 * tüm token'larını anında geçersizleştirir (tokenVersion++; eski rolle 15 dk yetki sızıntısı
 * yok — v3#5); yeni rol bir sonraki girişte/yenilemede token'a yazılır.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = await requireRole(req, ["ADMIN"]);
    const { role } = z.object({ role: z.enum(["USER", "HOST", "ADMIN"]) }).parse(await req.json());
    if (id === admin.userId) throw new ForbiddenError("Kendi rolünüzü değiştiremezsiniz");
    const { user, version } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { role },
        select: { id: true, role: true },
      });
      return { user, version: await bumpTokenVersion(id, tx) };
    });
    await publishTokenVersion(id, version);
    await audit(admin.userId, "user.role", "User", id, { role });
    return NextResponse.json(user);
  } catch (error) {
    return toErrorResponse(error, "admin.users.role");
  }
}

export const dynamic = "force-dynamic";
