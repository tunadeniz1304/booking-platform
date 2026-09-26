// P1-5 KK: hasar depozitosu (ön provizyon, talep yoksa void, capture ≤ pre-auth), çözüm merkezi
// (SLA aşımında otomatik eskalasyon, kanıtta GPS kalmaz, yönetici kararı), Stripe/mock itiraz
// webhook'u → CHARGEBACK talebi, serbest bırakma sonrası misafir iadesi önce rezervden (host
// bakiyesi eksiye düşmez). Her adımda mizan dengede + dokunulan günlerde mutabakat farkı 0.
import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { confirmPaymentChallenge, payForBooking } from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { getConfig } from "@/lib/config/app-config";
import {
  account,
  getAccountBalance,
  isTrialBalanced,
  ledgerImbalanceTotal,
  reconcile,
  trialBalance,
} from "@/lib/ledger";
import { releaseAt, runEscrowRelease } from "@/lib/payout/escrow";
import { MockPsp } from "@/lib/payment/mock-psp";
import { money } from "@/lib/money/money";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import type { AccessClaims } from "@/lib/auth";
import { signAccessToken } from "@/lib/auth/tokens";
import {
  addClaimMessage,
  checkClaimSla,
  claimSlaBreachTotal,
  decideClaim,
  openClaim,
  sweepClaimSla,
} from "@/lib/resolution/claims";
import {
  captureDeposit,
  depositWindow,
  releaseDeposit,
  sweepDeposits,
} from "@/lib/resolution/deposit";
import { mockDisputeWebhook } from "@/lib/resolution/disputes";
import { notifyClaimEscalated } from "@/lib/notifications/resolution-notifications";
import { POST as webhookPost } from "@/app/api/payments/webhook/route";
import { GET as depositGet, PUT as depositPut } from "@/app/api/host/properties/[id]/deposit/route";
import { POST as evidencePost } from "@/app/api/claims/[id]/evidence/route";
import { GET as evidenceGet } from "@/app/api/claims/[id]/evidence/[evidenceId]/route";
import { GET as claimGet } from "@/app/api/claims/[id]/route";
import { POST as claimsPost } from "@/app/api/claims/route";
import { POST as decisionPost } from "@/app/api/admin/claims/[id]/decision/route";
import { gpsEntryCount, jpegWithGps } from "../helpers/exif";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const claims = (userId: string, role: AccessClaims["role"]): AccessClaims => ({
  userId,
  role,
  jti: "j",
  exp: 0,
  tv: 0,
});

describeInt("P1-5 hasar depozitosu + çözüm merkezi + itiraz senkronu", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let adminId = "";
  let key = 0;
  const touchedPayments = new Set<string>();
  const touchedDays = new Set<string>();

  beforeAll(async () => {
    fx = await createStayFixture(prisma, {
      tag: "v4-resolution",
      days: 150,
      country: "Türkiye",
      policyId: "policy_flexible_v1",
    });
    adminId = (
      await prisma.user.create({
        data: {
          email: `res-admin-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: "Yönetici",
          lastName: "Test",
          role: "ADMIN",
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const guest = () => claims(fx.userId, "USER");
  const host = () => claims(fx.hostId, "HOST");
  const admin = () => claims(adminId, "ADMIN");

  async function bearer(userId: string, role: AccessClaims["role"]) {
    const { token } = await signAccessToken(userId, role, 900);
    return { authorization: `Bearer ${token}` };
  }

  async function pay(bookingId: string, userId = fx.userId) {
    let out = await payForBooking({
      bookingId,
      userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `res-${++key}-${Date.now()}`,
    });
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({ bookingId, userId, code: MOCK_3DS_CODE });
    }
    expect(out.status).toBe("confirmed");
    const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
    touchedPayments.add(p.id);
    return p;
  }

  async function stay(bookingId: string) {
    const b = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        checkIn: true,
        checkOut: true,
        property: { select: { timeZone: true, checkInTime: true, checkOutTime: true } },
      },
    });
    return { ...depositWindow(b, b.property), checkInAt: releaseAt(b.checkIn, b.property, 0) };
  }

  async function imbalanceCount(): Promise<number> {
    const m = await ledgerImbalanceTotal.get();
    return m.values.reduce((s, v) => s + v.value, 0);
  }

  /** Mizan dengede + bu dosyanın ödeme/depozito günlerinde mutabakat farkı 0. */
  async function assertBooksClean(): Promise<void> {
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    const payments = await prisma.payment.findMany({
      where: { id: { in: [...touchedPayments] } },
      select: { paidAt: true, refundedAt: true },
    });
    const deposits = await prisma.damageDeposit.findMany({
      where: { capturedAt: { not: null } },
      select: { id: true, capturedAt: true },
    });
    const days = new Set(touchedDays);
    for (const p of payments)
      for (const d of [p.paidAt, p.refundedAt]) if (d) days.add(d.toISOString().slice(0, 10));
    for (const d of deposits) days.add(d.capturedAt!.toISOString().slice(0, 10));
    const depositIds = new Set(deposits.map((d) => d.id));
    for (const day of days) {
      const report = await reconcile(day, prisma);
      expect(report.imbalancedEntries).toBe(0);
      expect(
        report.differences.filter(
          (d) => touchedPayments.has(d.subjectId) || depositIds.has(d.subjectId)
        )
      ).toEqual([]);
    }
    expect(await imbalanceCount()).toBe(0);
  }

  async function bal(kind: "payable" | "reserve", hostId = fx.hostId): Promise<bigint> {
    const ref = kind === "payable" ? account.hostPayable(hostId) : account.hostReserve(hostId);
    return (await getAccountBalance(prisma, ref, "TRY")).balanceMinor;
  }

  it("depozito: ayar → planlama → ön provizyon → talep yoksa void; capture ≤ pre-auth", async () => {
    // Host ayarı (API): ilan geneli 500 TL, oda tipi 300 TL (oda ezer).
    const auth = { ...(await bearer(fx.hostId, "HOST")), "content-type": "application/json" };
    const url = `http://localhost/api/host/properties/${fx.propertyId}/deposit`;
    const params = { params: Promise.resolve({ id: fx.propertyId }) };
    for (const body of [{ amountMinor: 50_000 }, { amountMinor: 30_000, roomTypeId: fx.roomId }]) {
      const res = await depositPut(
        new NextRequest(url, { method: "PUT", headers: auth, body: JSON.stringify(body) }),
        params
      );
      expect(res.status).toBe(200);
    }
    const tooBig = await depositPut(
      new NextRequest(url, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ amountMinor: getConfig().DEPOSIT_MAX_MINOR + 1 }),
      }),
      params
    );
    expect(tooBig.status).toBe(400);
    const listed = await (await depositGet(new NextRequest(url, { headers: auth }), params)).json();
    expect(
      listed.settings.find((s: { roomTypeId: string | null }) => s.roomTypeId === null)
    ).toMatchObject({ amountMinor: 50_000 });
    // Başka host → 404.
    const other = await prisma.user.create({
      data: {
        email: `oh-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "O",
        lastName: "H",
        role: "HOST",
      },
    });
    const foreign = await depositGet(
      new NextRequest(url, { headers: await bearer(other.id, "HOST") }),
      params
    );
    expect(foreign.status).toBe(404);

    const a = await fx.hold({ nights: 2 });
    await pay(a.id);
    const w = await stay(a.id);

    // Ön provizyon anından önce: kayıt açılır ama provizyon yok.
    const early = await sweepDeposits(new Date(w.authorizeAfter.getTime() - HOUR), {
      bookingIds: [a.id],
    });
    expect(early).toMatchObject({ created: 1, authorized: 0 });
    let dep = await prisma.damageDeposit.findUniqueOrThrow({ where: { bookingId: a.id } });
    expect(dep).toMatchObject({ status: "SCHEDULED", amountMinor: 30_000n, currency: "TRY" });

    const at = new Date(w.authorizeAfter.getTime() + 60_000);
    expect((await sweepDeposits(at, { bookingIds: [a.id] })).authorized).toBe(1);
    dep = await prisma.damageDeposit.findUniqueOrThrow({ where: { bookingId: a.id } });
    expect(dep.status).toBe("AUTHORIZED");
    expect(dep.providerRef).toMatch(/^pi_mockhold_30000_/);
    // Çıkış + DEPOSIT_HOLD_DAYS için gecikmeli void işi planlandı.
    const job = await getQueue(QUEUE_NAMES.resolution).getJob(`deposit-void-${dep.id}`);
    expect(job?.name).toBe("deposit-void");
    await job?.remove();

    // capture ≤ pre-auth: kod (422), PSP (mock) ve DB CHECK üç katmanda reddeder.
    await expect(captureDeposit(dep.id, 30_001n, at)).rejects.toMatchObject({
      code: "DEPOSIT_CAPTURE_EXCEEDS_AUTH",
      status: 422,
    });
    await expect(
      new MockPsp().capture(dep.providerRef!, money(30_001, "TRY"))
    ).rejects.toMatchObject({ code: "amount_too_large" });
    await expect(
      prisma.$executeRaw`UPDATE "DamageDeposit" SET "capturedMinor" = 30001, "status" = 'CAPTURED' WHERE id = ${dep.id}`
    ).rejects.toThrow(/DamageDeposit_capture_within_auth/);

    // Süre dolmadan void yok; dolunca (talep yok) void.
    expect(await releaseDeposit(dep.id, new Date(w.voidAfter.getTime() - HOUR))).toBe("not_due");
    const sweep = await sweepDeposits(new Date(w.voidAfter.getTime() + 60_000), {
      bookingIds: [a.id],
    });
    expect(sweep.voided).toBe(1);
    dep = await prisma.damageDeposit.findUniqueOrThrow({ where: { bookingId: a.id } });
    expect(dep).toMatchObject({ status: "VOIDED", capturedMinor: 0n });
    await assertBooksClean();
  });

  it("hasar talebi: açık talep void'i tutar; onay ≤ ön provizyon capture, fazlası yalnız kayıt", async () => {
    const b = await fx.hold({ nights: 2 });
    await pay(b.id);
    const w = await stay(b.id);
    await sweepDeposits(new Date(w.authorizeAfter.getTime() + 60_000), { bookingIds: [b.id] });
    const dep = await prisma.damageDeposit.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(dep.status).toBe("AUTHORIZED");

    // Giriş öncesi talep açılamaz; misafir HOST_DAMAGE açamaz (404).
    await expect(
      openClaim(
        host(),
        {
          bookingId: b.id,
          type: "HOST_DAMAGE",
          amountMinor: 1000,
          description: "Kırık masa ve lamba",
        },
        new Date(w.checkInAt.getTime() - HOUR)
      )
    ).rejects.toMatchObject({ code: "CLAIM_TOO_EARLY" });
    await expect(
      openClaim(
        guest(),
        {
          bookingId: b.id,
          type: "HOST_DAMAGE",
          amountMinor: 1000,
          description: "Kırık masa ve lamba",
        },
        new Date(w.checkInAt.getTime() + HOUR)
      )
    ).rejects.toMatchObject({ status: 404 });

    const openedAt = new Date(w.checkInAt.getTime() + 2 * DAY);
    const claim = await openClaim(
      host(),
      {
        bookingId: b.id,
        type: "HOST_DAMAGE",
        amountMinor: 45_000,
        description: "Kırık masa, halıda leke",
      },
      openedAt
    );
    expect(claim).toMatchObject({ status: "AWAITING_RESPONSE", respondentId: fx.userId });
    await expect(
      openClaim(
        host(),
        {
          bookingId: b.id,
          type: "HOST_DAMAGE",
          amountMinor: 1,
          description: "ikinci talep denemesi",
        },
        openedAt
      )
    ).rejects.toMatchObject({ code: "CLAIM_ALREADY_OPEN" });

    // Tutma süresi dolsa da açık talep varken void yok.
    expect(await releaseDeposit(dep.id, new Date(w.voidAfter.getTime() + 60_000))).toBe(
      "held_by_claim"
    );
    expect(
      (await addClaimMessage(guest(), claim.id, "Hasar benden önce vardı", openedAt)).status
    ).toBe("OPEN");

    const payableBefore = await bal("payable");
    const decidedAt = new Date(w.voidAfter.getTime() + 2 * 60_000);
    touchedDays.add(decidedAt.toISOString().slice(0, 10));
    const result = await decideClaim(
      admin(),
      claim.id,
      { decision: "APPROVE", note: "Fotoğraflar hasarı doğruluyor" },
      decidedAt
    );
    expect(result).toMatchObject({
      status: "RESOLVED_APPROVED",
      awardedMinor: 45_000n,
      settledMinor: 30_000n,
      uncollectedMinor: 15_000n,
    });
    const after = await prisma.damageDeposit.findUniqueOrThrow({ where: { id: dep.id } });
    expect(after).toMatchObject({ status: "CAPTURED", capturedMinor: 30_000n });
    // Tazmin host_payable'a; fazlası defterde alacak olarak YOK.
    expect(await bal("payable")).toBe(payableBefore + 30_000n);
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { idempotencyKey: `deposit-captured:${dep.id}` },
      include: { lines: { include: { account: true } } },
    });
    expect(entry.lines.map((l) => `${l.side}:${l.account.kind}:${l.amountMinor}`).sort()).toEqual([
      "CREDIT:HOST_PAYABLE:30000",
      "DEBIT:PSP_CLEARING:30000",
    ]);
    // İkinci karar reddedilir.
    await expect(
      decideClaim(admin(), claim.id, { decision: "REJECT", note: "tekrar" }, decidedAt)
    ).rejects.toMatchObject({ code: "CLAIM_CLOSED" });
    await assertBooksClean();
  });

  it("kısmi hasar kararı ve ret: kısmi capture CAPTURED_PARTIAL; retten sonra depozito bırakılır", async () => {
    const c = await fx.hold({ nights: 1 });
    await pay(c.id);
    const w = await stay(c.id);
    await sweepDeposits(new Date(w.authorizeAfter.getTime() + 60_000), { bookingIds: [c.id] });
    const openedAt = new Date(w.checkInAt.getTime() + DAY);
    const claim = await openClaim(
      host(),
      {
        bookingId: c.id,
        type: "HOST_DAMAGE",
        amountMinor: 20_000,
        description: "Duvarda boya hasarı",
      },
      openedAt
    );
    // Yönetici API'si: kısmi tutar talebi aşamaz → 400; geçerli kısmi → 200.
    const auth = { ...(await bearer(adminId, "ADMIN")), "content-type": "application/json" };
    const decUrl = `http://localhost/api/admin/claims/${claim.id}/decision`;
    const params = { params: Promise.resolve({ id: claim.id }) };
    const bad = await decisionPost(
      new NextRequest(decUrl, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ decision: "PARTIAL", amountMinor: 20_000, note: "fazla" }),
      }),
      params
    );
    expect(bad.status).toBe(400);
    const ok = await decisionPost(
      new NextRequest(decUrl, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ decision: "PARTIAL", amountMinor: 8_000, note: "Kısmen haklı" }),
      }),
      params
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "RESOLVED_PARTIAL", settledMinor: 8_000 });
    const dep = await prisma.damageDeposit.findUniqueOrThrow({ where: { bookingId: c.id } });
    expect(dep).toMatchObject({ status: "CAPTURED_PARTIAL", capturedMinor: 8_000n });
    touchedDays.add(dep.capturedAt!.toISOString().slice(0, 10));

    // Ret: talep kapanınca tutma süresi dolmuşsa depozito hemen bırakılır.
    const d = await fx.hold({ nights: 1 });
    await pay(d.id);
    const wd = await stay(d.id);
    await sweepDeposits(new Date(wd.authorizeAfter.getTime() + 60_000), { bookingIds: [d.id] });
    const rejectClaim = await openClaim(
      host(),
      {
        bookingId: d.id,
        type: "HOST_DAMAGE",
        amountMinor: 5_000,
        description: "Eksik havlu ve bardak",
      },
      new Date(wd.checkInAt.getTime() + HOUR)
    );
    await decideClaim(
      admin(),
      rejectClaim.id,
      { decision: "REJECT", note: "Kanıt yetersiz" },
      new Date(wd.voidAfter.getTime() + 60_000)
    );
    expect(
      (await prisma.damageDeposit.findUniqueOrThrow({ where: { bookingId: d.id } })).status
    ).toBe("VOIDED");
    await assertBooksClean();
  });

  it("SLA aşımında otomatik eskalasyon: ESCALATED + yönetici bildirimi + metrik", async () => {
    const e = await fx.hold({ nights: 2 });
    await pay(e.id);
    const w = await stay(e.id);
    const openedAt = new Date(w.checkInAt.getTime() + HOUR);
    const claim = await openClaim(
      guest(),
      {
        bookingId: e.id,
        type: "GUEST_REFUND",
        amountMinor: 5_000,
        description: "Klima çalışmıyordu",
      },
      openedAt
    );
    expect(claim.slaDueAt!.getTime()).toBe(
      openedAt.getTime() + getConfig().CLAIM_RESPONSE_SLA_HOURS * HOUR
    );
    const job = await getQueue(QUEUE_NAMES.resolution).getJob(`claim-sla-${claim.id}`);
    expect(job?.name).toBe("claim-sla-check");
    await job?.remove();

    const before = (await claimSlaBreachTotal.get()).values
      .filter((v) => v.labels.type === "GUEST_REFUND")
      .reduce((s, v) => s + v.value, 0);
    expect(await checkClaimSla(claim.id, new Date(claim.slaDueAt!.getTime() - 60_000))).toBe(
      "not_due"
    );
    const swept = await sweepClaimSla(new Date(claim.slaDueAt!.getTime() + 60_000));
    expect(swept.breached).toBeGreaterThanOrEqual(1);
    const row = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(row.status).toBe("ESCALATED");
    expect(row.escalatedAt).not.toBeNull();
    const after = (await claimSlaBreachTotal.get()).values
      .filter((v) => v.labels.type === "GUEST_REFUND")
      .reduce((s, v) => s + v.value, 0);
    expect(after).toBe(before + 1);
    // İkinci kontrol tekrar eskale etmez.
    expect(await checkClaimSla(claim.id, new Date(claim.slaDueAt!.getTime() + 2 * 60_000))).toBe(
      "responded"
    );
    const outbox = await prisma.outboxMessage.findMany({
      where: { aggregateId: claim.id, eventType: "resolution.claim_escalated" },
    });
    expect(outbox).toHaveLength(1);
    await notifyClaimEscalated({ claimId: claim.id });
    const mail = await prisma.notification.findUnique({
      where: { dedupeKey: `claim.escalated:${claim.id}:${adminId}` },
    });
    expect(mail?.subject).toMatch(/yönetici|admin/i);
    const audit = await prisma.auditLog.count({
      where: { action: "claim.sla_breach", entityId: claim.id },
    });
    expect(audit).toBe(1);
    // Eskalasyon sonrası yanıt durumu değiştirmez (yönetici kuyruğunda kalır).
    expect((await addClaimMessage(host(), claim.id, "Teknisyen gönderdik")).status).toBe(
      "ESCALATED"
    );
  });

  it("kanıt yükleme: EXIF'te GPS kalmaz; yalnız taraflar okur; PDF kabul, metin ret", async () => {
    const f = await fx.hold({ nights: 1 });
    await pay(f.id);
    const w = await stay(f.id);
    const claim = await openClaim(
      guest(),
      {
        bookingId: f.id,
        type: "GUEST_REFUND",
        amountMinor: 2_000,
        description: "Banyoda küf vardı",
      },
      new Date(w.checkInAt.getTime() + HOUR)
    );
    const jpeg = await jpegWithGps(320, 240);
    expect(gpsEntryCount((await sharp(jpeg).metadata()).exif)).toBeGreaterThan(0);

    const upload = async (bytes: Buffer, userId: string, role: AccessClaims["role"]) => {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "foto.jpg");
      return evidencePost(
        new NextRequest(`http://localhost/api/claims/${claim.id}/evidence`, {
          method: "POST",
          headers: await bearer(userId, role),
          body: form,
        }),
        { params: Promise.resolve({ id: claim.id }) }
      );
    };
    const res = await upload(jpeg, fx.userId, "USER");
    expect(res.status).toBe(201);
    const ev = await res.json();
    expect(ev.contentType).toBe("image/webp");

    const stored = await prisma.claimEvidence.findUniqueOrThrow({ where: { id: ev.id } });
    const meta = await sharp(Buffer.from(stored.data)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(gpsEntryCount(meta.exif)).toBe(0);
    expect(Buffer.from(stored.data).includes(Buffer.from("TestCam"))).toBe(false);

    const get = await evidenceGet(
      new NextRequest(`http://localhost/api/claims/${claim.id}/evidence/${ev.id}`, {
        headers: await bearer(fx.hostId, "HOST"),
      }),
      { params: Promise.resolve({ id: claim.id, evidenceId: ev.id }) }
    );
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/webp");
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    const served = Buffer.from(await get.arrayBuffer());
    expect((await sharp(served).metadata()).exif).toBeUndefined();

    // Taraf olmayan kullanıcı: yükleyemez, okuyamaz (404).
    const stranger = await prisma.user.create({
      data: { email: `st-${Date.now()}@t.test`, passwordHash: "x", firstName: "S", lastName: "T" },
    });
    expect((await upload(jpeg, stranger.id, "USER")).status).toBe(404);
    const denied = await evidenceGet(
      new NextRequest(`http://localhost/api/claims/${claim.id}/evidence/${ev.id}`, {
        headers: await bearer(stranger.id, "USER"),
      }),
      { params: Promise.resolve({ id: claim.id, evidenceId: ev.id }) }
    );
    expect(denied.status).toBe(404);
    const detail = await claimGet(
      new NextRequest(`http://localhost/api/claims/${claim.id}`, {
        headers: await bearer(stranger.id, "USER"),
      }),
      { params: Promise.resolve({ id: claim.id }) }
    );
    expect(detail.status).toBe(404);

    // İçerik tipi beyanına güvenilmez: metin "image/jpeg" diye gelse de reddedilir.
    expect((await upload(Buffer.from("<html>x</html>"), fx.userId, "USER")).status).toBe(400);
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n", "latin1");
    const pdfRes = await upload(pdf, fx.hostId, "HOST");
    expect(pdfRes.status).toBe(201);
    expect((await pdfRes.json()).contentType).toBe("application/pdf");
  });

  it("dispute webhook (imzalı mock) → CHARGEBACK talebi; replay etkisiz; kapanış eşlenir", async () => {
    const g = await fx.hold({ nights: 1 });
    const payment = await pay(g.id);
    const disputeId = `dp_mock_${Date.now()}`;
    const send = (
      type: "dispute.created" | "dispute.updated" | "dispute.closed",
      eventId: string,
      status: string,
      extra: { secret?: string; headers?: Record<string, string> } = {}
    ) => {
      const signed = mockDisputeWebhook({
        eventId,
        type,
        providerRef: payment.providerRef!,
        disputeId,
        amountMinor: Number(payment.amountMinor),
        currency: "TRY",
        status,
        reason: "fraudulent",
        secret: extra.secret,
      });
      return webhookPost(
        new NextRequest("http://localhost/api/payments/webhook", {
          method: "POST",
          headers: extra.headers ?? signed.headers,
          body: signed.body,
        })
      );
    };
    const created = await send("dispute.created", `evt_${disputeId}_1`, "needs_response");
    expect(created.status).toBe(200);
    const replay = await send("dispute.created", `evt_${disputeId}_1`, "needs_response");
    expect(await replay.json()).toMatchObject({ duplicate: true });
    let claim = await prisma.claim.findUniqueOrThrow({ where: { externalRef: disputeId } });
    expect(claim).toMatchObject({
      type: "CHARGEBACK",
      bookingId: g.id,
      status: "ESCALATED",
      amountRequestedMinor: payment.amountMinor,
      externalStatus: "needs_response",
      respondentId: fx.hostId,
    });
    expect(await prisma.claim.count({ where: { externalRef: disputeId } })).toBe(1);
    // PSP itirazına yönetici karar veremez.
    await expect(
      decideClaim(admin(), claim.id, { decision: "APPROVE", note: "olmaz" })
    ).rejects.toMatchObject({ code: "CLAIM_PSP_MANAGED" });

    // İmza kuralı (v4#16): yanlış sır → 400; Stripe imzası mock aktifken → 401.
    const badSig = await send("dispute.updated", `evt_${disputeId}_x`, "under_review", {
      secret: "z".repeat(48),
    });
    expect(badSig.status).toBe(400);
    const wrongProvider = await send("dispute.updated", `evt_${disputeId}_y`, "under_review", {
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=abc" },
    });
    expect(wrongProvider.status).toBe(401);

    expect((await send("dispute.updated", `evt_${disputeId}_2`, "under_review")).status).toBe(200);
    expect((await send("dispute.closed", `evt_${disputeId}_3`, "lost")).status).toBe(200);
    claim = await prisma.claim.findUniqueOrThrow({ where: { externalRef: disputeId } });
    expect(claim).toMatchObject({
      status: "RESOLVED_APPROVED",
      externalStatus: "lost",
      awardedMinor: payment.amountMinor,
    });
    const events = await prisma.paymentEvent.count({
      where: { id: { startsWith: `evt_${disputeId}_` } },
    });
    expect(events).toBe(3);
    // Mutabakat: itiraz olayları bilinen ödemeye bağlı → yetim olay yok.
    const report = await reconcile(new Date(), prisma);
    expect(report.orphanEvents.filter((e) => e.id.startsWith(`evt_${disputeId}`))).toEqual([]);
  });

  it("misafir iadesi: serbest bırakma öncesi emanetten; sonrası önce rezerv, sonra bakiye, sonra platform; host bakiyesi eksiye düşmez", async () => {
    // Bakiyeleri izole ölçmek için ayrı ev sahibi.
    const fx2 = await createStayFixture(prisma, {
      tag: "v4-resolution-refund",
      days: 60,
      country: "Türkiye",
      policyId: "policy_flexible_v1",
    });
    const g2 = claims(fx2.userId, "USER");
    const payTwo = async (bookingId: string) => pay(bookingId, fx2.userId);

    // (1) Serbest bırakma öncesi: emanetten iade; Payment iade toplamı güncellenir.
    const pre = await fx2.hold({ nights: 2 });
    const pPre = await payTwo(pre.id);
    const wPre = await stay(pre.id);
    const preClaim = await openClaim(
      g2,
      {
        bookingId: pre.id,
        type: "GUEST_REFUND",
        amountMinor: 10_000,
        description: "Sıcak su yoktu",
      },
      new Date(wPre.checkInAt.getTime() + HOUR)
    );
    // Açılışta iade edilebilir tutarı aşan talep reddedilir.
    await expect(
      openClaim(
        g2,
        {
          bookingId: pre.id,
          type: "GUEST_REFUND",
          amountMinor: Number(pPre.amountMinor) + 1,
          description: "fazla tutar talebi",
        },
        new Date(wPre.checkInAt.getTime() + HOUR)
      )
    ).rejects.toMatchObject({
      code: expect.stringMatching(/CLAIM_(ALREADY_OPEN|AMOUNT_EXCEEDS_REFUNDABLE)/),
    });
    const preAt = new Date(wPre.checkInAt.getTime() + 2 * HOUR);
    const preRes = await decideClaim(
      claims(adminId, "ADMIN"),
      preClaim.id,
      { decision: "APPROVE", note: "Haklı" },
      preAt
    );
    expect(preRes).toMatchObject({ settledMinor: 10_000n, platformCoveredMinor: 0n });
    const pPreAfter = await prisma.payment.findUniqueOrThrow({ where: { id: pPre.id } });
    expect(pPreAfter).toMatchObject({ refundedAmountMinor: 10_000n, status: "PARTIALLY_REFUNDED" });
    const preEntry = await prisma.journalEntry.findUniqueOrThrow({
      where: { idempotencyKey: `refund-issued:claim:${preClaim.id}` },
      include: { lines: { include: { account: true } } },
    });
    expect(preEntry.lines.some((l) => l.account.kind === "ESCROW" && l.side === "DEBIT")).toBe(
      true
    );
    expect(preEntry.lines.some((l) => l.account.kind === "HOST_PAYABLE")).toBe(false);
    await assertBooksClean();

    // (2) Serbest bırakma sonrası: önce rezerv, sonra host_payable.
    const rel = await fx2.hold({ nights: 2 });
    const pRel = await payTwo(rel.id);
    const wRel = await stay(rel.id);
    const releasedAt = new Date(
      wRel.checkInAt.getTime() + getConfig().PAYOUT_RELEASE_HOURS * HOUR + HOUR
    );
    expect((await runEscrowRelease(releasedAt, { bookingIds: [rel.id] })).released).toBe(1);
    const reserve0 = await bal("reserve", fx2.hostId);
    const payable0 = await bal("payable", fx2.hostId);
    expect(reserve0).toBeGreaterThan(0n);

    const c1 = await openClaim(
      g2,
      {
        bookingId: rel.id,
        type: "GUEST_REFUND",
        amountMinor: 30_000,
        description: "Oda ilandaki gibi değildi",
      },
      new Date(releasedAt.getTime() + HOUR)
    );
    const r1 = await decideClaim(
      claims(adminId, "ADMIN"),
      c1.id,
      { decision: "APPROVE", note: "Kanıtlar yeterli" },
      new Date(releasedAt.getTime() + 2 * HOUR)
    );
    const e1 = await prisma.journalEntry.findUniqueOrThrow({
      where: { idempotencyKey: `refund-issued:claim:${c1.id}` },
      include: { lines: { include: { account: true } } },
    });
    const line = (kind: string) =>
      e1.lines
        .filter((l) => l.account.kind === kind && l.side === "DEBIT")
        .reduce((s, l) => s + l.amountMinor, 0n);
    // Ev sahibi payı rezervi tüketti, kalanı host_payable'dan; platform karşılamadı.
    expect(line("HOST_RESERVE")).toBe(reserve0);
    expect(line("HOST_PAYABLE")).toBeGreaterThan(0n);
    expect(r1.platformCoveredMinor).toBe(0n);
    expect(await bal("reserve", fx2.hostId)).toBe(0n);
    expect(await bal("payable", fx2.hostId)).toBe(payable0 - line("HOST_PAYABLE"));
    await assertBooksClean();

    // (3) Kullanılabilir bakiye yetmezse (bekleyen payout) platform üstlenir; host eksiye düşmez.
    const payable1 = await bal("payable", fx2.hostId);
    await prisma.hostPayout.create({
      data: {
        userId: fx2.hostId,
        amountMinor: payable1 - 500n,
        currency: "TRY",
        provider: "mock",
      },
    });
    const c2 = await openClaim(
      g2,
      {
        bookingId: rel.id,
        type: "GUEST_REFUND",
        amountMinor: 30_000,
        description: "İkinci sorun: gürültü",
      },
      new Date(releasedAt.getTime() + 3 * HOUR)
    );
    const r2 = await decideClaim(
      claims(adminId, "ADMIN"),
      c2.id,
      { decision: "APPROVE", note: "Kabul" },
      new Date(releasedAt.getTime() + 4 * HOUR)
    );
    expect(r2.platformCoveredMinor).toBeGreaterThan(0n);
    const payable2 = await bal("payable", fx2.hostId);
    const pending = payable1 - 500n;
    expect(payable2 - pending).toBe(0n); // kullanılabilir bakiye tam sıfır, eksi değil
    expect(payable2).toBeGreaterThanOrEqual(0n);
    expect(await bal("reserve", fx2.hostId)).toBe(0n);
    const c2Row = await prisma.claim.findUniqueOrThrow({ where: { id: c2.id } });
    expect(c2Row.platformCoveredMinor).toBe(r2.platformCoveredMinor);
    const pRelAfter = await prisma.payment.findUniqueOrThrow({ where: { id: pRel.id } });
    expect(pRelAfter.refundedAmountMinor).toBe(60_000n);
    await prisma.hostPayout.deleteMany({ where: { userId: fx2.hostId } });

    // (4) Rezerv süresi dolunca: tüketilmiş rezerv açılmaz (host_reserve eksiye düşmez).
    const later = new Date(releasedAt.getTime() + (getConfig().RESERVE_RELEASE_DAYS + 1) * DAY);
    const res = await runEscrowRelease(later, { bookingIds: [rel.id], hostIds: [fx2.hostId] });
    expect(res.reservesReleased).toBe(0);
    expect(await bal("reserve", fx2.hostId)).toBe(0n);
    await assertBooksClean();
  });

  it("API: talep açma doğrulaması ve taraf kontrolü", async () => {
    const h = await fx.hold({ nights: 1 });
    await pay(h.id);
    const post = async (userId: string, role: AccessClaims["role"], body: unknown) =>
      claimsPost(
        new NextRequest("http://localhost/api/claims", {
          method: "POST",
          headers: { ...(await bearer(userId, role)), "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      );
    // Konaklama henüz başlamadı → 409.
    const early = await post(fx.userId, "USER", {
      bookingId: h.id,
      type: "GUEST_REFUND",
      amountMinor: 100,
      description: "Henüz gitmedim ama iade",
    });
    expect(early.status).toBe(409);
    expect((await early.json()).code).toBe("CLAIM_TOO_EARLY");
    const invalid = await post(fx.userId, "USER", {
      bookingId: h.id,
      type: "CHARGEBACK",
      amountMinor: 1,
      description: "x",
    });
    expect(invalid.status).toBe(400);
    const notParty = await post(fx.hostId, "HOST", {
      bookingId: h.id,
      type: "GUEST_REFUND",
      amountMinor: 100,
      description: "Ev sahibi misafir adına",
    });
    expect(notParty.status).toBe(404);
  });
});
