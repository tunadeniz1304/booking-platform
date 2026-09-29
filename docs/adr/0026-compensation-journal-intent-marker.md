# ADR 0026 — Telafi iadelerinin jurnali ve niyet işareti

- Durum: Kabul edildi (v5 F1b, v5#1)
- Tarih: 2026-09-28
- İlgili: ADR 0013 (ödeme sagası), ADR 0020 (çift girişli defter), ADR 0021 (emanet/ödeme)

## Bağlam

Tekil ödeme yolunda (`payForBooking`) saga telafisi iadeyi jurnale yazıyordu, ama sepet ödemesi
(`cart-payment.ts`, `cart-webhook.ts`), bölünmüş ödeme payları (`split-payment.ts`) ve devir
(`transfer-service.ts`: capture adımı telafisi, `sweepStuckTransfers`) telafilerinde PSP'de kart
çekilip iade ediliyor, defterde ise hiçbir hareket olmuyordu. Mutabakat (`reconcile`) yalnız
`Payment` ve COMPLETED devirleri karşılaştırdığı için bu para hareketleri "clean" görünüyordu.

İlk düzeltme denemesinde (`loop/recovered/v2-P0-3`) işaret PSP iadesinden sonra ya da capture'ın
kesin olmadığı durumlarda da yazılıyordu: void geçici hatayla düştüğünde (capture hiç olmamışken)
işaret kalıcı kalıyor, mutabakat hayali fark raporluyor ve süpürücü sonsuza dek yeniden deniyordu.

## Karar

1. **Ortak telafi jurnali.** Tüm telafiler `postCaptureCompensation`
   (`src/lib/ledger/booking-money.ts`) ile capture + iadeyi aynı jurnalde, idempotent anahtarla
   yazar; tekil yoldaki `journalCompensation` deseninin genellemesidir.
2. **Niyet işareti PSP iadesinden ÖNCE.** `markCompensationIntent` (`src/lib/ledger/reconcile.ts`)
   `PaymentEvent` satırı `comp:<providerRef>` yazar (idempotent upsert). Türler
   `CompensationMarkers`: `transferCapture`, `splitShare`, `splitShareLate`, `cart`, `cartLate`.
   İade işlenip jurnal yazılamazsa (yanıt kaybı, çökme, serileştirme tükenmesi) "işaret var,
   jurnal yok" farkı gerçekten oluşur ve tamamlanana dek raporlanır.
3. **İşaret yalnız capture kesinken önceden yazılır.** Saga capture'ı gördüyse ya da PSP void'i
   `already_captured` ile reddettiyse capture kesindir. Void edilen ya da capture'ı olmayan
   provizyon işaretlenmez.
4. **Belirsizde önce iade, sonra işaret.** Capture belirsizse (void geçici hatayla düştü) önce
   iade denenir; iade başarılıysa capture kanıtlanmıştır → işaret + jurnal. İade reddedilirse
   (capture yok) işaret yazılmaz: hayali fark ve sonsuz yeniden deneme olmaz.
5. **Tamamlama aynı anahtarlarla.** Devirde süpürücü (`rejournalTransferRefunds`), sepet/pay
   telafisinde `saga-compensation-retry`, geç başarı iadesinde webhook yeniden teslimi aynı iade
   ve jurnal anahtarlarıyla tamamlar; PSP tek iade yapar, jurnal tek kez yazılır.
6. **Mutabakat işaret tabanlı.** `reconcile` o günün işaretlerini okuyup `Payment`'a ek olarak
   `CartPayment`, `PaymentShare` ve FAILED devirleri de kapsar; telafi edilen ödemenin PSP tarafını
   jurnalden değil işaretten bilir.
7. **Telafi edilmiş öznenin tutarı donar (v5-F9).** İşaretli ödemede mutabakat PSP tutarını
   öznenin satırından (`CartPayment.amountMinor`) okur; bu yüzden telafi sonrası satır yeni bir
   deneme tarafından ezilmez. `payCart` deneme alanlarını (tutar, para birimi, sağlayıcı) yalnız
   açık durumdaki (`PENDING`, `REQUIRES_ACTION`, `FAILED`, `VOIDED`) satıra yazar; sepet OPEN'a
   dönüp büyüse de `REFUNDED` satır telafi jurnaliyle mutabık kalır.

## Sonuçlar

- Her telafiden sonra `psp_clearing` Σ=0 ve mutabakat farkı 0
  (`tests/integration/v5-compensation-ledger.test.ts`).
- Void-başarısız + capture-yok durumunda yanlış fark ya da kalıcı işaret yok.
- Bedel: her telafide iade öncesi bir ek `PaymentEvent` yazımı; işaret ile jurnal arasındaki
  kısa pencerede mutabakat geçici fark görebilir (tasarım gereği: tamamlanana dek raporlanır).
