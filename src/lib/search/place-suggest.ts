import { normalizePlace } from "@/lib/search/normalize-place";

/**
 * "Bunu mu demek istediniz?" önerisi için küçük yardımcılar (F2-21). Yazım hatalı
 * sorgu ("Istnbul") bilinen yer adlarıyla Levenshtein mesafesiyle karşılaştırılır;
 * karşılaştırma normalizePlace'ten geçmiş (aksan / İ-ı duyarsız) metinler üzerinde yapılır.
 */

/** İki metin arasındaki Levenshtein (ekleme / silme / değiştirme) mesafesi. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Kısa sorgularda yanlış öneriyi önlemek için izin verilen en büyük mesafe. */
function maxDistanceFor(length: number, max: number): number {
  if (length < 3) return 0;
  if (length <= 4) return Math.min(1, max);
  return max;
}

/**
 * Sorguya en yakın öğeyi döndürür (mesafe ≤ maxDistance); tam eşleşme ya da
 * yeterince yakın aday yoksa `null`. Eşit mesafede listedeki ilk öğe kazanır.
 */
export function closestPlace<T>(
  query: string,
  items: readonly T[],
  names: (item: T) => readonly string[],
  maxDistance = 2
): T | null {
  const needle = normalizePlace(query);
  const limit = maxDistanceFor(needle.length, maxDistance);
  if (limit === 0) return null;
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    for (const name of names(item)) {
      const d = levenshtein(needle, normalizePlace(name));
      // Tam eşleşme yazım hatası değildir; öneri gösterilmez.
      if (d === 0) return null;
      if (d <= limit && d < bestDistance) {
        best = item;
        bestDistance = d;
      }
    }
  }
  return best;
}
