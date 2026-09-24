import { randomUUID } from "crypto";
import type { Redis as IORedis } from "ioredis";
import { getRedisConnection, redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { logger, errorFields } from "@/lib/observability/logger";
import { getRoomHeat, type RoomHeat } from "./stats";

/**
 * Canlı ısı haritası dağıtımı (hata #11).
 *
 *  - Aynı (oda, aralık) için süreç başına TEK abone listesi; bağlantı başına DB sorgusu yok.
 *  - Kümede tek poller: Redis `SET NX PX` ile anahtar başına lider seçilir; lider
 *    ısıyı hesaplar ve `live:heat:<key>` kanalına yayınlar; tüm örnekler kanala abone
 *    olup kendi SSE bağlantılarına dağıtır (pub/sub fan-out).
 *  - IP başına eşzamanlı bağlantı sınırı: `live:conn:<ip>` sayacı (açılışta INCR,
 *    kapanışta DECR, güvenlik TTL'i).
 */

type Listener = (heat: RoomHeat) => void;

interface Channel {
  listeners: Set<Listener>;
  timer: NodeJS.Timeout;
}

const instanceId = randomUUID();
const channels = new Map<string, Channel>();
let subscriber: IORedis | null = null;

function channelName(key: string): string {
  return `live:heat:${key}`;
}

function getSubscriber(): IORedis {
  if (!subscriber) {
    subscriber = getRedisConnection().duplicate();
    subscriber.on("error", () => {});
    subscriber.on("message", (channel: string, message: string) => {
      const key = channel.slice("live:heat:".length);
      const ch = channels.get(key);
      if (!ch) return;
      try {
        const heat = JSON.parse(message) as RoomHeat;
        for (const l of ch.listeners) l(heat);
      } catch {
        // bozuk mesaj yok sayılır
      }
    });
  }
  return subscriber;
}

async function tick(key: string, roomId: string, start: string, end: string): Promise<void> {
  const interval = getConfig().LIVE_POLL_INTERVAL_MS;
  try {
    const lead = await redis.eval(
      `local v = redis.call('GET', KEYS[1])
       if (not v) or v == ARGV[1] then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1 end
       return 0`,
      [`live:poller:${key}`],
      [instanceId, String(interval * 2)]
    );
    if (Number(lead) !== 1) return;
    const heat = await getRoomHeat(roomId, start, end);
    if (heat) await redis.publish(channelName(key), JSON.stringify(heat));
  } catch (error) {
    logger.warn(errorFields(error), "live heat tick failed");
  }
}

/** Abone ol; dönen fonksiyon aboneliği bırakır (son abone ayrılınca poller durur). */
export function subscribeHeat(
  roomId: string,
  start: string,
  end: string,
  listener: Listener
): () => void {
  const key = `${roomId}:${start}:${end}`;
  let ch = channels.get(key);
  if (!ch) {
    const interval = getConfig().LIVE_POLL_INTERVAL_MS;
    ch = {
      listeners: new Set(),
      timer: setInterval(() => void tick(key, roomId, start, end), interval),
    };
    channels.set(key, ch);
    void getSubscriber()
      .subscribe(channelName(key))
      .catch(() => {});
  }
  ch.listeners.add(listener);
  return () => {
    const current = channels.get(key);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      clearInterval(current.timer);
      channels.delete(key);
      void getSubscriber()
        .unsubscribe(channelName(key))
        .catch(() => {});
    }
  };
}

/** Süreçteki aktif poller sayısı (test/metrik). */
export function activeChannelCount(): number {
  return channels.size;
}

/** IP başına bağlantı yuvası alır; sınır aşılırsa `null`. Dönen fonksiyon yuvayı bırakır. */
export async function acquireConnectionSlot(ip: string): Promise<(() => Promise<void>) | null> {
  const key = `live:conn:${ip}`;
  const count = await redis.incrWithTtl(key, 3600);
  if (count > getConfig().LIVE_MAX_CONNECTIONS_PER_IP) {
    await redis.eval("return redis.call('DECR', KEYS[1])", [key], []).catch(() => 0);
    return null;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await redis.eval("return redis.call('DECR', KEYS[1])", [key], []).catch(() => 0);
  };
}
