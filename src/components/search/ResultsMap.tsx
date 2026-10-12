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
import CompareToggle from "@/components/compare/CompareToggle";
import RatingBadge from "@/components/property/RatingBadge";
import { propertyHref, type SearchContext } from "@/components/property/PropertyCard";
import {
  CLUSTER_MAX_ZOOM,
  boundsOf,
  buildClusterIndex,
  type Bounds,
  type MapItem,
} from "@/lib/search/map-cluster";

export interface MapPoint {
  id: string;
  title: string;
  city: string;
  latitude: number;
  longitude: number;
  priceLabel: string;
  /** Hazır ilan bağlantısı (tarih/misafir/oda bağlamıyla); yoksa `searchContext` ile kurulur. */
  href?: string;
  /** F715: popup'ta gösterilecek ortalama puan (yalnızca `reviewCount` > 0 ise). */
  rating?: number;
  reviewCount?: number;
}

/** F710: art arda bu kadar karo hatası olursa harita bırakılıp listeye dönülür. */
const TILE_ERROR_LIMIT = 5;

/** F709: dokunmatik ekranda yakınlaştırma ve popup kapatma düğmeleri en az 44px. */
const TOUCH_CONTROLS = [
  "max-lg:[&_.maplibregl-ctrl-group_button]:size-11",
  "max-lg:[&_.maplibregl-popup-close-button]:size-11",
  "max-lg:[&_.maplibregl-popup-close-button]:text-xl",
].join(" ");

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
  searchContext,
  resultsListId,
}: {
  points: MapPoint[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onFail: (reason: string) => void;
  /** Popup'taki ilan bağlantısına taşınacak arama tarih/misafir bilgisi (F93/F202). */
  searchContext?: SearchContext;
  /** F711: verilirse haritadan önce bu kimlikli eşdeğer sonuç listesine atlama bağlantısı çıkar. */
  resultsListId?: string;
}) {
  const t = useTranslations("search");
  const mapRef = useRef<MapRef>(null);
  // F208: popup'ı açan öğe (işaretçi ya da yan liste düğmesi); kapanınca odak oraya döner.
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  // İşaretçiyle seçildiyse ilk odak popup'taki bağlantıya taşınır.
  const focusPopupRef = useRef(false);
  // F92: MapLibre'nin yerleşik denetim etiketleri arayüz dilinde.
  const mapLocale = useMemo(
    () => ({
      "Map.Title": t("mapView.title"),
      "NavigationControl.ZoomIn": t("mapView.zoomIn"),
      "NavigationControl.ZoomOut": t("mapView.zoomOut"),
      "NavigationControl.ResetBearing": t("mapView.resetBearing"),
      "Popup.Close": t("mapView.closePopup"),
      "AttributionControl.ToggleAttribution": t("mapView.toggleAttribution"),
      "AttributionControl.MapFeedback": t("mapView.mapFeedback"),
      "Marker.Title": t("mapView.marker"),
      // F484/F708: tek parmak sayfayı kaydırır; ipucu metinleri de arayüz dilinde.
      "CooperativeGesturesHandler.WindowsHelpText": t("mapView.cooperativeWindows"),
      "CooperativeGesturesHandler.MacHelpText": t("mapView.cooperativeMac"),
      "CooperativeGesturesHandler.MobileHelpText": t("mapView.cooperativeMobile"),
    }),
    [t]
  );
  // F707: karolar yüklenene kadar görünür durum; ardından ekran okuyucuya "yüklendi".
  const [ready, setReady] = useState(false);
  // F710: tekil karo hataları haritayı kapatmaz; yalnızca art arda hatalar ya da hiç karo yoksa.
  const tileLoadedRef = useRef(false);
  const tileErrorsRef = useRef(0);
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

  // F711: işaretçiler (ve sekme sırası) yan listeyle aynı sırada; küme, en öndeki üyesinin yerinde.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const listOrder = useMemo(() => Object.fromEntries(points.map((p, i) => [p.id, i])), [pointsKey]);
  const items = useMemo(() => {
    if (!view) return [];
    const rank = (item: MapItem<MapPoint>) =>
      item.kind === "cluster"
        ? Math.min(...item.memberIds.map((id) => listOrder[id] ?? Infinity))
        : (listOrder[item.point.id] ?? Infinity);
    return index
      .items(view.bounds, view.zoom)
      .map((item) => ({ item, rank: rank(item) }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ item }) => item);
  }, [index, view, listOrder]);
  const selected = points.find((p) => p.id === selectedId) ?? null;

  // Seçim değişince tetikleyen öğeyi sakla (popup odak çalmadığı için hâlâ odakta).
  useEffect(() => {
    if (!selectedId) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !active.closest(".maplibregl-popup")
    ) {
      lastTriggerRef.current = active;
    }
  }, [selectedId]);

  const closePopup = () => {
    onSelect(null);
    const trigger = lastTriggerRef.current;
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

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
    <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-950">
      {t("mapView.fallback")}
    </p>
  );

  // F714: Escape açık ayrıntıyı kapatır; odak popup'taysa onu açan öğeye döner.
  const onMapKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !selectedId) return;
    if (e.target instanceof Element && e.target.closest(".maplibregl-popup")) closePopup();
    else onSelect(null);
  };

  return (
    <MapErrorBoundary
      fallback={fallback}
      onError={onFail}
      initFailedMessage={t("mapView.initFailed")}
    >
      {resultsListId && (
        <a
          href={`#${resultsListId}`}
          className={`mb-2 inline-flex min-h-[44px] items-center text-sm font-medium text-blue-700 underline lg:sr-only lg:focus:not-sr-only ${focusRing}`}
        >
          {t("mapView.skipToList")}
        </a>
      )}
      <div
        className={`relative h-[50svh] max-h-[480px] min-h-[280px] w-full overflow-hidden rounded-lg shadow-sm lg:h-[480px] ${TOUCH_CONTROLS}`}
        onKeyDown={onMapKeyDown}
      >
        <Map
          ref={mapRef}
          initialViewState={initialViewState}
          mapStyle={OSM_STYLE}
          style={{ width: "100%", height: "100%" }}
          locale={mapLocale}
          cooperativeGestures
          // F707: işaretçiler karoları beklemeden ilk karede çizilir.
          onRender={view ? undefined : syncView}
          onLoad={() => {
            syncView();
            setReady(true);
            // İlk görünümdeki karoların hiçbiri gelmediyse (çevrimdışı) listeye dön.
            if (!tileLoadedRef.current && tileErrorsRef.current > 0) onFail(t("mapView.error"));
          }}
          onMoveEnd={syncView}
          onSourceData={(e) => {
            if (!e.tile) return;
            tileLoadedRef.current = true;
            tileErrorsRef.current = 0;
          }}
          onError={(e) => {
            const msg = e.error?.message || t("mapView.error");
            if ("tile" in e && e.tile) {
              tileErrorsRef.current += 1;
              if (tileErrorsRef.current >= TILE_ERROR_LIMIT) onFail(msg);
              return;
            }
            // Harita kurulamadı (WebGL yok vb.; kurulum hatasında `target` boştur).
            if (!e.target || /webgl/i.test(msg)) onFail(msg);
          }}
          onClick={(e) => {
            // F714: haritanın boş yerine dokunmak ayrıntıyı kapatır (işaretçi/popup hariç).
            if (selectedId && e.originalEvent.target === e.target.getCanvas()) onSelect(null);
          }}
        >
          <NavigationControl position="top-right" />
          {items.map((item) => {
            if (item.kind === "cluster") {
              // F712: seçili ilanı içeren küme renge ek olarak simge ve etiketle belirtilir.
              const holdsSelected = selectedId !== null && item.memberIds.includes(selectedId);
              const labelKey = holdsSelected ? "mapView.clusterSelected" : "mapView.cluster";
              return (
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
                    className={`flex h-10 items-center justify-center rounded-full border-2 text-sm font-bold shadow ${
                      holdsSelected
                        ? "min-w-10 gap-0.5 border-[#003580] bg-amber-300 px-2 text-gray-900"
                        : "w-10 border-white bg-[#003580] text-white"
                    } ${focusRing}`}
                    aria-label={t(labelKey, { count: item.count })}
                  >
                    {holdsSelected && (
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-3.5 w-3.5 shrink-0"
                      >
                        <path
                          fillRule="evenodd"
                          clipRule="evenodd"
                          d="M10 18s6-5.69 6-10a6 6 0 1 0-12 0c0 4.31 6 10 6 10Zm0-7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                        />
                      </svg>
                    )}
                    {item.count}
                  </button>
                </Marker>
              );
            }
            const isSelected = item.point.id === selectedId;
            return (
              <Marker
                key={item.point.id}
                longitude={item.point.longitude}
                latitude={item.point.latitude}
                anchor="bottom"
                style={{ zIndex: isSelected ? 2 : 1 }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    // Tıklama haritaya ulaşırsa yeni açılan Popup'ı hemen kapatır.
                    e.stopPropagation();
                    // F713: aria-pressed aç/kapa; seçiliyken tekrar basmak seçimi kaldırır.
                    if (isSelected) {
                      onSelect(null);
                      return;
                    }
                    lastTriggerRef.current = e.currentTarget;
                    focusPopupRef.current = true;
                    onSelect(item.point.id);
                  }}
                  aria-pressed={isSelected}
                  className={`rounded-full px-2 py-1 text-xs font-semibold shadow ${
                    isSelected
                      ? "bg-amber-300 text-gray-900 ring-2 ring-[#003580]"
                      : "bg-[#003580] text-white"
                  } ${focusRing}`}
                  aria-label={`${item.point.title}, ${item.point.city}, ${item.point.priceLabel}`}
                >
                  {item.point.priceLabel}
                </button>
              </Marker>
            );
          })}
          {selected && (
            <Popup
              longitude={selected.longitude}
              latitude={selected.latitude}
              anchor="top"
              className="results-popup"
              onClose={closePopup}
              closeOnClick={false}
              closeButton
              focusAfterOpen={false}
            >
              <div className="text-sm text-gray-900 max-lg:pr-9">
                <Link
                  ref={(el) => {
                    if (el && focusPopupRef.current) {
                      focusPopupRef.current = false;
                      el.focus();
                    }
                  }}
                  href={selected.href ?? propertyHref(selected.id, searchContext)}
                  className={`font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {selected.title}
                </Link>
                <p>
                  {selected.city} · {selected.priceLabel}
                </p>
                {/* F715: harita görünümünde de puan ve karşılaştırma. */}
                {selected.reviewCount !== undefined && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2">
                    {selected.reviewCount > 0 && selected.rating !== undefined ? (
                      <>
                        <RatingBadge value={selected.rating} size="sm" />
                        <span>{t("card.reviews", { count: selected.reviewCount })}</span>
                      </>
                    ) : (
                      t("card.noRating")
                    )}
                  </p>
                )}
                <CompareToggle propertyId={selected.id} />
              </div>
            </Popup>
          )}
        </Map>
        <p
          role="status"
          className={
            ready
              ? "sr-only"
              : "pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded-full bg-white px-3 py-1 text-sm text-gray-900 shadow"
          }
        >
          {ready ? t("mapView.ready", { count: points.length }) : t("mapLoading")}
        </p>
      </div>
    </MapErrorBoundary>
  );
}
