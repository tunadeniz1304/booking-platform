import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { getConfig } from "@/lib/config/app-config";
import { anonymousIdentities } from "@/lib/security/ip";
import { runWithLlmSubject, userLlmSubject } from "@/lib/llm/budget";

/**
 * AI uçları için ortak yardımcılar.
 *  - Bütçe öznesi: oturum varsa `u:<id>`, yoksa güvenilir IP kovası; IP
 *    bilinmiyorsa paylaşılan `anon` bütçesi (UA değiştirerek sıfırlanamaz, v4#4).
 *  - `ai_generated: true` (AI Act Md. 50) — her AI çıktısı API'de işaretlenir.
 */
async function aiSubject(req: NextRequest): Promise<string> {
  const claims = await getAuth(req);
  if (claims) return userLlmSubject(claims.userId);
  const config = getConfig();
  return anonymousIdentities(req.headers, {
    trustedProxyHops: config.TRUSTED_PROXY_HOPS,
    trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
  }).primary;
}

/** `fn` içindeki LLM çağrılarını isteğin öznesine faturalar. */
export async function withAiSubject<T>(req: NextRequest, fn: () => Promise<T>): Promise<T> {
  return runWithLlmSubject(await aiSubject(req), fn);
}

/** Yanıt gövdesini AI çıktısı olarak işaretler. */
export function markAiGenerated<T extends object>(body: T): T & { ai_generated: true } {
  return { ...body, ai_generated: true };
}
