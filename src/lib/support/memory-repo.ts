import type { BookingView, NewSupportTicket, PropertyView, SupportRepo } from "./repo";

/**
 * Bellek-içi `SupportRepo` — birim testleri ve `npm run llm:eval` (demo, ağsız/DB'siz)
 * için. Üretimde kullanılmaz.
 */
export interface MemorySupportRepo extends SupportRepo {
  tickets: Array<NewSupportTicket & { id: string }>;
}

export function createMemorySupportRepo(
  bookings: readonly BookingView[],
  properties: readonly PropertyView[] = []
): MemorySupportRepo {
  const tickets: MemorySupportRepo["tickets"] = [];
  return {
    tickets,
    async findBookingForUser(userId, bookingId) {
      const own = bookings.filter((b) => b.userId === userId);
      if (bookingId) return own.find((b) => b.id === bookingId) ?? null;
      return [...own].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime())[0] ?? null;
    },
    async findProperty(propertyId) {
      return (
        properties.find((p) => p.id === propertyId) ??
        bookings.find((b) => b.property.id === propertyId)?.property ??
        null
      );
    },
    async createTicket(input) {
      const id = `tkt_${String(tickets.length + 1).padStart(4, "0")}`;
      tickets.push({ ...input, id });
      return { id };
    },
  };
}

/** Deterministik örnek: MODERATE politikalı, ödenmiş bir rezervasyon. */
export function sampleSupportBooking(overrides: Partial<BookingView> = {}): BookingView {
  return {
    id: "bk_demo1",
    userId: "u_guest",
    status: "CONFIRMED",
    checkIn: new Date("2026-11-20T00:00:00Z"),
    checkOut: new Date("2026-11-23T00:00:00Z"),
    guestCount: 2,
    totalPriceMinor: 900_000,
    currency: "TRY",
    createdAt: new Date("2026-09-01T10:00:00Z"),
    policySnapshot: {
      kind: "MODERATE",
      version: 1,
      rules: {
        tiers: [
          { hoursBefore: 120, refundPercent: 100 },
          { hoursBefore: 24, refundPercent: 50 },
          { hoursBefore: 0, refundPercent: 0 },
        ],
      },
    },
    paidMinor: 900_000,
    property: {
      id: "pr_demo1",
      title: "Moda Sahil Evi",
      timeZone: "Europe/Istanbul",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      policy: null,
    },
    ...overrides,
  };
}
