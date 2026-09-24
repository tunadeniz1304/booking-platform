/**
 * Halüsinasyon korumaları.
 *
 * - Sayılar: LLM metnindeki her fiyat/tarih/puan/sayı, prompt'a verilen "facts"
 *   kümesinde bulunmalıdır. Bulunmayan sayı içeren cümleler çıkarılır veya çağrı
 *   demo çıktısına düşer (`assertNumbersGrounded`).
 * - Atıflar: `[r:<reviewId>]` biçimindeki her atıf gerçekten verilen yorum
 *   id'lerinden biri olmalıdır (`assertCitationsGrounded`).
 */

export class GuardError extends Error {
  constructor(
    readonly code: "ungrounded_number" | "ungrounded_citation",
    readonly offenders: string[]
  ) {
    super(
      code === "ungrounded_number"
        ? `Kaynakta olmayan sayı: ${offenders.slice(0, 5).join(", ")}`
        : `Geçersiz atıf: ${offenders.slice(0, 5).join(", ")}`
    );
    this.name = "GuardError";
  }
}

export type FactValue = number | string | Date;

export interface FactSet {
  numbers: Set<string>;
  dates: Set<string>;
}

const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const DOTTED_DATE_RE = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g;
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

function canon(n: number): string {
  // Kayan nokta gürültüsünü at, anlamlı en fazla 4 ondalık.
  return String(Math.round(n * 10000) / 10000);
}

function addNumber(set: Set<string>, n: number): void {
  if (!Number.isFinite(n)) return;
  set.add(canon(n));
  // Yuvarlanmış gösterimler de "kaynakta var" sayılır (4.37 → 4.4 → 4).
  set.add(canon(Math.round(n)));
  set.add(canon(Math.round(n * 10) / 10));
  set.add(canon(Math.round(n * 100) / 100));
}

function isoFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Olgu değerlerinden (sayı, ISO tarih, Date, sayı içeren metin) karşılaştırma kümesi kurar. */
export function buildFactSet(values: Iterable<FactValue>): FactSet {
  const numbers = new Set<string>();
  const dates = new Set<string>();
  for (const value of values) {
    if (value instanceof Date) {
      const iso = value.toISOString().slice(0, 10);
      dates.add(iso);
      const [y, m, d] = iso.split("-").map(Number);
      addNumber(numbers, y);
      addNumber(numbers, m);
      addNumber(numbers, d);
    } else if (typeof value === "number") {
      addNumber(numbers, value);
    } else {
      for (const match of value.matchAll(ISO_DATE_RE)) {
        const [, y, m, d] = match;
        dates.add(`${y}-${m}-${d}`);
        addNumber(numbers, Number(y));
        addNumber(numbers, Number(m));
        addNumber(numbers, Number(d));
      }
      for (const token of value.replace(ISO_DATE_RE, " ").match(NUMBER_RE) ?? []) {
        for (const n of interpretations(token)) addNumber(numbers, n);
      }
    }
  }
  return { numbers, dates };
}

/**
 * Bir sayı belirtecinin olası sayısal yorumları: "1.250" → 1250 (TR binlik) ve
 * 1.25; "3,5" → 3.5 (TR ondalık) ve 35; "12" → 12.
 */
export function interpretations(token: string): number[] {
  const out = new Set<number>();
  const plain = token.replace(/[.,]/g, "");
  out.add(Number(plain));
  const lastSep = Math.max(token.lastIndexOf("."), token.lastIndexOf(","));
  if (lastSep !== -1) {
    const intPart = token.slice(0, lastSep).replace(/[.,]/g, "");
    const fracPart = token.slice(lastSep + 1);
    out.add(Number(`${intPart}.${fracPart}`));
  }
  return [...out].filter(Number.isFinite);
}

/** Metinde geçen ancak olgu kümesinde bulunmayan sayı/tarih belirteçleri. */
export function findUngroundedNumbers(text: string, facts: FactSet): string[] {
  const offenders: string[] = [];
  let rest = text;

  for (const match of text.matchAll(ISO_DATE_RE)) {
    if (!facts.dates.has(match[0])) offenders.push(match[0]);
  }
  rest = rest.replace(ISO_DATE_RE, " ");

  for (const match of rest.matchAll(DOTTED_DATE_RE)) {
    const iso = isoFromParts(Number(match[3]), Number(match[2]), Number(match[1]));
    if (!facts.dates.has(iso)) offenders.push(match[0]);
  }
  rest = rest.replace(DOTTED_DATE_RE, " ");

  // Takma ad etiketlerindeki sıra numaraları (<KISI_1>) sayı sayılmaz.
  rest = rest.replace(/<[A-Z]+_\d+>/g, " ");
  // Atıf belirteçleri [r:...] sayı sayılmaz.
  rest = rest.replace(/\[r:[^\]]+\]/g, " ");

  for (const token of rest.match(NUMBER_RE) ?? []) {
    const ok = interpretations(token).some((n) => facts.numbers.has(canon(n)));
    if (!ok) offenders.push(token);
  }
  return offenders;
}

/** Olguya dayanmayan sayı varsa `GuardError` fırlatır. */
export function assertNumbersGrounded(text: string, facts: FactSet): void {
  const offenders = findUngroundedNumbers(text, facts);
  if (offenders.length > 0) throw new GuardError("ungrounded_number", offenders);
}

/** Olguya dayanmayan sayı içeren cümleleri metinden çıkarır. */
export function stripUngroundedSentences(
  text: string,
  facts: FactSet
): { text: string; removed: number } {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => findUngroundedNumbers(s, facts).length === 0);
  return { text: kept.join(" ").trim(), removed: sentences.length - kept.length };
}

const CITATION_RE = /\[r:([A-Za-z0-9_-]+)\]/g;

/** Metindeki `[r:<id>]` atıflarını sırayla döndürür. */
export function extractCitations(text: string): string[] {
  return [...text.matchAll(CITATION_RE)].map((m) => m[1]);
}

/** Her atıf verilen geçerli id kümesinde olmalı; değilse `GuardError`. */
export function assertCitationsGrounded(
  citations: Iterable<string>,
  validIds: Iterable<string>
): void {
  const valid = new Set(validIds);
  const offenders = [...citations].filter((id) => !valid.has(id));
  if (offenders.length > 0) throw new GuardError("ungrounded_citation", offenders);
}
