import { it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { createQuote } from "@/lib/pricing/quote";
import { compareListings } from "@/lib/ai/listing-compare";
import { getReviewHighlights } from "@/lib/ai/review-highlights";
import { GET as compareGET } from "@/app/api/compare/route";
import { GET as highlightsGET } from "@/app/api/properties/[id]/review-highlights/route";

/**
 * v4 P1-9 (integration): karşılaştırma toplamları teklif motoruyla (`createQuote`,
 * `/api/quote`'un çağırdığı fonksiyon) birebir aynı; yorum öne çıkanları demo modda
 * gerçek yorumlardan birebir alıntılı, yorum seti karmasıyla önbellekli.
 */
const BASE = "http://localhost";
const req = (path: string) => new NextRequest(`${BASE}${path}`);

describeInt("v4 P1-9 yorum öne çıkanları + karşılaştırma (integration)", () => {
  const prisma = new PrismaClient();
  let a: StayFixture;
  let b: StayFixture;
  let c: StayFixture;
  const checkIn = iso(utcDay(10));
  const checkOut = iso(utcDay(13));

  beforeAll(async () => {
    a = await createStayFixture(prisma, { tag: "cmp-a", nightlyPrice: 1234.5 });
    b = await createStayFixture(prisma, {
      tag: "cmp-b",
      nightlyPrice: 999,
      policyId: "policy_flexible_v1",
    });
    c = await createStayFixture(prisma, { tag: "cmp-c", nightlyPrice: 800, capacity: 1 });
    const stamp = Date.now();
    const pool = await prisma.amenity.create({ data: { name: `Havuz-${stamp}` } });
    const wifi = await prisma.amenity.create({ data: { name: `WiFi-${stamp}` } });
    await prisma.property.update({
      where: { id: a.propertyId },
      data: { amenities: { connect: [{ id: pool.id }, { id: wifi.id }] } },
    });
    await prisma.property.update({
      where: { id: b.propertyId },
      data: { amenities: { connect: [{ id: wifi.id }] } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("karşılaştırma toplamları = teklif motoru toplamları; fark + AI yorumu", async () => {
    const res = await compareListings({
      ids: [a.propertyId, b.propertyId, c.propertyId],
      checkIn,
      checkOut,
      guests: 2,
      locale: "tr",
    });
    expect(res.listings.map((l) => l.id)).toEqual([a.propertyId, b.propertyId, c.propertyId]);
    for (const fx of [a, b]) {
      const quote = await createQuote({
        roomId: fx.roomId,
        propertyId: fx.propertyId,
        checkIn,
        checkOut,
        guests: 2,
      });
      const listing = res.listings.find((l) => l.id === fx.propertyId)!;
      expect(listing.price.available).toBe(true);
      expect(listing.price.total).toBe(Number(quote.charge.total));
      expect(listing.price.currency).toBe(quote.charge.currency);
      expect(listing.price.nights).toBe(3);
      expect(listing.price.roomId).toBe(fx.roomId);
    }
    // Kapasite 1 → 2 misafir için oda yok.
    expect(res.listings[2].price).toMatchObject({ available: false, reason: "NO_ROOM_FOR_GUESTS" });
    expect(res.diff.cheapestId).toBe(b.propertyId);
    expect(res.diff.mostFlexibleId).toBe(b.propertyId);
    expect(res.diff.uniqueAmenities[a.propertyId]).toEqual([expect.stringMatching(/^Havuz-/)]);
    expect(res.listings[0].cancellation).toEqual({ kind: "MODERATE", freeCancellationHours: 120 });
    expect(res.commentary.llmMode).toBe("demo");
    expect(res.commentary.text).toContain(res.listings[1].title);

    // Para birimi parametresi de teklif motoruna aynen iletilir.
    const tryRes = await compareListings({
      ids: [a.propertyId, b.propertyId],
      checkIn,
      checkOut,
      guests: 1,
      currency: "TRY",
      locale: "en",
    });
    const qa = await createQuote({
      roomId: a.roomId,
      propertyId: a.propertyId,
      checkIn,
      checkOut,
      guests: 1,
      currency: "TRY",
    });
    expect(tryRes.listings[0].price.total).toBe(Number(qa.charge.total));
  });

  it("GET /api/compare: ai_generated, tarihsiz, doğrulama hataları", async () => {
    const ok = await compareGET(
      req(
        `/api/compare?ids=${a.propertyId},${b.propertyId}&checkIn=${checkIn}&checkOut=${checkOut}&guests=2&locale=en`
      )
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.ai_generated).toBe(true);
    expect(body.listings).toHaveLength(2);

    const noDates = await (
      await compareGET(req(`/api/compare?ids=${a.propertyId},${b.propertyId}`))
    ).json();
    expect(noDates.listings[0].price).toMatchObject({ available: false, reason: "NO_DATES" });

    expect((await compareGET(req(`/api/compare?ids=${a.propertyId}`))).status).toBe(400);
    expect((await compareGET(req(`/api/compare?ids=${a.propertyId},${a.propertyId}`))).status).toBe(
      400
    );
    expect(
      (await compareGET(req(`/api/compare?ids=${a.propertyId},${b.propertyId}&checkIn=${checkIn}`)))
        .status
    ).toBe(400);
    expect((await compareGET(req(`/api/compare?ids=${a.propertyId},nope-x`))).status).toBe(404);
  });

  it("yorum öne çıkanları: birebir alıntılar, deterministik, karma önbelleği", async () => {
    const comments = [
      [5, "Oda çok temiz ve ferahtı. Kahvaltı zengindi."],
      [4, "Temizlik mükemmeldi, oda pırıl pırıl. Konum harika, metroya yakın."],
      [5, "Konum çok iyi, metro hemen yakında."],
      [2, "Kahvaltı zayıftı ve soğuk geldi. Oda temiz ama küçük."],
    ] as const;
    const ids: string[] = [];
    for (const [rating, comment] of comments) {
      const booking = await a.hold({ nights: 1 });
      const r = await prisma.review.create({
        data: {
          bookingId: booking.id,
          userId: a.userId,
          propertyId: a.propertyId,
          rating,
          comment,
        },
      });
      ids.push(r.id);
    }

    const first = await getReviewHighlights(a.propertyId, "tr");
    expect(first.cached).toBe(false);
    expect(first.llmMode).toBe("demo");
    expect(first.reviewCount).toBe(4);
    expect(first.clusters.length).toBeGreaterThan(0);
    const byId = new Map(comments.map(([, text], i) => [ids[i], text as string]));
    for (const cl of first.clusters) {
      for (const claim of cl.claims) {
        expect(byId.get(claim.reviewId)!.slice(claim.start, claim.end)).toBe(claim.quote);
      }
    }
    const second = await getReviewHighlights(a.propertyId, "tr");
    expect(second.cached).toBe(true);
    expect({ ...second, cached: false }).toEqual(first);

    // Yeni yorum → yeni yorum seti karması → önbellek atlanır.
    const booking = await a.hold({ nights: 1 });
    await prisma.review.create({
      data: {
        bookingId: booking.id,
        userId: a.userId,
        propertyId: a.propertyId,
        rating: 4,
        comment: "Personel çok yardımseverdi.",
      },
    });
    const third = await getReviewHighlights(a.propertyId, "tr");
    expect(third.cached).toBe(false);
    expect(third.setHash).not.toBe(first.setHash);

    const res = await highlightsGET(
      req(`/api/properties/${a.propertyId}/review-highlights?locale=en`),
      {
        params: Promise.resolve({ id: a.propertyId }),
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ai_generated).toBe(true);
    expect(body.locale).toBe("en");

    const missing = await highlightsGET(req(`/api/properties/nope/review-highlights`), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(missing.status).toBe(404);

    const empty = await getReviewHighlights(b.propertyId, "tr");
    expect(empty.clusters).toEqual([]);
  });
});
