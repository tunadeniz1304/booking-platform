import { it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { bulkUpdateAvailability, updateProperty } from "@/lib/host/host-service";
import { applyAriMessage, exportRoomCalendar, importCalendar } from "@/lib/channel/channel";
import { deleteAccount, exportUserData } from "@/lib/privacy/privacy-service";
import type { AccessClaims } from "@/lib/auth";

const claims = (userId: string, role: AccessClaims["role"]): AccessClaims => ({
  userId,
  role,
  jti: "j",
  exp: 0,
  tv: 0,
});

describeInt("F7 host / kanal / KVKK (integration)", () => {
  it("host yalnızca kendi mülkü; ARI rezervasyonlu geceyi ezmez; kanal idempotent; iCal; KVKK", async () => {
    const prisma = new PrismaClient();
    const stamp = Date.now();
    const host = await prisma.user.create({
      data: {
        email: `h-${stamp}@t.test`,
        passwordHash: "gizli-hash",
        firstName: "H",
        lastName: "O",
        role: "HOST",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: `o-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "O",
        lastName: "T",
        role: "HOST",
      },
    });
    const loc = await prisma.location.create({
      data: { city: `HostCity-${stamp}`, country: "TEST" },
    });
    const p = await prisma.property.create({
      data: {
        hostId: host.id,
        title: "Host",
        description: "host test",
        propertyType: "HOTEL",
        locationId: loc.id,
        basePrice: new Prisma.Decimal(800),
        isActive: false,
      },
    });
    const room = await prisma.room.create({
      data: { propertyId: p.id, name: "O", capacity: 2, bedType: "Ç" },
    });
    await prisma.availability.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        roomId: room.id,
        date: utcDay(i + 1),
        price: new Prisma.Decimal(800),
      })),
    });
    await prisma.availability.update({
      where: { roomId_date: { roomId: room.id, date: utcDay(5) } },
      data: { isAvailable: false, lockedBy: "booking-x" },
    });

    // IDOR: başka host 404; belge yoksa yayınlanamaz
    await expect(
      updateProperty(claims(other.id, "HOST"), p.id, { title: "Ele geçir" })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateProperty(claims(host.id, "HOST"), p.id, { isActive: true })
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (
        await updateProperty(claims(host.id, "HOST"), p.id, {
          isActive: true,
          licenseNumber: "34-12345",
        })
      ).isActive
    ).toBe(true);

    const r = await bulkUpdateAvailability(claims(host.id, "HOST"), room.id, {
      from: iso(utcDay(1)),
      to: iso(utcDay(10)),
      price: 999,
    });
    expect(r.skippedLocked).toBe(1);
    const lockedNight = await prisma.availability.findUniqueOrThrow({
      where: { roomId_date: { roomId: room.id, date: utcDay(5) } },
    });
    expect(Number(lockedNight.price)).toBe(800);
    expect(lockedNight.lockedBy).toBe("booking-x");

    // ARI: aynı mesaj iki kez → tek etki; eski sıra reddedilir
    const msg = {
      roomId: room.id,
      sequence: 7,
      idempotencyKey: "ari-1",
      updates: [{ date: iso(utcDay(12)), price: 1234 }],
    };
    expect((await applyAriMessage(msg)).status).toBe("applied");
    expect((await applyAriMessage(msg)).status).toBe("duplicate");
    await expect(
      applyAriMessage({ ...msg, idempotencyKey: "ari-0", sequence: 6 })
    ).rejects.toMatchObject({ code: "STALE_SEQUENCE" });

    // iCal gidiş-dönüş: dışa aktarılan dolu gece başka odaya içe aktarılınca bloklanır
    const ics = await exportRoomCalendar(room.id);
    expect(ics).toContain("BEGIN:VCALENDAR");
    const room2 = await prisma.room.create({
      data: { propertyId: p.id, name: "O2", capacity: 2, bedType: "Ç" },
    });
    await prisma.availability.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        roomId: room2.id,
        date: utcDay(i + 1),
        price: new Prisma.Decimal(800),
      })),
    });
    const imported = await importCalendar(room2.id, ics, "ota-x");
    expect(imported.blocked).toBe(1);
    expect(
      (
        await prisma.availability.findUniqueOrThrow({
          where: { roomId_date: { roomId: room2.id, date: utcDay(5) } },
        })
      ).lockedBy
    ).toBe("ical:ota-x");

    // KVKK: dışa aktarımda parola özeti yok; silme sonrası kişisel alanlar pseudonim
    const exported = JSON.stringify(await exportUserData(host.id));
    expect(exported).not.toContain("passwordHash");
    expect(exported).not.toContain("gizli-hash");
    await deleteAccount(host.id);
    const anon = await prisma.user.findUniqueOrThrow({ where: { id: host.id } });
    expect(anon.email).toMatch(/@anon\.invalid$/);
    expect(anon.firstName).toBe("Silinmiş");
    await prisma.$disconnect();
  });
});
