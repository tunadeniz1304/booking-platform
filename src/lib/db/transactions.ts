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
  opts: { attempts?: number; maxWait?: number; timeout?: number; label?: string } = {}
): Promise<T> {
  const { DB_SERIALIZABLE_RETRY_ATTEMPTS, DB_SERIALIZABLE_RETRY_BASE_MS } = getConfig();
  return retryLoop(fn, {
    ...opts,
    attempts: opts.attempts ?? DB_SERIALIZABLE_RETRY_ATTEMPTS,
    wait: (attempt) => backoffMs(attempt, DB_SERIALIZABLE_RETRY_BASE_MS),
  });
}

/**
 * fix-sweep-3: ödeme ONAY adımı (capture alındıktan sonraki pivot) için ayrı bütçe.
 *
 * P2-3 yük testinde tüm payları ödenmiş planların %64–74'ü, pivot işlemi global 6 denemede
 * tükendiği için iade ediliyordu. Burada deneme sayısı `CONFIRM_SERIALIZABLE_RETRY_ATTEMPTS`
 * (varsayılan 12) ve her bekleme `CONFIRM_RETRY_MAX_BACKOFF_MS` ile sınırlı → toplam bekleme
 * birkaç saniyeyi aşmaz. Global `withSerializableRetry` varsayılanı değişmez. Bütçe de
 * tükenirse serileştirme hatası fırlatılır; çağıran iade ETMEZ, onayı kuyruğa alır.
 * `label` yalnız test hata enjeksiyonu içindir (`injectSerializationFaultsForTests`).
 */
export async function withConfirmRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { label?: string; maxWait?: number; timeout?: number } = {}
): Promise<T> {
  const config = getConfig();
  return retryLoop(fn, {
    ...opts,
    attempts: config.CONFIRM_SERIALIZABLE_RETRY_ATTEMPTS,
    wait: (attempt) =>
      Math.min(
        backoffMs(attempt, config.DB_SERIALIZABLE_RETRY_BASE_MS),
        config.CONFIRM_RETRY_MAX_BACKOFF_MS
      ),
  });
}

/** Test amaçlı: `label` etiketli sonraki `n` işlem denemesi yapay serileştirme hatası verir. */
const serializationFaults = new Map<string, number>();
export function injectSerializationFaultsForTests(label: string, n: number): void {
  if (n <= 0) serializationFaults.delete(label);
  else serializationFaults.set(label, n);
}

function takeFault(label: string | undefined): boolean {
  if (!label) return false;
  const left = serializationFaults.get(label) ?? 0;
  if (left <= 0) return false;
  serializationFaults.set(label, left - 1);
  return true;
}

function fakeSerializationFailure(): Error {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock (injected)",
    { code: "P2034", clientVersion: "test" }
  );
}

async function retryLoop<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: {
    attempts: number;
    wait: (attempt: number) => number;
    label?: string;
    maxWait?: number;
    timeout?: number;
  }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      if (takeFault(opts.label)) throw fakeSerializationFailure();
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: opts.maxWait ?? 5000,
        timeout: opts.timeout ?? 10000,
      });
    } catch (error) {
      lastError = error;
      if (!isSerializationFailure(error) || attempt === opts.attempts) throw error;
      await new Promise((r) => setTimeout(r, opts.wait(attempt)));
    }
  }
  throw lastError;
}

/** n. başarısız denemeden sonraki bekleme: taban·2^(n−1) + [0, taban·2^(n−1)) rastgele. */
export function backoffMs(attempt: number, baseMs: number, random: () => number = Math.random) {
  const step = baseMs * 2 ** (attempt - 1);
  return step + Math.floor(random() * step);
}
