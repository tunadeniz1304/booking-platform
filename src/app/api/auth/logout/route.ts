import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { revokeSession } from "@/lib/auth/session";
import { REFRESH_COOKIE, clearSessionCookies } from "@/lib/auth/cookies";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * Çıkış — yalnızca POST (GET ile CSRF'lenemez; Origin kontrolü proxy'de).
 * Yenileme ailesi ve mevcut erişim token'ı iptal edilir, çerezler silinir.
 */
export async function POST(req: NextRequest) {
  const claims = await getAuth(req);
  try {
    await revokeSession({
      refreshToken: req.cookies.get(REFRESH_COOKIE)?.value ?? null,
      access: claims ? { jti: claims.jti, exp: claims.exp } : null,
    });
  } catch (error) {
    // İptal kaydı yazılamasa bile çerezler temizlenir; erişim token'ı kısa ömürlü.
    logger.warn(errorFields(error), "logout revoke failed");
  }
  const response = NextResponse.json({ success: true });
  clearSessionCookies(response);
  return response;
}

export const dynamic = "force-dynamic";
