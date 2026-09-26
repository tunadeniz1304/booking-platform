/**
 * Bölünmüş ödeme (P1-2) paylaştırması — minor-unit tamsayılar, float yok.
 *
 * TEK yuvarlama kuralı (`allocateMinor`): indeks ≥ 1 olan her pay aşağı yuvarlanır (floor),
 * artan kuruşlar indeks 0'a (organizatör) yazılır. Böylece Σ pay = toplam her zaman tutar,
 * hiçbir pay negatif olmaz ve katılımcılar asla "fazladan kuruş" ödemez.
 */

function assertMinor(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} negatif olmayan güvenli bir tamsayı olmalı`);
  }
}

/** `totalMinor`'ı ağırlıklara oranla böler; kalan kuruş indeks 0'a. */
export function allocateMinor(totalMinor: number, weights: readonly number[]): number[] {
  assertMinor(totalMinor, "Toplam");
  if (weights.length === 0) throw new RangeError("En az bir pay gerekli");
  let sumWeights = 0n;
  for (const w of weights) {
    assertMinor(w, "Ağırlık");
    sumWeights += BigInt(w);
  }
  if (sumWeights === 0n) throw new RangeError("Ağırlıkların toplamı pozitif olmalı");
  const total = BigInt(totalMinor);
  const out = new Array<number>(weights.length);
  let rest = total;
  for (let i = 1; i < weights.length; i++) {
    const share = (total * BigInt(weights[i])) / sumWeights; // floor (hepsi ≥ 0)
    out[i] = Number(share);
    rest -= share;
  }
  out[0] = Number(rest);
  return out;
}

/** Eşit bölme: `n` pay, kalan kuruş organizatöre (indeks 0). */
export function splitEvenly(totalMinor: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("Pay sayısı pozitif olmalı");
  return allocateMinor(totalMinor, new Array<number>(n).fill(1));
}

export type SplitSpec =
  | { mode: "equal"; participants: number }
  | { mode: "custom"; participantAmounts: readonly number[] };

export class SplitAmountError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "SplitAmountError";
  }
}

/**
 * Organizatör + katılımcı paylarını çözer. Eşit bölmede her katılımcı en az 1 minor-unit
 * almalıdır; özel tutarlarda katılımcı toplamı sepeti aşamaz ve organizatör kalanı öder
 * (0 olabilir → organizatörün payı yok).
 */
export function resolveSplitAmounts(
  totalMinor: number,
  spec: SplitSpec
): { organizer: number; participants: number[] } {
  assertMinor(totalMinor, "Toplam");
  if (spec.mode === "equal") {
    if (!Number.isInteger(spec.participants) || spec.participants < 1) {
      throw new SplitAmountError("En az bir katılımcı gerekli");
    }
    const [organizer, ...participants] = splitEvenly(totalMinor, spec.participants + 1);
    if (participants.some((p) => p <= 0)) {
      throw new SplitAmountError("Tutar bu kadar kişiye bölünemeyecek kadar küçük");
    }
    return { organizer, participants };
  }
  if (spec.participantAmounts.length === 0) {
    throw new SplitAmountError("En az bir katılımcı gerekli");
  }
  let sum = 0;
  for (const a of spec.participantAmounts) {
    if (!Number.isSafeInteger(a) || a <= 0) {
      throw new SplitAmountError("Her pay pozitif bir tutar olmalı");
    }
    sum += a;
  }
  if (sum > totalMinor) throw new SplitAmountError("Payların toplamı sepet toplamını aşıyor");
  return { organizer: totalMinor - sum, participants: [...spec.participantAmounts] };
}

/**
 * `amountMinor`'ı üst sınırlı paylara oranla dağıtır (ör. kalem iadesinin tahsil edilmiş
 * paylara bölünmesi). Önce `allocateMinor` (tek yuvarlama kuralı); sınırı aşan kuruşlar
 * sırayla boşluğu olan paylara kaydırılır. Σ = amount, 0 ≤ pay_i ≤ caps_i.
 */
export function allocateCapped(amountMinor: number, caps: readonly number[]): number[] {
  assertMinor(amountMinor, "Tutar");
  const capacity = caps.reduce((s, c) => {
    assertMinor(c, "Üst sınır");
    return s + c;
  }, 0);
  if (amountMinor > capacity) throw new RangeError("Tutar payların kapasitesini aşıyor");
  if (amountMinor === 0) return caps.map(() => 0);
  const out = allocateMinor(amountMinor, caps);
  let excess = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i] > caps[i]) {
      excess += out[i] - caps[i];
      out[i] = caps[i];
    }
  }
  for (let i = 0; excess > 0 && i < out.length; i++) {
    const room = caps[i] - out[i];
    const moved = Math.min(room, excess);
    out[i] += moved;
    excess -= moved;
  }
  return out;
}
