/**
 * Eşanlamlı sözlüğü (P1-1, ADR 0008 güncellemesi).
 *
 * Demo modunda (ağsız `HashEmbedder`) "anlamlı" benzerlik için iki deterministik adım:
 *  1. **Katlama** (`foldToken`): Türkçe aksanlar ve noktasız ı ASCII'ye indirgenir
 *     ("şömine" → "somine"); v2'de NFKD sonrası birleşik işaretler kelimeyi bölüyordu.
 *  2. **Kanonikleştirme** (`canonicalToken`): aynı gruptaki sözcükler (TR + EN) tek
 *     kanonik biçime eşlenir ("sahil", "plaj", "beach" → "deniz"); sözlükte yoksa ilk
 *     `STEM_PREFIX` harf (Türkçe için bilinen etkili önek-kök yaklaşımı) kullanılır.
 *
 * Aynı gruplar sözcüksel kanalda (tsquery) sorgu genişletmesi için de kullanılır.
 * Sözlük değişirse `npm run embeddings:backfill` yeniden çalıştırılmalıdır.
 */

/** Her grubun İLK öğesi kanonik biçimdir. Doğal (aksanlı) yazımla tutulur. */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["deniz", "sahil", "plaj", "kumsal", "kıyı", "beach", "sea", "seaside", "coast", "koy"],
  ["manzara", "manzaralı", "view", "seyir", "panorama"],
  ["havuz", "havuzlu", "pool", "swimming"],
  ["dağ", "dağlık", "mountain", "yayla", "zirve"],
  ["kayak", "ski", "pist", "kar", "snow"],
  ["şömine", "fireplace", "ocak", "soba"],
  ["evcil", "köpek", "kedi", "pet", "pets", "hayvan"],
  ["aile", "çocuk", "family", "kids", "children"],
  ["romantik", "balayı", "honeymoon", "romantic", "çift", "couple"],
  ["merkez", "merkezi", "center", "centre", "downtown", "central"],
  ["ekonomik", "ucuz", "uygun", "budget", "cheap", "affordable"],
  ["lüks", "luxury", "premium", "deluxe"],
  ["spa", "hamam", "sauna", "wellness", "masaj"],
  ["tarihi", "tarih", "historic", "historical", "antik", "eski"],
  ["otel", "hotel"],
  ["daire", "apartment", "apart", "flat"],
  ["wifi", "internet", "kablosuz", "wireless"],
  ["otopark", "parking", "park"],
  ["kahvaltı", "breakfast"],
  ["sakin", "sessiz", "huzurlu", "quiet", "peaceful", "calm"],
  ["doğa", "orman", "yeşil", "nature", "forest"],
  ["göl", "lake"],
  ["iş", "business", "toplantı", "meeting"],
  ["bahçe", "garden", "bahçeli"],
  ["teras", "balkon", "terrace", "balcony"],
  ["mağara", "cave", "kaya"],
  ["balon", "balloon"],
];

/** Sözlükte bulunmayan sözcükler için önek-kök uzunluğu. */
export const STEM_PREFIX = 5;

/** Türkçe küçük harf + aksan/noktasız ı katlama; harf/rakam dışı karakterler atılır. */
export function foldToken(token: string): string {
  return token
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const exact = new Map<string, string>();
const byStem = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  const canonical = foldToken(group[0]);
  for (const word of group) {
    const folded = foldToken(word);
    exact.set(folded, canonical);
    if (folded.length >= STEM_PREFIX && !byStem.has(folded.slice(0, STEM_PREFIX))) {
      byStem.set(folded.slice(0, STEM_PREFIX), canonical);
    }
  }
}

/** Katlanmış sözcüğü kanonik biçime indirger (eşanlamlı → grup başı, aksi halde önek kök). */
export function canonicalToken(folded: string): string {
  const hit = exact.get(folded);
  if (hit) return hit;
  if (folded.length > STEM_PREFIX) {
    const stem = folded.slice(0, STEM_PREFIX);
    return byStem.get(stem) ?? stem;
  }
  return folded;
}

const groupByCanonical = new Map<string, readonly string[]>();
for (const group of SYNONYM_GROUPS) groupByCanonical.set(foldToken(group[0]), group);

/**
 * Sorgu sözcüğünü eşanlamlılarıyla genişletir (doğal yazım korunur; tsquery için).
 * Sözlükte yoksa yalnızca kendisi döner.
 */
export function expandSynonyms(word: string): string[] {
  const group = groupByCanonical.get(canonicalToken(foldToken(word)));
  return group ? [...new Set([word, ...group])] : [word];
}
