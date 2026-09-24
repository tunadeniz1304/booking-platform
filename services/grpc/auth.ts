import * as grpc from "@grpc/grpc-js";
import { verifyAccessToken, type AccessClaims } from "@/lib/auth/tokens";
import { isAccessTokenDenied } from "@/lib/auth/denylist";

/**
 * gRPC kimlik doğrulaması: `authorization: Bearer <JWT>` metadata'sı.
 *
 * - Token yok/geçersiz/iptal → UNAUTHENTICATED.
 * - İşlemi yapan kullanıcı YALNIZCA token'dan türetilir. İstek gövdesindeki
 *   `requester_id` (geriye dönük uyumluluk alanı) doluysa token'daki kullanıcıyla
 *   aynı olmak zorundadır; farklıysa PERMISSION_DENIED (başkası adına işlem yok).
 */

export class GrpcAuthError extends Error {
  constructor(
    readonly code: grpc.status,
    message: string
  ) {
    super(message);
    this.name = "GrpcAuthError";
  }
}

export async function authenticateMetadata(metadata: grpc.Metadata): Promise<AccessClaims> {
  const raw = metadata.get("authorization")[0];
  const header = typeof raw === "string" ? raw : raw?.toString("utf8");
  if (!header?.startsWith("Bearer ")) {
    throw new GrpcAuthError(grpc.status.UNAUTHENTICATED, "authorization metadata gerekli");
  }
  const claims = await verifyAccessToken(header.slice(7).trim());
  if (!claims || (await isAccessTokenDenied(claims.jti))) {
    throw new GrpcAuthError(grpc.status.UNAUTHENTICATED, "Geçersiz veya süresi dolmuş token");
  }
  return claims;
}

export function resolveRequester(claims: AccessClaims, requestedId?: string | null): string {
  if (requestedId && requestedId !== claims.userId) {
    throw new GrpcAuthError(
      grpc.status.PERMISSION_DENIED,
      "Başka bir kullanıcı adına işlem yapılamaz"
    );
  }
  return claims.userId;
}
