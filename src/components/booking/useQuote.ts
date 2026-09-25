"use client";

import { useEffect, useState } from "react";

/** /api/quote yanıtı (tutarlar minor-unit). */
export interface QuoteView {
  quoteId: string;
  propertyId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  currency: string;
  nights: Array<{ date: string; amount: number }>;
  subtotal: number;
  fees: Array<{ code: string; label: string; amount: number }>;
  taxes: Array<{ code: string; label: string; rate: number; amount: number }>;
  total: number;
  expiresAt: string;
}

export interface QuoteState {
  quote: QuoteView | null;
  loading: boolean;
  error: string | null;
  /** Hata kodu (ör. SOLD_OUT) — UI mesajı için. */
  code: string | null;
}

/**
 * Sunucudan fiyat teklifi alır. Fiyat YALNIZCA sunucuda hesaplanır (computeTotal);
 * istemci hiçbir tutarı kendisi çarpmaz/toplamaz.
 */
export function useQuote(params: {
  roomId?: string;
  propertyId?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  /** Fiyat planı (yoksa sunucu varsayılanı). */
  ratePlanId?: string;
  /** Değiştirildiğinde teklif yeniden alınır (ör. PRICE_CHANGED sonrası). */
  refreshKey?: number;
}): QuoteState {
  const { roomId, propertyId, checkIn, checkOut, guests, ratePlanId, refreshKey } = params;
  const key =
    roomId && checkIn && checkOut && checkIn < checkOut
      ? new URLSearchParams({
          roomId,
          ...(propertyId ? { propertyId } : {}),
          checkIn,
          checkOut,
          guests: String(guests ?? 1),
          ...(ratePlanId ? { ratePlanId } : {}),
          r: String(refreshKey ?? 0),
        }).toString()
      : null;

  const [state, setState] = useState<QuoteState & { key: string | null }>({
    key: null,
    quote: null,
    loading: false,
    error: null,
    code: null,
  });

  useEffect(() => {
    if (!key) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ key, quote: null, loading: true, error: null, code: null });
      fetch(`/api/quote?${key}`, { signal: controller.signal, cache: "no-store" })
        .then(async (res) => {
          const body = await res.json();
          if (!active) return;
          if (!res.ok) {
            setState({
              key,
              quote: null,
              loading: false,
              error: body.error ?? "Fiyat alınamadı",
              code: body.code ?? null,
            });
          } else {
            setState({ key, quote: body as QuoteView, loading: false, error: null, code: null });
          }
        })
        .catch(() => {
          if (active)
            setState({ key, quote: null, loading: false, error: "Fiyat alınamadı", code: null });
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  if (!key) return { quote: null, loading: false, error: null, code: null };
  if (state.key !== key) return { quote: null, loading: true, error: null, code: null };
  return state;
}
