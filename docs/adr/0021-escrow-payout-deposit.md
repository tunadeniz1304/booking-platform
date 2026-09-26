# ADR 0021 — Escrow serbest bırakma, ev sahibi payout'ları, rezerv (ve depozito)

- Durum: Kabul edildi (v4, F4 / P1-4; depozito ve çözüm merkezi bölümü P1-5)
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
bırakmadaki komisyon oranında `platform_revenue`'dan geri alınır. Ev sahibi payı P1-5 ile
değişti (aşağıda "Serbest bırakma sonrası iade: rezerv önce"): önce `host_reserve`, sonra
kullanılabilir `host_payable`, yetmezse platform üstlenir; ev sahibi bakiyesi eksiye düşmez.
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

## Depozito ve çözüm merkezi (P1-5)

### Bağlam

Airbnb AirCover / Resolution Center ve Vrbo hasar depozitosu: ev sahibi ilan başına hasar
güvencesi ister, misafir konaklama sonrası iade talep edebilir, iki taraf kanıt yükler, yanıt
süreleri vardır ve kararı platform verir. Kart itirazları (chargeback) PSP'den gelir ve aynı
ekranda görünmelidir. Önceki durumda hiçbiri yoktu; ayrıca P1-4'te serbest bırakma sonrası
iade rezervi kullanmıyor, ev sahibi bakiyesi eksiye düşebiliyordu.

### Karar: depozito = ayrı ön provizyon (manuel capture)

- Ayar `DamageDepositSetting`: ilan geneli (`roomTypeId = null`) + oda tipine özel; oda tipi
  ezer; tutar × oda adedi; üst sınır `DEPOSIT_MAX_MINOR`. Mevcut `Property`/`RoomType`
  modellerine kolon eklenmedi (şema yalnız ekleme; paralel çalışmalarla çakışmasın).
- `DamageDeposit` (rezervasyon başına tekil): `SCHEDULED → AUTHORIZED → CAPTURED_PARTIAL |
CAPTURED | VOIDED | EXPIRED`, ayrıca `FAILED` (PSP reddi / kart yeniden kullanılamıyor).
  Tahsilattan AYRI PSP işlemi: konaklama bedeline karışmaz, iade/iptal akışı değişmez; kısmi
  capture kalan provizyonu PSP'de otomatik serbest bırakır.
- Zamanlama: tesisin yerel giriş anından `DEPOSIT_PREAUTH_HOURS_BEFORE` (24) saat önce ön
  provizyon; yerel çıkış + `DEPOSIT_HOLD_DAYS` (3) sonra açık `HOST_DAMAGE` talebi yoksa void.
  Kart provizyonları PSP'de yaklaşık 7 gün yaşar (`DEPOSIT_AUTH_VALID_DAYS`); bu yüzden
  rezervasyon anında değil girişe yakın alınır; süresi dolan provizyon `EXPIRED` olur.
- Tetikleme: `resolution` kuyruğunda tekrarlayan `deposit-sweep` (`DEPOSIT_SWEEP_CRON`) kayıt
  açar, vadesi gelenleri provizyona alır, vadesi geçenleri bırakır; provizyon anında depozito
  başına BullMQ gecikmeli `deposit-void` işi (jobId `deposit-void-<id>`). Onay yoluna
  (ödeme/sepet sagası) dokunulmadı; kaçan iş süpürücüde yakalanır. İptal edilmiş rezervasyonun
  provizyonu süre beklenmeden bırakılır.
- Kart: asıl tahsilatın kartı (PaymentIntent'in `payment_method` + `customer`) off-session
  yeniden kullanılır. `PaymentProvider`'a İSTEĞE BAĞLI `authorizeHold` eklendi (mevcut
  imzalar değişmedi); kısmi capture mevcut `capture(ref, amount)` (Stripe
  `amount_to_capture`), bırakma `void(ref)`. Stripe adaptörü kaynak ödeme müşteriye bağlı
  değilse `payment_method_not_reusable` verir; off-session 3DS isteği ret sayılır. MockPsp
  durumsuzdur: provizyon tutarı referansta taşınır (`pi_mockhold_<tutar>_…`) ve aşan
  capture'ı reddeder.
- capture ≤ pre-auth üç katmanda: kod (`DEPOSIT_CAPTURE_EXCEEDS_AUTH`, 422), DB CHECK
  (`capturedMinor` 0..`amountMinor`, durum–tutar tutarlılığı) ve PSP.
- PSP çağrıları tx DIŞINDA, idempotency anahtarı iş kimliğinden (`deposit:<id>`,
  `claim-refund:<id>`); DB geçişi koşullu `updateMany` (yarışan süpürücü/iş tek yazar).

### Karar: depozito tahsilatı jurnali

`depositCaptured` (anahtar `deposit-captured:<depositId>`):
`Dr psp_clearing / Cr host_payable:<host>`.

- Hasar tazminidir, konaklama bedeli değil: emanetten geçmez (konaklama çoktan serbest
  bırakılmış olabilir), vergi ve platform komisyonu yok. Karar anında ev sahibine borçlanılır
  ve mevcut payout motoru öder.
- `guest_receivable` kullanılmadı: ön provizyonu aşan tazmin PSP'den tahsil edilemez; deftere
  alacak yazmak tahsil edilemeyecek bir varlık ve kalıcı mutabakat farkı üretirdi. Aşan kısım
  yalnız talep kaydında (`Claim.uncollectedMinor`) tutulur.
- Mutabakat: `reconcile` yeni `deposit` öznesiyle `DamageDeposit.capturedMinor` ↔
  DEPOSIT_CAPTURED `Dr psp_clearing` karşılaştırır.

### Karar: çözüm merkezi talepleri

- Türler: `GUEST_REFUND` (misafir; yerel girişten sonra, çıkış + `CLAIM_GUEST_WINDOW_DAYS`
  içinde; tutar ≤ iade edilebilir), `HOST_DAMAGE` (ev sahibi; girişten sonra, depozito tutma
  süresi içinde; tutar serbest, fazlası kayıt), `CHARGEBACK` (PSP açar). Rezervasyon + tür
  başına tek açık taraf talebi (kısmi UNIQUE indeks).
- Durumlar: açılışta `AWAITING_RESPONSE` + `slaDueAt = şimdi + CLAIM_RESPONSE_SLA_HOURS`
  (72). Karşı tarafın ilk yanıtı → `OPEN`. SLA bitişinde BullMQ gecikmeli `claim-sla-check`
  (+ `claim-sla-sweep` yedek) hâlâ yanıt yoksa koşullu olarak `ESCALATED`: denetim kaydı,
  SYSTEM mesajı, outbox `resolution.claim_escalated` → yöneticilere e-posta,
  `claim_sla_breach_total{type}`. Karar: `RESOLVED_APPROVED | RESOLVED_PARTIAL |
RESOLVED_REJECTED`; açanın geri çekmesi `CLOSED`.
- Karar deterministik (LLM yok): yönetici onay / kısmi (tutar < talep) / ret + gerekçe; karar
  `pay:<bookingId>` Redlock'u altında (iptal iadesiyle aynı kilit; çift tıklamada ikinci
  karar `CLAIM_CLOSED`).
  - GUEST_REFUND: PSP iadesi → aynı SERIALIZABLE tx'te `Payment.refundedAmountMinor` artışı +
    `postRefundFromEscrow` (`refund-issued:claim:<id>`). Serbest bırakma öncesi emanetten.
  - HOST_DAMAGE: `min(tazmin, provizyon)` capture, kalan `uncollectedMinor`. Provizyon yok ya
    da süresi dolmuşsa tamamı tahsil edilemez olarak kaydedilir. Ret ya da geri çekmede tutma
    süresi dolmuşsa depozito hemen bırakılır.
- Kanıt (`ClaimEvidence`, BYTEA; yalnız taraflar + yönetici): tür beyan edilen MIME'dan değil
  dosya imzasından belirlenir. Görseller `sharp` ile piksel sınırı
  (`CLAIM_EVIDENCE_MAX_PIXELS`, sıkıştırma bombası) altında çözülür, EXIF yönüne göre
  döndürülür, kenar sınırına küçültülür ve WebP olarak YENİDEN KODLANIR; `withMetadata`
  çağrılmadığından EXIF/GPS/XMP/IPTC/ICC taşınmaz. PDF yeniden kodlanmaz: `%PDF-` imzası,
  `%%EOF` sonu ve boyut sınırı; sunarken `attachment` + `nosniff` + CSP `sandbox`. Talep
  başına dosya sınırı `CLAIM_EVIDENCE_MAX_FILES`.

### Karar: PSP itirazı → CHARGEBACK talebi

- Stripe `charge.dispute.created|updated|closed` → iç `dispute.*` olayı (ref = itiraz edilen
  PaymentIntent). İmza kuralı değişmedi (v4#16): yalnız aktif sağlayıcının şeması; mock için
  aynı iç biçimde imzalı olay (`mockDisputeWebhook`, `x-psp-signature`).
- Olay kimliği `PaymentEvent`'e aynı tx'te (replay etkisiz); talep `externalRef` (itiraz
  kimliği) ile tekil → sıra dışı olaylar doğru son durumu verir. Açılış `ESCALATED` +
  yönetici bildirimi; kapanış `won → RESOLVED_REJECTED`, `lost → RESOLVED_APPROVED` (tutar
  `awardedMinor`), diğer → `CLOSED`. Yönetici karar veremez (`CLAIM_PSP_MANAGED`). Sepet
  (P1-1) tahsilatında itiraz sepetin ilk rezervasyonuna bağlanır.
- Kaybedilen itirazın jurnali (PSP'nin geri çektiği para) bu adımda yazılmaz; chargeback
  jurnali ve ev sahibinden geri alım sonraki iş.

### Serbest bırakma sonrası iade: rezerv önce (P1-4 açığının kapatılması)

`postRefundFromEscrow` "released" dalında ev sahibi payını saf `splitHostRecovery` ile böler:

1. `host_reserve:<host>` bakiyesi (ev sahibi geneli),
2. kullanılabilir `host_payable` = bakiye − bekleyen (PENDING) payout'lar,
3. kalan platform üstlenir (`platform_revenue`'dan; `Claim.platformCoveredMinor`).

Böylece `host_payable` bekleyen payout'ların altına / eksiye düşmez. İadeyi reddetmek
(misafir zarar görür) ya da ev sahibini eksiye düşürmek (P1-4; tahsil edilmeyebilecek borç)
yerine AirCover benzeri platform güvencesi seçildi; ev sahibinden sonradan mahsup kapsam dışı.
Rezerv açılışı (`reserveReleased`) artık rezervasyona atfedilen KALAN rezervi (o
rezervasyonun `host_reserve` satırları neti) açar ve güncel rezerv bakiyesiyle sınırlar →
rezerv eksiye düşmez, tüketilen rezerv ikinci kez açılmaz.

### Sonuçlar (P1-5)

- Yeni env `DEPOSIT_*`, `CLAIM_*` (`.env.example`); yeni kuyruk `resolution`.
- UI: rezervasyon sayfasında depozito + talep açma, `/resolution` (liste, ayrıntı, mesaj,
  kanıt), `/admin/claims` karar ekranı, ev sahibi panelinde depozito tutarı (TR/EN).
- Bilinen sınırlar: Stripe'ta kartın off-session yeniden kullanımı için ödeme akışında
  Customer + `setup_future_usage=off_session` gerekir (şu an yok → Stripe'ta depozito
  `FAILED`, mock'ta çalışır). PSP capture başarılı olup DB yazımı düşerse (çok nadir) tekrar
  denemede Stripe "already captured" döner — elle mutabakat gerekir. Devredilmiş
  rezervasyonda misafir iade talebi kapalı.
