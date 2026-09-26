import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken } from "@/lib/auth/tokens";
import { relayOutbox } from "@/lib/cqrs/outbox";
import { registerEventHandlers } from "@/lib/events/register";
import { inlineFlow, setFulfilmentFlowForTests } from "@/lib/saga/booking-saga";
import { resetConfigForTests } from "@/lib/config/app-config";
import { redis } from "@/lib/redis";
import { appealToken, hasActiveDsaRestriction } from "@/lib/compliance/dsa-appeal";
import { redisRevocationStore } from "@/lib/agentic/mandate";
import { updateProperty } from "@/lib/host/host-service";
import { POST as noticePost } from "@/app/api/notices/route";
import { POST as decidePost } from "@/app/api/admin/notices/[id]/route";
import { POST as appealPost } from "@/app/api/notices/[id]/appeals/route";
import { GET as appealsGet } from "@/app/api/admin/notice-appeals/route";
import { POST as appealDecide } from "@/app/api/admin/notice-appeals/[id]/route";
import { GET as mandatesGet, POST as issuePost } from "@/app/api/account/agent-mandates/route";
import { DELETE as mandateDelete } from "@/app/api/account/agent-mandates/[nonce]/route";
import { POST as acpCreate } from "@/app/api/agentic/checkout_sessions/route";
import { POST as acpComplete } from "@/app/api/agentic/checkout_sessions/[id]/complete/route";

type Ctx<K extends string> = { params: Promise<Record<K, string>> };
type Handler<K extends string> = (req: NextRequest, ctx: Ctx<K>) => Promise<Response>;
const ctx = <K extends string>(key: K, value: string) =>
  ({ params: Promise.resolve({ [key]: value }) }) as Ctx<K>;
const call0 = (handler: unknown, r: NextRequest) =>
  (handler as (req: NextRequest) => Promise<Response>)(r);

const req = (method: string, path: string, body?: unknown, bearer?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": `p21a-${Math.random().toString(36).slice(2)}`,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/**
 * Paylaşımlı DB'de outbox'ta önceki dosyaların birikmiş mesajları olabilir (test-stabilization
 * kural 1): tek `relayOutbox(200)` bizim mesajımıza ulaşmayabilir. Beklenen bildirim(ler)
 * oluşana ya da kuyruk boşalana dek parti parti aktarır (sınırlı döngü).
 */
async function relayUntil(
  prisma: PrismaClient,
  dedupeKeys: string[],
  maxRounds = 50
): Promise<void> {
  for (let round = 0; round < maxRounds; round++) {
    const found = await prisma.notification.count({ where: { dedupeKey: { in: dedupeKeys } } });
    if (found >= dedupeKeys.length) return;
    if ((await relayOutbox(500)) === 0) {
      const pending = await prisma.outboxMessage.count({
        where: { status: "PENDING", availableAfter: { lte: new Date() } },
      });
      if (pending === 0) return;
    }
  }
}

/**
 * P2-1a — DSA md. 20 itiraz akışı + DSA kaldırmasında yeniden yayın engeli; AP2 mandate
 * listesi ve iptali (iptal edilen nonce checkout'ta 403 MANDATE_REVOKED; Redis kaybında
 * AuditLog yedeği).
 */
describeInt("P2-1a DSA itiraz + mandate iptali (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let adminToken = "";
  let userToken = "";
  let hostClaims: { userId: string; role: "HOST"; sid: string };

  const submitNotice = async () => {
    const res = await noticePost(
      req("POST", "/api/notices", {
        propertyId: fx.propertyId,
        contentUrl: `http://localhost/property/${fx.propertyId}`,
        category: "UNLICENSED",
        explanation: "Belge numarası bakanlık kaydında görünmüyor, lütfen inceleyin.",
        reporterEmail: "reporter-p21a@t.test",
        goodFaith: true,
      })
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const decide = (id: string, body: unknown) =>
    (decidePost as unknown as Handler<"id">)(
      req("POST", `/api/admin/notices/${id}`, body, adminToken),
      ctx("id", id)
    );
  const appeal = (noticeId: string, body: unknown) =>
    (appealPost as unknown as Handler<"id">)(
      req("POST", `/api/notices/${noticeId}/appeals`, body),
      ctx("id", noticeId)
    );
  const decideAppeal = (id: string, body: unknown, bearer = adminToken) =>
    (appealDecide as unknown as Handler<"id">)(
      req("POST", `/api/admin/notice-appeals/${id}`, body, bearer),
      ctx("id", id)
    );
  const relist = () =>
    updateProperty(hostClaims as never, fx.propertyId, { isActive: true }).then(
      () => 200,
      (e: { status?: number; code?: string }) => e.code ?? e.status
    );

  beforeAll(async () => {
    registerEventHandlers();
    setFulfilmentFlowForTests(inlineFlow);
    process.env.DSA_NOTICE_MAX_PER_WINDOW = "1000";
    resetConfigForTests();
    fx = await createStayFixture(prisma, { tag: "p21a", units: 3, days: 40 });
    await prisma.property.update({
      where: { id: fx.propertyId },
      data: { isActive: true, licenseNumber: "34-0001", licenseStatus: "VERIFIED" },
    });
    const admin = await prisma.user.create({
      data: {
        email: `admin-p21a-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "A",
        lastName: "D",
        role: "ADMIN",
      },
    });
    adminToken = (await signAccessToken(admin.id, "ADMIN", 900)).token;
    userToken = (await signAccessToken(fx.userId, "USER", 900, 0, Math.floor(Date.now() / 1000)))
      .token;
    hostClaims = { userId: fx.hostId, role: "HOST", sid: "s" };
  });
  afterAll(async () => {
    delete process.env.DSA_NOTICE_MAX_PER_WINDOW;
    resetConfigForTests();
    await prisma.$disconnect();
  });

  it("DSA REMOVED → yeniden yayın 409; ev sahibi itirazı kabul → engel kalkar", async () => {
    const id = await submitNotice();
    const decided = await decide(id, {
      decision: "REMOVED",
      ground: "ILLEGAL_CONTENT",
      facts: "Belge numarası kayıtta bulunamadı.",
    });
    expect(decided.status).toBe(200);
    expect(await relist()).toBe("DSA_RESTRICTION_ACTIVE");
    expect(await hasActiveDsaRestriction(fx.propertyId)).toBe(true);

    // Karar e-postası imzalı itiraz bağlantısını taşır (rol başına).
    await relayUntil(prisma, [
      `dsa.notice_decided:${id}:host`,
      `dsa.notice_decided:${id}:reporter`,
    ]);
    const hostMail = await prisma.notification.findUniqueOrThrow({
      where: { dedupeKey: `dsa.notice_decided:${id}:host` },
    });
    expect(hostMail.text).toContain(`/report/appeal?notice=${id}&role=host&token=`);
    const reporterMail = await prisma.notification.findUniqueOrThrow({
      where: { dedupeKey: `dsa.notice_decided:${id}:reporter` },
    });
    expect(reporterMail.text).toContain("role=reporter");

    const reason = "Belge numaram geçerli; bakanlık kaydının ekran görüntüsünü ekledim.";
    // Yanlış/başka rolün belirteci 403; kısa gerekçe 400.
    expect(
      (await appeal(id, { role: "host", token: appealToken(id, "REPORTER"), reason })).status
    ).toBe(403);
    expect(
      (await appeal(id, { role: "host", token: appealToken(id, "HOST"), reason: "kısa" })).status
    ).toBe(400);
    const ok = await appeal(id, { role: "host", token: appealToken(id, "HOST"), reason });
    expect(ok.status).toBe(201);
    const { id: appealId } = (await ok.json()) as { id: string };
    // Rol başına tek itiraz.
    const dup = await appeal(id, { role: "host", token: appealToken(id, "HOST"), reason });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ code: "APPEAL_EXISTS" });

    // Kuyruk yalnız ADMIN.
    expect(
      (await call0(appealsGet, req("GET", "/api/admin/notice-appeals", undefined, userToken)))
        .status
    ).toBe(403);
    const list = (await (
      await call0(
        appealsGet,
        req("GET", "/api/admin/notice-appeals?status=PENDING", undefined, adminToken)
      )
    ).json()) as { appeals: { id: string; notice: { id: string } | null }[] };
    expect(list.appeals.find((a) => a.id === appealId)?.notice?.id).toBe(id);
    expect(
      (
        await decideAppeal(
          appealId,
          { outcome: "UPHELD", response: "Kayıt doğrulandı." },
          userToken
        )
      ).status
    ).toBe(403);

    const res = await decideAppeal(appealId, {
      outcome: "UPHELD",
      response: "Belge numarası bakanlık kaydında doğrulandı; karar geri alındı.",
    });
    expect(res.status).toBe(200);
    expect(await hasActiveDsaRestriction(fx.propertyId)).toBe(false);
    // İlan otomatik açılmaz; ev sahibi açabilir.
    expect(
      (await prisma.property.findUniqueOrThrow({ where: { id: fx.propertyId } })).isActive
    ).toBe(false);
    expect(await relist()).toBe(200);
    expect(
      (await decideAppeal(appealId, { outcome: "REJECTED", response: "İkinci karar denemesi." }))
        .status
    ).toBe(409);
    expect(
      await prisma.auditLog.count({
        where: { action: "dsa.appeal_decided", entityId: fx.propertyId },
      })
    ).toBeGreaterThanOrEqual(1);

    await relayUntil(prisma, [`dsa.appeal_received:${appealId}`, `dsa.appeal_decided:${appealId}`]);
    const received = await prisma.notification.findUnique({
      where: { dedupeKey: `dsa.appeal_received:${appealId}` },
    });
    expect(received?.subject).toBe("İtirazınız alındı");
    const outcome = await prisma.notification.findUniqueOrThrow({
      where: { dedupeKey: `dsa.appeal_decided:${appealId}` },
    });
    expect(outcome.text).toContain("İtirazınız kabul edildi");
    expect(outcome.text).toContain("DSA md. 21");
  });

  it("bildiren itirazı: NO_ACTION kabul → ilan kaldırılır (dayanak zorunlu) ve yeniden yayın engellenir", async () => {
    const id = await submitNotice();
    expect(
      (await decide(id, { decision: "NO_ACTION", facts: "Aykırılık tespit edilmedi." })).status
    ).toBe(200);
    // Ev sahibi NO_ACTION kararına itiraz edemez (kısıtlama yok).
    expect(
      (
        await appeal(id, {
          role: "host",
          token: appealToken(id, "HOST"),
          reason: "Bu karara itiraz etmek istiyorum çünkü...",
        })
      ).status
    ).toBe(400);
    const created = await appeal(id, {
      role: "reporter",
      token: appealToken(id, "REPORTER"),
      reason: "İlan hâlâ belgesiz; bakanlık sorgusunda sonuç çıkmıyor, tekrar inceleyin.",
      locale: "en",
    });
    expect(created.status).toBe(201);
    const { id: appealId } = (await created.json()) as { id: string };
    expect(
      (
        await decideAppeal(appealId, {
          outcome: "UPHELD",
          response: "Yeniden incelendi, belge yok.",
        })
      ).status
    ).toBe(400);
    const res = await decideAppeal(appealId, {
      outcome: "UPHELD",
      response: "Yeniden incelendi; belge kaydı bulunamadı.",
      ground: "ILLEGAL_CONTENT",
    });
    expect(res.status).toBe(200);
    expect(
      (await prisma.property.findUniqueOrThrow({ where: { id: fx.propertyId } })).isActive
    ).toBe(false);
    expect(await relist()).toBe("DSA_RESTRICTION_ACTIVE");
    await relayUntil(prisma, [`dsa.appeal_decided:${appealId}`]);
    const mail = await prisma.notification.findUniqueOrThrow({
      where: { dedupeKey: `dsa.appeal_decided:${appealId}` },
    });
    expect(mail.subject).toBe("Decision on your appeal");
    expect(
      await prisma.notification.count({
        where: { dedupeKey: `dsa.appeal_decided:${appealId}:host` },
      })
    ).toBe(1);
  });

  it("itiraz süresi: karardan 180 gün sonra 409 APPEAL_WINDOW_CLOSED; karar yoksa 409", async () => {
    const id = await submitNotice();
    const reason = "Karar hatalı, lütfen yeniden değerlendirin; ek belge sunuyorum.";
    const pending = await appeal(id, {
      role: "reporter",
      token: appealToken(id, "REPORTER"),
      reason,
    });
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ code: "NOTICE_NOT_DECIDED" });
    await decide(id, { decision: "NO_ACTION", facts: "Aykırılık tespit edilmedi." });
    await prisma.notice.update({
      where: { id },
      data: { decidedAt: new Date(Date.now() - 181 * 86_400_000) },
    });
    const late = await appeal(id, { role: "reporter", token: appealToken(id, "REPORTER"), reason });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ code: "APPEAL_WINDOW_CLOSED" });
  });

  it("mandate listesi + iptal: iptal edilen nonce checkout'ta 403 MANDATE_REVOKED; Redis kaybında AuditLog yedeği", async () => {
    const issued = await call0(
      issuePost,
      req(
        "POST",
        "/api/account/agent-mandates",
        {
          maxAmountMinor: 10_000_000,
          currency: "TRY",
          expiresInMinutes: 60,
          propertyIds: [fx.propertyId],
        },
        userToken
      )
    );
    expect(issued.status).toBe(201);
    const { mandate, claims } = (await issued.json()) as {
      mandate: string;
      claims: { nonce: string };
    };

    const listed = (await (
      await call0(mandatesGet, req("GET", "/api/account/agent-mandates", undefined, userToken))
    ).json()) as { mandates: { nonce: string; status: string; used: boolean | null }[] };
    expect(listed.mandates.find((m) => m.nonce === claims.nonce)).toMatchObject({
      status: "active",
      used: false,
    });

    // Başkasının mandate'i 404.
    const other = (await signAccessToken(fx.hostId, "HOST", 900)).token;
    const revokeAs = (bearer: string) =>
      (mandateDelete as unknown as Handler<"nonce">)(
        req("DELETE", `/api/account/agent-mandates/${claims.nonce}`, undefined, bearer),
        ctx("nonce", claims.nonce)
      );
    expect((await revokeAs(other)).status).toBe(404);
    expect((await revokeAs(userToken)).status).toBe(200);
    expect((await revokeAs(userToken)).status).toBe(200); // idempotent
    expect(
      await prisma.auditLog.count({
        where: { action: "agent_mandate.revoked", entityId: claims.nonce },
      })
    ).toBe(1);

    // Önceki testlerde DSA kısıtlaması altına alınan ilanı checkout için doğrudan aç.
    await prisma.property.update({ where: { id: fx.propertyId }, data: { isActive: true } });
    const session = await call0(
      acpCreate,
      req(
        "POST",
        "/api/agentic/checkout_sessions",
        { room_id: fx.roomId, check_in: iso(utcDay(30)), check_out: iso(utcDay(31)), guests: 1 },
        userToken
      )
    );
    expect(session.status).toBe(201);
    const { id: sessionId } = (await session.json()) as { id: string };
    const complete = await (acpComplete as unknown as Handler<"id">)(
      req(
        "POST",
        `/api/agentic/checkout_sessions/${sessionId}/complete`,
        { payment_data: { token: "spt_mock_ok", provider: "mock" }, mandate },
        userToken
      ),
      ctx("id", sessionId)
    );
    expect(complete.status).toBe(403);
    expect(await complete.json()).toMatchObject({ code: "MANDATE_REVOKED" });

    // Redis işareti kaybolsa da kalıcı kayıttan iptal okunur.
    await redis.del(`agent-mandate:revoked:${claims.nonce}`);
    await expect(redisRevocationStore.isRevoked(claims.nonce)).resolves.toBe(true);

    const after = (await (
      await call0(mandatesGet, req("GET", "/api/account/agent-mandates", undefined, userToken))
    ).json()) as { mandates: { nonce: string; status: string; used: boolean | null }[] };
    expect(after.mandates.find((m) => m.nonce === claims.nonce)).toMatchObject({
      status: "revoked",
      used: false,
    });
  });
});
