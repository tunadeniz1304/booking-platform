/**
 * Quantum-Inspired Routing — çok şehirli seyahat için kombinatorik rota motoru.
 * TSP: şehirleri hangi sırayla ziyaret etmek toplam seyahat maliyetini
 * (mesafe + tahmini uçuş + hava-konfor cezası) en düşüğe indirir?
 * n <= 8 -> tam çözüm (Held-Karp DP); n > 8 -> NN + 2-opt iyileştirme.
 */

export interface CityNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  nights?: number;
}

export interface RoutePlan {
  order: string[];
  totalKm: number;
  flightCostEstimate: number;
  weatherIndex: number;
  algorithm: "held-karp" | "nearest-neighbor+2opt";
  legs: Array<{ from: string; to: string; km: number; cost: number }>;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function flightCostEstimate(km: number): number {
  return Math.round(km * 0.09 + 40);
}

export function climateComfort(lat: number, month: number): number {
  const abs = Math.abs(lat);
  if (abs < 23) return month >= 6 && month <= 8 ? 6 : 8;
  if (abs <= 45) {
    if (month >= 4 && month <= 6) return 9;
    if (month >= 7 && month <= 8) return 7;
    if (month === 12 || month === 1 || month === 2) return 4;
    return 8;
  }
  return month >= 6 && month <= 8 ? 9 : month === 12 || month <= 2 ? 2 : 6;
}

function leg(a: CityNode, b: CityNode, month: number): { km: number; cost: number } {
  const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
  const weatherPenalty = (climateComfort(a.lat, month) - 5) * 0.02;
  const cost = km * (1 + weatherPenalty) + flightCostEstimate(km) * 0.4;
  return { km, cost };
}
function heldKarp(cities: CityNode[], month: number) {
  const n = cities.length;
  const full = 1 << n;
  const C = Array.from({ length: full }, () => new Array(n).fill(Infinity));
  const P = Array.from({ length: full }, () => new Array(n).fill(-1));
  for (let i = 1; i < n; i++) C[1 << i][i] = leg(cities[0], cities[i], month).cost;
  for (let mask = 1; mask < full; mask++) {
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i)) || C[mask][i] === Infinity) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        if (j === 0) continue; // başlangıç tur boyunca yalnız başta
        const nc = C[mask][i] + leg(cities[i], cities[j], month).cost;
        if (nc < C[mask | (1 << j)][j]) {
          C[mask | (1 << j)][j] = nc;
          P[mask | (1 << j)][j] = i;
        }
      }
    }
  }
  let last = -1;
  let best = Infinity;
  const finalMask = full - 2; // 0 başlangıç dışındaki tüm düğümler
  for (let j = 1; j < n; j++) {
    const cand = C[finalMask][j] + leg(cities[j], cities[0], month).cost;
    if (cand < best) { best = cand; last = j; }
  }
  if (last === -1) return [0];
  const path: number[] = [];
  let mask = finalMask;
  let cur = last;
  while (cur !== -1) {
    path.push(cur);
    const prev = P[mask][cur];
    mask ^= 1 << cur;
    cur = prev;
  }
  return [0, ...path.reverse()];
}
function nnTwoOpt(cities: CityNode[], month: number) {
  const n = cities.length;
  const dist = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => leg(cities[i], cities[j], month).cost)
  );
  const order: number[] = [0];
  const used = new Set<number>([0]);
  for (let k = 1; k < n; k++) {
    const last = order[order.length - 1];
    let next = -1;
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (used.has(j)) continue;
      if (dist[last][j] < best) { best = dist[last][j]; next = j; }
    }
    if (next === -1) break;
    order.push(next);
    used.add(next);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = order[i - 1], b = order[i], c = order[j], d = order[(j + 1) % n];
        const before = dist[a][b] + dist[c][d];
        const after = dist[a][c] + dist[b][d];
        if (after + 1e-9 < before) {
          order.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return order;
}
function solveExact(c: CityNode[], m: number): number[] { return heldKarp(c, m); }
function solveHeuristic(c: CityNode[], m: number): number[] { return nnTwoOpt(c, m); }
function buildPlanPart(
  sorted: CityNode[],
  month: number,
  algorithm: RoutePlan["algorithm"]
): RoutePlan {
  let km = 0;
  const legs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const d = haversineKm(sorted[i].lat, sorted[i].lng, sorted[i + 1].lat, sorted[i + 1].lng);
    km += d;
    legs.push({ from: sorted[i].name, to: sorted[i + 1].name, km: Math.round(d), cost: flightCostEstimate(d) });
  }
  const wi = Math.round(sorted.reduce((s, c) => s + climateComfort(c.lat, month), 0) / sorted.length);
  return {
    order: sorted.map((c) => c.name),
    totalKm: Math.round(km),
    flightCostEstimate: legs.reduce((s, l) => s + l.cost, 0),
    weatherIndex: wi,
    algorithm,
    legs,
  };
}
export function optimizeRoute(
  cities: CityNode[],
  origin: CityNode | null,
  month: number
): RoutePlan {
  const nodes = origin ? [origin, ...cities] : [...cities];
  const n = nodes.length;
  if (n === 0) throw new Error("Şehir listesi boş");
  const order = n <= 8 ? solveExact(nodes, month) : solveHeuristic(nodes, month);
  const sorted = order.map((idx) => nodes[idx]);
  return buildPlanPart(sorted, month, n <= 8 ? "held-karp" : "nearest-neighbor+2opt");
}
