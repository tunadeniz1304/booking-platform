/**
 * Görev başına deterministik DEMO üreticileri.
 *
 * Anahtar yokken (veya canlı çağrı başarısız olduğunda) aynı arayüzle, girdideki
 * GERÇEK verilerden (ilan başlığı, gerçek yorum cümleleri, gerçek fiyatlar)
 * anlamlı Türkçe çıktı üretir. Ağ erişimi yoktur; aynı girdi → aynı çıktı.
 */

export interface SmokeOutput {
  ok: boolean;
  message: string;
}

export function demoSmoke(): SmokeOutput {
  return { ok: true, message: "Demo modu: LLM çağrısı yapılmadı." };
}
