import OpenAI from "openai";
import { getLlmSettings } from "./settings";

/**
 * OpenAI-uyumlu `/embeddings` çağrısı — sağlayıcı SDK'sı yalnızca `src/lib/llm` içinde
 * kullanılır (§3 v3-e). Anahtar/base URL LLM ayarlarından gelir; canlı mod ve
 * `EMBEDDING_MODEL` yoksa `null` döner (çağıran deterministik embedder'a düşer).
 */
export type EmbedFn = (texts: string[], dimensions: number) => Promise<number[][]>;

export function createRemoteEmbedFn(model: string | undefined): EmbedFn | null {
  const llm = getLlmSettings();
  if (!model || llm.effectiveMode !== "live" || !llm.apiKey) return null;
  const client = new OpenAI({
    apiKey: llm.apiKey,
    baseURL: llm.baseUrl,
    timeout: llm.timeoutSeconds * 1000,
    maxRetries: llm.maxRetries,
  });
  return async (texts, dimensions) => {
    const res = await client.embeddings.create({ model, input: texts, dimensions });
    return res.data.map((d) => d.embedding);
  };
}
