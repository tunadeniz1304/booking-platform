"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { unsplashLoader } from "@/lib/ui/image-loader";
import { focusRing } from "@/components/ui/ui";

interface PropertyGalleryProps {
  images: string[];
  title: string;
}

/** sm ve üstünde ızgarada en fazla bu kadar kutucuk; fazlası "+N fotoğraf" kutucuğunda. */
const MAX_GRID_TILES = 8;
/** Yatay kaydırma (swipe) eşiği, px. */
const SWIPE_MIN = 50;

// Görselin kenarında halka kırpılmasın diye içeri çizilen odak halkası (focusRing ile aynı renk).
const insetFocusRing =
  "focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#003580]";
const navButtonClass = `absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-sm hover:bg-white ${focusRing}`;
const chipClass = "pointer-events-none absolute rounded-full bg-white/90 text-gray-900 shadow-sm";

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

/** Tek parmakla yatay kaydırmada önceki/sonraki; yakınlaştırılmış görünümde devre dışı. */
function useSwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      const zoomed = (window.visualViewport?.scale ?? 1) > 1;
      start.current =
        e.touches.length === 1 && touch && !zoomed ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchEnd(e: TouchEvent) {
      const from = start.current;
      start.current = null;
      const touch = e.changedTouches[0];
      if (!from || !touch) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) onNext();
      else onPrev();
    },
    onTouchCancel() {
      start.current = null;
    },
  };
}

export default function PropertyGallery({ images, title }: PropertyGalleryProps) {
  const t = useTranslations("property");
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const moreRef = useRef<HTMLButtonElement>(null);

  const total = images.length;
  const safeIndex = Math.min(activeIndex, Math.max(total - 1, 0));
  const go = (index: number) => setActiveIndex(((index % total) + total) % total);
  const swipe = useSwipe(
    () => go(safeIndex - 1),
    () => go(safeIndex + 1)
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!lightboxOpen || !dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    // Tam ekran görünümün arkasında sayfa kaymasın.
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousOverflow;
    };
  }, [lightboxOpen]);

  // Fotoğrafsız ilanda ilana ait olmayan stok görsel gösterme; nötr yer tutucu.
  if (total === 0) {
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

  const activeImage = images[safeIndex];
  const imageAlt = t("gallery.imageAlt", { title, index: safeIndex + 1, total });
  const hasMore = total > MAX_GRID_TILES;
  const firstHidden = MAX_GRID_TILES - 1;

  /** ←/→ önceki/sonraki; küçük resimlerde Home/End ve odak seçilen küçük resme taşınır. */
  function navigateByKey(e: KeyboardEvent<HTMLElement>, thumbnails = false) {
    if (total < 2 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    let next: number;
    if (e.key === "ArrowLeft") next = (safeIndex - 1 + total) % total;
    else if (e.key === "ArrowRight") next = (safeIndex + 1) % total;
    else if (thumbnails && e.key === "Home") next = 0;
    else if (thumbnails && e.key === "End") next = total - 1;
    else return;
    e.preventDefault();
    setActiveIndex(next);
    if (!thumbnails) return;
    const thumb = thumbRefs.current[next];
    // sm+ ızgarada gizli küçük resimler için odak "+N fotoğraf" kutucuğunda kalır.
    if (thumb && thumb.getClientRects().length > 0) thumb.focus();
    else moreRef.current?.focus();
  }

  function openLightbox(index: number, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setActiveIndex(index);
    setLightboxOpen(true);
  }

  const prevNext = (
    <>
      <button
        type="button"
        onClick={() => go(safeIndex - 1)}
        aria-label={t("gallery.previous")}
        className={`${navButtonClass} left-2 sm:left-4`}
      >
        <Chevron direction="left" />
      </button>
      <button
        type="button"
        onClick={() => go(safeIndex + 1)}
        aria-label={t("gallery.next")}
        className={`${navButtonClass} right-2 sm:right-4`}
      >
        <Chevron direction="right" />
      </button>
    </>
  );

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div
        className="relative aspect-[16/9] w-full touch-pan-y touch-pinch-zoom"
        onKeyDown={(e) => navigateByKey(e)}
        {...swipe}
      >
        <button
          type="button"
          onClick={(e) => openLightbox(safeIndex, e.currentTarget)}
          className={`absolute inset-0 block h-full w-full cursor-zoom-in ${insetFocusRing}`}
        >
          <Image
            src={activeImage}
            alt={imageAlt}
            fill
            loader={unsplashLoader}
            priority
            sizes="(max-width: 1024px) 100vw, 60vw"
            className="object-cover"
          />
          <span className="sr-only">{t("gallery.enlarge")}</span>
        </button>
        <span
          aria-hidden="true"
          className={`${chipClass} right-2 top-2 flex h-8 w-8 items-center justify-center`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </span>
        {total > 1 && (
          <>
            {prevNext}
            <span
              aria-hidden="true"
              className={`${chipClass} bottom-2 right-2 px-2 py-0.5 text-xs font-medium`}
            >
              {t("gallery.position", { index: safeIndex + 1, total })}
            </span>
          </>
        )}
      </div>
      {total > 1 && (
        <>
          <p className="sr-only" aria-live="polite">
            {t("gallery.counter", { index: safeIndex + 1, total })}
          </p>
          {/* Mobilde kaydırmalı şerit, sm+ ızgara (fazlası "+N fotoğraf" kutucuğunda). */}
          <div
            role="group"
            aria-label={t("gallery.thumbnails")}
            onKeyDown={(e) => navigateByKey(e, true)}
            className="flex snap-x snap-mandatory scroll-px-2 gap-2 overflow-x-auto p-2 sm:grid sm:grid-cols-4 sm:overflow-visible"
          >
            {images.map((image, index) => (
              <button
                key={`${image}-${index}`}
                ref={(el) => {
                  thumbRefs.current[index] = el;
                }}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-pressed={index === safeIndex}
                aria-label={t("gallery.show", { index: index + 1, total })}
                className={`relative aspect-[4/3] w-[22%] shrink-0 snap-start overflow-hidden rounded-lg transition sm:w-auto ${
                  hasMore && index >= firstHidden ? "sm:hidden" : ""
                } ${focusRing} ${
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
            {hasMore && (
              <button
                ref={moreRef}
                type="button"
                onClick={(e) => openLightbox(firstHidden, e.currentTarget)}
                className={`hidden aspect-[4/3] items-center justify-center rounded-lg bg-gray-50 text-sm font-semibold text-gray-900 sm:flex ${focusRing} ${
                  safeIndex >= firstHidden ? "ring-2 ring-primary-600" : ""
                }`}
              >
                {t("gallery.more", { count: total - firstHidden })}
                <span className="sr-only"> {t("gallery.enlarge")}</span>
              </button>
            )}
          </div>
        </>
      )}
      {/* Tam ekran: Esc kapatır, odak açan düğmeye döner; parmakla yakınlaştırma serbest. */}
      <dialog
        ref={dialogRef}
        aria-label={t("gallery.lightbox", { title })}
        onClose={() => {
          setLightboxOpen(false);
          returnFocusRef.current?.focus();
        }}
        onKeyDown={(e) => navigateByKey(e)}
        className="m-0 h-full max-h-none w-full max-w-none bg-white p-0"
      >
        {lightboxOpen && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2 p-2 sm:p-4">
              <p className="text-sm font-medium text-gray-900">
                <span aria-hidden="true">
                  {t("gallery.position", { index: safeIndex + 1, total })}
                </span>
                <span className="sr-only" aria-live="polite">
                  {t("gallery.counter", { index: safeIndex + 1, total })}
                </span>
              </p>
              <button
                ref={closeRef}
                type="button"
                onClick={() => dialogRef.current?.close()}
                className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-4 text-sm font-medium text-gray-900 hover:bg-gray-100 ${focusRing}`}
              >
                {t("gallery.close")}
              </button>
            </div>
            <div className="relative flex-1 touch-pan-y touch-pinch-zoom" {...swipe}>
              <Image
                src={activeImage}
                alt={imageAlt}
                fill
                loader={unsplashLoader}
                sizes="100vw"
                className="object-contain"
              />
              {total > 1 && prevNext}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
