/**
 * UTC "gece" tipi — tüm konaklama tarih hesabının tek kaynağı.
 *
 * Bir gece `YYYY-MM-DD` (ISO takvim günü) ile temsil edilir ve yerel saat dilimi
 * hiç kullanılmaz (`setHours`/`getMonth` YOK). Veritabanındaki `@db.Date` sütunları
 * UTC gece yarısı `Date` olarak okunur/yazılır. Konaklama aralığı yarı açıktır:
 * `[checkIn, checkOut)` → gece sayısı = checkOut − checkIn.
 */

import { Temporal } from "@js-temporal/polyfill";

declare const isoDateBrand: unique symbol;
export type IsoDate = string & { readonly [isoDateBrand]: true };

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export class DateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DateRangeError";
  }
}

export function isIsoDate(value: string): value is IsoDate {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function parseIsoDate(value: string): IsoDate {
  const trimmed = value.trim();
  if (!isIsoDate(trimmed)) throw new DateRangeError(`Geçersiz tarih: ${value}`);
  return trimmed;
}

/** `@db.Date` sütunu için UTC gece yarısı. */
export function toDbDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** `Date` (UTC) → IsoDate. */
export function fromDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10) as IsoDate;
}

export function todayUtc(now: Date = new Date()): IsoDate {
  return fromDate(now);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDate(new Date(toDbDate(date).getTime() + days * DAY_MS));
}

/** İki gün arasındaki fark (b − a) gün cinsinden. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toDbDate(b).getTime() - toDbDate(a).getTime()) / DAY_MS);
}

/** Konaklama geceleri: `[checkIn, checkOut)`. */
export function nightsBetween(checkIn: IsoDate, checkOut: IsoDate): IsoDate[] {
  const count = diffDays(checkIn, checkOut);
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(checkIn, i));
}

/** Haftanın günü (UTC): 0 = Pazar … 6 = Cumartesi. */
export function dayOfWeek(date: IsoDate): number {
  return toDbDate(date).getUTCDay();
}

/** Ay (UTC): 1–12. */
export function monthOf(date: IsoDate): number {
  return toDbDate(date).getUTCMonth() + 1;
}

export interface StayRange {
  checkIn: IsoDate;
  checkOut: IsoDate;
  nights: IsoDate[];
}

/**
 * Konaklama aralığını doğrular: checkIn < checkOut, geçmişte değil,
 * en fazla `maxNights` gece.
 */
export function parseStay(
  checkIn: string,
  checkOut: string,
  opts: { maxNights: number; today?: IsoDate }
): StayRange {
  const ci = parseIsoDate(checkIn);
  const co = parseIsoDate(checkOut);
  if (diffDays(ci, co) <= 0) throw new DateRangeError("Çıkış tarihi girişten sonra olmalıdır");
  if (diffDays(opts.today ?? todayUtc(), ci) < 0)
    throw new DateRangeError("Giriş tarihi geçmişte olamaz");
  const nights = nightsBetween(ci, co);
  if (nights.length > opts.maxNights) {
    throw new DateRangeError(`Konaklama ${opts.maxNights} geceyi aşamaz`);
  }
  return { checkIn: ci, checkOut: co, nights };
}

// --- Tesis saat dilimi (v3 P0-3, ADR 0011) -------------------------------------------------

/** Varsayılan tesis saat dilimi ve giriş/çıkış saatleri (Türkiye). */
export const DEFAULT_TIME_ZONE = "Europe/Istanbul";
export const DEFAULT_CHECK_IN_TIME = "15:00";
export const DEFAULT_CHECK_OUT_TIME = "11:00";

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface PropertyClock {
  timeZone: string;
  checkInTime: string;
  checkOutTime: string;
}

/** Geçerli bir IANA saat dilimi mi? */
export function isValidTimeZone(tz: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(tz);
    return true;
  } catch {
    return false;
  }
}

function hhmm(value: string): { hour: number; minute: number } {
  const m = HHMM_RE.exec(value);
  if (!m) throw new DateRangeError(`Geçersiz saat: ${value} (SS:DD bekleniyor)`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Tesisin yerel takvimine göre "bugün" (Tokyo'da UTC gün sınırı yerel 09:00'dır). */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString() as IsoDate;
}

/** Yerel `date` + `time` (SS:DD) anının UTC karşılığı; DST boşluklarında "compatible". */
export function localInstant(date: IsoDate, time: string, timeZone: string): Date {
  const { hour, minute } = hhmm(time);
  const zdt = Temporal.PlainDate.from(date)
    .toPlainDateTime({ hour, minute })
    .toZonedDateTime(timeZone, { disambiguation: "compatible" });
  return new Date(zdt.epochMilliseconds);
}

/** Giriş anı: giriş günü, tesisin giriş saatinde (tesis saat diliminde). */
export function checkInAt(checkIn: IsoDate, clock: PropertyClock): Date {
  return localInstant(checkIn, clock.checkInTime, clock.timeZone);
}

/** Çıkış anı: çıkış günü, tesisin çıkış saatinde. */
export function checkOutAt(checkOut: IsoDate, clock: PropertyClock): Date {
  return localInstant(checkOut, clock.checkOutTime, clock.timeZone);
}

/** Bir anın tesis saat dilimindeki takvim günü (iCal DATE-TIME → gece). */
export function localDateOf(instant: Date, timeZone: string): IsoDate {
  return todayIn(timeZone, instant);
}

/** Tesis bilgisinden saat (eksik alanlar varsayılanla). */
export function clockOf(p: {
  timeZone?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
}): PropertyClock {
  return {
    timeZone: p.timeZone || DEFAULT_TIME_ZONE,
    checkInTime: p.checkInTime || DEFAULT_CHECK_IN_TIME,
    checkOutTime: p.checkOutTime || DEFAULT_CHECK_OUT_TIME,
  };
}
