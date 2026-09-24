# Lighthouse sonuçları (P2-1)

Tarih: 2026-09-24 · Lighthouse 12.8.2 (`npx lighthouse@12`) · HeadlessChrome 153 · **mobil** ön ayar (varsayılan: 4× CPU yavaşlatma, 150 ms RTT, ~1.6 Mbps simüle ağ).

Hedef: `docker compose -p booking-e2e up -d --build` (production build, demo seed, `LLM_MODE=demo`), aynı makinede `http://localhost:3000`. Harici görseller (Unsplash) gerçek ağdan yüklenir; LCP bu yüzden bağlantıya duyarlıdır.

| Sayfa            | Performance | Accessibility | Best Practices | SEO | FCP   | LCP   | TBT    | CLS   |
| ---------------- | ----------: | ------------: | -------------: | --: | ----- | ----- | ------ | ----- |
| `/`              |          96 |           100 |             96 | 100 | 0.9 s | 2.6 s | 150 ms | 0     |
| `/search`        |          91 |           100 |             96 | 100 | 0.9 s | 2.6 s | 280 ms | 0     |
| `/property/[id]` |   **86** \* |           100 |             96 | 100 | 0.8 s | 3.2 s | 340 ms | 0     |
| `/checkout?…`    |          95 |           100 |             96 | 100 | 0.8 s | 2.3 s | 110 ms | 0.097 |
| `/login`         |          97 |           100 |             96 | 100 | 0.9 s | 2.3 s | 130 ms | 0     |
| `/plan`          |          96 |           100 |             96 | 100 | 0.8 s | 2.5 s | 130 ms | 0     |

\* PDP dört koşumda 80 / 86 / 79 / 90 (medyan 83); LCP öğesi galerinin ilk görseli (`next/image`, `priority`), uzak görsel indirmesine bağlı. Hedef (≥ 85) diğer beş sayfada her koşumda, PDP'de koşumların yarısında sağlandı — **PDP için hedef tutarlı biçimde karşılanmıyor**.

- **Accessibility ≥ 95:** 6/6 sayfada 100. İlk ölçümde `/login` 98'di (`heading-order`: footer başlıkları `h3` idi → `h2` yapıldı).
- **Best Practices 96:** anonim ziyaretçide oturum yoklaması (`/api/user/me`, ardından `/api/auth/refresh`) beklenen `401` döndürür ve konsola "Failed to load resource" düşer.
- Playwright + axe (`tests/e2e/a11y.spec.ts`) aynı 6 sayfada 0 serious/critical ihlal doğrular.

## Yeniden çalıştırma

```bash
docker compose up -d --build
npx lighthouse@12 http://localhost:3000/ --only-categories=performance,accessibility,best-practices,seo \
  --chrome-flags="--headless=new" --output=html --output-path=./lighthouse-home.html
```

Windows'ta Chrome yolu gerekirse `CHROME_PATH` ortam değişkeniyle verilir.
