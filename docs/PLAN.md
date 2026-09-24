# booking-platform v2 — Faz Takibi

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
- [x] Harita görünümü (MapLibre) → F8'de eklendi (kümeleme yok)

## F6 — Yorumlar + GenAI II

- [x] P1-4 yorumlar + atıflı özet, P1-6 trip-planner (API; `/plan` sayfası F8), P1-5 olay sinyalleri (#13)

## F7 — Host/Admin

- [x] P1-7 extranet API, P1-9 kanal simülatörü, P1-10 fraud, P2-4 admin API, P2-5 KVKK API (UI sayfaları F8)

## F8 — Portföy

- [x] P2-1 UI: `/host`, `/admin`, `/plan`, `/transfers`, `/account/privacy`, çerez bandı, harita, a11y düzeltmeleri
- [x] P2-2 seed/demo (`demo:reset`, lisans no, politikalar, 365 gün envanter)
- [x] P2-3 Playwright e2e (10/10) + axe (6 sayfa, 0 serious/critical), k6 (1 başarı / 199 SOLD_OUT, SQL overbooking 0)
- [x] Lighthouse mobil raporu (`docs/perf/lighthouse.md`; a11y 100, PDP performansı 79–90 — hedef tutarlı değil)
- [ ] (ops.) P1-12 MCP sunucusu — uygulanmadı

## F9 — Docs + CI + cila

- [x] README, ARCHITECTURE, ADR'ler, METHODOLOGY, MODEL_CARD, COMPLIANCE, DEMO_SCRIPT
- [x] `ci.yml` (e2e job'ı dahil), CHANGELOG, LICENSE, `docs/FINAL_REPORT.md`, `package.json` 2.0.0
- [ ] README ekran görüntüleri (`docs/img/`)
- [ ] `v2.0.0` tag + push, CI'nın GitHub'da yeşil olduğunun doğrulanması
