# Demo akışı (3 dakika)

Ön koşul: `docker compose -f docker-compose.yml -f docker-compose.demo.yml up --build`, <http://localhost:3000> açık, seed yüklü (`.env` gerekmez). LLM anahtarı yoksa her şey **DEMO** modunda çalışır ve yanıtlarda `llmMode: "demo"` görünür; ödeme, payout, KYC ve e-Arşiv entegratörü mock'tur.

Demo hesapları (**yalnızca demo override'ında**, parola `Password123!`): `guest@booking.test`, `host@booking.test`, `admin@booking.test`, ek misafirler `elif@test.com`, `mehmet@test.com`. Hepsinin e-postası doğrulanmıştır.

> Akış arayüzden yapılır (`/cart`, `/checkout/cart`, `/pay/share/…`, `/account`, `/resolution`, `/admin/claims`); tekrarlanabilirlik için API karşılıkları da verilir — yanıtlar aynı servis katmanından gelir. v3 akışı (Smart Filter, 3DS, iki sekme yarışı, olay sinyali, trip-planner) sayfanın sonundaki ekte korunur.

API adımları için oturum (Bearer token, CSRF gerektirmez). Girişten sonraki 5 dakika "recent-auth" sayılır (mandate verme bunu ister):

```bash
login() { curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"Password123!\"}" | jq -r .accessToken; }
GUEST=$(login guest@booking.test); ELIF=$(login elif@test.com); ADMIN=$(login admin@booking.test)
```

Mock kart token'ı (tarayıcıdaki hosted fields bunu üretir; sunucuya kart numarası gitmez): `tok_mock_ok_424242_4242`.

---

## 1. Grup sepeti: iki oda, tümü-ya-hiç tutma (~40 sn)

`guest@booking.test` ile bir ilanda iki farklı oda tipini aynı tarihler için **Sepete ekle** → üst menüde **Sepetim** → `/cart` → **Tut**.

```bash
item() { curl -s localhost:3000/api/cart/items -H "authorization: Bearer $GUEST" -H 'content-type: application/json' \
  -d "{\"propertyId\":\"<propertyId>\",\"roomTypeId\":\"$1\",\"checkIn\":\"<YYYY-MM-DD>\",\"checkOut\":\"<YYYY-MM-DD>\",\"adults\":2}"; }
CART=$(item <roomTypeA> | jq -r .cart.id); item <roomTypeB> >/dev/null
curl -s -X POST localhost:3000/api/cart/$CART/hold -H "authorization: Bearer $GUEST" | jq '.cart | {status, holdExpiresAt}'
```

**Beklenen:** Her kalem teklif motoruyla fiyatlanır (vergi dahil toplam PDP ile aynı); tutma iki odayı **tek işlemde** alır ve sepet `HELD` olur. Kalemlerden biri doluysa hiçbiri tutulmaz (409, `details.itemId`) — ters sıralı 100 paralel sepette aşırı satış 0 olduğu `tests/integration/v4-cart.test.ts` ile kanıtlanır.

## 2. Bölünmüş ödeme: iki kişi, iki kart, tek onay (~40 sn)

`/checkout/cart` → **Bölünmüş ödeme** → eşit bölme, katılımcı `elif@test.com` → davet linki kopyalanır (e-posta `/dev/mailbox`'a da düşer). Organizatör **Payımı öde**; Elif linki açıp kendi payını öder.

```bash
curl -s localhost:3000/api/cart/$CART/split -H "authorization: Bearer $GUEST" -H 'content-type: application/json' \
  -d '{"mode":"equal","participants":[{"email":"elif@test.com"}]}' \
  | jq '.plan | {status, totalMinor, deadlineAt, shares: [.shares[] | {position, amountMinor, status, inviteUrl}]}'
```

Pay ödemesi (organizatör kendi payının linkiyle, Elif kendi linkiyle; `<token>` = `inviteUrl`'in son parçası):

```bash
curl -s localhost:3000/api/pay/share/<token> -H "authorization: Bearer $ELIF" -H 'content-type: application/json' \
  -d '{"cardToken":"tok_mock_ok_424242_4242"}' | jq
```

**Beklenen:** Paylar kuruşu kuruşuna toplamı verir (kalan kuruş organizatöre). İlk pay yalnız **yetkilendirilir**, sepet `HELD` kalır; son pay gelince tüm paylar capture edilir ve iki rezervasyon tek pivotta `CONFIRMED` olur. Başka bir e-postayla link açılırsa 403 `SHARE_EMAIL_MISMATCH`; süresi dolan link 410 `SHARE_LINK_EXPIRED`. Kimse ödemezse süre sonunda organizatöre yedek pay açılır veya tüm yetkiler bırakılır (`SPLIT_PAY_FALLBACK`).

## 3. Ajanla mandate'li rezervasyon (~40 sn)

Kullanıcı `/account` → ajan yetkileri bölümünden tutar ve süre sınırlı bir mandate verir (oturum 5 dakikadan eskiyse parola/passkey ile yeniden doğrulama penceresi açılır). Ajan bu mandate ile ACP checkout'u tamamlar:

```bash
MANDATE=$(curl -s localhost:3000/api/account/agent-mandates -H "authorization: Bearer $GUEST" -H 'content-type: application/json' \
  -d '{"maxAmountMinor":1000000,"currency":"TRY","expiresInMinutes":30}' | jq -r .mandate)
ACS=$(curl -s localhost:3000/api/agentic/checkout_sessions -H "authorization: Bearer $GUEST" -H 'content-type: application/json' \
  -H 'idempotency-key: demo-acs-1' -d '{"room_id":"<roomId>","check_in":"<YYYY-MM-DD>","check_out":"<YYYY-MM-DD>","guests":2}' | jq -r .id)
curl -s localhost:3000/api/agentic/checkout_sessions/$ACS/complete -H "authorization: Bearer $GUEST" -H 'content-type: application/json' \
  -H 'idempotency-key: demo-acs-1-pay' -d "{\"payment_data\":{\"token\":\"spt_mock_ok\",\"provider\":\"mock\"},\"mandate\":\"$MANDATE\"}" | jq '{status}'
```

**Beklenen:** `status: "completed"`, rezervasyon `CONFIRMED` — insan checkout'uyla aynı saga. Aynı çağrı mandate'siz 403 `MANDATE_REQUIRED`; limitin altında bir mandate ile 402 `MANDATE_AMOUNT_EXCEEDED`; aynı mandate başka bir oturumda 409 `MANDATE_REPLAYED`; `/account`'ta iptal edilince 403 `MANDATE_REVOKED`. MCP istemcisinde aynı akış `checkout_stay` aracıyladır; `npm run mcp:smoke` bunu anahtarsız doğrular.

## 4. Hasar talebi → depozito (~30 sn)

Hasar talebi konaklama başladıktan sonra açılabildiği için canlı demoda zaman ileri sarılamaz; bu adım süreç içi v4 senaryosuyla gösterilir (tesis depozito ayarı → girişten önce off-session provizyon → ev sahibinin `HOST_DAMAGE` talebi → admin kararı). Senaryo `DATABASE_URL`, `REDIS_URL` ve `DEMO_MODE=true` ortamı ister. Compose yığınında bu adresler worker konteynerinin giriş noktasında (`docker/entrypoint.sh`, `secrets-init` sırlarından) kurulur; `docker compose exec` giriş noktasını atladığından komut onun üzerinden çalıştırılır:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml exec worker \
  /bin/sh /usr/local/bin/entrypoint.sh \
  npx tsx --conditions=react-server scripts/demo-scenarios.ts --only=10
```

20 senaryonun tamamı aynı yolla: `… exec -e BASE_URL=http://app:3000 worker /bin/sh /usr/local/bin/entrypoint.sh npm run demo:scenarios` (Git Bash'te `MSYS_NO_PATHCONV=1` önekiyle).

Ardından `admin@booking.test` ile `/admin/claims` (talep, kanıt, SLA, karar) açılır; misafir tarafı `/resolution`'dadır.

**Beklenen:** 300 TL depozito `AUTHORIZED`; 450 TL talep onaylanır → 300 TL capture + 150 TL `uncollectedMinor` (deftere yazılmaz); `deposit-captured` jurnali ev sahibinin alacağına yazılır. Senaryo sonunda "mizan dengede, mutabakat farkı 0" satırı basılır.

## 5. Admin mutabakat raporu (~20 sn)

```bash
curl -s "localhost:3000/api/admin/reconciliation?date=$(date -u +%F)" -H "authorization: Bearer $ADMIN" \
  | jq '{date, checked, imbalancedEntries, differences: (.differences | length), ok}'
```

**Beklenen:** Bugünkü sepet, bölünmüş ödeme, ajan ve depozito tahsilatları için PSP kayıtları jurnalle karşılaştırılır: `imbalancedEntries: 0`, `differences: 0`, `ok: true`. Gece `ledger-reconcile` işi aynı raporu dün için çalıştırıp audit'e yazar; fark çıkarsa `ledger_imbalance_total{source="reconciliation"}` artar. Ev sahibi tarafı `/host/payouts`'ta (emanette / serbest / rezerv / ödenen) görünür; escrow check-in + 24 saat sonra serbest kalır.

---

---

## Demo senaryoları (P2-2)

`scripts/demo-scenarios.ts`, 1–7. senaryolarda **çalışan** yığına HTTP ile bağlanır ve aşağıdaki 7 iddiayı uçtan uca doğrular (8–14 için aşağıdaki "v4 senaryoları"). Her senaryo için bir `[PASS]`/`[FAIL]` satırı ve temel sayılar yazılır. Herhangi bir senaryo başarısız olursa çıkış kodu `1` olur.

```bash
npm run demo:reset                         # seed (senaryo 7'nin belgesiz ilanı dahil)
npm run demo:scenarios                     # 7 senaryonun hepsi
npm run demo:scenarios -- --only=4         # tek senaryo (birden çok: --only=2,5)
BASE_URL=http://localhost:3000 DAY_OFFSET=200 npm run demo:scenarios
```

- `BASE_URL`: varsayılanı `http://localhost:3000`.
- `DAY_OFFSET`: tarihlerin bugünden kaç gün ileride olacağını belirler (1–340). Verilmezse 150–339 arası rastgele seçilir. Böylece tekrar çalıştırmalar birbirinin envanterine çarpmaz.
- Betik, oluşturduğu HELD kayıtlarını iş bitince iptal eder.
- Hesaplar seed'dekilerdir (`guest@` ve `host@booking.test`). Her hesapla tek giriş yapılır; belirteç 4 dakikadan eskiyse yenilenir.
- Tutarlar tamsayı minor-unit (kuruş) olarak yazılır.

### Ön koşul: yükseltilmiş rate limit

Senaryo 1, tek kullanıcıdan 100 eşzamanlı `POST /api/bookings` gönderir. Varsayılan `RATE_LIMIT_BOOKING_MAX=30` (60 sn pencere, JWT `sub` başına) ile bu isteklerin bir kısmı 429 alır ve senaryo **FAIL** olur. Aşağıdaki gibi bir compose override kullanın (`docs/perf/k6-results.md`'deki k6 koşusuyla aynı yöntem):

```yaml
# docker-compose.demo.yml
services:
  app:
    environment:
      RATE_LIMIT_BOOKING_MAX: "100000" # senaryo 1 (100 paralel) + ödeme uçları
      RATE_LIMIT_SEARCH_MAX: "100000" # arama/teklif (senaryo 3, 6, 7)
      RATE_LIMIT_AGENTIC_MAX: "100000" # /api/mcp (senaryo 5)
      RATE_LIMIT_DEFAULT_MAX: "100000" # host uçları (senaryo 6, 7)
      RATE_LIMIT_AUTH_MAX: "100000"
```

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d
```

- Yalnızca senaryo 1'in geçmesi için `RATE_LIMIT_BOOKING_MAX` ≥ 110 yeterlidir. Diğer değerler, betiğin art arda çalıştırılabilmesi içindir.
- Hesap başı giriş limiti (`RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX=10`/dk) değiştirilmez; betik zaten az giriş yapar.
- 429 alınırsa betik sonunda bir uyarı satırı basar.

### Senaryolar

| #   | Senaryo                                  | Nasıl doğrulanır                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 3 birimlik odaya 100 paralel rezervasyon | Hedef: İstanbul Sultanahmet Pansiyon / "Standart Oda" (3 birim), aynı tarihler. Her istek **ayrı** `idempotency-key` taşır; aynı anahtar (kullanıcı, anahtar) aynı rezervasyonu döndürür ve yarışı ölçmez. Beklenen: tam **3 × 201 HELD** (3 farklı id) ve **97 × 409** (`SOLD_OUT` ön kontrol ya da `ROOM_BUSY` kilit). 429 ve 5xx olmamalı. Kazanan anahtarlardan biri tekrar gönderildiğinde aynı id dönmeli.                                                                             |
| 2   | İki sekmeden ödeme → tek tahsilat        | Terash Manzaralı odası için HELD kayıt oluşturulur. Ardından iki eşzamanlı `POST /pay` gönderilir (farklı `Idempotency-Key`, mock kart). Kaybeden sekme ya aynı `paymentId` ile `confirmed` ya da 409 `PAYMENT_IN_PROGRESS`/`ALREADY_PAID` almalı. Son durum `CONFIRMED`/`PAID` olmalı ve ödenen tutar rezervasyon toplamına eşit olmalı. Fraud skoru 3DS isterse tek bir `pay/confirm` (`123456`) yapılır.                                                                                  |
| 3   | İstanbul teklifi                         | `GET /api/quote` yanıtında `KDV` (VAT, fiyata dahil) ve `Konaklama vergisi` (ACCOMMODATION_TAX, hariç) kalemleri bulunmalı. Ayrıca `ara toplam = Σ gece` ve `toplam = ara toplam + Σ hariç kalemler` eşitlikleri tutmalı; tüm tutarlar tamsayı olmalı.                                                                                                                                                                                                                                       |
| 4   | Tokyo iade penceresi                     | Tokyo Shibuya Capsule+ / "Özel Kabin" tutulur, ödenir ve `DELETE /api/bookings/{id}` ile iptal edilir. **İade API'de hesaplanır** (`refund.hoursBeforeCheckIn`, tesis saati `Asia/Tokyo`). Betik, alan fonksiyonu `computeRefund`'ı yalnızca _kahin_ olarak içe aktarır. Tokyo saatiyle hesaplanan saat, istek öncesi/sonrası aralığında API sonucuyla eşleşmeli; `Europe/Istanbul` saatiyle hesaplanan değer ise ~6 saat sapmalı. İade yüzdesi, tutarı ve gerekçesi de kahinle aynı olmalı. |
| 5   | MCP → hold                               | `POST /api/mcp` kimliksiz çağrıldığında **401** ve JSON-RPC hata kodu `-32001` dönmeli. Guest belirteciyle `tools/call search_stays` (İstanbul) çağrılır; teklifli ilk uygun sonuç için `create_hold` → `HELD` beklenir. Önceki koşularda dolmuş 1 birimli odalar olabileceği için en çok 5 aday denenir.                                                                                                                                                                                    |
| 6   | Fiyat önerisi kabulü                     | Host, İstanbul Galata Loft Suites / "Loft" için öneri üretir (`POST /api/host/revenue/suggestions`, yarından itibaren 14 gece). Fiyatı değiştiren ilk öneri seçilir: aynı gecenin teklifi alınır, öneri kabul edilir, teklif yeniden alınır. Gece tutarı değişmeli ve fark `önerilen − mevcut` ile aynı yönde olmalı. Varsayılan planın `priceModifierBps` değeri 0 ise fark birebir eşit olmalı.                                                                                            |
| 7   | Belgesiz ilan                            | Seed, **Kadıköy Moda Sahil Dairesi (belge bekliyor)** ilanını ekler: `isActive=true`, `licenseStatus=PENDING`, belge no yok (v3#25 regresyonunun aynası). Bu ilan `GET /api/host/properties` içinde görünmeli; `/api/search`'te "Moda", "Kadıköy" (tarihli) ve "İstanbul" sorgularının hiçbirinde görünmemeli.                                                                                                                                                                               |

### v4 senaryoları (8–14, süreç içi)

Bu yedi senaryo HTTP yerine servisleri doğrudan çağırır (zaman ileri sarma ve PSP hata enjeksiyonu HTTP'den yapılamaz). `DATABASE_URL`, `REDIS_URL` ve `DEMO_MODE=true` gerekir; ödeme her zaman MockPsp, LLM yok (anahtarsız). Her senaryo kendi "Demo v4 …" ilanını kurar ve bitince pasife alır.

```bash
npm run demo:scenarios -- --suite=v4      # yalnız v4 (çalışan web sunucusu gerekmez)
```

| #   | Senaryo                                        | Beklenen                                                                                                                                                                                |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | (a1) Grup sepeti 3 oda + 3 kişi bölünmüş ödeme | Katılımcılar yalnız yetkiler, sepet HELD kalır; son pay → 3 pay CAPTURED, 3 rezervasyon CONFIRMED, sepet CHECKED_OUT                                                                    |
| 9   | (a2) 1 kişi ödemez                             | Süre sonu → pay EXPIRED, kalan tutar organizatörün yedek payına; geç ödeme 409 `SPLIT_DEADLINE_PASSED`; organizatör öder → onay                                                         |
| 10  | (b) Hasar talebi → admin kararı                | 300 TL depozito AUTHORIZED; 450 TL talep onaylanır → 300 TL capture (CAPTURED) + 150 TL yalnız kayıt; `deposit-captured` jurnali                                                        |
| 11  | (c) 7565 kaldırma                              | İlan pasif, ev sahibi yeniden yayın 409 `TAKEDOWN_ACTIVE`; SLA +25 s `ok`; ilan dışarıdan açılırsa `breached` → zorla pasif                                                             |
| 12  | (d) Ajan mandate'i                             | Mandate'li ACP ödemesi CONFIRMED; aşan mandate 402 `MANDATE_AMOUNT_EXCEEDED`; tekrar 409 `MANDATE_REPLAYED`                                                                             |
| 13  | (e) Devir capture hatası (v4#1)                | 502 `TRANSFER_PAYMENT_FAILED`, sahiplik/ödeme satıcıda, yetki void, payout 0; yeniden listeleme sağlıklı PSP ile COMPLETED                                                              |
| 14  | (g) Cüzdan: cashback → kredi ile ödeme → iptal | Konaklama tamamlanır → cashback kredisi ISSUED; ikinci rezervasyon kart + kredi ile ödenir; iptalde karta ve krediye oransal iade; her adımda `guest_credit` = Σ lot kalanı + Σ rezerve |

(f) Her v4 senaryosunun sonunda: mizan dengede, dokunulan günlerde dengesiz jurnal 0 ve senaryonun ödeme/depozito/devir öznelerinde mutabakat farkı 0 (özet tablonun "Defter" sütunu).

### v5 senaryoları (15–20, süreç içi)

v4 ile aynı desen (`scripts/demo/v5-scenarios.ts`): servisler doğrudan çağrılır, zaman ileri sarılır ve PSP/saga hataları süreç içinde enjekte edilir. Her senaryo kendi "Demo v5 …" ilanını/kullanıcılarını kurar, bitince ilanı pasife alır ve sonunda aynı defter denetimini (f) yapar. Ödeme MockPsp, payout MockPayoutProvider, KYC mock kimlik sağlayıcısıdır; LLM ve ağ çağrısı yoktur.

```bash
npm run demo:scenarios -- --suite=v5      # yalnız v5 (çalışan web sunucusu gerekmez)
npm run demo:scenarios -- --only=15,19    # tek tek
```

| #   | Senaryo                                  | Beklenen                                                                                                                                                                                                                        |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15  | RNPL zamanında + başarısız tahsilat      | İki RNPL rezervasyonu: bugün 0, CONFIRMED, ödeme PENDING, jurnal yok. A vadede tahsil edilir (PAID + `booking-captured`, tekrar no-op); B reddedilir → RETRYING + bildirim → ek süre sonunda iptal, ödeme VOIDED, envanter geri |
| 16  | Sepet onay hatası → telafi               | 2 odalı sepet ödemesi alınır, onay adımında enjekte hata → telafi iadesi; sepet ödemesi REFUNDED, jurnalde capture + iade (Σ `psp_clearing` = 0), tutmalar bırakılır, mutabakat temiz                                           |
| 17  | KYC'siz devir satıcısı                   | Devir COMPLETED → payout PENDING; hesap yok → `NO_ACCOUNT`, hesap var ama kimlik doğrulanmamış → `IDENTITY_UNVERIFIED` (ödeme yok, bakiye değişmez); mock KYC VERIFIED → payout PAID + `payout-released` jurnali                |
| 18  | Destek ajanı insana devir                | iade/para talebi → `MONEY_REQUEST`, "beni bir müşteri temsilcisine bağlayın" → `USER_REQUEST` talebi; LLM'siz şablon yanıt, tek araç `open_support_ticket`; ödeme/rezervasyon değişmez, iade 0                                  |
| 19  | Üçüncü taraf mandate doğrulaması + keşif | UCP profili → `jwks_uri`; OpenAPI'de keşif/ajan yolları var; `scripts/verify-mandate.ts` doğrulayıcısı geçerli mandate'i kabul eder, kurcalanmış imza / yanlış `aud` / HS256 sahte belirteci reddeder                           |
| 20  | TR vs AB indirim referansı               | Aynı fiyat geçmişi (−25 gün düşük, −15 gün yüksek, bugün orta): TR (10 gün) referansı bugünkü fiyat → "önceki fiyat" gösterilmez; AB (30 gün, Omnibus) referansı 25 gün önceki en düşük fiyat                                   |

Web tarafındaki karşılıkları: RNPL seçimi ve planı `/booking/<id>` sayfasında ("bugün 0 ₺, <tarih>'te X ₺" + iptal zaman çizelgesi), destek sohbeti `/support` ("İnsana bağlan" düğmesi), devredilen talepler `/admin/support`, JWKS/OpenAPI/SBOM bağlantıları `/trust`.

### Beklenen çıktı biçimi

Burada sayılar gösterilmez; gerçek değerler seed fiyatlarına, sezona ve `DAY_OFFSET`'e bağlıdır. Biçim şöyledir:

```text
Demo senaryoları — BASE_URL=http://localhost:3000, DAY_OFFSET=<n>, çalıştırma=<id>
[PASS] Senaryo 1 — 100 paralel rezervasyon, 3 birim → tam 3 HELD (<ms> ms)
       İstanbul Sultanahmet Pansiyon / Standart Oda (birim=3) …: 100 istek → HELD=3, 409 SOLD_OUT=<a>, 409 ROOM_BUSY=<b>; idempotency tekrarı aynı kaydı döndü=evet
[PASS] Senaryo 2 — İki sekmeden ödeme → tek tahsilat (<ms> ms)
       …
Sonuç: 7/7 senaryo geçti.
```

- `SOLD_OUT` ile `ROOM_BUSY` arasındaki dağılım zamanlamaya bağlıdır; yalnızca toplamlarının 97 olması beklenir.

### Bilinen sınırlar

- **Senaryo 4:** iade penceresi yalnızca API üzerinden okunur. `computeRefund` karşılaştırma içindir ve API sonucunu üretmez.
  - Tarih uzak gelecekte olduğundan politika genellikle aynı kademede kalır (STRICT ise cayma süresi, yani `grace_period`).
  - Tokyo ve İstanbul arasındaki fark, kademe değişimiyle değil, `hoursBeforeCheckIn` değerindeki 6 saatlik farkla gösterilir.
- **Senaryo 6:** öneriler yalnızca önümüzdeki 14 gece için üretilir, bu yüzden `DAY_OFFSET` kullanılmaz. Kabul edilen öneri o gecenin fiyatını kalıcı olarak değiştirir; sıfırlamak için `npm run demo:reset` gerekir.
- **Senaryo 7:** `GET /api/properties/{id}` yalnızca `isActive` alanına bakar; bu nedenle belgesiz ilan doğrudan id ile hâlâ okunabilir. Senaryo yalnızca aramadaki gizlenmeyi doğrular.
- **Docker Desktop (Windows/macOS):** host'tan `localhost:3000`'e 100 eşzamanlı bağlantıda port yönlendiricisi bazı soketleri `ECONNRESET` ile kesebilir (sunucu isteği yine işler). Betik yalnızca tekrarı güvenli istekleri (GET veya `idempotency-key` taşıyan) en çok 2 kez yeniden dener ve bunu sonda bir `Not:` satırıyla bildirir. Alternatif: betiği compose ağı içinden çalıştırın: `docker compose run --rm --no-deps -e BASE_URL=http://app:3000 migrate npx tsx scripts/demo-scenarios.ts`.
- **Son doğrulama (2026-09-25):** hem host'tan hem compose ağından **7/7 PASS**; senaryo 1: 100 istek → 3 HELD + 97 × 409 `SOLD_OUT`, idempotency tekrarı aynı kaydı döndürdü.
- **Ödeme:** tekrarlanan koşularda guest hesabının ödeme hızı fraud skorunu yükseltip 3DS isteyebilir. Betik bu durumda mock 3DS koduyla onaylar.

---

## Sorun giderme

| Belirti                            | Çözüm                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `db` bağlantı hatası, parola reddi | v2 öncesi volume: `docker compose down -v` ve tekrar `up --build`                           |
| Mailbox boş                        | Worker loglarını kontrol edin: `docker compose logs worker`                                 |
| `llmMode: "fallback"`              | Canlı çağrı başarısız oldu; `GET /api/llm/status` içindeki `lastError` kodu nedeni gösterir |
| Seed yok                           | `DEMO_SEED` kapalı veya DB boş değil; `docker compose down -v` ile sıfırlayın               |

---

## Ek: v3 demo adımları

Aşağıdaki adımlar v3 akışıdır ve değişmeden çalışır (oturum için yukarıdaki `login` fonksiyonu; ayrıca `HOST=$(login host@booking.test)`).

### A1. Smart Filter ile arama (~25 sn)

```bash
curl -s localhost:3000/api/search/smart -H 'content-type: application/json' \
  -d '{"text":"Kadıköy'\''de denize yakın, kahvaltılı, 2 kişi, gecesi 3000 TL altı"}' | jq '{llmMode, filters}'
```

**Beklenen:** `filters` içinde `city: "İstanbul"`, `query: "Kadıköy"`, `guests: 2`, `maxPrice: 3000`, `amenities: ["Kahvaltı Dahil", "Deniz Manzarası"]` ve bu filtrelerle deterministik arama sonuçları. Bilinmeyen bir olanak ("jakuzili saray") filtreye girmez. `/search` sayfasında aynı filtreler elle de verilebilir; sonuçların sıralama gerekçesi `/ranking` sayfasında açıklanır.

### A2. PDP: atıflı yorum özeti ve fiyat kırılımı (~30 sn)

Arama sonucundan bir mülke girin (`/property/<id>`).

```bash
curl -s localhost:3000/api/properties/<propertyId>/reviews/summary | jq '{llmMode, summary, pros, cons, citations}'
```

**Beklenen:**

- Özet ve artı/eksiler gerçek yorum cümlelerinden; her `[r:<reviewId>]` atfı o mülkün gerçek bir yorumuna işaret eder (`citations`). Yeni yorum eklenince cache sürümü değiştiği için özet yenilenir.
- PDP'deki rezervasyon kutusu tarih seçilince `GET /api/quote` sonucunu gösterir: gece gece fiyat, "Konaklama vergisi" kalemi (%1) ve vergi dahil toplam. Bu toplam checkout ve tahsilatla birebir aynıdır.

### A3. Checkout → mock 3DS → onay e-postası (~45 sn)

1. `guest@booking.test` ile giriş yapın, PDP'de tarih seçip **Rezervasyon yap** → `/checkout`.
2. Onaylayın: `POST /api/bookings` rezervasyonu **HELD** olarak oluşturur (`holdExpiresAt` = şimdi + 15 dk) ve `/booking/<id>` sayfasına yönlendirir.
3. Kart: `4000 0000 0000 3220`, gelecekte bir son kullanma tarihi, herhangi bir CVC. Kart tarayıcıda token'a çevrilir; sunucuya numara gitmez.
4. `POST /api/bookings/<id>/pay` → `requires_action` (3DS). Doğrulama kodu: **`123456`** → `POST /api/bookings/<id>/pay/confirm`.
5. <http://localhost:3000/dev/mailbox> sayfasını açın.

**Beklenen:** Rezervasyon **CONFIRMED**, ödeme capture edildi. Worker outbox mesajını işledikten sonra (birkaç saniye) mailbox'ta Türkçe "Rezervasyonunuz onaylandı" e-postası görünür. Aynı olay iki kez işlense bile tek e-posta vardır. `4000 0000 0000 0002` ile ödeme reddedilir, rezervasyon HELD kalır ve süre dolunca **EXPIRED** olur.

### A4. İki sekmeden aynı son odaya yarış (~20 sn)

Tek birimli bir oda ve aynı tarihler için iki tarayıcı sekmesinde checkout'u açın ve ikisinde de neredeyse aynı anda onaylayın. API ile:

```bash
BODY='{"propertyId":"<propertyId>","roomId":"<roomId>","checkIn":"<YYYY-MM-DD>","checkOut":"<YYYY-MM-DD>","guestCount":2}'
for i in 1 2; do curl -s localhost:3000/api/bookings -H "authorization: Bearer $GUEST" \
  -H 'content-type: application/json' -H "idempotency-key: race-$i" -d "$BODY" & done; wait
```

**Beklenen:** Bir istek `201` + `HELD`, diğeri `409` ve `code: "SOLD_OUT"` (kilit o an doluysa `ROOM_BUSY`). Aynı garanti 100 paralel istekle entegrasyon testinde kanıtlanır: 1 başarı / 99 `SOLD_OUT`, SQL ile overbooking = 0.

### A5. Host takvimi + olay sinyali onayı → fiyat değişimi ve açıklaması (~40 sn)

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

### A6. Trip-planner: 3 şehir (~20 sn)

```bash
curl -s localhost:3000/api/ai/trip-plan -H "authorization: Bearer $GUEST" -H 'content-type: application/json' \
  -d '{"cities":["İstanbul","Kapadokya","İzmir"],"days":7,"guests":2}' | jq '{llmMode, order: .route.order, algorithm: .route.algorithm, total, narrative}'
```

**Beklenen:** Rota Held-Karp ile optimize edilir (`algorithm: "held-karp"`); her durak için bir konaklama ve tarih aralığı; `total` durakların quote toplamlarının toplamına eşittir. Anlatım yalnızca araç çıktısındaki sayıları kullanır ve "Rezervasyon yapılmadı" der — plan asla otomatik rezervasyon oluşturmaz.
