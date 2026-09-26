/**
 * Hashcash tarzı iş kanıtı (PoW) — istemci/sunucu ortak yardımcılar (v4#12).
 *
 * Bulmaca: `SHA-256("<challenge>:<nonce>")` özetinin en az `bits` baştaki sıfır
 * biti olmalı. Çözüm ortalama 2^bits özet ister; doğrulama tek özettir. Yalnızca
 * WebCrypto (`crypto.subtle`) kullanılır: tarayıcıda ve Node'da aynı kod çalışır,
 * bağımlılık yoktur (altcha benzeri, ağ gerektirmez).
 */

export interface PowChallenge {
  /** Sunucunun imzaladığı opak dize (`<id>.<exp>.<bits>.<imza>`). */
  challenge: string;
  bits: number;
}

export interface PowSolution {
  challenge: string;
  nonce: string;
}

/** Özetin baştaki sıfır bit sayısı. */
export function leadingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8;
      continue;
    }
    return count + Math.clz32(byte) - 24;
  }
  return count;
}

export async function powDigest(challenge: string, nonce: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`${challenge}:${nonce}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

/**
 * Bulmacayı çözer (tarayıcıda giriş formu otomatik çağırır).
 * @param maxIterations güvenlik sınırı; aşılırsa hata
 */
export async function solvePow(
  { challenge, bits }: PowChallenge,
  maxIterations = 2 ** 26
): Promise<PowSolution> {
  for (let i = 0; i < maxIterations; i++) {
    const nonce = i.toString(36);
    if (leadingZeroBits(await powDigest(challenge, nonce)) >= bits) return { challenge, nonce };
  }
  throw new Error("PoW çözülemedi");
}
