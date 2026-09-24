import type { ImageLoaderProps } from "next/image";

const UNSPLASH_HOST = "images.unsplash.com";
const DEFAULT_QUALITY = 60;

/**
 * `next/image` loader'ı: Unsplash (imgix) görsellerini CDN'de istenen genişliğe
 * ölçekletir (`w`, `q`, `auto=format` → WebP/AVIF). Böylece `srcset` mobilde küçük
 * görsel indirir ve Next görsel optimizer'ına (sunucu hop'u) gerek kalmaz.
 * Diğer kaynaklar (ör. yerel `/demo/…`) olduğu gibi döner.
 */
export function unsplashLoader({ src, width, quality }: ImageLoaderProps): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }
  if (url.hostname !== UNSPLASH_HOST) return src;
  url.searchParams.set("w", String(width));
  url.searchParams.set("q", String(quality ?? DEFAULT_QUALITY));
  url.searchParams.set("auto", "format");
  if (!url.searchParams.has("fit")) url.searchParams.set("fit", "crop");
  return url.toString();
}
