import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Yönetici eylemini denetim kaydına yazar (P2-4). */
export async function audit(
  actorId: string,
  action: string,
  entity: string,
  entityId?: string,
  meta?: Record<string, unknown>
): Promise<void> {
  await prisma.auditLog.create({
    data: { actorId, action, entity, entityId, meta: meta as Prisma.InputJsonValue | undefined },
  });
}
