# v5 P1-8 — Sepet sıcak noktası: önce / sonra

Tarih: 2026-09-28 · k6 (`grafana/k6` Docker imajı) · Windows 11 + Docker Desktop (8 çekirdek VM,
7.6 GiB), makinede boş bellek ~1.5–2.7 GB. Mutlak gecikmeler üretim ölçeği değildir; karşılaştırma
aynı koşulda yapılmıştır.

İlgili: [v4 ölçümü ve koşulları](p2-3-load-chaos.md) · [kaos](v5-chaos.md) ·
[RNPL fırtınası](v5-rnpl-storm.md)

## Koşul (v4 ile aynı betik ve parametreler)

`load/cart-spike.js`, `PAY=1`, 2 kalem × 2 gece, 30 s; `scripts/seed-load.ts` yük oteli (4 oda
tipi × 5 birim → tarih başına en fazla 10 sepet) — **tüm VU'lar bilerek aynı 4 envanter satırında**.
Her koşum stoğu temiz (daha önce hiç satılmamış) bir `DAY_OFFSET` kullanır.

İki ortam:

- **Konteyner (v4 koşulu):** `docker compose -p booking-load -f docker-compose.yml
-f docker-compose.demo.yml -f docker-compose.load.yml up -d app worker grpc caddy`; k6 aynı ağda,
  **Caddy üzerinden** (`BASE_URL=http://caddy:80`, `TRUSTED_PROXY_HOPS=1`).
- **Host (önce/sonra A/B):** Docker imajı yeniden derlenemedi (npm kayıt defterine indirme hızı
  ~26 KB/s; `npm ci` katmanı 100+ dk'da bitmedi). Bu yüzden aynı kod `next build` + `next start`
  olarak host'ta, yük yığınının Postgres/Redis konteynerlerine karşı koşuldu (fix-sweep-3 ile
  aynı yöntem; ortam `docker-compose.load.yml` ile aynı, `TRUSTED_PROXY_HOPS=0` çünkü önde vekil
  yok). **Önce ve sonra aynı derlemedir:** `CART_HOLD_SOLDOUT_CHECK_MS=0` eski kod yolunu birebir
  çalıştırır (erken vazgeçme ve kilit altı ön kontrol kapalı), `250` (varsayılan) yeni yolu.

Yük override'ındaki gevşetmeler (yalnız DEMO_MODE / yük profili; prod varsayılanları değişmez):
`RATE_LIMIT_DEMO_RELAX_MULTIPLIER=1000` (tek k6 IP'si), `FRAUD_VELOCITY_USER_MAX=1000`,
`FRAUD_VELOCITY_IP_MAX=10000`, `FRAUD_VELOCITY_CARD_MAX=1000`.

## Sonuçlar — tutma (`POST /api/cart/:id/hold`) gecikmesi

| Ortam · kod           |      VU | Tutma 200 / 409 | Ödenen | 5xx | Atomiklik | Tutma p50 |  Tutma p95 |
| --------------------- | ------: | --------------: | -----: | --: | --------: | --------: | ---------: |
| v4 raporu (konteyner) |     100 |        15 / 202 |     10 |   0 |      %100 |         — |    10.07 s |
| v4 raporu (konteyner) |      20 |         15 / 43 |     10 |   0 |      %100 |         — |     5.72 s |
| konteyner · **önce**  |     100 |         8 / 103 |      8 |   0 |      %100 |    7.88 s |     8.51 s |
| konteyner · **önce**  | 100 (2) |        11 / 147 |      9 |   0 |      %100 |    7.62 s |     8.80 s |
| konteyner · **önce**  |      20 |         12 / 35 |     10 |   0 |      %100 |    1.43 s |     6.03 s |
| host · **önce** (A)   |     100 |        11 / 206 |     10 |   0 |      %100 |    7.90 s |     8.69 s |
| host · **önce** (A)   |      20 |         11 / 39 |     10 |   0 |      %100 |    1.51 s |     6.05 s |
| host · **sonra** (B)  |     100 |        11 / 251 |     10 |   0 |      %100 |    2.66 s | **8.40 s** |
| host · **sonra** (B)  |      20 |         12 / 49 |     10 |   0 |      %100 |    0.67 s | **1.87 s** |
| deney: B + bütçe 2 s  |     100 |        10 / 262 |      9 |   0 |      %100 |    2.79 s |     3.98 s |
| deney: B + bütçe 2 s  | 100 (2) |        14 / 488 |      9 |   0 |      %100 |    2.88 s |     3.56 s |

- Hedef **hold p95 ≤ 2 s: 20 VU'da sağlandı (6.05 → 1.87 s), 100 VU'da sağlanamadı**
  (8.69 → 8.40 s; medyan 7.90 → 2.66 s). Aşağıdaki darboğaz analizi nedenini gösterir.
- Aşırı satış **0**; ödenen sepet çoğu koşumda kapasite kadar (10; bazılarında 8–9: bir sepetin iki
  kalemi aynı anda iki farklı oda tipinin son birimine düşemediği için kalan tek birimler).
  `scripts/load-assert.ts` tüm koşumlardan sonra: aşırı satış 0/0, mizan dengeli, jurnal
  dengesizliği 0, mutabakat 7 300 kontrol / **0 fark**, çift capture 0.
- Integration testleri (envanter/sepet/eşzamanlılık) yeşil — bkz. faz raporu.

## Profil

### Evre metrikleri (`cart_hold_phase_seconds`, yeni) — host, süreç başına tüm koşumların toplamı (A: 20+100 VU; B: 20+100 VU + bir 20 VU ön koşum)

| Kod       | Tutma sonucu (`cart_hold_total`)                    | `lock_wait` n / ort. | `critical` n / ort. | `reprice` ort. |
| --------- | --------------------------------------------------- | -------------------: | ------------------: | -------------: |
| önce (A)  | held 22 · **failed 124** · unavailable 121 · busy 0 |     146 / **3.51 s** |       146 / 0.185 s |         0.35 s |
| sonra (B) | held 26 · failed 4 · unavailable 288 · busy 34      |      77 / **1.09 s** |         30 / 0.63 s |         0.30 s |

### Bulgu: kilit kuyruğu "ölü" işlemlerle tıkanıyordu

- Önce: kilidi alan 146 işlemin yalnız 22'si tuttu; **124'ü kilidi tutarken tam SERIALIZABLE
  işlemi (≈20 gidiş-dönüş: oda tipi + tarifeler + politika, `FOR UPDATE`, kısıtlar, promosyon
  kuralları, rezervasyon, outbox…) koşup sonunda `SOLD_OUT` ile geri alındı**. Stok ilk
  saniyelerde bittiği halde kuyruktaki her bekleyen sırası gelince bu işi yaptı; bekleyenler
  bütçenin (7.5 s) sonuna kadar kuyrukta kaldı → 409'ların medyanı ≈ 7.9 s = p95'i belirleyen
  kitle.
- `EXPLAIN (ANALYZE, BUFFERS)` — sıcak sorgu (`InventoryDay … FOR UPDATE`, benzersiz
  `(roomTypeId, date)` indeksi): 0.49 ms, 7 tampon isabeti. Veritabanı darboğaz değil (koşum
  sırasında Postgres CPU %20–40); uygulama süreci **%300+ CPU** (konteyner ölçümü). Kilit altındaki
  her `await`, doymuş olay döngüsünde onlarca ms bekliyor → kritik bölge süresi sorgu sayısıyla
  orantılı.
- `40001`: konteyner koşumlarında 25 "serialization conflict after retries" — **24'ü
  `cart.cancel`** (k6'nın yineleme başında sepeti boşaltması), 1'i `cart.hold`. v4'te görülen
  onay-adımı çakışmaları fix-sweep-3'ün ayrı onay bütçesiyle (`CONFIRM_SERIALIZABLE_RETRY_*`)
  giderilmişti; tutma gecikmesinin nedeni 40001 değil kilit kuyruğu.

### Uygulanan düzeltme (B)

1. **Kilit beklerken erken vazgeçme** — `Redlock.acquire` `abortIf` seçeneği
   (`LockAbortedError extends LockError`); sepet tutması her `CART_HOLD_SOLDOUT_CHECK_MS`
   (250 ms) kalemlerin sayaçta hâlâ sığıp sığmadığını tek indeksli sorguyla kontrol eder; biri
   sığmıyorsa kuyruktan çıkıp **hemen 409 SOLD_OUT** (bütçe sonunu beklemez).
2. **Kilit altı ön kontrol** — kilidi alan bekleyen önce aynı sayaç sorgusunu çalıştırır; stok
   tükendiyse SERIALIZABLE işlemi hiç açmadan SOLD_OUT. Kilit altında bu oda tiplerinde tutma
   yapılamaz, sayaç yalnız bırakmayla artabilir → karar tutucu (yanlış "var" üretemez).
3. `CART_HOLD_SOLDOUT_CHECK_MS=0` eski davranış (A/B ve acil geri alma anahtarı).

Doğruluk invariantları değişmedi: tutma hâlâ sıralı Redlock + tek SERIALIZABLE işlem + koşullu
`holdUnits` (`sold + held + n <= total`, DB CHECK kısıtı). Sonuç: ölü kritik bölge 124 → 4,
ortalama kilit beklemesi 3.51 → 1.09 s, 20 VU p95 1.87 s.

### Kalan darboğaz (100 VU)

- Stok varken kuyruk: 10 başarılı tutmanın her biri kilidi ~0.63 s tutuyor (doymuş olay döngüsünde
  2 kalem × ~12 sorgu); ortak oda tipi olan sepetler sıralanır → ilk ~6–7 s boyunca kuyruk uzun,
  bütçeyi (7.5 s) aşan 34 bekleyen `ROOM_BUSY` 409 alıyor → p95 8.4 s.
- Deney: bekleme bütçesi 2 s (`LOCK_WAIT_BUDGET_MS=2000`) p95'i 3.6–4.0 s'ye indiriyor ama
  `busy` (ROOM_BUSY, "tekrar deneyin") 34 → 435 artıyor; varsayılan değiştirilmedi (tekil
  rezervasyonu da etkiler, UX kötüleşir).

### Aday düzeltmeler (uygulanmadı — gerekçe)

| Aday (plan)                                             | Durum / gerekçe                                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tek `UPDATE … WHERE sold+held+n<=total` ile envanter    | **Zaten öyle** (`holdUnits`, `src/lib/booking/inventory.ts`); ek kazanç yok.                                                                                                                                                                                                  |
| Kilidi oda tipi+tarih kovasına daraltma                 | Gerçek trafikte farklı tarihli tutmaları ayırır; bu testte tüm VU'lar aynı tarihte → etkisi 0. Tekil rezervasyon yolu (`booking-service.ts`) ile aynı anahtarı paylaşmak zorunlu; ikisi birlikte değişmeli (ayrı iş, tarih aralığı kova sınırını aşan kalemde çoklu kilit).   |
| Kilit altında yalnız sayaç (fiyat/teklif kilit dışında) | En büyük kalan kazanç: kritik bölge ~20 → ~6 gidiş-dönüş (oda tipi/tarife/politika/kısıt/promosyon okumaları kilit öncesine, işlem içinde yalnız sürüm doğrulaması). `reserveBookingInTx` tekil ve sepet yolunca paylaşıldığı için ayrı, testli bir refaktör olarak önerilir. |
| Redlock yerine yalnız DB satır kilidi (FIFO)            | 100 eşzamanlı işlem 10'luk havuzu kilit beklerken tüketir; diğer istekler aç kalır. Önerilmez.                                                                                                                                                                                |

## Komutlar

```sh
# host A/B (Postgres/Redis yük yığınında, 127.0.0.1'e yayınlanmış)
CART_HOLD_SOLDOUT_CHECK_MS=0|250 npx next start -p 3100
docker run --rm -i -e BASE_URL=http://host.docker.internal:3100 -e LOAD_ACCOUNTS=120 \
  -e LOAD_ROOMS=<seed-load çıktısı> -e PAY=1 -e VUS=100 -e DAY_OFFSET=<temiz gün> \
  grafana/k6 run - < load/cart-spike.js
# evre metrikleri
curl -H "authorization: Bearer $METRICS_TOKEN" :3100/api/metrics | grep cart_hold_
```
