import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { listUserSessions, revokeOtherSessions, revokeUserSession } from "@/lib/auth/user-sessions";
import { ValidationError, toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

/** Kullanıcının etkin oturumları (P0-4); `current` bu isteğin oturumudur. */
export const GET = observed("account.sessions.list", async function getHandler(req: NextRequest) {
  try {
    const { userId, sessionId } = await requireAuth(req);
    return NextResponse.json({ sessions: await listUserSessions(userId, sessionId) });
  } catch (error) {
    return toErrorResponse(error, "account.sessions.list");
  }
});

/**
 * Uzaktan çıkış: `?id=<oturum>` tek oturumu, `?scope=others` mevcut dışındaki tümünü kapatır.
 * Hassas işlem → yakın zamanda yeniden doğrulama (çalınmış oturum sahibini dışarı atamaz).
 */
export const DELETE = observed(
  "account.sessions.revoke",
  async function deleteHandler(req: NextRequest) {
    try {
      const { userId, sessionId } = await requireRecentAuth(req);
      const params = req.nextUrl.searchParams;
      if (params.get("scope") === "others") {
        return NextResponse.json({ revoked: await revokeOtherSessions(userId, sessionId) });
      }
      const id = params.get("id");
      if (!id || id.length > 64) throw new ValidationError("Oturum kimliği gerekli");
      await revokeUserSession(userId, id);
      return NextResponse.json({ revoked: 1, current: id === sessionId });
    } catch (error) {
      return toErrorResponse(error, "account.sessions.revoke");
    }
  }
);

export const dynamic = "force-dynamic";
