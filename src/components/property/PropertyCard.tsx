"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";

export interface PropertyCardProps {
  id: string;
  title: string;
  location: string;
  imageUrl: string;
  price: number;
  currency?: string;
  rating: number;
  reviewCount: number;
  propertyType: string;
  initialFavorite?: boolean;
}

export default function PropertyCard({
  id,
  title,
  location,
  imageUrl,
  price,
  currency = "TRY",
  rating,
  reviewCount,
  propertyType,
  initialFavorite = false,
}: PropertyCardProps) {
  const router = useRouter();
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [busy, setBusy] = useState(false);

  const toggleFavorite = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isFavorite) {
        const res = await fetch(`/api/favorites?propertyId=${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Favori kaldırılamadı");
        setIsFavorite(false);
      } else {
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ propertyId: id }),
        });
        if (!res.ok) throw new Error("Favori eklenemedi");
        setIsFavorite(true);
      }
    } catch (err) {
      // Giriş yapılmamışsa favori eklenemez; kullanıcıyı girişe yönlendir
      if (err instanceof Error && err.message.includes("401")) {
        router.push("/login");
      }
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
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "Favorilerden çıkar" : "Favorilere ekle"}
          className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-gray-600 shadow-sm transition hover:bg-white hover:text-red-500 disabled:opacity-50"
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

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              <Link href={`/property/${id}`} className="transition hover:text-[#003580]">
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
          <div className="flex flex-col items-end">
            <span className="rounded-sm bg-[#003580] px-2 py-1 text-sm font-bold text-white">
              {rating.toFixed(1)}
            </span>
            <span className="mt-1 text-xs text-gray-500">{reviewCount} değerlendirme</span>
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between border-t border-gray-100 pt-4">
          <div>
            <p className="text-xs text-gray-500">gecelik</p>
            <p className="text-lg font-bold text-gray-900">
              {new Intl.NumberFormat("tr-TR", {
                style: "currency",
                currency,
                maximumFractionDigits: 0,
              }).format(price)}
            </p>
          </div>
          <Link
            href={`/property/${id}`}
            className="rounded-sm bg-[#003580] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#002b66]"
          >
            Fırsatı Gör
          </Link>
        </div>
      </div>
    </div>
  );
}
