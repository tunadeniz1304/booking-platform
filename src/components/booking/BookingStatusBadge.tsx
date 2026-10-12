"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

/** Rezervasyonun alabileceği durumlar (Prisma `BookingStatus`). */
export const BOOKING_STATUSES = [
  "PENDING",
  "HELD",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
] as const;

export type BookingStatusValue = (typeof BOOKING_STATUSES)[number];

function isKnownStatus(status: string): status is BookingStatusValue {
  return (BOOKING_STATUSES as readonly string[]).includes(status);
}

type BookingStatusKey = `bookingStatus.${BookingStatusValue | "UNKNOWN"}`;

/**
 * `common` ad alanındaki kısa etiket anahtarı: misafir, ev sahibi ve rezervasyon ayrıntısı aynı
 * adı kullanır; bilinmeyen durumlar ham kod yerine genel etiketle gösterilir.
 */
export function bookingStatusKey(status: string): BookingStatusKey {
  return `bookingStatus.${isKnownStatus(status) ? status : "UNKNOWN"}`;
}

/** Mevcut rozet renkleri korunur. */
const STATUS_TONE: Partial<Record<BookingStatusValue, string>> = {
  CONFIRMED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
  COMPLETED: "bg-gray-100 text-gray-800",
};
const DEFAULT_TONE = "bg-yellow-100 text-yellow-800";

/** Her durum için ayırt edici simge: durum yalnız renkle anlatılmaz (WCAG 1.4.1). */
const STATUS_ICON: Record<BookingStatusValue | "UNKNOWN", ReactNode> = {
  PENDING: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  HELD: <path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4" />,
  CONFIRMED: <path d="M5 12l5 5L20 7" />,
  CANCELLED: <path d="M6 6l12 12M18 6L6 18" />,
  EXPIRED: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  COMPLETED: <path d="M5 21V4h11l-2 4 2 4H5" />,
  UNKNOWN: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01" />
    </>
  ),
};

/** Rezervasyon durumu rozeti: kısa etiket + simge, tüm ekranlarda aynı ad ve görünüm. */
export default function BookingStatusBadge({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  const t = useTranslations("common");
  const known = isKnownStatus(status) ? status : null;
  const tone = (known && STATUS_TONE[known]) || DEFAULT_TONE;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${tone} ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0"
      >
        {STATUS_ICON[known ?? "UNKNOWN"]}
      </svg>
      {t(bookingStatusKey(status))}
    </span>
  );
}
