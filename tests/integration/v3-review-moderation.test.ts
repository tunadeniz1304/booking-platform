import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken, type Role } from "@/lib/auth/tokens";
import { getConfig } from "@/lib/config/app-config";
import { GET as reviewsGet, POST as reviewsPost } from "@/app/api/properties/[id]/reviews/route";
import { POST as reportPost } from "@/app/api/reviews/[id]/report/route";
import { GET as queueGet, POST as queuePost } from "@/app/api/admin/reviews/route";

/** P1-7 yorum moderasyonu: v3#24 (yalnızca COMPLETED), filtre, şikâyet eşiği, admin kuyruğu. */
describeInt("P1-7 yorum moderasyonu (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let adminId = "";
  const tokens: Record<string, string> = {};
  let dayOffset = -400;

  const tokenFor = async (userId: string, role: Role) =>
    (await signAccessToken(userId, role, 300)).token;
  const req = (path: string, token?: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const mkUser = (role: "USER" | "ADMIN", tag: string) =>
    prisma.user.create({
      data: {
        email: `rm-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.test`,
        passwordHash: "x",
        firstName: "R",
        lastName: "M",
        role,
      },
    });
  /** Geçmişte, çakışmayan tarihlerde misafire ait rezervasyon. */
  const pastBooking = async (status: "CONFIRMED" | "COMPLETED") => {
    dayOffset += 3;
    return prisma.booking.create({
      data: {
        userId: fx.userId,
        propertyId: fx.propertyId,
        roomId: fx.roomId,
        checkIn: utcDay(dayOffset),
        checkOut: utcDay(dayOffset + 2),
        guestCount: 1,
        totalPrice: new Prisma.Decimal(1000),
        status,
      },
    });
  };
  const postReview = (bookingId: string, body: Record<string, unknown>) =>
    reviewsPost(
      req(`/api/properties/${fx.propertyId}/reviews`, tokens.guest, { bookingId, ...body }),
      ctx(fx.propertyId)
    );
  const listIds = async () =>
    (
      (await (
        await reviewsGet(req(`/api/properties/${fx.propertyId}/reviews`), ctx(fx.propertyId))
      ).json()) as { id: string }[]
    ).map((r) => r.id);

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "revmod", days: 5 });
    const admin = await mkUser("ADMIN", "ad");
    adminId = admin.id;
    tokens.guest = await tokenFor(fx.userId, "USER");
    tokens.admin = await tokenFor(admin.id, "ADMIN");
    tokens.host = await tokenFor(fx.hostId, "HOST");
  });
  afterAll(() => prisma.$disconnect());

  it("v3#24: çıkışı geçmiş CONFIRMED rezervasyon yorum hakkı vermez; COMPLETED verir", async () => {
    const confirmed = await pastBooking("CONFIRMED");
    expect((await postReview(confirmed.id, { rating: 5 })).status).toBe(403);

    const completed = await pastBooking("COMPLETED");
    const res = await postReview(completed.id, {
      rating: 4,
      comment: "Çok temiz ve sessizdi.",
      subScores: { cleanliness: 5, location: 4, staff: 4, value: 3 },
    });
    expect(res.status).toBe(201);
    const review = await res.json();
    expect(review).toMatchObject({ moderationStatus: "PUBLISHED", cleanliness: 5, value: 3 });
    expect(await listIds()).toContain(review.id);
    expect((await postReview(completed.id, { rating: 4, subScores: { staff: 9 } })).status).toBe(
      400
    );
  });

  it("küfür/iletişim bilgisi içeren yorum PENDING_REVIEW olur, listelenmez, puana katılmaz", async () => {
    const before = await prisma.property.findUniqueOrThrow({ where: { id: fx.propertyId } });
    const b = await pastBooking("COMPLETED");
    const res = await postReview(b.id, {
      rating: 1,
      comment: "Salak ev sahibi, beni 0532 123 45 67 den arayın",
    });
    expect(res.status).toBe(201);
    const review = await res.json();
    expect(review.moderationStatus).toBe("PENDING_REVIEW");
    const codes = (review.moderationReasons as { code: string }[]).map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["PROFANITY", "PII_PHONE"]));
    expect(await listIds()).not.toContain(review.id);
    const after = await prisma.property.findUniqueOrThrow({ where: { id: fx.propertyId } });
    expect(after.ratingCount).toBe(before.ratingCount);

    // Admin kuyruğu: yetki, açıklama, karar + denetim kaydı
    expect((await queueGet(req("/api/admin/reviews"))).status).toBe(401);
    expect((await queueGet(req("/api/admin/reviews", tokens.host))).status).toBe(403);
    const queue = (await (await queueGet(req("/api/admin/reviews", tokens.admin))).json()) as {
      id: string;
      explanation: string;
    }[];
    const item = queue.find((q) => q.id === review.id);
    expect(item?.explanation.length).toBeGreaterThan(5);
    expect(
      (
        await queuePost(
          req("/api/admin/reviews", tokens.host, { id: review.id, action: "publish" })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await queuePost(
          req("/api/admin/reviews", tokens.admin, { id: review.id, action: "publish" })
        )
      ).status
    ).toBe(200);
    expect(await listIds()).toContain(review.id);
    expect(
      (await prisma.property.findUniqueOrThrow({ where: { id: fx.propertyId } })).ratingCount
    ).toBe(before.ratingCount + 1);
    expect(await prisma.auditLog.count({ where: { entityId: review.id, actorId: adminId } })).toBe(
      1
    );
    // Kuyrukta olmayan yoruma ikinci karar → 404
    expect(
      (
        await queuePost(
          req("/api/admin/reviews", tokens.admin, { id: review.id, action: "remove" })
        )
      ).status
    ).toBe(404);
  });

  it("şikâyet eşiğine ulaşan yorum gizlenir; tekrar ve kendi yorumunu şikâyet engellenir", async () => {
    const b = await pastBooking("COMPLETED");
    const review = await (await postReview(b.id, { rating: 2, comment: "Fena değildi." })).json();
    const path = `/api/reviews/${review.id}/report`;

    expect(
      (await reportPost(req(path, undefined, { reason: "SPAM" }), ctx(review.id))).status
    ).toBe(401);
    expect(
      (await reportPost(req(path, tokens.guest, { reason: "SPAM" }), ctx(review.id))).status
    ).toBe(403);

    const threshold = getConfig().REVIEW_REPORT_HIDE_THRESHOLD;
    const reporters = await Promise.all(
      Array.from({ length: threshold }, (_, i) => mkUser("USER", `rep${i}`))
    );
    const first = await tokenFor(reporters[0].id, "USER");
    expect((await reportPost(req(path, first, { reason: "FAKE" }), ctx(review.id))).status).toBe(
      201
    );
    expect((await reportPost(req(path, first, { reason: "FAKE" }), ctx(review.id))).status).toBe(
      409
    );
    expect((await reportPost(req(path, first, { reason: "NOPE" }), ctx(review.id))).status).toBe(
      400
    );
    if (threshold > 1) expect(await listIds()).toContain(review.id);

    let last: { reportCount: number; hidden: boolean } | null = null;
    for (const r of reporters.slice(1)) {
      const res = await reportPost(
        req(path, await tokenFor(r.id, "USER"), { reason: "OFFENSIVE" }),
        ctx(review.id)
      );
      expect(res.status).toBe(201);
      last = await res.json();
    }
    if (last) expect(last).toEqual({ reportCount: threshold, hidden: true });
    const stored = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
    expect(stored.moderationStatus).toBe("HIDDEN");
    expect(await listIds()).not.toContain(review.id);
    // Gizlenmiş yorum artık şikâyet edilemez (kaynak görünmez).
    const extra = await mkUser("USER", "late");
    expect(
      (
        await reportPost(
          req(path, await tokenFor(extra.id, "USER"), { reason: "SPAM" }),
          ctx(review.id)
        )
      ).status
    ).toBe(404);
  });
});
