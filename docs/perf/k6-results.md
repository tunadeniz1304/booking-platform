# k6 yük testi sonuçları (P2-3)

Betik: [`load/booking-spike.js`](../../load/booking-spike.js) · Tarih: 2026-09-24 · k6 v2.3.0 (`grafana/k6` Docker imajı)

## Ortam

- `docker compose -p booking-e2e up -d --build` (demo seed, `LLM_MODE=demo`), tek makine: Windows 11 + Docker Desktop.
- Yük testi için yalnızca `app` servisinde rate-limit yükseltildi (compose override ile):
  `RATE_LIMIT_BOOKING_MAX`, `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_SEARCH_MAX`, `RATE_LIMIT_DEFAULT_MAX` = `100000`.
  Varsayılan limitlerle 200 eşzamanlı istek büyük ölçüde `429` alır; bu da beklenen davranıştır.
- Senaryolar:
  - **race** — 200 VU, her biri 1 kez, aynı odanın aynı gecesi için `POST /api/bookings` (aynı misafir hesabı, Bearer token).
  - **search** — 5. saniyeden itibaren 30 sn boyunca 50 istek/sn `GET /api/search?destination=İstanbul` (önbellekli).

## Sonuçlar

| Koşum | Ağ yolu                                                                      | Gece                 | Oluşan rezervasyon (201) | `409 SOLD_OUT` | `/api/search` p95 | search p90 / p99    | Eşikler                                                  |
| ----- | ---------------------------------------------------------------------------- | -------------------- | -----------------------: | -------------: | ----------------: | ------------------- | -------------------------------------------------------- |
| 1     | Docker Desktop host ağı (`BASE_URL=http://host.docker.internal:3000`)        | +200 gün             |                        1 |            199 |        **1.39 s** | 122 ms / 5.14 s     | `bookings_created ≤ 1` ✓ · `p95 < 500 ms` **✗**          |
| 2     | Compose iç ağı (`--network booking-e2e_default`, `BASE_URL=http://app:3000`) | +200 gün (aynı gece) |                        0 |            200 |          13.42 ms | 8.08 ms / 31.99 ms  | ✓ · ✓ (gece koşum 1'de tutulduğu için 0 başarı beklenir) |
| 3     | Compose iç ağı, `DAY_OFFSET=210` (yeni gece)                                 | +210 gün             |                        1 |            199 |      **16.62 ms** | 9.39 ms / 338.13 ms | ✓ · ✓                                                    |

- Kontroller: 3 koşumda da tüm yanıtlar `201`/`409` (hiç 5xx yok); `http_req_failed` oranı yalnızca beklenen `409`'lardan oluşur (koşum 3: 199 / 1704).
- Koşum 3'te tüm isteklerin (race dahil) p95'i 960.86 ms. Koşum 1'de race senaryosunun 200 isteği 2.7 sn'de tamamlandı.
- **Koşum 1'deki p95 ihlali:** muhtemel nedenler soğuk önbellek (ilk isteklerin hepsi aynı anda ıskalar) ve Docker Desktop'ın host→container NAT katmanı (ayrıca ölçülmedi); aynı betik compose ağı içinden koşunca p95 13–17 ms. Ölçüm dürüstlük için tabloda bırakıldı. Üretime yakın bir ölçüm için k6'nın uygulamayla aynı ağda koşması önerilir.

## Overbooking doğrulaması (SQL)

Koşumlardan sonra `db` container'ında:

```bash
docker compose -p booking-e2e exec -T db psql -U booking -d booking -At < overbook.sql
```

```sql
WITH nights AS (
  SELECT b."roomId", gs::date AS night
  FROM "Booking" b
  CROSS JOIN LATERAL generate_series(b."checkIn"::date, b."checkOut"::date - 1, interval '1 day') gs
  WHERE b.status IN ('PENDING', 'HELD', 'CONFIRMED', 'COMPLETED')
)
SELECT count(*) AS overbooked_nights
FROM (SELECT "roomId", night FROM nights GROUP BY 1, 2 HAVING count(*) > 1) x;
```

**Sonuç: `0`** — hiçbir oda-gecesinde birden fazla aktif rezervasyon yok. Yarışılan iki gecede (`2027-04-12`, `2027-04-22`) tam birer `HELD` rezervasyon bulunuyor.

## Yeniden çalıştırma

```bash
docker compose up -d --build        # rate-limit env'leri yükseltilmiş olarak
# k6 kuruluysa:
k6 run -e DAY_OFFSET=230 load/booking-spike.js
# veya Docker ile, compose ağı içinden:
docker run --rm -i --network <proje>_default -e BASE_URL=http://app:3000 -e DAY_OFFSET=230 \
  grafana/k6 run - < load/booking-spike.js
```

`DAY_OFFSET` her koşumda farklı bir gece seçmek içindir; aynı gece tekrar koşulursa doğru olarak 0 başarı / 200 `SOLD_OUT` görülür.

## F8 — Yük ve kaos koşumları (v3)

Ortam: Docker Desktop (8 çekirdek, 7.6 GiB), compose projesi `booking-e2e`, k6
`grafana/k6` imajıyla compose ağı içinden (`BASE_URL=http://app:3000`), rate limit
override'ı yükseltilmiş (`load/chaos.md` bölüm 0). **Uyarı:** aynı makinede başka
projelere ait konteynerler çalışıyordu (bir API süreci ölçümler sırasında %100–340 CPU);
`hold-spike` gecikmeleri bundan belirgin biçimde etkilendi.

| Script                        | Koşul                                   | Temel sonuç                                                         | Eşik              |
| ----------------------------- | --------------------------------------- | ------------------------------------------------------------------- | ----------------- |
| `search.js`                   | 50 rps, 60 s                            | 3000 istek, hata 0, p95 **29 ms**                                   | ✓                 |
| `search.js`                   | 20 rps, 30 s, **Redis kapalı**          | 600 istek, hata %0, p95 **232.4 ms**, max 444 ms                    | ✓                 |
| `hold-spike.js`               | `DAY_OFFSET=250`, sakin ortam, eski im. | 4029 istek, 201 = 1767, 409 = 2237, 5xx = 0, p95 434 ms, p99 792 ms | ✓                 |
| `hold-spike.js`               | `DAY_OFFSET=320`, yeni imaj, yoğun host | 201 = 931, 409 = 446, 5xx = 0, p95 41.9 s, 2647 düşen iterasyon     | ✗ (p95)           |
| `payment-race.js` (koşum 1)   | eski imaj                               | 14/18 CONFIRMED, **4 × 500** (serileştirme çatışması)               | ✗                 |
| `payment-race.js` (koşum 2)   | düzeltme sonrası                        | 20/20 CONFIRMED, `pay_5xx` 0, çift tahsilat 0, p95 1.98 s           | ✓                 |
| `llm-fallback.js` EXPECT=demo | `LLM_MODE=demo`                         | 151 istek, %100 demo, p95 49 ms, 5xx 0                              | ✓                 |
| `llm-fallback.js` fallback    | yönlendirilemeyen URL, 1 s zaman aşımı  | 151 istek, %100 fallback (`reason=timeout`), p95 1.13 s, 5xx 0      | ✓                 |
| `llm-fallback.js` canlı       | gerçek sağlayıcı, `LLM_MODE=auto`       | 129 istek, %71.3 fallback, p95 15.1 s                               | ✗ (p95 < 3000 ms) |

Değişmezler (tüm koşumlardan sonra): overbooking SQL **0**, ledger çift `CHARGE` **0**.

Notlar:

- `payment-race.js` metrik farkı (`/api/metrics` önce/sonra) yalnızca tek `app`
  replikasında anlamlıdır.
- `hold-spike` için yeni imajın sakin ortamda ölçümü yapılamadı; eski ayarlarla aynı
  yoğun ortamda da p95 32.3 s ölçüldüğünden yavaşlık ortama bağlandı, ancak bu bir
  **açık risktir** — sakin bir makinede tekrar ölçülmeli.
- Kaos ayrıntıları ve bulunan üç hata (Redis kapalıyken 33 s arama, zehirli süre dolum
  işi, ödeme yarışında 500): `load/chaos.md`.
