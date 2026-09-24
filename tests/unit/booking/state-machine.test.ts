import { describe, it, expect } from "vitest";
import {
  allowedEvents,
  canTransition,
  InvalidTransitionError,
  transition,
  transitionTable,
  type BookingEvent,
  type BookingState,
} from "@/lib/booking/state-machine";

const STATES: BookingState[] = [
  "PENDING",
  "HELD",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
];
const EVENTS: BookingEvent[] = ["HOLD", "CONFIRM", "EXPIRE", "CANCEL", "COMPLETE"];

const EXPECTED: Record<string, BookingState | null> = {
  "PENDING:HOLD": "HELD",
  "PENDING:EXPIRE": "EXPIRED",
  "PENDING:CANCEL": "CANCELLED",
  "HELD:CONFIRM": "CONFIRMED",
  "HELD:EXPIRE": "EXPIRED",
  "HELD:CANCEL": "CANCELLED",
  "CONFIRMED:CANCEL": "CANCELLED",
  "CONFIRMED:COMPLETE": "COMPLETED",
};

describe("rezervasyon durum makinesi (P0-2)", () => {
  const cases = STATES.flatMap((s) => EVENTS.map((e) => [s, e] as const));

  it.each(cases)("%s --%s-->", (state, event) => {
    const expected = EXPECTED[`${state}:${event}`] ?? null;
    if (expected) {
      expect(transition(state, event)).toBe(expected);
      expect(canTransition(state, event)).toBe(true);
    } else {
      expect(() => transition(state, event)).toThrow(InvalidTransitionError);
      expect(canTransition(state, event)).toBe(false);
    }
  });

  it("terminal durumlardan çıkış yok", () => {
    for (const s of ["COMPLETED", "CANCELLED", "EXPIRED"] as const) {
      expect(allowedEvents(s)).toEqual([]);
    }
  });

  it("tablo beklenen 8 geçişi içerir", () => {
    expect(transitionTable()).toHaveLength(Object.keys(EXPECTED).length);
  });

  it("EXPIRED bir rezervasyon onaylanamaz (ödeme süresi geçti)", () => {
    expect(() => transition("EXPIRED", "CONFIRM")).toThrow(/Geçersiz durum geçişi/);
  });
});
