# ADR 0009 — Next.js 16 / React 19 / ESLint 9 / Vitest 5'e yükseltme

- Durum: Kabul edildi
- Tarih: 2026-09-24

## Bağlam

Kalite kapısı `npm audit --audit-level=high` için 0 bulgu şartı koyuyor. Başlangıçta
`next@14.2` (critical — `<15.5.10` aralığındaki çoklu advisory), `postcss` (high,
Next'in iç bağımlılığı), `vitest@2` / `vite` / `esbuild` (critical/high) ve
`eslint-config-next@14` üzerinden `glob` (high) bulguları vardı. Hiçbiri yama
sürümüyle kapanmıyordu; düzeltmeler major sürümlerde.

## Karar

- `next` 16.3, `react`/`react-dom` 19, `@types/react` 19.
- `next lint` kaldırıldığı için ESLint 9 + flat config (`eslint.config.mjs`,
  `eslint-config-next/core-web-vitals` + `typescript`).
- `src/middleware.ts` → `src/proxy.ts` (Next 16 adlandırması). Proxy artık Node.js
  runtime'ında çalışır; bu, rate-limit için Edge'e özel Upstash REST istemcisine
  bağımlılığı ortadan kaldırır (bkz. F1).
- Dinamik route `params` her yerde `Promise` olarak `await` edilir.
- Vitest 5: `vitest.workspace.ts` yerine `vitest.config.mts` içinde `test.projects`.
- `NextRequest.ip` Next 15'te kaldırıldı; istemci IP'si yalnızca güvenilir proxy
  sayısına (`TRUSTED_PROXY_HOPS`) göre `X-Forwarded-For`'dan çözülür.

## Sonuçlar

- `npm audit` → 0 bulgu.
- React Compiler lint kuralları (`react-hooks/set-state-in-effect` vb.) mevcut istemci
  bileşenlerinde küçük düzeltmeler gerektirdi.
- Build varsayılan olarak Turbopack kullanır.
