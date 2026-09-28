import type { Redlock } from "@/lib/distributed-lock/redlock";

/**
 * Sepet tutmasının kilit sırası (P1-1).
 *
 * Tek rezervasyonla AYNI anahtar (`booking:lock:room:<roomTypeId>`) kullanılır: tekil ve sepet
 * tutmaları aynı oda tipinde birbirini sıralar. Kilitler oda tipi kimliğine göre artan sırada
 * alınır — iki sepet ortak oda tiplerini hep aynı sırayla istediği için döngüsel bekleme
 * (deadlock) oluşamaz; tekrar eden oda tipi tek kez kilitlenir.
 */
export function roomLockKey(roomTypeId: string): string {
  return `booking:lock:room:${roomTypeId}`;
}

/** Tekrarsız, artan (kod noktası) sırada oda tipi kimlikleri. */
export function lockOrder(roomTypeIds: readonly string[]): string[] {
  return [...new Set(roomTypeIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface OrderedLockOptions {
  ttlMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  /** Kilit başına toplam bekleme bütçesi (ms); verilirse `retryCount` yerine geçer. */
  waitMs?: number;
  /** Beklerken true dönerse (ör. stok tükendi) bekleme `LockAbortedError` ile biter (v5 P1-8). */
  abortIf?: () => Promise<boolean>;
  abortCheckEveryMs?: number;
}

/**
 * Kilitleri `lockOrder` sırasıyla iç içe edinir ve `fn`'i hepsi tutulurken çalıştırır.
 * Her kilit `withLock` ile yenilenir ve (hata dahil) ters sırada bırakılır.
 */
export function withOrderedLocks<T>(
  redlock: Pick<Redlock, "withLock">,
  roomTypeIds: readonly string[],
  fn: () => Promise<T>,
  opts: OrderedLockOptions = {}
): Promise<T> {
  const keys = lockOrder(roomTypeIds).map(roomLockKey);
  const run = keys.reduceRight<() => Promise<T>>(
    (inner, key) => () => redlock.withLock(key, inner, opts),
    fn
  );
  return run();
}
