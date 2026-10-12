"use client";

/**
 * Fiyat takviminde "Seçimi temizle" olayı: rezervasyon formu (`BookingWidget`) dinleyip takvimin
 * yayınladığı (ör. ilk tıklamadaki geçici) tarihleri geri alabilir. Seçim olayı
 * (`stay-selection`) yalnız geçerli aralık taşıdığından temizleme ayrı bir olaydır.
 */
export const STAY_SELECTION_CLEAR_EVENT = "booking:stay-selection-clear";

export function publishStaySelectionClear(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STAY_SELECTION_CLEAR_EVENT));
}

/** Abone olur; aboneliği bırakan fonksiyonu döner. */
export function subscribeStaySelectionClear(handler: () => void): () => void {
  const listener = () => handler();
  window.addEventListener(STAY_SELECTION_CLEAR_EVENT, listener);
  return () => window.removeEventListener(STAY_SELECTION_CLEAR_EVENT, listener);
}
