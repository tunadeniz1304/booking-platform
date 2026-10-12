import { createHash } from "crypto";
import { AuthTokenKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Sıfırlama bağlantısını TÜKETMEDEN denetler (account.ts `consumeToken` ile aynı özet):
 * kullanılmamış ve süresi dolmamışsa hesabın e-postası (parola yöneticisinin `username`
 * alanı için), değilse null. Belirteci bilen zaten şifreyi değiştirebildiğinden e-postayı
 * göstermek ek yetki vermez.
 */
export async function previewPasswordResetToken(
  raw: string,
  now = new Date()
): Promise<{ email: string } | null> {
  const row = await prisma.authToken.findUnique({
    where: { tokenHash: createHash("sha256").update(raw).digest("hex") },
    select: { kind: true, usedAt: true, expiresAt: true, user: { select: { email: true } } },
  });
  if (!row || row.kind !== AuthTokenKind.PASSWORD_RESET || row.usedAt || row.expiresAt <= now) {
    return null;
  }
  return { email: row.user.email };
}
