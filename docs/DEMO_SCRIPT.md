# Demo akışı (3 dakika)

Ön koşul: `cp .env.example .env && docker compose up --build`, <http://localhost:3000> açık, seed yüklü. LLM anahtarı yoksa her şey **DEMO** modunda çalışır ve yanıtlarda `llmMode: "demo"` görünür.

Demo hesapları (**yalnızca demo**, parola `Password123!`): `guest@booking.test`, `host@booking.test`, `admin@booking.test`.

> Adımlar arayüzden (`/search`, `/host`, `/admin`, `/plan`) yapılabilir; tekrarlanabilirlik için aşağıda API çağrılarıyla da gösterilir — yanıtlar aynı servis katmanından gelir. Adım 1, 3 ve host takvimi `tests/e2e/` altında Playwright ile otomatik doğrulanır.

API adımları için oturum (Bearer token, CSRF gerektirmez):

```bash
login() { curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"Password123!\"}" | jq -r .accessToken; }
GUEST=$(login guest@booking.test); HOST=$(login host@booking.test); ADMIN=$(login admin@booking.test)
```

---

## 1. Smart Filter ile arama (~25 sn)

```bash
curl -s localhost:3000/api/search/smart -H 'content-type: application/json' \
  -d '{"text":"Kadıköy'\''de denize yakın, kahvaltılı, 2 kişi, gecesi 3000 TL altı"}' | jq '{llmMode, filters}'
```

**Beklenen:** `filters` içinde `city: "İstanbul"`, `query: "Kadıköy"`, `guests: 2`, `maxPrice: 3000`, `amenities: ["Kahvaltı Dahil", "Deniz Manzarası"]` ve bu filtrelerle deterministik arama sonuçları. Bilinmeyen bir olanak ("jakuzili saray") filtreye girmez. `/search` sayfasında aynı filtreler elle de verilebilir; sonuçların sıralama gerekçesi `/ranking` sayfasında açıklanır.

## 2. PDP: atıflı yorum özeti ve fiyat kırılımı (~30 sn)

Arama sonucundan bir mülke girin (`/property/<id>`).

```bash
curl -s localhost:3000/api/properties/<propertyId>/reviews/summary | jq '{llmMode, summary, pros, cons, citations}'
```

**Beklenen:**

- Özet ve artı/eksiler gerçek yorum cümlelerinden; her `[r:<reviewId>]` atfı o mülkün gerçek bir yorumuna işaret eder (`citations`). Yeni yorum eklenince cache sürümü değiştiği için özet yenilenir.
- PDP'deki rezervasyon kutusu tarih seçilince `GET /api/quote` sonucunu gösterir: gece gece fiyat, "Konaklama vergisi" kalemi (%1) ve vergi dahil toplam. Bu toplam checkout ve tahsilatla birebir aynıdır.

## 3. Checkout → mock 3DS → onay e-postası (~45 sn)

1. `guest@booking.test` ile giriş yapın, PDP'de tarih seçip **Rezervasyon yap** → `/checkout`.
2. Onaylayın: `POST /api/bookings` rezervasyonu **HELD** olarak oluşturur (`holdExpiresAt` = şimdi + 15 dk) ve `/booking/<id>` sayfasına yönlendirir.
3. Kart: `4000 0000 0000 3220`, gelecekte bir son kullanma tarihi, herhangi bir CVC. Kart tarayıcıda token'a çevrilir; sunucuya numara gitmez.
4. `POST /api/bookings/<id>/pay` → `requires_action` (3DS). Doğrulama kodu: **`123456`** → `POST /api/bookings/<id>/pay/confirm`.
5. <http://localhost:3000/dev/mailbox> sayfasını açın.

**Beklenen:** Rezervasyon **CONFIRMED**, ödeme capture edildi. Worker outbox mesajını işledikten sonra (birkaç saniye) mailbox'ta Türkçe "Rezervasyonunuz onaylandı" e-postası görünür. Aynı olay iki kez işlense bile tek e-posta vardır. `4000 0000 0000 0002` ile ödeme reddedilir, rezervasyon HELD kalır ve süre dolunca **EXPIRED** olur.

## 4. İki sekmeden aynı son odaya yarış (~20 sn)

Tek birimli bir oda ve aynı tarihler için iki tarayıcı sekmesinde checkout'u açın ve ikisinde de neredeyse aynı anda onaylayın. API ile:

```bash
BODY='{"propertyId":"<propertyId>","roomId":"<roomId>","checkIn":"<YYYY-MM-DD>","checkOut":"<YYYY-MM-DD>","guestCount":2}'
for i in 1 2; do curl -s localhost:3000/api/bookings -H "authorization: Bearer $GUEST" \
  -H 'content-type: application/json' -H "idempotency-key: race-$i" -d "$BODY" & done; wait
```

**Beklenen:** Bir istek `201` + `HELD`, diğeri `409` ve `code: "SOLD_OUT"` (kilit o an doluysa `ROOM_BUSY`). Aynı garanti 100 paralel istekle entegrasyon testinde kanıtlanır: 1 başarı / 99 `SOLD_OUT`, SQL ile overbooking = 0.

## 5. Host takvimi + olay sinyali onayı → fiyat değişimi ve açıklaması (~40 sn)

Host takvimi (toplu ARI; aktif HELD/CONFIRMED geceler ezilmez):

```bash
curl -s -X PUT localhost:3000/api/rooms/<roomId>/availability -H "authorization: Bearer $HOST" \
  -H 'content-type: application/json' -d '{"from":"<YYYY-MM-DD>","to":"<YYYY-MM-DD>","price":2500}'
```

Admin olay önerisi → onay:

```bash
curl -s localhost:3000/api/admin/events -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"text":"İstanbul'\''da 14-16 Kasım 2026 tarihlerinde büyük bir teknoloji fuarı düzenlenecek."}' | jq '{llmMode, event: .event | {id, status, impact, startsAt, endsAt}}'
curl -s -X POST localhost:3000/api/admin/events/<eventId>/approve -H "authorization: Bearer $ADMIN" | jq '{status: .event.status, repriced}'
```

**Beklenen:** Olay önce `PROPOSED` (fiyata etkisi yok); onaydan sonra `APPROVED` ve `repriced` > 0. Olay penceresindeki tarihler için `GET /api/quote` artık daha yüksek toplam döner. Her gecenin `Availability.priceExplanation` alanında kırılım bulunur: `factors { season, weekday, event }`, `rawMultiplier`, `multiplier`, `clamped` (tavana takıldıysa `"ceiling"`). Onayı tekrar çağırmak fiyatı değiştirmez (idempotent); hiçbir gece `PRICE_CEILING_MULTIPLIER` (2.0) katını aşmaz. `POST /api/admin/events/<eventId>/rollback` fiyatları eski hâline döndürür.

## 6. Trip-planner: 3 şehir (~20 sn)

```bash
curl -s localhost:3000/api/ai/trip-plan -H "authorization: Bearer $GUEST" -H 'content-type: application/json' \
  -d '{"cities":["İstanbul","Kapadokya","İzmir"],"days":7,"guests":2}' | jq '{llmMode, order: .route.order, algorithm: .route.algorithm, total, narrative}'
```

**Beklenen:** Rota Held-Karp ile optimize edilir (`algorithm: "held-karp"`); her durak için bir konaklama ve tarih aralığı; `total` durakların quote toplamlarının toplamına eşittir. Anlatım yalnızca araç çıktısındaki sayıları kullanır ve "Rezervasyon yapılmadı" der — plan asla otomatik rezervasyon oluşturmaz.

---

## Sorun giderme

| Belirti                            | Çözüm                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `db` bağlantı hatası, parola reddi | v2 öncesi volume: `docker compose down -v` ve tekrar `up --build`                           |
| Mailbox boş                        | Worker loglarını kontrol edin: `docker compose logs worker`                                 |
| `llmMode: "fallback"`              | Canlı çağrı başarısız oldu; `GET /api/llm/status` içindeki `lastError` kodu nedeni gösterir |
| Seed yok                           | `DEMO_SEED` kapalı veya DB boş değil; `docker compose down -v` ile sıfırlayın               |
