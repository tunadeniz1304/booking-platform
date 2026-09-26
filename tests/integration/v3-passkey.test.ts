import { afterAll, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { SoftAuthenticator } from "../helpers/soft-authenticator";
import { signAccessToken } from "@/lib/auth/tokens";
import { POST as regOptions } from "@/app/api/auth/passkey/register/options/route";
import { POST as regVerify } from "@/app/api/auth/passkey/register/verify/route";
import { POST as loginOptions } from "@/app/api/auth/passkey/login/options/route";
import { POST as loginVerify } from "@/app/api/auth/passkey/login/verify/route";
import { GET as listKeys, DELETE as deleteKey } from "@/app/api/account/passkeys/route";

function req(path: string, method: string, body?: unknown, token?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describeInt("P0-8 passkey (WebAuthn) kayıt ve giriş (integration)", () => {
  const prisma = new PrismaClient();
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("kayıt → giriş → oturum çerezi; sayaç artar; tekrar oynatma ve yabancı anahtar reddedilir", async () => {
    const user = await prisma.user.create({
      data: {
        email: `pk-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "Pass",
        lastName: "Key",
      },
    });
    // Yeni giriş yapmış oturum (auth_time = şimdi): passkey ekleme/silme recent-auth ister (v4#2).
    const { token } = await signAccessToken(user.id, "USER", 300, 0, Math.floor(Date.now() / 1000));
    const auth = new SoftAuthenticator();

    // Kayıt
    const optRes = await regOptions(
      req("/api/auth/passkey/register/options", "POST", {}, token),
      undefined
    );
    expect(optRes.status).toBe(200);
    const options = (await optRes.json()) as { challenge: string; rp: { id: string } };
    expect(options.rp.id).toBe("localhost");
    const verifyRes = await regVerify(
      req(
        "/api/auth/passkey/register/verify",
        "POST",
        { response: auth.register(options), name: "Dizüstü" },
        token
      ),
      undefined
    );
    expect(verifyRes.status).toBe(201);
    // Aynı challenge ikinci kez kullanılamaz.
    const again = await regVerify(
      req("/api/auth/passkey/register/verify", "POST", { response: auth.register(options) }, token),
      undefined
    );
    expect(again.status).toBe(400);

    const list = await (
      await listKeys(req("/api/account/passkeys", "GET", undefined, token), undefined)
    ).json();
    expect(list.passkeys).toEqual([expect.objectContaining({ id: auth.id, name: "Dizüstü" })]);

    // Giriş (kullanıcı adı yok — discoverable credential)
    const lo = (await (
      await loginOptions(req("/api/auth/passkey/login/options", "POST", {}), undefined)
    ).json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const assertion = auth.authenticate(lo.options, user.id);
    const login = await loginVerify(
      req("/api/auth/passkey/login/verify", "POST", {
        challengeId: lo.challengeId,
        response: assertion,
      }),
      undefined
    );
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("token=");
    expect((await login.json()).user.id).toBe(user.id);
    const stored = await prisma.webAuthnCredential.findUniqueOrThrow({ where: { id: auth.id } });
    expect(stored.counter).toBe(1);
    expect(stored.lastUsedAt).not.toBeNull();

    // Aynı assertion yeniden oynatılırsa: challenge tüketilmiş → reddedilir.
    const replay = await loginVerify(
      req("/api/auth/passkey/login/verify", "POST", {
        challengeId: lo.challengeId,
        response: assertion,
      }),
      undefined
    );
    expect(replay.status).toBe(400);

    // Kayıtsız anahtar → 401.
    const stranger = new SoftAuthenticator();
    const lo2 = (await (
      await loginOptions(req("/api/auth/passkey/login/options", "POST", {}), undefined)
    ).json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const foreign = await loginVerify(
      req("/api/auth/passkey/login/verify", "POST", {
        challengeId: lo2.challengeId,
        response: stranger.authenticate(lo2.options, user.id),
      }),
      undefined
    );
    expect(foreign.status).toBe(401);

    // Kilitli hesap passkey ile de giremez.
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() + 60_000) },
    });
    const lo3 = (await (
      await loginOptions(req("/api/auth/passkey/login/options", "POST", {}), undefined)
    ).json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const locked = await loginVerify(
      req("/api/auth/passkey/login/verify", "POST", {
        challengeId: lo3.challengeId,
        response: auth.authenticate(lo3.options, user.id),
      }),
      undefined
    );
    expect(locked.status).toBe(401);

    // Silme: başkasının passkey'i 404, kendi passkey'i silinir.
    const other = await signAccessToken(
      "baska-kullanici",
      "USER",
      300,
      0,
      Math.floor(Date.now() / 1000)
    );
    expect(
      (
        await deleteKey(
          req(`/api/account/passkeys?id=${auth.id}`, "DELETE", undefined, other.token),
          undefined
        )
      ).status
    ).toBe(404);
    expect(
      (
        await deleteKey(
          req(`/api/account/passkeys?id=${auth.id}`, "DELETE", undefined, token),
          undefined
        )
      ).status
    ).toBe(200);
    expect(await prisma.webAuthnCredential.count({ where: { userId: user.id } })).toBe(0);
  });
});
