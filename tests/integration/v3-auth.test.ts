import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { awayFromWindowEdge, describeInt } from "./helpers";
import { createStayFixture } from "./fixtures";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as verifyEmailRoute } from "@/app/api/auth/verify-email/route";
import { POST as forgot } from "@/app/api/auth/password/forgot/route";
import { POST as reset } from "@/app/api/auth/password/reset/route";
import { PATCH as changeRole } from "@/app/api/admin/users/[id]/role/route";
import { hashPassword } from "@/lib/auth";
import { issueSession, rotateRefreshToken } from "@/lib/auth/session";
import { signAccessToken } from "@/lib/auth/tokens";
import { getAuth } from "@/lib/auth";
import { deleteAccount } from "@/lib/privacy/privacy-service";
import { payForBooking } from "@/lib/payment/payment-service";
import { redis } from "@/lib/redis";
import { getConfig, resetConfigForTests } from "@/lib/config/app-config";
import { openLink } from "@/lib/auth/link-crypto";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Outbox'taki son kimlik e-postası isteğinin ham token'ı (dev mailbox bağlantısıyla aynı).
 * v4#12: payload'da ham token yok; şifreli bağlantı çözülür.
 */
async function lastAuthToken(prisma: PrismaClient, userId: string, kind: string) {
  const msg = await prisma.outboxMessage.findFirst({
    where: { eventType: "auth.email_requested", payload: { path: ["userId"], equals: userId } },
    orderBy: { createdAt: "desc" },
  });
  const payload = msg?.payload as { kind: string; sealedLink: string } | undefined;
  expect(payload?.kind).toBe(kind);
  return new URL(openLink(payload!.sealedLink), "http://x").searchParams.get("token")!;
}

describeInt("v3 auth sertleştirme (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();

  beforeAll(() => {
    process.env.AUTH_LOCKOUT_THRESHOLD = "3";
    process.env.RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX = "50";
    resetConfigForTests();
  });
  beforeEach(() => resetConfigForTests());
  afterAll(async () => {
    delete process.env.AUTH_LOCKOUT_THRESHOLD;
    delete process.env.RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX;
    resetConfigForTests();
    await prisma.$disconnect();
  });

  async function makeUser(tag: string, password = "Password123!") {
    return prisma.user.create({
      data: {
        email: `${tag}-${stamp}@t.test`,
        passwordHash: await hashPassword(password),
        firstName: "Deniz",
        lastName: "Test",
      },
    });
  }

  // v3#14 (hesap kilidi) v4#12 ile değişti: hesap kilitlenmez; kademeli gecikme + PoW
  // (tests/integration/v4-login-hardening.test.ts).

  it("regression: v3#3 hesap bazlı giriş limiti IP'den bağımsız", async () => {
    process.env.RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX = "2";
    process.env.AUTH_LOCKOUT_THRESHOLD = "100";
    resetConfigForTests();
    const user = await makeUser("acct");
    // Hesap limiti sabit pencereli kova kullanır: 3 deneme pencere sınırını kesmesin.
    await awayFromWindowEdge(getConfig().RATE_LIMIT_WINDOW_SECONDS);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await login(
        post(
          "/api/auth/login",
          { email: user.email, password: "yanlis" },
          { "user-agent": `bot-${i}`, "x-forwarded-for": `10.0.0.${i}` }
        ),
        undefined
      );
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 429]);
    process.env.RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX = "50";
    process.env.AUTH_LOCKOUT_THRESHOLD = "3";
  });

  it("e-posta doğrulama: kayıt → outbox bağlantısı → doğrulandı; token tek kullanımlık", async () => {
    const email = `reg-${stamp}@t.test`;
    const res = await register(
      post("/api/auth/register", {
        firstName: "Yeni",
        lastName: "Üye",
        email,
        password: "Parola123",
      }),
      undefined
    );
    expect(res.status).toBe(201);
    expect((await res.json()).user.emailVerified).toBe(false);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = await lastAuthToken(prisma, user.id, "EMAIL_VERIFY");
    const stored = await prisma.authToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toContain(token); // yalnızca özet saklanır

    expect(
      (await verifyEmailRoute(post("/api/auth/verify-email", { token }), undefined)).status
    ).toBe(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt
    ).not.toBeNull();
    expect(
      (await verifyEmailRoute(post("/api/auth/verify-email", { token }), undefined)).status
    ).toBe(400);
  });

  it("şifre sıfırlama: her durumda 202; sıfırlama tüm oturumları kapatır", async () => {
    const unknown = await forgot(
      post("/api/auth/password/forgot", { email: `yok-${stamp}@t.test` }),
      undefined
    );
    expect(unknown.status).toBe(202);

    const user = await makeUser("reset");
    const otherDevice = await issueSession({ id: user.id, role: "USER" });
    expect(
      (await forgot(post("/api/auth/password/forgot", { email: user.email }), undefined)).status
    ).toBe(202);
    const token = await lastAuthToken(prisma, user.id, "PASSWORD_RESET");

    const res = await reset(
      post("/api/auth/password/reset", { token, password: "YeniParola9" }),
      undefined
    );
    expect(res.status).toBe(200);
    await expect(rotateRefreshToken(otherDevice.refreshToken)).rejects.toMatchObject({
      status: 401,
    });
    const oldAccess = new NextRequest("http://localhost:3000/api/x", {
      headers: { authorization: `Bearer ${otherDevice.accessToken}` },
    });
    expect(await getAuth(oldAccess)).toBeNull();
    const ok = await login(
      post("/api/auth/login", { email: user.email, password: "YeniParola9" }),
      undefined
    );
    expect(ok.status).toBe(200);
    // Aynı bağlantı ikinci kez kullanılamaz.
    expect(
      (await reset(post("/api/auth/password/reset", { token, password: "Baska1234" }), undefined))
        .status
    ).toBe(400);
  });

  it("regression: v3#5 hesap silme: aktif rezervasyon politikaya göre iptal, tüm cihazlar çıkış", async () => {
    const fx = await createStayFixture(prisma, { tag: "del" });
    const b = await fx.hold({ startInDays: 30 });
    await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "del",
    });
    const laptop = await issueSession({ id: fx.userId, role: "USER" });
    const phone = await issueSession({ id: fx.userId, role: "USER" });

    const result = await deleteAccount(fx.userId);
    expect(result.cancelledBookings).toEqual([b.id]);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: b.id },
      include: { payment: true },
    });
    expect(booking.status).toBe("CANCELLED");
    expect(booking.payment?.status).toBe("REFUNDED"); // MODERATE, 30 gün kala → %100
    for (const s of [laptop, phone]) {
      await expect(rotateRefreshToken(s.refreshToken)).rejects.toMatchObject({ status: 401 });
      const r = new NextRequest("http://localhost:3000/api/x", {
        headers: { authorization: `Bearer ${s.accessToken}` },
      });
      expect(await getAuth(r)).toBeNull();
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fx.userId } });
    expect(user.deletedAt).not.toBeNull();
    expect(user.tokenVersion).toBe(1);
    expect(await redis.get(`auth:tv:${fx.userId}`)).toBe("1");
  });

  it("regression: v3#5 admin rol değişimi eski token'ı anında geçersiz kılar", async () => {
    const admin = await prisma.user.create({
      data: {
        email: `admin-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "A",
        lastName: "D",
        role: "ADMIN",
      },
    });
    const target = await makeUser("promote");
    const targetSession = await issueSession({ id: target.id, role: "HOST" });
    const { token } = await signAccessToken(admin.id, "ADMIN", 300);
    const res = await changeRole(
      new NextRequest(`http://localhost:3000/api/admin/users/${target.id}/role`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ role: "USER" }),
      }),
      { params: Promise.resolve({ id: target.id }) }
    );
    expect(res.status).toBe(200);
    const stale = new NextRequest("http://localhost:3000/api/x", {
      headers: { authorization: `Bearer ${targetSession.accessToken}` },
    });
    expect(await getAuth(stale)).toBeNull();
    await expect(rotateRefreshToken(targetSession.refreshToken)).rejects.toMatchObject({
      status: 401,
    });
  });
});
