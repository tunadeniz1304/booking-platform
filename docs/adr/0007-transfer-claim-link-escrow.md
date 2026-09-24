# ADR 0007 — Rezervasyon devri: imzalı claim linki ve escrow ödeme

- Durum: Kabul edildi
- Tarih: 2026-09-24

## Bağlam

Eski P2P devir özelliğinde HMAC token alıcıdan hiç istenmiyordu (sunucu kendi imzaladığını doğruluyordu), `askPrice` tahsil edilmiyordu, token listeleme yanıtında sızıyordu ve JWT imza anahtarı HMAC anahtarı olarak yeniden kullanılıyordu (hata #3). Sonuç: bedava devir.

## Karar

`src/lib/transfer/transfer-service.ts`; API: `POST/GET /api/transfers`, `POST /api/transfers/claim`, `DELETE /api/transfers/[id]`, `GET /api/transfers/discover` (satıcı kimliği maskeli).

1. Satıcı `CONFIRMED` rezervasyonunu listeler. Sunucu ayrı `TRANSFER_SIGNING_SECRET` ile `{transferId, bookingId, exp, nonce}` içeren imzalı **claim linki** üretir ve yalnızca satıcıya bir kez gösterir; veritabanında yalnızca `sha256(token)` tutulur. Yedek (fallback) sır yoktur.
2. Alıcı linki açar: imza (timing-safe), süre (`TRANSFER_LINK_TTL_HOURS`) ve özet doğrulanır; nonce tek kullanımlıktır.
3. `askPrice` alıcıdan `PaymentProvider` ile yetkilendirilir (escrow); red → hiçbir şey değişmez.
4. Tek SERIALIZABLE transaction'da (P2034'te yeniden deneme): ilan `LISTED → COMPLETED`, rezervasyon ve ödeme sahipliği alıcıya geçer, ledger kayıtları yazılır, rezervasyon cache'i silinir. Transaction başarısızsa alıcının yetkilendirmesi iptal edilir.

Kurallar: `askPrice ≤ TRANSFER_MAX_ASK_RATIO × ödenen tutar` (varsayılan 1.0, karaborsa önleme); check-in'e `TRANSFER_MIN_HOURS_BEFORE_CHECKIN` (48) saatten fazla kalmalı; `FEATURE_TRANSFER` ile tamamen kapatılabilir.

## Kanıt

`tests/integration/transfer.test.ts`: token'sız claim 403, aynı token ikinci kez 409, eşzamanlı iki claim → 1 başarı, ödeme reddi → sahiplik değişmez.

## Sonuçlar

- Para gerçekten el değiştirir (mock PSP üzerinden); veritabanı okunsa bile token elde edilemez.
- Gerçek dünyada bu akış lisanslı bir ödeme kuruluşu veya escrow hizmeti gerektirir (bkz. [COMPLIANCE](../COMPLIANCE.md), 6493 sayılı Kanun).
- `/transfers` arayüz sayfası F8'e bırakıldı; özellik API üzerinden kullanılabilir.
