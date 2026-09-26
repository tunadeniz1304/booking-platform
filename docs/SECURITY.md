# Güvenlik — tehdit modeli ve kapatılan açıklar

> Portföy/demo projesidir. Bu belge sistemin **neye karşı** korunduğunu (STRIDE), korumanın
> **kodda nerede** olduğunu, v3 turunda kapatılan açıkları ve **bilinen açık riskleri**
> listeler. Kapatılan her açığın `regression: v3#N` etiketli bir testi vardır.

## 1. Güven sınırları

```
Tarayıcı ──(HTTPS, httpOnly çerez)──▶ Next.js proxy (src/proxy.ts)
                                        │  rate-limit · CSRF · JWT (tv) · CSP nonce · kimlik başlığı temizliği
                                        ▼
                                  Route handler'lar ──▶ PostgreSQL (tek doğruluk kaynağı)
                                        │                Redis (kilit, rate-limit, oturum dönemi, step-up)
MCP istemcisi ──(HTTP bearer / stdio env)──▶ src/lib/mcp/http.ts, services/mcp
gRPC istemcisi ──(TLS/mTLS opsiyonel + bearer)──▶ services/grpc (interceptor rate-limit)
MockPsp ──(HMAC imzalı webhook)──────▶ /api/payments/webhook
Stripe ──(Stripe-Signature)──────────▶ /api/payments/webhook
Harici iCal URL'si ◀──(SSRF korumalı GET)── src/lib/channel/ical-poller.ts
LLM sağlayıcı ◀──(redakte istek)────── src/lib/llm (tek istemci, bütçe, guard)
```

## 2. STRIDE

| Tehdit                     | Örnek saldırı                                | Karşı önlem                                                                                                                                              | Kod                                                                                                    |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **S**poofing               | Çalınmış/eski token ile istek                | 5 dk erişim JWT'si, dönen yenileme token'ı + yeniden kullanım tespiti; `tokenVersion` (`tv` claim'i) ile tüm oturumların iptali                          | `src/lib/auth/{tokens,session,token-version}.ts`                                                       |
|                            | Kaba kuvvet / parola deneme                  | Hesap kilidi (`AUTH_LOCKOUT_THRESHOLD`, `AUTH_LOCKOUT_MINUTES`), IP'den bağımsız hesap bazlı deneme limiti                                               | `src/lib/auth/account.ts` (`checkLoginAttemptLimit`, `recordFailedLogin`)                              |
|                            | Kimlik başlığı sahteciliği (`x-user-id`)     | Proxy her istekte siler, yalnız doğrulanmış JWT'den yazar                                                                                                | `src/proxy.ts`                                                                                         |
|                            | Login CSRF                                   | `/api/auth/*` POST'larında çerez yokken de Origin kontrolü                                                                                               | `src/lib/security/csrf.ts` (`isLoginCsrfViolation`)                                                    |
|                            | Kimlik avı / ele geçirilmiş parola ile ödeme | Passkey (WebAuthn, sayaç kontrolü); riskli ödemede passkey step-up, tek kullanımlık ve 5 dk (`STEP_UP_TTL_SECONDS=300`)                                  | `src/lib/auth/passkey.ts`, `src/lib/payment/payment-service.ts` (`consumeStepUp`, `step_up_passkey`)   |
|                            | MCP'de başkası adına işlem                   | HTTP transport'ta bearer zorunlu (401 + `WWW-Authenticate`); kimlik araç argümanı değil                                                                  | `src/lib/mcp/http.ts`, `src/lib/mcp/server.ts`                                                         |
| **T**ampering              | Webhook sahteciliği / tutar değiştirme       | MockPsp: HMAC imza + 5 dk tolerans; Stripe: `Stripe.webhooks.constructEvent`; olay tutarı/para birimi kayıtlı ödemeyle karşılaştırılır                   | `src/lib/payment/webhook.ts`, `src/lib/payment/stripe-webhook.ts`                                      |
|                            | Fiyatı istemcide değiştirme                  | Tutar daima sunucuda `computeTotal`; fark `409 PRICE_CHANGED`                                                                                            | `src/lib/pricing/quote.ts`                                                                             |
|                            | Kanal (iCal) üzerinden iç ağa istek (SSRF)   | Yalnız http(s), özel/iç adresler reddedilir, besleme token'ı döndürülebilir                                                                              | `src/lib/security/url.ts` (`assertFetchableUrl`, `isPrivateAddress`), `src/lib/channel/ical-poller.ts` |
| **R**epudiation            | Yönetici eylemi inkârı                       | Değiştirilemez `AuditLog` (rol değişimi, webhook uyuşmazlığı, moderasyon)                                                                                | `src/lib/admin/audit.ts`                                                                               |
| **I**nformation disclosure | IDOR (başkasının rezervasyonu, mesaj dizisi) | Sahiplik kontrolü, başkasına 404; mesaj dizisinde katılımcı olmayan (ADMIN dahil) `NotFoundError`                                                        | `src/lib/security/ownership.ts`, `src/lib/messaging/message-service.ts`                                |
|                            | Mesajla iletişim bilgisi / kart sızması      | Telefon, e-posta, IBAN, URL, kart, TCKN maskelenir                                                                                                       | `src/lib/messaging/mask.ts`                                                                            |
|                            | LLM'e kişisel veri / anahtar sızması         | KVKK redaksiyonu, anahtar log/yanıtta yok                                                                                                                | `src/lib/llm/redaction.ts`, `src/lib/llm/client.ts`                                                    |
|                            | Kullanıcı numaralandırma                     | Şifre sıfırlama daima 202; bilinmeyen e-posta ve yanlış parola aynı 401                                                                                  | `src/app/api/auth/password/forgot/route.ts`                                                            |
|                            | XSS ile ödeme sayfası betiği                 | Nonce + `'strict-dynamic'` CSP; `PAYMENT_PROVIDER=stripe` iken yalnız Stripe alan adları (`js.stripe.com`, `hooks.stripe.com`, `api.stripe.com`) eklenir | `src/lib/security/headers.ts` (`buildCsp`), `src/proxy.ts`                                             |
| **D**enial of service      | Tek saldırganın herkesi kilitlemesi          | Anonimler IP yoksa parmak izi kovalarına ayrılır (tek `"unknown"` kovası yok)                                                                            | `src/lib/security/ip.ts` (`clientKey`)                                                                 |
|                            | gRPC taşması                                 | Interceptor: eş adresi + kullanıcı başına limit (`RESOURCE_EXHAUSTED`)                                                                                   | `services/grpc/server.ts`                                                                              |
|                            | LLM maliyet saldırısı                        | Özne başına günlük token bütçesi; bütçe bitince demo yanıt                                                                                               | `src/lib/llm/budget.ts`, `src/lib/http/ai.ts` (`withAiSubject`)                                        |
| **E**levation of privilege | Rol düşürülen kullanıcının eski yetkisi      | Rol değişiminde `tokenVersion++` → eski token anında geçersiz                                                                                            | `src/app/api/admin/users/[id]/role/route.ts`                                                           |
|                            | Demo hesaplarının üretime sızması            | `DEMO_MODE=false` iken seed reddedilir, mailbox 404, MockPsp yalnız açık seçimle                                                                         | `src/lib/config/{demo,seed-guard}.ts`, `src/lib/payment/index.ts`                                      |
|                            | gRPC `Charge` ile yetkisiz/çift tahsilat     | Opsiyonel TLS/mTLS (`GRPC_TLS_CERT`, `GRPC_TLS_KEY`, `GRPC_TLS_CA`), `idempotency_key` zorunlu                                                           | `services/grpc/server.ts`                                                                              |

## 3. Para güvenliği (çift tahsilat)

Bir rezervasyon için **en fazla bir tahsilat** kalıcı olur:

1. `pay:<bookingId>` Redis kilidi (`src/lib/payment/payment-service.ts`): iki sekme, farklı
   Idempotency-Key ve gRPC `Charge` sıralanır.
2. `Payment` satırında koşullu durum geçişi (`updateMany … where status in (açık durumlar)`):
   tahsil hakkını yalnız bir yetkilendirme alır; kaybeden yetkilendirme `void`, kaybeden
   capture otomatik `refund` edilir (`payment_capture_race_total`).
3. Webhook işlemesi olay kaydıyla aynı veritabanı işleminde; onaylanamayan tahsilat
   (tutma süresi doldu) otomatik iade edilir ve `PaymentEvent` olarak kaydedilir.
4. Riskli ödemede (`src/lib/risk/fraud.ts`) önce 3DS challenge veya passkey step-up istenir.

Kanıt: `tests/integration/v3-payment-race.test.ts` (50 paralel ödeme → 1 net capture, defter
bakiyesi = rezervasyon toplamı, SQL çift-CHARGE sorgusu 0).

## 4. v3'te kapatılan açıklar

| #     | Açık                                                                                    | Düzeltme                                                                                                                     | Test                                                                                                                     |
| ----- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| v3#1  | Farklı Idempotency-Key ile çift tahsilat; PAID satırın ezilmesi                         | Booking kilidi + koşullu ödeme geçişi + kaybedeni void/refund; gRPC `Charge` anahtarı zorunlu                                | `tests/integration/v3-payment-race.test.ts`, `tests/unit/security/grpc-hardening.test.ts`                                |
| v3#2  | Webhook idempotency kaydı işlemeden önce commit; tutar kontrolü yok                     | Aynı işlemde kayıt; HOLD_EXPIRED → otomatik iade; uyuşmazlık → 400 + audit                                                   | `tests/integration/v3-payment-race.test.ts`                                                                              |
| v3#3  | `TRUSTED_PROXY_HOPS=0` iken tüm anonimler tek kovada                                    | `clientKey`: IP → güvenilir `x-real-ip` → parmak izi; hesap bazlı login limiti                                               | `tests/unit/security/{ip,proxy}.test.ts`, `tests/integration/v3-auth.test.ts`                                            |
| v3#4  | Devir (transfer) sonrası iptal iadesi yanlış tarafa gidiyor                             | İade alıcının ödemesine yönlenir; payout işi satıcıyı öder                                                                   | `tests/integration/transfer.test.ts`                                                                                     |
| v3#5  | Hesap silme / rol değişimi diğer oturumları kapatmıyor                                  | `User.tokenVersion` (JWT `tv` claim'i + refresh kaydı); aktif rezervasyonlar politikaya göre iptal                           | `tests/unit/security/auth.test.ts`, `tests/integration/v3-auth.test.ts`                                                  |
| v3#6  | "Bugün", iade penceresi ve iCal geceleri sunucu saat dilimine bağlı                     | Tesis saat dilimiyle yerel tarih (ADR 0011)                                                                                  | `tests/unit/time/timezone.test.ts`, `tests/unit/payment/payment-units.test.ts`, `tests/integration/v3-inventory.test.ts` |
| v3#7  | Aramada dolu gece/sayfalama/fiyat filtresi hataları; önbellek geçersizleştirmede `KEYS` | Doğrulanmış parametreler (400), tesis bazlı O(1) sürüm sayacı (ADR 0010)                                                     | `tests/integration/v3-inventory.test.ts`, `tests/unit/regressions/runtime.test.ts`                                       |
| v3#8  | Mülk oluşturmada sınırsız alanlar, geçersiz para birimi → 500                           | Tüm alanlara üst sınır, `CURRENCIES` enum'u, politika varlık kontrolü; tur sayılı pazarlık ucu kaldırıldı (ADR 0016)         | `tests/unit/security/validation.test.ts`                                                                                 |
| v3#9  | Kart, detay, checkout ve tahsilatta farklı toplam fiyat                                 | Tek `computeTotal` + vergi motoru, vergi dahil kart fiyatı (ADR 0012)                                                        | `tests/integration/price-consistency.test.ts`, `tests/integration/pricing-engine.test.ts`, `tests/e2e/price-ftc.spec.ts` |
| v3#10 | Gerçek PSP yolu yok                                                                     | Stripe PaymentIntent + `Stripe-Signature` webhook doğrulaması (testler kayıtlı yanıtlarla, ağsız)                            | `tests/unit/payment/stripe.test.ts`, `tests/integration/v3-stripe.test.ts`                                               |
| v3#11 | Prod'da demo kimlik bilgisi, açık mailbox                                               | `DEMO_MODE`                                                                                                                  | `tests/unit/security/auth.test.ts`                                                                                       |
| v3#12 | MCP `create_hold` JWT'yi araç argümanı olarak alıyor                                    | Kimlik transport'tan (HTTP bearer / stdio env); argüman şemasında kimlik bilgisi yok                                         | `tests/unit/mcp/server.test.ts`                                                                                          |
| v3#13 | gRPC güvensiz kanal, rate limit yok                                                     | Opsiyonel TLS/mTLS (`GRPC_TLS_*`), interceptor rate limit                                                                    | `tests/unit/security/grpc-hardening.test.ts`                                                                             |
| v3#14 | Denylist fail-open, login CSRF, kilit/sıfırlama/doğrulama/2FA yok                       | Fail-closed denylist + 5 dk erişim token'ı, login Origin kontrolü, hesap kilidi, e-posta doğrulama, şifre sıfırlama, passkey | `tests/unit/security/auth.test.ts`, `tests/integration/v3-auth.test.ts`                                                  |
| v3#15 | Eski envanter satırları birikiyor                                                       | `pruneInventory` saklama süresinden eskiyi siler                                                                             | `tests/integration/v3-inventory.test.ts`                                                                                 |
| v3#16 | Compose `environment` sığ birleşmesi değişken düşürüyor                                 | `x-common-env` anchor'ı + `<<: *common-env`                                                                                  | `tests/unit/regressions/infra.test.ts`                                                                                   |
| v3#17 | Ölü kod ve kullanılmayan ayarlar                                                        | Temizlik ve regresyon kontrolü                                                                                               | `tests/unit/regressions/infra.test.ts`                                                                                   |
| v3#18 | Biten konaklamalar `COMPLETED` olmuyor                                                  | `completeStays` tesisin yerel çıkış saatine göre                                                                             | `tests/integration/v3-inventory.test.ts`                                                                                 |
| v3#19 | Arama alaka kalitesi zayıf                                                              | Hibrit RRF arama; 30 sorguluk altın kümede nDCG@10 ≥ 1.15 × v2 (ADR 0014)                                                    | `tests/integration/search-golden.test.ts`                                                                                |
| v3#20 | tr/en mesaj anahtarları ayrışıyor                                                       | Ad alanı ve anahtar eşitliği testi, `npm run i18n:check`                                                                     | `tests/unit/i18n/i18n.test.ts`                                                                                           |
| v3#21 | Kanal yöneticisi: iCal token'ı dönmüyor, SSRF, gereksiz yeniden çekme                   | Token rotasyonu, `assertFetchableUrl`, ETag'li poller                                                                        | `tests/unit/channel/channel-manager.test.ts`, `tests/integration/channel-manager.test.ts`                                |
| v3#22 | LLM bütçesi bitince hata; yorum özeti AI olarak işaretlenmiyor                          | Bütçe bitince demo yanıt; yorum özeti `ai` kategorisinde                                                                     | `tests/unit/llm/v3-contract.test.ts`                                                                                     |

Ek etiketler: `v3#23` FX kur anlık görüntüsü (`tests/integration/fx-snapshot.test.ts`),
`v3#24` yalnız `COMPLETED` rezervasyon yorum yazabilir (`tests/integration/v3-review-moderation.test.ts`),
`v3#25` `PENDING` lisanslı ilan aramada görünmez (`tests/integration/v3-compliance.test.ts`),
`v3#26` doğrulanmamış (`PENDING`/`REJECTED`) ilan detay API'sinde 404, teklif ve rezervasyonda
reddedilir; tüm yollar `src/lib/compliance/listing.ts` içindeki `LISTABLE_PROPERTY` koşulunu kullanır.
`v3#5` ve `v3#11` etiketleri ayrıca `host-revenue`, `revenue-engine`, `mcp/server` ve
`agentic-checkout` testlerinde yeniden kullanılmıştır.

## 5. Bilinen sınırlamalar (bilinçli ödünleşimler)

- Parmak izi (UA + Accept-Language) saldırgan tarafından değiştirilebilir; yalnız kovaları
  ayırır. Gerçek istemci IP'si için ters vekil + `TRUSTED_PROXY_HOPS` önerilir.
- E-posta bağlantı token'ı outbox yükünde ve dev mailbox'ta bulunur; tek kullanımlık ve
  30 dk / 24 saat ömürlüdür. Gerçek SMTP ile mailbox kapatılır (`DEMO_MODE=false`).
- Redis erişilemezken erişim token'ları reddedilir (fail-closed); bilinçli bir
  kullanılabilirlik ödünleşimi (bkz. `load/chaos.md`).

## 6. Bilinen açık riskler

| Risk                                         | Ayrıntı                                                                                                                                                                                                                                                                                                                                                  | Etki                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| KVKK/GDPR export ve silmede mesajlar yok     | `exportUserData` / `deleteAccount` `Message` / `MessageThread` gövdelerini kapsamaz                                                                                                                                                                                                                                                                      | Uyum (KVKK m.11)                    |
| Cihaz parmak izi hesap silmede temizlenmiyor | Risk sinyali olarak Redis'te 90 gün tutulur (`FRAUD_DEVICE_TTL_DAYS`, `src/lib/risk/fraud.ts`); `deleteAccount` bu anahtarları silmez. İstemci tarafı FNV hash'i (`src/lib/risk/device-fingerprint.ts`) sahtelenebilir                                                                                                                                   | Gizlilik / risk skoru güvenilirliği |
| Passkey hata mesajları yalnız Türkçe         | `src/lib/auth/passkey.ts` sunucu hataları sabit Türkçe; `passkeyErrorMessage` (`src/lib/auth/passkey-client.ts`) sunucu mesajını olduğu gibi geçirir ve `StepUpDialog` bunu çevirmeden gösterir, İngilizce arayüzde Türkçe metin çıkar                                                                                                                   | UX / i18n                           |
| Passkey ve step-up arayüzü test edilmiyor    | E2E veya bileşen testi yok; yalnız `tests/integration/v3-passkey.test.ts` (yazılım authenticator) ve `tests/unit/auth/passkey-client.test.ts`                                                                                                                                                                                                            | Regresyon riski                     |
| Bağımlılık açıkları (npm audit)              | 4 orta (moderate), 0 yüksek/kritik: `@opentelemetry/core` <2.8.0 W3C Baggage yayılımında sınırsız bellek ayırma (GHSA-8988-4f7v-96qf); `@opentelemetry/resources`, `@opentelemetry/sdk-trace-base` üzerinden; kaynağı doğrudan bağımlılık `@prisma/instrumentation` 5.x. Düzeltme 7.x (major) ve `@prisma/client` 5.22 ile birlikte yükseltme gerektirir | DoS (izleme yolu)                   |
| PCI DSS 11.6.1                               | Ödeme sayfası değişiklik tespiti ve CSP `report-uri` yok                                                                                                                                                                                                                                                                                                 | Uyum                                |
