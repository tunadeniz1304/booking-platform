# ADR 0035 — Doğrulanabilir ajan ticareti: kalıcı nonce, RFC 9421 ve harici doğrulayıcı

- Durum: Kabul edildi (v5 P1-1)
- Tarih: 2026-09-28
- İlgili: ADR 0023 (ajan ticareti ve mandate'ler), ADR 0025 (ES256 + JWKS)

## Bağlam

ADR 0025 ile mandate'ler ES256 + `kid` ile imzalanıyor ve açık anahtarlar
`/.well-known/jwks.json`'da yayımlanıyor. Üç açık kalmıştı:

1. Mandate nonce'unun tek kullanımlığı yalnız Redis'teydi (`SET NX`). Redis verisi kaybolursa
   (yeniden başlatma, `FLUSHALL`, failover) aynı mandate ikinci bir checkout'a bağlanabilirdi.
2. Ajanın HTTP isteğinin kendisi (gövde, yol, metot) kimin tarafından gönderildiği ve yolda
   değiştirilip değiştirilmediği açısından kanıtlanamıyordu; yalnız bearer token vardı.
3. "Üçüncü taraf platforma sormadan doğrulayabilir" iddiasının çalıştırılabilir bir kanıtı yoktu.

## Karar

1. **Kalıcı nonce (`AgentMandateUse`).** Birincil anahtar nonce'tur; bağlama
   `INSERT … ON CONFLICT DO NOTHING` (Prisma `createMany({ skipDuplicates })`) + okuma ile yapılır,
   ilk oturum kazanır. DB kaynak doğrudur; Redis yalnız önbellektir ve yazılamazsa karar değişmez.
   Mandate listesi (`used`) de artık bu tablodan okunur. Tek satırlık atomik ekleme olduğundan
   SERIALIZABLE yeniden deneme gerekmez.
2. **RFC 9421 HTTP Message Signatures (opsiyonel).** `AGENT_HTTP_SIGNATURE_KEYS` (ajanların açık
   anahtarlarından oluşan JWKS; `kid` = `keyid`) boşsa kapalıdır; doluysa `/api/ucp/*` ve
   `/api/agentic/*` imzasız/geçersiz istekleri 401 ile reddeder. Kurallar: `@method` ve
   (`@target-uri` ya da `@authority` + `@path`) imzalı; `created` zorunlu ve
   `AGENT_HTTP_SIGNATURE_MAX_AGE_SECONDS` penceresinde; gövde varsa `content-digest` (RFC 9530)
   imzalı ve gövdeyle eşleşmeli. Algoritmalar `ecdsa-p256-sha256` ve `ed25519`. İmza kimlik
   değildir; kullanıcı kimliği yine bearer token'dan gelir. UCP profili (`/.well-known/ucp`)
   `signing.jwks_uri`, `signing.mandate_alg` ve `signing.http_message_signatures` alanlarıyla
   bunu ilan eder. Kütüphane yerine ~250 satırlık yerel uygulama seçildi: gereken RFC 8941 alt
   kümesi küçük, bağımlılık ve lisans yükü yok, testlerle sabitlendi.
3. **Harici doğrulayıcı (`scripts/verify-mandate.ts`, `npm run mandate:verify`).** Yalnız `jose`
   ve Node çekirdeğini içe aktarır; DB, Redis, uygulama yapılandırması ya da sır kullanmaz.
   JWKS URL'sinden `kid` ile anahtarı seçer, `alg=ES256`, `typ`, `iss`, (opsiyonel) `aud` ve süreyi
   doğrular. Birim testi JWKS'i loopback HTTP sunucusundan servis eder: geçerli mandate kabul,
   payload'ı oynanmış ve HS256 mandate red.

## SD-JWT + key binding — ertelendi

`@sd-jwt/core` (Apache-2.0, düzenli yayımlanıyor; 2026-09 itibarıyla 0.21.x) lisans olarak
uygun. Yine de bu fazda eklenmedi:

- Mandate claim'lerinin tümü (limit, para birimi, ilan kısıtı, süre) satıcının kararı için
  gereklidir; seçici ifşa (selective disclosure) ile gizlenecek bir alan yoktur.
- Key binding'in çözdüğü "çalınmış mandate'in başkasınca sunulması" riski zaten üç katmanla
  kapalıdır: `sub` = oturumdaki kullanıcı (bearer token), tek kullanımlık kalıcı nonce ve
  opsiyonel RFC 9421 istek imzası.
- 0.x API'si henüz kararlı değil; ikinci bir mandate biçimi doğrulama yüzeyini ikiye katlar.

Yeniden değerlendirme tetikleyicisi: AP2/UCP'nin SD-JWT VC'yi zorunlu kılması ya da mandate'e
kişisel veri içeren claim eklenmesi.

## Sonuçlar

- Redis kaybı sonrası replay integration testle kanıtlanır (`p1-11-agentic-mandates.test.ts`).
- `AgentMandateUse` satırları KVKK dışa aktarımında `agentMandates[].used` olarak görünür; tablo
  kullanıcıya FK ile bağlı değildir (mandate denetim kaydı gibi saklanır).
- RFC 9421 imzasında imza tekrar kullanımı (aynı imzanın pencere içinde yeniden gönderilmesi)
  ayrıca izlenmez: yan etkili uçlar zaten `Idempotency-Key` ile tekilleşir.
- Ters vekil arkasında `@target-uri` sunucunun yeniden kurduğu URL ile (şema dahil) eşleşmelidir;
  TLS'in vekilde sonlandığı kurulumlarda ajanların `@authority` + `@path` kapsaması önerilir
  (Caddy `Host` başlığını korur).
