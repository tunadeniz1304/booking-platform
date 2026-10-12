import type { NextResponse } from "next/server";
import type { SessionTokens } from "./session";

export const ACCESS_COOKIE = "token";
export const REFRESH_COOKIE = "refresh_token";
/**
 * JS'in okuyabildiği oturum ipucu: yalnızca yenileme çerezinin var olduğunu söyler, sır
 * taşımaz. İstemci oturum yokken /api/user/me ve /api/auth/refresh denemesini atlayabilir.
 */
export const SESSION_HINT_COOKIE = "has_session";
/** Yenileme çerezi yalnızca auth uçlarına gider (diğer isteklerde taşınmaz). */
const REFRESH_PATH = "/api/auth";

function secure(): boolean {
  return process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";
}

/**
 * Oturum çerezleri: httpOnly (JS erişemez), SameSite=Lax, production'da Secure. Yalnızca sır
 * taşımayan `SESSION_HINT_COOKIE` JS'e açıktır.
 */
export function setSessionCookies(res: NextResponse, session: SessionTokens): void {
  const now = Date.now();
  const refreshMaxAge = Math.max(1, Math.floor((session.refreshExpiresAt.getTime() - now) / 1000));
  res.cookies.set(ACCESS_COOKIE, session.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: secure(),
    path: "/",
    maxAge: Math.max(1, Math.floor((session.accessExpiresAt.getTime() - now) / 1000)),
  });
  res.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: secure(),
    path: REFRESH_PATH,
    maxAge: refreshMaxAge,
  });
  res.cookies.set(SESSION_HINT_COOKIE, "1", {
    httpOnly: false,
    sameSite: "lax",
    secure: secure(),
    path: "/",
    maxAge: refreshMaxAge,
  });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secure(),
    path: "/",
    maxAge: 0,
  });
  res.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secure(),
    path: REFRESH_PATH,
    maxAge: 0,
  });
  res.cookies.set(SESSION_HINT_COOKIE, "", {
    httpOnly: false,
    sameSite: "lax",
    secure: secure(),
    path: "/",
    maxAge: 0,
  });
}
