/**
 * Çok-etmenli pazarlık (multi-agent negotiation) rule-engine.
 *
 * İki "etmen" simüle edilir:
 *  - Kullanıcı etmeni: bütçe + esneklik (tarih/capraz) ile teklif eder.
 *  - Sistem etmeni: canlı dinamik fiyatı (motor) ve doluluk/demansa göre
 *    karşı-teklif veya kabul/red üretir.
 *
 * Deterministik kural zinciri uygulanır; her tetiklenen kural `rulesFired` ile
 * dışa verilir (denetlenebilirlik / akıllı sözleşme izi).
 */

export interface NegotiationInput {
  /** Zemin (base) fiyat — indirim sınırları buna göre değil motora göre. */
  basePrice: number;
  /** Canlı dinamik fiyat (predictive motor çıktısı) — üst tavan. */
  dynamicPrice: number;
  /** 0..1 birleşik talep sinyali (yüksek talep → daha az indirim). */
  demandSignal: number;
  /** Kullanıcının bu turdaki teklif fiyatı. */
  requestedPrice: number;
  /** 0-indexed tur sayacı. */
  round: number;
  maxRounds: number;
  /** Tarih/esneklik esnekse sistem daha fazla indirim yapabilir. */
  isFlexibleDates: boolean;
  /** Girişe kalan gün sayısı (uzun vade → doluluk icin daha esnek). */
  leadDays: number;
  currency?: string;
}

export type NegotiationDecision = "accept" | "counter" | "reject";

export interface NegotiationResult {
  decision: NegotiationDecision;
  currentPrice: number;
  /** Karşı-teklif fiyatı (decision=counter iken dolu). */
  counterPrice: number | null;
  discountPercent: number;
  demandSignal: number;
  canCounterAgain: boolean;
  reason: string[];
  rulesFired: string[];
  currency: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Sistemin kabul edebileceği alt taban oranı (dinamik fiyatın %'si).
 * Yüksek talep tabanı yükseltir (daha az indirim); esnek tarih ve uzun
 * vade tabanı düşürür (daha fazla indirim).
 */
export function computeFloorRatio(input: Pick<NegotiationInput, "demandSignal" | "isFlexibleDates" | "leadDays">): number {
  return clamp(
    0.88 + input.demandSignal * 0.12 - (input.isFlexibleDates ? 0.04 : 0) - (input.leadDays > 45 ? 0.03 : 0),
    0.68,
    0.92
  );
}

export function negotiate(input: NegotiationInput): NegotiationResult {
  const rulesFired: string[] = [];
  const reason: string[] = [];
  const { requestedPrice, dynamicPrice, round, maxRounds } = input;
  const floorRatio = computeFloorRatio(input);
  const floorPrice = dynamicPrice * floorRatio;

  // Kural 1: Tavanı aşan (veya eşit) teklif → anında kabul
  if (requestedPrice >= dynamicPrice) {
    rulesFired.push("rule.ask_above_or_at_dynamic");
    reason.push(`İstek (${requestedPrice}) dinamik fiyatın üzerinde — anında kabul`);
    return {
      decision: "accept",
      currentPrice: dynamicPrice,
      counterPrice: null,
      discountPercent: 0,
      demandSignal: input.demandSignal,
      canCounterAgain: false,
      reason,
      rulesFired,
      currency: input.currency ?? "TRY",
    };
  }

  // Kural 2: Tabanın altındaki teklif → esneklik yoksa red, varsa tabana çek
  if (requestedPrice < floorPrice) {
    if (!input.isFlexibleDates) {
      rulesFired.push("rule.below_floor_no_flex");
      reason.push(`İstek tabanın (${floorPrice.toFixed(2)}) altında ve tarih esnek değil — red`);
      return {
        decision: "reject",
        currentPrice: dynamicPrice,
        counterPrice: null,
        discountPercent: 0,
        demandSignal: input.demandSignal,
        canCounterAgain: round < maxRounds,
        reason,
        rulesFired,
        currency: input.currency ?? "TRY",
      };
    }
    rulesFired.push("rule.below_floor_but_flexible");
    reason.push(`İstek tabanın altında; esneklik tanındığı için tabana kadar düşülebilir`);
  }

  // Kural 3: Tur sınırı → uzlaşma noktası (tabanla istek arası orta-kabul)
  const lastRound = round >= maxRounds;
  if (lastRound) {
    const acceptPrice = Math.max(requestedPrice, floorPrice);
    rulesFired.push("rule.last_round_settle");
    reason.push(`Son tur — uzlaşma fiyatı ${acceptPrice.toFixed(2)}`);
    const discountPercent =
      dynamicPrice > 0 ? Math.round((1 - acceptPrice / dynamicPrice) * 10000) / 100 : 0;
    return {
      decision: "accept",
      currentPrice: dynamicPrice,
      counterPrice: acceptPrice,
      discountPercent,
      demandSignal: input.demandSignal,
      canCounterAgain: false,
      reason,
      rulesFired,
      currency: input.currency ?? "TRY",
    };
  }

  // Kural 4: Karşı-teklif — istek ile dinamik fiyat arası, taban korunarak
  const counter = Math.round(Math.max(requestedPrice + (dynamicPrice - requestedPrice) * 0.4, floorPrice) * 100) / 100;
  rulesFired.push("rule.counter_between_ask_and_dynamic");
  reason.push(`Karşı-teklif: ${counter.toFixed(2)} (taban ${floorPrice.toFixed(2)}, tavan ${dynamicPrice.toFixed(2)})`);

  const discountPercent =
    dynamicPrice > 0 ? Math.round((1 - counter / dynamicPrice) * 10000) / 100 : 0;

  return {
    decision: "counter",
    currentPrice: dynamicPrice,
    counterPrice: counter,
    discountPercent,
    demandSignal: input.demandSignal,
    canCounterAgain: round + 1 < maxRounds,
    reason,
    rulesFired,
    currency: input.currency ?? "TRY",
  };
}

/** Bir tura ait referans: sistem kuralı çağırmadan önceki sonucu. */
export function initialNegotiationState(input: NegotiationInput): NegotiationResult {
  return negotiate(input);
}
