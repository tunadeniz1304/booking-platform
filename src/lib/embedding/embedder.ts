/**
 * Kendi içinde (self-contained) deterministik metin gömme üreteci.
 *
 * Dış ML modeli/API bağımlılığı yoktur: sözcük torbasını (bag-of-words)
 * 128-boyutlu featured hash ile vektöre dönüştürür ve L2 normalize eder.
 * Bu, pgvector `<=>` (kosinüs mesafesi) ile gerçek semantik-ötesi
 * benzerlik sıralaması sağlar. Üretimde daha güçlü bir gömme modeli
 * takılabilir; arayüz (encode) aynı kalır.
 */

import { canonicalToken, foldToken } from "./synonyms";

export const EMBEDDING_DIM = 128;

const stopWords = new Set([
  "ve",
  "bir",
  "ile",
  "için",
  "bu",
  "da",
  "de",
  "en",
  "çok",
  "olan",
  "the",
  "a",
  "an",
  "of",
  "for",
  "in",
  "on",
  "to",
  "and",
  "is",
  "at",
]);

/** Türkçe/İngilizce durak sözcükleri (katlanmış biçimde karşılaştırılır). */
export const STOP_WORDS: ReadonlySet<string> = new Set([...stopWords].map(foldToken));

/** Ham sözcüklere ayırma (doğal yazım korunur, küçük harf). */
export function splitWords(text: string): string[] {
  return text
    .toLocaleLowerCase("tr-TR")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(foldToken(t)));
}

/** Gömme belirteçleri: katlanmış + eşanlamlı/önek-kök kanonik biçim (P1-1). */
export function tokenize(text: string): string[] {
  return splitWords(text)
    .map(foldToken)
    .filter((t) => t.length > 1)
    .map(canonicalToken);
}

/** FNV-1a 32-bit karma — deterministik işarete sahip özellik dizini üretir. */
function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Metni L2-normalize 128-boyutlu reel vektöre çevirir.
 * Feature hashing: hash(token) -> index; sign = hash(token)&1 ? +1 : -1;
 * ağırlık = sublinear TF (1 + ln tf) — yaygın motifleri bastırır.
 */
export function encode(text: string): number[] {
  return encodeTokens(tokenize(text));
}

/** Belirteç listesini vektöre çevirir (altın küme v2 taban çizgisi de bunu kullanır). */
export function encodeTokens(tokens: string[]): number[] {
  const vector = new Float64Array(EMBEDDING_DIM);
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  for (const [token, tf] of counts) {
    const h = fnv1a32(token);
    const index = h % EMBEDDING_DIM;
    const sign = h & 1 ? 1 : -1;
    const weight = 1 + Math.log(tf);
    vector[index] += sign * weight;
  }

  // L2 normalizasyon (sıfır vektörü boşta bırak)
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  const result: number[] = new Array<number>(EMBEDDING_DIM);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) result[i] = vector[i] / norm;
  } else {
    result.fill(0);
  }
  return result;
}

/** Vektörü pgvector literal'ı haline getirir: [0.1,0.2,...] */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => v.toFixed(6)).join(",")}]`;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
