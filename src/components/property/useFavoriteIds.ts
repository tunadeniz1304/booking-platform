"use client";

import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-client";

/** `GET /api/favorites` satırı — burada yalnızca ilan kimliği gerekir. */
interface FavoriteRow {
  propertyId: string;
}

/** Çözülmüş favori kümesi; her değişiklikte yeni nesne (React anlık görüntüsü değişsin). */
let ids: Set<string> | null = null;
/** Sayfa başına tek istek: tüm kartlar aynı söze bağlanır. */
let request: Promise<void> | null = null;
/** Geçersiz kılınınca artar; eski yanıt yeni durumu ezmez. */
let generation = 0;
/** İstek sürerken yapılan değişiklikler; yanıt gelince üzerine uygulanır. */
const pendingEdits = new Map<string, boolean>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function load(): void {
  if (ids || request) return;
  const gen = generation;
  request = apiFetch<FavoriteRow[]>("/api/favorites")
    .then((rows) => new Set(Array.isArray(rows) ? rows.map((row) => row.propertyId) : []))
    // 401 (oturum yok) dahil her hata boş küme sayılır; kalp tıklanınca kart girişe yönlendirir.
    .catch(() => new Set<string>())
    .then((next) => {
      if (gen !== generation) return;
      for (const [id, favorite] of pendingEdits) {
        if (favorite) next.add(id);
        else next.delete(id);
      }
      pendingEdits.clear();
      ids = next;
      emit();
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  load();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Set<string> | null {
  return ids;
}

function getServerSnapshot(): Set<string> | null {
  return null;
}

/**
 * Oturumdaki kullanıcının favori ilan kimlikleri. `GET /api/favorites` sayfa yüklemesi başına
 * bir kez çağrılır (modül düzeyinde paylaşılan istek); tüm kartlar aynı sonucu görür.
 *
 * - `null`: henüz yüklenmedi (SSR/hidrasyon dahil) → çağıran kendi varsayılanını gösterir.
 * - Boş küme: oturum yok (401) ya da istek başarısız.
 *
 * Dönen küme paylaşılır, DEĞİŞTİRİLMEMELİ; güncelleme için `setFavoriteId` kullanılır.
 *
 * @example
 * const favoriteIds = useFavoriteIds();
 * const isFavorite = favoriteIds?.has(id) ?? initialFavorite;
 */
export function useFavoriteIds(): Set<string> | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Favori ekleme/çıkarma isteği BAŞARILI olduktan sonra paylaşılan kümeyi günceller; aynı ilanı
 * gösteren tüm kartlar yeniden çizilir. İstek sürerken çağrılırsa yanıtın üzerine uygulanır.
 */
export function setFavoriteId(propertyId: string, favorite: boolean): void {
  if (!ids) {
    if (request) pendingEdits.set(propertyId, favorite);
    return;
  }
  if (ids.has(propertyId) === favorite) return;
  const next = new Set(ids);
  if (favorite) next.add(propertyId);
  else next.delete(propertyId);
  ids = next;
  emit();
}

/**
 * Önbelleği atar (giriş/çıkış sonrası: giriş istemci yönlendirmesiyle yapıldığından sayfa
 * yeniden yüklenmez). Abone varsa liste hemen yeniden istenir; o sırada kanca `null` döner.
 */
export function invalidateFavoriteIds(): void {
  generation += 1;
  ids = null;
  request = null;
  pendingEdits.clear();
  if (listeners.size > 0) load();
  emit();
}
