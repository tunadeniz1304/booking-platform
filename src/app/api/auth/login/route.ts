import { enforceDegradedAuth, isAuthDegraded } from "@/lib/security/auth-degraded";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPasswordConstantTime } from "@/lib/auth";
import { applyDeviceCookie, startSession } from "@/lib/auth/user-sessions";
import { setSessionCookies } from "@/lib/auth/cookies";
import {
  assertLoginAttemptAllowed,
  clearLoginFailures,
  padResponseTime,
  recordLoginFailure,
  recordSuccessfulLogin,
} from "@/lib/auth/account";
import { UnauthorizedError, toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";

const loginSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta girin").max(254),
  password: z.string().min(1, "Parola boş olamaz").max(200),
  /** Şüpheli denemelerde istenen iş kanıtı çözümü (v4#12; form otomatik çözer). */
  pow: z.object({ challenge: z.string().max(200), nonce: z.string().max(32) }).nullish(),
});

/**
 * Parola ile giriş (v4#12): hesap kilitlenmez; (istemci, e-posta) başına kademeli
 * gecikme + eşikten sonra iş kanıtı. Yanıt süresi `AUTH_MIN_RESPONSE_MS`'e sabitlenir.
 */
export const POST = observed("auth.login", async function postHandler(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const { email, password, pow } = loginSchema.parse(await req.json());
    const config = getConfig();
    const client = clientKey(req.headers, {
      trustedProxyHops: config.TRUSTED_PROXY_HOPS,
      trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
    });
    // v5#6: paylaşılan anonim kova tükendiyse e-posta kovası + PoW (proxy işareti).
    const degraded = isAuthDegraded(req);
    await enforceDegradedAuth(req, { email, pow });
    // Gecikme / PoW / e-posta başına limit (IP'den bağımsız, v3#3) — parola kontrolünden önce.
    await assertLoginAttemptAllowed({ email, client, pow, powVerified: degraded });

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        passwordHash: true,
        tokenVersion: true,
        deletedAt: true,
        emailVerifiedAt: true,
      },
    });

    // Kullanıcı yoksa da bcrypt karşılaştırması yapılır (zamanlama e-posta varlığını ele vermez).
    const valid = await verifyPasswordConstantTime(password, user?.passwordHash);
    if (!user || user.deletedAt || !valid) {
      // Var olan / olmayan e-posta aynı sayaçları artırır (hesap keşfi yok).
      await recordLoginFailure({ email, client });
      throw new UnauthorizedError("E-posta veya parola hatalı");
    }
    await clearLoginFailures(email, client);
    const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
    await recordSuccessfulLogin(user.id, cookieLocale ? resolveLocale(cookieLocale) : undefined);

    // Yeni cihazdan giriş → güvenlik e-postası (P0-4).
    const started = await startSession(req, user, { alertNewDevice: true });
    const session = started.session;
    const response = NextResponse.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        emailVerified: Boolean(user.emailVerifiedAt),
      },
      // Tarayıcı dışı istemciler için (Bearer). Tarayıcı çerezi kullanır, bunu saklamaz.
      accessToken: session.accessToken,
      accessExpiresAt: session.accessExpiresAt.toISOString(),
    });
    setSessionCookies(response, session);
    applyDeviceCookie(response, started);
    await padResponseTime(startedAt);
    return response;
  } catch (error) {
    await padResponseTime(startedAt);
    return toErrorResponse(error, "auth.login");
  }
});

export const dynamic = "force-dynamic";
