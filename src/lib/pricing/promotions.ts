import { allocate, bpsOf, money, type CurrencyCode } from "@/lib/money/money";
import { diffDays, type IsoDate } from "@/lib/time/nights";

/**
 * P1-8 promosyon kural motoru (saf, deterministik; DB/saat okumaz).
 *
 * Akış: uygunluk → bağımsız indirim tutarı → sıralama (öncelik ↓, indirim ↓, id ↑) →
 * birleşebilirlik (açgözlü) → toplam indirim tavanı (`maxDiscountBps`, taban fiyat) →
 * satır kalemleri. Her promosyon için açıklanabilir bir gerekçe kodu döner; LLM veya
 * rastgelelik yok. Tek yuvarlama noktası `promotionAmount` (→ `bpsOf`, half-up).
 */

export const PROMOTION_TYPES = [
  "EARLY_BIRD",
  "LAST_MINUTE",
  "LONG_STAY",
  "MOBILE_RATE",
  "COUPON",
] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export type SalesChannel = "web" | "mobile";

export interface PromotionRule {
  id: string;
  name: string;
  type: PromotionType;
  /** Yüzde indirim (baz puan, 1–10.000) — `discountMinor` ile birlikte verilmez. */
  discountBps: number | null;
  /** Sabit indirim (konaklama başına, `currency` biriminde minor-unit). */
  discountMinor: number | null;
  currency: string | null;
  minDaysBefore: number | null;
  maxDaysBefore: number | null;
  minNights: number | null;
  couponCode: string | null;
  usageLimit: number | null;
  usageCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  priority: number;
  stackable: boolean;
  stackGroup: string | null;
  active: boolean;
}

export interface PromotionContext {
  /** Değerlendirme anı (geçerlilik aralığı için). */
  now: Date;
  /** Tesisin yerel bugünü (varışa kalan gün için). */
  today: IsoDate;
  checkIn: IsoDate;
  nights: number;
  channel: SalesChannel;
  /** Misafirin girdiği kupon (normalize edilmemiş olabilir). */
  couponCode?: string | null;
  currency: CurrencyCode;
  /** İndirim uygulanacak konaklama ara toplamı (vergi/ücret hariç). */
  subtotalMinor: number;
  /** Toplam indirimin ara toplama oranı üst sınırı (bps). 10.000 → fiyat 0'a inebilir. */
  maxDiscountBps: number;
}

export type PromotionReason =
  | "APPLIED"
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "LEAD_TIME_TOO_SHORT"
  | "LEAD_TIME_TOO_LONG"
  | "STAY_TOO_SHORT"
  | "NOT_MOBILE"
  | "COUPON_REQUIRED"
  | "USAGE_LIMIT_REACHED"
  | "CURRENCY_MISMATCH"
  | "ZERO_DISCOUNT"
  | "NOT_STACKABLE"
  | "STACK_GROUP_TAKEN"
  | "DISCOUNT_CAP_REACHED";

/** Kupon sonucu: uygulandı, bulunamadı ya da uygulanmama gerekçesi. */
export type CouponStatus = "APPLIED" | "NOT_FOUND" | Exclude<PromotionReason, "APPLIED">;

/** Teklifte görünen promosyon satırı (`amount` > 0 indirimdir, toplamdan düşülür). */
export interface PromotionLine {
  promotionId: string;
  name: string;
  type: PromotionType;
  couponCode: string | null;
  amount: number;
  /** Kullanım limiti var → checkout'ta atomik sayılır. */
  limited: boolean;
}

export interface PromotionDecision {
  promotionId: string;
  name: string;
  type: PromotionType;
  reason: PromotionReason;
  /** Bağımsız (tavan/birleşme öncesi) indirim; uygun değilse 0. */
  standaloneAmount: number;
}

export interface PromotionResult {
  lines: PromotionLine[];
  decisions: PromotionDecision[];
  discountTotal: number;
  couponCode: string | null;
  couponStatus: CouponStatus | null;
}

/** Kupon kodu karşılaştırması büyük/küçük harf ve boşluk duyarsızdır. */
export function normalizeCouponCode(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase();
  return c ? c : null;
}

/**
 * Promosyonun ara toplam üzerindeki bağımsız indirimi — TEK yuvarlama noktası.
 * Yüzde: `bpsOf` (half-up). Sabit: ara toplamı aşamaz (negatif fiyat yok).
 */
export function promotionAmount(
  rule: Pick<PromotionRule, "discountBps" | "discountMinor">,
  subtotalMinor: number,
  currency: CurrencyCode
): number {
  if (subtotalMinor <= 0) return 0;
  const raw =
    rule.discountBps !== null
      ? bpsOf(money(subtotalMinor, currency), rule.discountBps).amount
      : (rule.discountMinor ?? 0);
  return Math.max(0, Math.min(raw, subtotalMinor));
}

/** Uygunluk (birleşme hariç); uygunsa null, değilse gerekçe. */
export function eligibility(rule: PromotionRule, ctx: PromotionContext): PromotionReason | null {
  if (!rule.active) return "INACTIVE";
  if (rule.startsAt && ctx.now < rule.startsAt) return "NOT_STARTED";
  if (rule.endsAt && ctx.now >= rule.endsAt) return "EXPIRED";
  const lead = diffDays(ctx.today, ctx.checkIn);
  if (rule.minDaysBefore !== null && lead < rule.minDaysBefore) return "LEAD_TIME_TOO_SHORT";
  if (rule.maxDaysBefore !== null && lead > rule.maxDaysBefore) return "LEAD_TIME_TOO_LONG";
  if (rule.minNights !== null && ctx.nights < rule.minNights) return "STAY_TOO_SHORT";
  if (rule.type === "MOBILE_RATE" && ctx.channel !== "mobile") return "NOT_MOBILE";
  if (rule.type === "COUPON") {
    const code = normalizeCouponCode(ctx.couponCode);
    if (!code || normalizeCouponCode(rule.couponCode) !== code) return "COUPON_REQUIRED";
  }
  if (rule.usageLimit !== null && rule.usageCount >= rule.usageLimit) return "USAGE_LIMIT_REACHED";
  if (rule.discountMinor !== null && rule.currency !== ctx.currency) return "CURRENCY_MISMATCH";
  return null;
}

/** Deterministik sıralama: öncelik ↓ → bağımsız indirim ↓ → id ↑ (kod birimi sırası). */
function compareCandidates(
  a: { rule: PromotionRule; amount: number },
  b: { rule: PromotionRule; amount: number }
): number {
  if (a.rule.priority !== b.rule.priority) return b.rule.priority - a.rule.priority;
  if (a.amount !== b.amount) return b.amount - a.amount;
  return a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0;
}

/**
 * Kuralları değerlendirir. Birleşebilirlik: ilk seçilen (en öncelikli) promosyon
 * birleşemezse tek başına uygulanır; birleşebilir promosyonlar yalnız birleşebilirlerle ve
 * her `stackGroup`'tan en fazla biri olacak şekilde eklenir. Toplam indirim
 * `subtotal × maxDiscountBps` tavanını aşamaz; aşan kısım sıradaki satırdan kırpılır.
 */
export function evaluatePromotions(
  rules: readonly PromotionRule[],
  ctx: PromotionContext
): PromotionResult {
  const couponCode = normalizeCouponCode(ctx.couponCode);
  const decisions = new Map<string, PromotionDecision>();
  const candidates: Array<{ rule: PromotionRule; amount: number }> = [];
  for (const rule of rules) {
    const base = { promotionId: rule.id, name: rule.name, type: rule.type };
    const reason = eligibility(rule, ctx);
    if (reason) {
      decisions.set(rule.id, { ...base, reason, standaloneAmount: 0 });
      continue;
    }
    const amount = promotionAmount(rule, ctx.subtotalMinor, ctx.currency);
    if (amount <= 0) {
      decisions.set(rule.id, { ...base, reason: "ZERO_DISCOUNT", standaloneAmount: 0 });
      continue;
    }
    candidates.push({ rule, amount });
    decisions.set(rule.id, { ...base, reason: "APPLIED", standaloneAmount: amount });
  }
  candidates.sort(compareCandidates);

  const selected: Array<{ rule: PromotionRule; amount: number }> = [];
  for (const c of candidates) {
    const reject = (reason: PromotionReason) => {
      decisions.set(c.rule.id, { ...decisions.get(c.rule.id)!, reason });
    };
    if (selected.length === 0) {
      selected.push(c);
      continue;
    }
    if (!c.rule.stackable || !selected[0].rule.stackable) {
      reject("NOT_STACKABLE");
      continue;
    }
    if (
      c.rule.stackGroup !== null &&
      selected.some((s) => s.rule.stackGroup === c.rule.stackGroup)
    ) {
      reject("STACK_GROUP_TAKEN");
      continue;
    }
    selected.push(c);
  }

  let remaining = promotionAmount(
    { discountBps: ctx.maxDiscountBps, discountMinor: null },
    ctx.subtotalMinor,
    ctx.currency
  );
  const lines: PromotionLine[] = [];
  for (const s of selected) {
    const amount = Math.min(s.amount, remaining);
    if (amount <= 0) {
      decisions.set(s.rule.id, { ...decisions.get(s.rule.id)!, reason: "DISCOUNT_CAP_REACHED" });
      continue;
    }
    remaining -= amount;
    lines.push({
      promotionId: s.rule.id,
      name: s.rule.name,
      type: s.rule.type,
      couponCode: s.rule.type === "COUPON" ? normalizeCouponCode(s.rule.couponCode) : null,
      amount,
      limited: s.rule.usageLimit !== null,
    });
  }

  let couponStatus: CouponStatus | null = null;
  if (couponCode) {
    const couponRules = rules.filter(
      (r) => r.type === "COUPON" && normalizeCouponCode(r.couponCode) === couponCode
    );
    if (couponRules.length === 0) couponStatus = "NOT_FOUND";
    else if (lines.some((l) => l.couponCode === couponCode)) couponStatus = "APPLIED";
    else couponStatus = decisions.get(couponRules[0].id)!.reason as CouponStatus;
  }

  // Karar listesi girdi sırasından bağımsız: id sırasıyla.
  const ordered = [...decisions.values()].sort((a, b) =>
    a.promotionId < b.promotionId ? -1 : a.promotionId > b.promotionId ? 1 : 0
  );
  return {
    lines,
    decisions: ordered,
    discountTotal: lines.reduce((s, l) => s + l.amount, 0),
    couponCode,
    couponStatus,
  };
}

/**
 * İndirimi gecelere tutarlarıyla orantılı bölüştürür (en büyük kalan; toplam birebir korunur).
 * Vergiler indirimli gece tutarları üzerinden hesaplanır.
 */
export function allocateDiscount(
  nightAmounts: readonly number[],
  discountMinor: number,
  currency: CurrencyCode
): number[] {
  if (discountMinor <= 0 || nightAmounts.every((a) => a <= 0)) return nightAmounts.map(() => 0);
  return allocate(money(discountMinor, currency), nightAmounts).map((m) => m.amount);
}

/** Tarayıcı ipuçlarından satış kanalı (Client Hints `Sec-CH-UA-Mobile`, yoksa UA). */
export function channelFromHeaders(headers: Headers): SalesChannel {
  const hint = headers.get("sec-ch-ua-mobile");
  if (hint !== null) return hint.trim() === "?1" ? "mobile" : "web";
  return /\b(Mobi|Android|iPhone|iPad)\b/i.test(headers.get("user-agent") ?? "") ? "mobile" : "web";
}
