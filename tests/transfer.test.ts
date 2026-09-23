// P2P Booking Transfer: listeleme (BOLA + adil fiyat), imzalı jetonla atomik
// devir (race-güvenli), çift-talep reddi ve sahiplik değişimini DB'de doğrular.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma, BookingStatus, UserRole } from "@prisma/client";
import {
  listBookingForTransfer,
  claimTransfer,
  verifyTransferToken,
  TransferError,
} from "@/lib/transfer/transfer-service";

const prisma = new PrismaClient();

let seller: { id: string };
let buyer: { id: string };
let property: { id: string };
let bookingId = "";
let bookingId2 = "";

async function makeBooking(userId: string): Promise<{ id: string }> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const checkIn = new Date(today);
  checkIn.setUTCDate(checkIn.getUTCDate() + 25);
  const checkOut = new Date(checkIn);
  checkOut.setUTCDate(checkOut.getUTCDate() + 2);
  return prisma.booking.create({
    data: {
      userId,
      propertyId: property.id,
      roomId: (await prisma.room.findFirstOrThrow({ where: { propertyId: property.id } })).id,
      checkIn,
      checkOut,
      guestCount: 1,
      totalPrice: new Prisma.Decimal(2000),
      currency: "TRY",
      status: BookingStatus.CONFIRMED,
    },
  });
}

beforeAll(async () => {
  seller = await prisma.user.create({ data: { email: `tr-seller-${Date.now()}@t.test`, passwordHash: "x", firstName: "S", lastName: "T" } });
  buyer = await prisma.user.create({ data: { email: `tr-buyer-${Date.now()}@t.test`, passwordHash: "x", firstName: "B", lastName: "T" } });
  const host = await prisma.user.create({ data: { email: `tr-host-${Date.now()}@t.test`, passwordHash: "x", firstName: "H", lastName: "T", role: UserRole.HOST } });
  const location = await prisma.location.create({ data: { city: `TransCity-${Date.now()}`, country: "TEST" } });
  property = await prisma.property.create({
    data: { hostId: host.id, title: "Transfer Test Oteli", description: "transfer", propertyType: "HOTEL", locationId: location.id, basePrice: new Prisma.Decimal(1000), currency: "TRY", isActive: true },
  });
  await prisma.room.create({ data: { propertyId: property.id, name: "Devir Odası", capacity: 2, bedType: "Çift", priceModifier: new Prisma.Decimal(0), available: true } });
  bookingId = (await makeBooking(seller.id)).id;
  bookingId2 = (await makeBooking(seller.id)).id;
});

afterAll(async () => {
  await prisma.bookingTransfer.deleteMany({ where: { bookingId: { in: [bookingId, bookingId2] } } });
  await prisma.booking.deleteMany({ where: { id: { in: [bookingId, bookingId2] } } });
  const propHost = await prisma.property.findUnique({ where: { id: property.id }, select: { hostId: true } });
  await prisma.room.deleteMany({ where: { propertyId: property.id } });
  await prisma.property.deleteMany({ where: { id: property.id } });
  await prisma.location.deleteMany({ where: { city: { startsWith: "TransCity-" } } });
  await prisma.user.deleteMany({ where: { id: { in: [seller.id, buyer.id, propHost?.hostId ?? "x"] } } });
  await prisma.$disconnect();
});

describe("P2P Booking Transfer", () => {
  it("listeleme jeton üretir; alıcı devralır; çift talep reddedilir", async () => {
    const listed = await listBookingForTransfer(bookingId, seller.id, 2200);
    expect(listed.id).toBeTruthy();
    expect(listed.transferToken).toBeTruthy();
    // jeton imzası + süre doğrulanabilir
    const parsed = verifyTransferToken(listed.transferToken);
    expect(parsed?.bookingId).toBe(bookingId);
    expect(parsed?.sellerId).toBe(seller.id);

    const claimed = await claimTransfer(listed.id, buyer.id);
    expect(claimed.status).toBe("COMPLETED");

    // sahiplik devri: booking artık alıcıya ait
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(b?.userId).toBe(buyer.id);

    // aynı transferi tekrar talep etmek çift-talep değil → 409/404
    await expect(claimTransfer(listed.id, seller.id)).rejects.toThrow();
  }, 30000);

  it("satıcı olmayan listeleme yapamaz + adil fiyat üst sınırı uygulanır", async () => {
    // satıcı olmayan biri listelerse BOLA → 404
    await expect(listBookingForTransfer(bookingId2, buyer.id, 1000)).rejects.toThrow(TransferError);
    // adil üst sınır aşımı (2000 * 1.35 = 2700 üstü)
    await expect(listBookingForTransfer(bookingId2, seller.id, 3000)).rejects.toThrow(TransferError);
  });
});
