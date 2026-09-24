import Supercluster from "supercluster";

/**
 * Harita işaretçi kümelemesi (P1-2): `supercluster` ile saf, DOM'suz yardımcı.
 * Aynı girdi + aynı görünüm → aynı küme listesi (deterministik).
 */

export interface GeoPoint {
  id: string;
  latitude: number;
  longitude: number;
}

/** [batı, güney, doğu, kuzey] — MapLibre `getBounds().toArray().flat()` sırası. */
export type Bounds = [number, number, number, number];

export type MapItem<P extends GeoPoint> =
  | {
      kind: "cluster";
      clusterId: number;
      latitude: number;
      longitude: number;
      count: number;
      /** Tıklanınca kümenin açıldığı zoom. */
      expansionZoom: number;
      /** Kümedeki nokta kimlikleri (seçili noktanın hangi kümede olduğunu vurgulamak için). */
      memberIds: string[];
    }
  | { kind: "point"; point: P };

export const CLUSTER_RADIUS_PX = 60;
export const CLUSTER_MAX_ZOOM = 14;

export interface ClusterIndex<P extends GeoPoint> {
  items(bounds: Bounds, zoom: number): MapItem<P>[];
}

export function buildClusterIndex<P extends GeoPoint>(points: readonly P[]): ClusterIndex<P> {
  const index = new Supercluster<{ id: string }>({
    radius: CLUSTER_RADIUS_PX,
    maxZoom: CLUSTER_MAX_ZOOM,
  });
  const byId = new Map(points.map((p) => [p.id, p]));
  index.load(
    points.map((p) => ({
      type: "Feature" as const,
      properties: { id: p.id },
      geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] },
    }))
  );

  return {
    items(bounds, zoom) {
      const z = Math.max(0, Math.min(Math.floor(zoom), CLUSTER_MAX_ZOOM + 1));
      const items: MapItem<P>[] = [];
      for (const feature of index.getClusters(bounds, z)) {
        const [longitude, latitude] = feature.geometry.coordinates;
        const props = feature.properties;
        if ("cluster" in props && props.cluster) {
          items.push({
            kind: "cluster",
            clusterId: props.cluster_id,
            latitude,
            longitude,
            count: props.point_count,
            expansionZoom: Math.min(
              index.getClusterExpansionZoom(props.cluster_id),
              CLUSTER_MAX_ZOOM + 1
            ),
            memberIds: index
              .getLeaves(props.cluster_id, Infinity)
              .map((leaf) => (leaf.properties as { id: string }).id),
          });
        } else {
          const point = byId.get((props as { id: string }).id);
          if (point) items.push({ kind: "point", point });
        }
      }
      // Deterministik çizim sırası: kümeler önce (büyükten küçüğe), sonra noktalar id'ye göre.
      return items.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "cluster" ? -1 : 1;
        if (a.kind === "cluster" && b.kind === "cluster") {
          return b.count - a.count || a.clusterId - b.clusterId;
        }
        return (a as { point: P }).point.id.localeCompare((b as { point: P }).point.id);
      });
    },
  };
}

/** Noktaları kapsayan sınır (+ kenar payı); boş listede null. */
export function boundsOf(points: readonly GeoPoint[], pad = 0.5): Bounds | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  return [
    Math.min(...lngs) - pad,
    Math.min(...lats) - pad,
    Math.max(...lngs) + pad,
    Math.max(...lats) + pad,
  ];
}
