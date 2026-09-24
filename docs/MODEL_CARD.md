# Model kartı — LLM kullanımı

> Bu kart booking-platform'un büyük dil modellerini **nerede, nasıl ve hangi sınırlar içinde** kullandığını anlatır. Sözleşmenin gerekçesi: [ADR 0005](adr/0005-llm-contract.md).

## 1. Özet

| Alan               | Değer                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Sağlayıcı arayüzü  | OpenAI-uyumlu Chat Completions (`openai` npm SDK); `LLM_BASE_URL` ile değiştirilebilir                  |
| Varsayılan model   | `deepseek-v4-flash` (`LLM_MODEL` ile değişir)                                                           |
| Modlar             | `live` (anahtar var), `demo` (anahtar yok veya `LLM_MODE` = `demo`), `fallback` (canlı çağrı başarısız) |
| Kod                | `src/lib/llm/*` (istemci, demo, JSON, redaksiyon, guard, metrik), görevler `src/lib/ai/*`               |
| Karar yetkisi      | **Yok.** Fiyat, uygunluk, rezervasyon, iade, sıralama ve olay etkisi deterministik koddadır             |
| Varsayılan ayarlar | temperature 0.2, max tokens 800, timeout 20 sn, 2 yeniden deneme, en fazla 5 araç adımı                 |

## 2. Görevler

| Görev (`task`)     | Kullanıldığı yer                                          | Girdi (redaksiyon sonrası)                                       | Çıktı şeması (zod)                                                                                                                   | Guard                                                                                                   |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `smart_filter`     | `POST /api/search/smart`                                  | Kullanıcının serbest metin sorgusu + izinli şehir/olanak sözlüğü | `{ city?, query?, guests? (1–20), minPrice?, maxPrice?, amenities[] (≤12), propertyType?, checkIn?, checkOut? (YYYY-MM-DD), sort? }` | Bilinmeyen şehir/olanak/tip/sıralama sessizce düşürülür; arama deterministik `search.ts` ile            |
| `review_summary`   | `GET /api/properties/[id]/reviews/summary`                | Son en fazla 30 yorumun id, puan ve metni                        | `{ summary (≤800), pros[] (≤5), cons[] (≤5), citations[] }`                                                                          | `assertCitationsGrounded` (her `[r:<id>]` gerçek yorum), `assertNumbersGrounded`                        |
| `trip_plan`        | `POST /api/ai/trip-plan`                                  | Şehir listesi, gün, kişi sayısı; araç çıktıları                  | `{ narrative (10–3000) }`                                                                                                            | Araç döngüsü (`optimizeRoute`, `searchStays`, `quoteStay`); anlatımdaki her sayı araç çıktısında olmalı |
| `listing_copy`     | `POST /api/ai/listing-copy` (mülk sahibi HOST veya ADMIN) | Mülk özellikleri (başlık, tip, şehir, olanaklar, oda sayısı)     | `{ tr (20–1500), en (20–1500) }`                                                                                                     | `assertNumbersGrounded`; host metni düzenleyip onaylar, otomatik yayınlanmaz                            |
| `event_extraction` | `POST /api/admin/events` (ADMIN)                          | Haber/duyuru metni (10–2000 karakter)                            | `{ city, startDate, endDate, category (konser/festival/spor/fuar/kongre/tatil/diğer), expectedImpact (1–10), rationale }`            | Sonuç yalnızca `PROPOSED` olay; admin onayı olmadan fiyata etkisi yok                                   |

Tüm yanıtlar `llmMode` alanını taşır; arayüz ve API tüketicisi çıktının canlı, demo veya fallback olduğunu görebilir.

## 3. Girdi gizliliği (KVKK)

LLM'e giden her mesaj `LlmClient` içinde otomatik olarak `redactText()`'ten geçer:

| Tür      | Algılama                                | Yer tutucu    |
| -------- | --------------------------------------- | ------------- |
| TCKN     | 11 hane + resmî checksum                | `<TCKN_1>`    |
| IBAN     | `TR` + 24 hane                          | `<IBAN_1>`    |
| Telefon  | +90 / 0 5xx biçimleri                   | `<TELEFON_1>` |
| E-posta  | RFC benzeri desen                       | `<EPOSTA_1>`  |
| Kart     | 13–19 hane + Luhn                       | `<KART_1>`    |
| Kişi adı | Bilinen kullanıcı adları + yorum yazarı | `<KISI_1>`    |

Yer tutucular oturum içidir; aynı değer aynı tutucuyu alır. Prompt ve yanıt içerikleri loglanmaz; yalnızca `task`, `llmMode`, `model`, `latencyMs` ve token sayıları loglanır.

## 4. Demo ve canlı farkı

| Görev              | Demo üreticisi (`src/lib/llm/demo.ts`, görev dosyaları)                                                                                      | Canlı                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `smart_filter`     | Kural tabanlı Türkçe ayrıştırıcı (`smart-filter-parser.ts`): şehir sözlüğü, "3000 TL altı", "2 bin", olanak eş anlamlıları, Türkçe ay adları | Model JSON üretir, sonra aynı sözlükle süzülür       |
| `review_summary`   | Anahtar kelime frekansıyla artı/eksi + gerçek yorum cümlelerinden alıntılar, atıflı                                                          | Model özet yazar; atıf ve sayı guard'ları uygulanır  |
| `trip_plan`        | Optimizer sırası + her durak için en iyi skorlu konaklama + Türkçe şablon anlatım                                                            | Model araçları çağırıp anlatır; olgular aynı plandan |
| `listing_copy`     | Özelliklerden TR/EN şablon metin                                                                                                             | Model metin yazar; sayılar özelliklerle sınırlı      |
| `event_extraction` | Tarih/şehir regex'i + kategori sözlüğü                                                                                                       | Model yapılandırılmış öneri çıkarır                  |

Demo çıktıları deterministiktir: aynı girdi her zaman aynı çıktıyı verir.

## 5. Fallback nedenleri

`timeout`, `rate_limited`, `upstream_5xx`, `http_4xx`, `network`, `invalid_json`, `schema_invalid`, `guard_failed`, `aborted`, `empty_response`, `tool_loop_exceeded`, `unknown`. Kodlar anahtar veya URL içermez; `/api/llm/status` son hata kodunu gösterir.

## 6. Değerlendirme

| Ölçüm                         | Yöntem                                                                                                                                                                                           | Sonuç                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Smart Filter doğruluğu (demo) | 20 cümlelik golden set, tam alan eşleşmesi (`tests/unit/ai/smart-filter-golden.test.ts`)                                                                                                         | **20/20** (eşik ≥ 18/20)           |
| Bilinmeyen facet sızıntısı    | Uydurma şehir/olanak içeren sorgu                                                                                                                                                                | 0                                  |
| İstemci davranışı             | Mock'lu senaryolar: canlı başarı, demo, timeout/429/500/geçersiz JSON/zod hatası → fallback, `json_object` 400 → düz metin yolu, `reasoning_content` yok sayma (`tests/unit/llm/client.test.ts`) | Geçer                              |
| Redaksiyon                    | Pozitif/negatif örnekler (`tests/unit/llm/redaction.test.ts`)                                                                                                                                    | Geçer                              |
| Sayı ve atıf guard'ları       | `tests/unit/llm/guards.test.ts`, `tests/integration/reviews.test.ts`, `tests/integration/trip-planner.test.ts`                                                                                   | Geçer                              |
| Canlı bağlantı                | `npm run llm:smoke` (1 JSON + 1 metin çağrısı)                                                                                                                                                   | Anahtar varken manuel çalıştırılır |

Testler ağa çıkmaz; canlı model kalitesi için otomatik bir benchmark yoktur.

## 7. Bilinen sınırlamalar

- Demo Smart Filter kural tabanlıdır; golden set dışındaki ifade biçimlerinde (argo, yazım hatası, karmaşık olumsuzlama) eksik filtre çıkarabilir. Kullanıcı çıkarılan filtreleri görüp düzeltebilir.
- Sayı guard'ı biçim yorumlamasına dayanır (ör. "3.000", "3 bin"); metinde geçen ama olgu kümesinde olmayan zararsız sayılar da (ör. "2 kişi" yerine "iki kişi") fallback'e yol açabilir — bu bilinçli olarak temkinli bir tercihtir.
- Yorum özeti en fazla son 30 yorumu kullanır; daha eski yorumlar özete girmez.
- Model Türkçe kalitesi sağlayıcıya bağlıdır; canlı modda üslup demodan farklı olabilir.
- Redaksiyon desen tabanlıdır; serbest metinde geçen ve kullanıcı listesinde olmayan üçüncü kişi adlarını yakalamayabilir.
- LLM çıktısı hukuki, tıbbi veya finansal tavsiye değildir; olay etkisi önerileri admin tarafından doğrulanmalıdır.
