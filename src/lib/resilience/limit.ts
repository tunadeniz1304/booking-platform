/**
 * Küçük eşzamanlılık sınırlayıcı (`p-limit` eşdeğeri, bağımlılıksız).
 *
 * `createLimiter(n)` döndürdüğü fonksiyonla sarılan iş aynı anda en fazla `n` adet
 * çalışır; fazlası FIFO sırayla bekler. Hata fırlatan iş yuvayı serbest bırakır.
 *
 * Opsiyonel fail-closed sınırlar (v2-P0-5): `maxQueue` doluysa yeni iş hemen,
 * kuyrukta `queueTimeoutMs`'ten uzun bekleyen iş de kuyruktan çıkarılıp
 * `LimiterRejectedError` ile reddedilir; reddedilen işin `fn`'i hiç çağrılmaz.
 */
export interface Limiter {
  <T>(fn: () => Promise<T>): Promise<T>;
  /** Şu an çalışan iş sayısı. */
  readonly activeCount: number;
  /** Sırada bekleyen iş sayısı. */
  readonly pendingCount: number;
  /** Eşzamanlılık üst sınırı. */
  readonly concurrency: number;
}

export interface LimiterOptions {
  /** Kuyrukta bekleyebilecek azami iş; aşılırsa `queue_full` (varsayılan: sınırsız). */
  maxQueue?: number;
  /** Kuyrukta azami bekleme (ms); aşılırsa `queue_timeout` (varsayılan: yok). */
  queueTimeoutMs?: number;
}

export type LimiterRejectReason = "queue_full" | "queue_timeout";

export class LimiterRejectedError extends Error {
  constructor(readonly reason: LimiterRejectReason) {
    super(
      reason === "queue_full" ? "Eşzamanlılık kuyruğu dolu" : "Eşzamanlılık kuyruğunda zaman aşımı"
    );
    this.name = "LimiterRejectedError";
  }
}

interface Waiter {
  start: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

export function createLimiter(concurrency: number, options: LimiterOptions = {}): Limiter {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Eşzamanlılık sınırı pozitif tamsayı olmalı");
  }
  const { maxQueue = Infinity, queueTimeoutMs } = options;
  if (maxQueue !== Infinity && (!Number.isInteger(maxQueue) || maxQueue < 0)) {
    throw new RangeError("Kuyruk sınırı negatif olmayan tamsayı olmalı");
  }
  if (queueTimeoutMs !== undefined && !(queueTimeoutMs > 0)) {
    throw new RangeError("Kuyruk zaman aşımı pozitif olmalı");
  }
  let active = 0;
  const queue: Waiter[] = [];

  const next = (): void => {
    active -= 1;
    const waiter = queue.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.start();
    }
  };

  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = (): void => {
        active += 1;
        let result: Promise<T>;
        try {
          result = Promise.resolve(fn());
        } catch (error) {
          result = Promise.reject(error);
        }
        result.then(resolve, reject).finally(next);
      };
      if (active < concurrency) {
        start();
        return;
      }
      if (queue.length >= maxQueue) {
        reject(new LimiterRejectedError("queue_full"));
        return;
      }
      const waiter: Waiter = { start };
      if (queueTimeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          const index = queue.indexOf(waiter);
          if (index === -1) return;
          queue.splice(index, 1);
          reject(new LimiterRejectedError("queue_timeout"));
        }, queueTimeoutMs);
      }
      queue.push(waiter);
    });

  return Object.defineProperties(run, {
    activeCount: { get: () => active },
    pendingCount: { get: () => queue.length },
    concurrency: { value: concurrency },
  }) as Limiter;
}

/** `items` üzerinde en fazla `concurrency` eşzamanlı `fn` çalıştırır; sıra korunur. */
export function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = createLimiter(concurrency);
  return Promise.all(items.map((item, i) => limit(() => fn(item, i))));
}
