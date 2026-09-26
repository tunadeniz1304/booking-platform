"use client";

/**
 * Sayfa içi tarih seçimi köprüsü (v4 P1-3): fiyat takvimi seçilen tarihleri yayınlar,
 * rezervasyon formu (`BookingWidget`) dinleyip kendi durumunu günceller. İki bileşen
 * sunucu sayfasında ayrı ağaçlarda olduğundan paylaşılan durum yerine DOM olayı kullanılır.
 */
export const STAY_SELECTION_EVENT = "booking:stay-selection";

export interface StaySelection {
  checkIn: string;
  checkOut: string;
}

export function publishStaySelection(selection: StaySelection): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StaySelection>(STAY_SELECTION_EVENT, { detail: selection }));
}

/** Abone olur; aboneliği bırakan fonksiyonu döner. */
export function subscribeStaySelection(handler: (selection: StaySelection) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<StaySelection>).detail;
    if (detail?.checkIn && detail.checkOut && detail.checkIn < detail.checkOut) handler(detail);
  };
  window.addEventListener(STAY_SELECTION_EVENT, listener);
  return () => window.removeEventListener(STAY_SELECTION_EVENT, listener);
}
