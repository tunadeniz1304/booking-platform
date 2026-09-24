/**
 * Rezervasyon durum makinesi — saf fonksiyon geçiş tablosu.
 *
 *   PENDING ──HOLD──▶ HELD ──CONFIRM──▶ CONFIRMED ──COMPLETE──▶ COMPLETED
 *      │               │                    │
 *      │               ├──EXPIRE──▶ EXPIRED │
 *      ├──EXPIRE──▶ EXPIRED                 │
 *      └──CANCEL──▶ CANCELLED ◀──CANCEL─────┴── (HELD de CANCEL ile)
 *
 * İzin verilmeyen her geçiş `InvalidTransitionError` fırlatır. Veritabanı
 * güncellemeleri bu fonksiyonla hesaplanan hedef durumu, mevcut durum ve
 * `version` koşuluyla (`updateMany where status+version`) yazar → eşzamanlı iki
 * geçişten yalnız biri kazanır.
 */

export type BookingState = "PENDING" | "HELD" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "EXPIRED";

export type BookingEvent = "HOLD" | "CONFIRM" | "EXPIRE" | "CANCEL" | "COMPLETE";

export const TERMINAL_STATES: ReadonlySet<BookingState> = new Set([
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
]);

/** Envanteri (Availability) tutan durumlar. */
export const INVENTORY_HOLDING_STATES: readonly BookingState[] = ["PENDING", "HELD", "CONFIRMED"];

const TRANSITIONS: Readonly<Record<BookingState, Partial<Record<BookingEvent, BookingState>>>> = {
  PENDING: { HOLD: "HELD", EXPIRE: "EXPIRED", CANCEL: "CANCELLED" },
  HELD: { CONFIRM: "CONFIRMED", EXPIRE: "EXPIRED", CANCEL: "CANCELLED" },
  CONFIRMED: { CANCEL: "CANCELLED", COMPLETE: "COMPLETED" },
  COMPLETED: {},
  CANCELLED: {},
  EXPIRED: {},
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: BookingState,
    readonly event: BookingEvent
  ) {
    super(`Geçersiz durum geçişi: ${from} --${event}-->`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: BookingState, event: BookingEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

export function transition(from: BookingState, event: BookingEvent): BookingState {
  const to = TRANSITIONS[from][event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

/** Bir durumdan izinli olaylar (UI butonları ve dokümantasyon için). */
export function allowedEvents(from: BookingState): BookingEvent[] {
  return Object.keys(TRANSITIONS[from]) as BookingEvent[];
}

/** Tüm tablo (dokümantasyon/test). */
export function transitionTable(): ReadonlyArray<{
  from: BookingState;
  event: BookingEvent;
  to: BookingState;
}> {
  return (Object.keys(TRANSITIONS) as BookingState[]).flatMap((from) =>
    (Object.entries(TRANSITIONS[from]) as Array<[BookingEvent, BookingState]>).map(
      ([event, to]) => ({ from, event, to })
    )
  );
}
