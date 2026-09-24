import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getLlmClient, type LlmMode, type LlmTool } from "@/lib/llm/client";
import { assertNumbersGrounded, buildFactSet } from "@/lib/llm/guards";
import { optimizeRoute, type CityNode, type RoutePlan } from "@/lib/routing/optimizer";
import { searchProperties } from "@/lib/search";
import { createQuote, type Quote } from "@/lib/pricing/quote";
import { ValidationError } from "@/lib/http/errors";
import { formatMoney, money } from "@/lib/money/money";
import { addDays, monthOf, parseIsoDate, todayUtc, type IsoDate } from "@/lib/time/nights";

/**
 * Trip-planner copilot (P1-6).
 *
 * Plan DETERMİNİSTİK üretilir: rota (Held-Karp), şehir başına gece dağılımı, her şehirde
 * en iyi skorlu uygun konaklama ve `computeTotal` teklifi. Toplam = tekliflerin toplamı.
 * LLM yalnızca araç çağırır (searchStays / optimizeRoute / quoteStay) ve Türkçe anlatım
 * yazar; anlatımdaki her fiyat/tarih/sayı araç çıktılarında veya planda olmalıdır —
 * değilse demo anlatımına düşülür. Rezervasyon ASLA otomatik yapılmaz ("Tut" butonu).
 */

export interface TripRequest {
  cities: string[];
  days: number;
  guests: number;
  startDate?: string;
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
}

const norm = (s: string) => s.trim().toLocaleLowerCase("tr-TR");

async function resolveCities(names: string[]): Promise<CityNode[]> {
  const rows = await prisma.location.findMany({
    where: { OR: names.map((n) => ({ city: { equals: n.trim(), mode: "insensitive" as const } })) },
    select: { city: true, latitude: true, longitude: true },
  });
  const byKey = new Map(rows.map((r) => [norm(r.city), r]));
  return names.map((n) => {
    const hit = byKey.get(norm(n));
    if (!hit || hit.latitude == null || hit.longitude == null) {
      throw new ValidationError(`Şehir bulunamadı: ${n}`);
    }
    return { id: hit.city, name: hit.city, lat: hit.latitude, lng: hit.longitude };
  });
}

async function bestStay(
  city: string,
  checkIn: IsoDate,
  checkOut: IsoDate,
  guests: number
): Promise<TripStop["stay"]> {
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
        propertyId: r.id,
        title: r.title,
        roomId: quote.roomId,
        quoteId: quote.quoteId,
        total: quote.total,
        currency: quote.currency,
      };
    } catch {
      // bu oda artık uygun değil → sıradaki sonuç
    }
  }
  return null;
}

/** Deterministik plan (demo çıktısı ve canlı anlatımın olgu kaynağı). */
export async function buildTripPlan(
  req: TripRequest
): Promise<Omit<TripPlan, "narrative" | "llmMode">> {
  if (req.cities.length < 1 || req.cities.length > 6) throw new ValidationError("1–6 şehir seçin");
  if (req.days < req.cities.length || req.days > 30)
    throw new ValidationError("Gün sayısı şehir sayısı ile 30 arasında olmalı");
  const nodes = await resolveCities(req.cities);
  const start = req.startDate ? parseIsoDate(req.startDate) : addDays(todayUtc(), 14);
  const route = optimizeRoute(nodes.slice(1), nodes[0], monthOf(start));

  const base = Math.floor(req.days / route.order.length);
  const extra = req.days % route.order.length;
  const stops: TripStop[] = [];
  let cursor = start;
  for (const [i, city] of route.order.entries()) {
    const nights = base + (i < extra ? 1 : 0);
    const checkOut = addDays(cursor, nights);
    stops.push({
      city,
      checkIn: cursor,
      checkOut,
      nights,
      stay: await bestStay(city, cursor, checkOut, req.guests),
    });
    cursor = checkOut;
  }
  const priced = stops.filter((s) => s.stay);
  const currency = priced[0]?.stay?.currency ?? "TRY";
  const total = priced
    .filter((s) => s.stay!.currency === currency)
    .reduce((sum, s) => sum + s.stay!.total, 0);
  return { route, stops, total, currency };
}

function demoNarrative(plan: Omit<TripPlan, "narrative" | "llmMode">, guests: number): string {
  const parts = plan.stops.map((s) =>
    s.stay
      ? `${s.city}: ${s.checkIn} – ${s.checkOut} (${s.nights} gece), ${s.stay.title}, ${formatMoney(money(s.stay.total, s.stay.currency))}.`
      : `${s.city}: ${s.checkIn} – ${s.checkOut} (${s.nights} gece) için uygun konaklama bulunamadı.`
  );
  return [
    `${guests} kişilik ${plan.stops.reduce((s, x) => s + x.nights, 0)} gecelik rota: ${plan.route.order.join(" → ")} (toplam ${plan.route.totalKm} km).`,
    ...parts,
    `Konaklamaların vergiler dahil toplamı ${formatMoney(money(plan.total, plan.currency))}. Rezervasyon yapılmadı; her durak için "Tut" ile odayı ayırabilirsiniz.`,
  ].join("\n");
}

export async function planTrip(req: TripRequest): Promise<TripPlan> {
  const plan = await buildTripPlan(req);
  const demo = () => ({ narrative: demoNarrative(plan, req.guests) });
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
        total: formatMoney(money(plan.total, plan.currency)),
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
          "Türkçe gezi planı anlatıcısısın. Araçları çağırıp sonuçlarına dayanarak kısa bir plan anlatımı yaz. " +
          'Araç çıktısında olmayan fiyat, tarih veya sayı YAZMA. Rezervasyon yapma. Yalnızca JSON: {"narrative": "..."}',
      },
      { role: "user", content: `${req.cities.join(", ")} — ${req.days} gün, ${req.guests} kişi.` },
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
          demoNarrative(plan, req.guests),
          ...calls.map((c) => JSON.stringify(c.result)),
        ]);
        assertNumbersGrounded(data.narrative, facts);
      },
    }
  );
  return { ...plan, narrative: result.data.narrative, llmMode: result.llmMode };
}
