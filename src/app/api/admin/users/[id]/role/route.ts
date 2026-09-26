import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { ConflictError, ForbiddenError, NotFoundError, toErrorResponse } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";
import { audit } from "@/lib/admin/audit";
import { bumpTokenVersion, publishTokenVersion } from "@/lib/auth/token-version";

/**
 * Kullanıcı rolü değiştirme (ADMIN; kendi rolünü değiştiremez). Rol değişimi kullanıcının
 * tüm token'larını anında geçersizleştirir (tokenVersion++; eski rolle 15 dk yetki sızıntısı
 * yok — v3#5); yeni rol bir sonraki girişte/yenilemede token'a yazılır.
 *
 * Son ADMIN düşürülemez (v4#17): hedef ADMIN ise, kalan aktif ADMIN sayısı aynı
 * SERIALIZABLE işlem içinde, ADMIN satırları `FOR UPDATE` ile kilitlenerek sayılır;
 * iki yöneticinin eşzamanlı olarak birbirini düşürmesi sıfır yöneticiyle bitemez.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = await requireRole(req, ["ADMIN"]);
    const { role } = z.object({ role: z.enum(["USER", "HOST", "ADMIN"]) }).parse(await req.json());
    if (id === admin.userId) throw new ForbiddenError("Kendi rolünüzü değiştiremezsiniz");
    const { user, version } = await withSerializableRetry(async (tx) => {
      const current = await tx.user.findUnique({ where: { id }, select: { role: true } });
      if (!current) throw new NotFoundError("Kullanıcı bulunamadı");
      if (current.role === "ADMIN" && role !== "ADMIN") {
        const admins = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "User" WHERE role = 'ADMIN' AND "deletedAt" IS NULL FOR UPDATE`;
        if (!admins.some((a) => a.id !== id)) {
          throw new ConflictError("Son yönetici hesabının rolü düşürülemez", "LAST_ADMIN");
        }
      }
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
