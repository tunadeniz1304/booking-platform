"use client";

import { useSyncExternalStore } from "react";
import { fetchCurrentUser, type SessionUser } from "@/lib/api-client";

/** `undefined`: henüz bilinmiyor (ilk yükleme), `null`: oturum yok. */
export type SessionUserSnapshot = SessionUser | null | undefined;

/**
 * Son bilinen oturum kullanıcısı. Başlık her sayfada yeniden kurulduğu için durum modül düzeyinde
 * tutulur: gezinmede "Giriş yap" yanıp sönmez, rol menüsü kaymaz.
 */
let current: SessionUserSnapshot = undefined;
/** Aynı anda gelen yenilemeler tek isteği paylaşır. */
let request: Promise<SessionUserSnapshot> | null = null;
/** Elle ayarlanınca (giriş/çıkış) artar; eski yanıt yeni durumu ezmez. */
let generation = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Giriş ya da çıkıştan hemen sonra önbelleği günceller (yanıt beklenmez). */
export function setSessionUserCache(user: SessionUser | null): void {
  generation += 1;
  request = null;
  current = user;
  emit();
}

/** `/api/user/me`'yi yeniden okur ve önbelleği günceller. */
export function refreshSessionUser(): Promise<SessionUserSnapshot> {
  if (request) return request;
  const gen = generation;
  const pending = fetchCurrentUser()
    .then(
      (user) => {
        if (gen === generation) {
          current = user;
          emit();
        }
        return current;
      },
      // Ağ hatası oturumu düşürmez: son bilinen kullanıcı kalır; hiç bilinmiyorsa oturumsuz.
      () => {
        if (gen === generation && current === undefined) {
          current = null;
          emit();
        }
        return current;
      }
    )
    .finally(() => {
      if (request === pending) request = null;
    });
  request = pending;
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): SessionUserSnapshot => current;
const getServerSnapshot = (): SessionUserSnapshot => undefined;

/** Önbellekteki oturum kullanıcısı; sunucu render'ında ve ilk yüklemede `undefined`. */
export function useSessionUserCache(): SessionUserSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
