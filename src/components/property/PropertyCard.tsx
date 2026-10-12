"use client";

import { useId, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { ApiError, apiFetch } from "@/lib/api-client";
import { loginHref } from "@/components/ui/ui";
import { propertyTypeKey } from "@/lib/i18n/property-type";
import { setFavoriteId, useFavoriteIds } from "@/components/property/useFavoriteIds";
import RatingBadge from "@/components/property/RatingBadge";
import { unsplashLoader } from "@/lib/ui/image-loader";

/**
 * Kart fotoğrafının gerçek genişliği (F1211): ana sayfa lg'de 3 sütun, arama lg'de 2, xl'de 3
 * sütun; ikisi de max-w-7xl içinde olduğundan xl üstünde ~400px'i geçmez.
 */
const CARD_IMAGE_SIZES =
  "(min-width: 1280px) 400px, (min-width: 1024px) 34vw, (min-width: 640px) 50vw, 100vw";

/** Arama bağlamı (tarih, misafir) — ilan sayfasına taşınır (F93/F205). */
export interface SearchContext {
  checkIn?: string | null;
  checkOut?: string | null;
  guests?: number | null;
  /** Yetişkin/çocuk dağılımı (F364); verilirse ilan sayfasındaki widget aynı dağılımla açılır. */
  adults?: number | null;
  children?: number | null;
  roomId?: string | null;
  ratePlanId?: string | null;
}

/**
 * İlan bağlantısı: arama bağlamındaki dolu alanları sorguya ekler. Tarih yalnızca ikisi
 * birlikte varsa taşınır; misafir sayısı tarih olmasa da korunur.
 */
export function propertyHref(id: string, ctx?: SearchContext): string {
  const params = new URLSearchParams();
  if (ctx?.checkIn && ctx.checkOut) {
    params.set("checkIn", ctx.checkIn);
    params.set("checkOut", ctx.checkOut);
  }
  if (ctx?.guests && ctx.guests > 0) params.set("guests", String(ctx.guests));
  if (ctx?.adults && ctx.adults > 0) params.set("adults", String(ctx.adults));
  if (ctx?.children && ctx.children > 0) params.set("children", String(ctx.children));
  if (ctx?.roomId) params.set("roomId", ctx.roomId);
  if (ctx?.ratePlanId) params.set("ratePlanId", ctx.ratePlanId);
  const q = params.toString();
  return q ? `/property/${id}?${q}` : `/property/${id}`;
}

export interface PropertyCardProps {
  id: string;
  title: string;
  location: string;
  /** İlanın kendi fotoğrafı; yoksa kartta "Fotoğraf eklenmemiş" yer tutucusu gösterilir. */
  imageUrl?: string | null;
  /** Taban gece fiyatı (minor-unit, `currency` biriminde). */
  priceMinor: number;
  /** Zorunlu: varsayılan para birimi yanlış tutar göstermesin (F38). */
  currency: string;
  rating: number;
  reviewCount: number;
  /** Ham enum (`BED_AND_BREAKFAST`) ya da çevrilmiş etiket; ham enum kartta çevrilir. */
  propertyType: string;
  /** Favori listesi yüklenene kadar (ya da yüklenemezse) gösterilecek durum. */
  initialFavorite?: boolean;
  /**
   * Tarih seçiliyse sunucunun `priceStay` teklifi (vergi + ücret dahil, minor-unit). Varsa kartta
   * EN BELİRGİN fiyat budur (FTC "all-in" kuralı); gecelik taban fiyat gösterilmez.
   */
  stay?: {
    total: number;
    nights: number;
    checkIn: string;
    checkOut: string;
    guests: number;
    adults?: number;
    children?: number;
    roomId: string;
    ratePlanId: string;
  };
  /** Teklif olmasa da ilan sayfasına taşınacak arama tarih/misafir bilgisi. */
  searchContext?: SearchContext;
  /**
   * Aramada tarih seçili mi (F704). `stay` yokken kart "tarih seçince…" demesin diye; verilmezse
   * `searchContext` içindeki tarihlerden çıkarılır.
   */
  datesSelected?: boolean;
}

export default function PropertyCard({
  id,
  title,
  location,
  imageUrl,
  priceMinor,
  currency,
  rating,
  reviewCount,
  propertyType,
  initialFavorite = false,
  stay,
  searchContext,
  datesSelected,
}: PropertyCardProps) {
  const href = propertyHref(id, stay ?? searchContext);
  const hasDates = datesSelected ?? Boolean(searchContext?.checkIn && searchContext?.checkOut);
  const router = useRouter();
  const t = useTranslations("search");
  const f = useFormat();
  const titleId = useId();
  // Oturumdaki favoriler sayfa başına bir kez çekilir; yüklenene kadar initialFavorite gösterilir.
  const favoriteIds = useFavoriteIds();
  const isFavorite = favoriteIds?.has(id) ?? initialFavorite;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // Ham enum çevrilir; bilinmeyen ham enum gizlenir, çağıranın çevirdiği etiket aynen kalır.
  const typeKey = propertyTypeKey(propertyType);
  let typeLabel: string | null = propertyType.trim() || null;
  if (typeKey) typeLabel = t(`types.${typeKey}`);
  else if (/^[A-Z0-9_]+$/.test(propertyType)) typeLabel = null;

  const toggleFavorite = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const wasFavorite = isFavorite;
    try {
      if (wasFavorite) {
        await apiFetch(`/api/favorites?propertyId=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } else {
        await apiFetch("/api/favorites", {
          method: "POST",
          body: JSON.stringify({ propertyId: id }),
        });
      }
      setFavoriteId(id, !wasFavorite);
      setNotice({
        tone: "ok",
        text: wasFavorite ? t("card.favoriteRemoved") : t("card.favoriteAdded"),
      });
    } catch (err) {
      // Oturum yoksa (yenileme de başarısızsa) girişe, dönüşte bu sayfaya geri gel.
      if (err instanceof ApiError && err.status === 401) {
        router.push(loginHref());
        return;
      }
      setNotice({
        tone: "error",
        text: wasFavorite ? t("card.favoriteRemoveFailed") : t("card.favoriteAddFailed"),
      });
    } finally {
      setBusy(false);
    }
  };

  // DOM sırası: başlık → bilgiler → fotoğraf → favori (ekran okuyucu ve Tab sırası başlıkla
  // başlar). Fotoğraf `order-first` ile üstte; rozet ve kalp kartın köküne göre konumlanır.
  // Başlık bağlantısı `after:inset-0` ile tüm kartı kaplar (fotoğraf dahil, tek sekme durağı).
  return (
    <article
      aria-labelledby={titleId}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:shadow-md"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 id={titleId} className="text-base font-semibold text-gray-900">
              <Link
                href={href}
                className="transition after:absolute after:inset-0 after:z-[1] after:rounded-lg after:content-[''] hover:text-[#003580] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand"
              >
                {title}
              </Link>
            </h3>
            {typeLabel && (
              <span className="pointer-events-none absolute left-3 top-3 z-[1] rounded-sm bg-[#003580] px-2 py-1 text-xs font-semibold text-white">
                {typeLabel}
              </span>
            )}
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              {location}
            </p>
          </div>
          {reviewCount > 0 ? (
            <div className="flex flex-col items-end">
              {/* F702/F1096: görünür "4,5/5", ekran okuyucuya "Misafir puanı: 5 üzerinden 4,5". */}
              <RatingBadge value={rating} />
              <span className="mt-1 text-xs text-gray-500">
                {t("card.reviews", { count: reviewCount })}
              </span>
            </div>
          ) : (
            <span className="text-xs text-gray-500">{t("card.noRating")}</span>
          )}
        </div>

        <div className="mt-4 flex items-end justify-between border-t border-gray-100 pt-4">
          {stay ? (
            <div data-testid="card-price">
              {/* F1214: toplamın kaç gece ve kaç misafir için olduğu. */}
              <p className="text-xs text-gray-500">
                {t("card.nightsGuestsTotal", { nights: stay.nights, guests: stay.guests })}
              </p>
              <p className="text-lg font-bold text-gray-900" data-testid="card-total">
                {f.money(stay.total, currency)}
              </p>
              <p className="text-xs text-gray-500">{t("card.taxesIncluded")}</p>
            </div>
          ) : (
            <div data-testid="card-price">
              <p className="text-xs text-gray-500">{t("card.fromPerNight")}</p>
              <p className="text-lg font-bold text-gray-900">{f.money(priceMinor, currency)}</p>
              <p className="text-xs text-gray-500">
                {hasDates ? t("card.notStayTotal") : t("card.taxesOnDates")}
              </p>
            </div>
          )}
          {/* Görsel ipucu: tıklama kartı kaplayan başlık bağlantısına gider; ayrı sekme durağı
              ve yinelenen bağlantı adı olmasın diye erişilebilirlik ağacından gizli. */}
          <span
            aria-hidden="true"
            className="whitespace-nowrap rounded-sm bg-[#003580] px-4 py-2 text-sm font-semibold text-white transition group-hover:bg-[#002b66]"
          >
            {stay ? t("card.seeRoom") : t("card.seePrices")}
          </span>
        </div>
      </div>

      <div className="relative order-first h-48 overflow-hidden">
        {imageUrl ? (
          // Başlık hemen önce okunur; fotoğraf adı tekrarlamasın diye dekoratif (F1210).
          <Image
            src={imageUrl}
            alt=""
            fill
            loader={unsplashLoader}
            sizes={CARD_IMAGE_SIZES}
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-gray-100 text-gray-600">
            <svg
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="text-sm">{t("card.noPhoto")}</span>
          </div>
        )}
      </div>

      <p
        role="status"
        className={
          notice?.tone === "error" ? "order-first px-4 pt-3 text-sm text-red-700" : "sr-only"
        }
      >
        {notice?.text}
      </p>

      {/* İstek sürerken `disabled` yerine aria-disabled: odak düğmede kalır (F696). */}
      <button
        type="button"
        onClick={toggleFavorite}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        aria-label={
          isFavorite
            ? t("card.removeFavoriteNamed", { title })
            : t("card.addFavoriteNamed", { title })
        }
        className="absolute right-3 top-3 z-[2] inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/90 p-2 text-gray-600 shadow-sm transition hover:bg-white hover:text-red-500 aria-disabled:opacity-50"
      >
        <svg
          className={`h-5 w-5 ${isFavorite ? "fill-red-500 text-red-500" : "fill-none"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
      </button>
    </article>
  );
}
