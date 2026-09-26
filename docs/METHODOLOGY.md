# Metodoloji

Bu doküman fiyat, vergi, kur, fiyat içgörüsü, arama, fraud, gelir önerisi ve rota hesaplarının **gerçekte nasıl** yapıldığını anlatır. Tüm eşikler `src/lib/config/app-config.ts` içinde zod ile doğrulanan ortam değişkenleridir (adları `.env.example`'da). Aşağıdaki değerler varsayılanlardır. Para her yerde **minor-unit tamsayıdır**; yuvarlama yalnızca `src/lib/money/money.ts` yardımcılarıyla yapılır ([ADR 0004](adr/0004-minor-unit-money-quote.md)).

## 1. Quote: tek fiyat kaynağı (`src/lib/pricing/quote.ts`)

`computeTotal()` arama kartı, PDP, checkout, ACP ve tahsilatın kullandığı tek hesaptır:

1. Geceler mülkün saat dilimine göre hesaplanır (`todayIn`, `parseStay`, en fazla `MAX_STAY_NIGHTS` = 30; [ADR 0011](adr/0011-property-time-zone-temporal.md)).
2. Kişi sayısı `maxOccupancy × units` ile sınanır; `pickRatePlan` rate planı seçer; `checkRestrictions` kısıtları uygular.
3. `nightsFromInventory`: her gece için `total − sold − held ≥ units` olmalıdır, yoksa `SoldOutError`.
4. Konaklama tutarı (`priceStay`):

```
oda-gece  = applyBps(InventoryDay.price + RoomType.priceModifier, RatePlan.priceModifierBps)
gece      = oda-gece × units
subtotal  = Σ gece
total     = subtotal + addOn          # addOn: dahil OLMAYAN vergi ve ücret satırları (§2)
```

5. Kur: `resolveChargeCurrency` + `getCurrentFx` → `chargeAmount` (§3). Quote `fxSnapshotId` ve `charge { currency, total }` taşır.
6. Quote Redis'te `quote:<id>` anahtarıyla `QUOTE_TTL_MINUTES` (15) boyunca saklanır.

### 1.1 Gecelik fiyat motoru (`src/lib/pricing/event-signals.ts`)

Eski float motor (`engine.ts`) kaldırıldı ([ADR 0016](adr/0016-legacy-pricing-and-negotiation.md)). Gecelik fiyatı yalnızca `priceNights` / `explainNightPrice` üretir; worker fiyat işi (`updateAvailabilityPrices`) ve canlı ısı haritası aynı fonksiyonu kullanır.

| Faktör     | Kural (gece tarihinin takvim ayı / günü)          |
| ---------- | ------------------------------------------------- |
| Mevsim     | Haziran–Eylül 1.30; Aralık–Ocak 1.15; diğer 1.00  |
| Hafta günü | Cuma 1.15, Cumartesi 1.18, Pazar 1.05, diğer 1.00 |
| Olay       | Onaylı olaylar, aşağıda                           |

```
olay çarpanı = 1 + Σ(onaylı ve geceyi kapsayan olayların impact'i) × EVENT_FACTOR_PER_POINT   # 0.05
ham çarpan   = mevsim × hafta günü × olay çarpanı
çarpan       = clamp(ham çarpan, PRICE_FLOOR_MULTIPLIER, PRICE_CEILING_MULTIPLIER)         # [0.6, 2.0]
gece fiyatı  = multiplyRate(Property.basePrice, çarpan)
```

- Olaylar admin tarafından önerilir/onaylanır (`POST /api/admin/events`, `…/approve`). LLM yalnızca `PROPOSED` bir öneri çıkarır; etki değerini admin onaylar.
- Fiyat her zaman **taban fiyattan** hesaplanır, bu yüzden aynı olayı tekrar uygulamak sonucu değiştirmez (idempotent).
- Kırılım `InventoryDay.priceExplanation` alanına yazılır: `base`, `factors`, `events[]`, `rawMultiplier`, `multiplier`, `clamped`, `price`.
- `priceOverride = true` olan geceler (kabul edilmiş gelir önerisi, §6) motor tarafından ezilmez.
- **Yield hold:** onaylı bir olay için gece başına birimlerin en fazla `YIELD_HOLD_MAX_SHARE` (0.2) kadarı `ExternalBlock(source = "yield:<eventId>")` ile satıştan çekilir ve `sold` sayacına eklenir.

## 2. Vergi motoru (`src/lib/pricing/tax.ts`, [ADR 0012](adr/0012-tax-engine-and-persistent-fx.md))

Kurallar `data/tax-rules.json` dosyasından gelir. `TAX_RULES_JSON` ortam değişkeni verilirse dosyayı **tamamen** değiştirir; geçersiz JSON'da varsayılan kurallar kullanılır ve uyarı loglanır. Kural türleri: `VAT`, `ACCOMMODATION`, `CITY`, `SERVICE_FEE`. Her kural ya `rateBps` (baz puan, 1/10.000) ya da `flatMinor` içerir.

Varsayılan dosya **demo kurallarıdır** ("hukuki danışmanlık değildir"):

| Kod                 | Tür           | Oran     | Dahil mi | Geçerlilik              |
| ------------------- | ------------- | -------- | -------- | ----------------------- |
| `VAT`               | VAT           | 1000 bps | evet     | süresiz                 |
| `ACCOMMODATION_TAX` | ACCOMMODATION | 200 bps  | hayır    | süresiz                 |
| `ACCOMMODATION_TAX` | ACCOMMODATION | 100 bps  | hayır    | 2026-05-01 – 2026-12-31 |

Aynı koda sahip tarihli kural, o gece için tarihsiz olanı geçersiz kılar (`rulesForNight`).

`SERVICE_FEE_BPS` (varsayılan 0, aralık 0–3000) sıfırdan büyükse ve kurallarda `SERVICE_FEE` yoksa bir hizmet bedeli kuralı otomatik eklenir.

**Gece başına hesap sırası** (brüt = gecenin konaklama tutarı):

```
1) dahil vergiler:   pay = includedBpsOf(brüt, bps) = brüt × bps / (10000 + bps)   # half-up
                     net = brüt − Σ pay
2) hariç yüzde:      satır = bpsOf(net, bps)       = brüt yerine net × bps / 10000  # half-up
                     SERVICE_FEE: bpsOf(brüt, bps)
3) sabit tutar:      flatMinor × (perNight ? units : 1) × (perGuest ? guests : 1)
                     perNight değilse konaklama başına bir kez; para birimi farklıysa atlanır
```

- `bpsOf` / `includedBpsOf` BigInt ile `divHalfUp` kullanır; kayan nokta yoktur.
- Satırlar kod bazında toplanır; tutarı 0 olan satır gösterilmez. `addOn` = dahil olmayan satırların toplamıdır. Dahil vergiler (KDV) yalnızca bilgi amaçlı gösterilir, toplamı artırmaz.
- Vergi oranları gerçek mevzuatı yansıtmak için değil, motoru göstermek için seçilmiştir; üretimde `TAX_RULES_JSON` ile güncellenmelidir.

## 3. Kur snapshot'ı (`src/lib/fx/store.ts`)

- `fx-refresh` işi (`FX_REFRESH_CRON`, `45 12 * * *`) `FX_SOURCES` (`tcmb,ecb`) sırasıyla kaynakları dener. TCMB `ForexSelling` değerlerini kullanır; ECB kurları çapraz kurla TRY tabanına çevrilir. Her başarılı çalışma yeni bir `FxRate` satırı yazar (`base = TRY`, `rates` JSON, `source`, `asOf`).
- Hiçbir kaynak yanıt vermezse statik `data/fx-rates.json` (veya `FX_RATES_JSON`) `stale: true` işaretiyle yazılır. `FX_STALE_HOURS` (72) saatten eski kur da bayat sayılır.
- `getCurrentFx` son satırı `FX_CACHE_SECONDS` (60) boyunca önbellekte tutar; tablo boşsa statik fallback'e düşer.
- **Snapshot sabitleme:** quote ve rezervasyon `fxSnapshotId` taşır; `getFxById` aynı kuru geri getirir, böylece rezervasyonun tahsil tutarı sonradan değişmez.
- Budama: bir rezervasyona bağlı olmayan ve `FX_RETENTION_DAYS` (90) günden eski satırlar silinir; en yeni satır her zaman korunur.
- Tahsil para birimi: `FX_CHARGE_CURRENCIES` (varsayılan boş = yalnızca mülkün para birimi).

## 4. Fiyat içgörüsü ve Omnibus (`src/lib/pricing/insight.ts`)

`GET /api/price-insight` ve MCP `get_price_insight` aracı bu hesabı kullanır. LLM kullanılmaz.

### 4.1 Split conformal prediction

```
ŷ(gece)   = explainNightPrice(base, gece, events: [])     # olaysız motor fiyatı: taban × mevsim × hafta günü
s         = |y / ŷ − 1|                                    # göreli uygunsuzluk skoru

Kalibrasyon kümesi: aynı konum ve para birimindeki DİĞER oda tiplerinin InventoryDay satırları,
                    bugün ± PRICE_INSIGHT_WINDOW_DAYS (90) gün (hedef oda tipi hariç → ayrık küme)

n      = |skorlar|
rank   = ⌈(n + 1)(1 − α)⌉                                  # α = PRICE_INSIGHT_ALPHA = 0.1 → düzey 0.9
q      = n = 0 veya rank > n ise ∞, aksi halde sıralı skorların rank. elemanı
aralık = [max(0, ⌊ŷ̄(1 − q)⌋), ⌈ŷ̄(1 + q)⌉]                 # q = ∞ → [0, MAX_SAFE_INTEGER]
etiket = fiyat < alt → "low" (Düşük); fiyat > üst → "high" (Yüksek); aksi "typical" (Tipik)
```

- `fiyat` (`nightlyMinor`) konaklamadaki `InventoryDay.price` değerlerinin ortalamasıdır; `ŷ̄` (`predictedMinor`) gecelerin `ŷ` ortalamasıdır.
- n < `PRICE_INSIGHT_MIN_CALIBRATION` (20) ise aralık ve etiket **döndürülmez** (`null`).
- Aralık dışa doğru yuvarlanır, yani daralmaz. Kapsama garantisi yalnızca kalibrasyon ve hedef gecelerin değiştirilebilir (exchangeable) olduğu varsayımı altında geçerlidir; farklı mülk ve mevsimlerin karışması bu varsayımı zayıflatır. Ayrıntı: [MODEL_CARD §3](MODEL_CARD.md).

### 4.2 Omnibus referans fiyatı

AB Omnibus direktifine uygun "önceki fiyat" gösterimi:

```
referans = min{ gözlem.total : bugün − PRICE_OMNIBUS_DAYS ≤ gözlem.on < bugün }   # 30 gün; bugün hariç
         = null (pencerede gözlem yoksa)
```

- `recordObservation` aynı günün gözlemini üzerine yazar ve pencere dışını atar.
- `price-alerts` işi (`PRICE_ALERT_CRON`, `15 6 * * *`) takip edilen konaklamanın **vergi dahil toplamını** gözlemler. Toplam Omnibus referansının altına düşerse outbox'a `price.dropped` olayı yazar ve e-posta gönderilir (günde bir kez). Kullanıcı başına en fazla `PRICE_ALERT_MAX_PER_USER` (20) alarm.

### 4.3 Promosyon motoru ve teklifte Omnibus referansı (P1-8)

Kural motoru `src/lib/pricing/promotions.ts` (saf, deterministik). Türler: `EARLY_BIRD` (varışa ≥ `minDaysBefore` gün), `LAST_MINUTE` (≤ `maxDaysBefore`), `LONG_STAY` (≥ `minNights`), `MOBILE_RATE` (Client Hints `Sec-CH-UA-Mobile`, yoksa UA), `COUPON` (kod, `usageLimit`). Günler tesisin yerel bugününe göre sayılır.

1. Uygunluk: aktiflik, `[startsAt, endsAt)`, koşullar, kupon eşleşmesi, kullanım limiti, sabit indirimde para birimi → her promosyon için gerekçe kodu.
2. Bağımsız indirim: yüzde `bpsOf(ara toplam, bps)` (tek half-up yuvarlama) veya sabit tutar (ara toplamı aşamaz).
3. Sıra: öncelik ↓ → indirim ↓ → id ↑. Açgözlü birleşme: ilk seçilen birleşemezse tek başına; birleşebilirler yalnız birleşebilirlerle ve her `stackGroup`'tan en fazla biri (`NOT_STACKABLE`, `STACK_GROUP_TAKEN`).
4. Taban: toplam indirim ≤ ara toplam × `PROMOTION_MAX_DISCOUNT_BPS` (varsayılan %90); aşan satır kırpılır (`DISCOUNT_CAP_REACHED`). Negatif fiyat yok.
5. `priceStay`: `total = brüt geceler − Σ promosyon + ücretler + hariç vergiler`; indirim gecelere orantılı (en büyük kalan) dağıtılır ve vergiler indirimli gece tutarından hesaplanır. Defter (`taxShareMinor`) bu kırılımdan okur → indirimli tahsilat da dengeli jurnal üretir.
6. Kupon/limitli promosyon kullanımı rezervasyon (tutma) işleminde koşullu `UPDATE … usageCount < usageLimit` ile sayılır; tutma düşerse (süre dolumu, ödeme hatası, onay öncesi iptal) iade edilir.

Teklifte Omnibus: `InventoryDay.priceMinor` her değiştiğinde DB tetiği `InventoryPriceHistory`'ye yazar. Her gece için `[şimdi − PRICE_OMNIBUS_DAYS, şimdi]` penceresinde herhangi bir anda yürürlükte olan taban fiyatların en düşüğü (pencere başında yürürlükteki fiyat + penceredeki değişiklikler + şu anki fiyat) alınır, konaklama bu fiyatlarla **promosyonsuz** fiyatlanır → `lowestPrice30dMinor` (vergi dahil, tesis para birimi). Arayüz indirim gösterirken üstü çizili fiyat olarak yalnız bunu kullanır (toplamdan yüksekse) ve "son 30 günün en düşük fiyatı" etiketini gösterir. Sınır: geçmiş promosyonlu fiyatlar referansa katılmaz (yalnız taban fiyat geçmişi); arama kartı fiyatı promosyonsuzdur (promosyon teklif/checkout'ta uygulanır).

## 5. Fraud v2 (`src/lib/risk/fraud.ts`)

Ödeme yetkilendirmesinden önce çalışır. Hız sayaçları Redis `incrWithTtl` ile tutulur. Redis erişilemezse hız ve cihaz kuralları puan eklemez (fail-open); diğer kurallar çalışır. LLM kullanılmaz.

| Kural                     | Koşul                                                                               | Puan |
| ------------------------- | ----------------------------------------------------------------------------------- | ---- |
| `velocity_user`           | Kullanıcı başına 10 dk'da > `FRAUD_VELOCITY_USER_MAX` (3) deneme                    | 25   |
| `velocity_ip`             | IP başına saatte > `FRAUD_VELOCITY_IP_MAX` (10) deneme (bilinmeyen IP sayılmaz)     | 20   |
| `velocity_card`           | Kart token'ı başına saatte > `FRAUD_VELOCITY_CARD_MAX` (5) deneme                   | 20   |
| `new_account_high_amount` | Hesap < 24 saat ve tutar ≥ `FRAUD_HIGH_AMOUNT_MINOR` (2.000.000 minor = 20.000 TRY) | 30   |
| `country_mismatch`        | IP ülkesi ≠ fatura ülkesi                                                           | 20   |
| `bin_ip_country_mismatch` | Kart BIN ülkesi ≠ IP ülkesi (BIN tablosu `bin-table.ts`, **mock**)                  | 20   |
| `failed_payments`         | Son 24 saatte ≥ 3 başarısız ödeme                                                   | 25   |
| `new_device`              | Kullanıcının bilinen cihazları var ve bu cihaz yeni                                 | 10   |
| `device_shared`           | Aynı cihazda > `FRAUD_DEVICE_MAX_ACCOUNTS` (3) hesap                                | 25   |

```
skor = min(100, Σ tetiklenen kuralların puanı)

skor ≥ FRAUD_BLOCK_THRESHOLD     (80) → deny            → 403 FRAUD_BLOCKED
skor ≥ FRAUD_REVIEW_THRESHOLD    (60) → review          → 3DS zorunlu + admin kuyruğu
skor ≥ FRAUD_STEP_UP_THRESHOLD   (45) → step_up_passkey → passkey step-up (passkey yoksa 3DS)
skor ≥ FRAUD_CHALLENGE_THRESHOLD (30) → challenge_3ds   → 3DS zorunlu
aksi                                  → allow
```

- Cihaz parmak izi istemcide üretilir: iki farklı tohumla FNV-1a 32-bit → 16 hex karakter (`device-fingerprint.ts`). Cihaz kümeleri `FRAUD_DEVICE_TTL_DAYS` (90) gün tutulur. Bu bir tanımlayıcı değil, düşük entropili bir risk sinyalidir.
- Step-up token'ı `STEP_UP_TTL_SECONDS` (300) geçerlidir ve tek kullanımlıktır.
- Her karar `FraudCheck` satırına skor, karar ve tetiklenen kurallarla yazılır.

## 6. Gelir önerisi (`src/lib/pricing/revenue-engine.ts`, [ADR 0015](adr/0015-agentic-booking-channel-revenue.md))

Host için önümüzdeki `REVENUE_SUGGESTION_DAYS` (14) gece için deterministik fiyat önerisi (`suggestPrice`):

```
base    = Property.basePrice (minor)
floor   = ⌈base × min(1, PRICE_FLOOR_MULTIPLIER)⌉      # 0.6
ceiling = ⌊base × max(1, PRICE_CEILING_MULTIPLIER)⌋    # 2.0
occ     = clamp((sold + held) / total, 0, 1)

çarpanlar (sırayla, her biri ≥ 0'a kırpılır):
  occupancy = 1 + REVENUE_OCCUPANCY_WEIGHT × (occ − REVENUE_OCCUPANCY_TARGET)             # 0.5, 0.7
  lead_time = 1 − REVENUE_LAST_MINUTE_DISCOUNT_BPS / 10000                                 # 1000 bps
              yalnızca leadDays ≤ REVENUE_LAST_MINUTE_DAYS (3) VE occ < hedef ise; aksi 1
  holiday   = 1 + REVENUE_HOLIDAY_UPLIFT_BPS / 10000   (resmî tatil ise, tr-holidays.ts)   # 1500 bps
  event     = 1 + Σ max(0, impact) × EVENT_FACTOR_PER_POINT                               # 0.05

running_0 = base;  running_i = running_{i−1} × çarpan_i
katkı_i   = round(running_i) − round(running_{i−1})
raw       = round(running_son)
suggested = clamp(raw, floor, ceiling)
katkı_clamp = suggested − raw
```

- Katkıların toplamı tam olarak `suggested − base`'e eşittir; arayüz bunu şelale (waterfall) olarak gösterir.
- Açıklama cümlesi `revenue_explain` LLM görevidir ve yalnızca bu sayıları ifade eder; metindeki her sayı `assertNumbersGrounded` ile olgu kümesinde doğrulanır, aksi hâlde demo şablonu (`demoRevenueExplanation`) kullanılır.
- Kabul: `InventoryDay.price` yazılır ve `priceOverride = true` yapılır (§1.1). Red: hiçbir şey değişmez. Karar her zaman host'undur.

## 7. Arama sıralaması

### 7.1 Reciprocal Rank Fusion (`src/lib/search/hybrid.ts`, [ADR 0014](adr/0014-hybrid-search-ltr-experiments.md))

```
RRF(d) = Σ_{c ∈ kanallar, d ∈ c} 1 / (k + rank_c(d))        k = SEARCH_RRF_K = 60
```

| Kanal | Kaynak                                                                       | Eşik / sınır                               |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| `lex` | `ts_rank_cd`, `simple` ∪ `turkish` tsquery, ≥ 3 harfli kelimelerde önek `:*` | `SEARCH_HYBRID_CANDIDATES` (200)           |
| `vec` | pgvector kosinüs benzerliği (`1 − (embedding <=> v)`)                        | sim ≥ `SEARCH_HYBRID_MIN_SIMILARITY` (0.2) |
| `trg` | `pg_trgm` `word_similarity` (başlık, şehir), ≥ 4 harfli kelimeler            | sim ≥ `SEARCH_HYBRID_MIN_TRGM` (0.45)      |
| `phr` | Tam ifade alt-dize eşleşmesi (≥ 3 karakter), sabit rank 1                    | —                                          |

Sorgu en fazla 8 kelimeye kesilir ve `expandSynonyms` ile genişletilir. Eşitlikte `id` ile deterministik sıra. Aynı formülün saf TypeScript karşılığı `rrfFuse(lists, k)` birim testlerde kullanılır. SQL yapısı: [ARCHITECTURE §6.1](ARCHITECTURE.md).

### 7.2 Ağırlıklı skor (`src/lib/search/ranking.ts`)

```
skor = Σ ağırlık_i × bileşen_i        (her bileşen [0, 1])
```

| Bileşen      | Sorgusuz | Sorgulu | Tanım                                                            |
| ------------ | -------- | ------- | ---------------------------------------------------------------- |
| `priceFit`   | 0.30     | 0.10    | `(max − fiyat) / (max − min)` sonuç kümesinde; tek fiyat varsa 1 |
| `rating`     | 0.35     | 0.15    | Bayes düzeltilmiş puan / 5: `(4.0 × 5 + ort × n) / (5 + n)`      |
| `popularity` | 0.10     | 0.05    | `log(1 + yorum sayısı) / log(1 + en yüksek yorum sayısı)`        |
| `personal`   | 0.10     | 0.10    | Kullanıcının geçmişine (şehir/tip) yakınlık; anonimde 0          |
| `semantic`   | 0.15     | 0.60    | Hibrit aramanın ilgi sinyali                                     |

- `explain` alanı ağırlıklı bileşenleri içerir; toplamları skora eşittir. Reklam veya komisyon sıralamayı etkilemez; kullanıcıya açık özet `/ranking` sayfasındadır (DSA md. 27).
- LTR kolu aynı özellikleri ONNX modeline verir; `explain` yine ağırlıklı kırılımdır. Model ve ölçümler: [MODEL_CARD §2](MODEL_CARD.md).

## 8. Rota optimizasyonu (`src/lib/routing/optimizer.ts`)

Problem: başlangıç şehri sabittir; diğer şehirler toplam yolculuk maliyeti en düşük olacak sırayla gezilir. Varsayılan **açık yoldur** (dönüş bacağı yok); `returnToOrigin: true` ile kapalı tur.

**Bacak maliyeti (asimetrik):**

```
km          = haversine(A, B)
uçuş        = km × ROUTING_FLIGHT_COST_PER_KM + ROUTING_FLIGHT_COST_BASE     # 0.09, 40
konfor ceza = (5 − climateComfort(B.enlem, ay)) × 0.02                        # ay 1–12
maliyet     = km × (1 + konfor ceza) + 0.4 × uçuş
```

Varış şehrinin mevsim konforu uygulandığı için A→B ≠ B→A.

**Algoritma:**

| Şehir sayısı n         | Yöntem                                                                                                             | Karmaşıklık                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| n ≤ 10 (`EXACT_LIMIT`) | **Held-Karp** dinamik programlama — kesin optimum                                                                  | O(n²·2ⁿ) zaman, O(n·2ⁿ) bellek           |
| n > 10                 | En yakın komşu başlangıcı + yerel arama: **2-opt** (alt yol ters çevirme) ve **or-opt** (1–3 şehirlik blok taşıma) | İyileşme kalmayana kadar; her hamle O(n) |

- Yerel aramada her hamle **tüm yol maliyeti yeniden hesaplanarak** değerlendirilir; klasik 2-opt delta formülü simetri varsaydığından kullanılmaz. Bu, asimetrik maliyette de doğruluğu korur.
- Girdi sınırı: `cities` en fazla `ROUTING_MAX_CITIES` (12) ve tekil; şehir adları Türkçe yerel ayarla normalize edilir ("istanbul" = "İstanbul").
- Trip-planner (`POST /api/ai/trip-plan`) bu fonksiyonu `optimizeRoute` aracı olarak kullanır.

### Neden "quantum" değil

Bu modülün ilk sürümü "quantum-inspired" olarak adlandırılmıştı; ancak kodda kuantum hesaplama, kuantum tavlama veya kuantumdan esinlenen herhangi bir yöntem hiç olmadı. Kullanılan algoritmalar klasik kombinatorik optimizasyondur: Held-Karp (1962) dinamik programlama ve 2-opt / or-opt yerel arama. 12 şehirlik bir problem için Held-Karp zaten kesin optimumu milisaniyeler içinde bulur; farklı bir paradigmaya ihtiyaç yoktur. Yanıltıcı ad kod, commit mesajları, arayüz ve dokümandan kaldırıldı; yalnızca bu açıklama kalır.

## 9. Smart Filter golden set

`tests/unit/ai/smart-filter-golden.test.ts` demo modundaki kural tabanlı Türkçe ayrıştırıcıyı (`src/lib/ai/smart-filter-parser.ts`) 20 örnek cümleyle ölçer. Her cümle için beklenen alanlar (şehir, serbest sorgu, misafir sayısı, fiyat aralığı, olanaklar, konaklama tipi, tarih, sıralama) tam eşleşmelidir.

- Örnekler: "Kadıköy'de denize yakın, kahvaltılı, 2 kişi, gecesi 3000 TL altı", "kapadokyada balayı için 12 temmuz 3 gece", "köpeğimle kalabileceğim bir daire, Çeşme".
- **Kabul eşiği: ≥ 18/20.** Mevcut sonuç (demo modu, 2026-09-24): **20/20**.
- Ek test: bilinmeyen şehir/olanak ("Mars'ta jakuzili saray") asla filtreye girmez.
- Canlı modda LLM çıktısı aynı izinli sözlüğe (veritabanındaki `Location` ve `Amenity`) göre süzülür; bilinmeyen değer sorguya giremez. Canlı mod için otomatik bir skor tutulmaz (testler ağa çıkmaz).

## 10. Yorum öne çıkanları ve alıntı guard'ı (`src/lib/ai/review-highlights-core.ts`, v4 P1-9)

- **Kümeleme:** en yeni `REVIEW_HIGHLIGHTS_MAX_REVIEWS` yayınlanmış yorum cümlelere bölünür; her cümle KVKK redaksiyonundan (`redactText`, yazar adları dahil) geçip mevcut embedding altyapısıyla (`getEmbedder`: ağsız hash-embedder ya da uzak model — o da redakte eder) vektörlenir. Küresel k-means (`src/lib/reviews/kmeans.ts`): k-means++ başlangıcı `mulberry32(REVIEW_HIGHLIGHTS_KMEANS_SEED)` ile, eşitlikler en küçük indeksle bozulur, girdi yorum id'sine göre sıralanır → aynı yorum seti her zaman aynı kümeleri verir. `k = min(MAX_CLUSTERS, ⌈√(cümle/2)⌉)`.
- **Özet:** küme başına tek LLM çağrısı (`review_highlights`, `withAiSubject` bütçesi + süreç limiti); çıktı `{title, claims[{text, quote, reviewId}]}`.
- **Guard (`filterQuotedClaims`, `src/lib/llm/guards.ts`):** her iddia için `quote` zorunlu, en az `REVIEW_HIGHLIGHTS_MIN_QUOTE_CHARS` karakter, belirtilen kaynak yorum kümede olmalı ve alıntı o yorumda **birebir** geçmeli (büyük/küçük harf, noktalama dahil; yalnızca ardışık boşluk farkı tolere edilir). İddia metnindeki her sayı/tarih yorum verisinde olmalı (`findUngroundedNumbers`). Koşulu sağlamayan iddia **reddedilir** (sayısı `rejectedClaims` ve log'da); kümede geçerli iddia kalmazsa veya başlıkta dayanaksız sayı varsa küme deterministik özete düşer (`llmMode: "fallback"`).
- **Demo/fallback:** başlık kümenin en sık anlamlı sözcüğünden, iddialar merkeze en yakın ve farklı yorumlardan gelen **gerçek cümlelerden** seçilir (alıntı = cümle). Yanıttaki `start/end` aralığı UI'da yoruma kaydırma ve vurgulama için kullanılır.
- **Önbellek:** anahtar = yorum setinin SHA-256 karması (id + puan + metin) + dil + LLM modu/modeli + embedder + ayarlar; `fallback` sonuçlar önbelleğe girmez.
- **Karşılaştırma (`src/lib/ai/listing-compare.ts`):** toplam fiyat yalnızca `createQuote` (`/api/quote` ile aynı fonksiyon) çıktısıdır; fark tablosu deterministik koddur. LLM yorumundaki her sayı yapılandırılmış veride (toplamlar minor/major/biçimli, puan, yorum sayısı, gece, iptal saati, ilan başlıkları) bulunmalıdır; aksi hâlde şablon yoruma düşülür.
- **Sınırlamalar ve önyargı.**
  - Guard **uydurma alıntıyı** yakalar, **yanlış genellemeyi** yakalamaz: tek bir yorumdan birebir alıntılanan olumsuz cümle "misafirler … diyor" gibi çoğul bir iddiaya dayanak yapılabilir. Küme başına `mentionCount` (temadan söz eden farklı yorum sayısı) yanıtta döner, ancak her iddia tek bir alıntıya dayanır; iddia başına destekleyen yorum sayısı ölçülmez.
  - Kümeleme, embedding'e bağlıdır: varsayılan hash embedder anlamsal değil sözcüksel benzerlik yakalar (ADR 0008); aynı konuyu farklı sözcüklerle anlatan yorumlar ayrı kümelere düşebilir. Az yorumlu ilanlarda (`REVIEW_HIGHLIGHTS_MIN_REVIEWS` 2) kümeler tek yorumu temsil edebilir.
  - Yalnız en yeni `REVIEW_HIGHLIGHTS_MAX_REVIEWS` (50) yorum kullanılır; eski dönemler temsil edilmez. Yorum dili karışıksa (tr/en) kümeler dile göre ayrışabilir; LLM başlığı istenen dilde yazar ama alıntılar özgün dildedir.
  - Yorum yazanların kendisi seçilmiş bir örneklemdir (yalnız `COMPLETED` konaklama; memnun/çok memnuniyetsiz misafirler daha çok yazar); öne çıkanlar ilanın "gerçek" kalitesini değil yazılmış yorumların içeriğini özetler.
  - Otomatik kalite ölçümü yalnız birim testlerdeki uydurma/alıntısız ret senaryolarıdır; insan değerlendirmesi veya etiketli bir özet veri kümesi yoktur.
  - Karşılaştırmada "en esnek" rozeti yalnız iptal politikası anlık görüntüsüne, "en yüksek puan" ortalama puana dayanır; yorum sayısı düşük ilanın ortalaması gürültülüdür.

## 11. Parti riski skoru (`src/lib/trust/party-risk.ts`, P1-6)

Amaç: ev sahibini, izinsiz parti riski taşıyabilecek rezervasyonlar hakkında **önceden
bilgilendirmek**. Skor rezervasyonu reddetmez, iptal etmez ve fiyatı değiştirmez; yalnızca
ev sahibine e-posta (outbox `trust.party_risk_flagged`) ve host panelinde gerekçeli bir satır
üretir. LLM kullanılmaz; aynı girdi her zaman aynı skoru verir.

**Hesap.** `booking.created` olayının outbox tüketicisi (booking-service değişmeden) beş ikili
sinyali değerlendirir; skor, tetiklenen sinyallerin ağırlık toplamıdır (üst sınır 100):

| Gerekçe kodu    | Koşul (varsayılan)                       | Ağırlık (varsayılan) | Config                                                             |
| --------------- | ---------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `LARGE_GROUP`   | misafir sayısı ≥ 6                       | 30                   | `PARTY_RISK_LARGE_GROUP_MIN`, `PARTY_RISK_WEIGHT_LARGE_GROUP`      |
| `YOUNG_ACCOUNT` | hesap yaşı < 30 gün (rezervasyon anında) | 20                   | `PARTY_RISK_YOUNG_ACCOUNT_DAYS`, `PARTY_RISK_WEIGHT_YOUNG_ACCOUNT` |
| `SINGLE_NIGHT`  | tek gece                                 | 20                   | `PARTY_RISK_WEIGHT_SINGLE_NIGHT`                                   |
| `NEAR_DATE`     | girişe < 2 takvim günü                   | 20                   | `PARTY_RISK_NEAR_DATE_DAYS`, `PARTY_RISK_WEIGHT_NEAR_DATE`         |
| `WEEKEND`       | cuma veya cumartesi gecesi içeriyor      | 10                   | `PARTY_RISK_WEIGHT_WEEKEND`                                        |

Skor ≥ `PARTY_RISK_THRESHOLD` (60) → işaretli. Varsayılanlarla tek bir sinyal eşiği geçemez;
ör. "genç hesap + tek gece + yakın tarih" (60) veya "kalabalık grup + tek gece + hafta sonu"
(60) işaretlenir. Her satır `PartyRiskAssessment` tablosunda gerekçe kodlarıyla saklanır
(rezervasyon başına tek satır → outbox yeniden teslimi idempotent); işaretlemede
`booking.party_risk_flagged` denetim kaydı katkı dökümünü (`contributions`) içerir.

**Host onay adımı neden yok.** Mevcut durum makinesi HELD → CONFIRMED (ödeme sagası) üzerine
kurulu; araya "host onayı bekliyor" durumu eklemek hold süresini, ödeme yakalama zamanını ve
iade akışını etkiler. Bu fazda yalnızca uyarı + panel uygulandı; ev sahibi mevcut iptal
politikalarıyla hareket eder.

**Sınırlamalar ve önyargı.**

- Ağırlıklar uzman sezgisiyle seçilmiş **el ayarı** değerlerdir; etiketli parti/hasar verisiyle
  kalibre edilmemiştir. Skor bir olasılık değildir; "60" "%60 risk" anlamına gelmez.
- Sinyaller dolaylıdır ve masum davranışla örtüşür: aile ziyaretleri kalabalık, iş seyahatleri
  tek gecelik, son dakika rezervasyonları acil durumlarda yaygındır. Yanlış pozitif oranı
  ölçülmemiştir; bu yüzden skor **engellemez**, yalnızca bilgilendirir.
- `YOUNG_ACCOUNT` platforma yeni katılanları (ör. gençler, ilk kez seyahat edenler, göçmenler)
  orantısız etkileyebilir; yaş, uyruk, konum gibi korunan/vekil özellikler bilinçli olarak
  **kullanılmaz** (misafirin ilanla aynı şehirde oturması gibi sektörde yaygın sinyal de
  konum ayrımcılığı riski nedeniyle dışarıda bırakıldı).
- Hafta sonu tanımı UTC gece tarihine göredir; ülke/tatil takvimleri (bayram arifesi, yılbaşı)
  dikkate alınmaz.
- Tek başına kötü niyetli bir misafir sinyalleri kolayca atlatabilir (ör. 2 gece ve 5 kişi
  yazmak). Skor caydırıcı değil, ev sahibinin dikkatini yönlendiren bir araçtır.
- İzleme önerisi: `party_risk_assessments_total{outcome}` oranı ve işaretli rezervasyonların
  iptal/şikâyet oranı izlenmeli; ağırlıklar veriye dayalı yeniden ayarlanmadan önce bu
  bölümdeki varsayılanlar gerekçesiyle birlikte güncellenmelidir.
