import { hkdfSync, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { z } from "zod";
import { getConfig } from "@/lib/config/app-config";
import { getJwtSecret } from "@/lib/auth/tokens";
import { HttpError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { audit } from "@/lib/admin/audit";
import { logger } from "@/lib/observability/logger";

/**
 * AP2 tarzı imzalı intent mandate (P1-11, ADR 0023).
 *
 * Kullanıcı (recent-auth ile) ajana "şu tutara kadar, şu para biriminde, şu tarihe kadar,
 * isteğe bağlı şu ilanlarda" harcama yetkisi verir. Mandate kompakt JWS'tir (HS256, ayrı
 * anahtar); ajan checkout'u tamamlarken sunar. Doğrulama sırası:
 *   imza/aud/iss/typ → süre → sub = oturumdaki kullanıcı → para birimi → ilan kısıtı →
 *   tutar (aşarsa 402 + step-up: kullanıcı daha yüksek limitli yeni mandate imzalar) →
 *   nonce tek kullanımlık (ilk checkout oturumuna bağlanır; başka oturumda 409).
 * Mandate bir kimlik bilgisi değildir: kimlik her zaman transport'taki access token'dan gelir.
 */

export const MANDATE_TYP = "ap2-intent-mandate+jwt";
const ISSUER = "booking-platform";
const ALG = "HS256";

export interface MandateClaims {
  /** Mandate'i veren kullanıcı. */
  sub: string;
  aud: string;
  maxAmountMinor: number;
  currency: string;
  /** ISO-8601; imzalı `exp` ile aynı an. */
  expiresAt: string;
  /** Opsiyonel ilan kısıtı; yoksa tüm ilanlar. */
  propertyId?: string[];
  nonce: string;
}

export type MandateRejectReason =
  | "MANDATE_REQUIRED"
  | "MANDATE_INVALID"
  | "MANDATE_EXPIRED"
  | "MANDATE_SUBJECT_MISMATCH"
  | "MANDATE_CURRENCY_MISMATCH"
  | "MANDATE_PROPERTY_MISMATCH"
  | "MANDATE_AMOUNT_EXCEEDED"
  | "MANDATE_REPLAYED"
  | "MANDATE_REVOKED";

const STATUS: Record<MandateRejectReason, number> = {
  MANDATE_REQUIRED: 403,
  MANDATE_INVALID: 403,
  MANDATE_EXPIRED: 403,
  MANDATE_SUBJECT_MISMATCH: 403,
  MANDATE_CURRENCY_MISMATCH: 403,
  MANDATE_PROPERTY_MISMATCH: 403,
  // AP2: limit aşımı ödeme gerektirir → kullanıcı onayı (step-up) olmadan ödenmez.
  MANDATE_AMOUNT_EXCEEDED: 402,
  MANDATE_REPLAYED: 409,
  MANDATE_REVOKED: 403,
};

const MESSAGES: Record<MandateRejectReason, string> = {
  MANDATE_REQUIRED: "Ajan ödemesi için kullanıcının imzaladığı mandate zorunludur",
  MANDATE_INVALID: "Mandate imzası veya biçimi geçersiz",
  MANDATE_EXPIRED: "Mandate'in süresi dolmuş",
  MANDATE_SUBJECT_MISMATCH: "Mandate bu kullanıcıya ait değil",
  MANDATE_CURRENCY_MISMATCH: "Mandate para birimi ödeme para birimiyle uyuşmuyor",
  MANDATE_PROPERTY_MISMATCH: "Mandate bu ilan için yetki vermiyor",
  MANDATE_AMOUNT_EXCEEDED:
    "Tutar mandate limitini aşıyor; kullanıcının daha yüksek limitli yeni mandate onaylaması gerekiyor",
  MANDATE_REPLAYED: "Bu mandate başka bir checkout için kullanılmış",
  MANDATE_REVOKED: "Mandate kullanıcı tarafından iptal edilmiş",
};

export class MandateError extends HttpError {
  constructor(
    readonly reason: MandateRejectReason,
    details?: unknown
  ) {
    super(STATUS[reason], reason, MESSAGES[reason], details);
    this.name = "MandateError";
  }
}

/** İmza anahtarı: `AGENT_MANDATE_SIGNING_KEY` (≥32) ya da JWT sırrından ayrı bağlamla HKDF. */
export function mandateKey(env: Record<string, string | undefined> = process.env): Uint8Array {
  const configured = env.AGENT_MANDATE_SIGNING_KEY?.trim() ?? "";
  if (configured.length >= 32) return new TextEncoder().encode(configured);
  return new Uint8Array(
    hkdfSync("sha256", getJwtSecret(), Buffer.alloc(0), "booking-platform:agent-mandate:v1", 32)
  );
}

export const issueMandateSchema = z
  .object({
    maxAmountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/, "ISO-4217 para birimi bekleniyor")
      .transform((c) => c.toUpperCase()),
    expiresInMinutes: z.number().int().positive().optional(),
    propertyIds: z.array(z.string().min(1).max(64)).min(1).max(20).optional(),
  })
  .strict();

export type IssueMandateInput = z.input<typeof issueMandateSchema>;

/** Mandate'i imzalar (saf; audit/HTTP yok). Süre, azami TTL'e kırpılmaz — aşarsa 400. */
export async function signMandate(
  userId: string,
  input: IssueMandateInput,
  now = new Date()
): Promise<{ mandate: string; claims: MandateClaims }> {
  const parsed = issueMandateSchema.parse(input);
  const config = getConfig();
  const ttl = parsed.expiresInMinutes ?? config.AGENT_MANDATE_DEFAULT_TTL_MINUTES;
  if (ttl > config.AGENT_MANDATE_MAX_TTL_MINUTES) {
    throw new ValidationError(
      `Mandate süresi en fazla ${config.AGENT_MANDATE_MAX_TTL_MINUTES} dakika olabilir`
    );
  }
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttl * 60;
  const claims: MandateClaims = {
    sub: userId,
    aud: config.AGENT_MANDATE_AUDIENCE,
    maxAmountMinor: parsed.maxAmountMinor,
    currency: parsed.currency,
    expiresAt: new Date(exp * 1000).toISOString(),
    ...(parsed.propertyIds ? { propertyId: [...new Set(parsed.propertyIds)] } : {}),
    nonce: randomUUID(),
  };
  const { sub, aud, ...rest } = claims;
  const mandate = await new SignJWT({ ...rest })
    .setProtectedHeader({ alg: ALG, typ: MANDATE_TYP })
    .setSubject(sub)
    .setAudience(aud)
    .setIssuer(ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(mandateKey());
  return { mandate, claims };
}

/** Kullanıcı mandate'i verir (API: requireVerifiedEmail + recent-auth route'ta). Audit'lenir. */
export async function issueMandate(
  userId: string,
  input: IssueMandateInput,
  now = new Date()
): Promise<{ mandate: string; claims: MandateClaims }> {
  const out = await signMandate(userId, input, now);
  await audit(userId, "agent_mandate.issued", "AgentMandate", out.claims.nonce, {
    maxAmountMinor: out.claims.maxAmountMinor,
    currency: out.claims.currency,
    expiresAt: out.claims.expiresAt,
    propertyId: out.claims.propertyId ?? null,
  });
  return out;
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  maxAmountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expiresAt: z.string(),
  propertyId: z.array(z.string()).optional(),
  nonce: z.string().min(8).max(128),
});

/** İmza + süre + biçim; geçersizse MandateError. Saf (Redis/DB yok). */
export async function verifyMandateToken(token: string, now = new Date()): Promise<MandateClaims> {
  let payload: unknown;
  try {
    const out = await jwtVerify(token, mandateKey(), {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: getConfig().AGENT_MANDATE_AUDIENCE,
      typ: MANDATE_TYP,
      currentDate: now,
      clockTolerance: 0,
    });
    payload = out.payload;
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) throw new MandateError("MANDATE_EXPIRED");
    throw new MandateError("MANDATE_INVALID");
  }
  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) throw new MandateError("MANDATE_INVALID");
  const { aud, ...rest } = parsed.data;
  return { ...rest, aud: Array.isArray(aud) ? aud[0] : aud };
}

/** Tek kullanımlık nonce deposu: nonce ilk checkout oturumuna bağlanır. */
export interface NonceStore {
  /** Bağlar; zaten başka bir oturuma bağlıysa o oturumun kimliğini döner. */
  bind(nonce: string, sessionId: string, ttlSeconds: number): Promise<{ boundTo: string }>;
}

const nonceKey = (nonce: string) => `agent-mandate:nonce:${nonce}`;

export const redisNonceStore: NonceStore = {
  async bind(nonce, sessionId, ttlSeconds) {
    const key = nonceKey(nonce);
    const set = await redis.set(key, sessionId, { ex: ttlSeconds, nx: true });
    if (set) return { boundTo: sessionId };
    return { boundTo: (await redis.get(key)) ?? sessionId };
  },
};

export function memoryNonceStore(): NonceStore {
  const map = new Map<string, string>();
  return {
    async bind(nonce, sessionId) {
      const existing = map.get(nonce);
      if (existing) return { boundTo: existing };
      map.set(nonce, sessionId);
      return { boundTo: sessionId };
    },
  };
}

// ---------------------------------------------------------------------------
// İptal (revocation) — P2-1a
// ---------------------------------------------------------------------------

/** İptal edilmiş mandate nonce'ları (jti). */
export interface RevocationStore {
  isRevoked(nonce: string): Promise<boolean>;
}

const revokedKey = (nonce: string) => `agent-mandate:revoked:${nonce}`;

/**
 * Redis önce (hızlı yol); Redis'te yoksa ya da Redis erişilemezse kalıcı kayıt (AuditLog
 * `agent_mandate.revoked`) — Redis verisi kaybolsa bile iptal edilmiş mandate kabul edilmez.
 */
export const redisRevocationStore: RevocationStore = {
  async isRevoked(nonce) {
    try {
      if (await redis.get(revokedKey(nonce))) return true;
    } catch (error) {
      logger.warn({ err: String(error) }, "mandate revocation cache unavailable; using audit log");
    }
    const rows = await prisma.auditLog.count({
      where: { action: "agent_mandate.revoked", entity: "AgentMandate", entityId: nonce },
    });
    return rows > 0;
  },
};

export function memoryRevocationStore(revoked: Iterable<string> = []): RevocationStore & {
  revoke(nonce: string): void;
} {
  const set = new Set(revoked);
  return {
    async isRevoked(nonce) {
      return set.has(nonce);
    },
    revoke(nonce) {
      set.add(nonce);
    },
  };
}

export type MandateStatus = "active" | "expired" | "revoked";

export interface MandateSummary {
  nonce: string;
  maxAmountMinor: number;
  currency: string;
  expiresAt: string;
  propertyId: string[] | null;
  issuedAt: string;
  revokedAt: string | null;
  status: MandateStatus;
  /** Nonce bir checkout oturumuna bağlandı mı (Redis erişilemezse null). */
  used: boolean | null;
}

interface IssuedMeta {
  maxAmountMinor?: number;
  currency?: string;
  expiresAt?: string;
  propertyId?: string[] | null;
}

/**
 * Kullanıcının verdiği mandate'ler (P2-1a). Mandate'ler DB'de ayrı tabloda tutulmaz
 * (ADR 0023): verme/iptal denetim kaydından, kullanım Redis nonce bağından okunur.
 * `limit: null` → tümü (KVKK dışa aktarımı).
 */
export async function listMandates(
  userId: string,
  now = new Date(),
  limit: number | null = 50
): Promise<MandateSummary[]> {
  const issued = await prisma.auditLog.findMany({
    where: { actorId: userId, action: "agent_mandate.issued", entity: "AgentMandate" },
    orderBy: { createdAt: "desc" },
    take: limit ?? undefined,
  });
  const nonces = issued.map((r) => r.entityId).filter((n): n is string => !!n);
  const revoked = new Map(
    (
      await prisma.auditLog.findMany({
        where: {
          actorId: userId,
          action: "agent_mandate.revoked",
          entity: "AgentMandate",
          entityId: { in: nonces },
        },
        select: { entityId: true, createdAt: true },
      })
    ).map((r) => [r.entityId!, r.createdAt])
  );
  let bound: Array<string | null> | null = null;
  try {
    bound = await redis.mget(nonces.map(nonceKey));
  } catch {
    bound = null;
  }
  const usedByNonce = new Map(nonces.map((n, i) => [n, bound ? bound[i] !== null : null]));
  const out: MandateSummary[] = [];
  for (const row of issued) {
    if (!row.entityId) continue;
    const meta = (row.meta ?? {}) as IssuedMeta;
    const used = usedByNonce.get(row.entityId) ?? null;
    const revokedAt = revoked.get(row.entityId) ?? null;
    const expiresAt = meta.expiresAt ?? row.createdAt.toISOString();
    out.push({
      nonce: row.entityId,
      maxAmountMinor: Number(meta.maxAmountMinor ?? 0),
      currency: meta.currency ?? "",
      expiresAt,
      propertyId: meta.propertyId ?? null,
      issuedAt: row.createdAt.toISOString(),
      revokedAt: revokedAt?.toISOString() ?? null,
      status: revokedAt ? "revoked" : Date.parse(expiresAt) <= now.getTime() ? "expired" : "active",
      used,
    });
  }
  return out;
}

/**
 * Mandate'i iptal eder (idempotent). Önce kalıcı denetim kaydı, sonra Redis işareti
 * (mandate süresi + 1 saat). Yalnız mandate'i veren kullanıcı iptal edebilir (aksi 404).
 */
export async function revokeMandate(
  userId: string,
  nonce: string,
  now = new Date()
): Promise<{ nonce: string; revokedAt: string }> {
  const issued = await prisma.auditLog.findFirst({
    where: {
      actorId: userId,
      action: "agent_mandate.issued",
      entity: "AgentMandate",
      entityId: nonce,
    },
  });
  if (!issued) throw new NotFoundError("Mandate bulunamadı");
  const existing = await prisma.auditLog.findFirst({
    where: { actorId: userId, action: "agent_mandate.revoked", entityId: nonce },
  });
  if (existing) return { nonce, revokedAt: existing.createdAt.toISOString() };
  await audit(userId, "agent_mandate.revoked", "AgentMandate", nonce, {});
  const expiresAt = Date.parse(((issued.meta ?? {}) as IssuedMeta).expiresAt ?? "");
  const ttl = Number.isFinite(expiresAt)
    ? Math.max(60, Math.ceil((expiresAt - now.getTime()) / 1000) + 3600)
    : 7 * 86_400;
  try {
    await redis.set(revokedKey(nonce), "1", { ex: ttl });
  } catch (error) {
    logger.warn(
      { err: String(error) },
      "mandate revocation cache write failed; audit log holds it"
    );
  }
  return { nonce, revokedAt: now.toISOString() };
}

export interface MandateCharge {
  userId: string;
  /** Checkout oturumu: nonce buna bağlanır (aynı oturumun yeniden denemesi serbest). */
  checkoutSessionId: string;
  amountMinor: number;
  currency: string;
  propertyId: string;
}

/** Talep edilen ödemeyi mandate'e karşı yetkilendirir (nonce bağlama hariç, saf). */
export function assertWithinMandate(claims: MandateClaims, charge: MandateCharge): void {
  if (claims.sub !== charge.userId) throw new MandateError("MANDATE_SUBJECT_MISMATCH");
  if (claims.currency !== charge.currency.toUpperCase()) {
    throw new MandateError("MANDATE_CURRENCY_MISMATCH");
  }
  if (claims.propertyId && !claims.propertyId.includes(charge.propertyId)) {
    throw new MandateError("MANDATE_PROPERTY_MISMATCH");
  }
  if (charge.amountMinor > claims.maxAmountMinor) {
    throw new MandateError("MANDATE_AMOUNT_EXCEEDED", {
      amountMinor: charge.amountMinor,
      maxAmountMinor: claims.maxAmountMinor,
      currency: claims.currency,
      stepUp: {
        type: "new_mandate",
        endpoint: "/api/account/agent-mandates",
        hint: "Kullanıcı yeniden kimlik doğrulayıp daha yüksek limitli mandate onaylamalı",
      },
    });
  }
}

export interface AuthorizeMandateDeps {
  nonces?: NonceStore;
  revocations?: RevocationStore;
  now?: Date;
  /** Denetim kaydı (varsayılan AuditLog). Smoke/birim testte enjekte edilir. */
  record?: (action: string, charge: MandateCharge, meta: Record<string, unknown>) => Promise<void>;
}

async function auditRecord(action: string, charge: MandateCharge, meta: Record<string, unknown>) {
  await audit(charge.userId, action, "CheckoutSession", charge.checkoutSessionId, meta);
}

/**
 * Checkout tamamlama kapısı: mandate yok/geçersiz/dolmuş/kapsam dışı/aşan tutar → red.
 * `AGENT_MANDATE_REQUIRED=false` iken mandate'siz geçilir (verilmişse yine doğrulanır).
 * Red ve ilk kabul denetim kaydına yazılır.
 */
export async function authorizeMandate(
  token: string | null | undefined,
  charge: MandateCharge,
  deps: AuthorizeMandateDeps = {}
): Promise<MandateClaims | null> {
  const now = deps.now ?? new Date();
  const record = deps.record ?? auditRecord;
  const nonces = deps.nonces ?? redisNonceStore;
  const revocations = deps.revocations ?? redisRevocationStore;
  const trimmed = token?.trim();
  try {
    if (!trimmed) {
      if (!getConfig().AGENT_MANDATE_REQUIRED) return null;
      throw new MandateError("MANDATE_REQUIRED");
    }
    const claims = await verifyMandateToken(trimmed, now);
    if (await revocations.isRevoked(claims.nonce)) throw new MandateError("MANDATE_REVOKED");
    assertWithinMandate(claims, charge);
    const ttl = Math.max(60, Math.ceil((Date.parse(claims.expiresAt) - now.getTime()) / 1000));
    const { boundTo } = await nonces.bind(claims.nonce, charge.checkoutSessionId, ttl + 3600);
    if (boundTo !== charge.checkoutSessionId) {
      throw new MandateError("MANDATE_REPLAYED");
    }
    await record("agent_mandate.accepted", charge, {
      nonce: claims.nonce,
      amountMinor: charge.amountMinor,
      maxAmountMinor: claims.maxAmountMinor,
      currency: claims.currency,
    });
    return claims;
  } catch (error) {
    if (error instanceof MandateError) {
      logger.warn(
        { reason: error.reason, checkoutSessionId: charge.checkoutSessionId },
        "agent mandate rejected"
      );
      await record("agent_mandate.rejected", charge, {
        reason: error.reason,
        amountMinor: charge.amountMinor,
        currency: charge.currency,
      }).catch(() => undefined);
    }
    throw error;
  }
}
