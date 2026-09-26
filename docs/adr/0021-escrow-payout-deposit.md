# ADR 0021 — Escrow serbest bırakma, ev sahibi payout'ları, rezerv (ve depozito)

- Durum: Kabul edildi (v4, F4 / P1-4)
- Tarih: 2026-09-28
- İlgili: ADR 0020 (çift girişli defter), ADR 0019 (minor-unit para), ADR 0007 (devir), ADR 0013 (ödeme sagası)

> Portföy projesidir: gerçek para hareketi yoktur; vergi/DAC7 çıktıları eğitim amaçlıdır,
> hukuki veya mali tavsiye değildir.

## Bağlam

F2c'de tahsilat `Dr psp_clearing / Cr escrow + tax_payable` olarak deftere yazılıyor, fakat
emanetteki para hiçbir zaman ev sahibine geçmiyordu: komisyon modeli yoktu, tek payout yolu
devir satıcısına ödemeydi (devir kesinleşince açılan `Payout`, mock işin doğrudan PAID
yapması). Pazar yeri devleri (Airbnb, Vrbo, Stripe Connect platformları) parayı girişten sonra
serbest bırakır, komisyonu bu anda ayırır, yeni/riskli satıcılar için rezerv tutar ve
AB'de DAC7 kapsamında satıcı başına yıllık bedel raporlar.

## Karar

### Hesap ve jurnal şablonları

- Yeni hesap türü `HOST_RESERVE` → `host_reserve:<userId>` (yükümlülük, alacak-doğal).
  Rezerv `host_payable`'ın alt kodu yerine AYRI tür: kod kuralı CHECK'i (`kind:ownerId`)
  değişmeden kalır, bakiye sorguları tür üzerinden ayrışır.
- `escrowReleased` (anahtar `escrow-released:<bookingId>`):
  `Dr escrow / Cr platform_revenue (komisyon) / Cr host_reserve (rezerv) / Cr host_payable (kalan)`.
- `reserveReleased` (anahtar `reserve-released:<bookingId>`): `Dr host_reserve / Cr host_payable`.
- Capture şablonu DEĞİŞMEDİ (F2c kararı: capture'da komisyon yok).

### Serbest bırakma (escrow → ev sahibi)

- Zamanlama: tesisin YEREL giriş anı + `PAYOUT_RELEASE_HOURS` (vars. 24). BullMQ bakım
  kuyruğunda tekrarlayan `escrow-release` işi (`ESCROW_RELEASE_CRON`, vars. 30 dk) adayları
  UTC ön filtresiyle seçer, kesin kararı saat dilimiyle verir (complete-stays ile aynı desen).
  Rezervasyon başına gecikmeli iş yerine süpürme seçildi: onay yoluna (sepet/saga) dokunmaz,
  kaçan iş olmaz, jurnal anahtarı idempotent.
- Tutar İŞ TABLOSUNDAN değil JURNALDEN okunur: rezervasyonun `escrow` satırları toplamı. Böylece
  kısmi iade düşülmüş olur; tam iade edilmiş/iptal rezervasyonda bakiye 0 → serbest bırakma
  yapılmaz → payout üretmez. İptalde emanette kalan pay (politika gereği iade edilmeyen)
  aynı zamanlamayla ev sahibine geçer (ev sahibinin iptal tazminatı).
- Komisyon `PLATFORM_COMMISSION_BPS` (vars. 1500) vergi hariç tutar üzerinden; rezerv
  `HostAccount.reservePercentBps ?? PAYOUT_RESERVE_BPS` (vars. 500) komisyon sonrası paydan.
  Tek yuvarlama `roundHalfUp` (ADR 0019). `RESERVE_RELEASE_DAYS` (vars. 30) sonra aynı iş
  rezervi açar.
- Satır kilidi (`SELECT … FOR UPDATE` Booking) + SERIALIZABLE: eşzamanlı iptal ile serbest
  bırakma sıralanır.

### Serbest bırakma sonrası iade

`postRefundFromEscrow` önce `escrow-released:<bookingId>` jurnaline bakar; varsa iade
`from: "released"` dalına gider: vergi payı `tax_payable`'dan, vergi hariç kısım serbest
bırakmadaki komisyon oranında `platform_revenue`'dan, kalanı `host_payable`'dan. Ev sahibi
bakiyesi eksiye düşebilir (ev sahibi borçlu); payout motoru yalnızca pozitif kullanılabilir
bakiyeyi öder ve bekleyen payout'u bakiye yetmezse `INSUFFICIENT_BALANCE` ile FAILED yapar.
Rezerv bu iadede kullanılmaz (sade model; rezerv açılınca host_payable'ı zaten dengeler).
Aynı anahtarla jurnal varsa yeniden hesaplanmaz (retry arasında serbest bırakma olsa bile
içerik çakışması/409 olmaz).

### Payout motoru

- `HostAccount` (userId tekil, ilişki alanı yok): `provider` (mock|stripe),
  `connectedAccountRef`, `kycStatus`, `payoutsEnabled`, yönetici durdurması
  (`payoutsPaused` + gerekçe/zaman/kim, audit `payout.paused|resumed`), `reservePercentBps`,
  `payoutSchedule` (DAILY/WEEKLY/MONTHLY, UTC dönemleri).
- `HostPayout` (yeni): serbest `host_payable` bakiyesinden açılır. Kullanılabilir =
  host_payable − bekleyen payout'lar (iki tablo). `PAYOUT_MIN_MINOR` altı açılmaz.
- Tek motor (`payouts` işi, `PAYOUT_CRON`): (1) devir `Payout`'ları, (2) ev sahibi payout'u
  açma, (3) PENDING ev sahibi payout'larını gönderme. Eski "doğrudan mock PAID" yolu kaldırıldı;
  devir payout'ları da aynı sağlayıcı arayüzü, durdurma ve bakiye korumasından geçer
  (`po_mock_…` referans biçimi korundu). Sağlayıcıya gönderim tx DIŞINDA, idempotency anahtarı
  payout kimliğinden (`payout:<id>`, `host-payout:<id>`); başarıda aynı tx'te PAID +
  `payoutReleased` (`Dr host_payable / Cr psp_clearing`). Hata: devirde PENDING kalır
  (deneme sayısı artar), ev sahibinde FAILED (tutar bakiyeye döner, takvimi tüketmez).
- Sağlayıcı arayüzü `PayoutProvider`: `createConnectedAccount`, `getAccountStatus`,
  `sendPayout`. Stripe Connect adaptörü (Express hesap + `transfers.create`, separate charges
  & transfers) `PAYMENT_PROVIDER=stripe` + anahtar varken; aksi hâlde `MockPayoutProvider`.
  Testler ağa çıkmaz (Stripe HTTP taklidi).
- KYC: `kycStatus` sağlayıcının bağlı hesap durumudur (Stripe: `details_submitted` +
  `payouts_enabled` + `disabled_reason`). Mock sağlayıcının kendi KYC'si yok → P1-6
  `IdentityVerification`'dan türetilir. Ek kapı `PAYOUT_REQUIRE_IDENTITY_VERIFIED`
  (vars. kapalı): açıkken payout için P1-6 kimlik doğrulaması şart.

### Raporlama

- Ev sahibi paneli: para birimi başına emanette / serbest / rezervde / ödenen + payout
  geçmişi; yönetici: hesap listesi, durdur/devam.
- `npm run dac7:export -- <yıl>`: DAC7 DPI benzeri alan adlarıyla (Consideration, Fees,
  NumberOfActivities çeyreklik, NumberOfDaysRented) JSON + CSV. Kaynak jurnal: bedel
  serbest bırakma anında doğar, serbest bırakma sonrası iadeler aynı çeyrekte düşülür.
  Kişisel veri minimizasyonu: yalnızca ad + iç referans (e-posta/telefon/adres yok, TIN
  tutulmadığı için `NOTIN`); `--pseudonymize` ad çıkarır, referansı tuzlu özetle değiştirir.
  CSV enjeksiyonuna karşı hücre kaçışı.

## Sonuçlar

- Mutabakat (`reconcile`) PSP tarafını karşılaştırmaya devam eder; serbest bırakma ve rezerv
  PSP'ye dokunmaz, payout'lar `psp_clearing`'den çıkar. Testler her adımda mizan dengesini
  ve dokunulan günlerde fark 0'ı doğrular.
- F2c öncesi (jurnalsiz) ödemeler serbest bırakılmaz (emanet bakiyesi 0 görünür); geriye
  dönük jurnal opsiyonel olarak ertelendi.
- Eski `LedgerEntry` dual-write'ı devir tarafında korunur (kaldırma F9 kararı).
- Çok para birimli tek rezervasyon emaneti (gerçekte oluşmaz) yalnızca ilk para birimiyle
  serbest bırakılır ve uyarı loglanır.

## Depozito (P1-5'te eklenecek)

_Bu bölüm P1-5 (hasar depozitosu + çözüm merkezi) ile doldurulacak._
