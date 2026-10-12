/**
 * Ev sahibi panelinde fotoğraf yüklenip silinince aynı sayfadaki fotoğrafa bağlı paneller
 * (ör. erişilebilirlik kanıtı seçimi) bu olayla listelerini yeniden çeker.
 */
export const HOST_PHOTOS_CHANGED_EVENT = "host-photos-changed";

export function notifyHostPhotosChanged(propertyId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HOST_PHOTOS_CHANGED_EVENT, { detail: { propertyId } }));
}
