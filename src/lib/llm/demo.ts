/**
 * Görev başına deterministik DEMO üreticileri.
 *
 * Anahtar yokken (veya canlı çağrı başarısız olduğunda) aynı arayüzle, girdideki
 * GERÇEK verilerden (ilan başlığı, gerçek yorum cümleleri, gerçek fiyatlar)
 * anlamlı Türkçe çıktı üretir. Ağ erişimi yoktur; aynı girdi → aynı çıktı.
 */

import {
  parseSmartQuery,
  type FacetVocabulary,
  type SmartFilters,
} from "@/lib/ai/smart-filter-parser";

export interface SmokeOutput {
  ok: boolean;
  message: string;
}

export function demoSmoke(): SmokeOutput {
  return { ok: true, message: "Demo modu: LLM çağrısı yapılmadı." };
}

/** Smart Filter demo: kural tabanlı Türkçe ayrıştırıcı (şehir sözlüğü DB'den). */
export function demoSmartFilter(text: string, vocab: FacetVocabulary): SmartFilters {
  return parseSmartQuery(text, vocab);
}

export interface ReviewInput {
  id: string;
  rating: number;
  comment: string | null;
}

export interface ReviewSummary {
  summary: string;
  pros: string[];
  cons: string[];
  citations: string[];
}

const THEMES: Array<{ key: RegExp; label: string }> = [
  { key: /temiz|hijyen|pırıl/, label: "temizlik" },
  { key: /konum|merkez|yürüme mesafe|ulaşım/, label: "konum" },
  { key: /personel|çalışan|resepsiyon|güler yüz|ilgili/, label: "personel ve hizmet" },
  { key: /kahvaltı/, label: "kahvaltı" },
  { key: /manzara|deniz|boğaz/, label: "manzara" },
  { key: /sessiz|huzur|sakin/, label: "sessizlik" },
  { key: /gürültü|ses geliyor/, label: "gürültü" },
  { key: /pahalı|fiyat(ı)? yüksek/, label: "fiyat" },
  { key: /küçük|dar/, label: "oda büyüklüğü" },
  { key: /wifi|internet/, label: "internet" },
];

function firstSentence(text: string): string {
  const s = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

/**
 * Yorum özeti demo'su: gerçek yorumlardan tema frekansı (olumlu: puan ≥ 4,
 * olumsuz: puan ≤ 3) ve gerçek cümle alıntıları, her maddede `[r:<id>]` atfı.
 * Özet metnindeki sayılar (yorum sayısı, ortalama) girdiden hesaplanır.
 */
export function demoReviewSummary(reviews: ReviewInput[]): ReviewSummary {
  const withText = reviews.filter((r) => r.comment && r.comment.trim().length > 0);
  if (reviews.length === 0) {
    return { summary: "Henüz doğrulanmış yorum yok.", pros: [], cons: [], citations: [] };
  }
  const avg = Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;
  const pick = (positive: boolean) => {
    const out: Array<{ text: string; id: string; count: number }> = [];
    for (const theme of THEMES) {
      const hits = withText.filter(
        (r) =>
          theme.key.test(r.comment!.toLocaleLowerCase("tr-TR")) &&
          (positive ? r.rating >= 4 : r.rating <= 3)
      );
      if (hits.length > 0) {
        out.push({
          text: `${theme.label}: "${firstSentence(hits[0].comment!)}" [r:${hits[0].id}]`,
          id: hits[0].id,
          count: hits.length,
        });
      }
    }
    return out.sort((a, b) => b.count - a.count).slice(0, 3);
  };
  const pros = pick(true);
  const cons = pick(false);
  const top = pros[0];
  const summary =
    `${reviews.length} doğrulanmış yorumun ortalaması ${avg}/5.` +
    (top ? ` Misafirler en çok ${top.text.split(":")[0]} konusunu övüyor [r:${top.id}].` : "");
  return {
    summary,
    pros: pros.map((p) => p.text),
    cons: cons.map((c) => c.text),
    citations: [...new Set([...pros, ...cons].map((x) => x.id))],
  };
}

export interface EventExtraction {
  city: string | null;
  startDate: string | null;
  endDate: string | null;
  category: "konser" | "festival" | "spor" | "fuar" | "kongre" | "tatil" | "diğer";
  expectedImpact: number;
  rationale: string;
}

const EVENT_CATEGORIES: Array<[RegExp, EventExtraction["category"], number]> = [
  [/konser|sahne|turne/, "konser", 7],
  [/festival|şenlik/, "festival", 6],
  [/maç|final|turnuva|maraton|formula|derbi/, "spor", 8],
  [/fuar|expo/, "fuar", 5],
  [/kongre|zirve|konferans/, "kongre", 5],
  [/bayram|tatil|yılbaşı/, "tatil", 6],
];

/** Olay çıkarımı demo'su: tarih (ISO veya "12 temmuz"), şehir sözlüğü, kategori sözlüğü. */
export function demoEventExtraction(
  text: string,
  cities: string[],
  today = new Date()
): EventExtraction {
  const t = text.toLocaleLowerCase("tr-TR");
  const city = cities.find((c) => t.includes(c.toLocaleLowerCase("tr-TR"))) ?? null;
  const iso = [...t.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]);
  let startDate: string | null = iso[0] ?? null;
  let endDate: string | null = iso[1] ?? iso[0] ?? null;
  if (!startDate) {
    const f = parseSmartQuery(text, { cities: [], amenities: [] }, today);
    startDate = f.checkIn ?? null;
    endDate = f.checkIn ?? null;
  }
  const hit = EVENT_CATEGORIES.find(([re]) => re.test(t));
  return {
    city,
    startDate,
    endDate,
    category: hit?.[1] ?? "diğer",
    expectedImpact: hit?.[2] ?? 3,
    rationale: hit
      ? `Metinde "${hit[1]}" türü bir etkinlik geçiyor.`
      : "Belirgin bir etkinlik türü bulunamadı.",
  };
}
