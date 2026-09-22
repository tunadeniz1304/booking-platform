import { Redis as IORedis } from "ioredis";
import { Redis as UpstashRedis } from "@upstash/redis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const useIoRedis = redisUrl.startsWith("redis://");

const ioredisClient = useIoRedis
  ? new IORedis(redisUrl, { maxRetriesPerRequest: null })
  : null;
const upstashClient = !useIoRedis
  ? new UpstashRedis({ url: redisUrl, token: process.env.REDIS_TOKEN || "" })
  : null;

/**
 * İki istemciyi (ioredis / Upstash) tek bir tip-uyumlu arayüz altında birleştirir.
 * Servisler yalnızca bu arayüzü kullanır; hangi istemcinin aktif olduğunu
 * arayüz uygular. Böylece ioredis+Upstash API farkları servis koduna sızmaz.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  ttl(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  llen(key: string): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
  rpush(key: string, ...values: string[]): Promise<number>;
  lpop(key: string): Promise<string | null>;
}

export function buildRedisClient(): RedisClient {
  if (useIoRedis && ioredisClient) {
    const c = ioredisClient;
    return {
      get: (key) => c.get(key),
      set: (key, value, opts) => {
        if (!opts) return c.set(key, value);
        if (opts.nx && opts.ex) return c.set(key, value, "EX", opts.ex, "NX");
        if (opts.ex) return c.set(key, value, "EX", opts.ex);
        return c.set(key, value);
      },
      del: (...keys) => c.del(...keys),
      keys: (pattern) => c.keys(pattern),
      ttl: (key) => c.ttl(key),
      exists: (key) => c.exists(key),
      llen: (key) => c.llen(key),
      lpush: (key, ...values) => c.lpush(key, ...values),
      rpush: (key, ...values) => c.rpush(key, ...values),
      lpop: (key) => c.lpop(key),
    };
  }

  if (upstashClient) {
    const c = upstashClient;
    return {
      get: (key) => c.get<string>(key),
      set: (key, value, opts) => {
        if (opts?.nx) {
          return c.set(key, value, { ex: opts.ex ?? 0, nx: true });
        }
        if (opts?.ex !== undefined) {
          return c.set(key, value, { ex: opts.ex });
        }
        return c.set(key, value);
      },
      del: (...keys) => c.del(...keys),
      keys: (pattern) => c.keys(pattern),
      ttl: (key) => c.ttl(key),
      exists: (key) =>
        c.exists(key).then((v) => (typeof v === "number" ? v : v ? 1 : 0)),
      llen: (key) => c.llen(key),
      lpush: (key, ...values) => c.lpush(key, ...values),
      rpush: (key, ...values) => c.rpush(key, ...values),
      lpop: (key) => c.lpop(key),
    };
  }

  throw new Error("Redis client could not be initialized");
}

export const redis: RedisClient = buildRedisClient();
