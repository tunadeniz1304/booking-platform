import { solvePow, type PowChallenge } from "./pow-solver";

/**
 * `postJsonWithPow` ile aynı akış (429 `POW_REQUIRED` gelirse bulmacayı çözüp bir kez yeniden
 * dener); ek olarak çözüm başlarken `onChallenge` çağrılır, böylece form bekleme nedenini
 * ("Tarayıcı doğrulanıyor...") gösterebilir.
 */
export async function postJsonWithPowChallenge(
  url: string,
  body: Record<string, unknown>,
  onChallenge?: () => void
) {
  const send = (extra: Record<string, unknown> = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
    });
  const res = await send();
  if (res.status !== 429) return res;
  const data = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: string; details?: { pow?: PowChallenge } } | null;
  if (data?.code !== "POW_REQUIRED" || !data.details?.pow) return res;
  onChallenge?.();
  return send({ pow: await solvePow(data.details.pow) });
}
