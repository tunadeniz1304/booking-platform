import type { PowChallenge } from "./pow-solver";
import { solvePowCancellable } from "./pow-solve-cancellable";

export interface PostJsonWithPowOptions {
  /** İstekleri ve bulmaca çözümünü iptal eder (`AbortError`; bkz. `isAbortError`). */
  signal?: AbortSignal;
  /** Bulmaca çözümü başlarken çağrılır: form bekleme nedenini ve "İptal"i gösterebilir. */
  onChallenge?: () => void;
}

/**
 * `postJsonWithPowChallenge` ile aynı akış (429 `POW_REQUIRED` gelirse bulmacayı çözüp bir kez
 * yeniden dener); ek olarak istekler ve çözüm `signal` ile iptal edilebilir (F389).
 */
export async function postJsonWithPowCancellable(
  url: string,
  body: Record<string, unknown>,
  { signal, onChallenge }: PostJsonWithPowOptions = {}
) {
  const send = (extra: Record<string, unknown> = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
      signal,
    });
  const res = await send();
  if (res.status !== 429) return res;
  const data = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: string; details?: { pow?: PowChallenge } } | null;
  if (data?.code !== "POW_REQUIRED" || !data.details?.pow) return res;
  onChallenge?.();
  return send({ pow: await solvePowCancellable(data.details.pow, { signal }) });
}
