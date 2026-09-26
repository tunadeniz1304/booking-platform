import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { SoftAuthenticator } from "../helpers/soft-authenticator";
import { hashPassword } from "@/lib/auth/password";
import { issueSession, rotateRefreshToken } from "@/lib/auth/session";
import { verifyAccessToken } from "@/lib/auth/tokens";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { EventTypes, type SecurityAlertPayload } from "@/lib/events/events";
import { notifySecurityAlert } from "@/lib/notifications/security-notifications";
import { payForBooking } from "@/lib/payment/payment-service";
import { POST as regOptions } from "@/app/api/auth/passkey/register/options/route";
import { POST as regVerify } from "@/app/api/auth/passkey/register/verify/route";
import { DELETE as deleteKey } from "@/app/api/account/passkeys/route";
import { DELETE as accountDelete } from "@/app/api/account/route";
import { POST as reauthPost } from "@/app/api/auth/reauth/route";
import { POST as reauthOptionsPost } from "@/app/api/auth/reauth/options/route";
import { POST as stepUpOptionsPost } from "@/app/api/auth/step-up/options/route";
import { POST as stepUpVerifyPost } from "@/app/api/auth/step-up/verify/route";

// Kural motoru bu dosyada her ödemeyi "step_up_passkey" bulur (kapı davranışı test edilir).
vi.mock("@/lib/risk/fraud", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/risk/fraud")>();
  return {
    ...mod,
    assessPayment: vi.fn(async () => ({ score: 50, decision: "step_up_passkey", hits: [] })),
  };
});

const CORRECT_PW = "Dogru-Parola-2026!";

function req(
  path: string,
  method: string,
  opts: { token?: string; body?: unknown; cookie?: string } = {}
) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

describeInt("regression: v4#2 çalınan oturum hassas işlemleri ve step-up'ı aşamaz", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let userId = "";
  const hourAgo = () => Math.floor(Date.now() / 1000) - 3600;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v4-2", days: 90 });
    userId = fx.userId;
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(CORRECT_PW) },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("regression: v4#2 çalınan oturum: passkey ekleme/silme ve hesap silme 403 REAUTH_REQUIRED; refresh auth_time'ı tazelemez; parola kaba kuvveti sınırlı", async () => {
    // Saldırgan kurbanın 1 saatlik oturumunun çerezlerini (erişim + yenileme) çaldı.
    const stolen = await issueSession({ id: userId, role: "USER" }, { authTime: hourAgo() });

    const reg = await regOptions(
      req("/api/auth/passkey/register/options", "POST", { token: stolen.accessToken, body: {} }),
      undefined
    );
    expect(reg.status).toBe(403);
    expect((await reg.json()).code).toBe("REAUTH_REQUIRED");
    expect(
      (
        await deleteKey(
          req("/api/account/passkeys?id=x", "DELETE", { token: stolen.accessToken }),
          undefined
        )
      ).status
    ).toBe(403);
    expect(
      (await accountDelete(req("/api/account", "DELETE", { token: stolen.accessToken }))).status
    ).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).deletedAt).toBeNull();

    // Yenileme yeni erişim token'ı verir ama auth_time aynı kalır → hâlâ 403.
    const rotated = await rotateRefreshToken(stolen.refreshToken);
    const claims = await verifyAccessToken(rotated.accessToken);
    expect(claims?.authTime).toBe((await verifyAccessToken(stolen.accessToken))?.authTime);
    expect(
      (
        await regOptions(
          req("/api/auth/passkey/register/options", "POST", {
            token: rotated.accessToken,
            body: {},
          }),
          undefined
        )
      ).status
    ).toBe(403);

    // Parolayı bilmeyen saldırgan: hatalı denemeler sınırlı, sonra doğru parola bile 429.
    const max = getConfig().REAUTH_MAX_ATTEMPTS;
    for (let i = 0; i < max; i++) {
      const bad = await reauthPost(
        req("/api/auth/reauth", "POST", {
          token: rotated.accessToken,
          body: { method: "password", password: `yanlis-${i}` },
        }),
        undefined
      );
      expect(bad.status).toBe(401);
    }
    const limited = await reauthPost(
      req("/api/auth/reauth", "POST", {
        token: rotated.accessToken,
        body: { method: "password", password: CORRECT_PW },
      }),
      undefined
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe("REAUTH_RATE_LIMITED");
    await redis.del(`reauth:fail:${userId}`);
  });

  it("regression: v4#2 meşru kullanıcı: yeniden doğrulama → passkey kaydı + e-posta; yeni passkey 24 saat step-up yapamaz", async () => {
    const old = await issueSession({ id: userId, role: "USER" }, { authTime: hourAgo() });
    const reauth = await reauthPost(
      req("/api/auth/reauth", "POST", {
        token: old.accessToken,
        cookie: `refresh_token=${old.refreshToken}`,
        body: { method: "password", password: CORRECT_PW },
      }),
      undefined
    );
    expect(reauth.status).toBe(200);
    expect(reauth.headers.get("set-cookie")).toContain("token=");
    const fresh = (await reauth.json()) as { accessToken: string };
    // Eski yenileme ailesi iptal edildi.
    await expect(rotateRefreshToken(old.refreshToken)).rejects.toThrow();

    const auth = new SoftAuthenticator();
    const optRes = await regOptions(
      req("/api/auth/passkey/register/options", "POST", { token: fresh.accessToken, body: {} }),
      undefined
    );
    expect(optRes.status).toBe(200);
    const verifyRes = await regVerify(
      req("/api/auth/passkey/register/verify", "POST", {
        token: fresh.accessToken,
        body: { response: auth.register(await optRes.json()), name: "Yeni Telefon" },
      }),
      undefined
    );
    expect(verifyRes.status).toBe(201);

    // Güvenlik e-postası outbox'ta (kayıtla aynı işlem) ve gönderilebilir.
    const msg = await prisma.outboxMessage.findFirstOrThrow({
      where: { eventType: EventTypes.SecurityAlert, aggregateId: userId },
      orderBy: { createdAt: "desc" },
    });
    const payload = msg.payload as unknown as SecurityAlertPayload;
    expect(payload).toMatchObject({ kind: "PASSKEY_ADDED", detail: "Yeni Telefon", userId });
    await notifySecurityAlert(payload);
    const mail = await prisma.notification.findUniqueOrThrow({
      where: { dedupeKey: `auth.security_alert:${payload.alertId}` },
    });
    expect(mail.subject).toContain("passkey");

    // Passkey ile yeniden doğrulama da çalışır (recent-auth yeniden kullanılabilir).
    const ro = await reauthOptionsPost(
      req("/api/auth/reauth/options", "POST", { token: fresh.accessToken, body: {} }),
      undefined
    );
    expect(ro.status).toBe(200);
    const viaPasskey = await reauthPost(
      req("/api/auth/reauth", "POST", {
        token: fresh.accessToken,
        body: { method: "passkey", response: auth.authenticate(await ro.json(), userId) },
      }),
      undefined
    );
    expect(viaPasskey.status).toBe(200);
    // Yeniden doğrulama önceki erişim token'ını iptal eder; yenisiyle devam.
    const current = ((await viaPasskey.json()) as { accessToken: string }).accessToken;
    expect(
      (
        await regOptions(
          req("/api/auth/passkey/register/options", "POST", {
            token: fresh.accessToken,
            body: {},
          }),
          undefined
        )
      ).status
    ).toBe(401);

    // Yeni passkey soğumada: step-up seçenekleri verilmez, ödeme kapısı 3DS'e düşer.
    const b = await fx.hold();
    const so = await stepUpOptionsPost(
      req("/api/auth/step-up/options", "POST", {
        token: current,
        body: { bookingId: b.id },
      }),
      undefined
    );
    expect(so.status).toBe(400);
    const out = await payForBooking({
      bookingId: b.id,
      userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "v4-2-cooldown",
    });
    expect(out.status).toBe("requires_action");
  });

  it("regression: v4#2 step-up token'ı rezervasyon + tutara bağlı ve tek kullanımlık (GETDEL)", async () => {
    // Soğumayı doldurmuş passkey.
    const auth = new SoftAuthenticator();
    const { accessToken } = await issueSession({ id: userId, role: "USER" });
    const o = await regOptions(
      req("/api/auth/passkey/register/options", "POST", { token: accessToken, body: {} }),
      undefined
    );
    await regVerify(
      req("/api/auth/passkey/register/verify", "POST", {
        token: accessToken,
        body: { response: auth.register(await o.json()) },
      }),
      undefined
    );
    await prisma.webAuthnCredential.update({
      where: { id: auth.id },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });

    async function stepUp(bookingId: string): Promise<string> {
      const opts = await stepUpOptionsPost(
        req("/api/auth/step-up/options", "POST", { token: accessToken, body: { bookingId } }),
        undefined
      );
      expect(opts.status).toBe(200);
      const res = await stepUpVerifyPost(
        req("/api/auth/step-up/verify", "POST", {
          token: accessToken,
          body: { response: auth.authenticate(await opts.json(), userId) },
        }),
        undefined
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { stepUpToken: string; bookingId: string };
      expect(body.bookingId).toBe(bookingId);
      return body.stepUpToken;
    }
    const pay = (bookingId: string, stepUpToken: string | null, key: string) =>
      payForBooking({
        bookingId,
        userId,
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: key,
        stepUpToken,
      });

    const b1 = await fx.hold();
    const b2 = await fx.hold();
    // Token yok → passkey'i olan kullanıcıdan step-up istenir.
    await expect(pay(b1.id, null, "a0")).rejects.toMatchObject({
      status: 403,
      code: "STEP_UP_REQUIRED",
    });
    const t1 = await stepUp(b1.id);
    // Başka rezervasyon için kullanılamaz.
    await expect(pay(b2.id, t1, "a1")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    expect((await pay(b1.id, t1, "a2")).status).toBe("confirmed");

    // Tutar değişirse token yanar; aynı token ikinci kez de kullanılamaz.
    const t2 = await stepUp(b2.id);
    const original = await prisma.booking.findUniqueOrThrow({ where: { id: b2.id } });
    await prisma.booking.update({
      where: { id: b2.id },
      data: { totalPrice: original.totalPrice.plus(new Prisma.Decimal(1)) },
    });
    await expect(pay(b2.id, t2, "a3")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    await prisma.booking.update({
      where: { id: b2.id },
      data: { totalPrice: original.totalPrice },
    });
    await expect(pay(b2.id, t2, "a4")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    const t3 = await stepUp(b2.id);
    expect((await pay(b2.id, t3, "a5")).status).toBe("confirmed");
  });
});
