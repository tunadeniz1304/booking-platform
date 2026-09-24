import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * SERIALIZABLE işlem + serileştirme hatasında (P2034 / 40001) sınırlı yeniden deneme.
 *
 * Postgres SERIALIZABLE yalıtımı çakışan işlemlerden birini iptal eder; doğru
 * davranış işlemi baştan tekrar etmektir. Deneme sayısı aşılırsa son hata fırlatılır.
 */
export async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { attempts?: number; maxWait?: number; timeout?: number } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: opts.maxWait ?? 5000,
        timeout: opts.timeout ?? 10000,
      });
    } catch (error) {
      lastError = error;
      if (!isSerializationFailure(error) || attempt === attempts) throw error;
      await new Promise((r) => setTimeout(r, 10 * attempt + Math.floor(Math.random() * 20)));
    }
  }
  throw lastError;
}

export function isSerializationFailure(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return true;
    const meta = error.meta as { code?: string } | undefined;
    if (meta?.code === "40001") return true;
  }
  const message = (error as Error)?.message ?? "";
  return /could not serialize access|40001/.test(message);
}
