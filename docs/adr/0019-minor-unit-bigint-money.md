# ADR 0019 — `BigInt` minor-unit para kolonları ve ISO 4217 üs tablosu

- Durum: Kabul edildi
- Tarih: 2026-09-27

## Bağlam

ADR 0004 hesaplamayı tamsayı minor-unit'e taşıdı, ancak veritabanı hâlâ `Decimal(10,2)` saklıyordu (hata v4#15): 3 haneli birimler (KWD, BHD) kesiri kaybediyor, 0 haneli birimler (JPY, VND) anlamsız kesir taşıyor, büyük IDR/VND tutarları 99.999.999,99 sınırını aşıyordu. Her okuma/yazma `Decimal ⇄ string ⇄ minor` dönüşümü yapıyor ve "×100" varsayımı kod içine dağılmıştı.

## Karar

- Para kolonları `BigInt <ad>Minor` (`Property.basePriceMinor`, `RoomType.priceModifierMinor`, `InventoryDay.priceMinor`, `Booking.totalPriceMinor`, `Payment.amountMinor|refundedAmountMinor`, `LedgerEntry|Payout|Invoice.amountMinor`, `Invoice.taxAmountMinor`, `PriceHistory.avgNightlyPriceMinor`, `BookingTransfer.askPriceMinor`); para birimi satırın `currency`'sinden, yoksa tesisinkinden gelir.
- `src/lib/money/currencies.ts`: ISO 4217 üs tablosu (JPY 0, TRY/EUR/USD 2, KWD/BHD 3 …) ve uygulamadaki **tek** yuvarlama fonksiyonu `roundHalfUp` (yarım sıfırdan uzağa). `multiplyRate`, `bpsOf`, kur çevirisi (üs farkı dahil) bunu kullanır.
- **Half-up, banker's değil:** müşteri fişi, e-Arşiv faturası ve PSP'ler (Stripe/iyzico) ticari yarım-yukarı kuralını izler; farklı kural mutabakatta kuruş farkı üretir. Banker's rounding'in istatistiksel yansızlık avantajı tek tek yuvarlanan konaklama tutarlarında anlamlı değildir. PostgreSQL `ROUND(numeric)` de aynı kuralı izlediğinden backfill SQL'i ile uygulama aynı sonucu verir.
- Uygulama içinde tutar `number` (≤ 2⁵³) kalır; `minorFromDb` aralık dışını sessizce kesmez, hata fırlatır. Sınırda `minorToDb`/`minorFromDb`/`moneyFromDb`.
- **Expand/contract:** `20260927100000_money_minor_expand` yeni kolonları ekler, eski kolonları NULL'a açar ve satır içi backfill yapar; `npm run money:backfill` (`scripts/money-backfill.ts`) aynı UPDATE'i idempotent (`*Minor IS NULL` koşulu) tekrarlar ve eski/yeni minor toplamlarını karşılaştırır. `20260927100100_money_minor_contract` son bir backfill'den sonra `*Minor`'u `NOT NULL` yapar ve eski kolonları düşürür. Üretimde iki migration arasında backfill + toplam kontrolü koşulur.
- API geriye uyumu: yanıtlar `*Minor` alanlarını `number` olarak verir ve eski ondalık alanları (`totalPrice`, `basePrice`, `amount` …) üsse göre biçimlenmiş string olarak korur (`src/lib/money/legacy-json.ts`). Gözden kaçan BigInt için `BigInt.prototype.toJSON` güvenlik ağı vardır.

## Kanıt

`tests/unit/money/currencies.test.ts` (KWD ve JPY round-trip fast-check, half-up property), `tests/unit/regressions/v4-15-minor-unit-money.test.ts`, `tests/integration/v4-money-backfill.test.ts` (gerçek migration SQL'i eski şemanın kopyasında: toplam eşitliği, idempotent ikinci koşu, contract sonrası no-op).

## Sonuçlar

- Her ISO birimi kayıpsız saklanır; "×100" varsayımı tek tabloya indi.
- Kolon adları değişti: ham SQL ve dış raporlar `*Minor` kolonlarını okumalı. Eski ondalık API alanları bir sürüm boyunca korunur, sonra kaldırılabilir.
