/**
 * CQRS + Event-Driven çekirdek tipleri.
 *
 * - Command: sistemin DURUMUNU değiştirir (yazma). Tekil, intent-ifade eden adlar.
 * - Query: sistemin durumunu SADECE okur (okuma). Yan etkisiz.
 * - DomainEvent: gerçekleşmiş, değişmez geçmiş gerçeği (event sourcing / outbox).
 *
 * Tüm tipler agnostic'tir; bus'lar ve outbox bunları dağıtır.
 */

/** Dünyada atomik olarak gerçekleştirilen bir niyetli işlem (yazma). */
export interface Command<TPayload = unknown, TResult = unknown> {
  /** Eşsiz komut tipi, örn. "booking.create". */
  readonly type: string;
  readonly payload: TPayload;
  /** Komutun ait olduğu aggregate kök id (odaklı kilitleme / izleme). */
  readonly aggregateId?: string;
  /** Uçtan uca istek ilişkilendirme alanı. */
  readonly correlationId?: string;
  /** İstemi yapan kullanıcı id (yetki denetimleri için). */
  readonly issuer?: string;
  readonly issuedAt?: number;
}

/** Yan etkisiz, sadece okuma niyetli işlem. */
export interface Query<TPayload = unknown, TResult = unknown> {
  readonly type: string;
  readonly payload: TPayload;
  readonly correlationId?: string;
}

/** Gerçekleşmiş değişmez olay (outbox / event bus üzerinden yayınlanır). */
export interface DomainEvent<TPayload = never> {
  readonly type: string;
  readonly payload: TPayload;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly correlationId?: string;
  readonly occurredAt?: number;
}

/** Bir komutu işleyen domain handler. */
export interface CommandHandler<C extends Command = Command> {
  readonly handles: string;
  handle(command: C): Promise<unknown>;
}

/** Bir sorguyu işleyen read-model handler. */
export interface QueryHandler<Q extends Query = Query> {
  readonly handles: string;
  handle(query: Q): Promise<unknown>;
}

/** Bir olayı tüketen subscriber (idempotent olmalı). */
export interface EventHandler<E extends DomainEvent = DomainEvent> {
  readonly listens: string;
  handle(event: E): Promise<void>;
}

/** Bir korelasyonu tüm süreçte taşımak için bağlam. */
export interface CommandContext {
  readonly command: Command;
  readonly traceId: string;
}
