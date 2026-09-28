import { z } from "zod";
import type { LlmTool } from "@/lib/llm/client";
import { redactText } from "@/lib/llm/redaction";
import { computeRefund, parseSnapshot, toSnapshot } from "@/lib/booking/cancellation";
import { assertCurrency, formatMoney, money, toMajorNumber } from "@/lib/money/money";
import { clockOf, fromDate } from "@/lib/time/nights";
import type { BookingView, PropertyView, SupportRepo } from "./repo";
import type { SupportHandoffReason } from "@prisma/client";

/**
 * v5 P1-4 — destek ajanının araçları. LLM yalnız bunları çağırabilir.
 *
 * - `read`: salt-okur; hiçbir veriyi değiştirmez.
 * - `ticket`: tek "yazma" — insan kuyruğuna kayıt açar (iade/iptal/ödeme DEĞİL).
 *
 * İade/iptal/ödeme yapan hiçbir araç YOKTUR (`tests/unit/support` araç listesi testi).
 * İade tahmini `computeRefund` (deterministik, saf) ile hesaplanır; yazan
 * `cancelAndRefund` çağrılmaz. LLM tutar hesaplamaz, yalnız aracın sonucunu aktarır.
 */

export type SupportToolAccess = "read" | "ticket";

export const SUPPORT_TOOL_ACCESS = {
  get_my_booking: "read",
  explain_cancellation_quote: "read",
  get_property_policy: "read",
  open_support_ticket: "ticket",
} as const satisfies Record<string, SupportToolAccess>;

export type SupportToolName = keyof typeof SUPPORT_TOOL_ACCESS;

export const SUPPORT_TOOL_NAMES = Object.keys(SUPPORT_TOOL_ACCESS) as SupportToolName[];

const SUMMARY_MAX = 1000;

export interface SupportToolContext {
  userId: string;
  locale: "tr" | "en";
  repo: SupportRepo;
  now: () => Date;
  /** Sohbette zaten açılmış talep (tekrar açılmaz). */
  ticket: { id: string; reason: SupportHandoffReason } | null;
  /** `open_support_ticket` aracının niyet etiketi/güveni (deterministik sınıflandırıcıdan). */
  intent: string;
  confidence: number;
  /** Varsayılan rezervasyon (istek gövdesinden). */
  bookingId?: string;
}

const bookingArgs = z.object({ bookingId: z.string().max(64).optional() }).strict();
const policyArgs = z
  .object({ bookingId: z.string().max(64).optional(), propertyId: z.string().max(64).optional() })
  .strict();
const ticketArgs = z.object({ summary: z.string().min(1).max(SUMMARY_MAX) }).strict();

const NOT_FOUND = { error: "Rezervasyon bulunamadı" } as const;

function tiersOf(policy: {
  rules: { tiers: Array<{ hoursBefore: number; refundPercent: number }> };
}) {
  return [...policy.rules.tiers]
    .sort((a, b) => b.hoursBefore - a.hoursBefore)
    .map((t) => ({ hoursBefore: t.hoursBefore, refundPercent: t.refundPercent }));
}

function fmt(minor: number, currency: string, locale: "tr" | "en"): string {
  return formatMoney(money(minor, assertCurrency(currency)), locale === "en" ? "en-US" : "tr-TR");
}

export function bookingSummary(b: BookingView, locale: "tr" | "en") {
  return {
    bookingId: b.id,
    status: b.status,
    propertyTitle: b.property.title,
    checkIn: fromDate(b.checkIn),
    checkOut: fromDate(b.checkOut),
    guestCount: b.guestCount,
    total: toMajorNumber(b.totalPriceMinor, b.currency),
    totalFormatted: fmt(b.totalPriceMinor, b.currency, locale),
    currency: b.currency,
    policyKind: parseSnapshot(b.policySnapshot).kind,
  };
}

/** Salt-okur iade tahmini: rezervasyondaki politika anlık görüntüsü + `computeRefund`. */
export function cancellationQuote(b: BookingView, now: Date, locale: "tr" | "en") {
  const snapshot = parseSnapshot(b.policySnapshot);
  const currency = assertCurrency(b.currency);
  const decision = computeRefund(
    snapshot,
    { checkIn: fromDate(b.checkIn), createdAt: b.createdAt, paidMinor: b.paidMinor, currency },
    now,
    clockOf(b.property)
  );
  return {
    bookingId: b.id,
    policyKind: snapshot.kind,
    tiers: tiersOf(snapshot),
    paid: toMajorNumber(b.paidMinor, currency),
    refundPercent: decision.refundPercent,
    refundAmount: toMajorNumber(decision.refundMinor, currency),
    refundFormatted: fmt(decision.refundMinor, currency, locale),
    currency,
    hoursBeforeCheckIn: Math.max(0, Math.floor(decision.hoursBeforeCheckIn)),
    basis: decision.reason,
    /** Tahmin bağlayıcı değildir; iptal/iade yalnız rezervasyon sayfasından veya insan destekle. */
    binding: false,
  };
}

export function propertyPolicy(p: PropertyView) {
  const snapshot = toSnapshot(
    p.policy ? { kind: p.policy.kind, version: p.policy.version, rules: p.policy.rules } : null
  );
  return {
    propertyId: p.id,
    propertyTitle: p.title,
    checkInTime: p.checkInTime,
    checkOutTime: p.checkOutTime,
    timeZone: p.timeZone,
    policyKind: snapshot.kind,
    tiers: tiersOf(snapshot),
  };
}

async function loadBooking(ctx: SupportToolContext, bookingId?: string) {
  return ctx.repo.findBookingForUser(ctx.userId, bookingId ?? ctx.bookingId);
}

/**
 * Talep açar (idempotent: bir sohbet turunda tek talep). Özet KVKK redaksiyonundan geçer.
 * Ajan servisinin deterministik devir yolu da bu fonksiyonu kullanır.
 */
export async function openTicket(
  ctx: SupportToolContext,
  reason: SupportHandoffReason,
  summary: string,
  bookingId?: string | null
): Promise<{ id: string; reason: SupportHandoffReason }> {
  if (ctx.ticket) return ctx.ticket;
  const booking = bookingId === null ? null : await loadBooking(ctx, bookingId ?? undefined);
  const created = await ctx.repo.createTicket({
    userId: ctx.userId,
    bookingId: booking?.id ?? null,
    reason,
    intent: ctx.intent.slice(0, 64),
    confidence: ctx.confidence,
    summary: redactText(summary).slice(0, SUMMARY_MAX),
    locale: ctx.locale,
  });
  ctx.ticket = { id: created.id, reason };
  return ctx.ticket;
}

/** Salt-okur araçlar + talep aracı (LLM'e verilen tam liste). */
export function createSupportTools(ctx: SupportToolContext): LlmTool[] {
  const tools: Record<SupportToolName, LlmTool> = {
    get_my_booking: {
      name: "get_my_booking",
      description:
        "Kullanıcının rezervasyon özetini döndürür (salt-okur). bookingId verilmezse en yakın rezervasyon.",
      parameters: {
        type: "object",
        properties: { bookingId: { type: "string" } },
        additionalProperties: false,
      },
      async execute(raw) {
        const args = bookingArgs.parse(raw ?? {});
        const b = await loadBooking(ctx, args.bookingId);
        return b ? bookingSummary(b, ctx.locale) : NOT_FOUND;
      },
    },
    explain_cancellation_quote: {
      name: "explain_cancellation_quote",
      description:
        "Şimdi iptal edilirse tahmini iade tutarını politika anlık görüntüsünden hesaplar (salt-okur, bağlayıcı değil).",
      parameters: {
        type: "object",
        properties: { bookingId: { type: "string" } },
        additionalProperties: false,
      },
      async execute(raw) {
        const args = bookingArgs.parse(raw ?? {});
        const b = await loadBooking(ctx, args.bookingId);
        return b ? cancellationQuote(b, ctx.now(), ctx.locale) : NOT_FOUND;
      },
    },
    get_property_policy: {
      name: "get_property_policy",
      description: "Tesisin giriş/çıkış saatleri ve iptal politikası kademeleri (salt-okur).",
      parameters: {
        type: "object",
        properties: { bookingId: { type: "string" }, propertyId: { type: "string" } },
        additionalProperties: false,
      },
      async execute(raw) {
        const args = policyArgs.parse(raw ?? {});
        if (args.propertyId) {
          const p = await ctx.repo.findProperty(args.propertyId);
          return p ? propertyPolicy(p) : { error: "Tesis bulunamadı" };
        }
        const b = await loadBooking(ctx, args.bookingId);
        return b ? propertyPolicy(b.property) : NOT_FOUND;
      },
    },
    open_support_ticket: {
      name: "open_support_ticket",
      description:
        "Konuyu insan destek ekibine devreder (kuyruğa kayıt açar). İade/iptal YAPMAZ; yalnız talep açar.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string", maxLength: SUMMARY_MAX } },
        required: ["summary"],
        additionalProperties: false,
      },
      async execute(raw) {
        const args = ticketArgs.parse(raw ?? {});
        const t = await openTicket(ctx, "USER_REQUEST", args.summary);
        return { ticketId: t.id, status: "OPEN" };
      },
    },
  };
  return SUPPORT_TOOL_NAMES.map((name) => tools[name]);
}
