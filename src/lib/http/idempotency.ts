import { createHash } from "crypto";

/**
 * Idempotency-Key'in bağlandığı istek gövdesinin özeti (v4#9). `agentic/checkout.ts`
 * `hashRequest` deseni: alanlar SABİT sırada bir diziye konur → JSON → sha256 (hex).
 * Aynı anahtar farklı bir gövdeyle gelirse çağıran 409 `IDEMPOTENCY_KEY_REUSED` döner.
 * `undefined` alanlar `null` olarak kanonikleştirilir (eksik ≡ null).
 */
export function hashIdempotentRequest(parts: ReadonlyArray<string | number | null | undefined>) {
  const canonical = JSON.stringify(parts.map((p) => (p === undefined ? null : p)));
  return createHash("sha256").update(canonical).digest("hex");
}
