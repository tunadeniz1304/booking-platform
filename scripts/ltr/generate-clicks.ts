/**
 * Sentetik tıklama günlüğü üretici (P1-2).
 *
 * Gerçek kullanıcı verisi yok; bu yüzden deterministik (tohumlu) bir simülasyon:
 *  - Her sorgu için N aday; `LTR_FEATURES` sırasıyla 0..1 özellikler.
 *  - Gizli fayda (doğrusal OLMAYAN: kişisel ilgi × alaka, fiyat × puan etkileşimi) →
 *    gerçek not 0..3 (yalnız çevrimdışı değerlendirmede kullanılır).
 *  - Günlükleme politikası = mevcut ağırlıklı sıralama (`RANKING_WEIGHTS_WITH_QUERY`).
 *  - Kaskad tıklama modeli (konum yanlılığı) + tıklama sonrası rezervasyon olasılığı.
 *
 * Çıktı: `scripts/ltr/out/clicks.csv` (gitignore). Kullanım: `npm run ltr:clicks`.
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { RANKING_WEIGHTS_WITH_QUERY } from "../../src/lib/search/ranking";

const FEATURES = [
  "relevance",
  "lexical",
  "vector",
  "trigram",
  "priceFit",
  "rating",
  "popularity",
  "personal",
] as const;

const QUERIES = Number(process.env.LTR_QUERIES ?? 3000);
const CANDIDATES = 20;
const SEED = 20260925;

/** mulberry32 — küçük, tohumlu PRNG (Math.random deterministik değildir). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = prng(SEED);
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const gauss = () => {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

type Row = Record<(typeof FEATURES)[number], number>;

function candidate(personalized: boolean): { row: Row; utility: number } {
  const r = rand() ** 1.5; // gizli alaka (çoğu aday zayıf)
  const lexical = rand() < 0.55 ? clamp(r + 0.25 * gauss()) : 0;
  const vector = clamp(0.3 + 0.6 * r + 0.15 * gauss());
  const trigram = rand() < 0.15 ? clamp(0.5 + 0.4 * rand()) : 0;
  const relevance = clamp(0.5 * lexical + 0.5 * vector + 0.1 * gauss());
  const priceFit = rand();
  const rating = clamp(0.35 + 0.65 * rand() ** 0.7);
  const popularity = rand() ** 2;
  const personal = personalized ? rand() ** 3 : 0;
  const utility =
    2.4 * r +
    1.2 * personal * (r > 0.35 ? 1 : 0.2) +
    0.9 * priceFit * rating -
    0.8 * (rating < 0.5 ? 1 : 0) +
    0.2 * popularity +
    0.25 * gauss();
  return {
    row: { relevance, lexical, vector, trigram, priceFit, rating, popularity, personal },
    utility,
  };
}

function weightedScore(r: Row): number {
  const w = RANKING_WEIGHTS_WITH_QUERY;
  return (
    w.semantic * r.relevance +
    w.priceFit * r.priceFit +
    w.rating * r.rating +
    w.popularity * r.popularity +
    w.personal * r.personal
  );
}

const CLICK_P = [0.04, 0.2, 0.5, 0.85];
const BOOK_P = [0, 0.04, 0.15, 0.4];

const lines = [["qid", "position", ...FEATURES, "weighted", "grade", "click", "booked"].join(",")];
let clicks = 0;
let bookings = 0;
for (let q = 0; q < QUERIES; q++) {
  const personalized = rand() < 0.4;
  const items = Array.from({ length: CANDIDATES }, () => candidate(personalized));
  const utilities = items.map((i) => i.utility).sort((a, b) => a - b);
  const cut = (p: number) => utilities[Math.floor(p * (utilities.length - 1))];
  const [c1, c2, c3] = [cut(0.5), cut(0.8), cut(0.95)];
  const logged = items
    .map((i) => ({ ...i, weighted: weightedScore(i.row) }))
    .sort((a, b) => b.weighted - a.weighted);
  let stop = false;
  logged.forEach((item, pos) => {
    const grade = item.utility >= c3 ? 3 : item.utility >= c2 ? 2 : item.utility >= c1 ? 1 : 0;
    let click = 0;
    let booked = 0;
    // Kaskad: kullanıcı sırayla bakar; konum ilerledikçe inceleme olasılığı düşer.
    if (!stop && rand() < 1 / (1 + pos) ** 0.6) {
      if (rand() < CLICK_P[grade]) {
        click = 1;
        if (rand() < BOOK_P[grade]) {
          booked = 1;
          stop = true;
        }
      }
    }
    clicks += click;
    bookings += booked;
    const fmt = (v: number) => v.toFixed(5);
    lines.push(
      [
        q,
        pos,
        ...FEATURES.map((f) => fmt(item.row[f])),
        fmt(item.weighted),
        grade,
        click,
        booked,
      ].join(",")
    );
  });
}

const outDir = path.resolve(process.cwd(), "scripts/ltr/out");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "clicks.csv"), lines.join("\n") + "\n");
console.log(
  `sorgu=${QUERIES} satır=${lines.length - 1} tıklama=${clicks} rezervasyon=${bookings} → scripts/ltr/out/clicks.csv`
);
