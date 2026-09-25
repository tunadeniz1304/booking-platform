# Güvenlik — tehdit modeli ve kapatılan açıklar

> Portföy/demo projesidir. Bu belge, sistemin **neye karşı** korunduğunu (STRIDE),
> korumanın **kodda nerede** olduğunu ve v3 turunda kapatılan açıkları listeler.
> Her kapatılan açığın `regression: v3#N` etiketli bir testi vardır.

## 1. Güven sınırları

```
Tarayıcı ──(HTTPS, httpOnly çerez)──▶ Next.js proxy (src/proxy.ts)
                                        │  rate-limit · CSRF · JWT · CSP nonce · kimlik başlığı temizliği
                                        ▼
                                  Route handler'lar ──▶ PostgreSQL (tek doğruluk kaynağı)
                                        │                Redis (kilit, rate-limit, oturum dönemi)
MCP istemcisi ──(bearer / stdio env)──▶ services/mcp
gRPC istemcisi ──(TLS? + bearer)──────▶ services/grpc (interceptor rate-limit)
PSP ──(imzalı webhook)────────────────▶ /api/payments/webhook
LLM sağlayıcı ◀──(redakte istek)────── src/lib/llm (tek istemci, bütçe, guard)
```

## 2. STRIDE

| Tehdit                     | Örnek saldırı                                    | Karşı önlem                                                                                                      | Kod                                                               |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **S**poofing               | Çalınmış/eski token ile istek                    | 5 dk erişim JWT'si, dönen yenileme token'ı + yeniden kullanım tespiti, `tokenVersion` ile tüm oturumların iptali | `src/lib/auth/{tokens,session,token-version}.ts`                  |
|                            | Kaba kuvvet / parola deneme                      | Hesap kilidi (`AUTH_LOCKOUT_*`), hesap bazlı deneme limiti (IP'den bağımsız), sabit zamanlı bcrypt               | `src/lib/auth/account.ts`, `src/app/api/auth/login/route.ts`      |
|                            | Kimlik başlığı sahteciliği (`x-user-id`)         | Proxy her istekte siler, yalnızca doğrulanmış JWT'den yazar                                                      | `src/proxy.ts`                                                    |
|                            | Login CSRF (saldırganın hesabına giriş yaptırma) | `/api/auth/*` POST'larında çerez yokken de Origin kontrolü                                                       | `src/lib/security/csrf.ts` (`isLoginCsrfViolation`)               |
|                            | Kimlik avına dayanıklı giriş                     | Passkey (WebAuthn, discoverable credential, sayaç kontrolü)                                                      | `src/lib/auth/passkey.ts`                                         |
| **T**ampering              | Webhook sahteciliği / tutar değiştirme           | HMAC imza + 5 dk tolerans; olay tutarı/para birimi kayıtlı ödemeyle karşılaştırılır                              | `src/lib/payment/webhook.ts`, `handleWebhookEvent`                |
|                            | Fiyatı istemcide değiştirme                      | Tutar daima sunucuda `computeTotal`; imzasız istemci tutarı yok sayılır                                          | `src/lib/pricing/quote.ts`                                        |
| **R**epudiation            | Yönetici eylemi inkârı                           | Değiştirilemez `AuditLog` (rol değişimi, webhook uyuşmazlığı, moderasyon)                                        | `src/lib/admin/audit.ts`                                          |
| **I**nformation disclosure | IDOR (başkasının rezervasyonu)                   | Sahiplik kontrolü, başkasına 404                                                                                 | `src/lib/security/ownership.ts`                                   |
|                            | LLM'e kişisel veri / anahtar sızması             | KVKK redaksiyonu, anahtar log/yanıtta yok, MCP'de token araç argümanı değil                                      | `src/lib/llm/redaction.ts`, `src/lib/mcp/server.ts`               |
|                            | Kullanıcı numaralandırma                         | Şifre sıfırlama daima 202; bilinmeyen e-posta ve yanlış parola aynı 401                                          | `src/app/api/auth/password/forgot/route.ts`                       |
| **D**enial of service      | Tek saldırganın herkesi kilitlemesi              | Anonimler IP yoksa parmak izi kovalarına ayrılır (tek `"unknown"` kovası yok)                                    | `src/lib/security/ip.ts` (`clientKey`)                            |
|                            | gRPC taşması                                     | Interceptor: eş adresi + kullanıcı başına limit (RESOURCE_EXHAUSTED)                                             | `services/grpc/server.ts`                                         |
|                            | LLM maliyet saldırısı                            | Özne başına günlük token bütçesi → demo                                                                          | `src/lib/llm/budget.ts`                                           |
| **E**levation of privilege | Rol düşürülen kullanıcının eski yetkisi          | Rol değişiminde `tokenVersion++` → eski token anında geçersiz                                                    | `src/app/api/admin/users/[id]/role/route.ts`                      |
|                            | Demo hesaplarının üretime sızması                | `DEMO_MODE=false` iken seed reddedilir, mailbox 404, MockPsp yalnız açık seçimle                                 | `src/lib/config/{demo,seed-guard}.ts`, `src/lib/payment/index.ts` |

## 3. Para güvenliği (çift tahsilat)

Bir rezervasyon için **en fazla bir tahsilat** kalıcı olur:

1. `pay:<bookingId>` Redis kilidi — iki sekme / farklı Idempotency-Key / gRPC `Charge` sıralanır.
2. `Payment` satırında koşullu durum geçişi (`updateMany … where status in (açık durumlar)`):
   tahsil hakkını yalnızca bir yetkilendirme alır; kaybeden yetkilendirme `void`, kaybeden
   capture otomatik `refund` edilir (`payment_capture_race_total`).
3. Webhook işlemesi olay kaydıyla aynı veritabanı işleminde; onaylanamayan tahsilat
   (tutma süresi doldu) otomatik iade edilir ve `PaymentEvent` olarak kaydedilir.

Kanıt: `tests/integration/v3-payment-race.test.ts` (50 paralel ödeme → 1 net capture,
defter bakiyesi = rezervasyon toplamı, SQL çift-CHARGE sorgusu 0).

## 4. v3'te kapatılan açıklar

| #     | Açık                                                                | Düzeltme                                                                                                                          | Test                                                                          |
| ----- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| v3#1  | Farklı Idempotency-Key ile çift tahsilat; PAID satırın ezilmesi     | Booking kilidi + koşullu ödeme geçişi + kaybedeni void/refund; gRPC `Charge` anahtarı zorunlu                                     | `tests/integration/v3-payment-race.test.ts`                                   |
| v3#2  | Webhook idempotency kaydı işlemeden önce commit; tutar kontrolü yok | Aynı işlemde kayıt; HOLD_EXPIRED → otomatik iade; uyuşmazlık → 400 + audit                                                        | `tests/integration/v3-payment-race.test.ts`                                   |
| v3#3  | `TRUSTED_PROXY_HOPS=0` iken tüm anonimler tek kovada                | `clientKey`: IP → güvenilir `x-real-ip` → parmak izi; hesap bazlı login limiti                                                    | `tests/unit/security/{ip,proxy}.test.ts`, `tests/integration/v3-auth.test.ts` |
| v3#5  | Hesap silme / rol değişimi diğer oturumları kapatmıyor              | `User.tokenVersion` (JWT `tv` claim'i + refresh kaydı); aktif rezervasyonlar politikaya göre iptal                                | `tests/unit/security/auth.test.ts`, `tests/integration/v3-auth.test.ts`       |
| v3#8  | Mülk oluşturmada sınırsız alanlar, geçersiz para birimi → 500       | Tüm alanlara üst sınır, `CURRENCIES` enum'u, politika varlık kontrolü; güvenilmeyen tur sayılı pazarlık ucu kaldırıldı (ADR 0016) | `tests/unit/security/validation.test.ts`                                      |
| v3#11 | Prod'da demo kimlik bilgisi, açık mailbox                           | `DEMO_MODE`                                                                                                                       | `tests/unit/security/auth.test.ts`                                            |
| v3#12 | MCP `create_hold` JWT'yi araç argümanı olarak alıyor                | Kimlik transport'tan (HTTP bearer / stdio env); argüman şemasında kimlik bilgisi yok                                              | `tests/unit/mcp/server.test.ts`                                               |
| v3#13 | gRPC güvensiz kanal, rate limit yok                                 | Opsiyonel TLS/mTLS (`GRPC_TLS_*`), interceptor rate limit                                                                         | `tests/unit/security/grpc-hardening.test.ts`                                  |
| v3#14 | Denylist fail-open, login CSRF, kilit/sıfırlama/doğrulama/2FA yok   | Fail-closed denylist + 5 dk erişim token'ı, login Origin kontrolü, hesap kilidi, e-posta doğrulama, şifre sıfırlama, passkey      | `tests/unit/security/auth.test.ts`, `tests/integration/v3-auth.test.ts`       |
| v3#16 | Compose `environment` sığ birleşmesi değişken düşürüyor             | `x-common-env` anchor'ı + `<<: *common-env`                                                                                       | `tests/unit/regressions/infra.test.ts`                                        |

## 5. Bilinen sınırlamalar

- Parmak izi (UA + Accept-Language) saldırgan tarafından değiştirilebilir; yalnızca kovaları
  ayırır. Gerçek istemci IP'si için bir ters vekil + `TRUSTED_PROXY_HOPS` önerilir.
- E-posta bağlantı token'ı outbox yükünde ve dev mailbox'ta (gönderilen e-postanın metni)
  bulunur; tek kullanımlık ve 30 dk / 24 saat ömürlüdür. Gerçek SMTP ile mailbox kapatılır.
- Redis erişilemezken erişim token'ları reddedilir (fail-closed) — bilinçli bir
  kullanılabilirlik ödünleşimi (bkz. `load/chaos.md`).
