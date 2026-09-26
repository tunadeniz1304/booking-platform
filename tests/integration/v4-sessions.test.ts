import { afterAll, expect, it } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as listSessions, DELETE as revokeSessions } from "@/app/api/account/sessions/route";
import { hashPassword, signAccessToken } from "@/lib/auth";
import { REFRESH_COOKIE } from "@/lib/auth/cookies";
import { rotateRefreshToken } from "@/lib/auth/session";
import { DEVICE_COOKIE } from "@/lib/risk/device-cookie";
import { securityAlertEmail } from "@/lib/notifications/security-notifications";

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

/**
 * P0-4: oturum listesi + uzaktan çıkış + yeni cihaz bildirimi. Çalınmış oturum senaryosu:
 * saldırgan eski `auth_time`'lı oturumla kurbanı dışarı atamaz (REAUTH_REQUIRED); kurban taze
 * doğrulamayla saldırganın oturumunu kapatınca erişim ve yenileme token'ları anında düşer.
 */
describeInt("P0-4 oturum listesi, uzaktan çıkış ve yeni cihaz bildirimi", () => {
  const prisma = new PrismaClient();
  const password = "Password123!";
  const email = `p04-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.test`;

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function doLogin(ua: string, deviceCookie?: string) {
    const res = (await (login as unknown as Handler)(
      new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": ua,
          ...(deviceCookie ? { cookie: `${DEVICE_COOKIE}=${deviceCookie}` } : {}),
        },
        body: JSON.stringify({ email, password }),
      })
    )) as NextResponse;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string };
    return {
      accessToken: body.accessToken,
      refresh: res.cookies.get(REFRESH_COOKIE)?.value as string,
      device: res.cookies.get(DEVICE_COOKIE)?.value,
    };
  }

  const call = (method: string, token: string, query = "") =>
    new NextRequest(`http://localhost:3000/api/account/sessions${query}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
  const alerts = (userId: string) =>
    prisma.outboxMessage.findMany({
      where: {
        eventType: "auth.security_alert",
        payload: { path: ["userId"], equals: userId },
      },
    });

  it("regression: v4#2 P0-4 yeni cihaz e-postası, oturum listesi ve çalınmış oturumun uzaktan kapatılması", async () => {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        firstName: "Oturum",
        lastName: "Test",
        emailVerifiedAt: new Date(),
      },
    });

    // 1) İlk giriş: önceki oturum yok → bildirim yok; cihaz çerezi basılır.
    const victim = await doLogin(CHROME_WIN);
    expect(victim.device).toBeTruthy();
    expect(await alerts(user.id)).toHaveLength(0);

    // 2) Aynı cihazdan tekrar giriş → bilinen cihaz, bildirim yok.
    const victim2 = await doLogin(CHROME_WIN, victim.device);
    expect(victim2.device).toBeUndefined();
    expect(await alerts(user.id)).toHaveLength(0);

    // 3) Saldırgan başka cihazdan girer → NEW_DEVICE_LOGIN outbox olayı.
    const attacker = await doLogin(FIREFOX_LINUX);
    const sent = await alerts(user.id);
    expect(sent).toHaveLength(1);
    const payload = sent[0].payload as { kind: string; detail: string | null; to: string };
    expect(payload.kind).toBe("NEW_DEVICE_LOGIN");
    expect(payload.to).toBe(email);
    expect(payload.detail).toContain("Firefox · Linux");
    const mail = securityAlertEmail(
      {
        name: "Oturum",
        detail: payload.detail,
        occurredAt: new Date().toISOString(),
        kind: "NEW_DEVICE_LOGIN",
      },
      "en"
    );
    expect(mail.subject).toMatch(/new device/i);

    // 4) Liste: 3 oturum, istek yapanınki `current`.
    const listRes = await (listSessions as unknown as Handler)(call("GET", victim.accessToken));
    expect(listRes.status).toBe(200);
    const { sessions } = (await listRes.json()) as {
      sessions: { id: string; current: boolean; device: string | null }[];
    };
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    const rows = await prisma.userSession.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    const [victimSid, , attackerSid] = rows.map((r) => r.id);
    expect(sessions.find((s) => s.current)?.id).toBe(victimSid);

    // 5) Çalınmış oturum (eski auth_time) kurbanı dışarı atamaz: REAUTH_REQUIRED.
    const stale = (
      await signAccessToken(
        user.id,
        "USER",
        300,
        0,
        Math.floor(Date.now() / 1000) - 3600,
        attackerSid
      )
    ).token;
    const denied = await (revokeSessions as unknown as Handler)(
      call("DELETE", stale, `?id=${victimSid}`)
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("REAUTH_REQUIRED");

    // 6) Kurban (taze giriş) saldırganın oturumunu kapatır.
    const ok = await (revokeSessions as unknown as Handler)(
      call("DELETE", victim.accessToken, `?id=${attackerSid}`)
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ revoked: 1, current: false });

    // Saldırganın erişim token'ı (sid) ve yenileme token'ı anında geçersiz.
    expect(
      (await (listSessions as unknown as Handler)(call("GET", attacker.accessToken))).status
    ).toBe(401);
    await expect(rotateRefreshToken(attacker.refresh)).rejects.toMatchObject({ status: 401 });
    // Kurbanın oturumu etkilenmez.
    await expect(rotateRefreshToken(victim.refresh)).resolves.toMatchObject({
      user: { id: user.id },
    });
    expect(
      await prisma.auditLog.count({
        where: { action: "auth.session_revoked", entityId: attackerSid },
      })
    ).toBe(1);

    // 7) Başka kullanıcının / kapatılmış oturumun kimliği → 404.
    const again = await (revokeSessions as unknown as Handler)(
      call("DELETE", victim.accessToken, `?id=${attackerSid}`)
    );
    expect(again.status).toBe(404);

    // 8) "Diğerlerini kapat": mevcut dışındaki tek etkin oturum (victim2) kapanır.
    const others = await (revokeSessions as unknown as Handler)(
      call("DELETE", victim.accessToken, "?scope=others")
    );
    expect(await others.json()).toEqual({ revoked: 1 });
    expect(
      (await (listSessions as unknown as Handler)(call("GET", victim2.accessToken))).status
    ).toBe(401);
    const left = (await (
      await (listSessions as unknown as Handler)(call("GET", victim.accessToken))
    ).json()) as { sessions: { id: string }[] };
    expect(left.sessions.map((s) => s.id)).toEqual([victimSid]);
  });
});
