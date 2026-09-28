# Kaos Deneyleri — Redis kesintisi ve LLM zaman aşımı

Bu belge iki bağımlılık arızasında sistemin **nasıl davranması gerektiğini**, bunun
nasıl ölçüleceğini ve F8'de gerçekten **ölçülen** sonuçları içerir. Sayılar yerel
Docker Desktop (8 çekirdek, 7.6 GiB) üzerinde, compose projesi `booking-e2e` ile alındı;
hiçbir sayı uydurulmamıştır. Ölçülmeyen hücreler açıkça `ölçülmedi` olarak işaretlidir.

> **Ortam uyarısı:** Ölçümler sırasında aynı makinede başka projelere ait konteynerler
> (ör. bir API süreci %100–340 CPU) çalışıyordu. Özellikle `hold-spike` gecikmeleri bu
> çekişmeden ciddi biçimde etkilendi; ilgili satırlarda belirtilmiştir.

Aşağıda `<proj>` compose proje adıdır (ör. `booking-e2e`); k6 konteyneri bu projenin
ağına `<proj>_default` üzerinden bağlanır.

## 0. Hazırlık — yük testi için env override

Tüm istekler k6 konteynerinin tek IP'sinden ve tek misafir hesabından gelir; bu yüzden
yalnızca `app` servisinde limitler yükseltilir. Örnek override dosyası
(`docker-compose.load.yml`, repoya eklenmez):

```yaml
services:
  app:
    environment:
      RATE_LIMIT_SEARCH_MAX: "100000"
      RATE_LIMIT_BOOKING_MAX: "100000" # /api/bookings ve ödeme uçları
      RATE_LIMIT_AUTH_MAX: "100000"
      RATE_LIMIT_DEFAULT_MAX: "100000"
      RATE_LIMIT_AI_MAX: "100000"
      RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX: "1000"
      FRAUD_VELOCITY_USER_MAX: "1000"
      FRAUD_VELOCITY_IP_MAX: "10000"
      FRAUD_VELOCITY_CARD_MAX: "1000"
      PAYMENT_PROVIDER: "mock"
```

```bash
docker compose -p <proj> -f docker-compose.yml -f docker-compose.load.yml up -d --build
```

Script özeti:

| Script                  | Amaç                                  | Geçme kriteri                                            |
| ----------------------- | ------------------------------------- | -------------------------------------------------------- |
| `load/search.js`        | Arama gecikmesi                       | p95 < 500 ms, `search_errors` < %1, 5xx = 0              |
| `load/hold-spike.js`    | Çok oda/tarihli HOLD patlaması        | `hold_5xx` = 0, `hold` p95 < 1 s                         |
| `load/payment-race.js`  | Aynı rezervasyona eşzamanlı ödeme     | `double_charges` = 0, `pay_5xx` = 0, ledger SQL = 0      |
| `load/llm-fallback.js`  | LLM fallback oranı ve fallback süresi | `smart_5xx` = 0, beklenen `llmMode` oranı ≥ %99 (EXPECT) |
| `load/booking-spike.js` | Tek odaya 50 VU (overbooking)         | overbooking SQL = 0                                      |

## (a) Redis kesintisi — fail-closed doğrulaması

### Beklenen davranış

Redis; rate limit, JWT denylist, Redlock (oda ve ödeme kilidi), arama/rezervasyon
önbelleği ve fraud hız sayaçları için kullanılır. Redis erişilemezken:

| Uç / bileşen                                  | Beklenen                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /api/bookings`, `/api/bookings/:id/pay` | **503 `RATE_LIMIT_UNAVAILABLE`** (hassas kategori → fail-closed, proxy)   |
| `POST /api/auth/login` (auth kategorisi)      | **503** (fail-closed)                                                     |
| Kimlikli istekler                             | **503** (proxy rate limit katmanı önce düşer; denylist'e ulaşılmaz)       |
| Redlock (oda / `pay:<id>`)                    | Kilit alınamaz → 409 `ROOM_BUSY` / `PAYMENT_IN_PROGRESS`, asla çift yazım |
| `GET /api/search`, `/api/properties`          | fail-open: 200, önbellek ıskası → doğrudan DB, gecikme artabilir          |
| Fraud hız sayaçları                           | fail-open (skor hız bileşeni olmadan hesaplanır)                          |
| `GET /api/ready`                              | 503 (hazır değil)                                                         |

**Değişmez:** Redis kesintisi sırasında ve sonrasında hiçbir oda/tarih için overbooking
olmaz ve hiçbir rezervasyon iki kez tahsil edilmez. 5xx olarak yalnızca **503**
kabul edilir; 500 görülmemelidir.

### Komutlar

```bash
# 1) Temel ölçüm (Redis açık)
docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
  -e DAY_OFFSET=300 grafana/k6 run - < load/hold-spike.js

# 2) Redis'i durdur
docker compose -p <proj> stop redis

# 3) Kesinti altında ölçüm (hold-spike setup'ı login gerektirdiği için 503 ile
#    düşecektir — bu da fail-closed kanıtıdır). Arama tarafı fail-open kontrolü:
docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
  -e RATE=20 -e DURATION=30s grafana/k6 run - < load/search.js

#    Hassas uçların doğrudan kontrolü (503 ve RATE_LIMIT_UNAVAILABLE beklenir):
docker run --rm --network <proj>_default curlimages/curl -s -i \
  -X POST http://app:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"guest@booking.test","password":"Password123!"}'
docker run --rm --network <proj>_default curlimages/curl -s -i \
  -X POST http://app:3000/api/bookings -H 'content-type: application/json' -d '{}'
docker run --rm --network <proj>_default curlimages/curl -s -o /dev/null -w '%{http_code}\n' \
  http://app:3000/api/ready

# 4) Redis'i geri başlat ve toparlanmayı ölç
docker compose -p <proj> start redis
docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
  -e DAY_OFFSET=340 grafana/k6 run - < load/hold-spike.js

# 5) Değişmez kontrolleri (ikisi de 0 dönmeli)
docker compose -p <proj> exec -T db psql -U booking -d booking -At < overbook.sql   # docs/perf/k6-results.md
docker compose -p <proj> exec -T db psql -U booking -d booking -At -c \
  "SELECT count(*) FROM (SELECT \"bookingId\" FROM \"JournalEntry\" WHERE kind='BOOKING_CAPTURED' AND \"idempotencyKey\"='booking-captured:'||\"paymentId\" GROUP BY \"bookingId\" HAVING count(*)>1) t"
```

### Kaydedilecek metrikler

- Hassas uçlarda 503 oranı ve gövdedeki kod (`RATE_LIMIT_UNAVAILABLE`); 500 sayısı.
- `search.js`: `http_req_duration` p95, `search_errors` oranı (fail-open → düşük kalmalı).
- `/api/ready` durum kodu (kesinti sırasında / sonrasında).
- Toparlanma süresi: `start redis` ile ilk başarılı `201` HOLD arası (saniye).
- Overbooking SQL ve ledger CHARGE SQL sonuçları.

### Sonuçlar

| Ölçüm                                 | Redis açık         | Redis kapalı                     | Redis geri geldi                  |
| ------------------------------------- | ------------------ | -------------------------------- | --------------------------------- |
| `POST /api/auth/login` durum kodu     | 200                | 503 `RATE_LIMIT_UNAVAILABLE`     | 200 (2. denemede, 1.68 s sonra)   |
| `POST /api/bookings` (anonim)         | 401 `UNAUTHORIZED` | 503 `RATE_LIMIT_UNAVAILABLE`     | 401 `UNAUTHORIZED`                |
| `POST /api/bookings` (eski token ile) | 400 (doğrulama)    | 503 `RATE_LIMIT_UNAVAILABLE`     | ölçülmedi                         |
| `GET /api/auth/me` (eski token ile)   | 200                | 503, 13 ms                       | ölçülmedi                         |
| `hold-spike`: 201 / 409 / 5xx         | 1767 / 2237 / 0 ¹  | koşulamaz (setup login'i 503) ✓  | 632 / 500 / 1 ² (+13 zaman aşımı) |
| `hold-spike` p95                      | 434 ms ¹           | —                                | 54.4 s ²                          |
| `search.js` p95                       | 29 ms (50 rps)     | **232.4 ms** (20 rps, 600 istek) | ölçülmedi                         |
| `search.js` hata oranı                | %0                 | **%0**                           | —                                 |
| `/api/ready` durum kodu               | 200                | 503                              | 200                               |
| `/api/health` durum kodu              | 200                | 200                              | 200                               |
| 500 sayısı                            | 0                  | 0                                | 1 ²                               |
| Toparlanma süresi                     | —                  | —                                | ≈ 1.7 s (ilk başarılı login)      |
| Overbooking SQL                       | 0                  | 0                                | 0                                 |
| Ledger çift CHARGE SQL                | 0                  | 0                                | 0                                 |

¹ Ortam sakinken, F8 düzeltmelerinden önceki imajla, `DAY_OFFSET=250`.
² `DAY_OFFSET=340`; yabancı CPU yükü + aşağıdaki süre dolum birikmesi altında. Tek 5xx,
Prisma bağlantı havuzunun tükenmesiydi (`Unable to start a transaction in the given time`).
Birikim eridikten sonra (HELD 0) yeni imajla `DAY_OFFSET=320` tekrarı: 201 = 931,
409 = 446, **5xx = 0**, p95 41.9 s, 2647 düşen iterasyon — yabancı API süreci o anda
%338 CPU kullanıyordu. Aynı ortamda eski ayarlarla (`DAY_OFFSET=200`) p95 32.3 s
ölçüldüğünden bu yavaşlık yeni koddan değil ortamdan kaynaklanıyor; ancak sakin ortamda
yeni imajla tekrar ölçülemedi — **açık risk**.

#### Deneyde bulunan ve düzeltilen hatalar

1. **Redis kapalıyken arama 33 s sürüyordu.** İlk koşumda (eski imaj) `GET /api/search`
   200 dönüyor ama **32.98 s** sürüyordu: ioredis çevrimdışı kuyruğu komutları
   bağlantı gelene kadar bekletiyordu. Düzeltme (`src/lib/redis.ts`): istemci bir kez
   hazır olduktan sonra bağlantı koparsa komutlar anında `RedisUnavailableError` ile
   düşer (fail-fast) ve her komuta `REDIS_COMMAND_TIMEOUT_MS` (1000 ms) uygulanır.
   Sonuç: aynı deneyde arama 30–90 ms, k6 p95 232 ms, hata %0.
2. **Süre dolum işi zehirli tutma yüzünden tamamen duruyordu.** `expire-holds`, envanter
   sayacı tutarsız (seed'in `held` sayacını artırmadığı) tek bir PENDING rezervasyonda
   `InventoryUnavailableError` fırlatıyor, tüm toplu işlem geri alınıyordu; yük
   testlerinden kalan **4392 HELD** kayıt hiç düşmedi. Düzeltme: her serbest bırakma bir
   SAVEPOINT içinde; tutarsızlıkta yalnızca o kayıt atlanıp loglanır ve
   `booking_expire_inventory_drift_total` artar. Seed de artık PENDING için `held`
   sayacını artırıyor. Yeniden dağıtımdan sonra birikim dakikada 100'lük partilerle
   eridi (son kontrol: HELD 0, EXPIRED 4398).
3. **Ödeme yarışında 500.** `payment-race` ilk koşumda 18 rezervasyonun 4'ünde 500 gördü
   (serileştirme çatışması `P2034`). Düzeltme: serileştirme hatası yeniden denenir
   (`DB_SERIALIZABLE_RETRY_ATTEMPTS`=6, jitter'lı üstel bekleme) ve tükenirse 500 yerine
   **409 `TRANSACTION_CONFLICT`** + `Retry-After: 1` döner. İkinci koşum: 20/20 CONFIRMED,
   `pay_5xx` 0, çift tahsilat 0.

Beklenen tabloda ilk taslakta "kimlikli istekler → 401" yazıyordu; gözlenen **503**'tür,
çünkü proxy rate limit katmanı Redis'e ulaşamayınca istek denylist kontrolüne gelmeden
reddedilir. Her iki durum da fail-closed'dur.

## (b) LLM zaman aşımı — fallback oranı

### Beklenen davranış

LLM istemcisi asla fırlatmaz: sağlayıcı zaman aşımı/ağ hatası/5xx durumunda aynı
isteğe deterministik demo çıktısı döner ve yanıt `llmMode: "fallback"` + `reason`
(`timeout`, `network`, `upstream_5xx`, `rate_limited`, `budget`, …) taşır. HTTP durumu
**200** kalır; kullanıcı akışı bozulmaz.

`llmMode` döndüren uçlar:

- `POST /api/search/smart` — gövde `{ "text": "..." }` (3–300 karakter); ölçüm bu uçla.
- `GET /api/properties/:id/reviews/summary`
- Admin olay/özet uçları (yönetici oturumu gerekir; yük testine dahil değil).

### Zaman aşımını zorlama

Ayarlar süreç başına önbelleğe alınır → env değiştirince `app` yeniden başlatılmalı.
Override dosyasına (bölüm 0) ekleyin:

```yaml
services:
  app:
    environment:
      LLM_MODE: "live"
      LLM_API_KEY: "chaos-dummy" # sahte; istek hiçbir yere ulaşmaz
      LLM_BASE_URL: "http://10.255.255.1:81/v1" # yönlendirilemeyen adres → bağlantı asılı kalır
      LLM_TIMEOUT_SECONDS: "1"
      LLM_MAX_RETRIES: "0"
      RATE_LIMIT_AI_MAX: "100000"
```

Not: Bazı ağlarda bu adres anında `network` hatası verebilir; o durumda `reason`
dağılımı `timeout` yerine `network` olur — fallback oranı yine ölçülür.
`LLM_DAILY_TOKEN_BUDGET_PER_USER` aşılırsa `reason=budget` görülür; deneyde ayırt edin.

### Komutlar

```bash
# 1) Temel (demo modu; beklenen llmMode=demo)
docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
  -e EXPECT=demo grafana/k6 run - < load/llm-fallback.js

# 2) Zaman aşımı modunu aç ve app'i yeniden oluştur
docker compose -p <proj> -f docker-compose.yml -f docker-compose.load.yml up -d app

# 3) Ölçüm (beklenen llmMode=fallback, p95 ≈ LLM_TIMEOUT_SECONDS + işlem)
docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
  -e EXPECT=fallback -e P95_MS=3000 grafana/k6 run - < load/llm-fallback.js

# 4) Uygulama tarafı metrikler (Prometheus/Grafana veya doğrudan):
#    llm_requests_total{task,mode,outcome}, llm_latency_seconds
BEARER=$(docker compose -p <proj> exec -T app cat /run/booking-secrets/METRICS_TOKEN)
docker run --rm --network <proj>_default curlimages/curl -s \
  -H "authorization: Bearer $BEARER" http://app:3000/api/metrics | grep '^llm_'
```

### Kaydedilecek metrikler

- `llm_fallback_rate` (k6) ve `llm_mode_fallback` sayacının `reason` etiketine göre dağılımı.
- `llm_fallback_duration` p95 (fallback yolunun kullanıcıya maliyeti).
- `smart_5xx` (0 olmalı), `http_req_duration{name:smart}` p95.
- Uygulama: `llm_requests_total{outcome}` ve `llm_latency_seconds` p95.

### Sonuçlar

| Ölçüm                                | Demo (temel) | LLM zaman aşımı (1 s) |
| ------------------------------------ | ------------ | --------------------- |
| İstek sayısı (30 s, 5 istek/s)       | 151          | 151                   |
| `llmMode=live` / `demo` / `fallback` | 0 / 151 / 0  | 0 / 0 / 151           |
| Fallback oranı                       | %0           | **%100**              |
| Baskın `reason`                      | —            | `timeout` (tamamı)    |
| `smart` p95 (ms)                     | 49           | 1130                  |
| `llm_fallback_duration` p95 (ms)     | —            | 1130 (medyan 1020)    |
| 5xx sayısı                           | 0            | 0                     |

Zaman aşımı koşumunda `LLM_DAILY_TOKEN_BUDGET_PER_USER=0` (sınırsız) verildi. İlk
denemede bütçe önceki canlı koşumlarca tükenmişti ve 121 isteğin tamamı `reason=budget`
ile düştü (p95 10.9 s); bu koşum zaman aşımı yolunu ölçmediği için tabloda
kullanılmadı. Fallback gecikmesi beklendiği gibi ≈ `LLM_TIMEOUT_SECONDS` + ~30 ms.

Ek gözlem (gerçek sağlayıcıyla, `LLM_MODE=auto`): 129 istekte fallback oranı %71.3,
`smart` p95 15.1 s — 3000 ms eşiğini **geçemedi**. Canlı modda sağlayıcı gecikmesi ve
kota, kullanıcı akışını bozmasa da gecikmeyi belirler.

## Diğer scriptlerin sonuç iskeleti

Ayrıntılı tablolar: `docs/perf/k6-results.md` (F8 bölümü).
