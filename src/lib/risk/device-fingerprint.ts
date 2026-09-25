/**
 * İstemci cihaz izi (P1-8) — kendi küçük hash'imiz, üçüncü taraf kütüphane yok.
 *
 * Girdi yalnızca kaba, düşük entropili sinyallerdir (ekran boyutu/renk derinliği, saat
 * dilimi, dil listesi, platform); kimlik tespiti değil, "aynı cihaz mı" sinyalidir. Sonuç
 * FNV-1a 32-bit hash'lerinin iki farklı tohumla birleşimi (16 hex). Fraud kuralları bu değeri
 * yalnızca sayar (yeni cihaz / aynı cihazda çok hesap); ham sinyaller sunucuya gönderilmez.
 */
export interface DeviceTraits {
  screen: string;
  timeZone: string;
  languages: string;
  platform: string;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const ALT_SEED = 0x9e3779b9;

export function fnv1a(input: string, seed = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function fingerprintOf(traits: DeviceTraits): string {
  const canonical = [traits.screen, traits.timeZone, traits.languages, traits.platform].join("|");
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  return hex(fnv1a(canonical)) + hex(fnv1a(canonical, ALT_SEED));
}

/** Tarayıcıda sinyalleri toplar; SSR'da (window yok) null döner. */
export function collectDeviceTraits(): DeviceTraits | null {
  if (typeof window === "undefined") return null;
  const s = window.screen;
  return {
    screen: s ? `${s.width}x${s.height}x${s.colorDepth}` : "?",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "?",
    languages: (navigator.languages ?? [navigator.language]).join(","),
    platform: navigator.platform ?? "?",
  };
}

export function deviceFingerprint(): string | null {
  const traits = collectDeviceTraits();
  return traits ? fingerprintOf(traits) : null;
}
