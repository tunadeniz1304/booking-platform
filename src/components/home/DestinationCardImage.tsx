"use client";

import Image from "next/image";
import { useState } from "react";

export interface DestinationCardImageProps {
  /** Destinasyonu gerçekten gösteren fotoğraf; yoksa nötr yer tutucu çizilir. */
  src: string | null;
  sizes: string;
}

/**
 * Destinasyon kartı görseli. Kart bağlantısının adı başlıktan geldiği için görsel dekoratiftir
 * (`alt=""`). Görsel yoksa ya da yüklenemezse kırık resim simgesi yerine yer tutucu gösterilir.
 */
export default function DestinationCardImage({ src, sizes }: DestinationCardImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <div
        aria-hidden="true"
        className="flex h-full w-full items-center justify-center bg-gray-100 text-gray-600"
      >
        <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt=""
      fill
      sizes={sizes}
      className="object-cover transition duration-300 group-hover:scale-105"
      onError={() => setFailedSrc(src)}
    />
  );
}
