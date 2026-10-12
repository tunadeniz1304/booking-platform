"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { focusRing, loginHref } from "@/components/ui/ui";
import CompareToggle from "@/components/compare/CompareToggle";
import { COMPARE_MAX, useCompareSelection } from "@/components/compare/useCompareSelection";
import { setFavoriteId, useFavoriteIds } from "@/components/property/useFavoriteIds";

export interface PropertyDetailActionsProps {
  propertyId: string;
  title: string;
  /** Karşılaştırma bağlantısına taşınan arama bağlamı. */
  checkIn?: string;
  checkOut?: string;
  guests?: number;
}

const actionClass = `inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-gray-700 underline hover:text-[#003580] aria-disabled:opacity-50 sm:min-h-[24px] ${focusRing}`;

/**
 * F917: ilan sayfası başlık eylemleri — karşılaştırmaya ekle, favori, paylaş.
 * Elemanlar parça (fragment) olarak döner; çağıran flex satırına yerleştirir.
 * Favori/karşılaştırma etiketi durumu anlatır (F90 deseni), bu yüzden aria-pressed yok.
 */
export default function PropertyDetailActions({
  propertyId,
  title,
  checkIn,
  checkOut,
  guests,
}: PropertyDetailActionsProps) {
  const t = useTranslations("property");
  const ts = useTranslations("search");
  const tc = useTranslations("compare");
  const router = useRouter();
  const favoriteIds = useFavoriteIds();
  const isFavorite = favoriteIds?.has(propertyId) ?? false;
  const { ids, full } = useCompareSelection();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // Sayfada CompareBar yok: seçim sayısı yalnız kullanıcı düğmeye basınca duyurulur.
  const [compareTouched, setCompareTouched] = useState(false);

  const compareParams = new URLSearchParams({ ids: ids.join(",") });
  if (checkIn && checkOut) {
    compareParams.set("checkIn", checkIn);
    compareParams.set("checkOut", checkOut);
  }
  if (guests) compareParams.set("guests", String(guests));
  const compareReady = ids.length >= 2 && ids.includes(propertyId);
  const compareAnnouncement =
    !compareTouched || ids.length === 0
      ? ""
      : full
        ? `${tc("bar", { count: ids.length })} ${tc("fullHint", { max: COMPARE_MAX })}`
        : `${tc("bar", { count: ids.length })} ${ids.length >= 2 ? tc("ready") : tc("needMore")}`;

  const toggleFavorite = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const wasFavorite = isFavorite;
    try {
      if (wasFavorite) {
        await apiFetch(`/api/favorites?propertyId=${encodeURIComponent(propertyId)}`, {
          method: "DELETE",
        });
      } else {
        await apiFetch("/api/favorites", {
          method: "POST",
          body: JSON.stringify({ propertyId }),
        });
      }
      setFavoriteId(propertyId, !wasFavorite);
      setNotice({
        tone: "ok",
        text: wasFavorite ? ts("card.favoriteRemoved") : ts("card.favoriteAdded"),
      });
    } catch (err) {
      // Oturum yoksa girişe, dönüşte bu ilana geri gel.
      if (err instanceof ApiError && err.status === 401) {
        router.push(loginHref());
        return;
      }
      setNotice({
        tone: "error",
        text: wasFavorite ? ts("card.favoriteRemoveFailed") : ts("card.favoriteAddFailed"),
      });
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setNotice(null);
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // Kullanıcı paylaşım penceresini kapattı; başka hata olursa panoya kopyalamaya düş.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ tone: "ok", text: t("actions.shareCopied") });
    } catch {
      setNotice({ tone: "error", text: t("actions.shareFailed") });
    }
  };

  return (
    <>
      <span className="contents" onClickCapture={() => setCompareTouched(true)}>
        <CompareToggle propertyId={propertyId} />
      </span>
      {compareReady && (
        <Link
          href={`/compare?${compareParams.toString()}`}
          className={`inline-flex min-h-[44px] items-center text-sm font-medium text-[#003580] underline sm:min-h-[24px] ${focusRing}`}
        >
          {tc("open")}
        </Link>
      )}
      <button
        type="button"
        onClick={toggleFavorite}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        className={actionClass}
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
        {isFavorite ? ts("card.removeFavorite") : ts("card.addFavorite")}
      </button>
      <button type="button" onClick={share} className={actionClass}>
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
          />
        </svg>
        {t("actions.share")}
      </button>
      <p role="status" className="sr-only">
        {compareAnnouncement}
      </p>
      <p
        role="status"
        className={
          notice
            ? `basis-full text-sm ${notice.tone === "error" ? "text-red-700" : "text-gray-700"}`
            : "sr-only"
        }
      >
        {notice?.text}
      </p>
    </>
  );
}
