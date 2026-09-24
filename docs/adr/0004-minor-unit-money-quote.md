# ADR 0004 — Minor-unit tamsayı para ve tek `computeTotal()` quote

- Durum: Kabul edildi
- Tarih: 2026-09-24

## Bağlam

Eski akışta checkout `(basePrice + priceModifier) × nights` gösteriyor, sunucu `Availability` fiyatlarını float toplayıp `toFixed` ile yuvarlıyordu: gösterilen ≠ tahsil edilen (hata #8, #20). İstemci para birimini seçebiliyordu (hata #7). All-in fiyat kuralları (FTC 16 CFR 464, AB Omnibus) gösterilen toplamın tahsil edilenle aynı olmasını gerektirir.

## Karar

- `src/lib/money/money.ts`: `Money { amount: number (minor unit, tamsayı); currency }`, `add`, `multiplyRate` (tek noktada yuvarlama), `allocate` (kalan kuruşları dağıtır), `toMinor` / `toDecimalString`. Veritabanında `Decimal` saklanır; hesaplama asla float toplamayla yapılmaz.
- Tarihler UTC "gece" tipiyle (`YYYY-MM-DD`, `src/lib/time/nights.ts`); yerel saat kullanılmaz.
- `src/lib/pricing/quote.ts` `computeTotal({ roomId, checkIn, checkOut, guests })` → `Quote { nights[], subtotal, taxes[] (konaklama vergisi ACCOMMODATION_TAX_RATE, varsayılan 0.01), total, quoteId, expiresAt }`. Arama kartı, PDP, checkout ve `Payment.amount` **aynı fonksiyonu** kullanır (`GET /api/quote`).
- Quote Redis'te `QUOTE_TTL_MINUTES` (15) saklanır; `POST /api/bookings` `quoteId` alır, sunucu kilit altında yeniden hesaplar; fark varsa `409 PRICE_CHANGED`, süresi dolmuşsa `409 QUOTE_EXPIRED`.
- Tahsilat para birimi daima `property.currency`; başka birimde gösterim yalnızca bilgi amaçlıdır ve rezervasyona `fxSnapshot` olarak yazılır (`src/lib/money/fx.ts`; statik `data/fx-rates.json` veya `FX_RATES_JSON`, ağ yok).

## Kanıt

`fast-check` property testleri (`tests/unit/money/money.test.ts`, `tests/unit/pricing/quote.test.ts`): rastgele girdilerde `allocate` toplamı korur ve kart = PDP = checkout = tahsilat.

## Sonuçlar

- Kuruş kaybı veya çift yuvarlama yok; fiyat farkı açık bir hata kodu olarak kullanıcıya döner.
- JavaScript `number` güvenli tamsayı sınırı (2⁵³) konaklama tutarları için fazlasıyla yeterli.
