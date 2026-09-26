import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken, type Role } from "@/lib/auth/tokens";
import { resetConfigForTests } from "@/lib/config/app-config";
import { relayOutbox } from "@/lib/cqrs/outbox";
import { registerEventHandlers } from "@/lib/events/register";
import { createBooking } from "@/lib/booking-service";
import { buildMockKycWebhook } from "@/lib/trust/kyc";
import * as identityRoute from "@/app/api/account/identity/route";
import { POST as kycWebhook } from "@/app/api/trust/kyc/webhook/route";
import * as bookingsRoute from "@/app/api/bookings/route";
import { GET as messagesGet, POST as messagesPost } from "@/app/api/bookings/[id]/messages/route";
import { GET as partyRiskGet } from "@/app/api/host/trust/party-risk/route";

/**
 * P1-6 KYC + güven-emniyet: mock KYC akışı ve webhook imza kuralı, mesaj dolandırıcılık
 * taraması (uyarı bandı / config ile engelleme + denetim), parti riski → host uyarısı.
 */
type Handler = (req: NextRequest) => Promise<Response>;
const identityGet = identityRoute.GET as unknown as Handler;
const identityPost = identityRoute.POST as unknown as Handler;
const bookingsPost = bookingsRoute.POST as unknown as Handler;

describeInt("P1-6 KYC ve güven-emniyet (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let guestToken = "";
  let hostToken = "";
  let otherHostToken = "";
  let confirmedId = "";

  const tokenFor = async (userId: string, role: Role) =>
    (await signAccessToken(userId, role, 300)).token;
  const req = (
    path: string,
    token: string | null,
    body?: unknown,
    headers: Record<string, string> = {}
  ) =>
    new NextRequest(`http://localhost${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const mkUser = (role: "USER" | "HOST", createdAt?: Date) =>
    prisma.user.create({
      data: {
        email: `ts-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@t.test`,
        passwordHash: "x",
        emailVerifiedAt: new Date(),
        firstName: "Güven",
        lastName: "Test",
        role,
        ...(createdAt ? { createdAt } : {}),
      },
    });
  const sig = (h: Headers) => ({ "x-kyc-signature": h.get("x-kyc-signature") ?? "" });

  beforeAll(async () => {
    registerEventHandlers();
    fx = await createStayFixture(prisma, { tag: "trust", days: 60, capacity: 10, units: 3 });
    guestToken = await tokenFor(fx.userId, "USER");
    hostToken = await tokenFor(fx.hostId, "HOST");
    otherHostToken = await tokenFor((await mkUser("HOST")).id, "HOST");
    const b = await fx.hold({ nights: 2, startInDays: 30 });
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
    confirmedId = b.id;
  });
  afterEach(() => {
    delete process.env.KYC_REQUIRED_FOR_GUESTS;
    delete process.env.MESSAGE_SCAN_BLOCK_HIGH_RISK;
    resetConfigForTests();
  });
  afterAll(() => prisma.$disconnect());

  it("KYC mock: bulanık belge → REQUIRES_INPUT, geçerli belge → VERIFIED; tekrar başlatma 409", async () => {
    const user = await mkUser("USER");
    const token = await tokenFor(user.id, "USER");
    const initial = await (await identityGet(req("/api/account/identity", token))).json();
    expect(initial).toMatchObject({ status: "NOT_STARTED", provider: "mock" });
    expect(initial.testDocuments).toContain("valid");

    const blurry = await identityPost(
      req("/api/account/identity", token, { testDocument: "blurry" })
    );
    expect(blurry.status).toBe(201);
    expect(await blurry.json()).toMatchObject({
      status: "REQUIRES_INPUT",
      lastError: "document_unreadable",
      redirectUrl: null,
    });

    const ok = await identityPost(req("/api/account/identity", token, { testDocument: "valid" }));
    expect((await ok.json()).status).toBe("VERIFIED");
    const status = await (await identityGet(req("/api/account/identity", token))).json();
    expect(status.status).toBe("VERIFIED");
    expect(status.verifiedAt).not.toBeNull();

    const again = await identityPost(req("/api/account/identity", token, {}));
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("ALREADY_VERIFIED");

    const rows = await prisma.identityVerification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    // Belge görüntüsü/kimlik no alanı yok: yalnızca sağlayıcı referansı + durum.
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "createdAt",
        "id",
        "lastError",
        "provider",
        "providerRef",
        "status",
        "updatedAt",
        "userId",
        "verifiedAt",
      ].sort()
    );
    expect(
      await prisma.auditLog.count({ where: { entityId: user.id, action: "kyc.status_changed" } })
    ).toBe(2);
  });

  it("KYC webhook: yalnızca aktif (mock) sağlayıcı imzası; sonuç durumlar değişmez", async () => {
    const user = await mkUser("USER");
    const token = await tokenFor(user.id, "USER");
    const fake = await identityPost(req("/api/account/identity", token, { testDocument: "fake" }));
    const { id } = await fake.json();
    const row = await prisma.identityVerification.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("FAILED");

    // Stripe imzası (mock aktifken) → 401; imzasız → 401.
    const raw = JSON.stringify({
      id: "evt_x",
      type: "identity.verification_session.verified",
      data: { object: { id: row.providerRef } },
    });
    const stripeSig = Stripe.webhooks.generateTestHeaderString({ payload: raw, secret: "whsec_x" });
    const wrong = await kycWebhook(
      req("/api/trust/kyc/webhook", null, raw, { "stripe-signature": stripeSig })
    );
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).code).toBe("WRONG_PROVIDER_SIGNATURE");
    expect((await kycWebhook(req("/api/trust/kyc/webhook", null, raw))).status).toBe(401);

    // Bozuk imza → 400.
    const hook = buildMockKycWebhook(row.providerRef, "valid");
    const bad = await kycWebhook(
      req(
        "/api/trust/kyc/webhook",
        null,
        hook.rawBody.replace("VERIFIED", "PENDING"),
        sig(hook.headers)
      )
    );
    expect(bad.status).toBe(400);

    // Geçerli imza ama FAILED sonuçtur → değişmez; bilinmeyen referans → 200 etkisiz.
    const ok = await kycWebhook(
      req("/api/trust/kyc/webhook", null, hook.rawBody, sig(hook.headers))
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ received: true, applied: false, status: "FAILED" });
    const unknown = buildMockKycWebhook("kyc_mock_nope", "valid");
    const res = await kycWebhook(
      req("/api/trust/kyc/webhook", null, unknown.rawBody, sig(unknown.headers))
    );
    expect(await res.json()).toMatchObject({ applied: false });
    expect((await prisma.identityVerification.findUniqueOrThrow({ where: { id } })).status).toBe(
      "FAILED"
    );
  });

  it("KYC_REQUIRED_FOR_GUESTS açıkken doğrulanmamış misafir rezervasyon yapamaz (403)", async () => {
    process.env.KYC_REQUIRED_FOR_GUESTS = "true";
    resetConfigForTests();
    const res = await bookingsPost(
      req("/api/bookings", guestToken, {
        propertyId: fx.propertyId,
        roomId: fx.roomId,
        checkIn: iso(utcDay(40)),
        checkOut: iso(utcDay(41)),
        guestCount: 1,
      })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("IDENTITY_VERIFICATION_REQUIRED");
  });

  it("mesaj taraması: yüksek riskli mesaj alıcıya uyarı bandıyla gösterilir + denetim", async () => {
    const res = await messagesPost(
      req(`/api/bookings/${confirmedId}/messages`, hostToken, {
        body: "Komisyon ödemeyin, kaporayı havale edin: TR33 0006 1005 1978 6457 8413 26",
      }),
      ctx(confirmedId)
    );
    expect(res.status).toBe(201);
    const { message } = await res.json();
    expect(message.risk.level).toBe("HIGH");
    expect(message.risk.reasons).toEqual(
      expect.arrayContaining(["IBAN", "BANK_TRANSFER_REQUEST", "OFF_PLATFORM_PAYMENT_REQUEST"])
    );
    const list = await (
      await messagesGet(req(`/api/bookings/${confirmedId}/messages`, guestToken), ctx(confirmedId))
    ).json();
    const seen = list.messages.find((m: { id: string }) => m.id === message.id);
    expect(seen.risk.level).toBe("HIGH");
    const flag = await prisma.messageRiskFlag.findUniqueOrThrow({
      where: { messageId: message.id },
    });
    expect(flag).toMatchObject({ blocked: false, level: "HIGH", llmSignal: null });
    expect(
      await prisma.auditLog.count({
        where: { action: "message.risk_flagged", entityId: message.id },
      })
    ).toBe(1);

    // Zararsız mesaj bayraksız.
    const clean = await messagesPost(
      req(`/api/bookings/${confirmedId}/messages`, guestToken, {
        body: "Teşekkürler, saat 15 gibi geliriz.",
      }),
      ctx(confirmedId)
    );
    expect((await clean.json()).message.risk).toBeNull();
  });

  it("MESSAGE_SCAN_BLOCK_HIGH_RISK: yüksek riskli mesaj kaydedilmez (422) ama denetlenir", async () => {
    process.env.MESSAGE_SCAN_BLOCK_HIGH_RISK = "true";
    resetConfigForTests();
    const thread = await prisma.messageThread.findUniqueOrThrow({
      where: { bookingId: confirmedId },
    });
    const before = await prisma.message.count({ where: { threadId: thread.id } });
    const res = await messagesPost(
      req(`/api/bookings/${confirmedId}/messages`, guestToken, {
        body: "Pay me directly: paypal.me/someone",
      }),
      ctx(confirmedId)
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("MESSAGE_BLOCKED");
    expect(await prisma.message.count({ where: { threadId: thread.id } })).toBe(before);
    const blocked = await prisma.messageRiskFlag.findFirst({
      where: { bookingId: confirmedId, blocked: true },
    });
    expect(blocked?.reasons).toContain("PAYMENT_LINK");
    expect(blocked?.messageId).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { action: "message.blocked", entityId: confirmedId } })
    ).toBe(1);
    // Uyarı seviyesindeki mesaj engellenmez.
    const warn = await messagesPost(
      req(`/api/bookings/${confirmedId}/messages`, guestToken, {
        body: "whatsapp'tan yazar mısınız?",
      }),
      ctx(confirmedId)
    );
    expect(warn.status).toBe(201);
    expect((await warn.json()).message.risk.level).toBe("WARN");
  });

  it("parti riski: riskli rezervasyonda host'a outbox bildirimi + host paneli; düşük riskte yok", async () => {
    // Genç hesap + tek gece + kalabalık grup + yakın tarih → ≥ 90 (eşik 60).
    const risky = await createBooking({
      userId: fx.userId,
      propertyId: fx.propertyId,
      roomId: fx.roomId,
      checkIn: iso(utcDay(1)),
      checkOut: iso(utcDay(2)),
      guestCount: 8,
    });
    // Eski hesap, 3 gece, 2 kişi, uzak tarih → en fazla hafta sonu (10).
    const oldGuest = await mkUser("USER", new Date(Date.now() - 2 * 365 * 86_400_000));
    const calm = await createBooking({
      userId: oldGuest.id,
      propertyId: fx.propertyId,
      roomId: fx.roomId,
      checkIn: iso(utcDay(50)),
      checkOut: iso(utcDay(53)),
      guestCount: 2,
    });
    await relayOutbox(500);
    await relayOutbox(500);

    const a = await prisma.partyRiskAssessment.findUniqueOrThrow({
      where: { bookingId: risky.booking.id },
    });
    expect(a.flagged).toBe(true);
    expect(a.score).toBeGreaterThanOrEqual(90);
    expect(a.reasons).toEqual(
      expect.arrayContaining(["LARGE_GROUP", "SINGLE_NIGHT", "YOUNG_ACCOUNT", "NEAR_DATE"])
    );
    expect(a.notifiedAt).not.toBeNull();
    const mail = await prisma.notification.findUniqueOrThrow({
      where: { dedupeKey: `trust.party_risk:${risky.booking.id}:host` },
    });
    expect(mail.userId).toBe(fx.hostId);
    expect(mail.text).toContain("Kalabalık grup");

    const c = await prisma.partyRiskAssessment.findUniqueOrThrow({
      where: { bookingId: calm.booking.id },
    });
    expect(c.flagged).toBe(false);
    expect(
      await prisma.notification.count({
        where: { dedupeKey: `trust.party_risk:${calm.booking.id}:host` },
      })
    ).toBe(0);

    // Yeniden teslim: tek değerlendirme, tek e-posta, tek denetim kaydı.
    await prisma.outboxMessage.updateMany({
      where: { aggregateId: risky.booking.id },
      data: { status: "PENDING", attempts: 0 },
    });
    await relayOutbox(500);
    await relayOutbox(500);
    expect(
      await prisma.notification.count({
        where: { dedupeKey: `trust.party_risk:${risky.booking.id}:host` },
      })
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: "booking.party_risk_flagged", entityId: risky.booking.id },
      })
    ).toBe(1);

    const panel = await (await partyRiskGet(req("/api/host/trust/party-risk", hostToken))).json();
    const item = panel.items.find((i: { bookingId: string }) => i.bookingId === risky.booking.id);
    expect(item).toMatchObject({ guestCount: 8, status: "HELD" });
    expect(panel.items.some((i: { bookingId: string }) => i.bookingId === calm.booking.id)).toBe(
      false
    );
    const other = await (
      await partyRiskGet(req("/api/host/trust/party-risk", otherHostToken))
    ).json();
    expect(other.items).toEqual([]);
    expect((await partyRiskGet(req("/api/host/trust/party-risk", guestToken))).status).toBe(403);
  });
});
