import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const BCRYPT_COST = 10;

let dummyHash: Promise<string> | null = null;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Sabit zamanlı parola doğrulaması: kullanıcı yoksa da aynı maliyette bir
 * bcrypt karşılaştırması yapılır → yanıt süresi e-postanın kayıtlı olup
 * olmadığını ele vermez.
 */
export async function verifyPasswordConstantTime(
  password: string,
  hash: string | null | undefined
): Promise<boolean> {
  if (!hash) {
    dummyHash ??= bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_COST);
    await bcrypt.compare(password, await dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}
