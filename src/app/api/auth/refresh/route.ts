import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rotateRefreshToken } from "@/lib/auth/session";
import { REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from "@/lib/auth/cookies";
import { UnauthorizedError, toErrorResponse } from "@/lib/http/errors";

const bodySchema = z.object({ refreshToken: z.string().min(10).max(200) }).partial();

/**
 * Yenileme token'ı rotasyonu. Tarayıcı httpOnly çerezi (path=/api/auth) kullanır;
 * tarayıcı dışı istemciler gövdede `refreshToken` gönderebilir.
 */
export async function POST(req: NextRequest) {
  try {
    let raw = req.cookies.get(REFRESH_COOKIE)?.value ?? null;
    if (!raw && req.headers.get("content-type")?.includes("application/json")) {
      raw = bodySchema.parse(await req.json().catch(() => ({}))).refreshToken ?? null;
    }
    if (!raw) throw new UnauthorizedError("Oturum bulunamadı");

    const session = await rotateRefreshToken(raw);
    const response = NextResponse.json({
      user: session.user,
      accessToken: session.accessToken,
      accessExpiresAt: session.accessExpiresAt.toISOString(),
    });
    setSessionCookies(response, session);
    return response;
  } catch (error) {
    const response = toErrorResponse(error, "auth.refresh");
    if (response.status === 401) clearSessionCookies(response);
    return response;
  }
}

export const dynamic = "force-dynamic";
