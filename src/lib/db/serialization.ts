import { Prisma } from "@prisma/client";

/**
 * Postgres serileştirme hatası mı (Prisma P2034 / SQLSTATE 40001)? Prisma istemci
 * örneğine bağımlı değildir; HTTP hata eşlemesi de kullanır.
 */
export function isSerializationFailure(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return true;
    const meta = error.meta as { code?: string } | undefined;
    if (meta?.code === "40001") return true;
  }
  const message = (error as Error)?.message ?? "";
  return /could not serialize access|40001/.test(message);
}
