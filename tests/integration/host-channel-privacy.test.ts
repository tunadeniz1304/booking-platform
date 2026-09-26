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
        licenseStatus: "VERIFIED",
        hostId: host.id,
        title: "Host",
        description: "host test",
        propertyType: "HOTEL",
        locationId: loc.id,
        basePrice: new Prisma.Decimal(800),
        isActive: false,
      },
    });
    const ratePlans = { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] };
    const room = await prisma.roomType.create({
      data: { propertyId: p.id, name: "O", maxOccupancy: 2, bedType: "Ç", ratePlans },
    });
    await prisma.inventoryDay.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        roomTypeId: room.id,
        date: utcDay(i + 1),
        price: new Prisma.Decimal(800),
        total: 1,
      })),
    });
    // 5. gece satılmış (tek birim dolu): sayaç modelinde "rezervasyonlu gece" = sold > 0
    await prisma.inventoryDay.update({
      where: { roomTypeId_date: { roomTypeId: room.id, date: utcDay(5) } },
      data: { sold: 1 },
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

    // Allotment'ı 0'a indirme girişimi: satılmış gecede total, sold + held altına inemez
    const r = await bulkUpdateAvailability(claims(host.id, "HOST"), room.id, {
      from: iso(utcDay(1)),
      to: iso(utcDay(10)),
      price: 999,
      total: 0,
    });
    expect(r.skippedLocked).toBe(1);
    const lockedNight = await prisma.inventoryDay.findUniqueOrThrow({
      where: { roomTypeId_date: { roomTypeId: room.id, date: utcDay(5) } },
    });
    expect(lockedNight.total).toBe(1);
    expect(lockedNight.sold).toBe(1);
    const closedNight = await prisma.inventoryDay.findUniqueOrThrow({
      where: { roomTypeId_date: { roomTypeId: room.id, date: utcDay(4) } },
    });
    expect(closedNight.total).toBe(0);
    const [{ overbooked }] = await prisma.$queryRaw<Array<{ overbooked: number }>>`
      SELECT count(*)::int AS overbooked FROM "InventoryDay"
      WHERE "roomTypeId" = ${room.id} AND sold + held > total`;
    expect(overbooked).toBe(0);

    // ARI: aynı mesaj iki kez → tek etki; eski sıra reddedilir
    const msg = {
      roomId: room.id,
      sequence: 7,
      idempotencyKey: "ari-1",
      updates: [{ date: iso(utcDay(12)), price: "1234" }],
    };
    expect((await applyAriMessage(msg)).status).toBe("applied");
    expect((await applyAriMessage(msg)).status).toBe("duplicate");
    await expect(
      applyAriMessage({ ...msg, idempotencyKey: "ari-0", sequence: 6 })
    ).rejects.toMatchObject({ code: "STALE_SEQUENCE" });

    // iCal gidiş-dönüş: dışa aktarılan dolu gece başka odaya içe aktarılınca bloklanır
    const ics = await exportRoomCalendar(room.id);
    expect(ics).toContain("BEGIN:VCALENDAR");
    // Dışa aktarımda: satılmış 5. gece + total=0'a inen 1–4 ve 6–10. geceler
    const room2 = await prisma.roomType.create({
      data: { propertyId: p.id, name: "O2", maxOccupancy: 2, bedType: "Ç", ratePlans },
    });
    await prisma.inventoryDay.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        roomTypeId: room2.id,
        date: utcDay(i + 1),
        price: new Prisma.Decimal(800),
        total: 1,
      })),
    });
    const imported = await importCalendar(room2.id, ics, "ota-x");
    expect(imported).toMatchObject({ nights: 10, added: 10, removed: 0, conflicts: [] });
    const night5 = await prisma.inventoryDay.findUniqueOrThrow({
      where: { roomTypeId_date: { roomTypeId: room2.id, date: utcDay(5) } },
    });
    expect(night5.sold).toBe(1);
    expect(
      await prisma.externalBlock.count({
        where: { roomTypeId: room2.id, source: "ical:ota-x", date: utcDay(5) },
      })
    ).toBe(1);
    // Aynı takvim tekrar içe aktarılırsa uzlaştırma idempotent: yeni blok yok
    const again = await importCalendar(room2.id, ics, "ota-x");
    expect(again).toMatchObject({ added: 0, removed: 0 });

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
