import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, parkOutboxBacklog } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { relayOutbox } from "@/lib/cqrs/outbox";
import { registerEventHandlers } from "@/lib/events/register";
import { getConfig, resetConfigForTests } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { signAccessToken } from "@/lib/auth/tokens";
import { redis } from "@/lib/redis";
import { POST as noticePost } from "@/app/api/notices/route";
import { GET as noticesGet } from "@/app/api/admin/notices/route";
import { POST as decidePost } from "@/app/api/admin/notices/[id]/route";
import { GET as transparencyGet } from "@/app/api/admin/compliance/transparency/route";

const json = (method: string, url: string, body?: unknown, token?: string) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const noticeKey = () =>
  `dsa:notice:${clientKey(new Headers(), {
    trustedProxyHops: getConfig().TRUSTED_PROXY_HOPS,
    trustRealIpHeader: getConfig().TRUST_REAL_IP_HEADER,
  })}`;

describeInt("P1-13b DSA bildirim-ve-eylem", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let adminToken: string;
  let userToken: string;
  const startedAt = new Date(Date.now() - 1000);

  const validNotice = (over: Record<string, unknown> = {}) => ({
    propertyId: fx.propertyId,
    contentUrl: `http://localhost/property/${fx.propertyId}`,
    category: "UNLICENSED",
    explanation: "İlanda belge numarası sahte görünüyor; bakanlık kaydında yok.",
    reporterName: "Ayşe",
    reporterEmail: "Reporter-P113@T.test",
    goodFaith: true,
    locale: "tr",
    ...over,
  });

  beforeAll(async () => {
    registerEventHandlers();
    process.env.DSA_NOTICE_MAX_PER_WINDOW = "100";
    resetConfigForTests();
    await redis.del(noticeKey());
    fx = await createStayFixture(prisma, { tag: "p1-13b" });
    await prisma.property.update({ where: { id: fx.propertyId }, data: { isActive: true } });
    const admin = await prisma.user.create({
      data: {
        email: `admin-p113b-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "A",
        lastName: "D",
        role: "ADMIN",
      },
    });
    adminToken = (await signAccessToken(admin.id, "ADMIN", 300)).token;
    userToken = (await signAccessToken(fx.userId, "USER", 300)).token;
  });
  afterAll(async () => {
    delete process.env.DSA_NOTICE_MAX_PER_WINDOW;
    resetConfigForTests();
    await prisma.$disconnect();
  });

  it("herkese açık form: oturumsuz bildirim kaydedilir ve alındı onayı e-postalanır", async () => {
    await parkOutboxBacklog(prisma); // tam koşuda önceki dosyaların outbox birikimi
    const res = await noticePost(json("POST", "/api/notices", validNotice()));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = await prisma.notice.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "RECEIVED", reporterEmail: "reporter-p113@t.test" });

    await relayOutbox(200);
    const mail = await prisma.notification.findUnique({
      where: { dedupeKey: `dsa.notice_received:${id}` },
    });
    expect(mail?.to).toBe("reporter-p113@t.test");
    expect(mail?.subject).toBe("Bildiriminiz alındı");
  });

  it("zorunlu alanlar: iyi niyet beyanı, URL ve gerekçe olmadan 400", async () => {
    for (const bad of [
      { goodFaith: false },
      { contentUrl: "not-a-url" },
      { explanation: "kısa" },
      { reporterEmail: "x" },
      { propertyId: "missing-property" },
    ]) {
      const res = await noticePost(json("POST", "/api/notices", validNotice(bad)));
      expect(res.status).toBe(400);
    }
  });

  it("kaldırma kararı: ilan pasif, gerekçeli karar bildirimi bildirene ve ev sahibine gider", async () => {
    await parkOutboxBacklog(prisma); // tam koşuda önceki dosyaların outbox birikimi
    const created = await noticePost(json("POST", "/api/notices", validNotice()));
    const { id } = (await created.json()) as { id: string };

    expect((await noticesGet(json("GET", "/api/admin/notices", undefined, userToken))).status).toBe(
      403
    );
    const list = (await (
      await noticesGet(json("GET", "/api/admin/notices?status=RECEIVED", undefined, adminToken))
    ).json()) as { notices: { id: string }[] };
    expect(list.notices.map((n) => n.id)).toContain(id);

    const decide = (body: unknown) =>
      decidePost(json("POST", `/api/admin/notices/${id}`, body, adminToken), {
        params: Promise.resolve({ id }),
      });
    // Kaldırma dayanaksız olamaz.
    expect((await decide({ decision: "REMOVED", facts: "Belge numarası geçersiz." })).status).toBe(
      400
    );
    const ok = await decide({
      decision: "REMOVED",
      ground: "ILLEGAL_CONTENT",
      facts: "Belge numarası bakanlık kaydında bulunamadı.",
      legalReference: "7464 s. Kanun",
    });
    expect(ok.status).toBe(200);
    const { notice } = (await ok.json()) as {
      notice: { statementOfReasons: string; decision: string };
    };
    expect(notice.decision).toBe("REMOVED");
    expect(notice.statementOfReasons).toContain("Otomatik araç / Automated means: Hayır");
    expect(notice.statementOfReasons).toContain("DSA md. 17(3)(d)");
    expect(notice.statementOfReasons).toContain("İtiraz yolları / Redress");
    expect(
      (await prisma.property.findUniqueOrThrow({ where: { id: fx.propertyId } })).isActive
    ).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: { action: "dsa.notice_decided", entityId: fx.propertyId },
      })
    ).toBe(1);

    // İkinci karar 409.
    expect((await decide({ decision: "NO_ACTION", facts: "Tekrar karar denemesi." })).status).toBe(
      409
    );

    await relayOutbox(200);
    const reporterMail = await prisma.notification.findUnique({
      where: { dedupeKey: `dsa.notice_decided:${id}:reporter` },
    });
    expect(reporterMail?.text).toContain("İçerik yayından kaldırıldı.");
    const hostMail = await prisma.notification.findUnique({
      where: { dedupeKey: `dsa.notice_decided:${id}:host` },
    });
    const host = await prisma.user.findUniqueOrThrow({ where: { id: fx.hostId } });
    expect(hostMail?.to).toBe(host.email);
    expect(hostMail?.text).toContain("Olgular ve gerekçe / Facts and reasoning");
  });

  it("ilansız bildirim: kaldırma 400, işlem yapmama kararı yalnız bildirene gider", async () => {
    await parkOutboxBacklog(prisma); // tam koşuda önceki dosyaların outbox birikimi
    const created = await noticePost(
      json("POST", "/api/notices", validNotice({ propertyId: undefined, locale: "en" }))
    );
    const { id } = (await created.json()) as { id: string };
    const decide = (body: unknown) =>
      decidePost(json("POST", `/api/admin/notices/${id}`, body, adminToken), {
        params: Promise.resolve({ id }),
      });
    expect(
      (
        await decide({
          decision: "REMOVED",
          ground: "TERMS_OF_SERVICE",
          facts: "İlana bağlı değil, kaldırılamaz.",
        })
      ).status
    ).toBe(400);
    expect(
      (await decide({ decision: "NO_ACTION", facts: "Hukuka aykırılık tespit edilmedi." })).status
    ).toBe(200);
    await relayOutbox(200);
    const mail = await prisma.notification.findUnique({
      where: { dedupeKey: `dsa.notice_decided:${id}:reporter` },
    });
    expect(mail?.subject).toBe("Decision on your notice");
    expect(mail?.text).toContain("No action was taken on the content.");
    expect(
      await prisma.notification.count({ where: { dedupeKey: `dsa.notice_decided:${id}:host` } })
    ).toBe(0);
  });

  it("şeffaflık raporu JSON/CSV (yalnız ADMIN)", async () => {
    const from = startedAt.toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const url = `/api/admin/compliance/transparency?from=${from}&to=${to}`;
    expect((await transparencyGet(json("GET", url, undefined, userToken))).status).toBe(403);
    const report = (await (
      await transparencyGet(json("GET", url, undefined, adminToken))
    ).json()) as {
      notices: {
        received: number;
        decided: number;
        byDecision: Record<string, number>;
        byCategory: Record<string, number>;
        medianHoursToDecision: number | null;
      };
    };
    expect(report.notices.received).toBeGreaterThanOrEqual(2);
    expect(report.notices.decided).toBeGreaterThanOrEqual(1);
    expect(report.notices.byDecision.REMOVED).toBeGreaterThanOrEqual(1);
    expect(report.notices.byCategory.UNLICENSED).toBeGreaterThanOrEqual(2);
    expect(report.notices.medianHoursToDecision).not.toBeNull();

    const csv = await transparencyGet(json("GET", `${url}&format=csv`, undefined, adminToken));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const body = await csv.text();
    expect(body.split("\n")[0]).toBe("metric,key,value");
    expect(body).toContain("notices_by_decision,REMOVED,");
    expect(body).not.toContain("@"); // kişisel veri yok

    const bad = await transparencyGet(
      json("GET", `/api/admin/compliance/transparency?from=${to}&to=${from}`, undefined, adminToken)
    );
    expect(bad.status).toBe(400);
  });

  it("istemci başına bildirim limiti aşılınca 429", async () => {
    process.env.DSA_NOTICE_MAX_PER_WINDOW = "1";
    resetConfigForTests();
    await redis.del(noticeKey());
    const first = await noticePost(json("POST", "/api/notices", validNotice()));
    const second = await noticePost(json("POST", "/api/notices", validNotice()));
    expect([first.status, second.status]).toEqual([201, 429]);
    expect(JSON.stringify(await second.json())).toContain("NOTICE_RATE_LIMITED");
  });
});
