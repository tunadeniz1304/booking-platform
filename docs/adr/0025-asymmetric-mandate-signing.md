# ADR 0025 — AP2 mandate'lerinin asimetrik (ES256) imzası ve JWKS

- Durum: Kabul edildi (v2-P1-1)
- Tarih: 2026-09-27
- İlgili: ADR 0023 (ajan ticareti ve mandate'ler; bu ADR onun imza kararını değiştirir)

## Bağlam

ADR 0023'te AP2 intent mandate'i HS256 ile, platformun gizli anahtarıyla imzalanıyordu. Simetrik
imzayı yalnız anahtarı bilen doğrulayabilir: ajan ya da PSP, mandate'in gerçekten kullanıcı adına
platform tarafından verildiğini platforma sormadan kontrol edemez, anahtarı paylaşmak ise ona imza
yetkisi de verir. AP2, mandate'lerin üçüncü tarafça doğrulanabilir olmasını ve ECDSA gibi
deterministik olmayan asimetrik imzayı öneriyor.

## Karar

1. **ES256 + `kid`.** Mandate kompakt JWS'tir; protected header
   `{ alg: "ES256", typ: "ap2-intent-mandate+jwt", kid }`. Claim'ler değişmedi.
2. **Anahtar kaynağı** (`src/lib/agentic/mandate-keys.ts`):
   - `AGENT_MANDATE_PRIVATE_KEY`: etkin imza anahtarı, PKCS#8 PEM (tek satırda `\n` kaçışı
     kabul) ya da özel EC JWK (JSON). Yalnız P-256 kabul edilir.
   - `kid` önceliği: `AGENT_MANDATE_KEY_ID` > JWK `kid` > RFC 7638 thumbprint.
   - Demo/test (`isDemoMode()`): anahtar verilmemişse `AGENT_MANDATE_SIGNING_KEY` (≥32) ya da
     `JWT_SECRET`'tan HKDF (`booking-platform:agent-mandate:es256:v1`) ile **deterministik**
     P-256 anahtarı türetilir; yeniden başlatmada kid aynı kalır.
   - **Fail-closed:** demo dışında anahtar yoksa, anahtar bozuksa ya da P-256 değilse (RSA,
     P-384, simetrik) imza, doğrulama ve JWKS 503 `MANDATE_KEYS_UNAVAILABLE` döner. Bozuk
     anahtar demo'da da türetmeye düşmez.
3. **JWKS.** `GET /.well-known/jwks.json` yalnız açık alanları (`kty, crv, x, y, kid, alg, use`)
   yayımlar; `Content-Type: application/jwk-set+json`,
   `Cache-Control: public, max-age=AGENT_MANDATE_JWKS_MAX_AGE_SECONDS` (300). Proxy
   `/.well-known/ucp` ve `/.well-known/jwks.json`'u oturumsuz geçirir
   (`PUBLIC_DISCOVERY_PATHS`). UCP profili `ap2.intent_mandate.alg` ve `jwks_uri` bildirir.
4. **Rotasyon.** Yeni anahtar `AGENT_MANDATE_PRIVATE_KEY` (+ yeni `AGENT_MANDATE_KEY_ID`) olur;
   eski anahtarın **açık** JWK'sı `kid` ile `AGENT_MANDATE_PREVIOUS_PUBLIC_KEYS`'e (JWKS JSON ya
   da JWK dizisi) eklenir. Doğrulama anahtarı başlıktaki `kid` ile seçilir; kid yok ya da
   bilinmiyor → 403 `MANDATE_INVALID`. Eski listede özel alan (`d`, `p`, `q`, `k`, …) ya da kid'siz
   anahtar varsa yapılandırma reddedilir (503). Eski kid, en az
   `AGENT_MANDATE_MAX_TTL_MINUTES` + JWKS önbellek süresi kadar listede tutulmalıdır.
5. **Eski HS256 mandate'ler açıkça reddedilir.** `algorithms: ["ES256"]`; geçiş penceresi yok.
   Mandate'ler kısa ömürlüdür (varsayılan 60 dk) ve yeniden verme recent-auth ile tek adımdır;
   simetrik anahtarı doğrulama yolunda tutmak, "yalnız asimetrik" iddiasını zayıflatır ve
   alg-karışıklığı yüzeyi açardı. Geçişte açık mandate'i olan ajan 403 `MANDATE_INVALID` alır;
   kullanıcı yeni mandate verir.

## Sonuçlar

- (+) Ajan/PSP mandate'i `jwks_uri`'den aldığı açık anahtarla bağımsız doğrular; imza yetkisi
  platformda kalır.
- (+) Kid tabanlı rotasyon kesintisizdir; bilinmeyen kid reddedilir.
- (−) Production'da operatör P-256 anahtarını sağlamalıdır (`secrets-init` üretmez); aksi hâlde
  mandate verme/doğrulama 503.
- (−) Anahtar env'de tutulur; KMS/HSM entegrasyonu kapsam dışı.
- Nonce tek kullanımlığı, iptal listesi ve tutar/ilan kapsamı değişmedi (ADR 0023).

Anahtar üretimi örneği:

```sh
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt
```
