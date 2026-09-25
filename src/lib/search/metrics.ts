/**
 * Çevrimdışı sıralama ölçütleri (P1-1 altın küme, P1-2 LTR değerlendirmesi).
 *
 * nDCG@k = DCG@k / IDCG@k, kazanç (2^not − 1), indirim log2(sıra + 1). İdeal sıralama
 * yalnız getirilenlerden değil TÜM notlu belgelerden hesaplanır (kaçırılan ilgili belge
 * skoru düşürür).
 */
export function ndcgAtK(
  rankedIds: readonly string[],
  grades: ReadonlyMap<string, number>,
  k = 10
): number {
  const dcg = (gs: number[]) =>
    gs.slice(0, k).reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
  const ideal = dcg([...grades.values()].sort((a, b) => b - a));
  if (ideal === 0) return 0;
  return dcg(rankedIds.map((id) => grades.get(id) ?? 0)) / ideal;
}
