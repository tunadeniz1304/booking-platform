"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api-client";
import type { CartDTO } from "@/lib/cart/cart-service";

export type { CartDTO, CartItemDTO } from "@/lib/cart/cart-service";

/** Aktif sepet yokken geri yüklenebilecek süresi dolmuş sepetin özeti (`GET /api/cart`). */
export type RestorableCart = { expiredAt: string; itemCount: number };

/**
 * Aktif sepeti yükler; oturum yoksa girişe yönlendirir. `restorable` yalnız sunucu geri
 * yüklenebilir bir sepet bildirdiyse doludur (okuma hatasında null).
 */
export function useCart() {
  const router = useRouter();
  const [cart, setCart] = useState<CartDTO | null>(null);
  const [restorable, setRestorable] = useState<RestorableCart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch<{ cart: CartDTO | null; restorable?: RestorableCart | null }>(
        "/api/cart",
        { cache: "no-store" }
      );
      setCart(res.cart);
      setRestorable(res.restorable ?? null);
      setError(null);
    } catch (err) {
      setRestorable(null);
      if (err instanceof ApiError && err.status === 401) {
        router.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : "error");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);

  return { cart, setCart, loading, error, reload, restorable };
}
