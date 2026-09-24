import { describe, it, expect } from "vitest";
import {
  CLUSTER_MAX_ZOOM,
  boundsOf,
  buildClusterIndex,
  type Bounds,
  type GeoPoint,
} from "@/lib/search/map-cluster";

// İstanbul'da birbirine yakın 3 mülk + İzmir'de 1 mülk.
const points: GeoPoint[] = [
  { id: "ist-1", latitude: 41.0082, longitude: 28.9784 },
  { id: "ist-2", latitude: 41.0102, longitude: 28.9804 },
  { id: "ist-3", latitude: 41.0062, longitude: 28.9764 },
  { id: "izm-1", latitude: 38.4237, longitude: 27.1428 },
];
const WORLD: Bounds = [-180, -85, 180, 85];

describe("harita kümelemesi (P1-2, supercluster)", () => {
  it("uzak zoom'da yakın noktalar tek kümede toplanır; toplam nokta sayısı korunur", () => {
    const items = buildClusterIndex(points).items(WORLD, 5);
    const cluster = items.find((i) => i.kind === "cluster");
    expect(cluster).toMatchObject({ kind: "cluster", count: 3 });
    if (cluster?.kind === "cluster") {
      expect([...cluster.memberIds].sort()).toEqual(["ist-1", "ist-2", "ist-3"]);
      expect(cluster.expansionZoom).toBeGreaterThan(5);
      expect(cluster.expansionZoom).toBeLessThanOrEqual(CLUSTER_MAX_ZOOM + 1);
    }
    const total = items.reduce((n, i) => n + (i.kind === "cluster" ? i.count : 1), 0);
    expect(total).toBe(points.length);
    expect(
      items.filter((i) => i.kind === "point").map((i) => i.kind === "point" && i.point.id)
    ).toEqual(["izm-1"]);
  });

  it("maksimum zoom'un üstünde her nokta tek tek görünür (liste ile birebir)", () => {
    const items = buildClusterIndex(points).items(WORLD, CLUSTER_MAX_ZOOM + 3);
    expect(items.every((i) => i.kind === "point")).toBe(true);
    expect(items.map((i) => (i.kind === "point" ? i.point.id : "")).sort()).toEqual(
      points.map((p) => p.id).sort()
    );
  });

  it("görünür sınırın dışındaki noktalar dönmez", () => {
    const istanbulOnly: Bounds = [28.5, 40.8, 29.5, 41.3];
    const items = buildClusterIndex(points).items(istanbulOnly, CLUSTER_MAX_ZOOM + 1);
    expect(items.map((i) => (i.kind === "point" ? i.point.id : "")).sort()).toEqual([
      "ist-1",
      "ist-2",
      "ist-3",
    ]);
  });

  it("deterministik: aynı girdi ve görünüm → aynı sıra; girdi sırası sonucu değiştirmez", () => {
    const a = buildClusterIndex(points).items(WORLD, 5);
    const b = buildClusterIndex([...points].reverse()).items(WORLD, 5);
    const shape = (items: typeof a) =>
      items.map((i) => (i.kind === "cluster" ? `c${i.count}` : i.point.id));
    expect(shape(a)).toEqual(shape(b));
    expect(buildClusterIndex(points).items(WORLD, 5)).toEqual(a);
  });

  it("orijinal nokta nesnesi (fiyat etiketi vb. ekstra alanlarla) aynen döner", () => {
    const rich = points.map((p) => ({ ...p, priceLabel: `₺${p.id}` }));
    const items = buildClusterIndex(rich).items(WORLD, CLUSTER_MAX_ZOOM + 1);
    const first = items.find((i) => i.kind === "point");
    expect(first?.kind === "point" && first.point.priceLabel).toMatch(/^₺/);
  });

  it("boundsOf kenar paylı sınır verir; boş listede null", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf(points, 0)).toEqual([27.1428, 38.4237, 28.9804, 41.0102]);
    const padded = boundsOf(points)!;
    expect(padded[0]).toBeCloseTo(26.6428);
    expect(padded[3]).toBeCloseTo(41.5102);
  });
});
