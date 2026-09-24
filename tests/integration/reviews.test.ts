import { it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import { createReview, replyToReview, reviewsVersion } from "@/lib/reviews/review-service";
import { summarizeReviews } from "@/lib/ai/review-summary";

describeInt("P1-4 doğrulanmış yorumlar + atıflı özet (integration)", () => {
  it("kurallar, özet atıfları ve önbellek sürümü", async () => {
    const prisma = new PrismaClient();
    const stamp = Date.now();
    const mk = (n: string, role: "USER" | "HOST" = "USER") =>
      prisma.user.create({
        data: {
          email: `rv-${n}-${stamp}@t.test`,
          passwordHash: "x",
          firstName: n,
          lastName: "Kaya",
          role,
        },
      });
    const host = await mk("host", "HOST");
    const other = await mk("other", "HOST");
    const guest = await mk("guest");
    const stranger = await mk("stranger");
    const loc = await prisma.location.create({
      data: { city: `RevCity-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        hostId: host.id,
        title: "Yorum Oteli",
        description: "t",
        propertyType: "HOTEL",
        locationId: loc.id,
        basePrice: new Prisma.Decimal(500),
      },
    });
    const room = await prisma.room.create({
      data: { propertyId: property.id, name: "O", capacity: 2, bedType: "Ç" },
    });
    const booking = (status: "CONFIRMED" | "HELD", out: number) =>
      prisma.booking.create({
        data: {
          userId: guest.id,
          propertyId: property.id,
          roomId: room.id,
          checkIn: utcDay(out - 2),
          checkOut: utcDay(out),
          guestCount: 1,
          totalPrice: new Prisma.Decimal(1000),
          status,
        },
      });
    const past = await booking("CONFIRMED", -1);
    const future = await booking("CONFIRMED", 10);

    await expect(
      createReview({ userId: stranger.id, bookingId: past.id, rating: 5 })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createReview({ userId: guest.id, bookingId: future.id, rating: 5 })
    ).rejects.toMatchObject({ status: 403 });

    const v0 = await reviewsVersion(property.id);
    const review = await createReview({
      userId: guest.id,
      bookingId: past.id,
      rating: 5,
      comment: "Oda tertemizdi, konum harika. Personel çok ilgiliydi.",
    });
    await expect(
      createReview({ userId: guest.id, bookingId: past.id, rating: 4 })
    ).rejects.toMatchObject({ status: 409 });
    expect(await reviewsVersion(property.id)).not.toBe(v0);
    expect(
      (await prisma.property.findUniqueOrThrow({ where: { id: property.id } })).ratingCount
    ).toBe(1);

    const summary = await summarizeReviews(property.id);
    expect(summary.llmMode).toBe("demo");
    expect(summary.citations.every((c) => c === review.id)).toBe(true);
    expect(summary.summary).toContain("1 doğrulanmış yorum");

    await expect(
      replyToReview({ hostId: other.id, reviewId: review.id, text: "teşekkürler" })
    ).rejects.toMatchObject({ status: 404 });
    const replied = await replyToReview({
      hostId: host.id,
      reviewId: review.id,
      text: "Teşekkür ederiz!",
    });
    expect(replied.hostReply).toBe("Teşekkür ederiz!");
    await prisma.$disconnect();
  });
});
