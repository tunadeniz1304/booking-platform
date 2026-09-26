import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getConfig } from "@/lib/config/app-config";
import { redis } from "@/lib/redis";
import { HttpError } from "@/lib/http/errors";
import { getJwtSecret } from "./tokens";
import { leadingZeroBits, powDigest, type PowChallenge, type PowSolution } from "./pow-solver";

/**
 * Sunucu tarafı iş kanıtı (v4#12): hesap kilitlemek yerine şüpheli giriş
 * denemelerinde istemciden küçük bir hesaplama maliyeti istenir. Bulmaca durumsuzdur
 * (HMAC imzalı; süre + zorluk içinde), tek kullanımlıktır (Redis `SET NX`).
 */

export class PowRequiredError extends HttpError {
  constructor(challenge: PowChallenge) {
    super(
      429,
      "POW_REQUIRED",
      "Çok fazla deneme. Devam etmek için tarayıcı doğrulaması gerekiyor.",
      { pow: challenge }
    );
    this.name = "PowRequiredError";
  }
}

function sign(payload: string): string {
  return createHmac("sha256", getJwtSecret()).update(`pow:${payload}`).digest("base64url");
}

export function issuePowChallenge(now = Date.now()): PowChallenge {
  const config = getConfig();
  const id = randomBytes(12).toString("base64url");
  const exp = Math.floor(now / 1000) + config.AUTH_POW_TTL_SECONDS;
  const bits = config.AUTH_POW_DIFFICULTY_BITS;
  const payload = `${id}.${exp}.${bits}`;
  return { challenge: `${payload}.${sign(payload)}`, bits };
}

/** Çözümü doğrular ve bulmacayı tüketir; geçersiz/tekrar/süresi dolmuşsa `false`. */
export async function verifyPow(
  solution: PowSolution | undefined | null,
  now = Date.now()
): Promise<boolean> {
  if (!solution || typeof solution.challenge !== "string" || typeof solution.nonce !== "string") {
    return false;
  }
  const parts = solution.challenge.split(".");
  if (parts.length !== 4 || solution.nonce.length > 32) return false;
  const [id, expRaw, bitsRaw, sig] = parts;
  const expected = Buffer.from(sign(`${id}.${expRaw}.${bitsRaw}`));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const exp = Number(expRaw);
  const bits = Number(bitsRaw);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  if (!Number.isInteger(bits) || bits < getConfig().AUTH_POW_DIFFICULTY_BITS) return false;
  if (leadingZeroBits(await powDigest(solution.challenge, solution.nonce)) < bits) return false;
  try {
    const ttl = Math.max(1, exp - Math.floor(now / 1000));
    return (await redis.set(`auth:pow:used:${id}`, "1", { nx: true, ex: ttl })) !== null;
  } catch {
    return false; // tek kullanımlık garanti edilemiyorsa kabul etme
  }
}
