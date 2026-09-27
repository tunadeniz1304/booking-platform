# ADR 0023 — Ajan ticareti v2: ACP gerçek SPT, UCP lodging ve AP2 intent mandate'leri

- Durum: Kabul edildi (v4, F7 / P1-11)
- Tarih: 2026-09-26
- İlgili: ADR 0013 (ödeme saga'sı), ADR 0015 (ajan rezervasyon kanalı), ADR 0020 (çift girişli defter)

## Bağlam

v3'te ajanlar MCP (`create_hold`) ve ACP benzeri `/api/agentic/checkout_sessions` ile rezervasyon
yapabiliyordu; ödeme token'ı yalnız `spt_mock_*` idi ve ajanın ne kadar harcayabileceğine dair
kullanıcı yetkisi yoktu: geçerli bir bearer token taşıyan her ajan, her tutarı ödeyebiliyordu.
Pazar (Google UCP lodging, OpenAI/Stripe ACP, Google AP2) iki şeyi bekliyor: gerçek PSP token'ı
ve kullanıcının imzaladığı, sınırlı bir harcama yetkisi (mandate).

## Karar

1. **ACP gerçek SPT (`src/lib/agentic/spt.ts`).** Stripe aktifse (`PAYMENT_PROVIDER=stripe`)
   `spt_…` Stripe Shared Payment Token'dır: `GET /v1/shared_payment/granted_tokens/{id}` ile
   kaydı okunur, `usage_limits` (etkin, para birimi, `max_amount`, `expires_at`) siparişe karşı
   doğrulanır (aşım 402 `SPT_*`), PaymentIntent `shared_payment_granted_token` ile oluşturulur
   (`StripeProvider.authorize`, `capture_method=manual`; saga aynı). Stripe yoksa demo
   `spt_mock_<ok|decline|3ds>` MockPsp'e eşlenir. Karşı tarafın token'ı asla kabul edilmez.
   Platform **merchant-of-record** kalır: tahsilat platform hesabına, jurnal
   `bookingCaptured` (ADR 0020) değişmedi.
2. **AP2 intent mandate (`src/lib/agentic/mandate.ts`).** Kompakt JWS, `typ:
ap2-intent-mandate+jwt`, HS256 (v2-P1-1 ile ES256 + JWKS; bkz. [ADR 0025](0025-asymmetric-mandate-signing.md)), **ayrı anahtar** `AGENT_MANDATE_SIGNING_KEY` (boşsa JWT
   sırrından ayrı HKDF bağlamıyla türetilir; access token mandate yerine geçemez). Claim'ler:
   `sub`, `aud` (`AGENT_MANDATE_AUDIENCE`), `iss`, `maxAmountMinor`, `currency`, `expiresAt`
   (+`exp`), opsiyonel `propertyId[]`, tek kullanımlık `nonce`.
   - Verme: `POST /api/account/agent-mandates` — doğrulanmış e-posta + recent-auth (403
     `REAUTH_REQUIRED` → kullanıcı step-up yapar). TTL varsayılan 60 dk, azami
     `AGENT_MANDATE_MAX_TTL_MINUTES`. Audit `agent_mandate.issued`.
   - Zorlama: `completeCheckoutSession` PSP'ye gitmeden önce `authorizeMandate` çağırır.
     Yok → 403 `MANDATE_REQUIRED`; imza/biçim → 403 `MANDATE_INVALID`; süre → 403
     `MANDATE_EXPIRED`; başka kullanıcı / para birimi / ilan → 403; **tutar > limit → 402
     `MANDATE_AMOUNT_EXCEEDED`** + `details.stepUp` (kullanıcı yeniden doğrulayıp daha yüksek
     limitli yeni mandate imzalar). Nonce Redis `SET NX` ile ilk checkout oturumuna bağlanır:
     aynı oturumun yeniden denemesi (3DS, red sonrası yeni SPT, PRICE_CHANGED) serbest, başka
     oturumda 409 `MANDATE_REPLAYED`. Ret/kabul audit'lenir (`agent_mandate.rejected|accepted`).
   - `AGENT_MANDATE_REQUIRED=false` yalnız geliştirme içindir (verilen mandate yine doğrulanır).
3. **UCP (`src/lib/agentic/ucp.ts`).** `GET /.well-known/ucp` profil belgesi (sürüm, servis uçları,
   `dev.ucp.shopping.checkout` + lodging ve `ap2_mandate` uzantıları, ödeme handler'ı, mandate
   biçimi). `/api/ucp/checkout-sessions` (POST, GET/PUT `{id}`, POST `{id}/complete`) yalnız
   şema eşler (`line_items[0].item.id` → oda, `lodging` → tarih/misafir, `payment_data.credential`
   → SPT, `ap2.intent_mandate` → mandate; durumlar `ready_for_complete|requires_escalation|
completed|canceled`) ve ACP servislerini çağırır — iş mantığı tek yerde.
4. **MCP.** `create_hold` ve yeni `checkout_stay` doğrulanmış e-posta ister (F1b'den ertelenen
   v4#6 maddesi); `checkout_stay` SPT + mandate alır (kimlik yine transport'tan). `npm run
mcp:smoke` mandate'li başarı ile mandate'siz/dolmuş/aşan/replay/doğrulanmamış redlerini doğrular.

## Sonuçlar

- (+) Ajan harcaması kullanıcının açık, süreli, tutar sınırlı yetkisine bağlandı; çalınan bearer
  token tek başına ödeme yapamaz (mandate da gerekir) ve limitin üstü her zaman kullanıcıya döner.
- (+) UCP ve ACP aynı saga, aynı fiyat motoru, aynı defter; ikinci bir ödeme yolu yok.
- (−) HS256: mandate'i yalnız platform doğrulayabilir (üçüncü taraf doğrulaması için ES256/EdDSA +
  JWKS gerekir — [ADR 0025](0025-asymmetric-mandate-signing.md) ile çözüldü). Mandate kayıtları DB'de değil; iptal (revocation) yok, kısa TTL ve
  tek kullanımlık nonce ile sınırlanır. Redis kaybında nonce tekrar kullanılabilir (TTL içinde).
- (−) Stripe SPT uç noktası/parametre adları önizleme API'sine göre modellendi ve yalnız ağsız
  fake ile test edildi; canlı Stripe hesabıyla smoke yapılmadı. UCP profili resmi şemanın
  sadeleştirilmiş eşlemesidir (lodging uzantısı bize özgü ad).
