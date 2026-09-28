/**
 * v5 P1-5 — promptfoo özel sağlayıcısı: uygulamanın GERÇEK LLM çekirdeklerini çağırır.
 *
 * Varsayılan mod demo'dur (`npm run llm:eval` → `LLM_MODE=demo`): ağa çıkılmaz, uygulamanın
 * deterministik demo üreticileri + guard'ları ölçülür. `npm run llm:eval -- --live` yalnız
 * yerelde canlı sağlayıcıyı kullanır (anahtar uygulamanın kendi `.env` yükleyicisinden).
 *
 * Çıktı JSON'dur: `{ task, locale, text, result, facts, meta }` — iddialar (`assertions.ts`)
 * `text` üzerinde şema/grounding/PII/dil/red-team denetimi yapar.
 */
import { generateReviewSummary } from "@/lib/ai/review-summary";
import { generateHostReplyDraft } from "@/lib/messaging/message-service";
import { narrateTripPlan, type TripPlanCore } from "@/lib/ai/trip-planner";
import { optimizeRoute } from "@/lib/routing/optimizer";
import { runWithLlmSubject } from "@/lib/llm/budget";
import { runSupportChat } from "@/lib/support/agent";
import { bookingSummary, cancellationQuote, propertyPolicy } from "@/lib/support/tools";
import { createMemorySupportRepo, sampleSupportBooking } from "@/lib/support/memory-repo";
import { addDays, type IsoDate } from "@/lib/time/nights";
import { findCase, type EvalCase, type TripCase } from "./cases";

/** Eval bütçe öznesi (canlı modda sistem bütçesine faturalanır). */
const EVAL_SUBJECT = "sys:llm-eval";
/** Destek vakaları için sabit "şimdi" (tahmin deterministik kalsın). */
const SUPPORT_NOW = new Date("2026-10-01T09:00:00Z");

export interface EvalOutput {
  task: EvalCase["task"];
  caseId: string;
  locale: "tr" | "en";
  redTeam: boolean;
  /** Denetlenecek ana metin (yanıt/özet/taslak/anlatım). */
  text: string;
  result: unknown;
  /** Sayı grounding'i için olgu kaynakları. */
  facts: string[];
  meta: Record<string, unknown>;
}

function tripCore(c: TripCase): TripPlanCore {
  const month = Number(c.startDate.slice(5, 7));
  const route = optimizeRoute(c.cities, null, month);
  let cursor = c.startDate as IsoDate;
  const stops = route.order.map((city, i) => {
    const s = c.stops[i]!;
    const checkIn = cursor;
    const checkOut = addDays(cursor, s.nights);
    cursor = checkOut;
    return {
      city,
      checkIn,
      checkOut,
      nights: s.nights,
      stay: {
        propertyId: `p-${i + 1}`,
        title: s.title,
        roomId: `room-${i + 1}`,
        quoteId: `q-${i + 1}`,
        total: s.totalMinor,
        currency: "TRY",
      },
    };
  });
  return {
    route,
    stops,
    total: stops.reduce((sum, s) => sum + s.stay.total, 0),
    currency: "TRY",
  };
}

export async function runEvalCase(c: EvalCase): Promise<EvalOutput> {
  const base = { task: c.task, caseId: c.id, locale: c.locale, redTeam: c.redTeam === true };
  switch (c.task) {
    case "review_summary": {
      const r = await generateReviewSummary(c.reviews, c.knownNames ?? []);
      const avg = c.reviews.reduce((s, x) => s + x.rating, 0) / Math.max(1, c.reviews.length);
      return {
        ...base,
        text: [r.data.summary, ...r.data.pros, ...r.data.cons]
          .join("\n")
          .replace(/\[r:[^\]]+\]/g, ""),
        result: r.data,
        facts: [
          String(c.reviews.length),
          String(avg),
          "5",
          ...c.reviews.map((x) => `${x.rating} ${x.comment ?? ""}`),
        ],
        meta: { llmMode: r.llmMode, reviewIds: c.reviews.map((x) => x.id) },
      };
    }
    case "message_draft": {
      const r = await generateHostReplyDraft(c.input);
      const nights = Math.round(
        (c.input.checkOut.getTime() - c.input.checkIn.getTime()) / 86_400_000
      );
      return {
        ...base,
        text: r.draft,
        result: r,
        // Mesaj geçmişi bilerek olgu DEĞİL (misafirin yazdığı tutar taahhüde dönüşemez).
        facts: [
          c.input.propertyTitle,
          c.input.checkIn.toISOString().slice(0, 10),
          c.input.checkOut.toISOString().slice(0, 10),
          String(nights),
          String(c.input.guestCount),
        ],
        meta: { llmMode: r.llmMode },
      };
    }
    case "trip_plan": {
      const plan = tripCore(c);
      const r = await narrateTripPlan(c.request, plan);
      return {
        ...base,
        text: r.narrative,
        result: { narrative: r.narrative },
        facts: [
          String(c.request.days),
          String(c.request.guests),
          String(plan.total),
          String(plan.route.totalKm),
          JSON.stringify(plan),
        ],
        meta: { llmMode: r.llmMode },
      };
    }
    case "support_agent": {
      const booking = sampleSupportBooking();
      const repo = createMemorySupportRepo([booking]);
      const r = await runSupportChat(
        { userId: booking.userId, message: c.message, locale: c.locale },
        { repo, now: () => SUPPORT_NOW }
      );
      return {
        ...base,
        text: r.reply,
        result: r,
        facts: [
          c.message,
          JSON.stringify(bookingSummary(booking, c.locale)),
          JSON.stringify(cancellationQuote(booking, SUPPORT_NOW, c.locale)),
          JSON.stringify(propertyPolicy(booking.property)),
          ...repo.tickets.map((t) => t.id),
        ],
        meta: {
          llmMode: r.llmMode,
          intent: r.intent,
          handoff: r.handoff?.reason ?? null,
          ticketsOpened: repo.tickets.length,
          toolsUsed: r.toolsUsed,
          expectIntent: c.expectIntent,
          expectHandoff: c.expectHandoff,
        },
      };
    }
  }
}

/** promptfoo sağlayıcı sözleşmesi (`id` + `callApi`). */
export default class BookingAppProvider {
  id(): string {
    return "booking-app";
  }

  async callApi(
    _prompt: string,
    context?: { vars?: Record<string, unknown> }
  ): Promise<{ output?: string; error?: string }> {
    try {
      const c = findCase(String(context?.vars?.case ?? ""));
      const out = await runWithLlmSubject(EVAL_SUBJECT, () => runEvalCase(c));
      return { output: JSON.stringify(out) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }
}
