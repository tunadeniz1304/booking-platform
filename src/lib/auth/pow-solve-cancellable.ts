import { leadingZeroBits, powDigest, type PowChallenge, type PowSolution } from "./pow-solver";

export interface SolvePowOptions {
  /** İptal edilince `AbortError` adlı hata fırlatılır (kullanıcı "İptal"e bastı). */
  signal?: AbortSignal;
  /** Denenen özet sayısı; her `progressEvery` adımda bir bildirilir. */
  onProgress?: (iterations: number) => void;
  progressEvery?: number;
  /** Güvenlik sınırı; aşılırsa hata. */
  maxIterations?: number;
}

/**
 * `solvePow` ile aynı bulmaca ve aynı nonce dizisi; ek olarak iptal edilebilir ve ilerleme
 * bildirir. Uzun süren doğrulamada kullanıcı formu bekleme durumundan çıkarabilir (F389).
 */
export async function solvePowCancellable(
  { challenge, bits }: PowChallenge,
  { signal, onProgress, progressEvery = 4096, maxIterations = 2 ** 26 }: SolvePowOptions = {}
): Promise<PowSolution> {
  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("PoW cancelled", "AbortError");
    }
    const nonce = i.toString(36);
    if (leadingZeroBits(await powDigest(challenge, nonce)) >= bits) return { challenge, nonce };
    if (onProgress && i > 0 && i % progressEvery === 0) onProgress(i);
  }
  throw new Error("POW_UNSOLVED");
}

/** Fetch ya da çözücü iptal edildi mi (`AbortController.abort()`). */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError"
  );
}
