"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * Karşılaştırma çubuğundaki çipler için seçili ilanların başlıkları (F686). Seçim yalnızca
 * id tuttuğundan başlıklar herkese açık ilan uç noktasından alınır ve sayfa ömrü boyunca
 * bellekte tutulur; alınamayan ilan için `undefined` döner (çağıran yedek etiket gösterir).
 */
const EMPTY: Readonly<Record<string, string>> = {};
let titles: Readonly<Record<string, string>> = EMPTY;
const pending = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function load(id: string): void {
  if (titles[id] !== undefined || pending.has(id)) return;
  pending.add(id);
  apiFetch<{ title?: unknown }>(`/api/properties/${encodeURIComponent(id)}`)
    .then((property) => {
      if (typeof property.title !== "string") return;
      titles = { ...titles, [id]: property.title };
      listeners.forEach((l) => l());
    })
    .catch(() => {
      // Yayından kalkmış ilan ya da ağ hatası: yedek etiket kalır; seçim değişince yeniden denenir.
    })
    .finally(() => pending.delete(id));
}

export function useCompareListingTitles(ids: readonly string[]): Readonly<Record<string, string>> {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => titles,
    () => EMPTY
  );
  const key = ids.join(",");
  useEffect(() => {
    if (key) key.split(",").forEach(load);
  }, [key]);
  return snapshot;
}
