import { Prisma } from "@prisma/client";
import { getConfig } from "@/lib/config/app-config";
import { isSerializationFailure } from "@/lib/db/serialization";
import { prisma } from "@/lib/prisma";

export { isSerializationFailure };

/**
 * SERIALIZABLE işlem + serileştirme hatasında (P2034 / 40001) sınırlı yeniden deneme.
 *
 * Postgres SERIALIZABLE yalıtımı çakışan işlemlerden birini iptal eder; doğru
 * davranış işlemi baştan tekrar etmektir. Deneme sayısı aşılırsa son hata fırlatılır
 * (HTTP katmanı bunu 409 TRANSACTION_CONFLICT'e çevirir, bkz. `toErrorResponse`).
 *
 * Geri çekilme üsteldir ve rastgele pay içerir: aynı satırlara çarpan eşzamanlı işlemler
 * (ör. aynı oda-gece envanteri için yarışan ödeme onayları) aynı anda yeniden denenip
 * tekrar çakışmasın. k6 payment-race: 3 deneme + sabit kısa bekleme 18 onaydan 4'ünü 500'e
 * düşürüyordu (docs/perf/k6-results.md).
 */
export async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { attempts?: number; maxWait?: number; timeout?: number } = {}
): Promise<T> {
  const { DB_SERIALIZABLE_RETRY_ATTEMPTS, DB_SERIALIZABLE_RETRY_BASE_MS } = getConfig();
  const attempts = opts.attempts ?? DB_SERIALIZABLE_RETRY_ATTEMPTS;
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
      await new Promise((r) => setTimeout(r, backoffMs(attempt, DB_SERIALIZABLE_RETRY_BASE_MS)));
    }
  }
  throw lastError;
}

/** n. başarısız denemeden sonraki bekleme: taban·2^(n−1) + [0, taban·2^(n−1)) rastgele. */
export function backoffMs(attempt: number, baseMs: number, random: () => number = Math.random) {
  const step = baseMs * 2 ** (attempt - 1);
  return step + Math.floor(random() * step);
}
