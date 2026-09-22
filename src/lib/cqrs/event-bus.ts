import { DomainEvent, EventHandler } from "./types";

/**
 * Event Bus: aggregate'ten fışkıran değişmez olayları subscriber'lara dağıtır.
 *
 * Teslimat:
 *  - Yerleşik (in-process): aynı süreçteki subscriber'lar sırayla await edilir.
 *  - Redis köprüsü (opsiyonel): ioredis Publish/Subscribe üzerinden diğer
 *    Node işlemleri (işçiler / çoklu instance) de aynı olayları alır.
 *
 * Subscriber'lar IDEMPOTENT olmalıdır: outbox al-mı-ver at-least-once
 * garantisi verdiğinden aynı olay birden çok kez işlenebilir.
 */

export class EventBus {
  private readonly subscribers = new Map<string, Set<EventHandler>>();
  private redis: {
    publish(channel: string, message: string): Promise<void>;
    subscribe(channel: string): Promise<void>;
    onMessage(handler: (channel: string, message: string) => void): void;
  } | null = null;

  /** Redis köprüsünü etkinleştir. ioredis tabanlı bir bağlantı verilmelidir. */
  connect(redis: EventBus["redis"]): void {
    if (this.redis === redis) return;
    this.redis = redis;
    const r = redis;
    if (!r) return;
    // İlgili kanallara abone ol: olaylar "event:<type>" kanalından gelir.
    for (const type of this.subscribers.keys()) {
      void r.subscribe(`event:${type}`);
    }
    r.onMessage((channel, message) => {
      if (!channel.startsWith("event:")) return;
      try {
        const event = JSON.parse(message) as DomainEvent;
        void this.deliverLocal(event);
      } catch {
        // bozuk mesaj yoksayılır
      }
    });
  }

  on(handler: EventHandler): void {
    let set = this.subscribers.get(handler.listens);
    if (!set) {
      set = new Set();
      this.subscribers.set(handler.listens, set);
      if (this.redis) {
        void this.redis.subscribe(`event:${handler.listens}`);
      }
    }
    set.add(handler);
  }

  off(handler: EventHandler): void {
    const set = this.subscribers.get(handler.listens);
    if (set) set.delete(handler);
  }

  /** Yerleşik teslimat + Redis köprüsüne yayın. */
  async publish(event: DomainEvent): Promise<void> {
    const normalized: DomainEvent = {
      ...event,
      occurredAt: event.occurredAt ?? Date.now(),
    };

    await this.deliverLocal(normalized);

    if (this.redis) {
      try {
        await this.redis.publish(`event:${normalized.type}`, JSON.stringify(normalized));
      } catch (error) {
        console.error("Event bus redis publish failed:", error);
      }
    }
  }

  subscriberCount(type: string): number {
    return this.subscribers.get(type)?.size ?? 0;
  }

  private async deliverLocal(event: DomainEvent): Promise<void> {
    const set = this.subscribers.get(event.type);
    if (!set || set.size === 0) return;

    // Eşzamanlı teslim: subscriber hatası diğerlerini ve çağıranı engellememeli.
    await Promise.allSettled(
      [...set].map((handler) =>
        handler.handle(event).catch((error) => {
          console.error(`Event handler ${handler.listens} failed:`, error);
        })
      )
    );
  }
}

/** Uygulama-çapı tek olay bus'ı. */
export const eventBus = new EventBus();
