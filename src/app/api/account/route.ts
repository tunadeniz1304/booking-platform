import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { toErrorResponse } from "@/lib/http/errors";
import { deleteAccount, exportUserData } from "@/lib/privacy/privacy-service";
import { revokeSession } from "@/lib/auth/session";
import { REFRESH_COOKIE, clearSessionCookies } from "@/lib/auth/cookies";

/** "Verilerimi indir" (KVKK md. 11) — JSON ek dosya. */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return new NextResponse(JSON.stringify(await exportUserData(userId), null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": "attachment; filename=verilerim.json",
      },
    });
  } catch (error) {
    return toErrorResponse(error, "account.export");
  }
}

/**
 * "Hesabımı sil": aktif rezervasyonlar politikaya göre iptal, anonimleştirme ve TÜM
 * oturumların iptali (tokenVersion — diğer cihazlar dahil, v3#5).
 */
export async function DELETE(req: NextRequest) {
  try {
    // v4#2: hesap silme yalnızca yakın zamanda yeniden doğrulanmış oturumla.
    const claims = await requireRecentAuth(req);
    const result = await deleteAccount(claims.userId);
    await revokeSession({
      refreshToken: req.cookies.get(REFRESH_COOKIE)?.value,
      access: { jti: claims.jti, exp: claims.exp },
    });
    const res = NextResponse.json({ deleted: true, ...result });
    clearSessionCookies(res);
    return res;
  } catch (error) {
    return toErrorResponse(error, "account.delete");
  }
}

export const dynamic = "force-dynamic";
