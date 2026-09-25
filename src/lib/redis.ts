import { Redis as IORedis } from "ioredis";
import { getConfig } from "@/lib/config/app-config";

/**
 * Uygulama-çapı Redis istemcisi (ioredis, tembel bağlantı).
 *
 * - Bağlantı modül import edildiğinde değil, ilk komutta açılır (testler ve
 *   build sırasında gereksiz bağlantı denemesi olmaz).
 * - Redis erişilemezse komutlar sınırlı denemeden sonra hata fırlatır; asılı
 *   kalmaz. Çağıranlar fail-open / fail-closed kararını kendisi verir.
 * - Bağlantı bir kez hazır olduktan sonra koparsa komutlar yeniden bağlanmayı
 *   BEKLEMEZ, hemen reddedilir (fail-fast); her komut ayrıca REDIS_COMMAND_TIMEOUT_MS
 *   ile sınırlıdır. Kaos deneyi: Redis durdurulunca fail-open arama bu olmadan
 *   ~33 sn sürüyordu (load/chaos.md).
 * - BullMQ kendi bağlantısını kullanır (`maxRetriesPerRequest: null` gerektirir).
 *
 * Servisler yalnızca `RedisClient` arayüzünü kullanır; testlerde sahte
 * uygulamayla değiştirilebilir.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  /** Çoklu okuma (sıra korunur; olmayan anahtar null). */
  mget(keys: string[]): Promise<Array<string | null>>;
  set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<string | null>;
  /** Değeri okuyup atomik olarak siler (Redis ≥ 6.2 GETDEL). */
  getdel(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  ttl(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  /** Tek komutta INCR + (yeni anahtarsa) EXPIRE — sabit pencere sayacı. */
  incrWithTtl(key: string, seconds: number): Promise<number>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  scard(key: string): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<string>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  publish(channel: string, message: string): Promise<number>;
  ping(): Promise<string>;
}

const INCR_WITH_TTL = `
local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v`;

const globalForRedis = globalThis as unknown as {
  __bookingRedis?: IORedis;
  __bookingRedisEverReady?: boolean;
};

/** Redis erişilemez (komut gönderilmeden reddedildi). */
export class RedisUnavailableError extends Error {
  constructor(status: string) {
    super(`Redis bağlantısı yok (durum: ${status})`);
    this.name = "RedisUnavailableError";
  }
}

/**
 * Komut beklemeden reddedilmeli mi? Yalnızca bağlantı daha önce hazır olmuşsa ve şu an
 * hazır değilse: ilk (tembel) bağlantı sırasında komutlar kuyrukta bekler.
 */
export function shouldFailFast(status: string, everReady: boolean): boolean {
  return everReady && status !== "ready";
}

/** Ham ioredis bağlantısı (pub/sub veya pipeline gerekiyorsa). */
export function getRedisConnection(): IORedis {
  if (!globalForRedis.__bookingRedis) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    globalForRedis.__bookingRedis = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 2000,
      commandTimeout: getConfig().REDIS_COMMAND_TIMEOUT_MS,
      enableOfflineQueue: true,
    });
    globalForRedis.__bookingRedis.on("ready", () => {
      globalForRedis.__bookingRedisEverReady = true;
    });
    // Bağlantı hataları komut düzeyinde ele alınır; burada yalnızca yutulur ki
    // "Unhandled error event" süreçleri düşürmesin.
    globalForRedis.__bookingRedis.on("error", () => {});
  }
  return globalForRedis.__bookingRedis;
}

function buildRedisClient(connection: () => IORedis = getRedisConnection): RedisClient {
  const run = <T>(command: (c: IORedis) => Promise<T>): Promise<T> => {
    const c = connection();
    if (shouldFailFast(c.status, globalForRedis.__bookingRedisEverReady === true)) {
      return Promise.reject(new RedisUnavailableError(c.status));
    }
    return command(c);
  };
  return {
    get: (key) => run((c) => c.get(key)),
    mget: (keys) => (keys.length === 0 ? Promise.resolve([]) : run((c) => c.mget(...keys))),
    set: (key, value, opts) =>
      run((c) => {
        if (opts?.nx && opts.ex) return c.set(key, value, "EX", opts.ex, "NX");
        if (opts?.nx) return c.set(key, value, "NX");
        if (opts?.ex) return c.set(key, value, "EX", opts.ex);
        return c.set(key, value);
      }),
    getdel: (key) => run((c) => c.getdel(key)),
    del: (...keys) => (keys.length === 0 ? Promise.resolve(0) : run((c) => c.del(...keys))),
    ttl: (key) => run((c) => c.ttl(key)),
    exists: (key) => run((c) => c.exists(key)),
    incr: (key) => run((c) => c.incr(key)),
    expire: (key, seconds) => run((c) => c.expire(key, seconds)),
    incrWithTtl: async (key, seconds) =>
      Number(await run((c) => c.eval(INCR_WITH_TTL, 1, key, String(seconds)))),
    eval: (script, keys, args) => run((c) => c.eval(script, keys.length, ...keys, ...args)),
    sadd: (key, ...members) => run((c) => c.sadd(key, ...members)),
    srem: (key, ...members) => run((c) => c.srem(key, ...members)),
    smembers: (key) => run((c) => c.smembers(key)),
    scard: (key) => run((c) => c.scard(key)),
    lpush: (key, ...values) => run((c) => c.lpush(key, ...values)),
    ltrim: (key, start, stop) => run((c) => c.ltrim(key, start, stop)),
    lrange: (key, start, stop) => run((c) => c.lrange(key, start, stop)),
    publish: (channel, message) => run((c) => c.publish(channel, message)),
    ping: () => run((c) => c.ping()),
  };
}

export const redis: RedisClient = buildRedisClient();
