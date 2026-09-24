# ADR 0005 — LLM sözleşmesi: demo/fallback, karar vermez, KVKK redaksiyonu, guard'lar

- Durum: Kabul edildi
- Tarih: 2026-09-24

## Bağlam

GenAI özellikleri (Smart Filter, yorum özeti, trip-planner, ilan metni, olay çıkarımı) değerli ama üç riski var: (1) anahtar veya internet yokken demo çalışmaz, (2) model sayı ya da atıf uydurabilir, (3) kişisel veri üçüncü taraf API'ye gidebilir. Rezervasyon çekirdeğinin tutarlılık garantileri LLM'e bağlı olmamalı.

## Karar

- Tüm erişim `src/lib/llm/` üzerinden (`import "server-only"`): `LlmClient.completeJson(task, zodSchema, messages)`, `completeText` ve araç döngüsü (`LLM_MAX_TOOL_STEPS`). Sonuç her zaman `{ data, llmMode: "live" | "demo" | "fallback", model, latencyMs, usage?, reason? }`.
- **Modlar:** `LLM_MODE` = `auto` | `live` | `demo`. Anahtar yoksa deterministik demo üreticileri (`demo.ts`) gerçek girdi verisinden Türkçe çıktı üretir; ağa çıkılmaz.
- **Fallback:** timeout, 429, 5xx, ağ hatası, geçersiz JSON, şema hatası veya guard ihlali → o çağrı için demo çıktısı + `llmMode: "fallback"` + kısa `reason` kodu. API 200 döner; sistem çökmez.
- `response_format: json_object` 400 dönerse düz metin + JSON çıkarma (`json.ts`) yoluna düşülür ve bu sonuç süreç ömrü boyunca cache'lenir. `reasoning_content` yok sayılır.
- **LLM karar vermez:** fiyat, uygunluk, rezervasyon, iade, sıralama skoru ve olay etkisinin uygulanması deterministik koddadır. Olay çıkarımı yalnızca `PROPOSED` olay önerir; admin onayı olmadan fiyata yansımaz. Trip-planner asla rezervasyon yapmaz.
- **KVKK redaksiyonu** (`redaction.ts`) `LlmClient` içinde otomatik: TCKN (checksum doğrulamalı), IBAN, telefon, e-posta, kart numarası (Luhn), bilinen kişi adları → `<KISI_1>`, `<EPOSTA_1>` gibi oturum-içi pseudonimler.
- **Guard'lar** (`guards.ts`): `assertNumbersGrounded` (metindeki her sayı verilen "facts" kümesinde olmalı), `assertCitationsGrounded` (`[r:<id>]` atıfları gerçek yorum id'leri olmalı), Smart Filter için izinli facet listeleri.
- **Gizlilik:** anahtar hiçbir logda, hata mesajında, `/api/llm/status` yanıtında veya telemetri attribute'unda görünmez (yalnızca `hasKey`). Prompt ve yanıt içeriği loglanmaz (`LLM_LOG_PROMPTS` yalnızca geliştirmede ve redakte hâliyle).
- Metrikler: `llm_requests_total{task,mode,outcome}`, `llm_latency_seconds`, `llm_tokens_total`.
- Testler ağa çıkmaz: istemci mock'lanır, `tests/setup.ts` global `fetch`'i engeller.

## Sonuçlar

- `docker compose up` anahtarsız ve internetsiz tam demo verir; `.env` içine `LLM_API_KEY` eklemek tek adımda canlı moda geçirir.
- Canlı modun kalitesi modele bağlıdır; hatalı çıktılar guard'larla fallback'e düşer, kullanıcıya uydurulmuş sayı gösterilmez. Ayrıntı: [MODEL_CARD](../MODEL_CARD.md).
