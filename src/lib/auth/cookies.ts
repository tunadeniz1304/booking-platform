import type { NextResponse } from "next/server";
import type { SessionTokens } from "./session";

export const ACCESS_COOKIE = "token";
export const REFRESH_COOKIE = "refresh_token";
/** Yenileme çerezi yalnızca auth uçlarına gider (diğer isteklerde taşınmaz). */
const REFRESH_PATH = "/api/auth";

function secure(): boolean {
  return process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";
}

/** Oturum çerezleri: httpOnly (JS erişemez), SameSite=Lax, production'da Secure. */
export function setSessionCookies(res: NextResponse, session: SessionTokens): void {
  const now = Date.now();
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
    maxAge: Math.max(1, Math.floor((session.refreshExpiresAt.getTime() - now) / 1000)),
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
}
