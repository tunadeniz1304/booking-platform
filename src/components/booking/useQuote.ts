"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

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
  fees: Array<{
    code: string;
    label: string;
    rateBps?: number;
    amount: number;
    inclusive: boolean;
  }>;
  taxes: Array<{
    code: string;
    label: string;
    rateBps?: number;
    amount: number;
    inclusive: boolean;
  }>;
  total: number;
  expiresAt: string;
  /** P1-8: promosyon satırları (tutar pozitif = indirim). */
  discounts?: Array<{
    promotionId: string;
    name: string;
    type: string;
    couponCode: string | null;
    amount: number;
  }>;
  discountTotal?: number;
  coupon?: { code: string; status: string } | null;
  couponCode?: string | null;
  /** P1-8 Omnibus: son `omnibusDays` günün en düşük (promosyonsuz, vergi dahil) toplamı. */
  lowestPrice30dMinor?: number;
  omnibusDays?: number;
}

/** Ağ/yanıt hatasında yer tutucu; dönüşte etkin dildeki mesaja çevrilir. */
const FETCH_FAILED = "\u0000quote-fetch-failed";

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
  /** P1-8: kupon kodu (sunucu doğrular ve uygular). */
  couponCode?: string;
}): QuoteState {
  const t = useTranslations("quote");
  const { roomId, propertyId, checkIn, checkOut, guests, ratePlanId, refreshKey, couponCode } =
    params;
  const key =
    roomId && checkIn && checkOut && checkIn < checkOut
      ? new URLSearchParams({
          roomId,
          ...(propertyId ? { propertyId } : {}),
          checkIn,
          checkOut,
          guests: String(guests ?? 1),
          ...(ratePlanId ? { ratePlanId } : {}),
          ...(couponCode ? { couponCode } : {}),
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
              error: body.error ?? FETCH_FAILED,
              code: body.code ?? null,
            });
          } else {
            setState({ key, quote: body as QuoteView, loading: false, error: null, code: null });
          }
        })
        .catch(() => {
          if (active)
            setState({ key, quote: null, loading: false, error: FETCH_FAILED, code: null });
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
  return state.error === FETCH_FAILED ? { ...state, error: t("fetchFailed") } : state;
}
