"use client";

import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";

export interface RatingBadgeProps {
  /** 1–5 arası ortalama puan; tek ondalıkla, dile göre biçimlenir. */
  value: number;
  /** "md": ilan kartı görünümü (varsayılan); "sm": yoğun listeler (ev sahibi paneli, hesap). */
  size?: "sm" | "md";
  /** Yalnızca yerleşim sınıfları (ör. kenar boşluğu); renk/boyut değiştirmek için değil. */
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<RatingBadgeProps["size"]>, string> = {
  md: "px-2 py-1 text-sm font-bold",
  sm: "px-2 py-0.5 text-xs font-semibold",
};

/**
 * Puan rozeti: görünür "4,5/5" (`property.ratingOutOf`) + ekran okuyucu için
 * "Misafir puanı: 5 üzerinden 4,5" (`property.ratingAria`). Görünür kısım aria-hidden'dır.
 * Kardeş iki `<span>` döndürür (sarmalayıcı yok), mevcut flex yerleşimleri bozulmaz.
 * Puan yoksa (yorum sayısı 0) çağıran rozeti hiç göstermemeli.
 *
 * @example
 * {reviewCount > 0 ? <RatingBadge value={rating} /> : <span>{t("card.noRating")}</span>}
 */
export default function RatingBadge({ value, size = "md", className }: RatingBadgeProps) {
  const t = useTranslations("property");
  const f = useFormat();
  const rating = f.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // Renk ve md ölçüsü PropertyCard'daki eski rozetle birebir aynı.
  const badgeClass = [
    "inline-flex items-center rounded-sm bg-[#003580] text-white",
    SIZE_CLASS[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <span className={badgeClass} aria-hidden="true">
        {t("ratingOutOf", { rating })}
      </span>
      <span className="sr-only">{t("ratingAria", { rating })}</span>
    </>
  );
}
