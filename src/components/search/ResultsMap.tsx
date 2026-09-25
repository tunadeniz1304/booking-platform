"use client";

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import Map, { Marker, NavigationControl, Popup, type MapRef } from "react-map-gl/maplibre";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { focusRing } from "@/components/ui/ui";
import {
  CLUSTER_MAX_ZOOM,
  boundsOf,
  buildClusterIndex,
  type Bounds,
} from "@/lib/search/map-cluster";

export interface MapPoint {
  id: string;
  title: string;
  city: string;
  latitude: number;
  longitude: number;
  priceLabel: string;
}

// MapLibre 6 worker'ı bundler dışından yüklenir (scripts/copy-maplibre-worker.mjs).
setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");

/** OSM raster karo stili (anahtar gerektirmez). */
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

class MapErrorBoundary extends Component<
  {
    fallback: ReactNode;
    children: ReactNode;
    onError: (reason: string) => void;
    initFailedMessage: string;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error.message || this.props.initFailedMessage);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Sonuç haritası (P1-2). İşaretçiler `supercluster` ile kümelenir; kümeye tıklamak
 * yakınlaştırır. `selectedId`/`onSelect` ile yan listeyle iki yönlü senkron çalışır
 * (işaretçi seçimi listeyi, liste seçimi haritayı vurgular ve oraya kaydırır).
 * Karo/WebGL yüklenemezse `onFail` çağrılır ve sayfa liste görünümüne döner.
 */
export default function ResultsMap({
  points,
  selectedId,
  onSelect,
  onFail,
}: {
  points: MapPoint[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onFail: (reason: string) => void;
}) {
  const t = useTranslations("search");
  const mapRef = useRef<MapRef>(null);
  // Üst bileşen her render'da yeni dizi verebilir → indeks içerik anahtarıyla önbelleklenir.
  const pointsKey = points.map((p) => `${p.id}:${p.latitude}:${p.longitude}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const index = useMemo(() => buildClusterIndex(points), [pointsKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialBounds = useMemo(() => boundsOf(points), [pointsKey]);
  const [view, setView] = useState<{ bounds: Bounds; zoom: number } | null>(null);

  const initialViewState = useMemo(
    () =>
      initialBounds
        ? {
            bounds: [
              [initialBounds[0], initialBounds[1]],
              [initialBounds[2], initialBounds[3]],
            ] as [[number, number], [number, number]],
            fitBoundsOptions: { padding: 40, maxZoom: 11 },
          }
        : { longitude: 32.85, latitude: 39.92, zoom: 4 },
    [initialBounds]
  );

  const syncView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    setView({
      bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      zoom: map.getZoom(),
    });
  }, []);

  const items = useMemo(() => (view ? index.items(view.bounds, view.zoom) : []), [index, view]);
  const selected = points.find((p) => p.id === selectedId) ?? null;

  // Listeden seçim → seçili nokta görünürde değilse / kümede kalıyorsa oraya uç.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) return;
    const hiddenInCluster = items.some(
      (item) => item.kind === "cluster" && item.memberIds.includes(selected.id)
    );
    const inView = map.getBounds().contains([selected.longitude, selected.latitude]);
    if (hiddenInCluster || !inView) {
      map.flyTo({
        center: [selected.longitude, selected.latitude],
        zoom: Math.max(map.getZoom(), CLUSTER_MAX_ZOOM + 1),
        duration: 600,
      });
    }
    // Yalnızca seçim değiştiğinde uç; kümeler her harekette yeniden hesaplanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const fallback = (
    <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-950">
      {t("mapView.fallback")}
    </p>
  );

  return (
    <MapErrorBoundary
      fallback={fallback}
      onError={onFail}
      initFailedMessage={t("mapView.initFailed")}
    >
      <div className="h-[480px] w-full overflow-hidden rounded-lg shadow-sm">
        <Map
          ref={mapRef}
          initialViewState={initialViewState}
          mapStyle={OSM_STYLE}
          style={{ width: "100%", height: "100%" }}
          onLoad={syncView}
          onMoveEnd={syncView}
          onError={(e) => {
            const msg = e.error?.message ?? t("mapView.error");
            // Karo erişimi yoksa (çevrimdışı) listeye dön.
            if (/fetch|network|tile|webgl|failed/i.test(msg)) onFail(msg);
          }}
        >
          <NavigationControl position="top-right" />
          {items.map((item) =>
            item.kind === "cluster" ? (
              <Marker
                key={`c-${item.clusterId}`}
                longitude={item.longitude}
                latitude={item.latitude}
                anchor="center"
              >
                <button
                  type="button"
                  onClick={() =>
                    mapRef.current?.flyTo({
                      center: [item.longitude, item.latitude],
                      zoom: item.expansionZoom,
                      duration: 500,
                    })
                  }
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold shadow ${
                    selectedId && item.memberIds.includes(selectedId)
                      ? "border-[#003580] bg-amber-300 text-gray-900"
                      : "border-white bg-[#003580] text-white"
                  } ${focusRing}`}
                  aria-label={t("mapView.cluster", { count: item.count })}
                >
                  {item.count}
                </button>
              </Marker>
            ) : (
              <Marker
                key={item.point.id}
                longitude={item.point.longitude}
                latitude={item.point.latitude}
                anchor="bottom"
                style={{ zIndex: item.point.id === selectedId ? 2 : 1 }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    // Tıklama haritaya ulaşırsa yeni açılan Popup'ı hemen kapatır.
                    e.stopPropagation();
                    onSelect(item.point.id);
                  }}
                  aria-pressed={item.point.id === selectedId}
                  className={`rounded-full px-2 py-1 text-xs font-semibold shadow ${
                    item.point.id === selectedId
                      ? "bg-amber-300 text-gray-900 ring-2 ring-[#003580]"
                      : "bg-[#003580] text-white"
                  } ${focusRing}`}
                  aria-label={`${item.point.title}, ${item.point.city}, ${item.point.priceLabel}`}
                >
                  {item.point.priceLabel}
                </button>
              </Marker>
            )
          )}
          {selected && (
            <Popup
              longitude={selected.longitude}
              latitude={selected.latitude}
              anchor="top"
              onClose={() => onSelect(null)}
              closeOnClick={false}
              closeButton
            >
              <div className="text-sm text-gray-900">
                <Link
                  href={`/property/${selected.id}`}
                  className={`font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {selected.title}
                </Link>
                <p>
                  {selected.city} · {selected.priceLabel}
                </p>
              </div>
            </Popup>
          )}
        </Map>
      </div>
    </MapErrorBoundary>
  );
}
