// v5#2: hasar depozitosu capture'ı iki aşamalı niyetle (CAPTURING) ve idempotency anahtarıyla
// yapılır. PSP capture'ı başarılı olup DB işlemi (tx2) düşerse kart çekilmiş ama depozito
// AUTHORIZED / jurnalsiz kalmamalı: `deposit-capture-sweep` aynı anahtarla uzlaştırır → tek
// capture + tek jurnal; hasar talebi yeniden kararında tahsil edilen tutar "tahsil edilemedi"
// sayılmaz.
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { confirmPaymentChallenge, payForBooking } from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import type { Money } from "@/lib/money/money";
import { getConfig } from "@/lib/config/app-config";
import type { AccessClaims } from "@/lib/auth";
import { releaseAt } from "@/lib/payout/escrow";
import { isTrialBalanced, trialBalance } from "@/lib/ledger";
import { decideClaim, openClaim } from "@/lib/resolution/claims";
import * as depositModule from "@/lib/resolution/deposit";
import { captureDeposit, depositWindow, sweepDeposits } from "@/lib/resolution/deposit";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Depozito capture süpürücüsü (v5#2'de eklenir; kırmızı aşamada yok). */
const sweepCapturing = (now: Date) =>
  (
    depositModule as unknown as {
      sweepCapturingDeposits: (now: Date) => Promise<unknown>;
    }
  ).sweepCapturingDeposits(now);

/** Capture çağrılarını (ref, tutar, idempotency anahtarı) kaydeden mock. */
class SpyPsp extends MockPsp {
  captures: Array<{ ref: string; amount: number; key: string | undefined }> = [];
  override async capture(ref: string, amount: Money, idempotencyKey?: string) {
    this.captures.push({ ref, amount: amount.amount, key: idempotencyKey });
    return super.capture(ref, amount);
  }
}

describeInt("v5#2 depozito capture iki aşamalı niyet + süpürücü (regression: v5#2)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let adminId = "";
  let key = 0;
  const triggers: string[] = [];

  beforeAll(async () => {
    fx = await createStayFixture(prisma, {
      tag: "v5-deposit-capture",
      days: 150,
      country: "Türkiye",
      policyId: "policy_flexible_v1",
    });
    await prisma.damageDepositSetting.create({
      data: { propertyId: fx.propertyId, amountMinor: 30_000n },
    });
    adminId = (
      await prisma.user.create({
        data: {
          email: `v5dep-admin-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: "Yönetici",
          lastName: "Test",
          role: "ADMIN",
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
  });
  afterEach(async () => {
    setPaymentProviderForTests(null);
    await dropFaults();
  });
  afterAll(async () => {
    await dropFaults();
    await prisma.$disconnect();
  });

  const claims = (userId: string, role: AccessClaims["role"]): AccessClaims => ({
    userId,
    role,
    jti: "j",
    exp: 0,
    tv: 0,
  });

  /** tx2 hata enjeksiyonu: bu depozitonun jurnal kaydı eklenirken DB hatası. */
  async function failJournalOf(depositId: string) {
    const name = `v5dep_fail_${depositId.replace(/[^a-z0-9]/gi, "")}`.toLowerCase();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$
      BEGIN
        IF NEW."idempotencyKey" = 'deposit-captured:${depositId}' THEN
          RAISE EXCEPTION 'v5#2 enjekte tx2 hatası';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION ${name}()`
    );
    triggers.push(name);
  }

  async function dropFaults() {
    for (const name of triggers.splice(0)) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "JournalEntry"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    }
  }

  async function authorizedDeposit() {
    const b = await fx.hold({ nights: 2 });
    let out = await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `v5dep-${++key}-${Date.now()}`,
    });
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({
        bookingId: b.id,
        userId: fx.userId,
        code: MOCK_3DS_CODE,
      });
    }
    expect(out.status).toBe("confirmed");
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: b.id },
      select: {
        checkIn: true,
        checkOut: true,
        property: { select: { timeZone: true, checkInTime: true, checkOutTime: true } },
      },
    });
    const w = {
      ...depositWindow(row, row.property),
      checkInAt: releaseAt(row.checkIn, row.property, 0),
    };
    await sweepDeposits(new Date(w.authorizeAfter.getTime() + 60_000), { bookingIds: [b.id] });
    const dep = await prisma.damageDeposit.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(dep.status).toBe("AUTHORIZED");
    return { bookingId: b.id, dep, w };
  }

  const journalCount = (depositId: string) =>
    prisma.journalEntry.count({ where: { idempotencyKey: `deposit-captured:${depositId}` } });

  /** Süpürücü eşiğinden sonraki bir "şimdi". */
  const later = (from: Date) =>
    new Date(
      from.getTime() +
        (((getConfig() as unknown as Record<string, number>).DEPOSIT_CAPTURE_SWEEP_AFTER_SECONDS ??
          0) +
          60) *
          1000
    );

  it("capture sonrası tx2 düşer → CAPTURING kalır; süpürücü tek capture (aynı anahtar) + tek jurnal", async () => {
    const { dep, w } = await authorizedDeposit();
    const psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    await failJournalOf(dep.id);
    const at = new Date(w.authorizeAfter.getTime() + 2 * 60_000);
    await expect(captureDeposit(dep.id, 20_000n, at)).rejects.toBeTruthy();
    const mid = await prisma.damageDeposit.findUniqueOrThrow({ where: { id: dep.id } });
    expect(mid.status).toBe("CAPTURING");
    expect(await journalCount(dep.id)).toBe(0);
    await dropFaults();

    await sweepCapturing(later(new Date()));
    const after = await prisma.damageDeposit.findUniqueOrThrow({ where: { id: dep.id } });
    expect(after).toMatchObject({ status: "CAPTURED_PARTIAL", capturedMinor: 20_000n });
    expect(await journalCount(dep.id)).toBe(1);
    const keys = new Set(psp.captures.filter((c) => c.ref === dep.providerRef).map((c) => c.key));
    expect([...keys]).toEqual([`deposit-capture:${dep.id}`]);
    // İkinci süpürme yeni capture/jurnal üretmez.
    const calls = psp.captures.length;
    await sweepCapturing(later(new Date()));
    expect(psp.captures.length).toBe(calls);
    expect(await journalCount(dep.id)).toBe(1);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });

  it("hasar kararı: capture tx'i düşerse talep açık kalır; süpürme sonrası yeniden karar tahsil edileni sayar", async () => {
    const { bookingId, dep, w } = await authorizedDeposit();
    const psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const claim = await openClaim(
      claims(fx.hostId, "HOST"),
      { bookingId, type: "HOST_DAMAGE", amountMinor: 25_000, description: "Kırık sehpa ve ayna" },
      new Date(w.checkInAt.getTime() + 2 * DAY)
    );
    await failJournalOf(dep.id);
    const decidedAt = new Date(w.checkInAt.getTime() + 3 * DAY);
    const decide = () =>
      decideClaim(
        claims(adminId, "ADMIN"),
        claim.id,
        { decision: "APPROVE", note: "Fotoğraflar hasarı doğruluyor" },
        decidedAt
      );
    await expect(decide()).rejects.toBeTruthy();
    const open = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(open.status).not.toMatch(/^RESOLVED/);
    await dropFaults();

    await sweepCapturing(later(new Date()));
    const result = await decide();
    expect(result).toMatchObject({
      status: "RESOLVED_APPROVED",
      awardedMinor: 25_000n,
      settledMinor: 25_000n,
      uncollectedMinor: 0n,
    });
    expect(await journalCount(dep.id)).toBe(1);
    const keys = new Set(psp.captures.filter((c) => c.ref === dep.providerRef).map((c) => c.key));
    expect([...keys]).toEqual([`deposit-capture:${dep.id}`]);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });
});
