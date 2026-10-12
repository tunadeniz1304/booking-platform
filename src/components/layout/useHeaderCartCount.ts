"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * Başlıktaki sepet rozeti: aktif sepetteki kalem sayısı. Başlık her sayfada yeniden kurulduğu için
 * modül düzeyinde tutulur; `null` = bilinmiyor.
 */
let count: number | null = null;
/** Aynı anda gelen yenilemeler tek isteği paylaşır. */
let request: Promise<void> | null = null;
/** Elle ayarlanınca artar; eski yanıt yeni sayıyı ezmez. */
let generation = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Sepet sayfası kalem ekleyip çıkarınca rozeti hemen günceller (`null`: bilinmiyor). */
export function setHeaderCartCount(next: number | null): void {
  generation += 1;
  request = null;
  if (count === next) return;
  count = next;
  emit();
}

type CartCountResponse = { cart: { items: unknown[] } | null };

async function loadHeaderCartCount(gen: number): Promise<void> {
  try {
    const res = await apiFetch<CartCountResponse>("/api/cart", { cache: "no-store" });
    if (gen !== generation) return;
    const next = res.cart?.items.length ?? 0;
    if (count !== next) {
      count = next;
      emit();
    }
  } catch {
    // Ağ/oturum hatasında son bilinen sayı kalır; rozet yanlış bir sayı uydurmaz.
  }
}

function refreshHeaderCartCount(): void {
  if (request) return;
  const pending = loadHeaderCartCount(generation).finally(() => {
    if (request === pending) request = null;
  });
  request = pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): number | null => count;
const getServerSnapshot = (): number | null => null;

/** Oturum açıkken sepet kalem sayısı (her gezinmede arka planda yenilenir); oturumsuzken `null`. */
export function useHeaderCartCount(enabled: boolean, pathname: string): number | null {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (enabled) refreshHeaderCartCount();
    // Çıkışta önceki kullanıcının sayısı bir sonraki girişte görünmesin.
    else if (count !== null) setHeaderCartCount(null);
  }, [enabled, pathname]);
  return enabled ? value : null;
}
