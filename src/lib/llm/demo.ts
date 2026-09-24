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
