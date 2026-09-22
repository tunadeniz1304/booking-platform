import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
})();

interface JwtClaims {
  userId: string;
  role: string;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(userId: string, role: string): string {
  return jwt.sign({ userId, role } satisfies JwtClaims, JWT_SECRET, {
    expiresIn: "7d",
    subject: userId,
  });
}

interface VerifiedClaims extends JwtClaims {
  sub?: string;
}

function verifyJwt(token: string): VerifiedClaims | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as VerifiedClaims;
    return payload;
  } catch {
    return null;
  }
}

/**
 * İsteği doğrula: Bearer başlığı veya `token` çerezi.
 * Geçersizse null döner (route kendi 401'ini üretir).
 */
export function getUserFromRequest(
  req: NextRequest
): { userId: string; role: string } | null {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieToken = req.cookies.get("token")?.value ?? null;
  const token = bearer ?? cookieToken;

  if (!token) return null;

  const payload = verifyJwt(token);
  if (!payload) return null;

  const userId = payload.userId ?? payload.sub;
  if (!userId) return null;

  return { userId, role: payload.role ?? "USER" };
}

export function getUserIdFromRequest(req: NextRequest): string {
  const user = getUserFromRequest(req);
  if (!user?.userId) {
    throw new Error("Missing or invalid token");
  }
  return user.userId;
}

export function requireRole(
  req: NextRequest,
  roles: string[]
): { userId: string; role: string } {
  const user = getUserFromRequest(req);
  if (!user?.userId) {
    throw new Error("Missing or invalid token");
  }
  if (!roles.includes(user.role)) {
    throw new Error("Insufficient permissions");
  }
  return user;
}
