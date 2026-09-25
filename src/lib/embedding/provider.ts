import { EMBEDDING_DIM, encode } from "./embedder";
import { createRemoteEmbedFn, type EmbedFn } from "@/lib/llm/embeddings";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * Embedding sağlayıcı arayüzü (P1-11).
 *
 *  - HashEmbedder (varsayılan, ağsız): 128 boyutlu feature-hashing bag-of-words.
 *    Bu bir ML modeli DEĞİLDİR; sözcük örtüşmesine dayalı ucuz bir yaklaşımdır.
 *  - OpenAIEmbedder (opsiyonel): `EMBEDDING_MODEL` + LLM anahtarı varsa, OpenAI-uyumlu
 *    `/embeddings` ucu `dimensions: 128` ile çağrılır → mevcut `vector(128)` kolonu
 *    değişmeden kullanılır. Sağlayıcı boyut desteklemezse hash'e düşülür.
 *
 * Sağlayıcı değişirse tüm vektörler `npm run embeddings:backfill` ile yeniden
 * üretilmelidir (idempotent); farklı uzaylar karıştırılmaz.
 */
export interface Embedder {
  readonly name: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

export class HashEmbedder implements Embedder {
  readonly name = "hash-fnv1a-128";
  readonly dim = EMBEDDING_DIM;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(encode);
  }
}

export class OpenAIEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;
  private readonly fallback = new HashEmbedder();
  constructor(
    private readonly embedFn: EmbedFn,
    private readonly model: string
  ) {}
  get name(): string {
    return `openai:${this.model}:${this.dim}`;
  }
  async embed(texts: string[]): Promise<number[][]> {
    try {
      const vectors = await this.embedFn(texts, this.dim);
      if (vectors.some((v) => v.length !== this.dim)) throw new Error("Boyut uyuşmazlığı");
      return vectors;
    } catch (error) {
      logger.warn(errorFields(error), "embedding provider failed; hash fallback");
      return this.fallback.embed(texts);
    }
  }
}

let cached: Embedder | null = null;

export function getEmbedder(): Embedder {
  if (cached) return cached;
  const model = process.env.EMBEDDING_MODEL?.trim();
  const remote = createRemoteEmbedFn(model);
  cached = remote && model ? new OpenAIEmbedder(remote, model) : new HashEmbedder();
  return cached;
}

export async function embedText(text: string): Promise<number[]> {
  const [v] = await getEmbedder().embed([text]);
  return v;
}
