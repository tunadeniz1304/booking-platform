import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getLlmClient, type LlmMode, type LlmTool } from "@/lib/llm/client";
import { assertNumbersGrounded, buildFactSet } from "@/lib/llm/guards";
import { optimizeRoute, type CityNode, type RoutePlan } from "@/lib/routing/optimizer";
import { searchProperties } from "@/lib/search";
import { createQuote, type Quote } from "@/lib/pricing/quote";
import { ValidationError } from "@/lib/http/errors";
import { getConfig } from "@/lib/config/app-config";
import { createFormatter } from "@/lib/i18n/format";
import { normalizePlace } from "@/lib/search/normalize-place";
import { addDays, monthOf, parseIsoDate, todayUtc, type IsoDate } from "@/lib/time/nights";

/**
 * Trip-planner copilot (P1-6).
 *
 * Plan DETERMİNİSTİK üretilir: rota (Held-Karp), şehir başına gece dağılımı, her şehirde
 * en iyi skorlu uygun konaklama ve `computeTotal` teklifi. Toplam = tekliflerin toplamı.
 * LLM yalnızca araç çağırır (searchStays / optimizeRoute / quoteStay) ve istenen dilde (tr/en)
 * anlatım yazar; anlatımdaki her fiyat/tarih/sayı araç çıktılarında veya planda olmalıdır —
 * değilse demo anlatımına düşülür. Rezervasyon ASLA otomatik yapılmaz («Odayı ayır» düğmesi).
 */

export type TripLocale = "tr" | "en";

export interface TripRequest {
  cities: string[];
  /** Toplam gece sayısı (duraklara dağıtılır). */
  days: number;
  guests: number;
  startDate?: string;
  /** Anlatımın dili; verilmezse Türkçe. */
  locale?: TripLocale;
}

export interface TripStop {
  city: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  nights: number;
  stay: null | {
    propertyId: string;
    title: string;
    roomId: string;
    quoteId: string;
    total: number;
    currency: string;
  };
}

export interface TripPlan {
  route: RoutePlan;
  stops: TripStop[];
  total: number;
  currency: string;
  narrative: string;
  llmMode: LlmMode;
  /** Anlatımın dili (istemci `lang` olarak işaretler). */
  narrativeLocale: TripLocale;
  /** Durak tekliflerinin en erken bitiş zamanı (ISO); fiyatlı durak yoksa `null`. */
  quoteExpiresAt: string | null;
  /** "Odayı ayır" ile odanın ayrıldığı süre (dakika). */
  holdMinutes: number;
}

/** Anlatımın olgu kaynağı olan deterministik plan (eval'ler de bu biçimi kurar). */
export type TripPlanCore = Omit<
  TripPlan,
  "narrative" | "llmMode" | "narrativeLocale" | "quoteExpiresAt" | "holdMinutes"
>;

/** Yaygın yabancı şehir adları (normalleştirilmiş) → veritabanındaki (Türkçe) ad. */
const CITY_ALIASES = new Map<string, string>([
  ["cappadocia", "Kapadokya"],
  ["rome", "Roma"],
  ["barcelona", "Barselona"],
  ["vienna", "Viyana"],
  ["wien", "Viyana"],
  ["london", "Londra"],
]);

function tripLocale(req: TripRequest): TripLocale {
  return req.locale === "en" ? "en" : "tr";
}

async function resolveCities(names: string[]): Promise<CityNode[]> {
  const rows = await prisma.location.findMany({
    where: { latitude: { not: null }, longitude: { not: null } },
    select: { city: true, latitude: true, longitude: true },
  });
  // Büyük/küçük harf, aksan ve İ/ı duyarsız: "Cesme" → Çeşme, "Istanbul" → İstanbul.
  const byKey = new Map(rows.map((r) => [normalizePlace(r.city), r]));
  return names.map((n) => {
    const key = normalizePlace(n);
    const alias = CITY_ALIASES.get(key);
    const hit = byKey.get(key) ?? (alias ? byKey.get(normalizePlace(alias)) : undefined);
    if (!hit || hit.latitude == null || hit.longitude == null) {
      const msg = `Şehir bulunamadı: ${n}`;
      throw new ValidationError(msg, { fieldErrors: { cities: [msg] } });
    }
    return { id: hit.city, name: hit.city, lat: hit.latitude, lng: hit.longitude };
  });
}

interface StayPick {
  stay: NonNullable<TripStop["stay"]>;
  /** Teklifin bitiş zamanı (ISO); plana yalnızca en erkeni girer. */
  expiresAt: string;
}

async function bestStay(
  city: string,
  checkIn: IsoDate,
  checkOut: IsoDate,
  guests: number
): Promise<StayPick | null> {
  const res = await searchProperties({
    city,
    checkIn,
    checkOut,
    guests,
    sort: "recommended",
    page: 1,
    pageSize: 5,
  });
  for (const r of res.results) {
    if (!r.quote) continue;
    try {
      const quote: Quote = await createQuote({
        roomId: r.quote.roomId,
        propertyId: r.id,
        checkIn,
        checkOut,
        guests,
      });
      return {
        stay: {
          propertyId: r.id,
          title: r.title,
          roomId: quote.roomId,
          quoteId: quote.quoteId,
          total: quote.total,
          currency: quote.currency,
        },
        expiresAt: quote.expiresAt,
      };
    } catch {
      // bu oda artık uygun değil → sıradaki sonuç
    }
  }
  return null;
}

/** Deterministik plan (demo çıktısı ve canlı anlatımın olgu kaynağı). */
async function buildTripPlan(
  req: TripRequest
): Promise<TripPlanCore & { quoteExpiresAt: string | null }> {
  if (req.cities.length < 1 || req.cities.length > 6) {
    const msg = "1–6 şehir seçin";
    throw new ValidationError(msg, { fieldErrors: { cities: [msg] } });
  }
  if (req.days < req.cities.length || req.days > 30) {
    const msg = "Gece sayısı şehir sayısı ile 30 arasında olmalı";
    throw new ValidationError(msg, { fieldErrors: { days: [msg] } });
  }
  const nodes = await resolveCities(req.cities);
  const start = req.startDate ? parseIsoDate(req.startDate) : addDays(todayUtc(), 14);
  const route = optimizeRoute(nodes.slice(1), nodes[0], monthOf(start));

  const base = Math.floor(req.days / route.order.length);
  const extra = req.days % route.order.length;
  const stops: TripStop[] = [];
  let quoteExpiresAt: string | null = null;
  let cursor = start;
  for (const [i, city] of route.order.entries()) {
    const nights = base + (i < extra ? 1 : 0);
    const checkOut = addDays(cursor, nights);
    const pick = await bestStay(city, cursor, checkOut, req.guests);
    if (pick && (quoteExpiresAt === null || pick.expiresAt < quoteExpiresAt)) {
      quoteExpiresAt = pick.expiresAt;
    }
    stops.push({ city, checkIn: cursor, checkOut, nights, stay: pick?.stay ?? null });
    cursor = checkOut;
  }
  const priced = stops.filter((s) => s.stay);
  const currency = priced[0]?.stay?.currency ?? "TRY";
  const total = priced
    .filter((s) => s.stay!.currency === currency)
    .reduce((sum, s) => sum + s.stay!.total, 0);
  return { route, stops, total, currency, quoteExpiresAt };
}

/** Deterministik anlatım; tarih ve tutarlar arayüz dilinin biçimindedir. */
function demoNarrative(plan: TripPlanCore, guests: number, locale: TripLocale): string {
  const f = createFormatter(locale);
  const nights = plan.stops.reduce((s, x) => s + x.nights, 0);
  const order = plan.route.order.join(" → ");
  const total = f.money(plan.total, plan.currency);
  if (locale === "en") {
    const n = (count: number) => `${count} ${count === 1 ? "night" : "nights"}`;
    const parts = plan.stops.map((s) => {
      const range = `${s.city}: ${f.date(s.checkIn)} – ${f.date(s.checkOut)} (${n(s.nights)})`;
      return s.stay
        ? `${range}, ${s.stay.title}, ${f.money(s.stay.total, s.stay.currency)}.`
        : `${range}: no available stay found.`;
    });
    return [
      `${n(nights)} route for ${guests} ${guests === 1 ? "guest" : "guests"}: ${order} (${plan.route.totalKm} km in total).`,
      ...parts,
      `Total for all stays, taxes included: ${total}. Nothing has been booked; use "Hold room" at each stop to hold the room.`,
    ].join("\n");
  }
  const parts = plan.stops.map((s) => {
    const range = `${s.city}: ${f.date(s.checkIn)} – ${f.date(s.checkOut)} (${s.nights} gece)`;
    return s.stay
      ? `${range}, ${s.stay.title}, ${f.money(s.stay.total, s.stay.currency)}.`
      : `${range} için uygun konaklama bulunamadı.`;
  });
  return [
    `${guests} kişilik ${nights} gecelik rota: ${order} (toplam ${plan.route.totalKm} km).`,
    ...parts,
    `Konaklamaların vergiler dahil toplamı ${total}. Rezervasyon yapılmadı; odayı ayırmak için her durakta «Odayı ayır» düğmesini kullanın.`,
  ].join("\n");
}

export async function planTrip(req: TripRequest): Promise<TripPlan> {
  // Teklif bitişi anlatımın olgu kümesine girmez (saat/dakika sayıları guard'ı gevşetmesin).
  const { quoteExpiresAt, ...plan } = await buildTripPlan(req);
  const { narrative, llmMode } = await narrateTripPlan(req, plan);
  return {
    ...plan,
    narrative,
    llmMode,
    narrativeLocale: tripLocale(req),
    quoteExpiresAt,
    holdMinutes: getConfig().BOOKING_HOLD_TTL_MINUTES,
  };
}

/**
 * Saf çekirdek (P1-5 eval'leri de çağırır): deterministik plandan araç çağrılı anlatım.
 * DB/arama yok; sayı guard'ı ihlali → demo anlatımı.
 */
export async function narrateTripPlan(
  req: TripRequest,
  plan: TripPlanCore
): Promise<{ narrative: string; llmMode: LlmMode }> {
  const locale = tripLocale(req);
  const demo = () => ({ narrative: demoNarrative(plan, req.guests, locale) });
  const tools: LlmTool[] = [
    {
      name: "optimizeRoute",
      description: "Şehirlerin optimum ziyaret sırası ve mesafeleri",
      parameters: { type: "object", properties: {} },
      execute: async () => plan.route,
    },
    {
      name: "searchStays",
      description: "Her durak için seçilen konaklama ve tarihleri",
      parameters: { type: "object", properties: {} },
      execute: async () => plan.stops,
    },
    {
      name: "quoteStay",
      description: "Vergiler dahil toplam fiyat (minor-unit ve biçimli)",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        totalMinor: plan.total,
        total: createFormatter(locale).money(plan.total, plan.currency),
        currency: plan.currency,
      }),
    },
  ];
  const result = await getLlmClient().runTools(
    "trip_plan",
    z.object({ narrative: z.string().min(10).max(3000) }),
    [
      {
        role: "system",
        content:
          "Gezi planı anlatıcısısın. Araçları çağırıp sonuçlarına dayanarak kısa bir plan anlatımı yaz. " +
          `Anlatım dili: ${locale === "en" ? "İngilizce" : "Türkçe"}; tarihleri bu dilin günlük biçiminde yaz (ISO değil). ` +
          'Araç çıktısında olmayan fiyat, tarih veya sayı YAZMA. Rezervasyon yapma. Yalnızca JSON: {"narrative": "..."}',
      },
      { role: "user", content: `${req.cities.join(", ")} — ${req.days} gece, ${req.guests} kişi.` },
    ],
    tools,
    {
      demo,
      validateWithTools: (data, calls) => {
        const facts = buildFactSet([
          req.days,
          req.guests,
          plan.total,
          plan.route.totalKm,
          JSON.stringify(plan),
          demoNarrative(plan, req.guests, locale),
          ...calls.map((c) => JSON.stringify(c.result)),
        ]);
        assertNumbersGrounded(data.narrative, facts);
      },
    }
  );
  return { narrative: result.data.narrative, llmMode: result.llmMode };
}
