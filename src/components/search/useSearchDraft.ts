"use client";

import { useSyncExternalStore } from "react";

/**
 * Arama formunda o an seçili ölçütler (F1282). SearchBar yayınlar; aynı sayfadaki destinasyon ve
 * öne çıkan kartları bağlantılarına ekler. Böylece tarih/kişi seçip karta tıklayan misafirin
 * seçimi kaybolmaz.
 */
export interface SearchDraft {
  /** ISO tarih (YYYY-MM-DD) ya da boş. */
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}

let draft: SearchDraft | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => draft;
const getServerSnapshot = () => null;

/** Formun güncel ölçütlerini paylaşır; form kalkınca `null` verilir. */
export function publishSearchDraft(next: SearchDraft | null): void {
  if (
    draft === next ||
    (draft &&
      next &&
      draft.checkIn === next.checkIn &&
      draft.checkOut === next.checkOut &&
      draft.adults === next.adults &&
      draft.children === next.children)
  ) {
    return;
  }
  draft = next;
  for (const listener of listeners) listener();
}

/** Yayınlanmış arama ölçütleri; sunucuda, hidrasyonda ve form yokken `null`. */
export function useSearchDraft(): SearchDraft | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Tarihler yalnız ikisi birlikte seçiliyse taşınır; aksi halde `null` döner. */
export function draftDates(
  value: SearchDraft | null
): Pick<SearchDraft, "checkIn" | "checkOut"> | null {
  return value?.checkIn && value.checkOut
    ? { checkIn: value.checkIn, checkOut: value.checkOut }
    : null;
}

/** Arama sonuç bağlantısı: SearchBar'ın gönderdiği sorguyla aynı biçim. */
export function searchHrefWithDraft(destination: string, value: SearchDraft | null): string {
  const params = new URLSearchParams();
  params.set("destination", destination);
  if (value) {
    const dates = draftDates(value);
    if (dates) {
      params.set("checkIn", dates.checkIn);
      params.set("checkOut", dates.checkOut);
    }
    params.set("guests", String(value.adults + value.children));
    params.set("adults", String(value.adults));
    if (value.children > 0) params.set("children", String(value.children));
  }
  return `/search?${params.toString()}`;
}
