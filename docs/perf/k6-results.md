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
