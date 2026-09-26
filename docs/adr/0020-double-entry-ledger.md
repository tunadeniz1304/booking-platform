# ADR 0020 — Çift girişli defter (ledger v2) ve günlük mutabakat

- Durum: Kabul edildi (v4, F2b)
- Tarih: 2026-09-27
- İlgili: ADR 0004 (minor-unit para), ADR 0013 (ödeme sagası, v3 defteri), ADR 0019 (minor-unit migration)

## Bağlam

v3 `LedgerEntry` tek taraflı bir olay günlüğüdür (CHARGE / REFUND / TRANSFER_*): hangi
paranın kime ait olduğu, vergi ve komisyonun nerede durduğu, iki tarafın eşit olup olmadığı
izlenemez. Ondalık `Decimal` tutarlar ve PSP ile karşılaştırma yapılmaması, sessiz
tutarsızlıkları (eksik iade kaydı, çift tahsilat) fark edilmez kılar.

## Karar

- **Model:** `LedgerAccount` (hesap planı) + `JournalEntry` (başlık, `idempotencyKey`
  unique, kaynak `bookingId/paymentId/transferId`, `occurredAt`, `memo`, `linesHash`) +
  `JournalLine` (`amountMinor BIGINT > 0`, `currency`, `side DEBIT|CREDIT`). İlişki yalnızca
  hesap ve başlık arasında; iş tablolarına FK yok (defter iş verisi silinse de kalır).
- **Hesap planı:** `psp_clearing`, `guest_receivable` (varlık, borç-doğal); `escrow`,
  `host_payable:<userId>`, `tax_payable`, `guest_credit:<userId>`, `platform_revenue`
  (alacak-doğal). Kişi alt hesapları ilk kullanımda açılır; kod kuralı DB CHECK'iyle korunur.
- **Akış:** capture → `Dr psp_clearing / Cr escrow + tax_payable`; konaklama sonrası
  release → `Dr escrow / Cr host_payable + platform_revenue`; payout →
  `Dr host_payable / Cr psp_clearing`. İade paranın o an bulunduğu hesaptan düşer, karta ya da
  `guest_credit`'e gider. Devir: `Dr psp_clearing / Cr host_payable(satıcı) + komisyon`.
- **Denge iki katmanda:** uygulamada `assertBalanced` (para birimi başına Σborç = Σalacak,
  ≥2 satır, pozitif bigint); DB'de `DEFERRABLE INITIALLY DEFERRED` constraint trigger
  (işlem sonunda aynı kontrol) + UPDATE/DELETE reddeden append-only tetikler (düzeltme =
  ters kayıt). Prisma 5 etkileşimli işlemde COMMIT hatasını çağırana iletmediği
  (işlem geri alınır ama `$transaction` başarılı döner) için `postJournal` yazdıktan sonra
  `SET CONSTRAINTS … IMMEDIATE` ile kontrolü işlem içinde tetikler, sonra yeniden erteler.
- **Idempotency:** doğal anahtar (`booking-captured:<paymentId>` vb.), `INSERT … ON CONFLICT DO NOTHING`; aynı anahtar + farklı içerik (`linesHash`) → 409. `tx` dışarıdan
  verilir, iş durumu ile defter aynı `withSerializableRetry` işleminde yazılır.
- **Mutabakat:** `reconcile(date)` o gün PSP hareketi (paidAt/refundedAt, tamamlanan
  devir) ya da jurnali olan her özne için PSP toplamını jurnaldeki `psp_clearing` toplamıyla
  karşılaştırır; fark satırları, dengesiz jurnaller ve eşleşmeyen webhook olayları
  raporlanır. BullMQ `ledger-reconcile` (`LEDGER_RECONCILE_CRON`, dünü işler), admin
  `GET /api/admin/reconciliation?date=`, metrik `ledger_imbalance_total{source}`.
- **Uyumluluk:** `listBookingLedger` eski `LedgerEntry` satırlarını jurnalden türetilen
  eşdeğerlerle birleştirir (dual-write çift sayılmaz); v3 okuyucuları bozulmaz.

## Sonuçlar

- (+) Her para hareketi dengeli ve değiştirilemez; bakiye/mizan her an hesaplanabilir.
- (+) PSP ↔ defter farkı günlük ve gerekçeli görünür.
- (−) Servisler bağlanana kadar mutabakat tüm ödemeleri "jurnalsiz" gösterir; geçiş
  tarihinden önceki ödemeler için fark beklenir (gerekirse açılış kaydıyla kapatılır).
- (−) `SET CONSTRAINTS` her jurnalde iki ek sorgu; hacim düşük, kabul edildi.

## Ek: Kredi (P1-7 sadakat & cüzdan)

- **Fonlama:** cashback bir pazarlama ikramıdır; ayrı gider hesabı açılmadı, `creditIssued`
  (fundedBy `platform`) ile **Dr platform_revenue** (kontra-gelir) / Cr `guest_credit:<userId>`.
  Süresi dolan kalan `creditExpired` ile tersine döner (Dr guest_credit / Cr platform_revenue,
  anahtar `credit-expired:<lotId>:<önceden düşülen>`).
- **Lot'lar** (`WalletCredit`) yalnız harcama sırası ve son kullanma izidir; para jurnalde.
  Değişmez: guest_credit bakiyesi = Σ lot kalanı + Σ RESERVED harcama (int testte her adımda).
- **Kısmi ödeme:** kredi rezervi (lot kalanı düşer, jurnal yok) → kart provizyon/capture →
  onay pivotunda AYNI işlemde `creditSpent` (Dr guest_credit / Cr escrow + tax_payable; vergi
  payı = vergi(toplam) − vergi(kart)). `Payment.amountMinor` yalnız kart payıdır → mutabakat
  (psp_clearing) değişmez. Kart hatası/saga telafisi/tutma dolumu rezervi bırakır.
- **İade simetrisi:** iptal iadesi kart ve kredi paylarına ödendikleri oranda (`allocateMinor`)
  bölünür; kredi payı `refundIssued to:"guest_credit"` ile emanetten döner ve orijinal lot'un
  son kullanma tarihiyle yeni lot açılır. Eski defter görünümü (`listBookingLedger`) krediye
  iadeyi PSP parası saymaz.
- Sınır: kredi yalnız tekil rezervasyonda (sepet/bölünmüş ödeme yok); tam kredi ödemesi yok
  (kartla en az `WALLET_MIN_CARD_MINOR`); talep (claim) iadeleri yalnız kart payından.
