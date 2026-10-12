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

// Anahtarlar sözcük başında eşleşir (`(?<!\p{L})`): "kadar" içindeki "dar", "Akdeniz" içindeki
// "deniz" gibi sözcük içi rastlantılar temaya sayılmaz; "konuyla ilgili" de personel övgüsü değil.
const THEMES: Array<{ key: RegExp; label: string }> = [
  { key: /(?<!\p{L})(?:temiz|tertemiz|hijyen|pırıl)/u, label: "temizlik" },
  { key: /(?<!\p{L})(?:konum|merkez|yürüme mesafe|ulaşım)/u, label: "konum" },
  {
    key: /(?<!\p{L})(?:personel|çalışan|resepsiyon|güler yüz|ilgiliydi|ilgili ve|ilgilendi)/u,
    label: "personel ve hizmet",
  },
  { key: /(?<!\p{L})kahvaltı/u, label: "kahvaltı" },
  { key: /(?<!\p{L})(?:manzara|deniz|boğaz)/u, label: "manzara" },
  { key: /(?<!\p{L})(?:sessiz|huzur|sakin)/u, label: "sessizlik" },
  { key: /(?<!\p{L})(?:gürültü|ses geliyor)/u, label: "gürültü" },
  { key: /(?<!\p{L})(?:pahalı|fiyatı? yüksek)/u, label: "fiyat" },
  { key: /(?<!\p{L})(?:küçük|dar(?!\p{L})|dardı)/u, label: "oda büyüklüğü" },
  { key: /(?<!\p{L})(?:wifi|internet)/u, label: "internet" },
];

function clipSentence(s: string): string {
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

/** Yorumun temayı içeren İLK cümlesi (alıntı iddiayla birebir örtüşsün); yoksa null. */
function matchingSentence(text: string, key: RegExp): string | null {
  const hit = text.split(/(?<=[.!?])\s+/).find((s) => key.test(s.toLocaleLowerCase("tr-TR")));
  return hit ? clipSentence(hit.trim()) : null;
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
    const out: Array<{ text: string; label: string; id: string; count: number }> = [];
    for (const theme of THEMES) {
      // Alıntı, temayı geçiren cümlenin kendisidir; eşleşen cümlesi olmayan yorum sayılmaz.
      const hits = withText
        .filter((r) => (positive ? r.rating >= 4 : r.rating <= 3))
        .map((r) => ({ id: r.id, quote: matchingSentence(r.comment!, theme.key) }))
        .filter((h): h is { id: string; quote: string } => h.quote !== null);
      if (hits.length > 0) {
        out.push({
          text: `${theme.label}: "${hits[0].quote}" [r:${hits[0].id}]`,
          label: theme.label,
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
    (top ? ` Misafirler en çok ${top.label} konusunu övüyor [r:${top.id}].` : "");
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

export interface ListingFacts {
  title: string;
  city: string;
  propertyType: string;
  amenities: string[];
  rooms: Array<{ name: string; capacity: number; bedType: string }>;
}

/** İlan metni demo'su: yalnızca verilen özelliklerden TR/EN taslak (uydurma yok). */
export function demoListingCopy(f: ListingFacts): { tr: string; en: string } {
  const maxCap = Math.max(1, ...f.rooms.map((r) => r.capacity));
  const am = f.amenities.slice(0, 5);
  return {
    tr:
      `${f.city}'da ${f.title}: ${f.rooms.length} oda seçeneği ve ${maxCap} kişiye kadar konaklama.` +
      (am.length ? ` Olanaklar: ${am.join(", ")}.` : "") +
      ` Odalar: ${f.rooms.map((r) => `${r.name} (${r.bedType})`).join(", ")}.`,
    en:
      `${f.title} in ${f.city}: ${f.rooms.length} room option(s), sleeping up to ${maxCap} guests.` +
      (am.length ? ` Amenities: ${am.join(", ")}.` : ""),
  };
}

export interface MessageDraftFacts {
  propertyTitle: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  lastGuestMessage: string | null;
  /** Taslak dili (misafirin mesaj dili ya da ev sahibinin arayüz dili); varsayılan tr. */
  locale?: "tr" | "en";
}

/** Deterministik ev sahibi yanıt taslağı (P1-6); ev sahibi onaylamadan gönderilmez. */
export function demoMessageDraft(f: MessageDraftFacts): { reply: string } {
  if (f.locale === "en") {
    const opener = f.lastGuestMessage
      ? "Thank you for your message; I have noted it and will get back to you shortly."
      : "Thank you for your booking!";
    return {
      reply: `Hello ${f.guestName}, ${opener} We look forward to hosting you at ${f.propertyTitle} from ${f.checkIn} to ${f.checkOut}. If you have any other questions, feel free to write here.`,
    };
  }
  const opener = f.lastGuestMessage
    ? "Mesajınız için teşekkürler, konuyu not aldım ve en kısa sürede dönüş yapacağım."
    : "Rezervasyonunuz için teşekkürler!";
  return {
    reply: `Merhaba ${f.guestName}, ${opener} ${f.propertyTitle} için ${f.checkIn} – ${f.checkOut} tarihlerinde sizi ağırlamayı dört gözle bekliyoruz. Başka bir sorunuz olursa buradan yazabilirsiniz.`,
  };
}

/** P1-7: moderasyon gerekçe kodlarından deterministik açıklama (karar değil, yalnızca ifade). */
export function demoModerationExplain(reasons: { code: string; detail: string }[]): {
  explanation: string;
} {
  if (reasons.length === 0) return { explanation: "Kayıtlı bir işaretleme gerekçesi yok." };
  return {
    explanation: `Bu yorum otomatik kurallarca işaretlendi: ${reasons.map((r) => r.detail).join("; ")}. Yayınlama ya da kaldırma kararı yöneticiye aittir.`,
  };
}
