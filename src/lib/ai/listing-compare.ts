import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { getLlmClient, type LlmClient, type LlmMode } from "@/lib/llm/client";
import {
  assertNumbersGrounded,
  buildFactSet,
  type FactSet,
  type FactValue,
} from "@/lib/llm/guards";
import { createQuote } from "@/lib/pricing/quote";
import { toSnapshot, type PolicyKind } from "@/lib/booking/cancellation";
import { formatMoney, money, toDecimalString } from "@/lib/money/money";
import { NotFoundError, ValidationError } from "@/lib/http/errors";

/**
 * İlan karşılaştırma (v4 P1-9). Yapılandırılmış fark deterministik koddan gelir:
 * olanaklar, iptal politikası, puan ve TOPLAM FİYAT — toplam, `/api/quote`'un çağırdığı
 * teklif motoru fonksiyonuyla (`createQuote`) hesaplanır; burada fiyat hesabı YOKTUR.
 * LLM yalnızca bu veriyi anlatan kısa bir yorum yazar (`ai_generated`); yorumdaki her
 * sayı yapılandırılmış veride bulunmalıdır (sayı guard'ı), aksi hâlde şablon yoruma
 * (`fallback`) düşülür. Demo modda şablon yorum kullanılır.
 */

export type CompareLocale = "tr" | "en";

export interface CompareRequest {
  ids: string[];
  checkIn?: string;
  checkOut?: string;
  guests: number;
  currency?: string;
  locale: CompareLocale;
}

export type PriceUnavailableReason = "NO_DATES" | "NO_ROOM_FOR_GUESTS" | "UNAVAILABLE";

export interface ComparePrice {
  available: boolean;
  /** Tahsil edilecek toplam (minor-unit; teklif motorunun `charge.total`'ı). */
  total: number | null;
  currency: string | null;
  nights: number | null;
  roomId: string | null;
  ratePlanId: string | null;
  quoteId: string | null;
  reason?: PriceUnavailableReason;
}

export interface CompareListing {
  id: string;
  title: string;
  city: string;
  country: string;
  propertyType: string;
  rating: { avg: number; count: number };
  amenities: string[];
  cancellation: { kind: PolicyKind; freeCancellationHours: number | null };
  price: ComparePrice;
}

export interface CompareDiff {
  commonAmenities: string[];
  uniqueAmenities: Record<string, string[]>;
  cheapestId: string | null;
  bestRatedId: string | null;
  mostFlexibleId: string | null;
}

export interface CompareResult {
  checkIn: string | null;
  checkOut: string | null;
  guests: number;
  listings: CompareListing[];
  diff: CompareDiff;
  commentary: { text: string; llmMode: LlmMode };
}

const FLEX_RANK: Record<PolicyKind, number> = {
  FLEXIBLE: 3,
  MODERATE: 2,
  STRICT: 1,
  NON_REFUNDABLE: 0,
};

/** 100% iadeli en geç iptal süresi (saat); tam iadeli kademe yoksa null. */
export function freeCancellationHours(
  tiers: readonly { hoursBefore: number; refundPercent: number }[]
): number | null {
  const full = tiers.filter((t) => t.refundPercent >= 100).map((t) => t.hoursBefore);
  return full.length > 0 ? Math.min(...full) : null;
}

/** Yapılandırılmış fark (saf; eşitlikte istek sırasındaki ilk ilan kazanır). */
export function buildCompareDiff(listings: readonly CompareListing[]): CompareDiff {
  const sets = listings.map((l) => new Set(l.amenities));
  const all = [...new Set(listings.flatMap((l) => l.amenities))].sort((a, b) => a.localeCompare(b));
  const commonAmenities = all.filter((a) => sets.every((s) => s.has(a)));
  const uniqueAmenities: Record<string, string[]> = {};
  listings.forEach((l, i) => {
    uniqueAmenities[l.id] = all.filter(
      (a) => sets[i].has(a) && sets.every((s, j) => j === i || !s.has(a))
    );
  });

  const priced = listings.filter((l) => l.price.available && l.price.total !== null);
  const currencies = new Set(priced.map((l) => l.price.currency));
  let cheapestId: string | null = null;
  if (priced.length > 0 && currencies.size === 1) {
    cheapestId = priced.reduce((best, l) => (l.price.total! < best.price.total! ? l : best)).id;
  }

  const rated = listings.filter((l) => l.rating.count > 0);
  const bestRatedId =
    rated.length > 0
      ? rated.reduce((best, l) =>
          l.rating.avg > best.rating.avg ||
          (l.rating.avg === best.rating.avg && l.rating.count > best.rating.count)
            ? l
            : best
        ).id
      : null;

  const flexRank = (l: CompareListing) =>
    FLEX_RANK[l.cancellation.kind] * 10_000 - (l.cancellation.freeCancellationHours ?? 9_999);
  const mostFlexibleId =
    listings.length > 0
      ? listings.reduce((best, l) => (flexRank(l) > flexRank(best) ? l : best)).id
      : null;

  return { commonAmenities, uniqueAmenities, cheapestId, bestRatedId, mostFlexibleId };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function priceLabel(price: ComparePrice, locale: CompareLocale): string | null {
  if (!price.available || price.total === null || !price.currency) return null;
  return formatMoney(money(price.total, price.currency), locale === "tr" ? "tr-TR" : "en-GB");
}

/** Sayı guard'ının olgu kümesi: yorumdaki her sayı buradaki verilerden gelmelidir. */
export function compareFacts(result: Omit<CompareResult, "commentary">): FactSet {
  const values: FactValue[] = [result.listings.length, result.guests, 5, 100];
  if (result.checkIn) values.push(result.checkIn);
  if (result.checkOut) values.push(result.checkOut);
  for (const l of result.listings) {
    values.push(l.title, l.city, l.country, l.rating.avg, round1(l.rating.avg), l.rating.count);
    values.push(l.amenities.length, ...l.amenities);
    const h = l.cancellation.freeCancellationHours;
    if (h !== null) values.push(h, h / 24);
    const p = l.price;
    if (p.available && p.total !== null && p.currency) {
      values.push(p.total, toDecimalString(money(p.total, p.currency)));
      values.push(priceLabel(p, "tr")!, priceLabel(p, "en")!);
      if (p.nights !== null) values.push(p.nights);
    }
  }
  for (const list of Object.values(result.diff.uniqueAmenities)) values.push(list.length);
  values.push(result.diff.commonAmenities.length);
  return buildFactSet(values);
}

const POLICY_LABEL: Record<CompareLocale, Record<PolicyKind, string>> = {
  tr: {
    FLEXIBLE: "esnek",
    MODERATE: "orta",
    STRICT: "katı",
    NON_REFUNDABLE: "iade edilemez",
  },
  en: {
    FLEXIBLE: "flexible",
    MODERATE: "moderate",
    STRICT: "strict",
    NON_REFUNDABLE: "non-refundable",
  },
};

/** Deterministik şablon yorum (demo + fallback); yalnızca yapılandırılmış veriyi anlatır. */
export function demoCommentary(
  result: Omit<CompareResult, "commentary">,
  locale: CompareLocale
): string {
  const byId = new Map(result.listings.map((l) => [l.id, l]));
  const parts: string[] = [];
  const cheapest = result.diff.cheapestId ? byId.get(result.diff.cheapestId) : undefined;
  const best = result.diff.bestRatedId ? byId.get(result.diff.bestRatedId) : undefined;
  const flex = result.diff.mostFlexibleId ? byId.get(result.diff.mostFlexibleId) : undefined;
  const tr = locale === "tr";
  if (cheapest) {
    const label = priceLabel(cheapest.price, locale);
    parts.push(
      tr
        ? `Seçilen tarihler için en düşük toplam fiyat ${cheapest.title} ilanında: ${label}.`
        : `${cheapest.title} has the lowest total for the selected dates: ${label}.`
    );
  } else if (!result.checkIn) {
    parts.push(
      tr
        ? "Toplam fiyatları görmek için giriş-çıkış tarihlerini seçin."
        : "Pick check-in and check-out dates to compare total prices."
    );
  }
  if (best) {
    parts.push(
      tr
        ? `En yüksek misafir puanı ${best.title} ilanında (${round1(best.rating.avg)}/5, ${best.rating.count} yorum).`
        : `${best.title} has the highest guest rating (${round1(best.rating.avg)}/5 from ${best.rating.count} reviews).`
    );
  }
  if (flex) {
    parts.push(
      tr
        ? `En esnek iptal koşulu ${flex.title} ilanında (${POLICY_LABEL.tr[flex.cancellation.kind]}).`
        : `${flex.title} has the most flexible cancellation terms (${POLICY_LABEL.en[flex.cancellation.kind]}).`
    );
  }
  for (const l of result.listings) {
    const unique = result.diff.uniqueAmenities[l.id] ?? [];
    if (unique.length === 0) continue;
    parts.push(
      tr
        ? `Yalnızca ${l.title} ilanında olanlar: ${unique.join(", ")}.`
        : `Only ${l.title} offers: ${unique.join(", ")}.`
    );
  }
  return parts.join(" ");
}

const commentarySchema = z.object({ commentary: z.string().trim().min(1).max(900) });

async function priceFor(
  rooms: readonly { id: string; maxOccupancy: number }[],
  propertyId: string,
  req: CompareRequest
): Promise<ComparePrice> {
  const none = (reason: PriceUnavailableReason): ComparePrice => ({
    available: false,
    total: null,
    currency: null,
    nights: null,
    roomId: null,
    ratePlanId: null,
    quoteId: null,
    reason,
  });
  if (!req.checkIn || !req.checkOut) return none("NO_DATES");
  const fitting = rooms.filter((r) => r.maxOccupancy >= req.guests);
  if (fitting.length === 0) return none("NO_ROOM_FOR_GUESTS");
  let best: ComparePrice | null = null;
  for (const room of fitting) {
    try {
      // Teklif motorunun dışa açık fonksiyonu — `/api/quote` ile aynı çağrı.
      const quote = await createQuote({
        roomId: room.id,
        propertyId,
        checkIn: req.checkIn,
        checkOut: req.checkOut,
        guests: req.guests,
        ...(req.currency ? { currency: req.currency } : {}),
      });
      const total = Number(quote.charge.total);
      if (best === null || total < best.total!) {
        best = {
          available: true,
          total,
          currency: quote.charge.currency,
          nights: quote.nights.length,
          roomId: quote.roomId,
          ratePlanId: quote.ratePlan.id,
          quoteId: quote.quoteId,
        };
      }
    } catch {
      // Dolu / kısıtlı oda: karşılaştırmada "uygun değil" sayılır.
    }
  }
  return best ?? none("UNAVAILABLE");
}

export function validateCompareIds(ids: readonly string[]): string[] {
  const cfg = getConfig();
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length < cfg.COMPARE_MIN_LISTINGS || unique.length > cfg.COMPARE_MAX_LISTINGS) {
    throw new ValidationError(
      `Karşılaştırma için ${cfg.COMPARE_MIN_LISTINGS}–${cfg.COMPARE_MAX_LISTINGS} farklı ilan seçin`
    );
  }
  return unique;
}

export async function compareListings(
  req: CompareRequest,
  deps: { client?: LlmClient } = {}
): Promise<CompareResult> {
  const ids = validateCompareIds(req.ids);
  if ((req.checkIn && !req.checkOut) || (!req.checkIn && req.checkOut)) {
    throw new ValidationError("Giriş ve çıkış tarihi birlikte verilmeli");
  }
  const rows = await prisma.property.findMany({
    where: { id: { in: ids }, isActive: true },
    select: {
      id: true,
      title: true,
      propertyType: true,
      ratingAvg: true,
      ratingCount: true,
      location: { select: { city: true, country: true } },
      amenities: { select: { name: true } },
      cancellationPolicy: { select: { kind: true, version: true, rules: true } },
      rooms: {
        where: { available: true },
        select: { id: true, maxOccupancy: true },
        orderBy: { id: "asc" },
      },
    },
  });
  if (rows.length !== ids.length) throw new NotFoundError("İlan bulunamadı");
  const byId = new Map(rows.map((r) => [r.id, r]));

  const listings: CompareListing[] = [];
  for (const id of ids) {
    const row = byId.get(id)!;
    const policy = toSnapshot(row.cancellationPolicy);
    listings.push({
      id: row.id,
      title: row.title,
      city: row.location.city,
      country: row.location.country,
      propertyType: row.propertyType,
      rating: { avg: round1(row.ratingAvg), count: row.ratingCount },
      amenities: row.amenities.map((a) => a.name).sort((a, b) => a.localeCompare(b)),
      cancellation: {
        kind: policy.kind,
        freeCancellationHours: freeCancellationHours(policy.rules.tiers),
      },
      price: await priceFor(row.rooms, row.id, req),
    });
  }

  const structured = {
    checkIn: req.checkIn ?? null,
    checkOut: req.checkOut ?? null,
    guests: req.guests,
    listings,
    diff: buildCompareDiff(listings),
  };
  const facts = compareFacts(structured);
  const demo = () => ({ commentary: demoCommentary(structured, req.locale) });
  const client = deps.client ?? getLlmClient();
  const lang = req.locale === "tr" ? "Türkçe" : "English";
  const payload = listings.map((l) => ({
    id: l.id,
    title: l.title,
    city: l.city,
    rating: l.rating,
    amenities: l.amenities,
    cancellation: l.cancellation,
    total: priceLabel(l.price, req.locale),
    nights: l.price.nights,
  }));
  const result = await client.completeJson(
    "listing_compare",
    commentarySchema,
    [
      {
        role: "system",
        content:
          `İlan karşılaştırmasını ${lang} dilinde 2-4 cümleyle yorumla. Yalnızca JSON: {"commentary": string}. ` +
          "YALNIZCA verilen veriyi kullan; verilmeyen sayı, fiyat, puan veya tarih YAZMA. " +
          "Kesin tavsiye/karar verme; farkları açıkla.",
      },
      {
        role: "user",
        content: JSON.stringify({
          checkIn: structured.checkIn,
          checkOut: structured.checkOut,
          guests: structured.guests,
          listings: payload,
          diff: structured.diff,
        }),
      },
    ],
    {
      demo,
      validate: (data) => {
        assertNumbersGrounded(data.commentary, facts);
      },
    }
  );
  return { ...structured, commentary: { text: result.data.commentary, llmMode: result.llmMode } };
}
