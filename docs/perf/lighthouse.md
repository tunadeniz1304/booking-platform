# Lighthouse sonuçları (P2-1)

Tarih: 2026-09-25 · Lighthouse 12.8.2 (`npx lighthouse@12`) · Chromium 153 `chrome-headless-shell` (Playwright) · **mobil** ön ayar (varsayılan: 4× CPU yavaşlatma, 150 ms RTT, ~1.6 Mbps simüle ağ).

Hedef: `docker compose -p booking-e2e up -d --build` (production build, demo seed), aynı makinede `http://localhost:3000`. Harici görseller (Unsplash) gerçek ağdan yüklenir; LCP bu yüzden bağlantıya duyarlıdır.

| Sayfa            | Performance | Accessibility | Best Practices | SEO | FCP   | LCP   | TBT    | CLS   |
| ---------------- | ----------: | ------------: | -------------: | --: | ----- | ----- | ------ | ----- |
| `/`              |          94 |           100 |             96 | 100 | 0.8 s | 2.9 s | 100 ms | 0     |
| `/search`        |          94 |           100 |             96 | 100 | 0.8 s | 2.4 s | 220 ms | 0     |
| `/property/[id]` |       90 \* |           100 |             96 | 100 | 0.8 s | 3.0 s | 220 ms | 0     |
| `/checkout?…`    |          92 |           100 |            100 | 100 | 0.8 s | 2.5 s | 190 ms | 0.097 |
| `/login`         |          96 |           100 |             96 | 100 | 0.8 s | 2.6 s | 140 ms | 0     |
| `/plan`          |          94 |           100 |             96 | 100 | 0.8 s | 2.5 s | 200 ms | 0     |

\* PDP beş ardışık koşumda **89 / 90 / 95 / 92 / 89** (medyan 90, en düşük 89) → ≥ 85 hedefi her koşumda sağlandı. LCP öğesi galerinin ilk görseli.

**PDP iyileştirmesi (2026-09-25).** Önceki ölçümde (2026-09-24) PDP 80 / 86 / 79 / 90 (medyan 83) idi: galeri `unoptimized` işaretliydi ve mobilde ana görsel ile dört küçük resim 1200 px orijinal olarak iniyordu. Şimdi `src/lib/ui/image-loader.ts` Unsplash CDN'ine genişlik/kalite parametresi veren bir `next/image` loader'ı sağlar (`srcset` 384–3840 w, `q=60`, `auto=format`); ana görsel mobilde ~40 KB, küçük resimler 256 w ve `fetchPriority="low"`. `sizes` galeri düzenine (`lg:col-span-2`) göre düzeltildi.

Ölçüm notu: bu makinede `--headless=new` ile tam Chrome, Lighthouse 12 ve 13'te koşumların çoğunda `NO_NAVSTART` (trace kaydı) hatası verdi; tablo `chrome-headless-shell` ile alındı. `--headless=new` ile tamamlanan tek PDP koşumu 82 idi — yani hedef, ölçüm ortamına bağlı olarak sınırda kalabilir.

- **Accessibility ≥ 95:** 6/6 sayfada 100.
- **Best Practices 96:** anonim ziyaretçide oturum yoklaması (`/api/user/me`, ardından `/api/auth/refresh`) beklenen `401` döndürür ve konsola "Failed to load resource" düşer.
- Playwright + axe (`tests/e2e/a11y.spec.ts`) aynı 6 sayfada 0 serious/critical ihlal doğrular.

## Yeniden çalıştırma

```bash
docker compose up -d --build
npx lighthouse@12 http://localhost:3000/ --only-categories=performance,accessibility,best-practices,seo \
  --output=html --output-path=./lighthouse-home.html
```

`CHROME_PATH` Playwright'ın headless shell'ini göstermelidir (`npx playwright install chromium` ile iner), ör. Windows'ta `%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-<sürüm>\chrome-headless-shell-win64\chrome-headless-shell.exe`. Tam Chrome ile `--chrome-flags="--headless=new"` de çalışır, ancak bu makinede sık sık `NO_NAVSTART` verdi (yukarıya bkz.).
