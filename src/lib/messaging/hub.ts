import type { Redis as IORedis } from "ioredis";
import { getRedisConnection, redis } from "@/lib/redis";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * Mesaj akışı dağıtımı (P1-6): kanal `msg:thread:<bookingId>`. Süreç başına tek
 * Redis aboneliği; aynı thread'i dinleyen SSE bağlantıları yerel dinleyici kümesinden
 * beslenir (bağlantı başına Redis bağlantısı açılmaz). Yalnızca maskeli gövde yayınlanır.
 */
const PREFIX = "msg:thread:";

export interface MessageEvent {
  id: string;
  senderId: string;
  senderRole: string;
  body: string;
  maskedKinds: string[];
  fromAiDraft: boolean;
  createdAt: string;
  /** P1-6 dolandırıcılık taraması: alıcıya uyarı bandı (yoksa null/eksik). */
  risk?: { level: "WARN" | "HIGH"; reasons: string[] } | null;
}

type Listener = (event: MessageEvent) => void;

const listeners = new Map<string, Set<Listener>>();
let subscriber: IORedis | null = null;

function getSubscriber(): IORedis {
  if (!subscriber) {
    subscriber = getRedisConnection().duplicate();
    subscriber.on("error", () => {});
    subscriber.on("message", (channel: string, raw: string) => {
      const set = listeners.get(channel.slice(PREFIX.length));
      if (!set) return;
      try {
        const event = JSON.parse(raw) as MessageEvent;
        for (const l of set) l(event);
      } catch {
        // bozuk mesaj yok sayılır
      }
    });
  }
  return subscriber;
}

export async function publishMessage(bookingId: string, event: MessageEvent): Promise<void> {
  try {
    await redis.publish(`${PREFIX}${bookingId}`, JSON.stringify(event));
  } catch (error) {
    // Canlı iletim en iyi çaba; mesaj DB'de kalıcıdır, istemci GET ile yakalar.
    logger.warn(errorFields(error), "message publish failed");
  }
}

/** Abone ol; dönen fonksiyon aboneliği bırakır. */
export function subscribeThread(bookingId: string, listener: Listener): () => void {
  let set = listeners.get(bookingId);
  if (!set) {
    set = new Set();
    listeners.set(bookingId, set);
    void getSubscriber()
      .subscribe(`${PREFIX}${bookingId}`)
      .catch(() => {});
  }
  set.add(listener);
  return () => {
    const current = listeners.get(bookingId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(bookingId);
      void getSubscriber()
        .unsubscribe(`${PREFIX}${bookingId}`)
        .catch(() => {});
    }
  };
}
