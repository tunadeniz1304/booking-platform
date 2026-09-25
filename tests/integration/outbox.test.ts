// Transactional Outbox: booking.created olayı işlem+outbox ile atomik yazılır,
// relay edilir ve eventBus abonesine teslim edilir; tekrar relay edilmez.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { createBooking } from "@/lib/booking-service";
import { relayOutbox } from "@/lib/cqrs";
import { eventBus } from "@/lib/cqrs";
import { EventTypes, BookingCreatedPayload } from "@/lib/events/events";
import { DomainEvent } from "@/lib/cqrs/types";
import { describeInt } from "./helpers";

describeInt("outbox (integration)", () => {
  const prisma = new PrismaClient();

  let user: { id: string };
  let host: { id: string };
  let property: { id: string };
  let room: { id: string };
  let bookingId = "";

  function todayUtcMidnight(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }
  function pad(n: number): string {
    return n < 10 ? `0${n}` : String(n);
  }
  function iso(date: Date): string {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  beforeAll(async () => {
    user = await prisma.user.create({
      data: {
        email: `outbox-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "T",
        lastName: "U",
      },
    });
    host = await prisma.user.create({
      data: {
        email: `outbox-host-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "T",
        lastName: "H",
        role: "HOST",
      },
    });
    const location = await prisma.location.create({
      data: { city: `OutboxCity-${Date.now()}`, country: "TEST" },
    });
    property = await prisma.property.create({
      data: {
        hostId: host.id,
        title: "Outbox Test Oteli",
        description: "outbox test",
        propertyType: "HOTEL",
        locationId: location.id,
        basePrice: new Prisma.Decimal(900),
        currency: "TRY",
        isActive: true,
      },
    });
    room = await prisma.roomType.create({
      data: {
        propertyId: property.id,
        name: "Outbox Oda",
        maxOccupancy: 2,
        bedType: "Çift Kişilik",
        priceModifier: new Prisma.Decimal(0),
        available: true,
        ratePlans: { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] },
      },
    });
    const d1 = addDays(todayUtcMidnight(), 8);
    const d2 = addDays(d1, 1);
    await prisma.inventoryDay.createMany({
      data: [d1, d2].map((d) => ({
        roomTypeId: room.id,
        date: d,
        total: 1,
        price: new Prisma.Decimal(900),
      })),
    });
  });

  afterAll(async () => {
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: bookingId } });
    await prisma.inventoryDay.deleteMany({ where: { roomTypeId: room.id } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.ratePlan.deleteMany({ where: { roomTypeId: room.id } });
    await prisma.roomType.deleteMany({ where: { id: room.id } });
    await prisma.property.deleteMany({ where: { id: property.id } });
    const locs = await prisma.location.findMany({
      where: { city: { startsWith: "OutboxCity-" } },
      select: { id: true },
    });
    await prisma.location.deleteMany({ where: { city: { startsWith: "OutboxCity-" } } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, host.id] } } });
    void locs;
    await prisma.$disconnect();
  });

  describe("Transactional Outbox — booking.created", () => {
    it("rezervasyon sonrası outbox mesajı DONE olur ve aboneye teslim edilir", async () => {
      const received: BookingCreatedPayload[] = [];
      const subscriber = {
        listens: EventTypes.BookingCreated,
        handle: async (event: DomainEvent<unknown>) => {
          received.push(event.payload as BookingCreatedPayload);
        },
      };
      eventBus.on(subscriber);
      try {
        const booking = await createBooking({
          userId: user.id,
          propertyId: property.id,
          roomId: room.id,
          checkIn: iso(addDays(todayUtcMidnight(), 8)),
          checkOut: iso(addDays(todayUtcMidnight(), 10)),
          guestCount: 1,
        });
        bookingId = booking.booking.id;
        const mine = (): BookingCreatedPayload[] =>
          received.filter((p) => p.bookingId === bookingId);

        // Olay henüz relay edilmedi → subscriber'a gelmemeli
        expect(mine().length).toBe(0);

        const outboxRow = await prisma.outboxMessage.findFirst({
          where: { aggregateId: booking.booking.id },
        });
        expect(outboxRow).not.toBeNull();
        expect(outboxRow?.eventType).toBe(EventTypes.BookingCreated);
        expect(outboxRow?.status).toBe("PENDING");

        // Relay → DONE + aboneye teslim
        const published = await relayOutbox();
        expect(published).toBeGreaterThanOrEqual(1);

        const after = await prisma.outboxMessage.findFirst({
          where: { aggregateId: booking.booking.id },
        });
        expect(after?.status).toBe("DONE");
        expect(mine().length).toBe(1);
        expect(mine()[0].bookingId).toBe(booking.booking.id);

        // İkinci relay bu mesajı yeniden yayınlamaz (at-least-once → DONE atlanır)
        const beforeSecond = mine().length;
        await relayOutbox();
        expect(mine().length).toBe(beforeSecond);
      } finally {
        eventBus.off(subscriber);
      }
    }, 30000);
  });
});
