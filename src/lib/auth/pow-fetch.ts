import { solvePow, type PowChallenge } from "./pow-solver";

/**
 * JSON POST; sunucu 429 `POW_REQUIRED` + bulmaca dönerse tarayıcıda çözüp gövdeye `pow`
 * ekleyerek bir kez yeniden dener (v4#12 girişte, v5#6 kayıt/şifre sıfırlamada).
 */
export async function postJsonWithPow(url: string, body: Record<string, unknown>) {
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
  return send({ pow: await solvePow(data.details.pow) });
}
