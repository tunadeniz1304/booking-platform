# booking-platform — Final raporu

> Portföy/demo projesidir; gerçek ödeme alınmaz, gerçek konaklama satılmaz.
> v3 bölümü en üstte; v2.0.0 raporu aşağıda değiştirilmeden korunur.

# v3

## 1. Özet (v3.0.0, 2026-09-26)

v2.0.0'dan sonra 61 commit. v2'nin bilinen 22 hatası (`booking.md` §1) kapatıldı ve her biri
`regression: v3#N` etiketli testle korunuyor (`grep -rho "regression: v3#[0-9]*" tests | sort -u`
→ 25 benzersiz etiket; #23–#25 v3 sırasında bulunan ek hatalar). Başlıca eklemeler:

- **Envanter v2:** oda tipi başına sayaç (`InventoryDay{total, sold, held}`, `CHECK sold+held<=total`),
  rate plan, kısıtlar, tesis saat dilimi (ADR 0010, 0011).
- **Para:** veri tabanlı vergi/ücret motoru, kalıcı FX + teklif başına kur anlık görüntüsü,
  conformal fiyat içgörüsü ve fiyat alarmı (ADR 0012).
- **Ödeme:** gerçek Stripe SDK sağlayıcısı + imzalı webhook + Payment Element (varsayılan hâlâ
  MockPsp), telafili ödeme sagası, devir sonrası alıcıya iade + payout, mock e-Arşiv fatura (ADR 0013).
- **Arama:** hibrit RRF (tsvector + pgvector + trigram + tam ifade), opsiyonel ONNX LTR,
  OpenFeature deneyi (ADR 0014).
- **Güven:** mesajlaşma (PII maskeleme), yorum moderasyonu, fraud v2 + passkey step-up,
  kayıt no doğrulaması + SDEP dışa aktarımı (ADR 0017).
- **Kanal/ajan/gelir:** MCP streamable HTTP + ACP checkout, iCal yoklama + belirteç döndürme,
  sınırlı fiyat önerili gelir paneli (ADR 0015).
- **i18n:** next-intl ile tr/en, `Intl` biçimleme, iki dilli e-postalar (ADR 0018).
- **Güvenlik:** tokenVersion, hesap kilidi, fail-closed denylist, login CSRF, proxy-hop'suz
  istemci anahtarı, `DEMO_MODE`, transport seviyesinde MCP kimliği, gRPC TLS + hız sınırı.

## 2. Faz faz yapılanlar

| Faz                             | İçerik                                                                                    | Başlıca commit'ler                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **F0/F1** — Kapı + güvenlik     | Kapsam genişletme, CI'da Docker zorunlu; #1, #2, #3, #5, #8, #11–#14, #22; LLM bütçesi    | `2ad1213`, `1c01e6c`, `2d54277`, `a63db8d`, `898bd93`, `b5e874a`, `6bec085`, `6aa520d` |
| **F2** — Envanter + saat dilimi | Sayaçlı envanter, rate plan, kısıtlar, Temporal; #6, #7, #15, #18                         | `9f29d57`, `b4b4363`, `76f3619`                                                        |
| **F3** — Vergi + FX + içgörü    | Vergi motoru, her yerde aynı toplam (#9), kalıcı FX (#23), conformal içgörü, fiyat alarmı | `1f7fb79`, `7beea1c`, `6248123`, `060687c`, `71005f4`                                  |
| **F4** — Ödeme                  | Stripe (#10), saga, devir iadesi (#4) + payout, e-Arşiv, FX saklama                       | `25bf1a7`, `db29919`, `cfe8391`, `cdc21e4`, `c127d02`                                  |
| **F5** — Arama                  | Hibrit RRF + LTR (#19), deneyler                                                          | `89d0566`, `6c90f4f`, `74679ff`                                                        |
| **F6** — Güven                  | Mesajlaşma, moderasyon (#24), fraud v2 + step-up, passkey UI, kayıt no (#25)              | `a4227c0`, `1f3fc26`, `579d674`, `4884afd`, `5cd41ee`                                  |
| **F7** — Kanal + ajan + gelir   | Ölü kod (#17), iCal yoklama (#21), MCP HTTP + ACP, gelir paneli                           | `7fc8409`, `cfaf0fe`, `87b26d2`, `651367d`                                             |
| **F8** — i18n + UI + yük        | tr/en (#20), axe, demo senaryoları, k6 + kaos; yükte bulunan 4 hatanın düzeltmesi         | `a020bec`, `294a643`, `ca2b216`, `5c7e9a0`, `3da026f`, `b66172b`, `3178ed1`, `041bc45` |
| **F9** — Dokümanlar + release   | §7 dokümanları, CI (i18n:check, mcp:smoke), bu rapor, CHANGELOG 3.0.0, `v3.0.0` etiketi   | bu sürümün commit'leri                                                                 |

## 3. Metrikler

Tüm sayılar 2026-09-25/26 tarihlerinde gerçekten çalıştırılan komutlardan alınmıştır.

| Ölçüm                                                                               | Değer                                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Unit + entegrasyon (`npm run test:coverage`)                                        | 679 test, 92 dosya, tamamı geçti (unit + testcontainers entegrasyon)                       |
| Kapsam (`src/lib`, `src/app/api`, `services`, `src/worker`; eşik satır 80 / dal 70) | satır %87.66, dal %78.72, fonksiyon %86.38, ifade %86.02                                   |
| e2e (Playwright + axe, `npm run test:e2e`)                                          | 18 test, tamamı geçti (Chromium, axe dahil; v3.0.0 imajlı Docker yığını, LLM demo modu)    |
| Regresyon etiketleri                                                                | 25 benzersiz `regression: v3#N` (şart ≥22)                                                 |
| k6 `search.js` (50 rps)                                                             | p95 29 ms, %0 hata; Redis kapalıyken p95 232.4 ms, %0 hata                                 |
| k6 `hold-spike.js`, sakin koşu                                                      | 201=1767, 409=2237, 5xx=0, p95 434 ms, p99 792 ms (**F8 düzeltmelerinden önceki imaj**)    |
| k6 `hold-spike.js`, yeni imaj                                                       | 201=931, 409=446, 5xx=0, p95 **41.9 s**, 2647 düşen iterasyon (gürültülü host)             |
| k6 `payment-race.js`                                                                | 20/20 CONFIRMED, çift tahsilat 0, p95 1.98 s (düzeltme öncesi koşu: 4 × 500)               |
| k6 `llm-fallback.js`                                                                | demo p95 49 ms; 1 sn timeout → %100 fallback, p95 1.13 s; canlı p95 15.1 s, %71.3 fallback |
| Değişmezler (tüm koşulardan sonra)                                                  | overbooking SQL 0, ledger çift CHARGE 0; Redis geri dönüşü ≈1.7 s                          |
| Arama nDCG@10 (30 sorguluk altın küme)                                              | v2 0.2377 → v3 hibrit RRF 0.8733 → hibrit + LTR 0.9126                                     |
| LTR (sentetik tıklama, test bölümü)                                                 | nDCG@10 ağırlıklı 0.7343 → LTR 0.8130 (+%10.71)                                            |

Kaynaklar: `docs/perf/k6-results.md`, `load/chaos.md`, `docs/perf/ltr.md`.

## 4. Dürüstlük notu

### v2 raporundaki abartılar (düzeltme)

Aşağıdaki v2 ifadeleri yazıldıkları anda koda göre fazla iddialıydı. v2 bölümü arşiv olarak
değiştirilmeden bırakıldı; düzeltme burada:

- **"Stripe sağlayıcısı opsiyonel":** v2'de UI her zaman mock `tokenizeCard` kullanıyordu,
  `confirmChallenge` kodu yok sayıyordu ve webhook gerçek `Stripe-Signature` /
  `payment_intent.*` olaylarını çözemiyordu (v3#10). Stripe yolu uçtan uca hiç çalışmadı.
  v3'te gerçek SDK + imzalı webhook + Payment Element var; varsayılan sağlayıcı yine MockPsp'dir.
- **"next-intl" / i18n:** v2'de yalnızca 3 dosya next-intl kullanıyordu, mesaj dosyaları ~900
  bayttı ve UI metinlerinin neredeyse tamamı sabit Türkçeydi (v3#20). Gerçek tr/en v3 F8'de geldi.
- **"Tek `computeTotal()` (kart = PDP = checkout = tahsilat)":** gRPC `estimated_total` oda
  çarpanını ve vergiyi atlıyordu, gRPC `Charge` float dönüyordu, legacy `pricing/engine.ts` ve
  `/api/negotiate` float hesaplıyordu (v3#9). v3'te tek fiyat kaynağı `priceStay`; pazarlık
  kaldırıldı, legacy motor `event-signals`'a katlandı (ADR 0016).
- **"Semantik sıralama":** varsayılan embedder FNV bag-of-words hash'iydi, UI hiç `semantic=1`
  göndermiyordu ve keyword yolunda `personal` + `semantic` bileşenleri (ağırlığın %25'i) daima
  0'dı (v3#19). Altın kümede v2 nDCG@10 yalnızca 0.2377'ydi.
- **"%80 kapsam":** v2'de kapsam yalnızca `src/lib/**` üzerinden ölçülüyordu (satır %83.31, dal
  %71.15); route handler'lar, gRPC/MCP ve worker ölçüm dışındaydı. v3'te bu dizinler de dahil.

### v3'ün açık riskleri

- **hold-spike p95:** yeni imajla ölçülen p95 41.9 s gürültülü (başka projelerin konteynerleriyle
  paylaşılan) bir host'ta alındı; p95 434 ms'lik sakin koşu F8 düzeltmelerinden **önceki** imajla
  yapıldı. Yeni imaj sakin bir host'ta yeniden koşulmalı; o zamana kadar gecikme hedefinin
  karşılandığı iddia edilmez. Doğruluk tarafı (5xx=0, overbooking 0) iki koşuda da tuttu.
- **Canlı LLM:** canlı modda p95 15.1 s ve isteklerin %71.3'ü fallback'e düştü. Demo modu (p95
  49 ms) sorunsuz; canlı mod demo sunumu için güvenilir değil.
- **Passkey mesajları yalnız Türkçe:** arayüz bileşenleri çevrili, ancak sunucunun döndürdüğü
  passkey hata metinleri (`src/lib/auth/passkey.ts`, ör. "Passkey doğrulanamadı") yalnız Türkçe;
  `en` arayüzde bu metinler Türkçe görünür.
- **Altın küme nDCG iyimser:** 30 sorguluk küme ve alaka etiketleri bu projede, sistemi bilen
  kişi tarafından yazıldı; LTR verisi sentetik tıklamalardır. 0.87 / 0.91 gerçek kullanıcı alaka
  düzeyini temsil etmez.
- **Step-up/passkey UI tarayıcıda test edilmedi:** WebAuthn akışı yalnızca birim/entegrasyon
  testleriyle (sahte doğrulayıcı) sınandı; Playwright e2e passkey girişi, passkey yönetimi ve
  ödeme step-up penceresini kapsamıyor (sanal authenticator ile e2e eklenmeli).
- **npm audit:** 4 orta (moderate), 0 yüksek/kritik. Hepsi `@prisma/instrumentation` 5.x
  üzerinden gelen `@opentelemetry/core` <2.8.0 (GHSA-8988-4f7v-96qf, W3C Baggage bellek ayırma);
  düzeltme Prisma 7.x major yükseltmesi gerektirir.
- **Stripe tarayıcıda doğrulanmadı:** CSP Stripe modunda gerekli alan adlarını içeriyor, ancak
  Payment Element gerçek Stripe test anahtarıyla tarayıcıda uçtan uca koşulmadı.

### Hâlâ mock / sentetik olanlar

MockPsp (varsayılan ödeme sağlayıcısı), mock TR/AB kayıt doğrulaması, mock e-Arşiv fatura ("DEMO —
mali değeri yoktur"), mock payout, sentetik LTR tıklama verisi, embedding anahtarı yokken hash
embedding yedeği ve deterministik LLM demo yanıtları.

## 5. Bilinen sınırlamalar

- Tek bölge, tek Postgres; yatay ölçekleme ve okuma replikası yok.
- iCal yalnız yoklama (push yok); fiyat eşitliği kontrolü yalnız uyarır.
- Gelir önerisi kural tabanlı ve açıklanabilir; talep tahmini modeli yok.
- Fraud v2 kural tabanlıdır; öğrenilmiş model ve gerçek BIN/IP veritabanı yok.
- Yük testleri tek makinede, uygulama ile aynı host'ta koşuldu.

## 6. §3 LLM sözleşmesi — doğrulama tablosu

Her madde koda karşı yeniden doğrulandı; "Test" sütunundaki testler ağa çıkmaz
(sahte `fetch` / bellek içi bütçe).

| Madde                                                                                               | Kodda                                                                                                               | Test                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `.env` içeriği okunmaz/loglanmaz/commit edilmez; yalnızca ad listesi                                | `.gitignore`, `.dockerignore` (`.env`, `.env.*`, `!.env.example`); compose `env_file`                               | `tests/unit/regressions/infra.test.ts` (#14, #21)                     |
| `.env` arama: kök → `../.env`, `override: false`                                                    | `src/lib/config/load-env.ts`                                                                                        | `tests/unit/llm/v3-contract.test.ts` › ".env arama"                   |
| Anahtar log/hata/status yanıtında yok (pino `redact`)                                               | `src/lib/observability/logger.ts` (`LOGGER_OPTIONS.redact`), `src/lib/llm/status.ts` (`hasKey`)                     | `v3-contract.test.ts` › "pino redact", "/api/llm/status"              |
| İstemci: `new OpenAI({ apiKey, baseURL, timeout, maxRetries })`                                     | `src/lib/llm/client.ts` (`getSdk`)                                                                                  | `tests/unit/llm/client.test.ts` › "canlı başarı"                      |
| Değişken önceliği (anahtar/base URL/model) + varsayılanlar                                          | `src/lib/llm/settings.ts`                                                                                           | `tests/unit/llm/settings.test.ts`                                     |
| `LLM_MODE=auto\|live\|demo`; anahtarsız → demo, ağa çıkılmaz                                        | `settings.ts` (`effectiveMode`), `client.ts`                                                                        | `settings.test.ts`, `client.test.ts` › "anahtar yok → demo"           |
| timeout/429/5xx/ağ/geçersiz JSON/şema/guard → çağrı bazında demo + `llmMode: "fallback"` + `reason` | `client.ts` (`classifyLlmError`, `handleFailure`)                                                                   | `client.test.ts` › timeout, ağ, geçersiz JSON, zod, boş içerik, guard |
| `response_format: json_object`; 400'de düz metin + JSON çıkarma                                     | `client.ts` (`create`), `src/lib/llm/json.ts`                                                                       | `client.test.ts` › "json_object 400", `json.test.ts`                  |
| `reasoning_content` yok sayılır                                                                     | `client.ts` (`contentOf`)                                                                                           | `client.test.ts` › "reasoning_content"                                |
| Sayı/tarih/atıf halüsinasyon koruması                                                               | `src/lib/llm/guards.ts`                                                                                             | `guards.test.ts`                                                      |
| LLM bağlayıcı karar vermez                                                                          | fiyat/müsaitlik/iade/fraud deterministik (`pricing/`, `booking/`, `risk/`); AI uçları yalnızca açıklama/özet/taslak | mimari kural; §6                                                      |
| KVKK redaksiyonu + yanıt sonrası geri koyma                                                         | `src/lib/llm/redaction.ts`                                                                                          | `redaction.test.ts`, `client.test.ts` › "redakte"                     |
| Metrik + log (latency, token, mod, reason)                                                          | `src/lib/llm/metrics.ts`, `client.ts` (`record`)                                                                    | `tests/unit/observability/observability.test.ts`                      |
| Başlangıç logu `LLM: CANLI (…)` / `LLM: DEMO modu`                                                  | `settings.ts` (`describeLlmMode`), `src/lib/llm/startup.ts`                                                         | `settings.test.ts` › "açıklama anahtar içermez"                       |
| `GET /api/llm/status`, `npm run llm:smoke`                                                          | `src/app/api/llm/status/route.ts`, `scripts/llm-smoke.ts`                                                           | `v3-contract.test.ts` › status                                        |
| **v3-a** kullanıcı başına günlük token bütçesi → demo + `reason: "budget"`                          | `src/lib/llm/budget.ts`, `client.ts` (`overBudget`/`charge`), `src/lib/http/ai.ts`                                  | `v3-contract.test.ts` › "§3 v3-a"                                     |
| **v3-b** tüm AI uçları `ai` rate-limit kategorisinde (yorum özeti dahil)                            | `src/lib/security/rate-limit.ts` (`categorize`)                                                                     | `v3-contract.test.ts` › "§3 v3-b"                                     |
| **v3-c** `LLM_LOG_PROMPTS=true` → yalnızca redakte prompt, debug; production'da kapalı              | `client.ts` (`logPrompt`), `settings.ts`                                                                            | `v3-contract.test.ts` › "§3 v3-c"                                     |
| **v3-d** AI Act Md. 50: API `ai_generated: true`, UI "AI tarafından üretildi"                       | `LlmResult.aiGenerated`, `markAiGenerated` (5 AI ucu), `LlmBadge`                                                   | `v3-contract.test.ts` › "§3 v3-d"                                     |
| **v3-e** SDK'ya doğrudan erişim yasak (`no-restricted-imports`)                                     | `eslint.config.mjs`; embedding çağrısı `src/lib/llm/embeddings.ts`'e taşındı                                        | `v3-contract.test.ts` › "§3 v3-e"; `npm run lint`                     |

---

# v2.0.0 raporu (arşiv)

> Bu rapordaki tüm sayılar 2026-09-24/25 tarihlerinde gerçekten çalıştırılan komutların çıktısıdır; çalıştırılmayan ölçümler açıkça "koşulmadı" diye belirtilmiştir.

## 1. Özet

v1'deki prototip (Next.js 14, PENDING'de takılan rezervasyonlar, float para, ödeme yok, 22 bilinen hata, 22 test, kırmızı CI) şu hâle getirildi:

- Rezervasyon çekirdeği: `PENDING → HELD → CONFIRMED → COMPLETED | CANCELLED | EXPIRED` durum makinesi, hold TTL + `expire-holds` job'ı, Redlock + SERIALIZABLE + `SELECT … FOR UPDATE` ile kanıtlı tek kazanan (entegrasyon: 100 paralel → 1 başarı; k6: 200 VU → 1 başarı; SQL overbooking = 0).
- Para: tamsayı minor-unit, tek `computeTotal()` (kart = PDP = checkout = tahsilat), konaklama vergisi config'ten.
- Ödeme/iptal/bildirim: MockPsp (3DS, capture, refund, imzalı webhook), sürümlü iptal politikası + `computeRefund()`, Türkçe e-postalar (SMTP veya dev mailbox).
- GenAI: LLM yalnızca açıklama/özet/NL→filtre için; anahtarsız deterministik demo, hata anında çağrı bazında fallback, KVKK redaksiyonu, sayı/atıf guard'ları.
- Güvenlik, gözlemlenebilirlik, host/admin extranet, KVKK self-servis, e2e + yük testi, CI.

## 2. Faz faz yapılanlar

| Faz                                       | İçerik                                                                                                                                                                                                                                                                                                                        | Başlıca commit'ler                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **F0** — Keşif + kalite kapısı            | Prettier, `.gitattributes`, `.dockerignore`, Vitest unit/integration projeleri (testcontainers), coverage; Next 16 / React 19 / ESLint 9 / Vitest 5 yükseltmesi (ADR 0009)                                                                                                                                                    | `2852676`, `47fa454`, `2aad6c4`, `bd44028`                                                                                         |
| **F1** — LLM sözleşmesi + güvenlik temeli | `src/lib/llm/*` (live/demo/fallback), `/api/llm/status`, `llm:smoke`; hata #1, #2, #5, #6, #14–#19, #21; jose tekilleştirme, nonce'lu CSP                                                                                                                                                                                     | `4731a36`, `a55e4b5`, `f6cd347`, `663b6a4`, `40a0697`, `6291090`, `c3e95d5`, `a1d708c`, `5dd3c9c`, `f92b59a`                       |
| **F2** — Rezervasyon çekirdeği            | Durum makinesi + hold/expiry (#4), para/quote (#7, #8, #20), outbox (#9), 100-paralel testi                                                                                                                                                                                                                                   | `19ab8b2`, `a89667d`, `e93508e`, `96452a4`                                                                                         |
| **F3** — Ödeme + iptal + bildirim         | P0-4 iptal politikası, P0-5 MockPsp/3DS/webhook, P0-7 e-postalar, transfer (#3, P1-8)                                                                                                                                                                                                                                         | `28261f4`, `f31685e`, `cc0d7cb`, `2811f05`                                                                                         |
| **F4** — Gözlemlenebilirlik + migration   | pino, OTel, `/api/metrics`, health/ready, Grafana JSON; rollover + partisyon betiği; SSE (#11), routing (#12)                                                                                                                                                                                                                 | `ca1af79`, `c30008b`, `c919574`, `4301d66`, `9aadbea`                                                                              |
| **F5** — Arama & GenAI I                  | Smart Filter (golden set 20/20 demo), açıklanabilir sıralama + `/ranking`, takılabilir embedder (#22), next-intl + FX                                                                                                                                                                                                         | `71f438b`, `2c60dfe`, `767813c`, `6330788`                                                                                         |
| **F6** — Yorumlar + GenAI II              | Doğrulanmış yorum + atıflı özet, grounded trip-planner, onaylı olay sinyalleri (#13)                                                                                                                                                                                                                                          | `4c30709`, `0b6dfda`, `ab283a2`                                                                                                    |
| **F7** — Host/Admin                       | Extranet API, iCal + gRPC ARI, fraud skoru, admin kuyrukları + audit log, KVKK API                                                                                                                                                                                                                                            | `7636dd5`, `8e10147`                                                                                                               |
| **F8** — Portföy                          | Seed genişletme + `demo:reset`; `/host`, `/admin`, `/plan`, `/transfers`, `/account/privacy`, çerez bandı; Smart Filter çipleri, "neden bu sırada", MapLibre harita; PDP yorum özeti, rol farkında menü, atlama bağlantısı; Playwright e2e + axe, k6, Lighthouse; a11y düzeltmeleri; compose'da CSRF origin hatası düzeltmesi | `f451c1b`, `c271e8e`, `c579512`, `43e9af7`, `9c9afad`, `50ab4ba`, `44e446d`, `31d6365`, `ed94724`, `f623a61`, `da45ad8`, `859efad` |
| **F9** — Docs + CI + cila                 | README (+ ekran görüntüleri), ARCHITECTURE, ADR 0001–0009, METHODOLOGY, MODEL_CARD, COMPLIANCE, DEMO_SCRIPT, CHANGELOG, LICENSE; CI'ya e2e job'ı ve %80 kapsam eşiği; MCP sunucusu (P1-12); harita kümelemesi + liste senkronu; PDP görsel optimizasyonu; bu rapor; sürüm 2.0.0                                               | `99e81fe`, `69d5933` ve bu rapor commit'i                                                                                          |

## 3. Hata → regresyon testi eşlemesi (§1 "Bilinen hatalar")

Tüm test adları `regression: #<no>` önekiyle aranabilir (`grep -rn "regression: #" tests`). 22 hatanın 22'sinin de adanmış bir testi var.

|   # | Hata                                     | Test dosyası                                                                   | Test (describe/it) adı                                                                                                                                      |
| --: | ---------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | gRPC kimlik doğrulaması yok              | `tests/unit/security/grpc-auth.test.ts`, `tests/integration/grpc-auth.test.ts` | `regression: #1 gRPC kimlik doğrulaması`, `regression: #1 gRPC auth (integration)`                                                                          |
|   2 | İç uçlar varsayılan sırla korunuyor      | `tests/unit/security/internal-auth.test.ts`                                    | `regression: #2 iç uçlar varsayılan sırla korunuyor`                                                                                                        |
|   3 | Transfer bedava devir + işlevsiz HMAC    | `tests/integration/transfer.test.ts`                                           | `regression: #3 P2P devir (integration)`                                                                                                                    |
|   4 | Ödenmeyen PENDING envanteri tutuyor      | `tests/integration/booking-core.test.ts`                                       | `regression: #4 hold süresi dolunca EXPIRED olur ve envanter geri gelir`, `regression: #4 eski sürümden kalan PENDING kayıtlar da süre aşımında temizlenir` |
|   5 | Rate-limit atlatma                       | `tests/unit/security/proxy.test.ts`                                            | `regression: #5 rate-limit atlatma`                                                                                                                         |
|   6 | `x-user-id` sahteciliği                  | `tests/unit/security/proxy.test.ts`                                            | `regression: #6 kimlik başlığı sahteciliği`                                                                                                                 |
|   7 | İstemci para birimini seçebiliyor        | `tests/integration/booking-core.test.ts`                                       | `regression: #7 para birimi daima mülkün para birimi`                                                                                                       |
|   8 | Gösterilen ≠ tahsil edilen fiyat         | `tests/unit/pricing/quote.test.ts`, `tests/integration/booking-core.test.ts`   | `regression: #8 gösterilen fiyat = tahsil edilen fiyat`, `regression: #8 teklif = rezervasyon toplamı; fiyat değişirse 409 PRICE_CHANGED`                   |
|   9 | Outbox çift yayın / lease / sonsuz retry | `tests/integration/booking-core.test.ts`                                       | `regression: #9 outbox — iki işçi aynı mesajı birlikte kiralayamaz…`, `regression: #9 outbox — azami denemeden sonra DEAD…`                                 |
|  10 | BullMQ worker'ı import anında açılıyor   | `tests/unit/regressions/runtime.test.ts`                                       | `regression: #10 kuyruk modülü import anında Worker başlatmaz`                                                                                              |
|  11 | SSE sınırsız                             | `tests/unit/observability/observability.test.ts`                               | `regression: #11 canlı SSE sınırları`                                                                                                                       |
|  12 | Routing optimizer hataları               | `tests/unit/routing.test.ts`                                                   | `regression: #12 çok şehirli rota optimizasyonu`                                                                                                            |
|  13 | Sentiment/event trigger bileşik artış    | `tests/integration/event-signals.test.ts`                                      | `regression: #13 olay sinyalleri (integration)`                                                                                                             |
|  14 | Docker imajı build olmuyor               | `tests/unit/regressions/infra.test.ts`                                         | `regression: #14 Docker imajı`                                                                                                                              |
|  15 | Compose/CI                               | `tests/unit/regressions/infra.test.ts`                                         | `regression: #15 compose ve CI`                                                                                                                             |
|  16 | Auth açıkları                            | `tests/unit/security/auth.test.ts`, `tests/unit/security/proxy.test.ts`        | `regression: #16 kimlik doğrulama`, `regression: #16 logout çerezli GET/cross-site POST ile tetiklenemez`                                                   |
|  17 | `POST /api/pricing` yetki                | `tests/unit/security/pricing-route.test.ts`                                    | `regression: #17 POST /api/pricing yetki`                                                                                                                   |
|  18 | `KEYS search:*`                          | `tests/unit/regressions/runtime.test.ts`                                       | `regression: #18 arama önbelleği KEYS kullanmaz`                                                                                                            |
|  19 | Sorgu profil'leyici varsayılan açık      | `tests/unit/regressions/runtime.test.ts`                                       | `regression: #19 sorgu profil'leyicisi`                                                                                                                     |
|  20 | Float para, yerel/UTC saat karışımı      | `tests/unit/money/money.test.ts`, `tests/unit/time/nights.test.ts`             | `regression: #20 para — tamsayı minor-unit`, `regression: #20 UTC gece tipi`                                                                                |
|  21 | `.env.example` eksik                     | `tests/unit/regressions/infra.test.ts`                                         | `regression: #21 .env.example eksiksiz`                                                                                                                     |
|  22 | Yeni mülkte embedding yok                | `tests/integration/property-embedding.test.ts`                                 | `regression: #22 yeni mülk embedding`                                                                                                                       |

Adanmış testi olmayan hata: **yok**. Not: #3, #4, #7, #9, #13, #22 yalnızca entegrasyon testleriyle (Docker/testcontainers) korunur; #1 ve #8'in hem unit hem entegrasyon testi var.

## 4. Metrikler

| Ölçüm                                          | Değer                                                                                            | Komut                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Unit testler                                   | **252 / 252** geçti (32 dosya)                                                                   | `npm run test:unit`                              |
| Entegrasyon testleri                           | **50 / 50** geçti (16 dosya; gerçek Postgres 16 + pgvector ve Redis 7, testcontainers)           | `npm run test:int`                               |
| E2E testleri                                   | **11 / 11** geçti (3 dosya; harita kümeleme + liste senkronu dahil)                              | `npm run test:e2e` (compose demo yığınına karşı) |
| Toplam                                         | **313** test (hedef ≥ 150)                                                                       | —                                                |
| Kapsam (`src/lib/**/*.ts`, unit + entegrasyon) | satır **%83.31**, ifade %81.18, dal %71.15, fonksiyon %79.14 (eşik: satır ≥ %80, CI'da zorlanır) | `npm run test:coverage`                          |
| axe (wcag2a/aa, wcag21a/aa)                    | 6 ana sayfada **0** serious/critical                                                             | `tests/e2e/a11y.spec.ts`                         |
| k6 — yarış                                     | 200 VU aynı oda-gecesi → **1 × 201, 199 × 409 SOLD_OUT**; SQL overbooking **0**                  | [docs/perf/k6-results.md](perf/k6-results.md)    |
| k6 — `/api/search` p95                         | **16.62 ms** (compose ağı içinden); host NAT üzerinden ilk koşumda 1.39 s (eşik ✗)               | aynı dosya                                       |
| Lighthouse (mobil)                             | Accessibility 6/6 sayfada **100**; Performance 92–96, PDP 5 koşumda 89–95 (medyan 90)            | [docs/perf/lighthouse.md](perf/lighthouse.md)    |
| MCP duman testi                                | 3 araç listelendi; token'sız `create_hold` → `UNAUTHORIZED`                                      | `npm run mcp:smoke`                              |
| Smart Filter golden set                        | 20/20 (demo modu)                                                                                | `tests/unit/ai/smart-filter-golden.test.ts`      |
| `npm audit --audit-level=high`                 | 0 high/critical (4 moderate: `@opentelemetry/*`, `@prisma/instrumentation`)                      | `npm audit`                                      |

Kapsam notu: §8'deki "yeni kodda ≥ %80" ölçütü `vitest.config.mts` içinde `coverage.thresholds.lines = 80` olarak tanımlıdır ve CI'nın entegrasyon job'ında (`npm run test:coverage`: unit + entegrasyon birlikte) zorlanır. Yalnız unit koşusu DB/Redis yollarını içermediği için eşik birleşik koşuya uygulanır.

## 5. Öncesi / sonrası (§2 "Hedef" sütunu)

| Yetkinlik          | v1                             | Hedef                                                                    | Gerçekleşen (v2.0.0)                                                                                          |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Çift rezervasyon   | Redlock + FOR UPDATE, hold yok | + HELD/TTL, expire job, 100 paralel → 1, EXCLUDE ADR'si                  | ✅ Hepsi; ADR 0002 EXCLUDE constraint'i değerlendirir; k6 200 VU ile de doğrulandı                            |
| Ödeme              | Yok                            | `PaymentProvider` + `MockPsp` (auth/capture/refund/webhook), ops. Stripe | ✅ 3DS simülasyonu dahil; Stripe sağlayıcısı SDK'sız REST (`fetch`) ile opsiyonel (`PAYMENT_PROVIDER=stripe`) |
| İptal & iade       | Yok                            | Sürümlü politika + snapshot + `computeRefund()`                          | ✅ e2e'de iade tutarı UI'da doğrulanıyor                                                                      |
| Fiyat şeffaflığı   | Float, ekran ≠ tahsilat        | `computeTotal()` minor-unit, vergi config, fast-check                    | ✅                                                                                                            |
| Arama & sıralama   | Prisma filtre                  | Facet, harita, açıklanabilir skor                                        | ✅ `explain` + `/ranking` + MapLibre harita, `supercluster` kümelemesi, harita ↔ liste senkronu (e2e)         |
| GenAI arama        | Yok                            | Smart Filter, trip-planner copilot                                       | ✅ Çipli Smart Filter, `/plan` sayfası, MCP sunucusu (`search_stays`, `get_quote`, `create_hold`)             |
| Yorumlar           | Model var, API yok             | Doğrulanmış yorum, host yanıtı, atıflı özet                              | ✅                                                                                                            |
| Partner extranet   | Yok                            | `/host`: oda, takvim, fiyat, rezervasyonlar, ilan copilot'u              | ✅ (takvim e2e ile doğrulandı)                                                                                |
| Kanal yönetimi     | Yok                            | iCal + ARI gRPC                                                          | ✅                                                                                                            |
| Dinamik fiyatlama  | Sınırsız "sentiment"           | Faktör açıklaması, onaylı olay sinyali, [floor, ceiling]                 | ✅                                                                                                            |
| Güvenlik           | Çok sayıda açık                | Açıklar kapalı, refresh rotation, CSRF, fraud skoru                      | ✅ + F8'de compose'daki CSRF origin hatası düzeltildi                                                         |
| Gözlemlenebilirlik | `console.*`                    | pino, OTel, `/api/metrics`, Grafana                                      | ✅                                                                                                            |
| Uyum               | Yok                            | Aydınlatma + çerez onayı, dışa aktarım/silme, belge no, axe              | ✅ (hukuki görüş değildir)                                                                                    |
| Test & CI          | 22 test, CI kırmızı            | ≥ 150 test, testcontainers, Playwright, k6, yeşil CI                     | ✅ 313 test, %83 satır kapsamı (eşikli), CI'da e2e job'ı; GitHub Actions yeşil                                |

## 6. Bilinen sınırlamalar

- **Harita karoları OSM'den gelir:** karo sunucusuna erişim yoksa harita görünümü tasarım gereği listeye döner; harita e2e testi bu durumda gerekçesiyle atlanır.
- **MCP sunucusu yalnızca stdio:** uzak (HTTP/SSE) taşıma yok; `create_hold` ödeme almaz, ödeme web arayüzünde tamamlanır.
- **Kapsam eşiği birleşik koşu içindir:** %80 satır eşiği unit + entegrasyon birlikte (`npm run test:coverage`, Docker gerekir) ölçülür; yalnız unit koşusunda DB/Redis yolları kapsanmaz.
- **Lighthouse ölçüm ortamı:** PDP `chrome-headless-shell` ile 5/5 koşumda ≥ 85 (89–95); tam Chrome `--headless=new` bu makinede çoğunlukla `NO_NAVSTART` verdi, tamamlanan tek koşumu 82 idi. LCP uzak (Unsplash) görsele bağlıdır.
- **k6 tek makinede** koşuldu (Windows + Docker Desktop); host NAT üzerinden arama p95 eşiği ilk koşumda aşıldı, compose ağı içinden 13–17 ms.
- **Secret taraması yanlış pozitifleri:** §9'daki regex `git diff` üzerinde kaldırılan (`-`) placeholder satırlarını da yakalayabilir; commit öncesi tarama yalnızca eklenen (`+`) satırlarda yapıldı ve hepsinde 0'dır.
- **Eski Docker volume'ları:** v2 öncesi `postgres_data` volume'u ile parola uyuşmaz; bir kez `docker compose down -v` gerekir (README'de belirtildi).
- **SMTP:** `.env`'de SMTP tanımlı ama sunucuya ulaşılamıyorsa e-posta yine `/dev/mailbox`'ta görünür, ancak `smtp/FAILED` durumuyla.
- **Anonim ziyaretçide konsol 401'leri:** oturum yoklaması beklenen `401` döndürdüğü için Lighthouse Best Practices 96.
- **Availability partitioning** opt-in ve Prisma şemasıyla drift'li (ADR 0006).
- **`npm audit`:** 4 moderate açık (OpenTelemetry / `@prisma/instrumentation` transitif), high/critical yok.

## 7. Gelecek iş

1. MCP için uzak taşıma (Streamable HTTP) ve OAuth tabanlı kullanıcı yetkilendirmesi.
2. Dal (branch) kapsamının %71'den yukarı çekilmesi; servis katmanı için ek unit testleri.
3. Görselleri yerel/CDN'de barındırmak (`public/demo/`), harita için çevrimdışı vektör karo (Protomaps).
4. k6'yı CI'da (nightly) compose ağı içinde koşup eşikleri kalıcı izlemek; çoklu makine yük testi.
5. Gerçek PSP (Stripe test mode) ile uçtan uca test, 3DS2 akışının gerçek SDK ile doğrulanması.
6. Erişilebilirlik için manuel ekran okuyucu testi.
7. Availability partitioning'in Prisma şemasıyla uyumlu hâle getirilmesi.
