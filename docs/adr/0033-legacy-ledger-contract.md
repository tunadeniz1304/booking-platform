# ADR 0033 — Eski defter ve ondalık para alanlarının kaldırılması (contract adımı)

- Durum: Kabul edildi (v5 P0-3)
- Tarih: 2026-09-28
- İlgili: ADR 0019 (minor-unit para, expand/contract), ADR 0020 (çift girişli defter),
  ADR 0021 (emanet/ödeme)

## Bağlam

ADR 0020 çift girişli jurnali getirirken v3 `LedgerEntry` tablosunu geçiş süresince korudu:
tahsilat (`applyConfirmation`), iptal iadesi (`cancelAndRefund`) ve devir (`claimTransfer`) iki
yere yazıyordu (dual-write), okuyucu `listBookingLedger` iki kaynağı birleştirip eşleşenleri
tekilleştiriyordu. ADR 0019'un expand/contract geçişi de v4'te tamamlanmıştı; geriye ölü bir
backfill modülü/script'i ve API yanıtlarında `*Minor` alanlarının yanına eklenen geriye uyumlu
ondalık alanlar (`totalPrice`, `amount`, `basePrice`, …) kalmıştı.

Dual-write iki gerçek kaynağı demekti: iki tablo ayrışabilir (kredi payı, devredilmiş iade
referansı gibi özel durumlar zaten ayrı kurallar gerektiriyordu) ve her yeni para yolu iki yazım
ister. Ondalık alanlar ise istemcileri float aritmetiğine davet ediyordu.

## Karar

1. **Tek defter: jurnal.** `LedgerEntry` yazımları kaldırıldı; `listBookingLedger`
   (`src/lib/ledger/legacy.ts`) v3 biçimli satırları (CHARGE / REFUND / TRANSFER_PAYMENT /
   TRANSFER_PAYOUT) yalnız jurnalden türetir. Devredilmiş rezervasyonun iptal iadesi, eski
   defterdeki gibi alıcıya ve devir ödemesi referansına (`buyerPaymentRef`) bağlanır.
2. **Tablo düşer.** `20261001100000_drop_legacy_ledger` migration'ı `LedgerEntry`'yi ve
   `LedgerKind` enum'unu kaldırır. Eski satırlar jurnalle birlikte yazıldığı için bilgi kaybı
   yoktur; `LedgerKind` artık TypeScript birleşim tipidir. Yük/kaos değişmez sorguları
   (`scripts/load-assert.ts`, `load/*`) çift tahsilatı `JournalEntry` (`BOOKING_CAPTURED`)
   üzerinden sayar.
3. **Ölü backfill kaldırıldı.** `src/lib/money/backfill.ts`, `scripts/money-backfill.ts`,
   `npm run money:backfill` ve `tests/integration/v4-money-backfill.test.ts` silindi.
   `regression: v4#15` testi korunur ve şemayı doğrudan denetler: `Decimal` para kolonu yok,
   her para alanı `BigInt *Minor`. (v5 "v4 regresyonları korunur" kuralının tek bilinçli
   istisnası: davranış değil, silinen geçiş aracı test ediliyordu.)
4. **API yalnız minor-unit.** Yanıtlardaki ondalık kopyalar kaldırıldı; istemciler `*Minor` +
   `currency` alanlarını okur ve biçimlemeyi kendisi yapar (UI: `Formatter.money`). gRPC
   `ReserveRoomResponse.total_price` ve `ChargeResponse.charged_amount` alanları `reserved`
   yapıldı; yerlerine `total_price_minor` / `charged_amount_minor`. Kullanıcıdan gelen ondalık
   girişler (ev sahibinin taban fiyatı formu gibi) istek sözleşmesidir ve sunucuda tek noktadan
   minor-unit'e çevrilir.

## Sonuçlar

- `grep -rn "ledgerEntry\." src` = 0; migration temiz DB'de ve `LedgerEntry` satırları olan
  v4 şemasında uygulanır.
- Kırıcı API değişikliği (CHANGELOG "Removed"): ondalık alan okuyan dış istemciler `*Minor`'a
  geçmelidir.
- Geri dönüş: tablo yeniden oluşturulabilir ve jurnalden türetilen görünümle doldurulabilir;
  ancak buna gerek yoktur, çünkü tek okuyucu zaten görünümdür.
