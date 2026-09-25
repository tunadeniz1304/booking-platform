/**
 * Açıklanabilir sıralama (P1-2; DSA md. 27 / Omnibus "sıralama parametreleri").
 *
 * skor = Σ ağırlık_i × bileşen_i, her bileşen [0, 1]:
 *  - priceFit:     seçilen tarihlerde vergi dahil toplamın, sonuç kümesindeki
 *                  en ucuz/pahalı aralığına göre ucuzluğu (fiyat yoksa taban fiyat)
 *  - rating:       Bayes düzeltilmiş puan (az yorumlu 5.0 aşırı öne çıkmaz)
 *  - popularity:   yorum sayısının log ölçeği
 *  - personal:     kullanıcının geçmişine (şehir/tip) yakınlık
 *  - semantic:     hibrit (RRF) ilgi skoru, kümedeki en iyi eşleşmeye göre 0..1 (sorgu varsa)
 * Sorgu varsa `RANKING_WEIGHTS_WITH_QUERY` kullanılır: ilgi baskın olmalı, yoksa puan/fiyat
 * metinle alakasız ilanları öne çıkarır (v3#19). `explain` bileşenlerinin toplamı skora eşittir. Eşitlikte id ile deterministik.
 * Reklam/komisyon sıralamayı ETKİLEMEZ.
 */

export const RANKING_WEIGHTS = {
  priceFit: 0.3,
  rating: 0.35,
  popularity: 0.1,
  personal: 0.1,
  semantic: 0.15,
} as const;

/** Serbest metin sorgusu varken ağırlıklar (toplam 1). */
export const RANKING_WEIGHTS_WITH_QUERY = {
  priceFit: 0.1,
  rating: 0.15,
  popularity: 0.05,
  personal: 0.1,
  semantic: 0.6,
} as const;

export type RankingComponent = keyof typeof RANKING_WEIGHTS;
export type RankingWeights = Record<RankingComponent, number>;

export interface RankingInput {
  id: string;
  price: number;
  ratingAvg: number;
  ratingCount: number;
  personal?: number;
  semantic?: number;
}

export interface RankedItem {
  id: string;
  score: number;
  explain: Record<RankingComponent, number>;
}

const PRIOR_MEAN = 4.0;
const PRIOR_WEIGHT = 5;

export function bayesianRating(avg: number, count: number): number {
  return (PRIOR_MEAN * PRIOR_WEIGHT + avg * count) / (PRIOR_WEIGHT + count);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** Ağırlıksız bileşenler (0..1) — LTR özellikleri de bunlardan türetilir. */
export function rankingComponents(items: RankingInput[]): Record<RankingComponent, number>[] {
  if (items.length === 0) return [];
  const prices = items.map((i) => i.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const maxLog = Math.log1p(Math.max(...items.map((i) => i.ratingCount), 1));
  return items.map((item) => ({
    priceFit: max === min ? 1 : clamp01((max - item.price) / (max - min)),
    rating: clamp01(bayesianRating(item.ratingAvg, item.ratingCount) / 5),
    popularity: clamp01(Math.log1p(item.ratingCount) / maxLog),
    personal: clamp01(item.personal ?? 0),
    semantic: clamp01(item.semantic ?? 0),
  }));
}

export function rankResults(
  items: RankingInput[],
  weights: RankingWeights = RANKING_WEIGHTS
): RankedItem[] {
  const components = rankingComponents(items);
  return items
    .map((item, i) => {
      const raw = components[i];
      const explain = Object.fromEntries(
        (Object.keys(weights) as RankingComponent[]).map((k) => [k, round4(weights[k] * raw[k])])
      ) as Record<RankingComponent, number>;
      const score = round4(Object.values(explain).reduce((s, v) => s + v, 0));
      return { id: item.id, score, explain };
    })
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
