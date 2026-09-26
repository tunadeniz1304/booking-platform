/**
 * Küçük, bağımlılıksız ve DETERMİNİSTİK k-means (v4 P1-9 yorum öne çıkanları).
 *
 * - Başlangıç: k-means++ (tohumlu mulberry32 PRNG) → aynı girdi + aynı tohum = aynı küme.
 * - Uzaklık: kosinüs uzaklığı (1 − cos); embedding'ler L2-normalize olduğundan
 *   merkezler de her adımda normalize edilir (küresel k-means).
 * - Eşitlikler her zaman en küçük indeksle bozulur; boş kalan küme, merkezine en uzak
 *   noktayla yeniden tohumlanır.
 * - Çıktı kararlı sıralanır: küme büyüklüğü azalan, eşitlikte ilk üyenin indeksi.
 */

export interface KMeansOptions {
  k: number;
  seed: number;
  maxIterations: number;
}

export interface KMeansCluster {
  /** Kümeye düşen girdi indeksleri (artan). */
  members: number[];
  centroid: number[];
}

export interface KMeansResult {
  clusters: KMeansCluster[];
  /** Her girdinin küme indeksi (`clusters` sırasına göre). */
  assignments: number[];
  iterations: number;
}

/** mulberry32: 32-bit tohumlu, platformdan bağımsız PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** L2 normalizasyon (sıfır vektörü sıfır kalır). */
export function normalize(v: readonly number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  return norm > 0 ? v.map((x) => x / norm) : v.map(() => 0);
}

function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Kosinüs uzaklığı (normalize vektörlerde 1 − iç çarpım), [0, 2]. */
export function cosineDistance(a: readonly number[], b: readonly number[]): number {
  return 1 - dot(a, b);
}

function nearest(point: readonly number[], centroids: readonly number[][]): number {
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < centroids.length; c++) {
    const d = cosineDistance(point, centroids[c]);
    if (d < bestD - 1e-12) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function seedCentroids(points: number[][], k: number, rand: () => number): number[][] {
  const centroids: number[][] = [points[Math.floor(rand() * points.length)]];
  while (centroids.length < k) {
    const weights = points.map((p) => {
      let m = Infinity;
      for (const c of centroids) m = Math.min(m, Math.max(0, cosineDistance(p, c)));
      return m * m;
    });
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 1e-12) break; // kalan noktalar mevcut merkezlerle özdeş
    let r = rand() * total;
    let pick = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0 && weights[i] > 0) {
        pick = i;
        break;
      }
    }
    centroids.push(points[pick]);
  }
  return centroids.map((c) => [...c]);
}

/**
 * `vectors` üzerinde k-means. `k` nokta sayısıyla sınırlanır; özdeş noktalar yüzünden
 * daha az ayrık merkez bulunursa daha az küme döner (boş küme döndürülmez).
 */
export function kmeans(vectors: readonly number[][], options: KMeansOptions): KMeansResult {
  if (vectors.length === 0) return { clusters: [], assignments: [], iterations: 0 };
  const points = vectors.map(normalize);
  const k = Math.max(1, Math.min(Math.floor(options.k), points.length));
  const rand = mulberry32(options.seed);
  let centroids = seedCentroids(points, k, rand);
  let assignments = points.map((p) => nearest(p, centroids));
  let iterations = 0;

  for (; iterations < options.maxIterations; iterations++) {
    const dim = points[0].length;
    const sums = centroids.map(() => new Array<number>(dim).fill(0));
    const counts = centroids.map(() => 0);
    assignments.forEach((c, i) => {
      counts[c]++;
      for (let d = 0; d < dim; d++) sums[c][d] += points[i][d];
    });
    centroids = sums.map((sum, c) => {
      if (counts[c] > 0) return normalize(sum);
      // Boş küme: kendi merkezine en uzak noktayla yeniden tohumla (en küçük indeks kazanır).
      let far = 0;
      let farD = -Infinity;
      points.forEach((p, i) => {
        const d = cosineDistance(p, centroids[assignments[i]]);
        if (d > farD + 1e-12) {
          farD = d;
          far = i;
        }
      });
      return [...points[far]];
    });
    const next = points.map((p) => nearest(p, centroids));
    const changed = next.some((c, i) => c !== assignments[i]);
    assignments = next;
    if (!changed) {
      iterations++;
      break;
    }
  }

  const groups = centroids
    .map((centroid, c) => ({
      centroid,
      members: assignments.flatMap((a, i) => (a === c ? [i] : [])),
    }))
    .filter((g) => g.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length || a.members[0] - b.members[0]);

  const remap = new Map<number, number>();
  groups.forEach((g, idx) => g.members.forEach((m) => remap.set(m, idx)));
  return {
    clusters: groups,
    assignments: points.map((_, i) => remap.get(i)!),
    iterations,
  };
}
