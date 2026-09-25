import { Redis as IORedis } from "ioredis";

/**
 * Uygulama-çapı Redis istemcisi (ioredis, tembel bağlantı).
 *
 * - Bağlantı modül import edildiğinde değil, ilk komutta açılır (testler ve
 *   build sırasında gereksiz bağlantı denemesi olmaz).
 * - Redis erişilemezse komutlar sınırlı denemeden sonra hata fırlatır; asılı
 *   kalmaz. Çağıranlar fail-open / fail-closed kararını kendisi verir.
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

const globalForRedis = globalThis as unknown as { __bookingRedis?: IORedis };

/** Ham ioredis bağlantısı (pub/sub veya pipeline gerekiyorsa). */
export function getRedisConnection(): IORedis {
  if (!globalForRedis.__bookingRedis) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    globalForRedis.__bookingRedis = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 2000,
      enableOfflineQueue: true,
    });
    // Bağlantı hataları komut düzeyinde ele alınır; burada yalnızca yutulur ki
    // "Unhandled error event" süreçleri düşürmesin.
    globalForRedis.__bookingRedis.on("error", () => {});
  }
  return globalForRedis.__bookingRedis;
}

function buildRedisClient(connection: () => IORedis = getRedisConnection): RedisClient {
  return {
    get: (key) => connection().get(key),
    mget: (keys) => (keys.length === 0 ? Promise.resolve([]) : connection().mget(...keys)),
    set: (key, value, opts) => {
      const c = connection();
      if (opts?.nx && opts.ex) return c.set(key, value, "EX", opts.ex, "NX");
      if (opts?.nx) return c.set(key, value, "NX");
      if (opts?.ex) return c.set(key, value, "EX", opts.ex);
      return c.set(key, value);
    },
    getdel: (key) => connection().getdel(key),
    del: (...keys) => (keys.length === 0 ? Promise.resolve(0) : connection().del(...keys)),
    ttl: (key) => connection().ttl(key),
    exists: (key) => connection().exists(key),
    incr: (key) => connection().incr(key),
    expire: (key, seconds) => connection().expire(key, seconds),
    incrWithTtl: async (key, seconds) =>
      Number(await connection().eval(INCR_WITH_TTL, 1, key, String(seconds))),
    eval: (script, keys, args) => connection().eval(script, keys.length, ...keys, ...args),
    sadd: (key, ...members) => connection().sadd(key, ...members),
    srem: (key, ...members) => connection().srem(key, ...members),
    smembers: (key) => connection().smembers(key),
    scard: (key) => connection().scard(key),
    lpush: (key, ...values) => connection().lpush(key, ...values),
    ltrim: (key, start, stop) => connection().ltrim(key, start, stop),
    lrange: (key, start, stop) => connection().lrange(key, start, stop),
    publish: (channel, message) => connection().publish(channel, message),
    ping: () => connection().ping(),
  };
}

export const redis: RedisClient = buildRedisClient();
