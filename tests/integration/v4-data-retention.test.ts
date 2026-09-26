// P0-5 veri yaşam döngüsü: saklama süresi dolan operasyonel kayıtlar partiler hâlinde silinir;
// yasal saklamalı kayıtlar (DSA/talep denetim izleri, engellenen mesaj bayrakları, fatura,
// jurnal) ve Omnibus penceresi başındaki fiyat korunur. DB paylaşımlı → yalnızca kendi
// fixture kimlikleri assert edilir (test-stabilization kural 1).
import { afterAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import { getConfig } from "@/lib/config/app-config";
import { pruneExpiredData } from "@/lib/privacy/retention";

const DAY_MS = 86_400_000;

describeInt("P0-5 veri saklama bakımı (data-retention)", () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it("süresi dolanları partiler hâlinde siler; yasal saklamalıları ve güncel kayıtları korur", async () => {
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const stamp = `ret-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const config = { ...getConfig(), RETENTION_BATCH_SIZE: 50, RETENTION_MAX_BATCHES: 10_000 };

    // AuditLog (730 gün)
    const audit = async (action: string, createdAt: Date) =>
      (
        await prisma.auditLog.create({
          data: { actorId: stamp, action, entity: "Test", createdAt },
        })
      ).id;
    const auditOld = await audit("auth.reauth", ago(800));
    const auditDsa = await audit("dsa.notice_decided", ago(800));
    const auditClaim = await audit("claim.opened", ago(800));
    const auditRole = await audit("user.role", ago(800));
    const auditRecent = await audit("auth.reauth", ago(10));

    // PaymentEvent (90 gün)
    await prisma.paymentEvent.createMany({
      data: [
        { id: `${stamp}-old`, type: "t", receivedAt: ago(120) },
        { id: `${stamp}-new`, type: "t", receivedAt: ago(5) },
      ],
    });

    // OutboxMessage (DONE, 30 gün)
    const outbox = async (status: "DONE" | "DEAD", processedAt: Date) =>
      (
        await prisma.outboxMessage.create({
          data: {
            eventType: "test.retention",
            aggregateId: stamp,
            aggregateType: "Test",
            payload: {},
            status,
            createdAt: processedAt,
            processedAt,
          },
        })
      ).id;
    const outboxOldDone = await outbox("DONE", ago(40));
    const outboxOldDead = await outbox("DEAD", ago(40));
    const outboxRecentDone = await outbox("DONE", ago(3));

    // InventoryPriceHistory (400 gün; Omnibus penceresi başındaki fiyat korunur)
    const roomTypeId = `rt-${stamp}`;
    const futureNight = utcDay(30);
    const ph = async (date: Date, priceMinor: number, effectiveAt: Date) =>
      (
        await prisma.inventoryPriceHistory.create({
          data: { roomTypeId, date, priceMinor: BigInt(priceMinor), effectiveAt },
        })
      ).id;
    const phSuperseded = await ph(futureNight, 1000, ago(500));
    const phBaseline = await ph(futureNight, 1100, ago(450));
    const phRecent = await ph(futureNight, 1200, ago(10));
    const phPastNight = await ph(utcDay(-500), 900, ago(10));

    // MessageRiskFlag (365 gün; engellenenler kalır)
    const flag = async (blocked: boolean, createdAt: Date) =>
      (
        await prisma.messageRiskFlag.create({
          data: {
            bookingId: stamp,
            senderId: stamp,
            level: "WARN",
            score: 50,
            reasons: [],
            blocked,
            createdAt,
          },
        })
      ).id;
    const flagOld = await flag(false, ago(400));
    const flagBlocked = await flag(true, ago(400));

    // AuthToken (bitişten 30 gün sonra)
    const user = await prisma.user.create({
      data: { email: `${stamp}@t.test`, passwordHash: "x", firstName: "R", lastName: "T" },
    });
    const token = async (expiresAt: Date) =>
      (
        await prisma.authToken.create({
          data: {
            userId: user.id,
            kind: "PASSWORD_RESET",
            tokenHash: `${stamp}-${expiresAt.getTime()}`,
            expiresAt,
          },
        })
      ).id;
    const tokenOld = await token(ago(60));
    const tokenRecent = await token(ago(5));

    const legalBefore = await Promise.all([
      prisma.invoice.count(),
      prisma.journalEntry.count(),
      prisma.notice.count(),
    ]);

    const result = await pruneExpiredData(now, config);

    const ids = async <T extends { id: unknown }>(rows: Promise<T[]>) =>
      new Set((await rows).map((r) => String(r.id)));
    const auditLeft = await ids(prisma.auditLog.findMany({ where: { actorId: stamp } }));
    expect(auditLeft.has(auditOld)).toBe(false);
    for (const kept of [auditDsa, auditClaim, auditRole, auditRecent]) {
      expect(auditLeft.has(kept)).toBe(true);
    }

    const events = await ids(
      prisma.paymentEvent.findMany({ where: { id: { startsWith: stamp } } })
    );
    expect([...events]).toEqual([`${stamp}-new`]);

    const outboxLeft = await ids(prisma.outboxMessage.findMany({ where: { aggregateId: stamp } }));
    expect(outboxLeft.has(outboxOldDone)).toBe(false);
    expect(outboxLeft.has(outboxOldDead)).toBe(true);
    expect(outboxLeft.has(outboxRecentDone)).toBe(true);

    const phLeft = await ids(prisma.inventoryPriceHistory.findMany({ where: { roomTypeId } }));
    expect(phLeft.has(String(phSuperseded))).toBe(false);
    expect(phLeft.has(String(phPastNight))).toBe(false);
    expect(phLeft.has(String(phBaseline))).toBe(true);
    expect(phLeft.has(String(phRecent))).toBe(true);

    const flagsLeft = await ids(prisma.messageRiskFlag.findMany({ where: { bookingId: stamp } }));
    expect(flagsLeft.has(flagOld)).toBe(false);
    expect(flagsLeft.has(flagBlocked)).toBe(true);

    const tokensLeft = await ids(prisma.authToken.findMany({ where: { userId: user.id } }));
    expect([...tokensLeft]).toEqual([tokenRecent]);
    expect(tokensLeft.has(tokenOld)).toBe(false);

    for (const table of Object.keys(result)) {
      expect(result[table as keyof typeof result]).toBeGreaterThanOrEqual(0);
    }
    expect(result.AuditLog).toBeGreaterThanOrEqual(1);

    // Yasal saklamalı tablolara dokunulmaz.
    const legalAfter = await Promise.all([
      prisma.invoice.count(),
      prisma.journalEntry.count(),
      prisma.notice.count(),
    ]);
    expect(legalAfter).toEqual(legalBefore);

    // İdempotent: ikinci çalıştırma kendi fixture'larımızdan hiçbir şey silmez.
    await pruneExpiredData(now, config);
    expect(
      await prisma.auditLog.count({ where: { actorId: stamp } }),
      "ikinci koşu korunan denetim kayıtlarını silmemeli"
    ).toBe(4);
  });
});
