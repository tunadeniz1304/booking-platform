"use client";

import { Component, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import Map, { Marker, NavigationControl, Popup } from "react-map-gl/maplibre";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { focusRing } from "@/components/ui/ui";

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
  { fallback: ReactNode; children: ReactNode; onError: (reason: string) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error.message || "harita başlatılamadı");
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Sonuç haritası (P1-2). Karo/WebGL yüklenemezse `onFail` çağrılır ve sayfa liste
 * görünümüne döner (çevrimdışı çalışma bozulmaz). Kümeleme yok: demo veri küçük.
 */
export default function ResultsMap({
  points,
  onFail,
}: {
  points: MapPoint[];
  onFail: (reason: string) => void;
}) {
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const initialViewState = useMemo(() => {
    if (points.length === 0) return { longitude: 32.85, latitude: 39.92, zoom: 4 };
    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    return {
      bounds: [
        [Math.min(...lngs) - 0.5, Math.min(...lats) - 0.5],
        [Math.max(...lngs) + 0.5, Math.max(...lats) + 0.5],
      ] as [[number, number], [number, number]],
      fitBoundsOptions: { padding: 40, maxZoom: 11 },
    };
  }, [points]);

  const fallback = (
    <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-950">
      Harita yüklenemedi; liste görünümü kullanılıyor.
    </p>
  );

  return (
    <MapErrorBoundary fallback={fallback} onError={onFail}>
      <div className="h-[480px] w-full overflow-hidden rounded-lg shadow-sm">
        <Map
          initialViewState={initialViewState}
          mapStyle={OSM_STYLE}
          style={{ width: "100%", height: "100%" }}
          onError={(e) => {
            const msg = e.error?.message ?? "harita hatası";
            // Karo erişimi yoksa (çevrimdışı) listeye dön.
            if (/fetch|network|tile|webgl|failed/i.test(msg)) onFail(msg);
          }}
        >
          <NavigationControl position="top-right" />
          {points.map((p) => (
            <Marker key={p.id} longitude={p.longitude} latitude={p.latitude} anchor="bottom">
              <button
                type="button"
                onClick={() => setSelected(p)}
                className={`rounded-full bg-[#003580] px-2 py-1 text-xs font-semibold text-white shadow ${focusRing}`}
                aria-label={`${p.title}, ${p.city}, ${p.priceLabel}`}
              >
                {p.priceLabel}
              </button>
            </Marker>
          ))}
          {selected && (
            <Popup
              longitude={selected.longitude}
              latitude={selected.latitude}
              anchor="top"
              onClose={() => setSelected(null)}
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
