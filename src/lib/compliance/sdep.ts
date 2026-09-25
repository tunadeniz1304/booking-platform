import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/http/errors";

/**
 * P1-10 SDEP (AB 2024/1028 "Single Digital Entry Point") aylık veri paylaşımı:
 * kayıt numarası başına o ay içinde konaklanan gece ve misafir sayısı. Kişisel veri
 * içermez (ad, e-posta yok) — yalnızca toplamlar.
 */

export const SDEP_HEADER = [
  "period",
  "registration_number",
  "country",
  "city",
  "stays",
  "nights",
  "guests",
] as const;

export const sdepRowSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  registration_number: z.string().min(1),
  country: z.string().min(1),
  city: z.string().min(1),
  stays: z.number().int().min(1),
  nights: z.number().int().min(1),
  guests: z.number().int().min(1),
});
export type SdepRow = z.infer<typeof sdepRowSchema>;

const DAY_MS = 86_400_000;

/** "YYYY-MM" → [ayın ilk günü, sonraki ayın ilk günü) UTC. */
export function monthRange(period: string): { start: Date; end: Date } {
  if (!sdepRowSchema.shape.period.safeParse(period).success) {
    throw new ValidationError("Dönem YYYY-AA biçiminde olmalı");
  }
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** Konaklamanın [start, end) aralığına düşen gece sayısı (gece = giriş günü). */
export function nightsInRange(checkIn: Date, checkOut: Date, start: Date, end: Date): number {
  const from = Math.max(checkIn.getTime(), start.getTime());
  const to = Math.min(checkOut.getTime(), end.getTime());
  return to > from ? Math.round((to - from) / DAY_MS) : 0;
}

export async function buildSdepRows(period: string): Promise<SdepRow[]> {
  const { start, end } = monthRange(period);
  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ["CONFIRMED", "COMPLETED"] },
      checkIn: { lt: end },
      checkOut: { gt: start },
      property: { licenseNumber: { not: null } },
    },
    select: {
      checkIn: true,
      checkOut: true,
      guestCount: true,
      units: true,
      property: {
        select: { licenseNumber: true, location: { select: { country: true, city: true } } },
      },
    },
  });
  const rows = new Map<string, SdepRow>();
  for (const b of bookings) {
    const nights = nightsInRange(b.checkIn, b.checkOut, start, end) * b.units;
    const reg = b.property.licenseNumber;
    if (!reg || nights === 0) continue;
    const row = rows.get(reg) ?? {
      period,
      registration_number: reg,
      country: b.property.location.country,
      city: b.property.location.city,
      stays: 0,
      nights: 0,
      guests: 0,
    };
    row.stays += 1;
    row.nights += nights;
    row.guests += b.guestCount;
    rows.set(reg, row);
  }
  return [...rows.values()].sort((a, b) =>
    a.registration_number.localeCompare(b.registration_number)
  );
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // CSV/formül enjeksiyonu: tırnak, ayraç, satır sonu kaçışlanır; =,+,-,@ ile başlayan metin önekle nötrlenir.
  const safe = /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toSdepCsv(rows: SdepRow[]): string {
  const lines = [SDEP_HEADER.join(",")];
  for (const r of rows) lines.push(SDEP_HEADER.map((k) => csvCell(r[k])).join(","));
  return lines.join("\n") + "\n";
}

/** Varsayılan dönem: bir önceki takvim ayı (UTC). */
export function previousPeriod(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
