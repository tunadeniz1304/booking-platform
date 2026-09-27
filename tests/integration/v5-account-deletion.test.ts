import { it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import { deleteAccount } from "@/lib/privacy/privacy-service";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function hostWithListing(tag: string) {
  const stamp = `${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const host = await prisma.user.create({
    data: {
      email: `host-${stamp}@t.test`,
      passwordHash: "x",
      firstName: "Ev",
      lastName: "Sahibi",
      role: "HOST",
    },
  });
  const guest = await prisma.user.create({
    data: { email: `guest-${stamp}@t.test`, passwordHash: "x", firstName: "M", lastName: "G" },
  });
  const loc = await prisma.location.create({ data: { city: `Del-${stamp}`, country: "TEST" } });
  const property = await prisma.property.create({
    data: {
      licenseStatus: "VERIFIED",
      hostId: host.id,
      title: "Silme",
      description: "silme testi",
      propertyType: "HOTEL",
      locationId: loc.id,
      basePriceMinor: 50000n,
    },
  });
  const room = await prisma.roomType.create({
    data: { propertyId: property.id, name: "S", maxOccupancy: 2, bedType: "Ç" },
  });
  const book = (from: number, to: number, status: "CONFIRMED" | "COMPLETED") =>
    prisma.booking.create({
      data: {
        userId: guest.id,
        propertyId: property.id,
        roomId: room.id,
        checkIn: utcDay(from),
        checkOut: utcDay(to),
        guestCount: 1,
        totalPriceMinor: 10000n,
        status,
      },
    });
  return { host, guest, property, book, stamp };
}

describeInt("regression: v5#9 hesap silme ev sahibi yükümlülükleri (integration)", () => {
  it("gelecek CONFIRMED misafir rezervasyonu olan ev sahibi silinemez: 409, yarım silme yok", async () => {
    const { host, property, book } = await hostWithListing("obl");
    await book(20, 22, "CONFIRMED");
    await expect(deleteAccount(host.id)).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_HAS_OBLIGATIONS",
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: host.id } });
    expect(after.deletedAt).toBeNull();
    expect(after.email).toBe(host.email);
    expect(after.tokenVersion).toBe(host.tokenVersion);
    const listing = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(listing.isActive).toBe(true);
  });

  it("bekleyen payout da yükümlülüktür", async () => {
    const { host } = await hostWithListing("pay");
    await prisma.hostPayout.create({
      data: { userId: host.id, amountMinor: 5000n, currency: "TRY", provider: "mock" },
    });
    await expect(deleteAccount(host.id)).rejects.toMatchObject({
      code: "ACCOUNT_HAS_OBLIGATIONS",
    });
  });

  it("yükümlülüğü olmayan ev sahibi: ilanlar pasif, push ve oturum kayıtları silinir", async () => {
    const { host, property, book, stamp } = await hostWithListing("ok");
    await book(-10, -8, "COMPLETED");
    await prisma.pushSubscription.create({
      data: {
        userId: host.id,
        endpoint: `https://fcm.googleapis.com/fcm/send/${stamp}`,
        p256dh: "p",
        auth: "a",
      },
    });
    await prisma.userSession.create({ data: { id: `sess-${stamp}`, userId: host.id } });
    await deleteAccount(host.id);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: host.id } });
    expect(after.deletedAt).not.toBeNull();
    expect(after.email).toMatch(/@anon\.invalid$/);
    const listing = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(listing.isActive).toBe(false);
    expect(await prisma.pushSubscription.count({ where: { userId: host.id } })).toBe(0);
    expect(await prisma.userSession.count({ where: { userId: host.id } })).toBe(0);
  });
});
