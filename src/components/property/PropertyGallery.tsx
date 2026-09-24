"use client";

import { useState } from "react";
import Image from "next/image";

interface PropertyGalleryProps {
  images: string[];
  title: string;
}

const FALLBACK_IMAGES = [
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80",
];

export default function PropertyGallery({ images, title }: PropertyGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const galleryImages = images.length > 0 ? images : FALLBACK_IMAGES;
  const activeImage = galleryImages[activeIndex] ?? galleryImages[0];

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="relative aspect-[16/9] w-full">
        <Image
          src={activeImage}
          alt={`${title} - görsel ${activeIndex + 1}`}
          fill
          unoptimized
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
        />
      </div>
      {galleryImages.length > 1 && (
        <div className="grid grid-cols-4 gap-2 p-2">
          {galleryImages.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`relative aspect-[4/3] overflow-hidden rounded-lg transition ${
                index === activeIndex ? "ring-2 ring-primary-600" : "opacity-70 hover:opacity-100"
              }`}
            >
              <Image
                src={image}
                alt={`${title} - küçük görsel ${index + 1}`}
                fill
                unoptimized
                sizes="(max-width: 768px) 25vw, 12vw"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
