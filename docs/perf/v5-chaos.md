# v5 P0-6 — Kaos kanıtı (Toxiproxy: Redis ve Postgres)

Tarih: 2026-09-28 · k6 (`grafana/k6`) · Toxiproxy 2.9.0 (`ghcr.io/shopify/toxiproxy`, MIT) ·
Windows 11 + Docker Desktop. İlgili: [sepet sıcak noktası](v5-cart.md) ·
[RNPL fırtınası](v5-rnpl-storm.md) · [v4 kaos](p2-3-load-chaos.md)

## Kurulum

`docker-compose.load.yml` → `toxiproxy` servisi (`chaos` profili; tanımlar
`docker/toxiproxy/toxiproxy.json`: `postgres` 5432 → `db:5432`, `redis` 6379 → `redis:6379`).
Uygulama servisleri yalnız `LOAD_POSTGRES_HOST` / `LOAD_REDIS_HOST=toxiproxy` verildiğinde proxy
üzerinden bağlanır (normal yük ölçümünde araya girmez):

```sh
LOAD_POSTGRES_HOST=toxiproxy LOAD_REDIS_HOST=toxiproxy docker compose -p booking-load \
  -f docker-compose.yml -f docker-compose.demo.yml -f docker-compose.load.yml \
  --profile chaos up -d toxiproxy app worker grpc caddy
docker compose -p booking-load exec -T worker sh /usr/local/bin/entrypoint.sh npx tsx scripts/seed-load.ts
docker run --rm -v "<repo>/load:/load:ro" --network booking-load_default \
  -e BASE_URL=http://caddy:80 -e LOAD_ACCOUNTS=60 -e LOAD_ROOMS=<seed-load çıktısı> \
  -e VUS=30 grafana/k6 run /load/chaos-redis.js        # ya da /load/chaos-pg.js
docker compose -p booking-load exec -T worker sh /usr/local/bin/entrypoint.sh \
  npx tsx --conditions=react-server scripts/load-assert.ts
```

İş yükü (`load/chaos-lib.js`): 30 VU; çift VU'lar tekil rezervasyon + ödeme (`/api/bookings` →
`/pay` → gerekirse `/pay/confirm`), tek VU'lar 2 kalemli sepet (ekle → tut → öde). Trafik Caddy
üzerinden; yük gevşetmeleri `docker-compose.load.yml`'deki gibi (rate-limit ×1000, fraud hız
sınırları). Toksinleri betiğin kendi `chaos` senaryosu Toxiproxy API'siyle ekler/kaldırır.
Yanıt sınıfları: `2xx`, `4xx` (iş kuralı: 409/410/422), `429`, `503` (502/503/504 dahil), `500`,
`network` (bağlantı hatası). "Pencere dışı 5xx" = toksin penceresi + toparlanma payı dışında
görülen 5xx/ağ hatası (eşik 0).

## Redis — `load/chaos-redis.js` (90 s)

0–20 s baseline · 20–40 s gecikme 300 ± 100 ms · 45–60 s **Redis proxy kapalı** · +5 s pay · recovery.

| Evre                      |   2xx |   4xx | 429 |   503 | 500 |  ağ | p95 (tüm istekler) |
| ------------------------- | ----: | ----: | --: | ----: | --: | --: | -----------------: |
| baseline                  |   789 |    59 |   0 |     0 |   0 |   0 |             2.64 s |
| gecikme (300 ± 100 ms)    |   138 |    20 |   0 |     0 |   0 |   0 |             6.11 s |
| gecikme sonrası pay (5 s) |   194 |    65 |   0 |     0 |   0 |   0 |             2.69 s |
| **kesinti** (15 s)        |    15 |     4 |   0 | 2 486 |   1 |   0 |              48 ms |
| kesinti sonrası pay (5 s) |   188 |    85 |   0 |    41 |   0 |   0 |             1.09 s |
| recovery (25 s)           | 1 369 | 1 911 |   0 |     0 |   0 |   0 |             260 ms |

- Pencere dışı 5xx **0**; ödenen rezervasyon 307, ödenen sepet 39.
- Kesintide davranış tasarlandığı gibi **fail-closed**: rate-limit katmanı 503, gecikmesiz (p95 48 ms);
  kesinti bitince 5 s içinde toparlanma.
- **Bulgu (düzeltildi):** 1 × 500 — Redis bağlantısı istek ortasında koptuğunda
  `isSessionRevoked` (oturum iptal kontrolü) ioredis `MaxRetriesPerRequestError` fırlatıyor ve
  route bunu 500 `INTERNAL_ERROR` olarak dönüyordu.

## Postgres — `load/chaos-pg.js` (95 s)

0–20 s baseline · 20–35 s gecikme 100 ± 50 ms · 40–48 s **PG proxy kapalı** (havuzdaki tüm
bağlantılar kesilir, yenileri reddedilir) · 55–65 s `reset_peer` (her bağlantı 2 s sonra RST) ·
+10 s pay · recovery.

| Evre                                        |   2xx |   4xx | 429 | 503 | 500 |  ağ | p95 (tüm istekler) |
| ------------------------------------------- | ----: | ----: | --: | --: | --: | --: | -----------------: |
| baseline                                    |   799 |   181 |   0 |   0 |   0 |   0 |             1.96 s |
| gecikme (100 ± 50 ms)                       |    33 |    16 |   0 |   0 |   0 |   0 |            13.03 s |
| 35–45 s (gecikme payı + kopmanın ilk 5 s'i) |   186 |    82 |   0 |   0 | 911 |   0 |             744 ms |
| **kopma** 45–48 s                           |     0 |     0 |   0 |   0 | 531 |   0 |              79 ms |
| kopma sonrası pay (10 s)                    |   415 |   332 |   0 |   0 |  12 |   0 |             497 ms |
| **reset_peer** (10 s)                       |     0 |     0 |   0 |   0 |  27 |   0 |             5.97 s |
| reset sonrası pay (10 s)                    |   568 |   861 |   0 |   0 |  12 |   0 |             262 ms |
| recovery                                    | 1 116 | 2 208 |   0 |   0 |   0 |   0 |             105 ms |

(Koşum sırasında evre etiketleyicisi çakışan pencerelerde önceki pencerenin payını öne alıyordu;
35–45 s satırındaki 911 × 500'ün tamamı 40 s'den sonra, yani kopma penceresinde. Etiketleyici
düzeltildi: etkin pencere artık paydan önceliklidir.)

- Pencere dışı 5xx **0**; ödenen rezervasyon 255, ödenen sepet 10. Gecikme toksininde sorgu başına
  ~100 ms × işlem başına onlarca sorgu → p95 13 s (beklenen: PG gecikmesi doğrusal büyür).
- **Bulgu (düzeltildi):** kopmada 1 493 × **500** (`Can't reach database server`,
  `Server has closed the connection` — Prisma P1001/P1017 ve başlatma hatası). Veri güvenli
  (işlemler geri alındı, aşağıdaki değişmezler temiz), ama istemci "sunucu hatası" görüyordu.

## Düzeltme

`src/lib/http/dependency-unavailable.ts` + `toErrorResponse`: Prisma başlatma hatası, P1001,
P1002, P1008, P1017, P2024 (havuz zaman aşımı), kodsuz "Server has closed the connection" ve
Redis `RedisUnavailableError` / `MaxRetriesPerRequestError` / "Connection is closed." →
**503 `SERVICE_UNAVAILABLE` + `Retry-After: 5`** (500 değil, iç ayrıntı sızdırmaz).
Regresyon testi: `tests/unit/regressions/v5-p0-6-dependency-unavailable.test.ts` (önce kırmızı).

Yukarıdaki tablolar düzeltme ÖNCESİ imajla alınmıştır (F7'de imaj ağ yüzünden derlenemedi).

### Düzeltme sonrası tekrar koşum — Postgres (2026-09-29)

Aynı kurulum ve komutlar, F9'da derlenen imaj (503 eşlemesi dahil), 30 VU, `load/chaos-pg.js`:

| Evre                | 2xx | 4xx | 429 |     503 | 500 |  ağ |
| ------------------- | --: | --: | --: | ------: | --: | --: |
| baseline            | 342 |  20 |   0 |       0 |   0 |   0 |
| gecikme             |  27 |  14 |   0 |       0 |   0 |   0 |
| gecikme sonrası pay |  80 |   2 |   0 |       0 |   0 |   0 |
| **kopma**           |   1 |   0 |   0 | **666** |   0 |   0 |
| kopma sonrası pay   | 143 |   4 |   0 |       2 |   0 |   0 |
| **reset_peer**      |   0 |   1 |   0 |   **9** |   0 |   0 |
| reset sonrası pay   | 177 |  30 |   0 |       9 |   1 |   0 |
| recovery            | 596 |  43 |   0 |       0 |   0 |   0 |

Kopma ve `reset_peer` pencerelerindeki 500'ler (önce 531 + 911 + 27) 503'e geçti; pencere dışı
5xx **0**. Tek kalan 500 reset sonrası toparlanma payında (1 istek).

Düzeltmeler (aşağıdaki sepet hatası dahil) derlendikten sonra iki senaryo yeniden koşuldu:

| Senaryo          | Kesintide 503 | 500 (toplam) | Pencere dışı 5xx | `load-assert`                   |
| ---------------- | ------------: | -----------: | ---------------: | ------------------------------- |
| `chaos-pg.js`    |    1 234 + 21 |            1 |            **0** | ok · 1 298 kontrol · **0 fark** |
| `chaos-redis.js` |         2 639 |        **0** |            **0** | ok · 1 388 kontrol · **0 fark** |

Kalan tek 500, PG `reset_peer` penceresinin içinde (bağlantı sıfırlanırken yarıda kalan tek istek).

**Tekrar koşumun bulduğu hata (düzeltildi):** `load-assert` bugünkü mutabakatta 2 fark verdi —
aynı `CartPayment` için PSP capture/iade 1 181 092 minor, jurnal 448 000. Jurnal eksik değildi:
telafi edilmiş (REFUNDED) sepet ödemesi satırının `amountMinor`'ı, sepet yeniden tutulup
ödendiğinde `payLocked` upsert'ünde yeni toplamla eziliyordu; mutabakat marker'ı görünce tutarı
satırdan aldığı için hayali fark çıktı. Düzeltme: REFUNDED satırın tutarı dondurulur (deneme
alanları yalnız açık statülerde yazılır); aynı ezme `createSplitPlan`'da da vardı → REFUNDED
sepette bölünmüş ödeme planı reddedilir. Regresyon: `tests/integration/v5-compensation-ledger.test.ts`
(`regression: v5-F9 partial cart journal`, `regression: v5-F9 split plan on refunded cart`);
ADR 0026 madde 7.

## Değişmezler — tüm kaos + yük koşumlarından sonra (`scripts/load-assert.ts`)

| Kontrol                                                                  | Sonuç                        |
| ------------------------------------------------------------------------ | ---------------------------- |
| Aşırı satış (sayaç `sold + held ≤ total` · bağımsız rezervasyon sayımı)  | **0 / 0** ✓                  |
| Defter: mizan (Σborç = Σalacak) · dengesiz jurnal                        | dengeli · **0** ✓            |
| Mutabakat (PSP olayları ↔ jurnal, bugün)                                 | 7 300 kontrol · **0 fark** ✓ |
| Çift capture (jurnal · rezervasyon · açık planda capture · SETTLED fark) | **0 / 0 / 0 / 0** ✓          |
| RNPL (yeni): CAPTURED ↔ PAID · CAPTURED ↔ tek jurnal · iptalde tahsilat  | **0 / 0 / 0** ✓              |

Ek gözlem: worker'da 1 × `expire-holds` işi `40001` ile düştü (yinelenen iş, sonraki turda
tamamlandı; veri etkisi yok).
