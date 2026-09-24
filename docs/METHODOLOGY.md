# Metodoloji

Bu doküman fiyat, sıralama, fraud ve rota hesaplarının **gerçekte nasıl** yapıldığını anlatır. Tüm eşikler `src/lib/config/app-config.ts` içinde zod ile doğrulanan ortam değişkenleridir (adları `.env.example`'da); aşağıdaki değerler varsayılanlardır.

## 1. Fiyat motoru

### 1.1 Tek fiyat kaynağı: `computeTotal()`

`src/lib/pricing/quote.ts` (`priceStay`) konaklamanın her gecesi için `Availability.price` + oda fiyat farkını (`priceModifier`) minor-unit tamsayıya çevirir, toplar ve vergiyi ekler:

```
gece     = Availability.price + Room.priceModifier          (minor unit, negatif olamaz)
subtotal = Σ gece
vergi    = multiplyRate(subtotal, ACCOMMODATION_TAX_RATE)   # tek noktada yuvarlama; varsayılan 0.01 (%1)
total    = subtotal + vergi
```

Arama kartı, PDP, checkout ve tahsilat aynı sonucu kullanır; quote `QUOTE_TTL_MINUTES` (15) boyunca Redis'te saklanır ([ADR 0004](adr/0004-minor-unit-money-quote.md)).

### 1.2 Dinamik fiyat faktörleri (`src/lib/pricing/engine.ts`)

Host fiyat önerisi (`POST /api/pricing`) için çarpımsal bir model kullanılır; her faktör yanıtta ayrı döner:

| Faktör            | Kural                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------- |
| Mevsim            | Haziran–Eylül 1.30; Aralık–Ocak 1.15; diğer 1.00 (UTC ay)                              |
| Son dakika        | Girişe ≤ 3 gün 1.20; ≤ 7 gün 1.10; diğer 1.00                                          |
| Erken rezervasyon | Girişe ≥ 90 gün 0.95                                                                   |
| Hafta günü        | Cuma 1.15, Cumartesi 1.18, Pazar 1.05, diğer 1.00 (UTC)                                |
| Doluluk           | `1 + (doluluk − 0.5) × 0.4` (doluluk [0, 1] aralığına sıkıştırılır)                    |
| Olay yakınlığı    | Onaylı olaylar; pencere dışında 10 günlük doğrusal sönüm, `1 + min(1, Σetki/30) × 0.6` |

Sonuç taban fiyatın **[0.60, 3.00]** katı aralığına sıkıştırılır. Yalnızca `APPROVED` olaylar hesaba girer.

### 1.3 Olay sinyalleri (`src/lib/pricing/event-signals.ts`)

Admin bir haber/duyuru metni gönderir (`POST /api/admin/events`); LLM veya demo ayrıştırıcı bir olay **önerir** (`PROPOSED`). Admin onaylayınca (`POST /api/admin/events/[id]/approve`) konumdaki boş gecelerin fiyatı yeniden hesaplanır:

```
olay çarpanı  = 1 + Σ(onaylı ve geceyi kapsayan olayların impact'i) × EVENT_FACTOR_PER_POINT   # 0.05
ham çarpan    = mevsim × hafta günü × olay çarpanı
çarpan        = clamp(ham çarpan, PRICE_FLOOR_MULTIPLIER, PRICE_CEILING_MULTIPLIER)        # [0.6, 2.0]
gece fiyatı   = multiplyRate(Property.basePrice, çarpan)                                    # minor unit
```

- **Her zaman orijinal taban fiyattan** hesaplanır; mevcut (zaten değişmiş) fiyat girdi değildir. Bu yüzden bileşik artış olmaz ve aynı olayı 10 kez uygulamak 1 kez uygulamakla aynı sonucu verir (**idempotent**; `tests/integration/event-signals.test.ts`).
- Etki penceresi: olaydan bir gece önce → olayın bittiği gecenin ertesi dahil.
- `impact` 1–10 aralığına sıkıştırılır.
- Yalnızca satılmamış ve kilitsiz geceler güncellenir; tek transaction, tek toplu `UPDATE … FROM (VALUES …)`.
- Her gecenin `Availability.priceExplanation` alanına kırılım yazılır ("Bu fiyat neden?"): `base`, `factors { season, weekday, event }`, `events[]`, `rawMultiplier`, `multiplier`, `clamped: "floor" | "ceiling" | null`, `price`.
- Geri alma (`rollback`) olayı devre dışı bırakır ve pencereyi onsuz yeniden fiyatlar.
- **Yield hold** (eski "hedge"in yerine): onaylı bir olay için gece başına oda payının en fazla `YIELD_HOLD_MAX_SHARE` (0.2) kadarı geçici olarak satıştan çekilir (`lockedBy = yield:<eventId>`); `release-hold` ile geri verilir.

Bu bir duygu analizi (sentiment) modeli değildir: etki değerini admin onaylar, formül deterministiktir.

## 2. Sıralama skoru (`src/lib/search/ranking.ts`)

```
skor = Σ ağırlık_i × bileşen_i        (her bileşen [0, 1])
```

| Bileşen      | Ağırlık | Tanım                                                                                                           |
| ------------ | ------- | --------------------------------------------------------------------------------------------------------------- |
| `priceFit`   | 0.30    | `(max − fiyat) / (max − min)` sonuç kümesinde; tek fiyat varsa 1                                                |
| `rating`     | 0.35    | Bayes düzeltilmiş puan / 5: `(4.0 × 5 + ort × n) / (5 + n)` — az yorumlu 5.0 aşırı öne çıkmaz                   |
| `popularity` | 0.10    | `log(1 + yorum sayısı) / log(1 + en yüksek yorum sayısı)`                                                       |
| `personal`   | 0.10    | Kullanıcının geçmişine (şehir/tip) yakınlık; anonimde 0                                                         |
| `semantic`   | 0.15    | Sorgu varsa metin/vektör benzerliği (varsayılan hash-embedding, [ADR 0008](adr/0008-hash-vs-real-embedding.md)) |

- Yanıttaki `explain` alanı ağırlıklı bileşenleri içerir; toplamları skora eşittir (4 ondalık).
- Eşit skorda `id` ile deterministik sıra; aynı girdi → aynı sıra (`tests/unit/search/ranking.test.ts`, property testi dahil).
- Reklam veya komisyon sıralamayı etkilemez. Kullanıcıya açık özet: `/ranking` sayfası (DSA md. 27).

## 3. Fraud kuralları (`src/lib/risk/fraud.ts`)

Ödeme yetkilendirmesinden önce çalışır. Hız sayaçları Redis `INCR` + TTL ile tutulur.

| Kural                     | Koşul                                       | Puan |
| ------------------------- | ------------------------------------------- | ---- |
| `velocity_user`           | Kullanıcı başına > 3 ödeme denemesi / 10 dk | 25   |
| `velocity_ip`             | IP başına > 10 deneme / saat                | 20   |
| `velocity_card`           | Kart token'ı başına > 5 deneme / saat       | 20   |
| `new_account_high_amount` | Hesap < 24 saat ve tutar ≥ 20.000 TRY       | 30   |
| `country_mismatch`        | IP ülkesi ≠ fatura ülkesi                   | 20   |
| `failed_payments`         | Son 24 saatte ≥ 3 başarısız ödeme           | 25   |

Skor = puanların toplamı (en fazla 100).

- Skor ≥ `FRAUD_BLOCK_THRESHOLD` (80) → ödeme engellenir.
- Skor ≥ `FRAUD_REVIEW_THRESHOLD` (40) → 3DS doğrulaması zorunlu + admin inceleme kuyruğu (`GET /api/admin/fraud`).
- Her karar `FraudCheck` kaydına hangi kuralın kaç puan verdiğiyle yazılır.
- Redis erişilemezse hız kuralları puan eklemez (fail-open); diğer kurallar çalışmaya devam eder.

## 4. Rota optimizasyonu (`src/lib/routing/optimizer.ts`)

Problem: başlangıç şehri sabit; diğer şehirleri toplam yolculuk maliyeti en düşük olacak sırayla gezmek. Varsayılan **açık yol** (dönüş bacağı yok); `returnToOrigin: true` ile kapalı tur.

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

## 5. Smart Filter golden set

`tests/unit/ai/smart-filter-golden.test.ts` demo modundaki kural tabanlı Türkçe ayrıştırıcıyı (`src/lib/ai/smart-filter-parser.ts`) 20 örnek cümleyle ölçer. Her cümle için beklenen alanlar (şehir, serbest sorgu, misafir sayısı, fiyat aralığı, olanaklar, konaklama tipi, tarih, sıralama) tam eşleşmelidir.

- Örnekler: "Kadıköy'de denize yakın, kahvaltılı, 2 kişi, gecesi 3000 TL altı", "kapadokyada balayı için 12 temmuz 3 gece", "köpeğimle kalabileceğim bir daire, Çeşme".
- **Kabul eşiği: ≥ 18/20.** Mevcut sonuç (demo modu, 2026-09-24): **20/20**.
- Ek test: bilinmeyen şehir/olanak ("Mars'ta jakuzili saray") asla filtreye girmez.
- Canlı modda LLM çıktısı aynı izinli sözlüğe (veritabanındaki `Location` ve `Amenity`) göre süzülür; bilinmeyen değer sorguya giremez. Canlı mod için otomatik bir skor tutulmaz (testler ağa çıkmaz).
