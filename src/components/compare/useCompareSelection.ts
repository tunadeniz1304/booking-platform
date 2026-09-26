"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Karşılaştırma seçimi (v4 P1-9): tarayıcıda yerel kolaylık; sunucuya gitmez. */
export const COMPARE_MAX = 4;
const KEY = "compare:ids";
const EVENT = "compare:changed";
const EMPTY: string[] = [];

let memory: string | null = null;
let cache: { raw: string | null; ids: string[] } = { raw: null, ids: EMPTY };

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memory; // depolama kapalı: yalnızca sayfa ömrü boyunca
  }
}

function parse(raw: string | null): string[] {
  try {
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids)
      ? ids.filter((x): x is string => typeof x === "string").slice(0, COMPARE_MAX)
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

function snapshot(): string[] {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, ids: parse(raw) };
  return cache.ids;
}

function write(ids: string[]): void {
  const raw = JSON.stringify(ids);
  memory = raw;
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    // yok say
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useCompareSelection() {
  const ids = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const toggle = useCallback((id: string) => {
    const current = snapshot();
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : current.length >= COMPARE_MAX
        ? current
        : [...current, id];
    write(next);
  }, []);
  const clear = useCallback(() => write([]), []);
  return { ids, toggle, clear, full: ids.length >= COMPARE_MAX };
}
