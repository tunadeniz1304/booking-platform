# booking-platform — Faz Takibi

> v3 turu en üstte; v2 (etiket `v2.0.0`) geçmişi aşağıda korunur; v4 turu dosyanın sonundadır.

# v3 — "OTA seviyesi" turu

Her faz sonunda kalite kapısı: `npm run lint` · `npm run typecheck` · `npm run format:check` ·
`npm run test:unit -- --coverage` · `npm run test:int` (Docker) · `npm run build` ·
`docker compose build` · `npm audit --audit-level=high` · (F8+) `npm run test:e2e`.

## v3 F0 — Keşif + genişletilmiş kalite kapısı

- [x] `origin/main` ile senkron
- [x] Coverage kapsamı: `src/lib`, `src/app/api`, `services`, `src/worker`; eşik satır 80 / dal 70
- [x] `test:int`: CI'da Docker yoksa başarısız; yerelde uyarıyla atlanır
- [x] `@prisma/client` / `prisma` / `@prisma/instrumentation` sürüm hizalama

## v3 F1 — LLM sözleşmesi doğrulama + güvenlik & para hataları

- [x] §3 doğrulama tablosu + v3 eklemeleri (bütçe, `ai` kategorisi, redakte prompt logu, `ai_generated`, `no-restricted-imports`)
- [x] Hatalar #1, #2, #3, #5, #8, #11, #12, #13, #14, #16
- [x] P0-8 auth sertleştirme (tokenVersion, lockout, e-posta doğrulama, şifre sıfırlama, passkey)
- [x] P0-9 demo/prod ayrımı (`DEMO_MODE`)

## v3 F2 — Envanter v2 + saat dilimi + arama doğruluğu

- [x] P0-2 `RoomType` / `RatePlan` / `Restriction` / `InventoryDay` + veri taşıma
- [x] P0-3 `Property.timeZone` + Temporal (#6, #18 `complete-stays`)
- [x] #7 arama doğruluğu; #15 / P0-11 veri yaşam döngüsü

## v3 F3 — Vergi, FX, tek fiyat kaynağı, fiyat içgörüsü

- [x] P0-4 vergi/ücret motoru + toplam fiyat
- [x] P0-5 kalıcı FX (`FxRate`, `fx-refresh`)
- [x] #9 tek `computeTotal` (legacy engine + negotiate ADR)
- [x] P1-4 conformal fiyat içgörüsü + fiyat alarmı

## v3 F4 — Ödeme, saga, devir ledger'ı

- [x] P0-6 gerçek Stripe + ödeme kilidi; #10
- [x] P0-7 saga + telafi
- [x] #4 devir iadesi + payout ledger; mock e-Arşiv PDF

## v3 F5 — Hibrit arama, LTR, deneyler

- [x] P1-1 hibrit arama RRF (#19)
- [x] P1-2 LTR (ONNX, fallback)
- [x] P1-3 OpenFeature + ilk A/B

## v3 F6 — Mesajlaşma, moderasyon, fraud v2, uyum

- [x] P1-6 mesajlaşma; P1-7 yorum moderasyonu; P1-8 fraud v2 + step-up; passkey UI; P1-10 belge/kayıt no

## v3 F7 — Agentic booking, host gelir paneli, kanal yöneticisi

- [x] P1-11 MCP HTTP + `ui://` + checkout_sessions; P1-5 gelir paneli; P1-9 kanal (#21); #17 ölü kod

## v3 F8 — i18n, UI, demo, yük

- [x] P1-12 i18n (#20); P2-1 UI + a11y; P2-2 demo senaryoları; P2-3 yük/kaos; ekran görüntüleri

## v3 F9 — Dokümanlar + release

- [x] §7 dokümanlar, CI, FINAL_REPORT v3 + dürüstlük notu, CHANGELOG, `v3.0.0` tag

---

# v2 — Faz Takibi (tamamlandı)

Her faz sonunda kalite kapısı: `npm run lint`, `npm run typecheck`, `npm run format:check`,
`npm run test:unit -- --coverage`, `npm run test:int` (Docker), `docker compose build`,
`npm audit --audit-level=high`.

## F0 — Keşif + kalite kapısı

- [x] `origin/main` ile senkron (yerel `main` = `origin/main`)
- [x] `/archive/` `.gitignore`'da, içeriğe dokunulmadı
- [x] Prettier (`.prettierrc`, `prettier-plugin-tailwindcss`), `.gitattributes` (LF)
- [x] `typecheck`, `format:check`, `check` script'leri
- [x] Vitest `unit` / `integration` projeleri; entegrasyon testcontainers (pgvector + redis)
- [x] `@vitest/coverage-v8`
- [x] `.dockerignore`
- [x] Next 16 / React 19 / ESLint 9 / Vitest 5 yükseltmesi → `npm audit` 0 (ADR 0009)
- [x] Mevcut 22 test yeşil (12 unit + 10 entegrasyon)

## F1 — LLM sözleşmesi + güvenlik temeli

- [x] §3 LLM katmanı (`src/lib/llm/*`), `/api/llm/status`, `npm run llm:smoke` (canlı doğrulandı)
- [x] Hata #1 gRPC auth, #2 iç uçlar, #5 rate-limit, #6 header spoof
- [x] Hata #14 Dockerfile, #15 compose/CI, #16 auth, #17 pricing yetki
- [x] Hata #19 sorgu profil'leyici (ayrı commit), #21 `.env.example`
- [x] `jose` tekilleştirme (jsonwebtoken kaldırıldı), güvenlik başlıkları + nonce'lu CSP
- [x] Ek: #10 kuyruk/worker ayrımı, #18 sürüm anahtarlı arama önbelleği (F2'den öne alındı)

## F2 — Rezervasyon çekirdeği

- [x] P0-2 durum makinesi + hold/expiry (#4)
- [x] P0-3 para/quote (#7, #8, #20)
- [x] Outbox (#9), BullMQ ayrımı (#10), cache (#18)
- [x] 100 paralel eşzamanlılık testi (1 başarı / 99 SOLD_OUT, SQL overbooking 0)

## F3 — Ödeme + iptal + bildirim

- [x] P0-4 iptal politikası, P0-5 ödeme (MockPsp + 3DS + webhook), P0-7 bildirimler
- [x] Transfer (#3) + P1-8 servis/API (`/transfers` sayfası F8'de eklendi)

## F4 — Gözlemlenebilirlik + migration disiplini

- [x] P0-8 (pino, OTel, `/api/metrics`, health/ready, Grafana dashboard), P0-9 (rollover, partisyon betiği)
- [x] SSE (#11), routing (#12)

## F5 — Arama & GenAI I

- [x] P1-1 Smart Filter (golden set ≥ 18/20), P1-2 açıklanabilir sıralama, P1-11 embedding (#22), P1-3 i18n/FX
- [x] Harita görünümü (MapLibre) + `supercluster` kümelemesi, harita ↔ liste seçim senkronu (e2e)

## F6 — Yorumlar + GenAI II

- [x] P1-4 yorumlar + atıflı özet, P1-6 trip-planner (API; `/plan` sayfası F8), P1-5 olay sinyalleri (#13)

## F7 — Host/Admin

- [x] P1-7 extranet API, P1-9 kanal simülatörü, P1-10 fraud, P2-4 admin API, P2-5 KVKK API (UI sayfaları F8)

## F8 — Portföy

- [x] P2-1 UI: `/host`, `/admin`, `/plan`, `/transfers`, `/account/privacy`, çerez bandı, harita, a11y düzeltmeleri
- [x] P2-2 seed/demo (`demo:reset`, lisans no, politikalar, 365 gün envanter)
- [x] P2-3 Playwright e2e (11/11, harita senkronu dahil) + axe (6 sayfa, 0 serious/critical), k6 (1 başarı / 199 SOLD_OUT, SQL overbooking 0)
- [x] Lighthouse mobil raporu (`docs/perf/lighthouse.md`; a11y 100, PDP 5 koşumda 89–95)
- [x] (ops.) P1-12 MCP sunucusu (`services/mcp`, `npm run mcp:server`, `npm run mcp:smoke`)

## F9 — Docs + CI + cila

- [x] README, ARCHITECTURE, ADR'ler, METHODOLOGY, MODEL_CARD, COMPLIANCE, DEMO_SCRIPT
- [x] `ci.yml` (e2e job'ı dahil), CHANGELOG, LICENSE, `docs/FINAL_REPORT.md`, `package.json` 2.0.0
- [x] README ekran görüntüleri (`docs/img/`, `npm run docs:screenshots`)
- [x] `v2.0.0` tag + push, CI'nın GitHub'da yeşil olduğunun doğrulanması

# v4 — Sepet, pazar yeri parası, güven ve ajan ticareti turu

Başlangıç: `v3.0.0` (main @ `05f7199`). Bitiş: `v4.0.0`. Her faz sonunda kalite kapısı:
`npm run lint` · `npm run typecheck` · `npm run format:check` · `npm run test:unit -- --coverage` ·
`npm run test:int` (Docker) · `npm run i18n:check` · `npm run build` · `docker compose build` ·
`npm audit --omit=dev --audit-level=high` · (F3+) `npm run test:e2e` · (F7+) `npm run mcp:smoke`.

## v4 F0 — Taban çizgisi (2026-09-26)

| Kapı                                | Sonuç                                                         |
| ----------------------------------- | ------------------------------------------------------------- |
| `lint` (`--max-warnings=0`)         | yeşil                                                         |
| `typecheck`                         | yeşil                                                         |
| `format:check`                      | yeşil (yerel plan/ajan dosyaları `.prettierignore`'a eklendi) |
| `test:unit -- --coverage`           | 57 dosya / **503 test** yeşil (~4,5 dk)                       |
| unit coverage (yalnız unit projesi) | satır %44,97 · dal %42,85 · fonksiyon %45,82 · ifade %45,13   |
| `test:int` (testcontainers)         | 35 dosya / **176 test** yeşil (~11 dk, build ile eşzamanlı)   |
| `i18n:check`                        | 24 ad alanı, tr/en eşit                                       |
| `build`                             | yeşil                                                         |
| `npm audit --omit=dev` (high)       | yeşil (0 high/critical, 4 moderate)                           |
| `docker compose build` · `test:e2e` | F0'da atlandı (süre); e2e tabanı 18 test                      |

Not: satır ≥ %80 / dal ≥ %70 eşiği `vitest.config.ts`'te yalnızca birleşik (unit + integration)
koşuda uygulanır; tek proje koşusunda eşik devre dışıdır. v4 kuralı: **yeni kodda** satır ≥ %80,
dal ≥ %70.

## v4 faz tablosu

| Faz | İçerik                                                                                  | ADR / çıktı                  |
| --- | --------------------------------------------------------------------------------------- | ---------------------------- |
| F0  | Keşif, kalite kapısı, taban çizgisi, plan                                               | bu bölüm                     |
| F1  | LLM sözleşmesi doğrulama + hata #1–#20 (`regression: v4#N`) + P0-4 recent-auth/step-up  | 20 regresyon testi, ADR 0024 |
| F2  | P0-2 `BigInt` minor-unit para migration'ı + P0-3 çift girişli defter + mutabakat        | ADR 0019, 0020               |
| F3  | P1-1 grup sepeti + P1-2 bölünmüş ödeme + P1-3 esnek tarih fiyat takvimi                 | sepet e2e                    |
| F4  | P1-4 escrow/payout/DAC7 + P1-5 hasar depozitosu & çözüm merkezi + P1-7 sadakat/cüzdan   | ADR 0021                     |
| F5  | P1-6 KYC & güven-emniyet + P1-8 promosyon motoru + Omnibus 30 gün en düşük fiyat        | kural tablosu testleri       |
| F6  | P1-9 AI yorum öne çıkanları & karşılaştırma + P1-10 görsel zekâ / çok-modlu arama       | ADR 0022                     |
| F7  | P1-11 ajan ticareti v2 (ACP + UCP + AP2 mandate) + P1-12 PWA / Web Push                 | ADR 0023, `mcp:smoke`        |
| F8  | P1-13 uyum otomasyonu + P2-1 UI + P2-2 demo senaryoları + P2-3 yük/kaos, e2e genişletme | `docs/perf/`                 |
| F9  | Dokümanlar, CI, cila, `FINAL_REPORT.md`, `CHANGELOG.md`, `v4.0.0` etiketi               | sürüm                        |

F1 paralel yürütme için dört bağımsız gruba ayrılır (aynı dosyaya dokunan hatalar aynı grupta):

- **A — şema/migration + rezervasyon çekirdeği:** #1, #9, #14, #15, #19
- **B — ödeme + step-up:** #2, #7, #8, #13, #16
- **C — kimlik/güvenlik/altyapı:** #4, #5, #6, #12, #17, #18, #20
- **D — LLM maliyeti + ajan checkout + SSRF:** #3, #10, #11

## v4 riskler

| Risk                                                                                                                           | Etki   | Önlem                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------- |
| #15 (`Decimal` → `BigInt`) F2 P0-2 ile örtüşür, geniş okuyucu yüzeyi                                                           | yüksek | expand/contract; F1'de yalnızca kapsamı dar tut, asıl göç F2'de tek ADR (0019) ile |
| Paralel F1 grupları ortak dosyalarda çakışır (`app-config.ts`, `.env.example`, `messages/*`, `src/worker/index.ts`, route'lar) | orta   | yalnızca ekleme yap, sık `git pull --rebase`; #6 route bağlantısı en son yapılır   |
| Integration suite uzun (~10 dk) ve Docker'a bağımlı                                                                            | orta   | önce ilgili dosyalar, faz sonunda bir kez tam suite                                |
| Birleşik coverage eşiği (80/70) mevcut kodda tutmayabilir                                                                      | orta   | yeni kod için eşik; birleşik koşu F9'da ölçülür                                    |
| Ağır opsiyonel bağımlılıklar (CLIP/ONNX, `sharp`) build/CI'yı şişirir                                                          | orta   | `optionalDependencies` + dinamik import + özellik bayrağı                          |
| Dış servis yokluğu (Stripe, Identity, VAPID, LLM)                                                                              | düşük  | mock/demo yolları; testler ağa çıkmaz                                              |
| Regülasyon yorum hatası (7565, DSA, DAC7, UBL-TR)                                                                              | düşük  | eğitim amaçlı notu; kural tabloları testle sabitlenir                              |
