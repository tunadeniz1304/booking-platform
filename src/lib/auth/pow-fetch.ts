import { solvePow, type PowChallenge } from "./pow-solver";
import { solvePowCancellable } from "./pow-solve-cancellable";

export interface PostJsonWithPowOpts {
  /** İstekleri ve bulmaca çözümünü iptal eder (`AbortError`; bkz. `isAbortError`). */
  signal?: AbortSignal;
  /** Bulmaca çözümü başlarken çağrılır: form bekleme nedenini ve "İptal"i gösterebilir. */
  onChallenge?: () => void;
}

/**
 * JSON POST; sunucu 429 `POW_REQUIRED` + bulmaca dönerse tarayıcıda çözüp gövdeye `pow`
 * ekleyerek bir kez yeniden dener (v4#12 girişte, v5#6 kayıt/şifre sıfırlamada).
 */
export async function postJsonWithPow(
  url: string,
  body: Record<string, unknown>,
  opts: PostJsonWithPowOpts = {}
) {
  const send = (extra: Record<string, unknown> = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
      signal: opts.signal,
    });
  const res = await send();
  if (res.status !== 429) return res;
  const data = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: string; details?: { pow?: PowChallenge } } | null;
  if (data?.code !== "POW_REQUIRED" || !data.details?.pow) return res;
  opts.onChallenge?.();
  // Aynı nonce dizisi; iptal sinyali varsa çözüm de iptal edilebilir.
  const pow = opts.signal
    ? await solvePowCancellable(data.details.pow, { signal: opts.signal })
    : await solvePow(data.details.pow);
  return send({ pow });
}
