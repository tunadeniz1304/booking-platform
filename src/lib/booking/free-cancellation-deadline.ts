/**
 * Rezervasyon anındaki iptal politikasından (`Booking.policySnapshot`) ücretsiz iptal son anı.
 *
 * Kurallar `computeRefund` (src/lib/booking/cancellation.ts) ile aynıdır: check-in anına kalan
 * saat, tam iade veren basamakların en küçüğüne eşit/büyükse tam iade; cayma penceresi
 * (`graceHours`) varsa son an onunla uzar. İstemcide çalışır: Temporal polyfill'i paket boyutunu
 * büyütmesin diye tesis saat dilimi Intl ile çözülür.
 */

export interface PolicySnapshotView {
  kind?: string;
  rules?: {
    tiers?: Array<{ hoursBefore: number; refundPercent: number }>;
    graceHours?: number;
    graceMinLeadHours?: number;
  };
}

const HOUR_MS = 3_600_000;
const DEFAULT_TIME_ZONE = "Europe/Istanbul";
const DEFAULT_CHECK_IN_TIME = "15:00";

/** Bir anın verilen saat dilimindeki UTC farkı (ms). */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return local - Math.floor(at / 1000) * 1000;
}

/** Tesis saat dilimindeki "YYYY-MM-DD" + "SS:DD" yerel zamanının UTC anı; geçersizse null. */
export function zonedInstant(date: string, time: string, timeZone: string): number | null {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return null;
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  try {
    // İkinci tur, yaz saati geçişinde farkın değiştiği durumu düzeltir.
    const first = wall - zoneOffsetMs(wall, timeZone);
    return wall - zoneOffsetMs(first, timeZone);
  } catch {
    return null;
  }
}

export type FreeCancellation =
  { kind: "until"; deadline: Date } | { kind: "ended"; deadline: Date } | { kind: "none" };

/**
 * Ücretsiz iptal durumu: son an gelecekteyse "until", geçtiyse "ended", politika hiç tam iade
 * vermiyorsa "none". Politika okunamazsa null (arayüz bir şey göstermez).
 */
export function freeCancellation(
  snapshot: PolicySnapshotView | null | undefined,
  stay: {
    checkIn: string;
    createdAt?: string | null;
    timeZone?: string | null;
    checkInTime?: string | null;
  },
  now: number = Date.now()
): FreeCancellation | null {
  const tiers = snapshot?.rules?.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const start = zonedInstant(
    stay.checkIn,
    stay.checkInTime || DEFAULT_CHECK_IN_TIME,
    stay.timeZone || DEFAULT_TIME_ZONE
  );
  if (start === null) return null;

  // En cömert basamaktan başlayarak art arda tam iade veren basamakların en küçük saati.
  let fullHours: number | null = null;
  for (const tier of [...tiers].sort((a, b) => b.hoursBefore - a.hoursBefore)) {
    if (tier.refundPercent < 100) break;
    fullHours = tier.hoursBefore;
  }
  let deadline = fullHours === null ? null : start - fullHours * HOUR_MS;

  const { graceHours, graceMinLeadHours = 0 } = snapshot?.rules ?? {};
  const created = stay.createdAt ? Date.parse(stay.createdAt) : NaN;
  if (graceHours !== undefined && Number.isFinite(created)) {
    if ((start - created) / HOUR_MS >= graceMinLeadHours) {
      const graceEnd = Math.min(created + graceHours * HOUR_MS, start);
      deadline = deadline === null ? graceEnd : Math.max(deadline, graceEnd);
    }
  }

  if (deadline === null) return { kind: "none" };
  return { kind: deadline > now ? "until" : "ended", deadline: new Date(deadline) };
}
