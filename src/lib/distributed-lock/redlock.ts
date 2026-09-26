import { RedisClient } from "@/lib/redis";
import { randomUUID } from "crypto";

/**
 * Redlock stili dağıtık kilit (tek Redis bağlantısı; çoklu Redlock düğümü
 * gerektiren ortamda aynı mantık n düğüme uzanır).
 *
 * Garantiler:
 *  - Mutual exclusion: `SET key token NX PX ttl` atomik edinim.
 *  - Zombi koruması: fencing token monoton artar; geç kalan eski sahip DB'de
 *    reddedilir (stale write detection).
 *  - Güvenli teslim: Lua betiği yalnızca token eşleşen kilidi siler (A-B-A).
 *  - Kilit yenileme: uzun işlemler için TTL dokunularak uzatılır.
 */
export class LockError extends Error {
  constructor(message = "Distributed lock could not be acquired") {
    super(message);
    this.name = "LockError";
  }
}

/** Kilit edinildikten sonra sahibin elindeki bağlam. */
export interface LockHandle {
  readonly resource: string;
  readonly token: string;
  /** Monoton artan tırnak: DB yazımında "stale sahip" denetimi için. */
  readonly fencingToken: number;
  readonly ttlMs: number;
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const TOUCH_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export class Redlock {
  constructor(
    private readonly redis: RedisClient,
    private readonly defaults: {
      /** Kilit ömrü ms. */
      ttlMs?: number;
      /** Edinim deneme sayısı. */
      retryCount?: number;
      /** Denemeler arası taban bekleme ms (jitter ile). */
      retryDelayMs?: number;
    } = {}
  ) {}

  /**
   * Kaynağı kilitler. `waitMs` verilirse deneme sayısı yerine toplam bekleme bütçesi
   * (ms) uygulanır; bütçe ya da `retryCount` dolmadan edinilemezse LockError fırlatır.
   */
  async acquire(
    resource: string,
    ttlMs?: number,
    opts: { retryCount?: number; retryDelayMs?: number; waitMs?: number } = {}
  ): Promise<LockHandle> {
    const ttl = ttlMs ?? this.defaults.ttlMs ?? 30000;
    const retryCount = opts.retryCount ?? this.defaults.retryCount ?? 5;
    const retryDelayMs = opts.retryDelayMs ?? this.defaults.retryDelayMs ?? 100;

    const token = randomUUID();
    // Önceki bir SET istemci tarafında hata verdiyse (ör. komut zaman aşımı)
    // sunucuda yine de uygulanmış olabilir: anahtar bizim token'ımızla durur ve
    // sonraki NX denemeleri kendi kilidimize takılır. Bu durumda GET ile
    // sahipliği doğrulayıp kilidi edinilmiş sayarız.
    let uncertainSet = false;
    const deadline = opts.waitMs === undefined ? undefined : Date.now() + opts.waitMs;
    let attempts = 0;

    for (let attempt = 0; deadline !== undefined || attempt <= retryCount; attempt++) {
      attempts += 1;
      try {
        const ok = await this.redis.set(resource, token, { nx: true, ex: Math.ceil(ttl / 1000) });
        if (ok || (uncertainSet && (await this.redis.get(resource)) === token)) {
          const fencingToken = await this.nextFencingToken(resource);
          return { resource, token, fencingToken, ttlMs: ttl };
        }
      } catch {
        // deneme başarısız → jitter'lı bekle ve yeniden dene; SET sunucuda
        // uygulanmış olabileceği için sonraki turda sahiplik kontrolü yapılır
        uncertainSet = true;
      }
      // jitter'lı bekleme → thundering herd azalt
      const jitter = Math.floor(Math.random() * retryDelayMs);
      if (deadline !== undefined && Date.now() + retryDelayMs + jitter > deadline) break;
      await sleep(retryDelayMs + jitter);
    }

    throw new LockError(`Lock "${resource}" not acquired after ${attempts} attempts`);
  }

  /** Monoton fencing token üretir (Redis INCR — atomik). */
  private async nextFencingToken(resource: string): Promise<number> {
    return this.redis.incr(`${resource}:fence`);
  }

  /** Kilidi yalnızca token sahibiyse serbest bırakır (Lua ile atomik). */
  async release(handle: LockHandle): Promise<boolean> {
    const result = await this.redis.eval(RELEASE_SCRIPT, [handle.resource], [handle.token]);
    return Number(result) === 1;
  }

  /** Sahibiyse kilidin ömrünü uzatır. */
  async renew(handle: LockHandle, ttlMs?: number): Promise<boolean> {
    const ttl = ttlMs ?? handle.ttlMs;
    const result = await this.redis.eval(
      TOUCH_SCRIPT,
      [handle.resource],
      [handle.token, String(ttl)]
    );
    return Number(result) === 1;
  }

  /**
   * Yüksek seviye yardımcı: kilidi edin, `fn(handle)` çalıştır, kesin bırak.
   * İşlem sırasında kilit yenileme döngüsü de çalıştırılır (uzun işlemler için).
   */
  async withLock<T>(
    resource: string,
    fn: (handle: LockHandle) => Promise<T>,
    opts?: {
      ttlMs?: number;
      retryCount?: number;
      retryDelayMs?: number;
      waitMs?: number;
      renewEveryMs?: number;
    }
  ): Promise<T> {
    const handle = await this.acquire(resource, opts?.ttlMs, {
      retryCount: opts?.retryCount,
      retryDelayMs: opts?.retryDelayMs,
      waitMs: opts?.waitMs,
    });
    return this.runGuarded(handle, fn, opts?.renewEveryMs);
  }

  private async runGuarded<T>(
    handle: LockHandle,
    fn: (handle: LockHandle) => Promise<T>,
    renewEveryMs?: number
  ): Promise<T> {
    let renewTimer: NodeJS.Timeout | undefined;
    const renewInterval = renewEveryMs ?? handle.ttlMs / 3;

    try {
      renewTimer = setInterval(
        () => {
          this.renew(handle).catch(() => {
            // Yenilenemezse işlem TTL'de kendiliğinden çözülür; yarış yeniden başlar.
          });
        },
        Math.min(renewInterval, handle.ttlMs / 2)
      );

      return await fn(handle);
    } finally {
      clearInterval(renewTimer);
      try {
        await this.release(handle);
      } catch {
        // teslim başarısızlığında TTL ile otomatik çözülür
      }
    }
  }
}

/** Uygulama-çapı tek Redlock (yerel ioredis, üretim) — RedisClient üzerinden. */
export function createRedlock(redis: RedisClient): Redlock {
  return new Redlock(redis, { ttlMs: 15000, retryCount: 10, retryDelayMs: 50 });
}
