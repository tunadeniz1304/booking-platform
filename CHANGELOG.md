# Changelog

Bu dosyadaki tüm önemli değişiklikler burada belgelenir. Biçim [Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) esaslıdır ve proje [Semantic Versioning](https://semver.org/lang/tr/) kullanır.

## [Unreleased]

### Added

- **P1-1 (ADR 0035)** Mandate nonce'u Redis'e ek olarak kalıcı `AgentMandateUse` tablosunda (migration `20261002100000_agent_mandate_use`): Redis kaybında aynı mandate ikinci checkout'a bağlanamaz. Opsiyonel RFC 9421 HTTP Message Signatures doğrulaması (`AGENT_HTTP_SIGNATURE_KEYS`; `/api/ucp/*`, `/api/agentic/*`). UCP profili `signing.jwks_uri` + `mandate_alg` + imza bilgisini ilan eder. `scripts/verify-mandate.ts` (`npm run mandate:verify`): yalnız JWKS URL'si ile harici mandate doğrulaması. SD-JWT (`@sd-jwt/core`, Apache-2.0) değerlendirildi, gerekçesiyle ertelendi.
- **P1-2** OpenAPI 3.1 kapsamı sepet, devir, ACP/UCP ajan ticareti, mandate, keşif belgeleri (`/.well-known/ucp`, `/.well-known/jwks.json`), ilan/yorum, hesap ve ops uçlarına genişletildi; tüm 2xx yanıtlar için şema (`src/lib/http/openapi-schemas.ts`). `tests/helpers/openapi-assert.ts` integration testlerinde gerçek yanıt gövdelerini şemaya karşı doğrular (≥ 20 uç işlemi). Yeni geliştirme bağımlılıkları: `ajv` 8 ve `ajv-formats` 3 (MIT). `ERROR_CATALOG`'a `HTTP_SIGNATURE_*` kodları eklendi.

### Notes

- `zod-to-json-schema` (ISC) bakımı Kasım 2025'te bırakıldı; proje zod 3.25'te kaldığı sürece çalışır ve çıktısı sözleşme testleriyle sabitlenmiştir. zod 4'e geçişte yerleşik `z.toJSONSchema()` kullanılacak ve bu bağımlılık kaldırılacak (bu sürümde geçiş yapılmadı).

### Removed

- **P0-3 (ADR 0033)** Eski `LedgerEntry` defteri ve `LedgerKind` enum'u (migration `20261001100000_drop_legacy_ledger`): dual-write kaldırıldı, tek para kaydı çift girişli jurnal; `listBookingLedger` v3 görünümünü yalnız jurnalden türetir.
- **P0-3 (kırıcı API değişikliği)** Yanıtlardaki kullanımdan kalkmış ondalık para alanları: `totalPrice` (rezervasyon, `BookingDTO`, ev sahibi listesi), `amount`/`refundedAmount` (ödeme, admin iade kuyruğu), `basePrice` (arama, ilan, favoriler, ev sahibi ilanları, MCP `search_stays`), `priceModifier` (oda), arama kartı `totalPrice` (yerine `quote.total`), devir `askPrice`/`originalPrice` (yerine `askPriceMinor`/`originalPriceMinor`). İstemciler `*Minor` + `currency` okur. gRPC: `ReserveRoomResponse.total_price` → `total_price_minor`, `ChargeResponse.charged_amount` ve `ChargeRequest.amount` kaldırıldı (alan numaraları `reserved`). İstek gövdelerindeki ondalık girişler (ilan formu `basePrice`) değişmedi.
- **P0-3** Ölü minor-unit backfill aracı: `src/lib/money/backfill.ts`, `scripts/money-backfill.ts`, `npm run money:backfill` ve `tests/integration/v4-money-backfill.test.ts`. Gerekçe: ADR 0019 contract'ı v4'te tamamlandı, Decimal kolon kalmadı; `regression: v4#15` korunur ve şemada Decimal para kolonu olmadığını denetler (v4 regresyonlarını koruma kuralının tek bilinçli istisnası).

### Fixed

- **P0-7** Arama kartı toplamı artık ev sahibi promosyonlarını (erken rezervasyon, son dakika, uzun konaklama; kupon hariç) teklif motoruyla aynı biçimde uygular; promosyon eklenince/değişince/silinince etkilenen ilanların teklif önbelleği geçersiz kılınır. `tests/integration/v5-price-invariant.test.ts`: fast-check 200 örnekte arama kartı = `/api/quote` = PSP capture (+ kredi) = tahsilat jurnali.

### Changed

- **P0-4 (ADR 0027)** `src/lib/payment/payment-service.ts` sorumluluklara bölündü (`payment-core`, `confirm`, `pay`, `webhook-handler`, `late-success`, `refund`); dosya yalnız yeniden-export eder, davranış değişmedi.

### Dependencies

- `madge` (MIT) devDependency: `npm run deps:circular` ödeme modüllerinde içe aktarma döngüsü olmadığını doğrular (ADR 0027); `.madgerc` yalnız-tip içe aktarmaları yok sayar.
- `zod-to-json-schema` (ISC; zaten `@modelcontextprotocol/sdk` üzerinden kuruluydu) doğrudan bağımlılık oldu: `/api/openapi.json` gövde/sorgu şemaları route'ların zod şemalarından üretilir (v5#16).

## [4.0.0] - 2026-09-27

v3.0.0'dan sonra 181 commit (79 feat · 34 fix · 31 test · 30 docs · 5 chore · 2 refactor), 23 yeni migration. v3'ün bilinen 20 hatası kapatıldı ve her biri `regression: v4#N` etiketli testle korunuyor (28 test dosyası, #1–#20 hepsi). Para minor-unit `BigInt`'e taşındı, çift girişli defter + günlük mutabakat eklendi; grup sepeti, bölünmüş ödeme, escrow/payout, hasar depozitosu, cüzdan, promosyon, KYC, ajan mandate'leri, PWA ve uyum otomasyonu geldi. Ayrıntı, ölçümler ve dürüstlük notu: `docs/FINAL_REPORT.md`.

### Security

- **v4#1** Devir ödemesi artık `booking_transfer` sagasıyla: alıcı capture'ı başarılı olmadan sahiplik, payout ve defter yazılmaz; `CAPTURE_PENDING`/`FAILED` durumları, telafi (iade/void) ve takılan devirler için `transfer-sweep` işi (`TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS`).
- **v4#2** Hassas işlemler (passkey ekleme/silme, hesap silme, uzaktan çıkış, mandate verme) `auth_time` ile son 5 dk içinde yeniden doğrulama ister (403 `REAUTH_REQUIRED`); yeni passkey'e e-posta bildirimi + 24 saat step-up soğuması; step-up belirteci `bookingId + amountMinor + nonce`'a bağlı ve tek kullanımlık (GETDEL) (ADR 0024).
- **v4#3** Tüm LLM yolları (mesaj taslağı, gelir önerileri, moderasyon, arama embedding'i dahil) kullanıcı başına bütçeye tabi; süreç çapı eşzamanlılık sınırı `LLM_MAX_CONCURRENCY`; embedding'ler redakte; taslakta misafir adı takma adla; `openai` importu yalnız `src/lib/llm/client.ts`.
- **v4#4** Anonim rate-limit anahtarı soket IP'si + IPv6 /64 kovası; IP yoksa paylaşılan `anon` kovası (UA yalnız ikincil); `ai` kategorisi Redis düşünce fail-closed.
- **v4#5** `docker-compose.yml` güvenli varsayılanlarla (DEMO kapalı, `COOKIE_SECURE=true`); demo ayarları `docker-compose.demo.yml` override'ında; JWT sırrı gücü test dışında her ortamda denetlenir; dev mailbox yalnız kullanıcının kendi mesajlarını gösterir; kalıcı DEMO şeridi.
- **v4#6** Rezervasyon, ödeme, yorum, devir, ajan checkout ve MCP `create_hold`/`checkout_stay` doğrulanmış e-posta ister (403 `EMAIL_NOT_VERIFIED`).
- **v4#7** İptal, ödemeyle aynı `pay:<bookingId>` kilidi + satır kilidi altında; `REFUND_FAILED` BullMQ `refund-retry` kuyruğuyla üstel geri çekilmeli yeniden denenir; admin iade kuyruğu `/api/admin/refunds`.
- **v4#8** Geç gelen başarılı webhook önce uzlaştırılır (envanter uygunsa yeniden tut + onayla, değilse iade); `payment_late_success_total{outcome}` + audit.
- **v4#9** Rezervasyon idempotency anahtarı istek gövdesi karmasına bağlı; farklı gövde 409 `IDEMPOTENCY_KEY_REUSED`.
- **v4#10** Ajan checkout oturumu her okumada rezervasyon durumuyla uzlaştırılır; süresi dolmuş tutma oturumu kilitlemez.
- **v4#11** SSRF: NAT64, 6to4, Teredo, gömülü IPv4, TEST-NET ve belgeleme aralıkları reddedilir; iCal toplam süre sınırı (`ICAL_FETCH_DEADLINE_MS`) ve sınırlı eşzamanlı yoklama.
- **v4#12** Hesap kilitleme yerine (istemci, e-posta) çifti için kademeli gecikme + HMAC imzalı proof-of-work; giriş/sıfırlamada sabit süreli yanıt; sıfırlama e-posta başına sınırlı; outbox'ta yalnız token hash'i + AES-GCM ile mühürlü link.
- **v4#13** 3DS/ödeme denemesi rezervasyon başına sınırlı (`PAYMENT_MAX_ATTEMPTS`); BIN PSP token'ından, cihaz kimliği sunucu imzalı `did` çerezinden.
- **v4#14** Rezervasyon önbelleği durum olaylarında temizlenir; ödeme durumu önbelleğe alınmaz.
- **v4#15** `Decimal(10,2)` para kolonları minor-unit `BigInt`'e taşındı (KWD/BHD 3 hane, JPY 0 hane; ADR 0019).
- **v4#16** Webhook yalnız aktif sağlayıcının imzasıyla kabul edilir; başka sağlayıcının imzası veya imzasız istek 401 `WRONG_PROVIDER_SIGNATURE`.
- **v4#17** Son aktif ADMIN düşürülemez (satır kilidiyle sayım, 409 `LAST_ADMIN`).
- **v4#18** Canlı görüntülenme sayısı imzalı oturum/cihaz başına HyperLogLog ile; çerez basımı istemci başına sınırlı.
- **v4#19** Kanal ARI fiyatları zod ile ondalık string veya `priceMinor` tamsayı; float/üs reddedilir.
- **v4#20** `.gitignore` `.env.*` kalıbını kapsar (`!.env.example`).
- Oturum listesi ve uzaktan çıkış (`/account/sessions`), yeni cihaz girişinde e-posta uyarısı; iptal edilen oturum ailesinin erişim token'ı da reddedilir (`sid` claim).
- Webhook/KYC/DSA itiraz/bölünmüş ödeme linkleri HMAC imzalı; kanıt yüklemeleri magic-byte kontrolü + yeniden kodlama, EXIF/GPS temizliği.

### Added

- **P0-2 — Minor-unit para (ADR 0019):** ISO 4217 üs tablosu, tek half-up yuvarlama, expand/contract migration'ları + idempotent `npm run money:backfill`; KWD/JPY round-trip property testleri.
- **P0-3 — Çift girişli defter (ADR 0020):** `LedgerAccount`/`JournalEntry`/`JournalLine`, DB tetiğiyle Σborç=Σalacak ve append-only; capture, iade, escrow serbest bırakma, payout, devir, depozito, kredi ve kaybedilen itiraz şablonları; `GET /api/admin/reconciliation`, günlük `ledger-reconcile` işi.
- **P0-4 — Hassas işlem güvenliği:** recent-auth, yeniden doğrulama penceresi, `UserSession` modeli, oturum yönetimi arayüzü.
- **P0-5 — Veri yaşam döngüsü:** `data-retention` işi (AuditLog, PaymentEvent, Outbox, InventoryPriceHistory, MessageRiskFlag, AuthToken; yasal saklama önekleri hariç), `npm run data:retention`; migration'lar temiz DB ve v3 dump'ı üzerinde doğrulandı.
- **P0-6 — Gözlemlenebilirlik:** iş metrikleri (`ledger_imbalance_total`, `refund_retry_total`, `payment_late_success_total`, `llm_tokens_total{route}`, `takedown_sla_breach_total`, `confirm_retry_total`, `saga_compensation_retry_total` …), 16 Prometheus alarm kuralı (`docker/observability/alerts.yml`), `docs/observability/SLO.md`, Grafana SLO paneli.
- **P1-1 — Grup sepeti:** `Cart`/`CartItem`/`CartPayment`, sıralı Redlock + tek SERIALIZABLE tx'te tümü-ya-hiç tutma, tek PSP tahsilatı, `/api/cart/*`, `/cart` ve `/checkout/cart`.
- **P1-2 — Bölünmüş ödeme:** `SplitPlan`/`PaymentShare`, HMAC davet linki, `split_payment` sagası, süre sonunda organizatör yedeği veya tam iade, sepet ve pay için geç webhook uzlaştırması.
- **P1-3 — Esnek tarih fiyat takvimi:** `MinPriceByDate` materyalize tablo (artımlı + gece işi), `/api/properties/[id]/calendar-prices`, aramada `flexDays` (±3 gün), PDP ay ızgarası.
- **P1-4 — Payout/escrow/komisyon (ADR 0021):** `HostAccount`, `HostPayout`, `PAYOUT_RELEASE_HOURS` sonrası escrow serbest bırakma, platform komisyonu, rezerv, Stripe Connect adaptörü + mock; `npm run dac7:export`.
- **P1-5 — Hasar depozitosu ve çözüm merkezi:** off-session ön provizyon, misafir/ev sahibi talepleri, kanıt yükleme, SLA eskalasyonu, admin kararı, `charge.dispute.*` senkronu.
- **P1-6 — KYC ve güven-emniyet:** `IdentityVerification` (Stripe Identity adaptörü + deterministik mock), mesaj dolandırıcılık taraması (LLM yalnız sinyal), parti riski puanı ve ev sahibi uyarısı.
- **P1-7 — Sadakat ve cüzdan:** seviyeler, cashback kredisi (`guest_credit`), krediyle kısmi ödeme, simetrik iade, süre dolumu işi.
- **P1-8 — Promosyon motoru + Omnibus:** early-bird, last-minute, uzun konaklama, mobil fiyat, kupon; öncelik/birleşme kuralları, indirim tavanı, "son 30 günün en düşük fiyatı" (`InventoryPriceHistory` tetiği).
- **P1-9 — AI yorum öne çıkanları ve karşılaştırma:** k-means kümeleme + birebir alıntı guard'ı, `/api/compare` (toplamlar teklif motoruyla aynı), `/compare` sayfası.
- **P1-10 — Görsel zekâ (ADR 0022):** `PropertyPhoto` kalite skoru, pHash duplikat tespiti, opsiyonel CLIP embedding, aramada RRF'nin 3. listesi "bu fotoğraftaki gibi".
- **P1-11 — Ajan ticareti v2 (ADR 0023):** Stripe Shared Payment Token yolu, UCP `/.well-known/ucp` + lodging checkout, AP2 tarzı imzalı intent mandate (tutar/süre/ilan/tekrar kontrolü, iptal), MCP `checkout_stay`.
- **P1-12 — PWA + Web Push:** manifest, service worker, çevrimdışı seyahat kartı + imzalı QR, VAPID push (fiyat düşüşü, check-in hatırlatması).
- **P1-13 — Uyum otomasyonu:** 7565 kaldırma talebi + 24 s SLA, DSA bildirim/karar/itiraz (md.16/17/20) + şeffaflık raporu, UBL-TR 1.2 XML + mock entegratör, konaklama vergisi oran tarihçesi, doğrulanmış erişilebilirlik özellikleri + arama filtresi.
- **P2-1 — Arayüz:** sepet, bölünmüş ödeme, fiyat takvimi, karşılaştırma, çözüm merkezi, cüzdan, payout ekranları; karanlık tema; WCAG 2.2 (skip link, odak görünürlüğü, hedef boyutu); 32 i18n ad alanı.
- **P2-2 — Demo:** `demo:scenarios` v4 senaryoları 8–14 (her birinde mizan + mutabakat kontrolü), v4 seed (promosyon, fotoğraf, erişilebilirlik, host hesabı), `npm run import:insideairbnb` (CC BY 4.0, opsiyonel OSM).
- **P2-3 — Yük ve kaos:** k6 `cart-spike`, `split-payment-race`, `webhook-storm`; MockPsp gecikme/hata enjeksiyonu; `scripts/load-assert.ts`; sonuçlar `docs/perf/p2-3-load-chaos.md`.
- LLM sözleşmesi: `LLM_MAX_CONCURRENCY`, `LLM_VISION_MODEL`; `/api/llm/status` alanları.
- Dokümantasyon: ADR 0019–0024, ARCHITECTURE §13–§18, COMPLIANCE, SECURITY v4 tehdit modeli, api-contract v4 uçları, v4 ekran görüntüleri, README standart şablonla yeniden düzenlendi.

### Changed

- Para alanları `*Minor` `BigInt` kolonlarında; eski ondalık kolonlar kaldırıldı. API yanıtlarında ondalık tutarlar artık birimin üssüne göre sabit haneli **string** (`"1500.00"`; önceden `"1500"`), yanlarında `*Minor` sayı alanları.
- `GET /api/bookings` imleç tabanlı sayfalı (`?limit&cursor`, `X-Next-Cursor` + `Link rel=next`); gövde dizi olarak kalır.
- Varsayılan compose güvenli; demo için `docker compose -f docker-compose.yml -f docker-compose.demo.yml up`. Demo'da rate-limit çarpanı `RATE_LIMIT_DEMO_RELAX_MULTIPLIER` (üretimde yok sayılır).
- Rezervasyon, ödeme, yorum ve devir için e-posta doğrulaması zorunlu.
- Hesap kilidi kaldırıldı; aşırı giriş denemesi 429 `LOGIN_DELAYED` / `POW_REQUIRED` döner (giriş sayfası PoW'u otomatik çözer).
- Sepet ödemesinde onay serileştirme çakışmasıyla tükenirse iade yerine `202 pending_confirmation` + `confirm-retry` kuyruğu; saga telafisi başarısızsa `saga-compensation-retry`.
- PSP hataları 502 `PAYMENT_PROVIDER_ERROR` (`Retry-After`), geçersiz kart token'ı 422 `INVALID_CARD_TOKEN`; ödeme yeniden denenebilir kalır.
- Kilit bekleme bütçesi yapılandırılabilir (`LOCK_WAIT_BUDGET_MS`); bekleme tükenip oda doluysa 409 `SOLD_OUT`, değilse `ROOM_BUSY`.
- `completeCheckoutSession` ve ACP complete mandate ister (`AGENT_MANDATE_REQUIRED`, varsayılan açık).
- Worker'a v4 işleri: refund-retry, transfer-sweep, ledger-reconcile, escrow-release, wallet-sweep, price-calendar, push, compliance/SLA, resolution, confirm-retry, saga-compensation-retry, data-retention.

### Deprecated

- API yanıtlarındaki eski ondalık para alanları (`totalPrice`, `amount`, `basePrice` vb.) bir sürüm boyunca korunur; yeni istemciler `*Minor` alanlarını kullanmalı (ADR 0019).
- Eski `LedgerEntry` yazımı çift girişli jurnalle birlikte (dual-write) sürüyor; okuyucular `listBookingLedger` kullanır, `LedgerEntry` ileride kaldırılacak.

### Fixed

- **fix-sweep-1:** Redlock belirsiz `SET NX` sonrası kendi token'ını edinilmiş sayar; kilit bütçesi config'e taşındı; `addCartItem` READ COMMITTED + sepet satır kilidi (sahte serileştirme çakışmaları); e2e uyarı seçicisi Next route announcer'ı dışlar.
- **fix-sweep-2:** talep iadesi sonrası iptal `refundedAmountMinor`'ı eziyordu (artık kümülatif, iade kalan tutardan); PSP hataları 500 yerine 502; kaybedilen chargeback jurnali (`platform_loss`) ve ev sahibinden mahsup; bölünmüş ödemeli rezervasyonda talep iadesi ve depozito; Stripe depozitosu için müşteri + `setup_future_usage=off_session`.
- **fix-sweep-3:** yük altında bölünmüş/sepet onayında serileştirme tükenmesi ödenmiş planları iade ediyordu (artık ertelenen onay + yeniden deneme); başarısız saga telafileri yeniden denenir; pay sahiplenme çakışmasında provizyon void edilir; geç başarı iadesi eşzamanlı tekrar teslimde tek kez sayılır.
- Integration testlerinde Docker port yönlendiricisi kaynaklı bağlantı kopmaları TCP yeniden bağlanma vekiliyle giderildi; paylaşılan DB'ye bağlı sıra-bağımlı testler kendi fixture'larına kapsandı.
- `demo:scenarios` compose worker'ında entrypoint üzerinden çalışır (ortam değişkenleri boş kalıyordu).

### Known limitations

- CI (`.github/workflows/ci.yml`) v4 kapısına genişletilmedi ve GitHub'da yeşil doğrulanmadı (kullanıcı kararıyla ertelendi); kapı yerelde yeşil.
- Canlı LLM modu bu sürümde yalnız anahtarsız DEMO modunda doğrulandı; canlı mod kullanıcı ortamında doğrulanmalı.
- Stripe SPT, Stripe Connect, Stripe Identity ve Stripe depozito yolları yalnız sahte (fake) sunucuyla test edildi; varsayılan PSP MockPsp.
- Sepet ani yükünde tutma p95 hedefi (2 s) aşılıyor (100 VU: 10,07 s; sıcak nokta); para/değişmez ihlali yok.
- Mandate'ler HS256 ile yalnız platform tarafından doğrulanır; sepet/bölünmüş ödemede kredi ve kupon yok; parti riski yalnız uyarı (onay adımı yok).
- Tam liste: `docs/FINAL_REPORT.md` ve `docs/ARCHITECTURE.md` §18.

## [3.0.0] - 2026-09-26

v2'nin bilinen 22 hatası (`regression: v3#N` etiketli testlerle) kapatıldı; envanter, vergi/FX, ödeme sagası, hibrit arama + LTR, mesajlaşma/moderasyon, ajan rezervasyonu, gelir paneli ve gerçek i18n eklendi. Ayrıntı ve dürüstlük notu: `docs/FINAL_REPORT.md`.

### Added

- **v3 F0/F1:** genişletilmiş kapsam (route handler, gRPC/MCP, worker; satır 80 / dal 70), CI'da Docker zorunlu entegrasyon testleri; LLM kullanıcı başına token/maliyet bütçeleri (v3#22), redakte prompt logu, `ai_generated` etiketi; e-posta doğrulama, şifre sıfırlama ve passkey (WebAuthn) girişi.
- **v3 F2 — Envanter v2 (ADR 0010):** `RoomType{units}`, `RatePlan` (iade edilemez / kahvaltılı), `Restriction` (minStay/maxStay/CTA/CTD/stopSell), `InventoryDay{total, sold, held}` (`CHECK sold+held<=total`), `ExternalBlock`; `Availability` verisi tek migration'da taşındı. units=3 odada 100 paralel istek → tam 3 başarı.
- **v3 F2 — Tesis saat dilimi (ADR 0011):** `Property.timeZone/checkInTime/checkOutTime`, Temporal yardımcıları; iCal içe aktarma ve `complete-stays` job'ı tesisin yerel gününde çalışır.
- **v3 F2 — Arama doğruluğu:** tek zod arama şeması (`src/lib/search/params.ts`), geçersiz girdi 400; fiyat filtresi toplam fiyat üzerinden; `pageSize` 50'ye kırpılır.
- **v3 F3 — Vergi/ücret motoru (ADR 0012):** veri tabanlı kurallar (`data/tax-rules.json` / `TAX_RULES_JSON`), dahil/hariç vergiler, tarih aralıklı kurallar, `SERVICE_FEE_BPS`; arama kartı, PDP, checkout ve tahsilat aynı vergiler dahil toplamı gösterir.
- **v3 F3 — Kalıcı FX (ADR 0012):** `FxRate` tablosu, günlük `fx-refresh` işi (TCMB → ECB → statik yedek, bayat işareti); teklif kur tablosunu sabitler (`fxSnapshotId`), tahsilat teklifteki tutarla yapılır.
- **v3 F3 — Fiyat içgörüsü ve alarmı:** split conformal tahmin aralığı (%90, `PRICE_INSIGHT_ALPHA`) ile düşük/tipik/yüksek etiketi (`GET /api/price-insight`); `PriceAlert` ve günlük `price-alerts` işi, toplam Omnibus referansının (son 30 günün en düşüğü, "önceki fiyat") altına inince e-posta gönderir (`/api/price-alerts`).
- **v3 F4 — Gerçek Stripe (P0-6, #10):** Stripe SDK sağlayıcısı, imzalı webhook ve Payment Element; ödeme kilidi ile tek tahsilat.
- **v3 F4 — Ödeme sagası (P0-7, ADR 0013):** `hold → authorize → capture → confirm` telafili saga (iade → void → tutmayı bırak), onay sonrası BullMQ FlowProducer ile `invoice → notify`; `saga_compensation_total` metriği, adım başına hata enjeksiyonu testleri.
- **v3 F4 — Payout ve fatura (#4):** devir sonrası satıcı `Payout` kaydı ve mock `payouts` işi (`PAYOUT_CRON`); mock e-Arşiv PDF fatura (`GET /api/bookings/:id/invoice`, "DEMO — mali değeri yoktur").
- **v3 F4 — FX saklama:** eski `FxRate` satırları saklama penceresine göre budanır.
- **v3 F5 — Hibrit arama (P1-1, ADR 0014):** `Property.searchVector` (simple + turkish tsvector, GIN); sözcüksel, pgvector, trigram ve tam ifade kanalları RRF ile birleşir (`SEARCH_RRF_K`=60); yapısal filtreler kanallardan önce. 30 sorguluk altın kümede nDCG@10 0.24 → 0.87.
- **v3 F5 — LTR (P1-2):** sentetik tıklama üreteci + LightGBM lambdarank eğitimi (`npm run ltr:clicks`, `npm run ltr:train`), `models/ranker.onnx` (~128 KB); `onnxruntime-node` opsiyonel ve tembel, yoksa ağırlıklı sıralamaya düşer. Ölçümler: `docs/perf/ltr.md`.
- **v3 F5 — Deneyler (P1-3):** OpenFeature süreç içi sağlayıcı (`config/flags.json`), murmurhash ile deterministik kova, `ExperimentExposure` + outbox `experiment.exposure`; `search-ranking` deneyi (`ranking.weighted` / `ranking.ltr`), `/admin` deney kartında dönüşüm ve Wilson aralığı.
- **v3 F6 — Mesajlaşma (P1-6, ADR 0017):** rezervasyon başına misafir ↔ ev sahibi yazışması (yalnız taraflar; diğerleri 404), gövde kaydedilmeden önce telefon/e-posta/IBAN/URL/kart/TCKN maskelenir; Redis pub/sub + SSE canlı iletim; ev sahibine yalnızca taslak AI yanıt (saklanmaz, otomatik gönderilmez).
- **v3 F6 — Yorum moderasyonu (P1-7, ADR 0017):** yalnız COMPLETED rezervasyon sahibi yorum yazar (v3#24); deterministik küfür/PII filtresi yorumu `PENDING_REVIEW` kuyruğuna alır; şikâyet (`POST /api/reviews/:id/report`) `REVIEW_REPORT_HIDE_THRESHOLD` eşiğinde gizler; alt puanlar (temizlik/konum/personel/fiyat-değer), Omnibus doğrulama notu, `/admin` moderasyon kartı (denetim kaydıyla). Puan ve AI özeti yalnız yayındaki yorumları kullanır.
- **v3 F6 — Fraud v2 + step-up (P1-8, ADR 0017):** gerekçe kodlu kural puanlama (hız, cihaz parmak izi, BIN/IP ülke uyuşmazlığı) → `allow | challenge_3ds | step_up_passkey | review | deny`; step-up passkey ile (403 `STEP_UP_REQUIRED`, passkey yoksa 3DS).
- **v3 F6 — Passkey arayüzü:** girişte "Passkey ile giriş", hesap sayfasında passkey listele/ekle/sil, ödemede step-up penceresi (doğrulamadan sonra ödeme yeniden denenir).
- **v3 F6 — Belge/kayıt no (P1-10):** mock TR (7565) ve AB (2024/1028) kayıt doğrulaması; VERIFIED olmayan ilan yayına alınamaz ve aramada görünmez (v3#25); aylık SDEP CSV dışa aktarımı (`scripts/sdep-export.ts`).
- **v3 F7 — Ajan rezervasyonu (P1-11, ADR 0015):** `/api/mcp` streamable HTTP MCP (bearer zorunlu, 401 + `WWW-Authenticate`, fail-closed "agentic" hız sınırı), `ui://stay-card` kaynağı, `get_price_insight` / `list_my_bookings` / `cancel_booking` (`confirm: true`) araçları; ACP `checkout_sessions` oluştur/güncelle/tamamla `Idempotency-Key` ister ve insan akışıyla aynı `quote → hold → payment` sagasını çalıştırır.
- **v3 F7 — Kanal yöneticisi (P1-9, #21, ADR 0015):** `ical-poll` tekrarlı işi (ETag / `If-Modified-Since`, SSRF korumalı https, boyut/süre sınırı), ev sahibi abonelik uçları, besleme belirteci döndürme (`ChannelFeed.tokenVersion`), yalnız uyaran fiyat eşitliği kontrolü.
- **v3 F7 — Gelir paneli (P1-5, ADR 0015):** `/host/revenue` doluluk, ADR, RevPAR ve SVG pickup grafiği; doluluk, varışa kalan süre, TR resmî tatilleri ve onaylı olaylardan katkı tablolu fiyat önerisi her zaman [taban, tavan] içinde (v3#5, fast-check); LLM yalnız Türkçe açıklamayı yazar (demo yedeği). Kabul fiyatı yazıp geceyi sabitler (`priceOverride`, motor ezmez), ret hiçbir şeyi değiştirmez.
- **v3 F7 — Ölü kod (#17):** knip ile bulunan kullanılmayan dosya ve dışa aktarımlar kaldırıldı.
- **v3 F8 — i18n (P1-12, #20, ADR 0018):** next-intl ile tr/en (varsayılan tr, `NEXT_LOCALE` çerezi), üst bardaki dil seçici, `Intl` tabanlı tarih/para/sayı biçimleme, anahtar eşitliği betiği (`npm run i18n:check`); bildirim e-postaları `User.locale`'e göre iki dilli.
- **v3 F8 — UI + erişilebilirlik (P2-1):** Playwright + axe taraması (`tests/e2e/i18n.spec.ts`, ciddi/kritik ihlal 0 hedefi), PDP'de fiyat içgörüsü bileşeni.
- **v3 F8 — Demo senaryoları (P2-2):** `scripts/demo-scenarios.ts` 7 tohumlu uçtan uca senaryo (100 paralel HOLD, idempotent ödeme, vergi dökümü, saat dilimi, MCP 401, gelir önerisi, belgesiz ilan); `docs/DEMO_SCRIPT.md`, `npm run demo:reset`.
- **v3 F8 — Yük ve kaos (P2-3):** k6 `search`, `hold-spike`, `payment-race`, `llm-fallback` betikleri; `load/chaos.md` (Redis kesintisi, LLM zaman aşımı) ve `docs/perf/k6-results.md` gerçek ölçümlerle.

### Changed

- Hash embedding eş anlamlı ve kök genişletmesi kullanır; sağlayıcı adı `hash-fnv1a-128-syn`, `npm run embeddings:backfill` gerekir (ADR 0008). Sorgulu aramada semantik ağırlık 0.6.
- Tahsilat hatası artık provizyonu void eder, ödemeyi `VOIDED` yapar ve tutmayı hemen bırakır (ADR 0013).
- Oda API yanıtları `maxOccupancy` döner; `capacity` bir sürüm boyunca takma ad olarak korunur.
- Pazarlık özelliği kaldırıldı, tek fiyat kaynağı `priceStay` (ADR 0016).
- Legacy fiyat motoru (`src/lib/pricing/engine.ts`) `event-signals` içine katlandı; `pricing-service` ve canlı ısı haritası tek motoru kullanır (#9).

### Fixed

- Eşzamanlı ödeme onayında Postgres serileştirme çakışması (P2034) 3 denemede tükenip 500 dönüyordu (k6 payment-race: 18 onaydan 4'ü). Deneme sayısı ve üstel+rastgele geri çekilme yapılandırılabilir (`DB_SERIALIZABLE_RETRY_ATTEMPTS`, `DB_SERIALIZABLE_RETRY_BASE_MS`); tükenirse 409 `TRANSACTION_CONFLICT` + `Retry-After`.
- Redis kesintisinde fail-open arama ~33 sn asılı kalıyordu; bağlantı koptuktan sonra komutlar hemen reddedilir ve her komut `REDIS_COMMAND_TIMEOUT_MS` ile sınırlıdır (kesinti altında arama p95 232 ms).
- Süre dolum işi (`expire-holds`) sayacı tutarsız tek bir tutmada tüm toplu işlemi geri alıyor, hiçbir tutma bir daha düşmüyordu; tutarsız kayıt SAVEPOINT ile iadesiz EXPIRED yapılır ve loglanır (`booking_expire_inventory_drift_total`). Seed'deki PENDING rezervasyonlar artık `held` sayacını artırır.
- MCP 401 yanıtı JSON-RPC `-32001` hata gövdesi ve `WWW-Authenticate` başlığı döner.
- Fiyat kırılımında (`QuoteBreakdown`) `<dl>` içinde `<p>` vardı (axe `definition-list`, serious; ürün ve checkout sayfaları); dahil vergi ve kur notları listenin dışına alındı.
- `demo:scenarios` betiğinin okuduğu `BASE_URL` ve `DAY_OFFSET` `.env.example`'da belgelenmemişti (regression #21 kırmızıydı).
- Serbest metin araması kök ekleri, yazım hataları ve eş anlamlıları kaçırıyordu; hibrit RRF araması ile düzeltildi (v3#19).
- Devredilen rezervasyonun iptal iadesi yeni sahibe değil ödemeyi yapan alıcıya gider (v3#4).

### Security

- Çift tahsilat yarışı (v3#1): rezervasyon başına ödeme kilidi ve `Payment` üzerinde koşullu durum geçişi; kaybeden capture void/iade edilir.
- Webhook olayı işleme ile aynı transaction'da kaydedilir; tutar/para birimi uyuşmazlığı 400 + denetim kaydı, HOLD_EXPIRED otomatik iade (v3#2). Stripe webhook'u `Stripe-Signature` ile doğrulanır (v3#10).
- Rate-limit anahtarı `TRUSTED_PROXY_HOPS=0` iken tek global kovaya düşmez; güvenilmeyen başlıklar yok sayılır, bilinmeyen IP için parmak izi kovası (v3#3).
- `User.tokenVersion`: hesap silme ve rol değişikliği tüm oturumları geçersiz kılar (v3#5); hesap kilitleme (`AUTH_LOCKOUT_THRESHOLD`, `AUTH_LOCKOUT_MINUTES`), access-token denylist Redis yokken fail-closed, `/api/auth/*` için oturum çerezi yokken de Origin kontrolü (login CSRF) (v3#14).
- `POST /api/properties` girdisi sınırlandı (para birimi, uzunluklar, iptal politikası varlığı); istemcinin gönderdiği pazarlık turu değerine güvenen uç kaldırıldı (v3#8).
- `DEMO_MODE` açık bayrağı: kapalıyken demo seed reddedilir ve `/dev/mailbox` 404 döner; arayüzde DEMO rozeti (v3#11).
- MCP kimliği araç argümanından transport'a taşındı (stdio'da `MCP_ACCESS_TOKEN`, HTTP'de bearer) (v3#12); gRPC opsiyonel TLS/mTLS (`GRPC_TLS_*`) ve interceptor tabanlı hız sınırı (v3#13).
- iCal URL yoklaması SSRF korumalı (yalnız https, özel ağ adresleri reddedilir, boyut/süre sınırı) (v3#21).
- Doğrulanmamış (`PENDING`/`REJECTED`) ilanlar arama dışında da kapalı: `GET /api/properties/[id]`, ilan sayfası, teklif ve `createBooking` ortak `LISTABLE_PROPERTY` koşuluyla 404 döner (v3#26).
- CSP, `PAYMENT_PROVIDER=stripe` iken Stripe.js'in gerektirdiği alan adlarını içerir (`script-src`/`frame-src` `js.stripe.com`, `frame-src` `hooks.stripe.com`, `connect-src` `api.stripe.com`); mock modunda eklenmez.

### Removed

- Aylık `Availability` partisyon betiği (`scripts/partitions.ts`, `migrations/manual/…`): sayaçlı envanterde gerekmez; eski geceler `pruneInventory` ile budanır.

## [2.0.0] - 2026-09-25

v1'in prototip çekirdeği üretim kalitesinde bir rezervasyon platformuna dönüştürüldü. 22 bilinen hatanın her biri düzeltildi ve regresyon testiyle korunuyor.

### Added

- **F0 — Kalite kapısı:** Prettier + `.gitattributes` (LF), `typecheck` / `format:check` / `check` script'leri, Vitest `unit` ve `integration` projeleri (testcontainers: pgvector + redis), `@vitest/coverage-v8`, `.dockerignore`.
- **F1 — LLM sözleşmesi:** `src/lib/llm/*` (live/demo/fallback modları, JSON çıkarma, KVKK redaksiyonu, sayı ve atıf guard'ları, Prometheus metrikleri), `GET /api/llm/status`, `npm run llm:smoke`.
- **F2 — Rezervasyon çekirdeği:** `PENDING → HELD → CONFIRMED → COMPLETED | CANCELLED | EXPIRED` durum makinesi, `holdExpiresAt` + dakikalık `expire-holds` job'ı; tamsayı minor-unit para ve UTC gece tipleri; kart, PDP, checkout ve tahsilat için tek `computeTotal()` quote'u (`GET /api/quote`, `409 PRICE_CHANGED`); 100 paralel istek → 1 başarı / 99 `SOLD_OUT` entegrasyon testi.
- **F3 — Ödeme, iptal, bildirim:** `PaymentProvider` + `MockPsp` (3DS simülasyonu, capture-on-confirm, refund), HMAC imzalı idempotent webhook, opsiyonel Stripe sağlayıcısı; sürümlü iptal politikaları ve `computeRefund()`; SMTP veya dev mailbox (`/dev/mailbox`) üzerinden Türkçe rezervasyon e-postaları.
- **F3 — Rezervasyon devri:** imzalı, tek kullanımlık claim linki ve escrow'lu ödeme ile P2P transfer (`/api/transfers/*`).
- **F4 — Gözlemlenebilirlik:** pino loglama, OpenTelemetry (Prisma, ioredis), `/api/metrics`, `/api/health`, `/api/ready`, Grafana dashboard JSON, `observability` compose profili; gecelik availability rollover ve dinamik partisyon betiği (`npm run db:partitions`).
- **F5 — Arama ve GenAI I:** Smart Filter (`POST /api/search/smart`, golden set 20/20 demo), açıklanabilir ağırlıklı sıralama ve `/ranking` şeffaflık sayfası, takılabilir `Embedder` (hash varsayılan, opsiyonel model; yeni mülkte otomatik embedding), `next-intl` (tr/en) ve rezervasyona FX snapshot'lı yalnızca-görüntüleme döviz dönüşümü.
- **F6 — Yorumlar ve GenAI II:** doğrulanmış konaklama yorumları, host yanıtları, atıflı AI yorum özeti; araçlı ve grounded çok şehirli trip-planner (`POST /api/ai/trip-plan`); onaylı talep olayı sinyalleriyle sınırlı ve açıklanabilir yeniden fiyatlama, yield hold.
- **F7 — Host ve admin:** host extranet API'leri (mülk, oda, toplu ARI, rezervasyonlar), ilan metni copilot'u, `Property.licenseNumber` zorunluluğu; iCal export/import ve gRPC `AriService` kanal simülatörü; kural tabanlı fraud skoru; admin kuyrukları (outbox, olaylar, fraud, kullanıcı rolleri) ve audit log; KVKK veri dışa aktarım ve hesap silme API'si.
- **F8 — Portföy arayüzü:** `/host` extranet paneli (mülk düzenleme, oda ekleme, toplu takvim, rezervasyonlar, ilan metni önerisi), `/admin` paneli, `/plan` trip-planner, `/transfers` + claim sayfası, `/account/privacy` KVKK self-servis, aydınlatma metni ve çerez onay bandı; Smart Filter çipleri, "neden bu sırada" açıklaması ve MapLibre harita görünümü; PDP'de atıflı yorum özeti, rol farkında menü, atlama bağlantısı; `npm run demo:reset`, lisans numaraları ve 365 günlük demo envanteri.
- **F8 — Test ve performans:** Playwright e2e (`npm run test:e2e`: arama → PDP → checkout → 3DS → onay e-postası → iptal → iade; ret kartı; host takvimi; Smart Filter) ve `@axe-core/playwright` ile 6 ana sayfada WCAG A/AA taraması; k6 yük testi `load/booking-spike.js` ve raporları `docs/perf/k6-results.md`, `docs/perf/lighthouse.md`; CI'da compose demo yığınına karşı e2e job'ı.
- **P1-12 — MCP sunucusu:** `npm run mcp:server` (stdio, `@modelcontextprotocol/sdk`) ile `search_stays`, `get_quote` ve access token'lı `create_hold` araçları; `npm run mcp:smoke` duman testi.
- Harita görünümünde `supercluster` ile işaretçi kümelemesi ve harita ↔ liste iki yönlü seçim senkronu (`src/lib/search/map-cluster.ts`).
- README ekran görüntüleri (`docs/img/`, `npm run docs:screenshots`).
- `npm run test:coverage` unit + entegrasyon testlerini birlikte koşar; `src/lib` için %80 satır kapsam eşiği CI'da zorlanır.
- `docs/FINAL_REPORT.md`: faz faz yapılanlar, hata → test eşlemesi, metrikler, sınırlamalar.
- Dokümantasyon: README, `docs/ARCHITECTURE.md`, ADR 0001–0009, `docs/METHODOLOGY.md`, `docs/MODEL_CARD.md`, `docs/COMPLIANCE.md`, `docs/DEMO_SCRIPT.md`, MIT lisansı.

### Changed

- Next.js 16, React 19, ESLint 9 (flat config) ve Vitest 5'e yükseltme; `src/middleware.ts` → `src/proxy.ts` (ADR 0009).
- Kimlik doğrulama yalnızca `jose`: 15 dk access token + rotating refresh token (yeniden kullanımda aile iptali), POST-only logout, sabit zamanlı login; localStorage'da token tutulmuyor.
- Kuyruk tanımı ile worker ayrıldı; arama cache'i `KEYS` taraması yerine sürüm anahtarlı.
- Rota optimizasyonu açık yol Held-Karp ve asimetrik maliyete güvenli yerel arama (2-opt + or-opt) ile yeniden yazıldı; modül dürüst adıyla belgelendi.
- Eski "sentiment trigger" modülü, admin onaylı ve tavanlı olay sinyali motoruyla değiştirildi.
- Docker imajları sırsız; compose sırları `secrets-init` ile üretir, Postgres/Redis host'a açılmaz, Redis parolalı; gRPC servisi compose'a eklendi.
- `.env.example` tüm ortam değişkenlerini belgeler.
- PDP galerisi Unsplash CDN'inde boyutlandırılmış `srcset` kullanır (önceden optimize edilmemiş 1200 px görseller); küçük resimler düşük öncelikli yüklenir.
- `LOG_TO_STDERR=true` ile loglar stderr'e yazılabilir (stdio protokollü süreçler için).

### Fixed

- Compose demosunda çerezli tüm POST/PUT/DELETE istekleri `403 CSRF_REJECTED` alıyordu (standalone sunucunun `0.0.0.0` origin'i); hedef origin artık `Host` başlığından türetilir.
- `.env.example`'daki `DEMO_SEED=false`, `cp .env.example .env` sonrası compose demosunun seed yüklemesini engelliyordu.
- Erişilebilirlik: arama çubuğu etiket kontrastı, devre dışı buton kontrastı, footer başlık sırası, `prefers-reduced-motion` desteği.

- gRPC: JWT metadata zorunlu, istek sahibi token'dan türetilir (#1).
- İç uçlar: zayıf veya varsayılan sır kabul edilmez, timing-safe karşılaştırma, ADMIN JWT alternatifi (#2).
- Transfer: token doğrulaması, ödeme ve sızıntı sorunları (#3).
- Ödenmeyen rezervasyonların envanteri sonsuza dek tutması (#4).
- Rate-limit atlatma ve `x-user-id` başlık sahteciliği (#5, #6).
- İstemcinin para birimi seçebilmesi ve gösterilen ≠ tahsil edilen fiyat (#7, #8, #20).
- Outbox çift yayın, lease eksikliği ve sonsuz retry (#9).
- BullMQ worker'ın Next sunucusunda açılması (#10).
- SSE canlı uçta sınırsız aralık ve bağlantı (#11).
- Rota optimizasyonunda açık/kapalı yol tutarsızlığı, ay indeksi ve asimetrik maliyet hataları (#12).
- Olay fiyatlamasında bileşik ve sınırsız artış (#13).
- Docker build, compose ve CI hataları (#14, #15); kimlik doğrulama açıkları (#16); pricing ucu yetki kontrolü (#17); bloklayan cache taraması (#18); sorgu profil'leyicinin varsayılan açık olması (#19); eksik env belgeleri (#21); yeni mülkte embedding üretilmemesi (#22).

### Removed

- `jsonwebtoken` bağımlılığı, kullanılmayan saga / command bus / query bus kodu.
- `.github/workflows/deploy.yml`: gerçek bir deploy hedefi yoktu ve sırları build argümanı olarak geçiriyordu; yerine `ci.yml`.

## [1.0.0]

- İlk prototip: Next.js 14 arayüzü, Redlock + `FOR UPDATE` rezervasyon, çarpımsal fiyat motoru, pazarlık motoru, gRPC tanımları, deterministik seed.

[Unreleased]: https://github.com/tunadeniz1304/booking-platform/compare/v4.0.0...HEAD
[4.0.0]: https://github.com/tunadeniz1304/booking-platform/compare/v3.0.0...v4.0.0
[3.0.0]: https://github.com/tunadeniz1304/booking-platform/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/tunadeniz1304/booking-platform/releases/tag/v2.0.0
