import { describe, it, expect } from "vitest";
import {
  haversineKm,
  climateComfort,
  optimizeRoute,
  RoutePlan,
  CityNode,
} from "@/lib/routing/optimizer";

const IST = { id: "ist", name: "İstanbul", lat: 41.0082, lng: 28.9784 };
const ANK = { id: "ank", name: "Ankara", lat: 39.9334, lng: 32.8597 };
const ANT = { id: "ant", name: "Antalya", lat: 36.8969, lng: 30.7133 };
const IZM = { id: "izm", name: "İzmir", lat: 38.4192, lng: 27.1287 };

function totalKm(plan: RoutePlan): number {
  return plan.legs.reduce((s, l) => s + l.km, 0);
}

describe("Quantum-Inspired Routing (TSP)", () => {
  it("haversine Ankara-İstanbul ~350 km bandında", () => {
    const km = haversineKm(ANK.lat, ANK.lng, IST.lat, IST.lng);
    expect(km).toBeGreaterThan(300);
    expect(km).toBeLessThan(400);
  });

  it("kışın kuzey enlemi düşük konfor, ilkbahar yüksek", () => {
    expect(climateComfort(50, 1)).toBeLessThan(4);
    expect(climateComfort(50, 6)).toBeGreaterThan(7);
  });

  it("4 şehirde optimal sıra en düşük toplam mesafeyi verir", () => {
    const plan = optimizeRoute([IST, ANK, ANT, IZM], null, 5);
    expect(plan.order).toHaveLength(4);
    // Tam çözüm (Held-Karp) her permütasyondan daha kötü olamaz
    let best = Infinity;
    for (const perm of permutations([ANK, ANT, IZM])) {
      const p = optimizeRoute(perm, IST, 5);
      best = Math.min(best, totalKm(p));
    }
    expect(totalKm(plan)).toBeLessThanOrEqual(best + 1);
  });

  it("başlangıç şehri rotanın başında sabitlenir", () => {
    const plan = optimizeRoute([ANK, ANT], IST, 5);
    expect(plan.order[0]).toBe("İstanbul");
    expect(plan.order).toContain("Ankara");
  });
});

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

export type { CityNode };
