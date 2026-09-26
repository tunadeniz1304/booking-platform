import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, ledgerNetMinor, type StayFixture } from "./fixtures";
import { signAccessToken, type Role } from "@/lib/auth/tokens";
import { getAuth } from "@/lib/auth";
import { issueSession } from "@/lib/auth/session";
import { REFRESH_COOKIE } from "@/lib/auth/cookies";
import { signWebhook } from "@/lib/payment/webhook";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { feedToken } from "@/lib/channel/channel";
import { getQueue, getQueueConnection } from "@/lib/queue";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as readyGet } from "@/app/api/ready/route";
import { GET as llmStatusGet } from "@/app/api/llm/status/route";
import { GET as locationsGet } from "@/app/api/locations/route";
import {
  GET as favoritesGet,
  POST as favoritesPost,
  DELETE as favoritesDelete,
} from "@/app/api/favorites/route";
import { GET as meGet } from "@/app/api/user/me/route";
import { GET as bookingsGet, POST as bookingsPost } from "@/app/api/bookings/route";
import { GET as bookingGet, DELETE as bookingDelete } from "@/app/api/bookings/[id]/route";
import { POST as payPost } from "@/app/api/bookings/[id]/pay/route";
import { POST as payConfirmPost } from "@/app/api/bookings/[id]/pay/confirm/route";
import { POST as webhookPost } from "@/app/api/payments/webhook/route";
import { GET as quoteGet } from "@/app/api/quote/route";
import { GET as searchGet } from "@/app/api/search/route";
import { POST as smartSearchPost } from "@/app/api/search/smart/route";
import { GET as propertiesGet, POST as propertiesPost } from "@/app/api/properties/route";
import { GET as propertyGet, PATCH as propertyPatch } from "@/app/api/properties/[id]/route";
import { POST as roomsPost, PATCH as roomsPatch } from "@/app/api/properties/[id]/rooms/route";
import { GET as reviewsGet, POST as reviewsPost } from "@/app/api/properties/[id]/reviews/route";
import { GET as reviewSummaryGet } from "@/app/api/properties/[id]/reviews/summary/route";
import { POST as reviewReplyPost } from "@/app/api/reviews/[id]/reply/route";
import { GET as routingGet } from "@/app/api/routing/optimize/route";
import { POST as refreshPost } from "@/app/api/auth/refresh/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { GET as accountGet, DELETE as accountDelete } from "@/app/api/account/route";
import { GET as passkeysGet, DELETE as passkeysDelete } from "@/app/api/account/passkeys/route";
import { POST as resendPost } from "@/app/api/auth/verify-email/resend/route";
import { GET as outboxGet, POST as outboxPost } from "@/app/api/admin/outbox/route";
import { GET as eventsGet, POST as eventsPost } from "@/app/api/admin/events/route";
import { POST as eventActionPost } from "@/app/api/admin/events/[id]/[action]/route";
import { GET as fraudGet, POST as fraudPost } from "@/app/api/admin/fraud/route";
import { GET as transfersGet, POST as transfersPost } from "@/app/api/transfers/route";
import { POST as transferClaimPost } from "@/app/api/transfers/claim/route";
import { GET as transferDiscoverGet } from "@/app/api/transfers/discover/route";
import { DELETE as transferDelete } from "@/app/api/transfers/[id]/route";
import { PUT as availabilityPut } from "@/app/api/rooms/[roomId]/availability/route";
import { GET as calendarGet } from "@/app/api/rooms/[roomId]/calendar.ics/route";
import { POST as calendarImportPost } from "@/app/api/rooms/[roomId]/calendar/import/route";
import { POST as pricingPost } from "@/app/api/pricing/route";
import { GET as hostBookingsGet } from "@/app/api/host/bookings/route";
import { GET as hostPropertiesGet } from "@/app/api/host/properties/route";
import { POST as listingCopyPost } from "@/app/api/ai/listing-copy/route";
import { POST as tripPlanPost } from "@/app/api/ai/trip-plan/route";
import { GET as mailboxGet } from "@/app/api/dev/mailbox/route";

const BASE = "http://localhost:3000";

interface CallOptions {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Route handler'a doğrudan verilecek istek (proxy devrede değil). */
function call(path: string, o: CallOptions = {}): NextRequest {
  const headers: Record<string, string> = { ...o.headers };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  let body: string | undefined;
  if (o.body !== undefined) {
    body = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
    headers["content-type"] ??= "application/json";
  }
  return new NextRequest(`${BASE}${path}`, {
    method: o.method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    body,
  });
}

function ctx<T>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

async function tokenFor(userId: string, role: Role): Promise<string> {
  // auth_time = şimdi: hassas uçlar (v4#2 recent-auth) için yeni giriş yapmış oturum.
  return (await signAccessToken(userId, role, 300, 0, Math.floor(Date.now() / 1000))).token;
}

/** Test içi sahte sır (≥ 32 karakter; gerçek değer değildir). */
const testSecret = (tag: string) => `${tag}-test-only-`.padEnd(40, "x");

describeInt("API route handler'ları (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const envBackup: Record<string, string | undefined> = {};
  let userSeq = 0;
  let cardSeq = 1000;

  let adminId: string;
  let adminToken: string;
  /** Hiçbir kaynağın sahibi olmayan ikinci kullanıcı (IDOR denemeleri). */
  let strangerId: string;
  let strangerToken: string;
  /** Hiçbir mülkün sahibi olmayan ikinci host. */
  let otherHostToken: string;

  async function makeUser(tag: string, role: Role = "USER") {
    userSeq += 1;
    return prisma.user.create({
      data: {
        email: `${tag}-${userSeq}-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "Api",
        lastName: "Test",
        role,
      },
    });
  }

  /** Her ödemede farklı kart ve istemci parmak izi (fraud hız kuralları tetiklenmesin). */
  function nextCard(kind: "ok" | "decline" | "3ds" = "ok"): string {
    cardSeq += 1;
    return `tok_mock_${kind}_${cardSeq}`;
  }

  function payRequest(bookingId: string, token: string, cardToken: string, key = "k1") {
    return call(`/api/bookings/${bookingId}/pay`, {
      token,
      body: { cardToken },
      headers: { "idempotency-key": key, "user-agent": `api-test-${cardSeq}` },
    });
  }

  beforeAll(async () => {
    for (const k of ["PSP_WEBHOOK_SECRET", "CHANNEL_FEED_SECRET", "DEMO_MODE"]) {
      envBackup[k] = process.env[k];
    }
    process.env.PSP_WEBHOOK_SECRET = testSecret("webhook");
    process.env.CHANNEL_FEED_SECRET = testSecret("feed");
    delete process.env.DEMO_MODE;

    const admin = await makeUser("admin", "ADMIN");
    adminId = admin.id;
    adminToken = await tokenFor(admin.id, "ADMIN");
    const stranger = await makeUser("stranger");
    strangerId = stranger.id;
    strangerToken = await tokenFor(stranger.id, "USER");
    const otherHost = await makeUser("otherhost", "HOST");
    otherHostToken = await tokenFor(otherHost.id, "HOST");
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await getQueue("pricing")
      .close()
      .catch(() => undefined);
    await getQueueConnection()
      .quit()
      .catch(() => undefined);
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  describe("sağlık ve durum uçları", () => {
    it("health: süreç ayakta → 200 ok", async () => {
      const res = healthGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(typeof body.uptimeSeconds).toBe("number");
    });

    it("ready: veritabanı ve Redis erişilebilir → 200 ready", async () => {
      const res = await readyGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ready).toBe(true);
      expect(body.checks.database.ok).toBe(true);
      expect(body.checks.redis.ok).toBe(true);
    });

    it("llm/status: oturumsuz 401; oturumla mod bilgisi, anahtar değeri dönmez", async () => {
      expect((await llmStatusGet(call("/api/llm/status"))).status).toBe(401);
      const res = await llmStatusGet(call("/api/llm/status", { token: strangerToken }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("demo");
      expect(typeof body.hasKey).toBe("boolean");
      expect(Object.keys(body)).not.toContain("apiKey");
    });
  });

  // ---------------------------------------------------------------------------
  describe("lokasyonlar ve rota optimizasyonu", () => {
    const cityA = `Rotakent-A-${stamp}`;
    const cityB = `Rotakent-B-${stamp}`;
    const cityNoCoord = `Rotakent-C-${stamp}`;

    beforeAll(async () => {
      await prisma.location.createMany({
        data: [
          { city: cityA, country: "TEST", latitude: 41.01, longitude: 28.97 },
          { city: cityB, country: "TEST", latitude: 39.93, longitude: 32.86 },
          { city: cityNoCoord, country: "TEST" },
        ],
      });
    });

    it("locations: q ile şehir araması, eşleşme yoksa boş liste", async () => {
      const res = await locationsGet(call(`/api/locations?q=${encodeURIComponent(cityA)}`));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([{ city: cityA, country: "TEST" }]);

      const none = await locationsGet(call(`/api/locations?q=yok-${stamp}`));
      expect(await none.json()).toEqual([]);

      // 2 karakterden kısa sorgu filtre uygulamaz (en fazla 20 kayıt).
      const all = await (await locationsGet(call("/api/locations?q=R"))).json();
      expect(Array.isArray(all)).toBe(true);
      expect(all.length).toBeLessThanOrEqual(20);
    });

    it("routing/optimize: koordinatlı şehirler → plan; büyük/küçük harf duyarsız", async () => {
      const q = new URLSearchParams({
        origin: cityA.toUpperCase(),
        cities: cityB,
        month: "7",
        returnToOrigin: "true",
      });
      const res = await routingGet(call(`/api/routing/optimize?${q}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.origin).toBe(cityA);
      expect(body.cities).toEqual([cityB]);
      expect(body.month).toBe(7);
      expect(body.plan.order).toContain(cityB);
      expect(body.plan.totalKm).toBeGreaterThan(0);
    });

    it("routing/optimize: tekrar 400, koordinatsız 422, eksik/geçersiz parametre 400", async () => {
      const dup = new URLSearchParams({ origin: cityA, cities: `${cityB},${cityA.toLowerCase()}` });
      expect((await routingGet(call(`/api/routing/optimize?${dup}`))).status).toBe(400);

      const noCoord = new URLSearchParams({ origin: cityA, cities: cityNoCoord });
      const res = await routingGet(call(`/api/routing/optimize?${noCoord}`));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toContain(cityNoCoord);

      expect((await routingGet(call("/api/routing/optimize"))).status).toBe(400);
      const badMonth = new URLSearchParams({ origin: cityA, cities: cityB, month: "13" });
      expect((await routingGet(call(`/api/routing/optimize?${badMonth}`))).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe("favoriler ve kullanıcı profili", () => {
    let fx: StayFixture;
    let token: string;

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "fav", days: 5 });
      token = await tokenFor(fx.userId, "USER");
    });

    it("favorites: oturumsuz her yöntem 401", async () => {
      expect((await favoritesGet(call("/api/favorites"))).status).toBe(401);
      expect(
        (await favoritesPost(call("/api/favorites", { body: { propertyId: fx.propertyId } })))
          .status
      ).toBe(401);
      expect(
        (await favoritesDelete(call(`/api/favorites?propertyId=x`, { method: "DELETE" }))).status
      ).toBe(401);
    });

    it("favorites: ekle (idempotent) → listele → kaldır", async () => {
      expect((await favoritesPost(call("/api/favorites", { token, body: {} }))).status).toBe(400);
      expect(
        (await favoritesPost(call("/api/favorites", { token, body: { propertyId: "yok" } }))).status
      ).toBe(404);

      for (let i = 0; i < 2; i++) {
        const res = await favoritesPost(
          call("/api/favorites", { token, body: { propertyId: fx.propertyId } })
        );
        expect(res.status).toBe(201);
        const fav = await res.json();
        expect(fav.propertyId).toBe(fx.propertyId);
        expect(fav.property.basePrice).toBe(1000); // Decimal → number
      }

      const list = await (await favoritesGet(call("/api/favorites", { token }))).json();
      expect(list).toHaveLength(1);
      expect(list[0].property.location.country).toBe("TEST");

      // Başka kullanıcı bu favoriyi görmez.
      const other = await (
        await favoritesGet(call("/api/favorites", { token: strangerToken }))
      ).json();
      expect(other).toEqual([]);

      expect(
        (await favoritesDelete(call("/api/favorites", { method: "DELETE", token }))).status
      ).toBe(400);
      const del = await favoritesDelete(
        call(`/api/favorites?propertyId=${fx.propertyId}`, { method: "DELETE", token })
      );
      expect(del.status).toBe(200);
      expect(await (await favoritesGet(call("/api/favorites", { token }))).json()).toEqual([]);
    });

    it("user/me: 401 / profil / silinmiş kullanıcı 404", async () => {
      expect((await meGet(call("/api/user/me"))).status).toBe(401);
      const res = await meGet(call("/api/user/me", { token }));
      expect(res.status).toBe(200);
      const me = await res.json();
      expect(me.id).toBe(fx.userId);
      expect(me.role).toBe("USER");
      expect(me).not.toHaveProperty("passwordHash");

      const ghost = await tokenFor(`ghost-${stamp}`, "USER");
      expect((await meGet(call("/api/user/me", { token: ghost }))).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe("teklif ve rezervasyon", () => {
    let fx: StayFixture;
    let token: string;

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "book", days: 60 });
      token = await tokenFor(fx.userId, "USER");
    });

    function quoteUrl(params: Record<string, string>) {
      return `/api/quote?${new URLSearchParams(params)}`;
    }

    it("quote: vergi dahil minor-unit teklif (2 gece)", async () => {
      const res = await quoteGet(
        call(
          quoteUrl({
            roomId: fx.roomId,
            propertyId: fx.propertyId,
            checkIn: iso(utcDay(40)),
            checkOut: iso(utcDay(42)),
            guests: "2",
          })
        ),
        undefined
      );
      expect(res.status).toBe(200);
      const q = await res.json();
      expect(q.quoteId).toMatch(/^[0-9a-f-]{36}$/);
      expect(q.nights).toHaveLength(2);
      expect(q.nights[0].amount).toBe(100_000); // 1000 TRY → kuruş
      expect(q.subtotal).toBe(200_000);
      expect(Number.isInteger(q.total)).toBe(true);
      expect(q.total).toBeGreaterThanOrEqual(q.subtotal);
      expect(q.currency).toBe("TRY");
    });

    it("quote: eksik tarih 400, bilinmeyen oda 404, kapasite aşımı 400, mülk uyuşmazlığı 404", async () => {
      const base = { roomId: fx.roomId, checkIn: iso(utcDay(40)), checkOut: iso(utcDay(41)) };
      expect(
        (await quoteGet(call(quoteUrl({ roomId: fx.roomId, checkOut: base.checkOut })), undefined))
          .status
      ).toBe(400);
      const unknown = await quoteGet(call(quoteUrl({ ...base, roomId: "oda-yok" })), undefined);
      expect(unknown.status).toBe(404);
      expect((await quoteGet(call(quoteUrl({ ...base, guests: "5" })), undefined)).status).toBe(
        400
      );
      expect(
        (await quoteGet(call(quoteUrl({ ...base, propertyId: "baska-mulk" })), undefined)).status
      ).toBe(404);
    });

    it("bookings POST: 401, doğrulama 400, bozuk JSON 400", async () => {
      const body = {
        propertyId: fx.propertyId,
        roomId: fx.roomId,
        checkIn: iso(utcDay(10)),
        checkOut: iso(utcDay(12)),
        guestCount: 1,
      };
      expect((await bookingsPost(call("/api/bookings", { body }), undefined)).status).toBe(401);
      const invalid = await bookingsPost(
        call("/api/bookings", { token, body: { ...body, guestCount: 0 } }),
        undefined
      );
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).code).toBe("VALIDATION_ERROR");
      const broken = await bookingsPost(call("/api/bookings", { token, body: "{" }), undefined);
      expect(broken.status).toBe(400);
      expect((await broken.json()).code).toBe("INVALID_JSON");
    });

    it("bookings: HELD oluştur (Idempotency-Key tekrarında aynı kayıt) → listele → çakışma 409", async () => {
      const body = {
        propertyId: fx.propertyId,
        roomId: fx.roomId,
        checkIn: iso(utcDay(10)),
        checkOut: iso(utcDay(12)),
        guestCount: 1,
      };
      const first = await bookingsPost(
        call("/api/bookings", { token, body, headers: { "idempotency-key": `idem-${stamp}` } }),
        undefined
      );
      expect(first.status).toBe(201);
      const created = await first.json();
      expect(created.paymentRequired).toBe(true);
      expect(created.booking.status).toBe("HELD");
      expect(created.booking.totalMinor).toBeGreaterThanOrEqual(200_000);
      expect(Number.isInteger(created.booking.totalMinor)).toBe(true);

      const again = await bookingsPost(
        call("/api/bookings", { token, body, headers: { "idempotency-key": `idem-${stamp}` } }),
        undefined
      );
      expect(again.status).toBe(201);
      expect((await again.json()).booking.id).toBe(created.booking.id);

      const clash = await bookingsPost(
        call("/api/bookings", { token: strangerToken, body }),
        undefined
      );
      expect(clash.status).toBe(409);

      expect((await bookingsGet(call("/api/bookings"), undefined)).status).toBe(401);
      const list = await (await bookingsGet(call("/api/bookings", { token }), undefined)).json();
      expect(list.map((b: { id: string }) => b.id)).toContain(created.booking.id);
      const strangerList = await (
        await bookingsGet(call("/api/bookings", { token: strangerToken }), undefined)
      ).json();
      expect(strangerList.map((b: { id: string }) => b.id)).not.toContain(created.booking.id);
    });

    it("bookings: quoteId ile rezervasyon; fiyat değiştiyse 409 PRICE_CHANGED", async () => {
      const params = {
        roomId: fx.roomId,
        propertyId: fx.propertyId,
        checkIn: iso(utcDay(20)),
        checkOut: iso(utcDay(22)),
      };
      const q = await (await quoteGet(call(quoteUrl(params)), undefined)).json();
      const ok = await bookingsPost(
        call("/api/bookings", {
          token,
          body: { ...params, guestCount: 1, quoteId: q.quoteId },
        }),
        undefined
      );
      expect(ok.status).toBe(201);
      expect((await ok.json()).booking.totalMinor).toBe(q.total);

      const later = { ...params, checkIn: iso(utcDay(25)), checkOut: iso(utcDay(26)) };
      const q2 = await (await quoteGet(call(quoteUrl(later)), undefined)).json();
      await prisma.inventoryDay.updateMany({
        where: { roomTypeId: fx.roomId, date: utcDay(25) },
        data: { price: new Prisma.Decimal(1500) },
      });
      const changed = await bookingsPost(
        call("/api/bookings", { token, body: { ...later, guestCount: 1, quoteId: q2.quoteId } }),
        undefined
      );
      expect(changed.status).toBe(409);
      expect((await changed.json()).code).toBe("PRICE_CHANGED");
    });

    it("bookings/[id]: sahibi görür; başkası GET/DELETE → 404; iptal sonrası GET güncel", async () => {
      const b = await fx.hold({ startInDays: 30 });
      const byOwner = await bookingGet(call(`/api/bookings/${b.id}`, { token }), ctx({ id: b.id }));
      expect(byOwner.status).toBe(200);
      expect((await byOwner.json()).booking.status).toBe("HELD");

      expect((await bookingGet(call(`/api/bookings/${b.id}`), ctx({ id: b.id }))).status).toBe(401);
      const foreign = await bookingGet(
        call(`/api/bookings/${b.id}`, { token: strangerToken }),
        ctx({ id: b.id })
      );
      expect(foreign.status).toBe(404);
      expect((await foreign.json()).code).toBe("BOOKING_NOT_FOUND");
      expect(
        (
          await bookingDelete(
            call(`/api/bookings/${b.id}`, { method: "DELETE", token: strangerToken }),
            ctx({ id: b.id })
          )
        ).status
      ).toBe(404);

      const cancel = await bookingDelete(
        call(`/api/bookings/${b.id}`, { method: "DELETE", token }),
        ctx({ id: b.id })
      );
      expect(cancel.status).toBe(200);
      const outcome = await cancel.json();
      expect(outcome.status).toBe("CANCELLED");
      expect(outcome.refund.currency).toBe("TRY");

      // Önbellekteki eski "HELD" kopyası dönmemeli.
      const after = await bookingGet(call(`/api/bookings/${b.id}`, { token }), ctx({ id: b.id }));
      expect((await after.json()).booking.status).toBe("CANCELLED");
    });
  });

  // ---------------------------------------------------------------------------
  describe("ödeme ve 3DS", () => {
    let fx: StayFixture;

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "pay", days: 90 });
    });

    /** Her senaryo ayrı misafir: kullanıcı hız/başarısız ödeme kuralları birikmez. */
    async function guestHold() {
      const guest = await makeUser("payer");
      const b = await fx.hold({ userId: guest.id });
      return { ...b, userId: guest.id, token: await tokenFor(guest.id, "USER") };
    }

    it("pay: 401, Idempotency-Key yok 400, geçersiz gövde 400, başkasının rezervasyonu 404", async () => {
      const b = await guestHold();
      const card = nextCard();
      expect(
        (
          await payPost(
            call(`/api/bookings/${b.id}/pay`, { body: { cardToken: card } }),
            ctx({ id: b.id })
          )
        ).status
      ).toBe(401);
      const noKey = await payPost(
        call(`/api/bookings/${b.id}/pay`, { token: b.token, body: { cardToken: card } }),
        ctx({ id: b.id })
      );
      expect(noKey.status).toBe(400);
      expect((await noKey.json()).code).toBe("VALIDATION_ERROR");
      expect((await payPost(payRequest(b.id, b.token, "kisa"), ctx({ id: b.id }))).status).toBe(
        400
      );
      expect((await payPost(payRequest(b.id, strangerToken, card), ctx({ id: b.id }))).status).toBe(
        404
      );
    });

    it("pay: onaylanan kart → 200 confirmed, defter = toplam; tekrar istek idempotent", async () => {
      const b = await guestHold();
      const card = nextCard();
      const res = await payPost(payRequest(b.id, b.token, card), ctx({ id: b.id }));
      expect(res.status).toBe(200);
      const out = await res.json();
      expect(out.status).toBe("confirmed");
      expect(out.amount).toBe(b.totalMinor);
      expect(out.currency).toBe("TRY");
      expect(await ledgerNetMinor(prisma, b.id)).toBe(b.totalMinor);

      const again = await payPost(payRequest(b.id, b.token, card, "k2"), ctx({ id: b.id }));
      expect(again.status).toBe(200);
      expect((await again.json()).paymentId).toBe(out.paymentId);
      expect(await ledgerNetMinor(prisma, b.id)).toBe(b.totalMinor);
    });

    it("pay: reddedilen kart → 402 PAYMENT_DECLINED, rezervasyon HELD kalır", async () => {
      const b = await guestHold();
      const res = await payPost(payRequest(b.id, b.token, nextCard("decline")), ctx({ id: b.id }));
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.code).toBe("PAYMENT_DECLINED");
      expect(body.details.declineCode).toBe("card_declined");
      const row = await prisma.booking.findUniqueOrThrow({
        where: { id: b.id },
        include: { payment: true },
      });
      expect(row.status).toBe("HELD");
      expect(row.payment?.status).toBe("FAILED");
      expect(await ledgerNetMinor(prisma, b.id)).toBe(0);
    });

    it("3DS: 202 requires_action → confirm (401/404/400) → doğru kodla 200 confirmed", async () => {
      const b = await guestHold();
      // Önbelleği ısıt: ödeme öncesi okuma `payment: null` olarak önbelleğe girer.
      await bookingGet(call(`/api/bookings/${b.id}`, { token: b.token }), ctx({ id: b.id }));
      const res = await payPost(payRequest(b.id, b.token, nextCard("3ds")), ctx({ id: b.id }));
      expect(res.status).toBe(202);
      const out = await res.json();
      expect(out.status).toBe("requires_action");
      expect(out.challenge.type).toBe("3ds_otp");
      // Rezervasyon okuma önbelleği 3DS yolunda da düşer (bayat `payment: null` yok).
      const fresh = await (
        await bookingGet(call(`/api/bookings/${b.id}`, { token: b.token }), ctx({ id: b.id }))
      ).json();
      expect(fresh.booking.payment?.status).toBe("REQUIRES_ACTION");

      const confirmUrl = `/api/bookings/${b.id}/pay/confirm`;
      expect(
        (
          await payConfirmPost(
            call(confirmUrl, { body: { code: MOCK_3DS_CODE } }),
            ctx({ id: b.id })
          )
        ).status
      ).toBe(401);
      expect(
        (
          await payConfirmPost(
            call(confirmUrl, { token: strangerToken, body: { code: MOCK_3DS_CODE } }),
            ctx({ id: b.id })
          )
        ).status
      ).toBe(404);
      expect(
        (
          await payConfirmPost(
            call(confirmUrl, { token: b.token, body: { code: "abc" } }),
            ctx({ id: b.id })
          )
        ).status
      ).toBe(400);

      const ok = await payConfirmPost(
        call(confirmUrl, { token: b.token, body: { code: MOCK_3DS_CODE } }),
        ctx({ id: b.id })
      );
      expect(ok.status).toBe(200);
      const confirmed = await ok.json();
      expect(confirmed.status).toBe("confirmed");
      expect(confirmed.amount).toBe(b.totalMinor);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
        "CONFIRMED"
      );
    });

    it("3DS confirm: bekleyen doğrulama yoksa 409 NO_PENDING_CHALLENGE", async () => {
      const b = await guestHold();
      const res = await payConfirmPost(
        call(`/api/bookings/${b.id}/pay/confirm`, {
          token: b.token,
          body: { code: MOCK_3DS_CODE },
        }),
        ctx({ id: b.id })
      );
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("NO_PENDING_CHALLENGE");
    });
  });

  // ---------------------------------------------------------------------------
  describe("PSP webhook", () => {
    let fx: StayFixture;

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "whk", days: 40 });
    });

    function webhookRequest(raw: string, signature: string | null) {
      return call("/api/payments/webhook", {
        body: raw,
        headers: signature ? { "x-psp-signature": signature } : {},
      });
    }
    const now = () => Math.floor(Date.now() / 1000);

    it("imza yok / yanlış / süresi geçmiş / gövde geçersiz → 400 INVALID_SIGNATURE", async () => {
      const raw = JSON.stringify({
        id: `evt_bad_${stamp}`,
        type: "payment.failed",
        data: { providerRef: "pi_x" },
      });
      const cases = [
        webhookRequest(raw, null),
        webhookRequest(raw, `t=${now()},v1=${"0".repeat(64)}`),
        webhookRequest(raw, signWebhook(raw, now() - 3600)),
        webhookRequest("bu json değil", signWebhook("bu json değil", now())),
        webhookRequest('{"id":"x"}', signWebhook('{"id":"x"}', now())),
      ];
      for (const r of cases) {
        const res = await webhookPost(r);
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("INVALID_SIGNATURE");
      }
    });

    it("bilinmeyen ödeme referansı → 200 kaydedilir; replay duplicate", async () => {
      const raw = JSON.stringify({
        id: `evt_unknown_${stamp}`,
        type: "payment.failed",
        data: { providerRef: `pi_unknown_${stamp}` },
      });
      const first = await webhookPost(webhookRequest(raw, signWebhook(raw, now())));
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ received: true, duplicate: false });
      const replay = await webhookPost(webhookRequest(raw, signWebhook(raw, now())));
      expect(await replay.json()).toEqual({ received: true, duplicate: true });
    });

    it("3DS bekleyen ödeme: tutar uyuşmazlığı 400; geçerli olay onaylar; replay etkisiz", async () => {
      const guest = await makeUser("whk");
      const token = await tokenFor(guest.id, "USER");
      const b = await fx.hold({ userId: guest.id });
      const pay = await payPost(payRequest(b.id, token, nextCard("3ds")), ctx({ id: b.id }));
      expect(pay.status).toBe(202);
      const ref = (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } }))
        .providerRef!;

      const mismatch = JSON.stringify({
        id: `evt_mm_${stamp}`,
        type: "payment.succeeded",
        data: { providerRef: ref, amount: b.totalMinor + 1, currency: "TRY" },
      });
      const mm = await webhookPost(webhookRequest(mismatch, signWebhook(mismatch, now())));
      expect(mm.status).toBe(400);
      expect((await mm.json()).code).toBe("WEBHOOK_MISMATCH");
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("HELD");

      const raw = JSON.stringify({
        id: `evt_ok_${stamp}`,
        type: "payment.succeeded",
        data: { providerRef: ref, amount: b.totalMinor, currency: "TRY" },
      });
      const ok = await webhookPost(webhookRequest(raw, signWebhook(raw, now())));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ received: true, duplicate: false });
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: b.id },
        include: { payment: true },
      });
      expect(booking.status).toBe("CONFIRMED");
      expect(booking.payment?.status).toBe("PAID");
      expect(await ledgerNetMinor(prisma, b.id)).toBe(b.totalMinor);

      const replay = await webhookPost(webhookRequest(raw, signWebhook(raw, now())));
      expect(replay.status).toBe(200);
      expect((await replay.json()).duplicate).toBe(true);
      expect(await ledgerNetMinor(prisma, b.id)).toBe(b.totalMinor);
    });
  });

  // ---------------------------------------------------------------------------
  describe("arama ve mülk listeleri", () => {
    let fx: StayFixture;
    let title: string;

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "srch", days: 30 });
      title = (await prisma.property.findUniqueOrThrow({ where: { id: fx.propertyId } })).title;
    });

    it("search: destination ile deterministik sonuç; sayfa boyutu 50 ile sınırlı", async () => {
      const res = await searchGet(
        call(`/api/search?destination=${encodeURIComponent(title)}&pageSize=500`),
        undefined
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      // Hibrit arama (v3#19) sıralı geri getirir: tam başlık eşleşmesi ilk sıradadır, benzer
      // ilanlar (ortak "Otel" sözcüğü) ardından gelebilir.
      expect(body.results[0]?.id).toBe(fx.propertyId);
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.results.length).toBeLessThanOrEqual(50);
      expect(body.pageSize).toBe(50);
      expect(body.results[0].basePrice).toBe(1000);

      // Oturumlu istek de aynı sonucu verir (kişiselleştirme yalnız sıralamayı etkiler).
      const authed = await searchGet(
        call(
          `/api/search?destination=${encodeURIComponent(title)}&checkIn=${iso(utcDay(3))}&checkOut=${iso(utcDay(5))}&guests=2`,
          { token: strangerToken }
        ),
        undefined
      );
      expect(authed.status).toBe(200);
      const withDates = await authed.json();
      expect(withDates.results[0]?.id).toBe(fx.propertyId);
      expect(Number.isInteger(withDates.results[0].quote.total)).toBe(true);
    });

    it("search/smart: kısa metin 400; demo LLM filtreleri ai_generated ile işaretli", async () => {
      expect(
        (await smartSearchPost(call("/api/search/smart", { body: { text: "ab" } }), undefined))
          .status
      ).toBe(400);
      const res = await smartSearchPost(
        call("/api/search/smart", { body: { text: "2 kişilik havuzlu otel, en ucuz" } }),
        undefined
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ai_generated).toBe(true);
      expect(body.filters.ai_generated).toBe(true);
      expect(body.llmMode).toBe("demo");
      expect(Array.isArray(body.results)).toBe(true);
      expect(typeof body.total).toBe("number");
    });

    it("properties GET: liste ve popüler görünüm", async () => {
      const list = await propertiesGet(call(`/api/properties?query=${encodeURIComponent(title)}`));
      expect(list.status).toBe(200);
      expect((await list.json()).results[0]?.id).toBe(fx.propertyId);

      const popular = await propertiesGet(call("/api/properties?popular=true&limit=3"));
      expect(popular.status).toBe(200);
      const body = await popular.json();
      expect(body.page).toBe(1);
      expect(body.total).toBe(body.results.length);
      expect(body.cached).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe("mülk yönetimi (host)", () => {
    let fx: StayFixture;
    let hostToken: string;
    let userToken: string;

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "prop", days: 10 });
      hostToken = await tokenFor(fx.hostId, "HOST");
      userToken = await tokenFor(fx.userId, "USER");
    });

    const newProperty = (extra: Record<string, unknown> = {}) => ({
      title: `Yeni İlan ${stamp}`,
      description: "Deniz manzaralı, merkezi konumda test ilanı.",
      propertyType: "VILLA",
      city: `Yenikent-${stamp}`,
      country: "TEST",
      basePrice: 1500,
      amenities: [`Havuz-${stamp}`],
      images: ["https://images.example.com/villa.jpg"],
      rooms: [{ name: "Suit", capacity: 3, bedType: "King" }],
      ...extra,
    });

    it("properties POST: 401 / USER 403 / doğrulama 400 / olmayan politika 400", async () => {
      expect((await propertiesPost(call("/api/properties", { body: newProperty() }))).status).toBe(
        401
      );
      expect(
        (await propertiesPost(call("/api/properties", { token: userToken, body: newProperty() })))
          .status
      ).toBe(403);
      const invalid = await propertiesPost(
        call("/api/properties", {
          token: hostToken,
          body: newProperty({ images: ["http://guvensiz.example.com/a.jpg"], rooms: [] }),
        })
      );
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).details.fieldErrors).toHaveProperty("rooms");
      const policy = await propertiesPost(
        call("/api/properties", {
          token: hostToken,
          body: newProperty({ cancellationPolicyId: "politika-yok" }),
        })
      );
      expect(policy.status).toBe(400);
    });

    it("properties POST: belge numarasız ilan pasif, belgeli ilan aktif; outbox olayı yazılır", async () => {
      const draft = await propertiesPost(
        call("/api/properties", { token: hostToken, body: newProperty() })
      );
      expect(draft.status).toBe(201);
      const d = await draft.json();
      expect(d.isActive).toBe(false);
      expect(d.basePrice).toBe("1500"); // Decimal JSON'da string olarak serileşir
      expect(d.location).toEqual({ city: `Yenikent-${stamp}`, country: "TEST" });

      const live = await propertiesPost(
        call("/api/properties", {
          token: hostToken,
          body: newProperty({ licenseNumber: "34-12345", currency: "EUR" }),
        })
      );
      expect(live.status).toBe(201);
      const l = await live.json();
      expect(l.isActive).toBe(true);
      expect(l.currency).toBe("EUR");
      const outbox = await prisma.outboxMessage.findFirst({
        where: { aggregateId: l.id, eventType: "property.created" },
      });
      expect(outbox).not.toBeNull();
      const stored = await prisma.property.findUniqueOrThrow({
        where: { id: l.id },
        include: { rooms: true, amenities: true },
      });
      expect(stored.hostId).toBe(fx.hostId);
      expect(stored.rooms).toHaveLength(1);
      expect(stored.amenities.map((a) => a.name)).toEqual([`Havuz-${stamp}`]);
    });

    it("properties/[id] GET: aktif mülk detayı; pasif veya olmayan 404", async () => {
      const res = await propertyGet(
        call(`/api/properties/${fx.propertyId}`),
        ctx({ id: fx.propertyId })
      );
      expect(res.status).toBe(200);
      const p = await res.json();
      expect(p.id).toBe(fx.propertyId);
      expect(p.basePrice).toBe(1000);
      expect(p.rooms[0].id).toBe(fx.roomId);
      expect(p.rooms[0].priceModifier).toBe(0);

      expect((await propertyGet(call("/api/properties/yok"), ctx({ id: "yok" }))).status).toBe(404);
      const inactive = await createStayFixture(prisma, { tag: "inact", days: 1 });
      await prisma.property.update({
        where: { id: inactive.propertyId },
        data: { isActive: false },
      });
      expect(
        (
          await propertyGet(
            call(`/api/properties/${inactive.propertyId}`),
            ctx({ id: inactive.propertyId })
          )
        ).status
      ).toBe(404);
    });

    it("properties/[id] PATCH: sahibi günceller; başka host 404; USER 403; belgesiz yayın 400", async () => {
      const url = `/api/properties/${fx.propertyId}`;
      const c = ctx({ id: fx.propertyId });
      expect(
        (await propertyPatch(call(url, { method: "PATCH", token: userToken, body: {} }), c)).status
      ).toBe(403);
      expect(
        (
          await propertyPatch(
            call(url, { method: "PATCH", token: otherHostToken, body: { title: "Ele geçir" } }),
            c
          )
        ).status
      ).toBe(404);
      const noLicense = await propertyPatch(
        call(url, { method: "PATCH", token: hostToken, body: { isActive: true } }),
        c
      );
      expect(noLicense.status).toBe(400);

      const ok = await propertyPatch(
        call(url, {
          method: "PATCH",
          token: hostToken,
          body: { title: `Güncel Otel ${stamp}`, basePrice: 1250 },
        }),
        c
      );
      expect(ok.status).toBe(200);
      const updated = await ok.json();
      expect(updated.title).toBe(`Güncel Otel ${stamp}`);
      expect(Number(updated.basePrice)).toBe(1250);

      // Yönetici her mülkü düzenleyebilir.
      const byAdmin = await propertyPatch(
        call(url, { method: "PATCH", token: adminToken, body: { licenseNumber: "06-1234" } }),
        c
      );
      expect(byAdmin.status).toBe(200);
      expect((await byAdmin.json()).licenseNumber).toBe("06-1234");
    });

    it("properties/[id]/rooms: oda ekle / güncelle; başka host 404, geçersiz gövde 400", async () => {
      const url = `/api/properties/${fx.propertyId}/rooms`;
      const c = ctx({ id: fx.propertyId });
      const room = { name: "Aile Odası", capacity: 4, bedType: "2 Çift", priceModifier: 250 };
      expect((await roomsPost(call(url, { token: otherHostToken, body: room }), c)).status).toBe(
        404
      );
      expect(
        (await roomsPost(call(url, { token: hostToken, body: { ...room, capacity: 0 } }), c)).status
      ).toBe(400);

      const created = await roomsPost(call(url, { token: hostToken, body: room }), c);
      expect(created.status).toBe(201);
      const r = await created.json();
      expect(r.propertyId).toBe(fx.propertyId);
      expect(r.capacity).toBe(4);

      const patched = await roomsPatch(
        call(url, {
          method: "PATCH",
          token: hostToken,
          body: { roomId: r.id, available: false, name: "Aile Odası (kapalı)" },
        }),
        c
      );
      expect(patched.status).toBe(200);
      const p = await patched.json();
      expect(p.available).toBe(false);
      expect(p.name).toBe("Aile Odası (kapalı)");

      expect(
        (
          await roomsPatch(
            call(url, { method: "PATCH", token: otherHostToken, body: { roomId: r.id } }),
            c
          )
        ).status
      ).toBe(404);
    });

    it("host/properties ve host/bookings: USER 403; host yalnızca kendi kayıtlarını görür", async () => {
      expect(
        (await hostPropertiesGet(call("/api/host/properties", { token: userToken }))).status
      ).toBe(403);
      expect((await hostBookingsGet(call("/api/host/bookings"))).status).toBe(401);

      const b = await fx.hold({ startInDays: 3 });
      const props = await (
        await hostPropertiesGet(call("/api/host/properties", { token: hostToken }))
      ).json();
      expect(props.map((p: { id: string }) => p.id)).toContain(fx.propertyId);
      const bookings = await (
        await hostBookingsGet(call("/api/host/bookings", { token: hostToken }))
      ).json();
      expect(bookings.map((x: { id: string }) => x.id)).toEqual([b.id]);

      const foreign = await (
        await hostBookingsGet(call("/api/host/bookings", { token: otherHostToken }))
      ).json();
      expect(foreign).toEqual([]);
      const adminView = await (
        await hostPropertiesGet(call("/api/host/properties", { token: adminToken }))
      ).json();
      expect(adminView.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe("yorumlar ve yanıtlar", () => {
    let fx: StayFixture;
    let guestToken: string;
    let hostToken: string;
    let pastBookingId: string;
    let reviewId: string;

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "rev", days: 20 });
      guestToken = await tokenFor(fx.userId, "USER");
      hostToken = await tokenFor(fx.hostId, "HOST");
      const past = await prisma.booking.create({
        data: {
          userId: fx.userId,
          propertyId: fx.propertyId,
          roomId: fx.roomId,
          checkIn: utcDay(-5),
          checkOut: utcDay(-3),
          guestCount: 1,
          totalPrice: new Prisma.Decimal(2000),
          status: "COMPLETED",
        },
      });
      pastBookingId = past.id;
    });

    it("reviews POST: 401, geçersiz puan 400, başkasının rezervasyonu 403, gelecek konaklama 403", async () => {
      const url = `/api/properties/${fx.propertyId}/reviews`;
      const c = ctx({ id: fx.propertyId });
      expect(
        (await reviewsPost(call(url, { body: { bookingId: pastBookingId, rating: 5 } }), c)).status
      ).toBe(401);
      expect(
        (
          await reviewsPost(
            call(url, { token: guestToken, body: { bookingId: pastBookingId, rating: 6 } }),
            c
          )
        ).status
      ).toBe(400);
      expect(
        (
          await reviewsPost(
            call(url, { token: strangerToken, body: { bookingId: pastBookingId, rating: 4 } }),
            c
          )
        ).status
      ).toBe(403);
      const future = await fx.hold();
      expect(
        (
          await reviewsPost(
            call(url, { token: guestToken, body: { bookingId: future.id, rating: 4 } }),
            c
          )
        ).status
      ).toBe(403);
    });

    it("reviews: tamamlanmış konaklama → 201; ikinci yorum 409; liste ve puan ortalaması", async () => {
      const url = `/api/properties/${fx.propertyId}/reviews`;
      const c = ctx({ id: fx.propertyId });
      const res = await reviewsPost(
        call(url, {
          token: guestToken,
          body: { bookingId: pastBookingId, rating: 4, comment: "  Temiz ve sessiz.  " },
        }),
        c
      );
      expect(res.status).toBe(201);
      const review = await res.json();
      reviewId = review.id;
      expect(review.comment).toBe("Temiz ve sessiz.");

      const dup = await reviewsPost(
        call(url, { token: guestToken, body: { bookingId: pastBookingId, rating: 5 } }),
        c
      );
      expect(dup.status).toBe(409);
      expect((await dup.json()).code).toBe("REVIEW_EXISTS");

      const list = await (await reviewsGet(call(url), c)).json();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: reviewId,
        rating: 4,
        author: "Test K.",
        verifiedStay: true,
      });
      const property = await prisma.property.findUniqueOrThrow({ where: { id: fx.propertyId } });
      expect(property.ratingCount).toBe(1);
      expect(property.ratingAvg).toBe(4);
    });

    it("reviews/summary: demo LLM özeti ai_generated ile işaretli", async () => {
      const res = await reviewSummaryGet(
        call(`/api/properties/${fx.propertyId}/reviews/summary`),
        ctx({ id: fx.propertyId })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ai_generated).toBe(true);
      expect(body.llmMode).toBe("demo");
      expect(body.reviewCount).toBe(1);
      expect(typeof body.summary).toBe("string");
    });

    it("reviews/[id]/reply: USER 403, başka host 404, sahibi host 200", async () => {
      const url = `/api/reviews/${reviewId}/reply`;
      const c = ctx({ id: reviewId });
      const body = { text: "Teşekkür ederiz, yine bekleriz!" };
      expect((await reviewReplyPost(call(url, { token: guestToken, body }), c)).status).toBe(403);
      expect((await reviewReplyPost(call(url, { token: otherHostToken, body }), c)).status).toBe(
        404
      );
      expect(
        (await reviewReplyPost(call(url, { token: hostToken, body: { text: "x" } }), c)).status
      ).toBe(400);
      const ok = await reviewReplyPost(call(url, { token: hostToken, body }), c);
      expect(ok.status).toBe(200);
      const updated = await ok.json();
      expect(updated.hostReply).toBe(body.text);
      expect(updated.hostRepliedAt).not.toBeNull();
      // ADMIN her mülkün yorumuna yanıt verebilir (önceden daima 404 dönüyordu).
      const byAdmin = await reviewReplyPost(
        call(url, { token: adminToken, body: { text: "Platform adına teşekkürler." } }),
        c
      );
      expect(byAdmin.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  describe("oturum ve hesap", () => {
    it("auth/refresh: token yok 401; gövdeyle rotasyon 200; eski token tekrar 401; çerezle 200", async () => {
      const res401 = await refreshPost(call("/api/auth/refresh", { method: "POST" }));
      expect(res401.status).toBe(401);

      const user = await makeUser("refresh");
      const session = await issueSession({ id: user.id, role: "USER" });
      const rotated = await refreshPost(
        call("/api/auth/refresh", { body: { refreshToken: session.refreshToken } })
      );
      expect(rotated.status).toBe(200);
      const body = await rotated.json();
      expect(body.user.id).toBe(user.id);
      expect(typeof body.accessToken).toBe("string");
      expect(rotated.headers.get("set-cookie")).toContain(REFRESH_COOKIE);

      const reused = await refreshPost(
        call("/api/auth/refresh", { body: { refreshToken: session.refreshToken } })
      );
      expect(reused.status).toBe(401);

      const fresh = await issueSession({ id: user.id, role: "USER" });
      const viaCookie = await refreshPost(
        call("/api/auth/refresh", {
          method: "POST",
          headers: { cookie: `${REFRESH_COOKIE}=${fresh.refreshToken}` },
        })
      );
      expect(viaCookie.status).toBe(200);
    });

    it("auth/logout: erişim token'ı iptal edilir, çerezler silinir; oturumsuz da 200", async () => {
      const user = await makeUser("logout");
      const token = await tokenFor(user.id, "USER");
      const res = await logoutPost(call("/api/auth/logout", { method: "POST", token }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(res.headers.get("set-cookie")).toBeTruthy();
      const again = new NextRequest(`${BASE}/api/x`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(await getAuth(again)).toBeNull();

      expect((await logoutPost(call("/api/auth/logout", { method: "POST" }))).status).toBe(200);
    });

    it("account GET: KVKK dışa aktarım JSON eki; oturumsuz 401", async () => {
      expect((await accountGet(call("/api/account"))).status).toBe(401);
      const fx = await createStayFixture(prisma, { tag: "export", days: 10 });
      const b = await fx.hold();
      const res = await accountGet(
        call("/api/account", { token: await tokenFor(fx.userId, "USER") })
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("attachment");
      const data = await res.json();
      expect(data.user.id).toBe(fx.userId);
      expect(data.user.bookings.map((x: { id: string }) => x.id)).toContain(b.id);
      expect(JSON.stringify(data)).not.toContain("passwordHash");
    });

    it("account DELETE: hesap anonimleşir ve aynı token artık geçersiz", async () => {
      const user = await makeUser("delete");
      const token = await tokenFor(user.id, "USER");
      const res = await accountDelete(call("/api/account", { method: "DELETE", token }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(true);
      expect(body.cancelledBookings).toEqual([]);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt
      ).not.toBeNull();
      expect((await accountGet(call("/api/account", { token }))).status).toBe(401);
    });

    it("account/passkeys: boş liste; kimliksiz silme 400; bilinmeyen kimlik 404", async () => {
      const user = await makeUser("passkey");
      const token = await tokenFor(user.id, "USER");
      expect((await passkeysGet(call("/api/account/passkeys"), undefined)).status).toBe(401);
      const list = await passkeysGet(call("/api/account/passkeys", { token }), undefined);
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({ passkeys: [] });
      expect(
        (
          await passkeysDelete(
            call("/api/account/passkeys", { method: "DELETE", token }),
            undefined
          )
        ).status
      ).toBe(400);
      const missing = await passkeysDelete(
        call("/api/account/passkeys?id=yok", { method: "DELETE", token }),
        undefined
      );
      expect(missing.status).toBe(404);
      expect((await missing.json()).code).toBe("NOT_FOUND");
    });

    it("verify-email/resend: doğrulanmamış → 202 + outbox; doğrulanmış → alreadyVerified", async () => {
      const user = await makeUser("resend");
      const token = await tokenFor(user.id, "USER");
      expect(
        (await resendPost(call("/api/auth/verify-email/resend", { method: "POST" }), undefined))
          .status
      ).toBe(401);
      const res = await resendPost(
        call("/api/auth/verify-email/resend", { method: "POST", token }),
        undefined
      );
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ sent: true });
      const msg = await prisma.outboxMessage.findFirst({
        where: {
          eventType: "auth.email_requested",
          payload: { path: ["userId"], equals: user.id },
        },
      });
      expect((msg?.payload as { kind?: string } | undefined)?.kind).toBe("EMAIL_VERIFY");

      await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      const verified = await resendPost(
        call("/api/auth/verify-email/resend", { method: "POST", token }),
        undefined
      );
      expect(verified.status).toBe(200);
      expect(await verified.json()).toEqual({ alreadyVerified: true });
    });

    it("regression: v4#5 dev/mailbox: demo modunda herkes (ADMIN dahil) yalnız kendi e-postasını görür; prod'da 404", async () => {
      const user = await makeUser("mail");
      const token = await tokenFor(user.id, "USER");
      const note = await prisma.notification.create({
        data: {
          dedupeKey: `api-routes-${stamp}`,
          userId: user.id,
          to: user.email,
          subject: "Hoş geldiniz",
          text: "Merhaba",
          html: "<p>Merhaba</p>",
        },
      });
      expect((await mailboxGet(call("/api/dev/mailbox"))).status).toBe(401);
      const own = await (await mailboxGet(call("/api/dev/mailbox", { token }))).json();
      expect(own.map((n: { id: string }) => n.id)).toEqual([note.id]);
      const others = await (
        await mailboxGet(call("/api/dev/mailbox", { token: strangerToken }))
      ).json();
      expect(others.map((n: { id: string }) => n.id)).not.toContain(note.id);
      // ADMIN başkasının (ör. parola sıfırlama) e-postasını okuyamaz.
      const all = await (await mailboxGet(call("/api/dev/mailbox", { token: adminToken }))).json();
      expect(all.map((n: { id: string }) => n.id)).not.toContain(note.id);

      process.env.DEMO_MODE = "false";
      try {
        expect((await mailboxGet(call("/api/dev/mailbox", { token }))).status).toBe(404);
      } finally {
        delete process.env.DEMO_MODE;
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe("yönetici uçları", () => {
    it("admin/outbox: USER 403; DEAD mesaj listelenir, yeniden kuyruğa alınır, tekrar 404", async () => {
      expect((await outboxGet(call("/api/admin/outbox", { token: strangerToken }))).status).toBe(
        403
      );
      const dead = await prisma.outboxMessage.create({
        data: {
          eventType: "test.api_routes",
          aggregateId: `agg-${stamp}`,
          aggregateType: "test",
          payload: {},
          status: "DEAD",
          attempts: 5,
          lastError: "boom",
        },
      });
      try {
        const res = await outboxGet(call("/api/admin/outbox", { token: adminToken }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.counts.DEAD).toBeGreaterThanOrEqual(1);
        expect(body.dead.map((d: { id: string }) => d.id)).toContain(dead.id);

        expect(
          (await outboxPost(call("/api/admin/outbox", { token: adminToken, body: {} }))).status
        ).toBe(400);
        const requeue = await outboxPost(
          call("/api/admin/outbox", { token: adminToken, body: { id: dead.id } })
        );
        expect(requeue.status).toBe(200);
        const row = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: dead.id } });
        expect(row.status).toBe("PENDING");
        expect(row.attempts).toBe(0);
        expect(
          await prisma.auditLog.count({ where: { action: "outbox.requeue", entityId: dead.id } })
        ).toBe(1);

        const again = await outboxPost(
          call("/api/admin/outbox", { token: adminToken, body: { id: dead.id } })
        );
        expect(again.status).toBe(404);
      } finally {
        // Başka dosyalardaki relay testlerini etkilemesin.
        await prisma.outboxMessage.delete({ where: { id: dead.id } });
      }
    });

    it("admin/events: metinden öneri (demo LLM) → onay → yield hold → geri alma", async () => {
      const fx = await createStayFixture(prisma, { tag: "evt", days: 40 });
      const { location } = await prisma.property.findUniqueOrThrow({
        where: { id: fx.propertyId },
        include: { location: true },
      });
      expect((await eventsGet(call("/api/admin/events", { token: strangerToken }))).status).toBe(
        403
      );
      const text = `${location.city} şehrinde ${iso(utcDay(20))} ile ${iso(utcDay(22))} arasında büyük konser düzenlenecek.`;
      expect(
        (await eventsPost(call("/api/admin/events", { token: adminToken, body: { text: "kısa" } })))
          .status
      ).toBe(400);
      const res = await eventsPost(
        call("/api/admin/events", { token: adminToken, body: { text } })
      );
      expect(res.status).toBe(201);
      const proposal = await res.json();
      expect(proposal.ai_generated).toBe(true);
      expect(proposal.llmMode).toBe("demo");
      expect(proposal.event.status).toBe("PROPOSED");
      expect(proposal.event.locationId).toBe(location.id);
      expect(proposal.extraction.category).toBe("konser");
      const id: string = proposal.event.id;

      const list = await (await eventsGet(call("/api/admin/events", { token: adminToken }))).json();
      expect(list.map((e: { id: string }) => e.id)).toContain(id);

      const act = (action: string, body?: unknown, token = adminToken) =>
        eventActionPost(
          call(`/api/admin/events/${id}/${action}`, { method: "POST", token, body }),
          ctx({ id, action })
        );

      expect((await act("approve", undefined, strangerToken)).status).toBe(403);
      expect((await act("bilinmeyen")).status).toBe(404);
      expect((await act("yield-hold", { share: 0.1 })).status).toBe(409); // henüz onaysız

      const approved = await act("approve");
      expect(approved.status).toBe(200);
      expect((await approved.json()).event.status).toBe("APPROVED");

      expect((await act("yield-hold", { share: 0.9 })).status).toBe(400);
      const hold = await act("yield-hold", { share: 0.2 });
      expect(hold.status).toBe(200);
      expect(typeof (await hold.json()).held).toBe("number");
      const release = await act("release-hold");
      expect(release.status).toBe(200);
      expect(typeof (await release.json()).released).toBe("number");

      const rolled = await act("rollback");
      expect(rolled.status).toBe(200);
      expect((await rolled.json()).event.status).toBe("ROLLED_BACK");
      const reject = await act("reject");
      expect(reject.status).toBe(409);
      expect((await reject.json()).code).toBe("INVALID_STATE");
      expect(
        await prisma.auditLog.count({ where: { entityId: id, actorId: adminId } })
      ).toBeGreaterThanOrEqual(5);

      const ghost = await eventActionPost(
        call(`/api/admin/events/yok-${stamp}/approve`, { method: "POST", token: adminToken }),
        ctx({ id: `yok-${stamp}`, action: "approve" })
      );
      expect(ghost.status).toBe(404);
    });

    it("admin/fraud: inceleme kuyruğu ve karar", async () => {
      expect((await fraudGet(call("/api/admin/fraud"))).status).toBe(401);
      expect((await fraudGet(call("/api/admin/fraud", { token: strangerToken }))).status).toBe(403);
      const check = await prisma.fraudCheck.create({
        data: {
          bookingId: `bk-${stamp}`,
          userId: strangerId,
          score: 55,
          decision: "review",
          reasons: [{ rule: "velocity_user", points: 25 }],
        },
      });
      const list = await (await fraudGet(call("/api/admin/fraud", { token: adminToken }))).json();
      expect(list.map((f: { id: string }) => f.id)).toContain(check.id);

      expect(
        (
          await fraudPost(
            call("/api/admin/fraud", {
              token: adminToken,
              body: { id: check.id, resolution: "belki" },
            })
          )
        ).status
      ).toBe(400);
      // Var olmayan kayıt: Prisma P2025 → 404 (önceden 500).
      const missing = await fraudPost(
        call("/api/admin/fraud", { token: adminToken, body: { id: "yok", resolution: "legit" } })
      );
      expect(missing.status).toBe(404);
      const res = await fraudPost(
        call("/api/admin/fraud", { token: adminToken, body: { id: check.id, resolution: "legit" } })
      );
      expect(res.status).toBe(200);
      const row = await prisma.fraudCheck.findUniqueOrThrow({ where: { id: check.id } });
      expect(row.decision).toBe("cleared");
      expect(row.reviewedBy).toBe(adminId);
      const after = await (await fraudGet(call("/api/admin/fraud", { token: adminToken }))).json();
      expect(after.map((f: { id: string }) => f.id)).not.toContain(check.id);
    });
  });

  // ---------------------------------------------------------------------------
  describe("rezervasyon devri (transfers)", () => {
    let fx: StayFixture;
    let sellerToken: string;
    let buyerId: string;
    let buyerToken: string;
    let bookingId: string;
    let totalMinor: number;

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "xfer", days: 40 });
      sellerToken = await tokenFor(fx.userId, "USER");
      const buyer = await makeUser("buyer");
      buyerId = buyer.id;
      buyerToken = await tokenFor(buyer.id, "USER");
      const b = await fx.hold({ startInDays: 20 });
      bookingId = b.id;
      totalMinor = b.totalMinor;
      const paid = await payPost(payRequest(b.id, sellerToken, nextCard()), ctx({ id: b.id }));
      expect(paid.status).toBe(200);
    });

    it("transfers POST: 401, başkasının rezervasyonu 404, HELD 409, üst sınır aşımı 400", async () => {
      const body = { bookingId, askPriceMinor: totalMinor };
      expect((await transfersPost(call("/api/transfers", { body }))).status).toBe(401);
      expect(
        (await transfersPost(call("/api/transfers", { token: strangerToken, body }))).status
      ).toBe(404);
      const held = await fx.hold({ startInDays: 25 });
      const heldRes = await transfersPost(
        call("/api/transfers", {
          token: sellerToken,
          body: { bookingId: held.id, askPriceMinor: 100 },
        })
      );
      expect(heldRes.status).toBe(409);
      const tooHigh = await transfersPost(
        call("/api/transfers", {
          token: sellerToken,
          body: { bookingId, askPriceMinor: totalMinor + 1 },
        })
      );
      expect(tooHigh.status).toBe(400);
      expect((await tooHigh.json()).code).toBe("ASK_TOO_HIGH");
    });

    it("ilan → iptal (başkası 404) → yeniden ilan → keşif → claim hataları → devralma", async () => {
      const first = await transfersPost(
        call("/api/transfers", { token: sellerToken, body: { bookingId, askPriceMinor: 150_000 } })
      );
      expect(first.status).toBe(201);
      const listed = await first.json();
      expect(listed.status).toBe("LISTED");
      expect(listed.askPrice).toBe(150_000);
      expect(listed.claimUrl).toContain("/transfers/claim#token=");

      const del = (id: string, token: string) =>
        transferDelete(call(`/api/transfers/${id}`, { method: "DELETE", token }), ctx({ id }));
      expect((await del(listed.id, strangerToken)).status).toBe(404);
      expect((await del(listed.id, sellerToken)).status).toBe(200);
      expect((await del(listed.id, sellerToken)).status).toBe(404);

      const second = await (
        await transfersPost(
          call("/api/transfers", {
            token: sellerToken,
            body: { bookingId, askPriceMinor: 180_000 },
          })
        )
      ).json();
      const token: string = second.claimToken;

      const mine = await (
        await transfersGet(call("/api/transfers", { token: sellerToken }))
      ).json();
      expect(mine.map((t: { id: string }) => t.id)).toEqual(
        expect.arrayContaining([listed.id, second.id])
      );
      expect(JSON.stringify(mine)).not.toContain(token);

      const discover = await (await transferDiscoverGet()).json();
      const pub = discover.find((t: { id: string }) => t.id === second.id);
      expect(pub).toBeDefined();
      expect(pub.askPrice).toBe(1800);
      expect(JSON.stringify(pub)).not.toContain(token);

      const claim = (t: string, body: Record<string, unknown>) =>
        transferClaimPost(call("/api/transfers/claim", { token: t, body }));
      expect((await claim(sellerToken, { token, cardToken: nextCard() })).status).toBe(400);
      expect(
        (
          await claim(buyerToken, {
            token: `${"a".repeat(30)}.${"b".repeat(10)}`,
            cardToken: nextCard(),
          })
        ).status
      ).toBe(403);
      const declined = await claim(buyerToken, { token, cardToken: nextCard("decline") });
      expect(declined.status).toBe(402);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId).toBe(
        fx.userId
      );

      const ok = await claim(buyerToken, { token, cardToken: nextCard() });
      expect(ok.status).toBe(200);
      const result = await ok.json();
      expect(result).toMatchObject({
        transferId: second.id,
        bookingId,
        status: "COMPLETED",
        paidMinor: 180_000,
        currency: "TRY",
      });
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId).toBe(
        buyerId
      );
      const again = await claim(buyerToken, { token, cardToken: nextCard() });
      expect(again.status).toBe(409);

      // Yeni sahip rezervasyonu görür, eski sahip göremez.
      expect(
        (
          await bookingGet(
            call(`/api/bookings/${bookingId}`, { token: buyerToken }),
            ctx({ id: bookingId })
          )
        ).status
      ).toBe(200);
      expect(
        (
          await bookingGet(
            call(`/api/bookings/${bookingId}`, { token: sellerToken }),
            ctx({ id: bookingId })
          )
        ).status
      ).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe("envanter, kanal ve fiyat işleri (host)", () => {
    let fx: StayFixture;
    let hostToken: string;
    let userToken: string;

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "ari", days: 30 });
      hostToken = await tokenFor(fx.hostId, "HOST");
      userToken = await tokenFor(fx.userId, "USER");
    });

    it("rooms/[roomId]/availability: yetki kontrolleri; kilitli geceler ezilmez", async () => {
      const url = `/api/rooms/${fx.roomId}/availability`;
      const c = ctx({ roomId: fx.roomId });
      const body = { from: iso(utcDay(5)), to: iso(utcDay(9)), price: 1200 };
      expect((await availabilityPut(call(url, { method: "PUT", body }), c)).status).toBe(401);
      expect(
        (await availabilityPut(call(url, { method: "PUT", token: userToken, body }), c)).status
      ).toBe(403);
      expect(
        (await availabilityPut(call(url, { method: "PUT", token: otherHostToken, body }), c)).status
      ).toBe(404);
      expect(
        (
          await availabilityPut(
            call(url, { method: "PUT", token: hostToken, body: { from: body.from, to: body.to } }),
            c
          )
        ).status
      ).toBe(400);

      await fx.hold({ startInDays: 6, nights: 2 }); // 6. ve 7. gecelerde birer birim tutuldu
      // Satışı kapatma (total 0): tutulan geceler sold + held altına indirilemez → atlanır
      const res = await availabilityPut(
        call(url, {
          method: "PUT",
          token: hostToken,
          body: { from: body.from, to: body.to, total: 0 },
        }),
        c
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: 3, created: 0, skippedLocked: 2 });
      const rows = await prisma.inventoryDay.findMany({
        where: { roomTypeId: fx.roomId, date: { gte: utcDay(5), lte: utcDay(9) } },
        orderBy: { date: "asc" },
      });
      expect(rows.map((r) => r.total)).toEqual([0, 1, 1, 0, 0]);
      expect(rows.map((r) => r.held)).toEqual([0, 1, 1, 0, 0]); // tutma ezilmedi

      // Fiyat güncellemesi sayaçlara dokunmaz, tüm gecelere uygulanır
      const priced = await availabilityPut(call(url, { method: "PUT", token: hostToken, body }), c);
      expect(priced.status).toBe(200);
      expect(await priced.json()).toEqual({ updated: 5, created: 0, skippedLocked: 0 });
      const after = await prisma.inventoryDay.findMany({
        where: { roomTypeId: fx.roomId, date: { gte: utcDay(5), lte: utcDay(9) } },
        orderBy: { date: "asc" },
      });
      expect(after.map((r) => Number(r.price))).toEqual([1200, 1200, 1200, 1200, 1200]);
      expect(after.map((r) => r.held)).toEqual([0, 1, 1, 0, 0]);
      const [{ over }] = await prisma.$queryRaw<{ over: bigint }[]>`
        SELECT count(*) AS over FROM "InventoryDay" WHERE sold + held > total`;
      expect(Number(over)).toBe(0);
    });

    it("calendar.ics: geçersiz token 403; imzalı token ile iCal akışı", async () => {
      const c = ctx({ roomId: fx.roomId });
      expect(
        (await calendarGet(call(`/api/rooms/${fx.roomId}/calendar.ics?token=yanlis`), c)).status
      ).toBe(403);
      expect((await calendarGet(call(`/api/rooms/${fx.roomId}/calendar.ics`), c)).status).toBe(403);
      const res = await calendarGet(
        call(`/api/rooms/${fx.roomId}/calendar.ics?token=${feedToken(fx.roomId)}`),
        c
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/calendar");
      const ics = await res.text();
      expect(ics).toContain("BEGIN:VCALENDAR");
      // Önceki testteki tutma (6.–7. geceler) dolu görünür, kişisel veri içermez.
      expect(ics).toContain(`${fx.roomId}-${iso(utcDay(6))}@booking-platform`);
      expect(ics).not.toContain("Test");
    });

    it("calendar/import: yetki kontrolleri; harici dolu geceler kilitlenir ve akışta görünür", async () => {
      const url = `/api/rooms/${fx.roomId}/calendar/import`;
      const c = ctx({ roomId: fx.roomId });
      const day = (n: number) => iso(utcDay(n)).replaceAll("-", "");
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//api-routes-test//EN",
        "BEGIN:VEVENT",
        `UID:ext-${stamp}@ota.test`,
        "DTSTAMP:20260101T000000Z",
        `DTSTART;VALUE=DATE:${day(15)}`,
        `DTEND;VALUE=DATE:${day(17)}`,
        "SUMMARY:OTA rezervasyonu",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      const body = { source: "ota-test", ics };
      expect((await calendarImportPost(call(url, { token: userToken, body }), c)).status).toBe(403);
      expect((await calendarImportPost(call(url, { token: otherHostToken, body }), c)).status).toBe(
        404
      );
      expect(
        (
          await calendarImportPost(
            call(url, { token: hostToken, body: { source: "x", ics: "kısa" } }),
            c
          )
        ).status
      ).toBe(400);

      const res = await calendarImportPost(call(url, { token: hostToken, body }), c);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ nights: 2, added: 2, removed: 0, conflicts: [] });
      const locked = await prisma.externalBlock.findMany({
        where: { roomTypeId: fx.roomId, source: "ical:ota-test" },
        orderBy: { date: "asc" },
      });
      expect(locked.map((r) => iso(r.date))).toEqual([iso(utcDay(15)), iso(utcDay(16))]);
      // Harici blok başka kanalda satılmış birimdir: `sold` artar
      const days = await prisma.inventoryDay.findMany({
        where: { roomTypeId: fx.roomId, date: { in: [utcDay(15), utcDay(16)] } },
        orderBy: { date: "asc" },
      });
      expect(days.map((d) => d.sold)).toEqual([1, 1]);
      // Aynı takvimin tekrar içe aktarımı idempotent
      const again = await calendarImportPost(call(url, { token: hostToken, body }), c);
      expect(await again.json()).toEqual({ nights: 2, added: 0, removed: 0, conflicts: [] });

      const feed = await (
        await calendarGet(
          call(`/api/rooms/${fx.roomId}/calendar.ics?token=${feedToken(fx.roomId)}`),
          c
        )
      ).text();
      expect(feed).toContain(`${fx.roomId}-${iso(utcDay(15))}@booking-platform`);
    });

    it("pricing: 401 / USER 403 / başka host 404 / geçersiz 400 / sahibi 202 kuyruğa alır", async () => {
      const body = { roomId: fx.roomId, dates: [iso(utcDay(20)), iso(utcDay(21))], basePrice: 900 };
      expect((await pricingPost(call("/api/pricing", { body }))).status).toBe(401);
      expect((await pricingPost(call("/api/pricing", { token: userToken, body }))).status).toBe(
        403
      );
      expect(
        (await pricingPost(call("/api/pricing", { token: otherHostToken, body }))).status
      ).toBe(404);
      expect(
        (
          await pricingPost(
            call("/api/pricing", { token: hostToken, body: { ...body, dates: [] } })
          )
        ).status
      ).toBe(400);
      const res = await pricingPost(call("/api/pricing", { token: hostToken, body }));
      expect(res.status).toBe(202);
      const out = await res.json();
      expect(out).toMatchObject({ queued: true, roomId: fx.roomId, dates: 2 });
      expect(typeof out.jobId).toBe("string");
      const job = await getQueue("pricing").getJob(out.jobId);
      expect(job?.data).toMatchObject({ roomId: fx.roomId, basePrice: 900, currency: "TRY" });
      await job?.remove();
    });
  });

  // ---------------------------------------------------------------------------
  describe("AI uçları", () => {
    let fx: StayFixture;
    let hostToken: string;
    let city: string;

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "ai", days: 40 });
      hostToken = await tokenFor(fx.hostId, "HOST");
      const p = await prisma.property.findUniqueOrThrow({
        where: { id: fx.propertyId },
        include: { location: true },
      });
      city = p.location.city;
      await prisma.location.update({
        where: { id: p.locationId },
        data: { latitude: 38.42, longitude: 27.14 },
      });
    });

    it("ai/listing-copy: USER 403, başka host 404, sahibi için ai_generated taslak", async () => {
      const body = { propertyId: fx.propertyId };
      expect(
        (
          await listingCopyPost(
            call("/api/ai/listing-copy", { token: await tokenFor(fx.userId, "USER"), body })
          )
        ).status
      ).toBe(403);
      expect(
        (await listingCopyPost(call("/api/ai/listing-copy", { token: otherHostToken, body })))
          .status
      ).toBe(404);
      expect(
        (await listingCopyPost(call("/api/ai/listing-copy", { token: hostToken, body: {} }))).status
      ).toBe(400);
      const res = await listingCopyPost(call("/api/ai/listing-copy", { token: hostToken, body }));
      expect(res.status).toBe(200);
      const out = await res.json();
      expect(out.ai_generated).toBe(true);
      expect(out.llmMode).toBe("demo");
      expect(out.draft.tr).toContain(city);
      expect(typeof out.draft.en).toBe("string");
    });

    it("ai/trip-plan: 401, doğrulama 400, deterministik plan + teklif", async () => {
      const body = { cities: [city], days: 2, guests: 1, startDate: iso(utcDay(10)) };
      expect((await tripPlanPost(call("/api/ai/trip-plan", { body }), undefined)).status).toBe(401);
      const token = await tokenFor(fx.userId, "USER");
      expect(
        (
          await tripPlanPost(
            call("/api/ai/trip-plan", { token, body: { ...body, days: 0 } }),
            undefined
          )
        ).status
      ).toBe(400);
      const unknownCity = await tripPlanPost(
        call("/api/ai/trip-plan", { token, body: { ...body, cities: [`Yokkent-${stamp}`] } }),
        undefined
      );
      expect(unknownCity.status).toBe(400);

      const res = await tripPlanPost(call("/api/ai/trip-plan", { token, body }), undefined);
      expect(res.status).toBe(200);
      const plan = await res.json();
      expect(plan.ai_generated).toBe(true);
      expect(plan.llmMode).toBe("demo");
      expect(plan.stops).toHaveLength(1);
      expect(plan.stops[0]).toMatchObject({
        city,
        checkIn: iso(utcDay(10)),
        checkOut: iso(utcDay(12)),
        nights: 2,
      });
      expect(Number.isInteger(plan.total)).toBe(true);
      expect(typeof plan.narrative).toBe("string");
      // Rezervasyon yapılmaz.
      expect(await prisma.booking.count({ where: { propertyId: fx.propertyId } })).toBe(0);
    });
  });
});
