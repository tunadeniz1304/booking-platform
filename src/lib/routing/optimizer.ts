/**
 * Çok şehirli seyahat rotası optimizasyonu (klasik kombinatorik optimizasyon;
 * kuantum esinli bir yöntem değildir; bkz. docs/METHODOLOGY.md).
 *
 * Problem: başlangıç şehri sabit, diğer şehirleri hangi sırayla gezmeli ki toplam
 * yolculuk maliyeti en düşük olsun? Varsayılan AÇIK YOL (dönüş bacağı yok);
 * `returnToOrigin: true` ile kapalı tur.
 *
 *  - n ≤ EXACT_LIMIT: Held-Karp dinamik programlama, O(n²·2ⁿ) — kesin optimum.
 *  - n > EXACT_LIMIT: en yakın komşu + yerel arama (2-opt ters çevirme ve or-opt
 *    taşıma). Her hamle TÜM yol maliyeti yeniden hesaplanarak değerlendirilir; bu
 *    yüzden asimetrik maliyetlerde de doğrudur (klasik 2-opt delta formülü değil).
 *
 * Bacak maliyeti = mesafe + 0.4 × uçuş tahmini, varış şehrinin mevsim konforuna göre
 * düzeltilmiş (asimetrik: A→B ≠ B→A).
 */
import { getConfig } from "@/lib/config/app-config";

export interface CityNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  nights?: number;
}

export interface RouteLeg {
  from: string;
  to: string;
  km: number;
  cost: number;
}

export interface RoutePlan {
  order: string[];
  totalKm: number;
  flightCostEstimate: number;
  weatherIndex: number;
  algorithm: "held-karp" | "nearest-neighbor+local-search";
  returnToOrigin: boolean;
  totalCost: number;
  legs: RouteLeg[];
}

export const EXACT_LIMIT = 10;

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

/** Tahmini uçuş maliyeti (config: ROUTING_FLIGHT_COST_PER_KM × km + ROUTING_FLIGHT_COST_BASE). */
export function flightCostEstimate(km: number): number {
  const c = getConfig();
  return Math.round(km * c.ROUTING_FLIGHT_COST_PER_KM + c.ROUTING_FLIGHT_COST_BASE);
}

/** Enlem ve AY (1–12) için 0–10 konfor puanı (basit iklim kuşağı modeli). */
export function climateComfort(lat: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("Ay 1–12 aralığında olmalı");
  }
  const abs = Math.abs(lat);
  if (abs < 23) return month >= 6 && month <= 8 ? 6 : 8;
  if (abs <= 45) {
    if (month >= 4 && month <= 6) return 9;
    if (month >= 7 && month <= 8) return 7;
    if (month === 12 || month <= 2) return 4;
    return 8;
  }
  return month >= 6 && month <= 8 ? 9 : month === 12 || month <= 2 ? 2 : 6;
}

/** A→B bacak maliyeti (asimetrik: varış şehrinin konforu uygulanır). */
export function legCost(a: CityNode, b: CityNode, month: number): { km: number; cost: number } {
  const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
  const comfortPenalty = (5 - climateComfort(b.lat, month)) * 0.02;
  return { km, cost: km * (1 + comfortPenalty) + flightCostEstimate(km) * 0.4 };
}

type Matrix = number[][];

function costMatrix(nodes: CityNode[], month: number): Matrix {
  return nodes.map((a, i) => nodes.map((b, j) => (i === j ? 0 : legCost(a, b, month).cost)));
}

export function pathCost(order: number[], m: Matrix, closed: boolean): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) total += m[order[i]][order[i + 1]];
  if (closed && order.length > 1) total += m[order[order.length - 1]][order[0]];
  return total;
}

/** Held-Karp: 0 sabit başlangıç, açık yol veya kapalı tur. */
function heldKarp(m: Matrix, closed: boolean): number[] {
  const n = m.length;
  if (n === 1) return [0];
  const full = 1 << n;
  const C = Array.from({ length: full }, () => new Float64Array(n).fill(Infinity));
  const P = Array.from({ length: full }, () => new Int8Array(n).fill(-1));
  C[1][0] = 0;
  for (let mask = 1; mask < full; mask += 2) {
    for (let i = 0; i < n; i++) {
      const base = C[mask][i];
      if (base === Infinity) continue;
      for (let j = 1; j < n; j++) {
        if (mask & (1 << j)) continue;
        const next = mask | (1 << j);
        const c = base + m[i][j];
        if (c < C[next][j]) {
          C[next][j] = c;
          P[next][j] = i;
        }
      }
    }
  }
  const last = full - 1;
  let best = Infinity;
  let end = 1;
  for (let j = 1; j < n; j++) {
    const c = C[last][j] + (closed ? m[j][0] : 0);
    if (c < best) {
      best = c;
      end = j;
    }
  }
  const path: number[] = [];
  let mask = last;
  let cur = end;
  while (cur !== -1) {
    path.push(cur);
    const prev = P[mask][cur];
    mask ^= 1 << cur;
    cur = prev;
  }
  return path.reverse();
}

/** En yakın komşu + (2-opt ters çevirme, or-opt taşıma) yerel arama; tam maliyet değerlendirmesi. */
function heuristic(m: Matrix, closed: boolean): number[] {
  const n = m.length;
  const order = [0];
  const used = new Set([0]);
  while (order.length < n) {
    const last = order[order.length - 1];
    let next = -1;
    for (let j = 0; j < n; j++)
      if (!used.has(j) && (next === -1 || m[last][j] < m[last][next])) next = j;
    order.push(next);
    used.add(next);
  }
  let best = pathCost(order, m, closed);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1 && !improved; i++) {
      for (let j = i + 1; j < n && !improved; j++) {
        const reversed = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        const c = pathCost(reversed, m, closed);
        if (c + 1e-9 < best) {
          order.splice(0, n, ...reversed);
          best = c;
          improved = true;
        }
      }
    }
    for (let len = 1; len <= 3 && !improved; len++) {
      for (let i = 1; i + len <= n && !improved; i++) {
        const segment = order.slice(i, i + len);
        const rest = [...order.slice(0, i), ...order.slice(i + len)];
        for (let k = 1; k <= rest.length && !improved; k++) {
          if (k === i) continue;
          const candidate = [...rest.slice(0, k), ...segment, ...rest.slice(k)];
          const c = pathCost(candidate, m, closed);
          if (c + 1e-9 < best) {
            order.splice(0, n, ...candidate);
            best = c;
            improved = true;
          }
        }
      }
    }
  }
  return order;
}

export function optimizeRoute(
  cities: CityNode[],
  origin: CityNode | null,
  month: number,
  opts: { returnToOrigin?: boolean } = {}
): RoutePlan {
  const nodes = origin ? [origin, ...cities] : [...cities];
  if (nodes.length === 0) throw new Error("Şehir listesi boş");
  climateComfort(0, month); // ay doğrulaması
  const closed = opts.returnToOrigin ?? false;
  const m = costMatrix(nodes, month);
  const exact = nodes.length <= EXACT_LIMIT;
  const idx = exact ? heldKarp(m, closed) : heuristic(m, closed);
  const sequence = closed && idx.length > 1 ? [...idx, idx[0]] : idx;

  const legs: RouteLeg[] = [];
  for (let i = 0; i < sequence.length - 1; i++) {
    const a = nodes[sequence[i]];
    const b = nodes[sequence[i + 1]];
    const { km, cost } = legCost(a, b, month);
    legs.push({ from: a.name, to: b.name, km: Math.round(km), cost: Math.round(cost) });
  }
  const visited = idx.map((i) => nodes[i]);
  return {
    order: visited.map((c) => c.name),
    totalKm: legs.reduce((s, l) => s + l.km, 0),
    flightCostEstimate: legs.reduce((s, l) => s + flightCostEstimate(l.km), 0),
    weatherIndex: Math.round(
      visited.reduce((s, c) => s + climateComfort(c.lat, month), 0) / visited.length
    ),
    algorithm: exact ? "held-karp" : "nearest-neighbor+local-search",
    returnToOrigin: closed,
    totalCost: Math.round(pathCost(idx, m, closed)),
    legs,
  };
}
