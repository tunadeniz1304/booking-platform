import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  TAKEDOWN_SLA_CHECK_JOB,
  checkTakedownSla,
  receiveTakedown,
  sweepTakedownSla,
  takedownSlaBreachTotal,
} from "@/lib/compliance/takedown";
import { updateProperty } from "@/lib/host/host-service";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { logger } from "@/lib/observability/logger";
import { signAccessToken } from "@/lib/auth/tokens";
import type { AccessClaims } from "@/lib/auth";
import { GET as listGet, POST as createPost } from "@/app/api/admin/takedowns/route";
import { POST as closePost } from "@/app/api/admin/takedowns/[id]/route";

const HOUR = 3_600_000;
const hostClaims = (userId: string): AccessClaims => ({
  userId,
  role: "HOST",
  jti: "j",
  exp: 0,
  tv: 0,
});

async function breachCount(): Promise<number> {
  const m = await takedownSlaBreachTotal.get();
  return m.values.reduce((sum, v) => sum + v.value, 0);
}

describeInt("P1-13a 7565 kaldırma talebi + 24 saat SLA", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let adminId: string;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "p1-13a" });
    await prisma.property.update({
      where: { id: fx.propertyId },
      data: { licenseNumber: "TR-P113A-0001", licenseStatus: "VERIFIED" },
    });
    adminId = (
      await prisma.user.create({
        data: {
          email: `admin-p113a-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: "A",
          lastName: "D",
          role: "ADMIN",
        },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("talep alındığında ilan pasif olur, denetim kaydı yazılır ve SLA işi +24 saate planlanır", async () => {
    await prisma.property.update({ where: { id: fx.propertyId }, data: { isActive: true } });
    const now = new Date();
    const t = await receiveTakedown(
      {
        source: "MINISTRY_7565",
        propertyId: fx.propertyId,
        reason: "Belgesiz ilan",
        referenceNo: "E-1",
      },
      adminId,
      now
    );
    expect(t.status).toBe("ACTIONED");
    expect(t.slaDueAt.getTime() - t.receivedAt.getTime()).toBe(24 * HOUR);
    const property = await prisma.property.findUniqueOrThrow({ where: { id: fx.propertyId } });
    expect(property.isActive).toBe(false);
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "takedown.received", entityId: fx.propertyId },
    });
    expect(auditRow?.actorId).toBe(adminId);

    const job = await getQueue(QUEUE_NAMES.compliance).getJob(`takedown-sla-${t.id}`);
    expect(job?.name).toBe(TAKEDOWN_SLA_CHECK_JOB);
    expect(job?.data).toEqual({ takedownId: t.id });
    expect(job?.opts.delay).toBeGreaterThan(24 * HOUR - 60_000);
    await job?.remove();

    // Açık talep varken ev sahibi ilanı yeniden yayına alamaz.
    await expect(
      updateProperty(hostClaims(fx.hostId), fx.propertyId, { isActive: true })
    ).rejects.toMatchObject({ status: 409, code: "TAKEDOWN_ACTIVE" });

    // Süre dolmadan kontrol → not_due; dolunca ilan pasif → ok (aşım yok).
    expect(await checkTakedownSla(t.id, new Date(now.getTime() + HOUR))).toBe("not_due");
    const before = await breachCount();
    expect(await checkTakedownSla(t.id, new Date(now.getTime() + 25 * HOUR))).toBe("ok");
    expect(await checkTakedownSla(t.id, new Date(now.getTime() + 26 * HOUR))).toBe(
      "already_checked"
    );
    expect(await breachCount()).toBe(before);
  });

  it("SLA bitişinde ilan yayındaysa aşım: metrik + alarm logu + ilan zorla pasif", async () => {
    const now = new Date();
    const t = await receiveTakedown(
      { source: "MINISTRY_7565", propertyId: fx.propertyId, reason: "Tekrar uyarı" },
      adminId,
      now
    );
    await (await getQueue(QUEUE_NAMES.compliance).getJob(`takedown-sla-${t.id}`))?.remove();
    // Kuralı atlayan bir yol (ör. doğrudan DB) ilanı yeniden açmış olsun.
    await prisma.property.update({ where: { id: fx.propertyId }, data: { isActive: true } });

    const errorSpy = vi.spyOn(logger, "error");
    const before = await breachCount();
    const counts = await sweepTakedownSla(new Date(now.getTime() + 24 * HOUR + 1000));
    expect(counts.breached).toBeGreaterThanOrEqual(1);
    expect(await breachCount()).toBe(before + counts.breached);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ alert: "TAKEDOWN_SLA_BREACH", takedownId: t.id }),
      expect.stringContaining("ALERT")
    );
    errorSpy.mockRestore();

    const row = await prisma.takedownRequest.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.slaBreachedAt).not.toBeNull();
    expect(
      (await prisma.property.findUniqueOrThrow({ where: { id: fx.propertyId } })).isActive
    ).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: { action: "takedown.sla_breach", entityId: fx.propertyId },
      })
    ).toBeGreaterThanOrEqual(1);
  });

  it("admin API: ADMIN listeler/oluşturur/kapatır; diğer roller 403", async () => {
    const adminToken = (await signAccessToken(adminId, "ADMIN", 300)).token;
    const userToken = (await signAccessToken(fx.userId, "USER", 300)).token;
    const call = (token: string, method: string, body?: unknown, path = "/api/admin/takedowns") =>
      new NextRequest(`http://localhost${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });

    expect((await listGet(call(userToken, "GET"))).status).toBe(403);
    const created = await createPost(
      call(adminToken, "POST", { propertyId: fx.propertyId, reason: "API talebi" })
    );
    expect(created.status).toBe(201);
    const { takedown } = (await created.json()) as { takedown: { id: string } };
    await (await getQueue(QUEUE_NAMES.compliance).getJob(`takedown-sla-${takedown.id}`))?.remove();
    expect(
      (await createPost(call(adminToken, "POST", { propertyId: "yok", reason: "x y z" }))).status
    ).toBe(404);

    const list = (await (await listGet(call(adminToken, "GET"))).json()) as {
      takedowns: { id: string }[];
    };
    expect(list.takedowns.map((x) => x.id)).toContain(takedown.id);

    // Tüm açık talepleri kapat → ilan yeniden yayına alınabilir.
    const open = await prisma.takedownRequest.findMany({
      where: { propertyId: fx.propertyId, status: { not: "CLOSED" } },
    });
    for (const o of open) {
      const res = await closePost(
        call(
          adminToken,
          "POST",
          { resolution: "Makam talebi geri çekti" },
          `/api/admin/takedowns/${o.id}`
        ),
        { params: Promise.resolve({ id: o.id }) }
      );
      expect(res.status).toBe(200);
    }
    const again = await closePost(
      call(adminToken, "POST", { resolution: "tekrar" }, `/api/admin/takedowns/${takedown.id}`),
      { params: Promise.resolve({ id: takedown.id }) }
    );
    expect(again.status).toBe(409);
    await expect(
      updateProperty(hostClaims(fx.hostId), fx.propertyId, { isActive: true })
    ).resolves.toMatchObject({ isActive: true });
  });
});
