# Model kartı

> Bu kart booking-platform'daki **öğrenen veya istatistiksel** bileşenleri anlatır: arama sıralaması (LTR), fiyat aralığı (conformal), embedding ve büyük dil modeli (LLM) görevleri. Her bölüm verinin nereden geldiğini, nasıl ölçüldüğünü ve nerede yetersiz kaldığını belirtir. İlgili kararlar: [ADR 0005](adr/0005-llm-contract.md), [ADR 0008](adr/0008-hash-vs-real-embedding.md), [ADR 0014](adr/0014-hybrid-search-ltr-experiments.md), [ADR 0017](adr/0017-messaging-moderation-step-up.md).

## 1. Genel ilke: model karar vermez

| Bileşen          | Ne üretir                        | Ne **yapmaz**                                                               |
| ---------------- | -------------------------------- | --------------------------------------------------------------------------- |
| LTR (ONNX)       | Arama sonuçlarının sırası        | Fiyatı, uygunluğu veya reklamı etkilemez                                    |
| Conformal aralık | "Düşük / Tipik / Yüksek" etiketi | Fiyat belirlemez; yalnızca bilgi verir                                      |
| Embedding        | Vektör benzerliği (RRF kanalı)   | Tek başına sıralamaz; dört kanaldan biridir                                 |
| LLM              | Metin, filtre önerisi, açıklama  | Fiyat, rezervasyon, iade, moderasyon, fraud veya olay etkisine karar vermez |

Fiyat, vergi, fraud, gelir önerisi ve fiyat içgörüsü tamamen deterministik koddur ([METHODOLOGY](METHODOLOGY.md)).

## 2. Arama sıralaması: LTR

> **SENTETİK VERİ UYARISI.** Model gerçek kullanıcı davranışıyla değil, `scripts/ltr/generate-clicks.ts` ile üretilmiş **sentetik** tıklama günlüğüyle eğitilmiştir. Aşağıdaki ölçümler modelin bu simülasyondaki gizli alaka fonksiyonunu ne kadar iyi öğrendiğini gösterir; gerçek trafikteki başarıyı kanıtlamaz.

### 2.1 Veri üretimi (`scripts/ltr/generate-clicks.ts`)

- Tohumlu PRNG (`mulberry32`, tohum 20260925) → her çalıştırma aynı veriyi üretir.
- `LTR_QUERIES` (varsayılan 3000) sorgu, sorgu başına 20 aday.
- **Gizli alaka** (modele verilmez):
  `u = 2.4·relevance + 1.2·personal·(relevance > 0.35 ? 1 : 0.2) + 0.9·priceFit·rating − 0.8·[rating < 0.5] + 0.2·popularity + 0.25·gauss`
  Sorgu içinde %50/%80/%95 yüzdelik kesimleriyle 0–3 derecesine çevrilir.
- **Günlük politikası:** adaylar üretimdeki ağırlıklı sıralamayla (sorgulu ağırlıklar) dizilir.
- **Tıklama modeli (cascade, pozisyon yanlılıklı):** inceleme olasılığı `1/(1+pos)^0.6`; tıklama olasılığı dereceye göre `[0.04, 0.2, 0.5, 0.85]`; tıklanan sonucun rezervasyona dönme olasılığı `[0, 0.04, 0.15, 0.4]`.

### 2.2 Özellikler (`src/lib/search/ltr.ts`, `LTR_FEATURES`)

`relevance` (hibrit ilgi), `lexical`, `vector`, `trigram` (RRF kanal skorları), `priceFit`, `rating`, `popularity`, `personal` (ağırlıklı sıralamanın bileşenleri). Hepsi [0, 1] aralığına kırpılır. Özellik sırası `models/ranker.meta.json` ile birebir aynı olmalıdır.

### 2.3 Eğitim (`scripts/ltr/train.py`)

- Etiket: rezervasyon = 2, tıklama = 1, diğer = 0. Sorgu bazında %80 eğitim / %20 test.
- `LGBMRanker(objective="lambdarank", n_estimators=120, learning_rate=0.08, num_leaves=15, min_child_samples=40)`, LightGBM 4.7.0.
- Test nDCG@10 **gizli dereceye** göre ölçülür (tıklamaya göre değil); karşılaştırma üretimdeki ağırlıklı sıralamadır.
- ONNX'e `onnxmltools.convert_lightgbm` ile (opset 15) çevrilir → `models/ranker.onnx` (127 927 bayt, depoda).

### 2.4 Ölçümler ([docs/perf/ltr.md](perf/ltr.md))

| Ölçüm                               | Değer                |
| ----------------------------------- | -------------------- |
| Eğitim / test sorgusu               | 2400 / 600           |
| Tıklama / rezervasyon               | 4924 / 1267          |
| nDCG@10 — ağırlıklı (sentetik test) | 0.7343               |
| nDCG@10 — LTR (sentetik test)       | **0.8130** (+%10.71) |
| Altın küme — v2 taban (30 sorgu)    | 0.2377               |
| Altın küme — v3 hibrit (RRF)        | 0.8733               |
| Altın küme — v3 hibrit + LTR        | 0.9126               |

Altın küme `tests/integration/search-golden.test.ts` + `tests/fixtures/search-golden.json` (40 ilan, 30 derecelendirilmiş sorgu) ile gerçek PostgreSQL üzerinde ölçülür. En zayıf sorgular: "plaja yakın otel" 0.313, "family hotel kids" 0.552, "beach hotel" 0.596, "göl manzarası" 0.683.

**Dürüstlük notu:** altın kümedeki 0.24 → 0.87 sıçraması **iyimserdir**. Küme küçüktür (30 sorgu), proje ekibi tarafından yazılmıştır ve eş anlamlı sözlüğü (`src/lib/embedding/synonyms.ts`) bu küme bilinerek hazırlanmıştır; yani sözlük kısmen test kümesine uydurulmuştur. Bağımsız, gerçek sorgulardan oluşan bir değerlendirme kümesi yoktur.

### 2.5 Çalışma zamanı ve yedek

- `onnxruntime-node` **opsiyonel** bağımlılıktır; model ilk kullanımda tembel yüklenir (`LTR_MODEL_PATH`, varsayılan `models/ranker.onnx`).
- Paket yoksa, model dosyası yoksa veya yüklenemiyorsa, ya da çıktı boyutu yanlış / sonlu değilse sıralama **ağırlıklı skora** düşer (`mode: "weighted"`) ve bu bir kez loglanır.
- Alpine Docker imajında `onnxruntime-node` bulunmaz (`next.config.ts` → `outputFileTracingExcludes`); konteynerde `ranking.ltr` kolu ağırlıklı sıralamayla aynı sonucu verir.
- Canlı karşılaştırma: `search-ranking` bayrağı (`ranking.weighted` / `ranking.ltr`), yalnızca giriş yapmış veya analitik onayı vermiş kullanıcılarda; atama murmurhash3 ile `exp_sid` çerezine göre yapılır, maruziyet `ExperimentExposure`'a yazılır, sonuçlar `GET /api/admin/experiments` üzerinden Wilson aralığıyla okunur. Henüz gerçek trafik sonucu yoktur.
- Açıklama (`explain`) her iki kolda da ağırlıklı bileşenlerdir; LTR skorunun kendisi yorumlanabilir değildir.

### 2.6 Sınırlamalar

- Sentetik veri, gizli alaka fonksiyonunu tasarlayan kişinin varsayımlarını taşır; model bu varsayımları öğrenir. Gerçek kullanıcı tercihleri farklıysa kazanç kaybolabilir veya tersine dönebilir.
- Günlük politikası sabittir; karşı-olgusal düzeltme (IPS vb.) uygulanmaz, pozisyon yanlılığı etiketlerde kalır.
- Eğitim ve test aynı simülatörden gelir; dağılım kayması test edilmemiştir.
- Yeniden üretme: `npm run ltr:clicks` → `npm run ltr:train` (Python + `lightgbm`, `onnxmltools` gerekir).

## 3. Fiyat içgörüsü: conformal aralık (`src/lib/pricing/insight.ts`)

- **Yöntem:** split conformal prediction. Tahminci olaysız motor fiyatıdır (`explainNightPrice(..., events: [])`, yani taban × mevsim × hafta günü). Uygunsuzluk skoru `|y/ŷ − 1|`. Kalibrasyon kümesi aynı konum ve para birimindeki **diğer** oda tiplerinin bugün ± 90 günlük `InventoryDay` fiyatlarıdır. Kantil `⌈(n+1)(1−α)⌉ / n`, `α = PRICE_INSIGHT_ALPHA` = 0.1 (hedef kapsama %90). Tam algoritma: [METHODOLOGY §4.1](METHODOLOGY.md).
- **Eğitim yok:** öğrenilmiş parametre yoktur; kalibrasyon her istekte veritabanından yapılır.
- **Çıktı:** aralık `[alt, üst]` ve `low` / `typical` / `high` etiketi. Kalibrasyon skoru `PRICE_INSIGHT_MIN_CALIBRATION` (20) altındaysa aralık ve etiket `null` döner (arayüz etiket göstermez).
- **Sınırlamalar:**
  - Kapsama garantisi **marjinaldir** ve değiştirilebilirlik varsayımına dayanır; farklı mülkler, oda tipleri ve mevsimler karıştığı için bu varsayım yalnızca yaklaşık olarak sağlanır. Tek bir mülk veya gece için %90 garanti edilmez.
  - Demo veritabanındaki fiyatlar gerçek pazar verisi değildir; gerçek veriyle ölçülmüş bir kapsama oranı yoktur.
  - "Düşük/Yüksek" bir pazar karşılaştırması değil, platformdaki benzer envantere göredir.
- LLM kullanılmaz.

## 4. Embedding (`src/lib/embedding/provider.ts`, [ADR 0008](adr/0008-hash-vs-real-embedding.md))

| Sağlayıcı                   | Etkinleşme                                           | Model adı (`embeddingModel`) | Nitelik                                                                                    |
| --------------------------- | ---------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `HashEmbedder` (varsayılan) | `EMBEDDING_MODEL` boş                                | `hash-fnv1a-128-syn`         | 128 boyutlu FNV-1a feature hashing + eş anlamlı genişletme, L2 normalize. **ML değildir.** |
| `OpenAIEmbedder`            | `EMBEDDING_MODEL` dolu ve uzak istemci kurulabiliyor | `openai:<model>:128`         | OpenAI-uyumlu `/embeddings`, `dimensions: 128`                                             |

- Uzak çağrı hata verirse veya boyut 128 değilse o istek için hash'e düşülür.
- Sütun `vector(128)`; sağlayıcı değişince `npm run embeddings:backfill` çalıştırılmalıdır (farklı uzaylardaki vektörler karşılaştırılamaz).
- **Dürüstlük:** varsayılan kurulumda "vektör" kanalı anlamsal değil, eş anlamlı sözlüğüyle zenginleştirilmiş kelime örtüşmesidir. Altın küme ölçümleri bu hash sağlayıcıyla alınmıştır; gerçek bir embedding modeliyle ölçüm yapılmamıştır.

## 5. LLM kullanımı

### 5.1 Özet

| Alan               | Değer                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sağlayıcı arayüzü  | OpenAI-uyumlu Chat Completions (`openai` npm SDK); `LLM_BASE_URL` ile değiştirilebilir                                                                         |
| Varsayılan model   | `deepseek-v4-flash` (`LLM_MODEL` ile değişir)                                                                                                                  |
| Modlar             | `live` (anahtar var), `demo` (anahtar yok veya `LLM_MODE` = `demo`), `fallback` (canlı çağrı başarısız)                                                        |
| Kod                | `src/lib/llm/*` (istemci, demo, JSON, redaksiyon, guard, metrik), görevler `src/lib/ai/*` ve alan modülleri                                                    |
| Karar yetkisi      | **Yok** ([ADR 0017](adr/0017-messaging-moderation-step-up.md)). Fiyat, uygunluk, rezervasyon, iade, sıralama, moderasyon ve olay etkisi deterministik koddadır |
| Varsayılan ayarlar | temperature 0.2, max tokens 800, timeout 20 sn, 2 yeniden deneme, en fazla 5 araç adımı                                                                        |

Anahtar tanımlı değilse tüm görevler **demo** modunda deterministik şablonlarla çalışır; varsayılan kurulum budur.

### 5.2 Görevler

| Görev (`task`)       | Kullanıldığı yer                                          | Girdi (redaksiyon sonrası)                                          | Çıktı şeması (zod)                                                                                                                   | Guard / insan kontrolü                                                                                                                        |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `smart_filter`       | `POST /api/search/smart`                                  | Kullanıcının serbest metin sorgusu + izinli şehir/olanak sözlüğü    | `{ city?, query?, guests? (1–20), minPrice?, maxPrice?, amenities[] (≤12), propertyType?, checkIn?, checkOut? (YYYY-MM-DD), sort? }` | Bilinmeyen şehir/olanak/tip/sıralama sessizce düşürülür; arama deterministik `search.ts` ile                                                  |
| `review_summary`     | `GET /api/properties/[id]/reviews/summary`                | Son en fazla 30 yorumun id, puan ve metni                           | `{ summary (≤800), pros[] (≤5), cons[] (≤5), citations[] }`                                                                          | `assertCitationsGrounded` (her `[r:<id>]` gerçek yorum), `assertNumbersGrounded`                                                              |
| `trip_plan`          | `POST /api/ai/trip-plan`                                  | Şehir listesi, gün, kişi sayısı; araç çıktıları                     | `{ narrative (10–3000) }`                                                                                                            | Araç döngüsü (`optimizeRoute`, `searchStays`, `quoteStay`); anlatımdaki her sayı araç çıktısında olmalı                                       |
| `listing_copy`       | `POST /api/ai/listing-copy` (mülk sahibi HOST veya ADMIN) | Mülk özellikleri (başlık, tip, şehir, olanaklar, oda sayısı)        | `{ tr (20–1500), en (20–1500) }`                                                                                                     | `assertNumbersGrounded`; host metni düzenleyip onaylar, otomatik yayınlanmaz                                                                  |
| `event_extraction`   | `POST /api/admin/events` (ADMIN)                          | Haber/duyuru metni (10–2000 karakter)                               | `{ city, startDate, endDate, category (konser/festival/spor/fuar/kongre/tatil/diğer), expectedImpact (1–10), rationale }`            | Sonuç yalnızca `PROPOSED` olay; admin onayı olmadan fiyata etkisi yok                                                                         |
| `message_draft`      | `POST /api/bookings/[id]/messages/draft` (yalnız HOST)    | Rezervasyon olguları + son mesajlar                                 | `{ reply (≥5, ≤ MESSAGE_MAX_LENGTH) }`                                                                                               | Taslak kaydedilmez/gönderilmez; iletişim bilgisi maskelenir; host düzenleyip `fromAiDraft: true` ile gönderir                                 |
| `moderation_explain` | `GET /api/admin/reviews` (moderasyon kuyruğu, ADMIN)      | **Yalnızca gerekçe kodları** (yorum metni gönderilmez)              | `{ explanation (5–600) }`                                                                                                            | Karar önermez; onay/red admin'indir                                                                                                           |
| `revenue_explain`    | `POST /api/host/revenue/suggestions` (HOST)               | `suggestPrice` çıktısı (taban, katkılar, öneri)                     | Tek cümlelik düz metin (`completeText`, en fazla 160 token)                                                                          | `assertNumbersGrounded`; aksi `demoRevenueExplanation`; kabul/red host'undur                                                                  |
| `review_highlights`  | `GET /api/properties/[id]/review-highlights` (v4)         | Bir k-means kümesinin redakte cümleleri + yorum id'leri             | `{ title, claims[{ text, quote, reviewId }] }`                                                                                       | `filterQuotedClaims`: alıntı kaynak yorumda birebir geçmeli, sayılar dayanaklı; geçmeyen iddia reddedilir ([METHODOLOGY §10](METHODOLOGY.md)) |
| `listing_compare`    | `GET /api/compare` (v4)                                   | Yapılandırılmış karşılaştırma tablosu (toplamlar `createQuote`'tan) | `{ commentary (≤900) }`                                                                                                              | Her sayı tabloda olmalı, aksi şablon yorum; toplamlar ve "en ucuz/en esnek" rozetleri deterministik koddur                                    |
| `message_risk`       | Mesaj gönderimi (opsiyonel, `MESSAGE_SCAN_LLM_ENABLED`)   | Mesaj metni (istemci redaksiyonundan geçer)                         | `{ label: SUSPICIOUS \| BENIGN }`                                                                                                    | Yalnız `llmSignal` olarak kaydedilir; uyarı bandı/engelleme kararı deterministik taramadır; demo modunda çağrılmaz                            |

`smoke` görevi yalnızca `npm run llm:smoke` bağlantı testidir.

### 5.3 Etiketleme (AB Yapay Zekâ Yasası md. 50)

- LLM üreten her API yanıtı `llmMode` alanını ve `markAiGenerated` (`src/lib/http/ai.ts`) ile `ai_generated: true` işaretini taşır.
- Arayüzde `LlmBadge` bileşeni "AI tarafından üretildi" rozetini ve modu (canlı/demo/yedek) gösterir.
- Host'un AI taslağından gönderdiği mesaj `fromAiDraft: true` ile saklanır.

### 5.4 Girdi gizliliği (KVKK)

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

### 5.5 Demo ve canlı farkı

| Görev                | Demo üreticisi (`src/lib/llm/demo.ts`, görev dosyaları)                                                                                      | Canlı                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `smart_filter`       | Kural tabanlı Türkçe ayrıştırıcı (`smart-filter-parser.ts`): şehir sözlüğü, "3000 TL altı", "2 bin", olanak eş anlamlıları, Türkçe ay adları | Model JSON üretir, sonra aynı sözlükle süzülür       |
| `review_summary`     | Anahtar kelime frekansıyla artı/eksi + gerçek yorum cümlelerinden alıntılar, atıflı                                                          | Model özet yazar; atıf ve sayı guard'ları uygulanır  |
| `trip_plan`          | Optimizer sırası + her durak için en iyi skorlu konaklama + Türkçe şablon anlatım                                                            | Model araçları çağırıp anlatır; olgular aynı plandan |
| `listing_copy`       | Özelliklerden TR/EN şablon metin                                                                                                             | Model metin yazar; sayılar özelliklerle sınırlı      |
| `event_extraction`   | Tarih/şehir regex'i + kategori sözlüğü                                                                                                       | Model yapılandırılmış öneri çıkarır                  |
| `message_draft`      | `demoMessageDraft`: rezervasyon olgularından nazik şablon yanıt                                                                              | Model taslak yazar; maskeleme uygulanır              |
| `moderation_explain` | `demoModerationExplain`: gerekçe kodlarından şablon cümle                                                                                    | Model kodları doğal dille ifade eder                 |
| `revenue_explain`    | `demoRevenueExplanation`: katkı listesinden şablon cümle                                                                                     | Model açıklar; sayı guard'ı uygulanır                |

Demo çıktıları deterministiktir: aynı girdi her zaman aynı çıktıyı verir.

### 5.6 Fallback nedenleri

`timeout`, `rate_limited`, `upstream_5xx`, `http_4xx`, `network`, `invalid_json`, `schema_invalid`, `guard_failed`, `aborted`, `empty_response`, `tool_loop_exceeded`, `unknown`. Kodlar anahtar veya URL içermez; `/api/llm/status` son hata kodunu gösterir.

### 5.7 Değerlendirme

| Ölçüm                         | Yöntem                                                                                                                                                                                           | Sonuç                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Smart Filter doğruluğu (demo) | 20 cümlelik golden set, tam alan eşleşmesi (`tests/unit/ai/smart-filter-golden.test.ts`)                                                                                                         | **20/20** (eşik ≥ 18/20)           |
| Bilinmeyen facet sızıntısı    | Uydurma şehir/olanak içeren sorgu                                                                                                                                                                | 0                                  |
| İstemci davranışı             | Mock'lu senaryolar: canlı başarı, demo, timeout/429/500/geçersiz JSON/zod hatası → fallback, `json_object` 400 → düz metin yolu, `reasoning_content` yok sayma (`tests/unit/llm/client.test.ts`) | Geçer                              |
| v3 görev sözleşmeleri         | `tests/unit/llm/v3-contract.test.ts`, `tests/integration/v3-review-moderation.test.ts`                                                                                                           | Geçer                              |
| Redaksiyon                    | Pozitif/negatif örnekler (`tests/unit/llm/redaction.test.ts`)                                                                                                                                    | Geçer                              |
| Sayı ve atıf guard'ları       | `tests/unit/llm/guards.test.ts`, `tests/integration/reviews.test.ts`, `tests/integration/trip-planner.test.ts`                                                                                   | Geçer                              |
| Canlı bağlantı                | `npm run llm:smoke` (1 JSON + 1 metin çağrısı)                                                                                                                                                   | Anahtar varken manuel çalıştırılır |

Testler ağa çıkmaz; canlı model kalitesi için otomatik bir benchmark yoktur.

### 5.8 Bilinen sınırlamalar

- Demo Smart Filter kural tabanlıdır; golden set dışındaki ifade biçimlerinde (argo, yazım hatası, karmaşık olumsuzlama) eksik filtre çıkarabilir. Kullanıcı çıkarılan filtreleri görüp düzeltebilir.
- Sayı guard'ı biçim yorumlamasına dayanır (ör. "3.000", "3 bin"); metinde geçen ama olgu kümesinde olmayan zararsız sayılar da (ör. "2 kişi" yerine "iki kişi") fallback'e yol açabilir — bu bilinçli olarak temkinli bir tercihtir.
- Yorum özeti en fazla son 30 yorumu kullanır; daha eski yorumlar özete girmez.
- Model Türkçe kalitesi sağlayıcıya bağlıdır; canlı modda üslup demodan farklı olabilir.
- Redaksiyon desen tabanlıdır; serbest metinde geçen ve kullanıcı listesinde olmayan üçüncü kişi adlarını yakalamayabilir.
- Mesaj taslağı geçmiş mesajları modele gönderir (redaksiyon ve maskeleme sonrası); host göndermeden önce içeriği kontrol etmelidir.
- LLM çıktısı hukuki, tıbbi veya finansal tavsiye değildir; olay etkisi önerileri admin tarafından doğrulanmalıdır.

## 6. Görsel zekâ: fotoğraf kalite skoru ve CLIP ([ADR 0022](adr/0022-multimodal-search.md))

### 6.1 Kalite skoru ve pHash (`src/lib/vision/quality.ts`, `phash.ts`)

- **Model değil, deterministik sinyal işleme.** Netlik: 512 px gri tonda 4-komşu Laplacian varyansı, `VISION_BLUR_VARIANCE_GOOD`'a (300) bölünüp 0..1'e kırpılır. Pozlama: parlaklık histogramının ortalamasının orta tona (128) yakınlığı × kırpılmış uç piksel (≤8 / ≥247) cezası. Kalite = 0.6·netlik + 0.4·pozlama (`VISION_QUALITY_BLUR_WEIGHT`).
- **pHash:** 32×32 gri → 2B DCT → düşük frekanslı 8×8 katsayı medyana göre 64 bit. Duplikat = Hamming ≤ `VISION_DUPLICATE_MAX_HAMMING` (8). Yeniden boyutlandırma/JPEG/+%10 parlaklıkta ≤8, farklı sahnede >8 (birim test; ölçülen sentetik örneklerde 28–36; %8 kenar kırpmada 14 → kaçar).
- **Karar vermez:** skor ve duplikat yalnız host'a uyarıdır; yükleme engellenmez, ilan otomatik reddedilmez, arama sıralamasına girmez.

### 6.2 CLIP görsel embedding (`src/lib/vision/clip.ts`)

- Model: `Xenova/clip-vit-base-patch32` (OpenAI CLIP ViT-B/32'nin ONNX dönüşümü), yalnız görü kulesi, 8-bit nicemlenmiş (~86 MB), `@huggingface/transformers` ile CPU'da; 512-d, L2-normalize. Yerel ölçüm (dizüstü CPU): yükleme ~1.2 sn, görsel başına ~80 ms.
- Kullanım: yalnız "bu fotoğraftaki gibi" arama kanalı (RRF'de sıra tabanlı; ağırlığı diğer kanallarla eşit). Kosinüs < `VISION_MIN_SIMILARITY` (0.75) elenir — CLIP'te ilgisiz görsel çiftleri bile ~0.5–0.7 benzerlik verebildiği için eşik yüksek tutuldu.
- Opsiyoneldir: `VISION_CLIP_ENABLED=false` (varsayılan), paket yok veya model indirilmemişse (`npm run vision:download`) özellik kapalı; API `visual.reason` (`FLAG_OFF`/`MODULE_MISSING`/`MODEL_MISSING`/`LOAD_FAILED`/`VECTOR_UNAVAILABLE`) ve UI açıklama döner. Testler deterministik stub (16×16 RGB) kullanır; ağa çıkmaz.

### 6.3 Sınırlamalar ve önyargı

- CLIP, internetten toplanmış İngilizce ağırlıklı görsel-metin çiftleriyle eğitildi; Batı mimari/iç mekân estetiğini "tipik" sayma ve yerel (ör. geleneksel Türk evi, köy evi) sahneleri daha az ayırt etme eğilimi vardır. Görsel benzerlik stil/renk düzenine duyarlıdır; aynı mülkün gece/gündüz fotoğrafları uzak düşebilir.
- Görsel benzerlik fiyat, konum veya kaliteyi ima etmez; kanal yalnız aday üretir, sıralama mevcut ağırlıklı/LTR sıralayıcıda kalır.
- Kalite skoru profesyonel/estetik değerlendirme değildir: bilinçli bokeh, gece çekimi veya minimalist beyaz iç mekân düşük skor alabilir; eşik (`VISION_LOW_QUALITY_THRESHOLD` 0.35) yalnız uyarı üretir.
- pHash kırpma, aynalama ve güçlü filtreye dayanıklı değildir (kırpılmış kopya kaçabilir); farklı ama çok benzer kareler (aynı odanın iki çekimi) duplikat sayılabilir. Başka host'un ilanıyla eşleşmede o ilanın kimliği gösterilmez.
- Yüz/kişi tanıma yapılmaz; yüklemede EXIF/GPS meta verisi silinir. Otomatik değerlendirme veri kümesi (etiketli benzerlik çiftleri) yoktur.
