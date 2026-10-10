"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { unsplashLoader } from "@/lib/ui/image-loader";
import { focusRing } from "@/components/ui/ui";

interface PropertyGalleryProps {
  images: string[];
  title: string;
}

export default function PropertyGallery({ images, title }: PropertyGalleryProps) {
  const t = useTranslations("property");
  const [activeIndex, setActiveIndex] = useState(0);

  // Fotoğrafsız ilanda ilana ait olmayan stok görsel gösterme; nötr yer tutucu.
  if (images.length === 0) {
    return (
      <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-2xl bg-gray-50 text-gray-600 shadow-sm">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-10 w-10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="m21 16-5-5-8 8" />
        </svg>
        <p className="text-sm">{t("gallery.noPhotos")}</p>
      </div>
    );
  }

  const total = images.length;
  const safeIndex = Math.min(activeIndex, total - 1);
  const activeImage = images[safeIndex];

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="relative aspect-[16/9] w-full">
        <Image
          src={activeImage}
          alt={t("gallery.imageAlt", { title, index: safeIndex + 1, total })}
          fill
          loader={unsplashLoader}
          priority
          sizes="(max-width: 1024px) 100vw, 60vw"
          className="object-cover"
        />
      </div>
      {total > 1 && (
        <>
          <p className="sr-only" aria-live="polite">
            {t("gallery.counter", { index: safeIndex + 1, total })}
          </p>
          <div
            role="group"
            aria-label={t("gallery.thumbnails")}
            className="grid grid-cols-4 gap-2 p-2"
          >
            {images.map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-pressed={index === safeIndex}
                aria-label={t("gallery.show", { index: index + 1, total })}
                className={`relative aspect-[4/3] overflow-hidden rounded-lg transition ${focusRing} ${
                  index === safeIndex ? "ring-2 ring-primary-600" : "opacity-70 hover:opacity-100"
                }`}
              >
                <Image
                  src={image}
                  alt=""
                  fill
                  loader={unsplashLoader}
                  // Küçük resimler LCP görseliyle bant genişliği için yarışmasın.
                  fetchPriority="low"
                  sizes="(max-width: 1024px) 25vw, 15vw"
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
