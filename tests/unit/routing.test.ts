import { describe, it, expect } from "vitest";
import {
  climateComfort,
  EXACT_LIMIT,
  haversineKm,
  legCost,
  optimizeRoute,
  type CityNode,
} from "@/lib/routing/optimizer";

const IST = { id: "ist", name: "İstanbul", lat: 41.0082, lng: 28.9784 };
const ANK = { id: "ank", name: "Ankara", lat: 39.9334, lng: 32.8597 };
const ANT = { id: "ant", name: "Antalya", lat: 36.8969, lng: 30.7133 };
const IZM = { id: "izm", name: "İzmir", lat: 38.4192, lng: 27.1287 };
const KAP = { id: "kap", name: "Nevşehir", lat: 38.6244, lng: 34.7144 };

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])
  );
}

function cost(path: CityNode[], month: number, closed = false): number {
  let c = 0;
  for (let i = 0; i < path.length - 1; i++) c += legCost(path[i], path[i + 1], month).cost;
  if (closed) c += legCost(path[path.length - 1], path[0], month).cost;
  return c;
}

describe("regression: #12 çok şehirli rota optimizasyonu", () => {
  it("haversine Ankara-İstanbul ~350 km", () => {
    const km = haversineKm(ANK.lat, ANK.lng, IST.lat, IST.lng);
    expect(km).toBeGreaterThan(300);
    expect(km).toBeLessThan(400);
  });

  it("ay 1–12: kış düşük, ilkbahar yüksek konfor; 0 ve 13 reddedilir", () => {
    expect(climateComfort(50, 1)).toBeLessThan(4);
    expect(climateComfort(50, 6)).toBeGreaterThan(7);
    expect(() => climateComfort(40, 0)).toThrow(RangeError);
    expect(() => climateComfort(40, 13)).toThrow(RangeError);
  });

  it("açık yol: Held-Karp tüm permütasyonlardan kötü değildir ve raporlanan bacaklar yolla aynıdır", () => {
    const month = 5;
    const plan = optimizeRoute([ANK, ANT, IZM, KAP], IST, month);
    const best = Math.min(
      ...permutations([ANK, ANT, IZM, KAP]).map((p) => cost([IST, ...p], month))
    );
    expect(plan.totalCost).toBeLessThanOrEqual(Math.round(best) + 1);
    expect(plan.order[0]).toBe("İstanbul");
    expect(plan.legs).toHaveLength(4); // dönüş bacağı YOK
    expect(plan.legs.map((l) => l.from)).toEqual(plan.order.slice(0, -1));
    expect(plan.returnToOrigin).toBe(false);
  });

  it("kapalı tur isteğe bağlı: son bacak başlangıca döner", () => {
    const plan = optimizeRoute([ANK, ANT], IST, 5, { returnToOrigin: true });
    expect(plan.legs).toHaveLength(3);
    expect(plan.legs.at(-1)?.to).toBe("İstanbul");
  });

  it("maliyet asimetrik; sezgisel yöntem büyük n'de de brute-force'a yakın ve geçerli permütasyon", () => {
    const MOS = { id: "mos", name: "Moskova", lat: 55.75, lng: 37.62 };
    expect(legCost(IST, MOS, 1).cost).not.toBeCloseTo(legCost(MOS, IST, 1).cost, 3);
    const extra: CityNode[] = Array.from({ length: EXACT_LIMIT + 1 }, (_, i) => ({
      id: `c${i}`,
      name: `Şehir${i}`,
      lat: 36 + ((i * 37) % 7),
      lng: 26 + ((i * 53) % 18),
    }));
    const plan = optimizeRoute(extra, IST, 7);
    expect(plan.algorithm).toBe("nearest-neighbor+local-search");
    expect(new Set(plan.order).size).toBe(extra.length + 1);
    expect(plan.order[0]).toBe("İstanbul");
  });
});

describe("rota şehir eşleştirme anahtarı (Türkçe İ/ı)", () => {
  it("PARIS/Paris, ISTANBUL/İstanbul/istanbul aynı anahtar", async () => {
    const { cityKey: norm } = await import("@/lib/routing/city-key");
    expect(norm("PARIS")).toBe(norm("Paris"));
    expect(norm("ISTANBUL")).toBe(norm("İstanbul"));
    expect(norm("istanbul")).toBe(norm("İSTANBUL"));
    expect(norm("  Kuşadası ")).toBe(norm("KUŞADASI"));
  });
});
