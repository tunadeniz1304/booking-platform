/**
 * Küçük eşzamanlılık sınırlayıcı (`p-limit` eşdeğeri, bağımlılıksız).
 *
 * `createLimiter(n)` döndürdüğü fonksiyonla sarılan iş aynı anda en fazla `n` adet
 * çalışır; fazlası FIFO sırayla bekler. Hata fırlatan iş yuvayı serbest bırakır.
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

export function createLimiter(concurrency: number): Limiter {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Eşzamanlılık sınırı pozitif tamsayı olmalı");
  }
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    active -= 1;
    const resume = queue.shift();
    if (resume) resume();
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
      if (active < concurrency) start();
      else queue.push(start);
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
