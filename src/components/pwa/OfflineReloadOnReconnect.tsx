"use client";

import { useEffect } from "react";

/**
 * Çevrimdışı yedek sayfası istenen adreste sunulur; bağlantı geri gelince (`online`) sayfa
 * yeniden yüklenir ve kullanıcı açmak istediği sayfaya kendiliğinden ulaşır.
 */
export default function OfflineReloadOnReconnect() {
  useEffect(() => {
    const reload = () => window.location.reload();
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, []);
  return null;
}
