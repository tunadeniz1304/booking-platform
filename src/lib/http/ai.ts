import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { runWithLlmSubject } from "@/lib/llm/budget";

/**
 * AI uçları için ortak yardımcılar.
 *  - Bütçe öznesi: oturum varsa `u:<id>`, yoksa istemci anahtarı (IP / parmak izi).
 *  - `ai_generated: true` (AI Act Md. 50) — her AI çıktısı API'de işaretlenir.
 */
export async function aiSubject(req: NextRequest): Promise<string> {
  const claims = await getAuth(req);
  if (claims) return `u:${claims.userId}`;
  const config = getConfig();
  return clientKey(req.headers, {
    trustedProxyHops: config.TRUSTED_PROXY_HOPS,
    trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
  });
}

/** `fn` içindeki LLM çağrılarını isteğin öznesine faturalar. */
export async function withAiSubject<T>(req: NextRequest, fn: () => Promise<T>): Promise<T> {
  return runWithLlmSubject(await aiSubject(req), fn);
}

/** Yanıt gövdesini AI çıktısı olarak işaretler. */
export function markAiGenerated<T extends object>(body: T): T & { ai_generated: true } {
  return { ...body, ai_generated: true };
}
