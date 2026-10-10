"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { ApiError, apiFetch } from "@/lib/api-client";
import { loginHref } from "@/components/ui/ui";

/** Arama bağlamı (tarih, misafir) — ilan sayfasına taşınır (F93/F205). */
export interface SearchContext {
  checkIn?: string | null;
  checkOut?: string | null;
  guests?: number | null;
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
  if (ctx?.roomId) params.set("roomId", ctx.roomId);
  if (ctx?.ratePlanId) params.set("ratePlanId", ctx.ratePlanId);
  const q = params.toString();
  return q ? `/property/${id}?${q}` : `/property/${id}`;
}

export interface PropertyCardProps {
  id: string;
  title: string;
  location: string;
  imageUrl: string;
  /** Taban gece fiyatı (minor-unit, `currency` biriminde). */
  priceMinor: number;
  currency?: string;
  rating: number;
  reviewCount: number;
  propertyType: string;
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
    roomId: string;
    ratePlanId: string;
  };
  /** Teklif olmasa da ilan sayfasına taşınacak arama tarih/misafir bilgisi. */
  searchContext?: SearchContext;
}

export default function PropertyCard({
  id,
  title,
  location,
  imageUrl,
  priceMinor,
  currency = "TRY",
  rating,
  reviewCount,
  propertyType,
  initialFavorite = false,
  stay,
  searchContext,
}: PropertyCardProps) {
  const href = propertyHref(id, stay ?? searchContext);
  const router = useRouter();
  const t = useTranslations("search");
  const f = useFormat();
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

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
      setIsFavorite(!wasFavorite);
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

  return (
    <div className="group overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:shadow-md">
      <div className="relative h-48 overflow-hidden">
        <Image
          src={imageUrl}
          alt={title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="object-cover transition duration-300 group-hover:scale-105"
        />
        <button
          type="button"
          onClick={toggleFavorite}
          disabled={busy}
          aria-busy={busy || undefined}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? t("card.removeFavorite") : t("card.addFavorite")}
          className="absolute right-3 top-3 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/90 p-2 text-gray-600 shadow-sm transition hover:bg-white hover:text-red-500 disabled:opacity-50"
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
        <span className="absolute left-3 top-3 rounded-sm bg-[#003580] px-2 py-1 text-xs font-semibold text-white">
          {propertyType}
        </span>
      </div>

      <p
        role="status"
        className={notice?.tone === "error" ? "px-4 pt-3 text-sm text-red-700" : "sr-only"}
      >
        {notice?.text}
      </p>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              <Link href={href} className="transition hover:text-[#003580]">
                {title}
              </Link>
            </h3>
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
              <span
                className="rounded-sm bg-[#003580] px-2 py-1 text-sm font-bold text-white"
                aria-hidden="true"
              >
                {f.number(rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </span>
              <span className="sr-only">
                {t("card.ratingLabel", {
                  value: f.number(rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                })}
              </span>
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
              <p className="text-xs text-gray-500">
                {t("card.nightsTotal", { count: stay.nights })}
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
              <p className="text-xs text-gray-500">{t("card.taxesOnDates")}</p>
            </div>
          )}
          <Link
            href={href}
            className="rounded-sm bg-[#003580] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#002b66]"
          >
            {t("card.seeDeal")}
          </Link>
        </div>
      </div>
    </div>
  );
}
