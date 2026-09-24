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

- [ ] P0-4 iptal politikası, P0-5 ödeme (MockPsp), P0-7 bildirimler
- [ ] Transfer (#3) + P1-8

## F4 — Gözlemlenebilirlik + migration disiplini

- [ ] P0-8 (pino, OTel, `/api/metrics`, health/ready), P0-9
- [ ] SSE (#11), routing (#12)

## F5 — Arama & GenAI I

- [ ] P1-1 Smart Filter, P1-2 sıralama + harita, P1-11 embedding (#22), P1-3 i18n/FX

## F6 — Yorumlar + GenAI II

- [ ] P1-4 yorumlar + özet, P1-6 trip-planner, P1-5 olay sinyalleri (#13)

## F7 — Host/Admin

- [ ] P1-7 extranet, P1-9 kanal simülatörü, P1-10 fraud, P2-4 admin, P2-5 KVKK

## F8 — Portföy

- [ ] P2-1 UI, P2-2 seed/demo, P2-3 Playwright + k6, (ops.) P1-12 MCP

## F9 — Docs + CI + cila

- [ ] README, ARCHITECTURE, ADR'ler, METHODOLOGY, MODEL_CARD, COMPLIANCE, DEMO_SCRIPT
- [ ] `ci.yml`, CHANGELOG, LICENSE, `v2.0.0`
