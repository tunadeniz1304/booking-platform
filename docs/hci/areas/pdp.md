# İlan detay sayfası — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 85 bulgu · Severity: Critical 1, High 21, Medium 40, Low 23

## F28 — İptal politikası ve giriş/çıkış saatleri ilan sayfasında hiç gösterilmiyor

| Alan                | Değer                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Severity            | Critical                                                                                               |
| Durum               | Aday                                                                                                   |
| Konum               | `src/app/property/[id]/page.tsx:44`                                                                    |
| Diğer konumlar      | `messages/tr/booking.json (widget.refundable)`, `prisma/schema.prisma:111`, `prisma/schema.prisma:139` |
| Kullanıcılar        | misafir                                                                                                |
| Prensip             | robustness · task conformance                                                                          |
| Sezgisel madde      | H13 — Feedforward                                                                                      |
| Renk/tema           | Hayır                                                                                                  |
| Efor                | M                                                                                                      |
| Kaynak denetçiler   | area:pdp                                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                                                                            |

**Kanıt:** page.tsx:44-82 getProperty `select: { id, title, description, propertyType, licenseNumber, basePriceMinor, currency, ratingAvg, ... rooms: {...} }` — `checkInTime`/`checkOutTime` (schema.prisma:111-112, varsayılan "15:00"/"11:00") ve `cancellationPolicy` (schema.prisma:139-140) seçilmiyor, sayfada render edilmiyor. Fiyat planı etiketi messages/tr/booking.json widget.refundable = 'İptal politikasına göre iade' hiç gösterilmeyen bir politikaya atıf yapıyor. grep: checkout/quote mesajlarında da iptal metni yok; yalnız RnplOption.tsx:54-58 RNPL seçeneğinde `freeCancellationUntil` görünüyor.

**Etki:** Misafir 'Standart' planı seçerken ücretsiz iptal son tarihini ve kesinti oranını bilmeden ödüyor; geç iptalde beklenmeyen para kaybı. Geç varış planlayan misafir giriş saatini rezervasyondan önce göremiyor.

**Önerilen aksiyon:** getProperty select'ine `checkInTime`, `checkOutTime`, `timeZone`, `cancellationPolicy: { select: { kind: true } }` ekleyin; açıklamadan sonra `<section id="policies" aria-labelledby="policies-title">` içinde h2 'Ev kuralları ve politikalar': 'Giriş: 15:00'ten itibaren · Çıkış: 11:00'e kadar (tesis yerel saati)' ve politika türüne göre düz dil özeti (ör. 'Girişten 7 gün öncesine kadar ücretsiz iptal; sonrasında ilk gece ücreti kesilir'; tarih seçiliyse somut son tarih). BookingWidget'taki 'İptal politikasına göre iade' metnini `href="#policies"` bağlantısına çevirin.

**Yapılan düzeltme:** Confirmed. In page.tsx the select now also fetches timeZone, checkInTime, checkOutTime and cancellationPolicy{kind,version,rules}. A new <section id="policies" aria-labelledby="policies-title"> comes after the description. It shows check-in and check-out times with a local-time note, the policy type, and plain-language refund steps built from toSnapshot() rules (days/hours/later/any + grace window). Snapshot parse errors are caught. Linking the BookingWidget 'İptal politikasına göre iade' text to #policies was passed to crossOwner. — dosyalar: `src/app/property/[id]/page.tsx`

## F132 — Başlıkta '260 değerlendirme · 8.8' yazarken yorum bölümünde 'Henüz yorum yok' (tüm ilanlarda tutarsız)

| Alan                | Değer                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Severity            | High                                                                              |
| Durum               | Gözlemlendi                                                                       |
| Konum               | `src/app/property/[id]/page.tsx:143`                                              |
| Diğer konumlar      | `src/components/property/ReviewsSection.tsx`, `src/lib/reviews/review-service.ts` |
| Kullanıcılar        | misafir, ev sahibi                                                                |
| Prensip             | robustness · Consistency / Honesty of information (Dix Predictability)            |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                       |
| Renk/tema           | Hayır                                                                             |
| Efor                | S                                                                                 |
| Kaynak denetçiler   | runtime:pdp                                                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                                                       |

**Kanıt:** RUNTIME 006-anon-tr-desktop ekran görüntüsü (crops/property/006-0.png ve 006-2.png): üstte '8.8 · 260 değerlendirme', aşağıda 'Misafir yorumları … Henüz yorum yok.'. API taraması (39 ilan): ratingCount 76–2140 iken yayımlanmış yorum 0–2 (ör. Grand Deluxe 1240 vs 2, Dubai Marina 2140 vs 0). Kod: page.tsx:143-150 property.ratingAvg/ratingCount (seed alanı) gösteriliyor; ReviewsSection.tsx:183-186 gerçek yorum listesi ayrı kaynaktan.

**Etki:** Kullanıcı puanın neye dayandığını doğrulayamıyor; 'Yalnızca doğrulanmış konaklamalar yorum yazabilir' vaadiyle çelişen sayı güveni zedeler ve tüketici mevzuatı (doğrulanmış yorum beyanı) açısından risklidir.

**Önerilen aksiyon:** Başlıktaki puan ve sayıyı yayımlanmış yorumlardan türetin (aggregate) ya da 'Puan: dış kaynak/ithal' ayrımını açıkça etiketleyin; 0 yorumda 'Henüz puan yok' gösterin. Rozeti #reviews-title'a bağlantı yapın.

**Yapılan düzeltme:** The header rating on the PDP now comes from a prisma.review.aggregate over PUBLISHED reviews, the same source as the list below it. It shows '{avg}/5' plus the count, and the count links to #reviews-title. With 0 reviews it shows 'Henüz puan yok'. The seed ratingAvg/ratingCount values can still disagree on search cards (data and other owner). — dosyalar: `src/app/property/[id]/page.tsx`

## F133 — Mobilde rezervasyon kutusu sayfanın en altında: ilk ekranda fiyat yok, yapışkan fiyat/CTA çubuğu yok

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | High                                                                                      |
| Durum               | Gözlemlendi                                                                               |
| Konum               | `src/app/property/[id]/page.tsx:161`                                                      |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx`                                                |
| Kullanıcılar        | misafir                                                                                   |
| Prensip             | learnability · Observability / Browsability (Dix) — birincil görev ve fiyat görünür değil |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                            |
| Renk/tema           | Hayır                                                                                     |
| Efor                | M                                                                                         |
| Kaynak denetçiler   | runtime:pdp                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                                                               |

**Kanıt:** RUNTIME 390x844 anon TR /property/cmv2uydl30fot92w2i9c8a4fa (probe p3-layout.mjs): form top=1829px (2,05 ekran aşağıda), quote-total top=2365px, 'Rezervasyonu Onayla' top=2610px, footer 2789px; ilk ekranda ₺ içeren hiçbir öğe yok (anyPriceInFirstScreen=[]); alt kenara sabit öğe yok (fixedBottom=[]). Ekran görüntüleri full/shots/007-...png → crops/property/007-0..3.png: kutu galeri+açıklama+olanaklar+fiyat takvimi+yorumlar+'Bu ilanı bildir'den sonra geliyor. Kod: page.tsx:161 grid-cols-1 lg:grid-cols-3, widget sütunu DOM'da sol sütundan sonra (203-213).

**Etki:** Mobil ağırlıklı misafir 'kaça?' sorusunun cevabını görmek için ~2-3 ekran kaydırmak zorunda; fiyatı görmeden sayfadan çıkma ve 'rezervasyon nerede?' kaybolma riski yüksek.

**Önerilen aksiyon:** Mobilde (lg altı) alt kenara sabit bir özet çubuğu ekleyin: 'Toplam ₺X · 12–13 Eki · 2 misafir' + 'Tarih seç/Rezervasyon' düğmesi; tıklayınca #booking-widget'a kaydırıp odak versin. Ayrıca başlık bloğunun altına 'gecelik ₺… den başlayan' fiyat satırı koyun ya da mobilde widget'ı galeriden hemen sonra (order-first) gösterin.

**Yapılan düzeltme:** Grid reordered. The gallery, the BookingWidget column (lg:col-start-3 lg:row-span-2) and the details column are now separate grid items, so on mobile the booking form appears right after the gallery and stays in the right column on desktop. A 'Rezervasyon formuna git' link to #booking (tabIndex=-1 target) was added under the h1. No fixed bottom bar was added because it could cover the 'Rezervasyonu Onayla' and 'Sepete ekle' buttons that e2e tests click. — dosyalar: `src/app/property/[id]/page.tsx`

## F134 — Fiyat takvimindeki fiyat ile rezervasyon kutusunun teklifi farklı (Grand Deluxe'te 2,2 kat)

| Alan                | Değer                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Severity            | High                                                                                   |
| Durum               | Gözlemlendi                                                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:198`                                        |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx`, `src/components/booking/stay-selection.ts` |
| Kullanıcılar        | misafir                                                                                |
| Prensip             | robustness · Consistency / Predictability (Dix) — aynı gece için iki farklı fiyat      |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                            |
| Renk/tema           | Hayır                                                                                  |
| Efor                | M                                                                                      |
| Kaynak denetçiler   | runtime:pdp                                                                            |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: pdp)                                                     |

**Kanıt:** RUNTIME desktop TR probe p8-cal-vs-quote.mjs: Grand Deluxe (cmv2uybda001j92w2qsl5p0ww) takvim '20 Ekim 2026: ₺2.225,05 … ayın en ucuz gecesi' → güne tıklayınca widget: oda 'Deluxe Boğaz Manzaralı - 3 kişi', 2 misafir, Standart → 'Toplam ₺4.894,09' (₺4.850 × 1 gece). Galata: takvim ₺1.907,18 → widget ₺2.119,09. Takvim alt başlığı '1 gece, 1 misafir için en düşük fiyat' (data.guests=1, API 'guests:1'), widget varsayılanı 2 misafir + alfabetik ilk oda (BookingWidget.tsx:74-76 rooms[0]) + Standart plan. Takvim seçimi yalnızca tarih yayınlıyor (PriceCalendar.tsx:156-175 publishStaySelection{checkIn,checkOut}); oda/plan/misafir değişmiyor.

**Etki:** Kullanıcı ₺2.225 görüp tıklıyor, ₺4.894 ile karşılaşıyor — yanıltıcı fiyat algısı, güven kaybı ve AB/TR 'toplam fiyat' düzenlemeleri açısından risk.

**Önerilen aksiyon:** Takvim seçimi tarih + takvim fiyatını üreten roomId/ratePlanId'yi de yayınlasın (calendar-prices yanıtına gün başına roomId/ratePlanId ekleyin) ve widget bunları seçsin; ya da takvimi widget'ın seçili oda/plan/misafir sayısıyla parametrelendirin. Seçim sonrası widget'ta 'Takvimdeki fiyat en ucuz oda (Standart Oda, İade edilemez) içindir' notu gösterin.

**Yapılan düzeltme:** Short-term fix: the calendar subtitle (calendar.subtitleIncluded/Excluded) now says clearly that the price is for the cheapest room and rate for {guests} guests, and that it changes if the guest count or room is different. Publishing roomId/ratePlanId per day from the calendar and having the widget pick them needs an API change and a BookingWidget change (crossOwner). — dosyalar: `src/components/property/PriceCalendar.tsx`

## F175 — Seçili öğede klavye odağı seçim halkasından ayırt edilemiyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | High                                                                          |
| Durum               | Aday (2 kaynak birleşti)                                                      |
| Konum               | `src/components/property/PriceCalendar.tsx:295`                               |
| Diğer konumlar      | `src/components/property/PropertyGallery.tsx:47`, `src/styles/globals.css:61` |
| Kullanıcılar        | misafir                                                                       |
| Prensip             | accessibility · Focus Visible                                                 |
| Sezgisel madde      | H14 — Erişilebilirlik                                                         |
| WCAG                | 2.4.7                                                                         |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | area:pdp, lens:a11y                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                                                   |

**Kanıt:** PriceCalendar.tsx:295-297 `focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] ... ${selected ? "ring-2 ring-[#003580]" : ""}` — odak ve seçim aynı kalınlık ve renkte halka; seçili aralıktaki günler arasında Tab ile gezinirken görünür değişiklik olmuyor. PropertyGallery.tsx:47 etkin küçük resim `ring-2 ring-primary-600` taşıyor; globals.css:61 `:focus-visible:not([class*="ring"])` genel outline'ı 'ring' içeren sınıflarda kapattığından etkin küçük resme odaklanınca hiçbir gösterge çıkmıyor.

**Etki:** Yalnız klavye kullanan misafir takvimde ve galeride odağın yerini kaybediyor; yanlış güne Enter basma riski.

**Önerilen aksiyon:** Renge dokunmadan biçimle ayırın: seçime `ring-inset` veya iç kenarlık/dolgu deseni, odağa `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dashed` verin; galeri düğmesine ui.tsx `focusRing` (ring-offset-2) ekleyin ve etkin durumu halka yerine kalın alt kenarlıkla gösterin.

**Yapılan düzeltme:** PriceCalendar: selection is now an inset ring (ring-2 ring-inset, same color) and focus is a dashed outline with offset 2 (focus-visible:outline-dashed outline-offset-2, same color), so the two shapes differ. PropertyGallery thumbnails got the focusRing primitive (ring-offset-2), so a focused active thumbnail now looks different from an unfocused one. No colors changed. — dosyalar: `src/components/property/PriceCalendar.tsx`, `src/components/property/PropertyGallery.tsx`

## F176 — Yıldız puanı ekran okuyucuya güvenilir biçimde aktarılmıyor (rolsüz span üzerinde aria-label)

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | High                                                 |
| Durum               | Aday (2 kaynak birleşti)                             |
| Konum               | `src/components/property/ReviewsSection.tsx:169`     |
| Diğer konumlar      | `src/components/account/WalletPanel.tsx:41`          |
| Kullanıcılar        | misafir                                              |
| Prensip             | accessibility · Non-text Content / Name, Role, Value |
| Sezgisel madde      | H14 — Erişilebilirlik                                |
| WCAG                | 1.1.1                                                |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | area:pdp, lens:a11y                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                          |

**Kanıt:** ReviewsSection.tsx:169-173 `<span aria-label={t("starsLabel", { rating })} className="text-amber-700">{"★".repeat(rating)}<span aria-hidden="true" className="text-gray-400">…` — generic `span` rolü ad taşıyamaz (ARIA 1.2); NVDA/JAWS aria-label'ı yok sayıp 'siyah yıldız' glifini N kez okur; boş yıldızlar aria-hidden olduğundan '5 üzerinden' ölçeği de kaybolur.

**Etki:** Ekran okuyucu kullanıcısı her yorumun puanını '5 üzerinden 4' olarak duyamıyor; yorumları karşılaştırma görevi zorlaşıyor.

**Önerilen aksiyon:** Dış span'e `role="img"` ekleyin (`<span role="img" aria-label={t("starsLabel", { rating })}>`) ve tüm glifleri `aria-hidden` içine alın; ya da glifleri aria-hidden yapıp yanına `<span className="sr-only">5 üzerinden 4 puan</span>` koyun.

**Yapılan düzeltme:** ReviewsSection Stars: the outer span now has role="img" with aria-label starsLabel, and both filled and empty glyphs are aria-hidden. — dosyalar: `src/components/property/ReviewsSection.tsx`

## F314 — Mobilde rezervasyon kutusu sayfanın en sonunda (galeri, olanaklar, fiyat takvimi ve yorumlardan sonra); hızlı erişim yok

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | High                                           |
| Durum               | Aday                                           |
| Konum               | `src/app/property/[id]/page.tsx:161`           |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:135` |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · task conformance                  |
| Sezgisel madde      | H7 — Esneklik/verim                            |
| Renk/tema           | Hayır                                          |
| Efor                | M                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                    |

**Kanıt:** page.tsx:161 `grid grid-cols-1 gap-8 lg:grid-cols-3`. Mobilde DOM sırası şöyle: :162-201 galeri, açıklama, olanaklar, erişilebilirlik, PriceCalendar (:188), ReviewsSection (:190), bildirim bağlantısı; BookingWidget ancak :203-213'te geliyor. Yapışık alt çubuk veya 'Rezervasyon yap' atlama bağlantısı yok. PriceCalendar seçimde "Rezervasyon formu güncellendi" diyor (property.json:42) ama forma bağlantı vermiyor.

**Etki:** Çoğunluğu mobil olan misafirler tarih, fiyat ve CTA'ya ulaşmak için tüm yorumları kaydırmak zorunda. Fiyat takviminden tarih seçen kullanıcı formun nerede güncellendiğini göremiyor.

**Önerilen aksiyon:** `lg:hidden fixed inset-x-0 bottom-0` bir alt çubuk ekle: tarih özeti veya toplam ile "Rezervasyon yap" düğmesi. Düğme `document.getElementById("booking-widget")?.scrollIntoView()` çağırsın ve widget h2'sine odak versin. BookingWidget `<form id="booking-widget">` olsun. PriceCalendar'ın "güncellendi" mesajına `<a href="#booking-widget">` ekle.

**Yapılan düzeltme:** Same fix as F133: the widget comes right after the gallery on mobile, there is a skip link to #booking, and PriceCalendar shows a 'Rezervasyon formuna git' (#booking) link once a check-in date is chosen. — dosyalar: `src/app/property/[id]/page.tsx`, `src/components/property/PriceCalendar.tsx`

## F315 — Mobil ilan sayfasında rezervasyon formu tüm açıklama, takvim ve yorumlardan sonra geliyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | High                                           |
| Durum               | Aday                                           |
| Konum               | `src/app/property/[id]/page.tsx:161`           |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:135` |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · Bilişsel yük / görev akışı      |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                   |
| Renk/tema           | Hayır                                          |
| Efor                | M                                              |
| Kaynak denetçiler   | lens:copy                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                    |

**Kanıt:** property/[id]/page.tsx:161-213 `grid grid-cols-1 gap-8 lg:grid-cols-3`; BookingWidget ikinci sütunda (203-213), yalnız `lg:sticky`. Mobilde sıra: galeri → açıklama → olanaklar → erişilebilirlik → fiyat takvimi → AI özet + tüm yorumlar → 'Bu ilanı bildir' → ancak sonra fiyat/rezervasyon formu.

**Etki:** Mobil misafir fiyatı ve 'Rezervasyon Yap'ı bulmak için sayfanın en altına kaydırmak zorunda; arama kartından gelen toplam fiyatı da ancak orada görür.

**Önerilen aksiyon:** Mobilde başlığın altına toplam fiyat + 'Tarih ve oda seç' düğmesini içeren yapışkan bir alt çubuk ekleyin (düğme #booking-widget'a kaydırır) veya widget'ı mobil sırada galeriden hemen sonra render edin (order-* sınıfları).

**Yapılan düzeltme:** Duplicate of F133. Fixed by the mobile order change (widget after the gallery). — dosyalar: `src/app/property/[id]/page.tsx`

## F316 — Olanak adları ve açıklama yalnız Türkçe veri; EN arayüzde çevrilmiyor ve lang işaretsiz

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | High                                 |
| Durum               | Aday                                 |
| Konum               | `src/app/property/[id]/page.tsx:179` |
| Kullanıcılar        | misafir                              |
| Prensip             | accessibility · Language of Parts    |
| Sezgisel madde      | H14 — Erişilebilirlik                |
| WCAG                | 3.1.2                                |
| Renk/tema           | Hayır                                |
| Efor                | M                                    |
| Kaynak denetçiler   | area:pdp                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: pdp)   |

**Kanıt:** page.tsx:179 `{amenity.name}` — Amenity.name tek dilli (prisma/seed.ts:66-79 'Ücretsiz WiFi', 'Klima', 'Şehir Merkezi', 'Oda Servisi'); `icon` anahtarı seçiliyor (56) ama hiç kullanılmıyor. 167 `<p className="mt-2 whitespace-pre-line text-gray-700">{property.description}</p>` Türkçe açıklama (seed.ts:306) `lang` olmadan `<html lang="en">` altında.

**Etki:** EN arayüzü seçen yabancı misafir olanakları (karşılaştırma ölçütü) anlayamıyor; ekran okuyucu Türkçe metni İngilizce sesle okuyor.

**Önerilen aksiyon:** Olanakları kod üzerinden çevirin: `t(`amenityNames.${amenity.icon}`)` + messages/<locale>/property.json anahtarları; bilinmeyen kodda `<span lang="tr">{amenity.name}</span>`; ikonları aria-hidden gösterin. Property'ye `contentLocale` alanı ekleyip açıklamaya `lang={property.contentLocale}` verin; arayüz dilinden farklıysa 'Ev sahibinin dilinde (Türkçe)' notu.

**Yapılan düzeltme:** Amenities are now translated by icon code through t.has/t('amenityNames.<icon>') (12 keys in tr and en). An unknown code falls back to <span lang="tr">{name}</span>. Marking the description language needs a Property.contentLocale data field (schema/backend). — dosyalar: `src/app/property/[id]/page.tsx`

## F317 — Mobilde ve DOM sırasında rezervasyon formu sayfanın en sonunda; yapışkan CTA yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | High                                            |
| Durum               | Aday                                            |
| Konum               | `src/app/property/[id]/page.tsx:203`            |
| Diğer konumlar      | `src/components/property/PriceCalendar.tsx:355` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · task conformance                   |
| Sezgisel madde      | H7 — Esneklik/verim                             |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                     |

**Kanıt:** page.tsx:161 `grid grid-cols-1 gap-8 lg:grid-cols-3`; sol sütun sırasıyla PropertyGallery (163), Açıklama (165-168), Olanaklar (170-184), Erişilebilirlik (186), PriceCalendar (188), ReviewsSection (190; review-service.ts:131 `take = 50` yorum, her birinde 'Şikâyet et' düğmesi), bildir bağlantısı (193-200); BookingWidget ancak 203-213'te. PriceCalendar durum metinleri 'Seçim rezervasyon formunu doldurur' (property.json calendar.selectHint) ve 'Rezervasyon formu güncellendi.' (calendar.selected) diyor, ama 360 px'de form görünür alanda değil ve forma bağlantı yok.

**Etki:** Mobil ağırlıklı misafir birincil eyleme (Rezervasyonu Onayla) ulaşmak için galeri, takvim ve 50'ye kadar yorumu kaydırıyor; takvimden tarih seçince 'form güncellendi' sonucunu göremiyor. Klavye/ekran okuyucu kullanıcısı forma ulaşmak için tüm yorum ve şikâyet düğmelerinden geçiyor.

**Önerilen aksiyon:** BookingWidget sarmalayıcısına `id="booking"` verin; `lg:hidden fixed inset-x-0 bottom-0` alt çubuk: '₺X'den / gece' + 'Tarih ve oda seç' düğmesi (min-h-11) — tıklanınca `#booking`a kaydırıp formun ilk alanına odaklasın (main'e `pb-20`). PriceCalendar seçim durum satırına 'Rezervasyon formuna git' (`href="#booking"`) bağlantısı ve seçilen gece sayısı ekleyin. Mobilde widget'ı `order-` ile PriceCalendar'ın hemen ardına (yorumlardan önce) taşıyın; h1 yakınına 'Rezervasyon formuna atla' bağlantısı koyun.

**Yapılan düzeltme:** Duplicate of F133/F314. Added id="booking" on the widget wrapper, a skip link under the h1, a link to the form in the calendar, and the mobile order change. — dosyalar: `src/app/property/[id]/page.tsx`, `src/components/property/PriceCalendar.tsx`

## F318 — Mobil ilan sayfasında rezervasyon formu en altta, yapışkan CTA yok

| Alan                | Değer                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                    |
| Durum               | Aday                                                                                                                                    |
| Konum               | `src/app/property/[id]/page.tsx:203`                                                                                                    |
| Diğer konumlar      | `src/app/property/[id]/page.tsx:190`, `src/components/property/ReviewsSection.tsx:271`, `src/components/property/PriceCalendar.tsx:355` |
| Kullanıcılar        | misafir                                                                                                                                 |
| Prensip             | robustness · task conformance                                                                                                           |
| Sezgisel madde      | H7 — Esneklik/verim                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                   |
| Efor                | M                                                                                                                                       |
| Kaynak denetçiler   | lens:mobile                                                                                                                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: pdp)                                                                                                      |

**Kanıt:** page.tsx:161 `grid grid-cols-1 gap-8 lg:grid-cols-3`. Sol sütun (:162-201) sırasıyla galeri, açıklama, olanaklar, erişilebilirlik, :188 PriceCalendar ve :190 ReviewsSection. BookingWidget (:203-212) DOM'da en sonda ve yalnız `lg:sticky` (:204). ReviewsSection.tsx:270-271 tüm yorumları tek seferde basıyor (API review-service.ts:131 `take = 50`). PriceCalendar.tsx:355 seçimden sonra 'Seçildi … Rezervasyon formu güncellendi.' diyor (messages/tr/property.json calendar.selected) ama forma bağlantı ya da kaydırma yok. lg altında fiyat ve 'Rezervasyon yap' için kısayol veya alt çubuk yok.

**Etki:** Telefonda misafir fiyatı ve 'Rezervasyon yap' düğmesini görmek için galeriyi, açıklamayı, takvimi, AI özetini ve 50'ye kadar yorumu kaydırmak zorunda. Takvimde tarih seçince güncellenen formu göremiyor. Dönüşümün en kritik adımında ciddi sürtünme var ve bazı kullanıcılar formun varlığını hiç fark etmiyor.

**Önerilen aksiyon:** lg altında yapışkan alt çubuk ekle: `lg:hidden fixed inset-x-0 bottom-0`, içinde teklif toplamı ya da 'başlangıç fiyatı' ve 'Tarih seç / Rezervasyon yap' düğmesi `#booking-widget`'a kaydırsın (BookingWidget form'una id ver, alt bant dolgusuyla birlikte, bkz. sabit bant bulgusu). Alternatif olarak lg altında widget'ı galeriden hemen sonra yerleştir (sağ sütuna `order-2` / sol sütun içeriğine `order-3`). PriceCalendar durum mesajına `<a href="#booking-widget">Rezervasyon formuna git</a>` ekle. Yorumları ilk 5 ile sınırla ve 'Tüm yorumları göster (N)' düğmesi koy.

**Yapılan düzeltme:** Duplicate of F133/F314. Mobile order, calendar link to the form and skip link are done. Limiting reviews to the first 5 with 'Tüm yorumları göster' was not done because the form now sits above the reviews. — dosyalar: `src/app/property/[id]/page.tsx`, `src/components/property/PriceCalendar.tsx`

## F319 — Masaüstünde uzun yapışkan widget kısa ekranlarda 'Rezervasyonu Onayla' düğmesini görünmez bırakıyor

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | High                                 |
| Durum               | Aday                                 |
| Konum               | `src/app/property/[id]/page.tsx:204` |
| Kullanıcılar        | misafir                              |
| Prensip             | robustness · task conformance        |
| Sezgisel madde      | H7 — Esneklik/verim                  |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | area:pdp                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)          |

**Kanıt:** page.tsx:204 `<div className="lg:sticky lg:top-6">` — max-height veya iç kaydırma yok. docs/img/v4-price-calendar.png'de widget (tarih, misafir, oda, 3 fiyat planı, döküm, fiyat içgörüsü, gönder + ikinci düğme) 860 px görüntüde alttan taşıyor. Görünümden uzun sticky öğenin alt kısmı, sol sütun (takvim + 50 yorum) bitene kadar görünür alana girmez.

**Etki:** 1366×768 dizüstünde (≈650 px görünür alan) misafir gönder düğmesine ulaşmak için sayfanın sonuna kadar kaydırmak zorunda; düğmeyi bulamayıp akışı terk edebilir.

**Önerilen aksiyon:** Sarmalayıcıya `lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain` ekleyin ya da yalnız fiyat özeti + gönder düğmesini yapışkan yapın; alternatif olarak yapışkanlığı yükseklik sorgusuyla sınırlayın (`[@media(min-height:900px)]:lg:sticky`).

**Yapılan düzeltme:** Added lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain to the sticky wrapper, plus lg:-m-1 lg:p-1 so focus rings and shadows are not clipped. The bottom CTAs can now be reached on short screens. — dosyalar: `src/app/property/[id]/page.tsx`

## F320 — Yapışkan (sticky) rezervasyon kutusu ekran yüksekliğinden uzun; kısa ekranlarda ana CTA ve 'Sepete ekle' görünmüyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | High                                           |
| Durum               | Aday                                           |
| Konum               | `src/app/property/[id]/page.tsx:204`           |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:238` |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · task conformance                  |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                   |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                    |

**Kanıt:** page.tsx:204 `<div className="lg:sticky lg:top-6">` yükseklik sınırı veya taşma kaydırması olmadan BookingWidget'ı sarıyor. docs/img/price-insight.png (1280x860) kutuyu y=25'e yapışmış gösteriyor ve 'Sepete ekle' düğmesi ekranın altında kesik. Kutuya sırayla ekleniyor: 3 plan (~130px), döküm (~150px), PriceInsight (~140px), iki CTA ve ipucu (~170px).

**Etki:** 1366x768 dizüstü kullanıcısında "Rezervasyonu Onayla" görünür alanın altında kalıyor. Kutu yapışık olduğundan sayfa kaydırıldıkça CTA görünmüyor; ancak sol sütunun sonuna (yorumlardan sonra) gelindiğinde ortaya çıkıyor.

**Önerilen aksiyon:** Yapışık sarmalayıcıya `lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto` ekle. Ya da PriceInsight'ı CTA'ların altına taşı ve kutu `window.innerHeight`'tan uzunsa sticky'yi kaldır. Alternatif olarak yalnız toplam ve CTA'yı içeren kısa bir özet kartını yapışık yap.

**Yapılan düzeltme:** Duplicate of F319. Same max-height and internal scroll on the sticky wrapper. — dosyalar: `src/app/property/[id]/page.tsx`

## F321 — 'Rezervasyondan önce ev sahibine mesaj gönderin' talimatı sayfada uygulanamıyor

| Alan                | Değer                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Severity            | High                                                               |
| Durum               | Aday                                                               |
| Konum               | `src/components/property/AccessibilitySection.tsx:30`              |
| Diğer konumlar      | `messages/tr/compliance.json:82`, `messages/en/compliance.json:82` |
| Kullanıcılar        | misafir                                                            |
| Prensip             | robustness · task conformance                                      |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                         |
| Renk/tema           | Hayır                                                              |
| Efor                | M                                                                  |
| Kaynak denetçiler   | area:pdp                                                           |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: pdp)                                 |

**Kanıt:** AccessibilitySection.tsx:30 `<p className="mt-1 text-sm text-gray-600">{t("disclosure")}</p>` → compliance.json accessibility.disclosure '… Özel bir ihtiyacınız varsa rezervasyondan önce ev sahibine mesaj gönderin.' İlan sayfasında iletişim düğmesi yok; mesajlaşma yalnız rezervasyon sonrası mevcut (src/app/api/bookings/[id]/messages, BookingMessages.tsx).

**Etki:** Erişilebilirlik ihtiyacı olan misafir (kapı genişliği, duş tipi) soru sormak için önce rezervasyon yapıp ödemek zorunda; yönerge çıkmaza götürüyor.

**Önerilen aksiyon:** Bölüme 'Ev sahibine soru sor' düğmesi ekleyin: rezervasyon öncesi propertyId'ye bağlı soru akışı ya da en azından `/support?propertyId=…&topic=accessibility` bağlantısı; metni gerçek kanala göre güncelleyin ('Sorunuzu Destek üzerinden iletin, ev sahibine aktarılır').

**Yapılan düzeltme:** The disclosure text now points to a channel that exists ('Destek'e yazın ve ilanın adını belirtin'), and a 'Destek'e soru sor' link to /support was added with a 44px mobile target. A pre-booking question flow to the host, and a /support page that reads propertyId/topic, need backend and product work. — dosyalar: `src/components/property/AccessibilitySection.tsx`

## F322 — Takvimde dolu gün çıkış tarihi olarak seçilemiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | High                                            |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:157` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · task conformance                   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                     |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                     |

**Kanıt:** PriceCalendar.tsx:157 `if (!day.available) return;` çıkış dalından (158) önce çalışıyor; 255-271 müsait olmayan günler `<button type="button" disabled ...>` olarak çiziliyor. Çıkış gecesi konaklanmadığı için 15'i dolu bir tesiste 12→15 konaklaması takvimden kurulamıyor.

**Etki:** Misafir dolulukten hemen önceki boşluğu (sık rastlanan uygun aralık) takvimle seçemiyor; tarihlerin müsait olmadığını sanıp ilanı terk edebiliyor.

**Önerilen aksiyon:** Giriş seçiliyken (checkIn && !checkOut) giriş sonrasındaki ilk müsait olmayan günü etkin bırakın: aria-label '{date}: yalnız çıkış için seçilebilir', hücrede görünür 'Çıkış' metni; selectDay'de çıkış dalını `!day.available` korumasından önce çalıştırın ve [checkIn, day) gecelerinin tümünün müsait olduğunu doğrulayın.

**Yapılan düzeltme:** With a check-in chosen, the first booked or unpriced, non-past day after it is shown as an enabled button: visible 'Çıkış' text, aria-label dayAriaCheckoutOnly, outline focus. In selectDay the check-out branch now runs before the !day.available guard. — dosyalar: `src/components/property/PriceCalendar.tsx`

## F323 — Çıkış seçimi doğrulanmıyor: minimum konaklama ve aradaki dolu geceler

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | High                                            |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:158` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · task conformance (hata önleme)     |
| Sezgisel madde      | H5 — Hata önleme                                |
| WCAG                | 3.3.4                                           |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                     |

**Kanıt:** PriceCalendar.tsx:158-164 `if (checkIn && !checkOut && day.date > checkIn) { setCheckOut(day.date); publishStaySelection({ checkIn, checkOut: day.date }); setStatus(t("selected", ...)); return; }` — giriş gününün `minStay`'i (yalnız 170'te geçici çıkış için kullanılıyor) ve aradaki `available: false` geceler kontrol edilmiyor; yine de 'Seçildi: … Rezervasyon formu güncellendi.' duyuruluyor.

**Etki:** Misafir 'en az 3 gece' kuralı olan güne 1 gece ya da arasında dolu gece bulunan bir aralık seçip formu dolduruyor; hata ancak teklif aşamasında başka bileşende çıkıyor. Tarih hatası toleransı düşük kullanıcıda güven kaybı.

**Önerilen aksiyon:** Seçilen giriş günü nesnesini state'te tutun; çıkış tıklamasında `nights < minStay` ise yayınlamayın ve `t("minStayError", { count })` ('Bu giriş tarihi için en az 3 gece seçin') yazın; aralıkta müsait olmayan gece varsa 'Seçilen aralıkta {date} dolu' deyin. Giriş seçildikten sonra minStay öncesi günleri ve ilk dolu geceden sonraki günleri `aria-disabled="true"` + soluk stil ile işaretleyin.

**Yapılan düzeltme:** The chosen check-in day's minStay is kept in state (checkInMinStay). If the stay is shorter, nothing is published and minStayError is shown. If a night in the selected range (within the loaded month) is unavailable, nothing is published and rangeBlocked shows that date. Messages go to the existing aria-live line. — dosyalar: `src/components/property/PriceCalendar.tsx`

## F324 — Takvim fiyatı kullanıcının misafir sayısına ve formdaki oda/plana göre hesaplanmıyor

| Alan                | Değer                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                              |
| Durum               | Aday                                                                                                                                                                                              |
| Konum               | `src/components/property/PriceCalendar.tsx:198`                                                                                                                                                   |
| Diğer konumlar      | `src/app/property/[id]/page.tsx:188`, `src/lib/pricing/price-calendar.ts (getCalendarMonth guests)`, `src/components/booking/stay-selection.ts:10`, `src/components/booking/BookingWidget.tsx:71` |
| Kullanıcılar        | misafir                                                                                                                                                                                           |
| Prensip             | robustness · task conformance                                                                                                                                                                     |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                             |
| Efor                | L                                                                                                                                                                                                 |
| Kaynak denetçiler   | area:pdp                                                                                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: pdp)                                                                                                                                                                |

**Kanıt:** price-calendar.ts getCalendarMonth `guests: config.PRICE_CALENDAR_GUESTS` (app-config.ts:510, varsayılan 1); PriceCalendar.tsx:198 `{ guests: data?.guests ?? 1 }` → '1 gece, 1 misafir için en düşük fiyat'. page.tsx:188 yalnız `initialCheckIn` geçiriyor, `initial.guests` geçmiyor; BookingWidget.tsx:71-73 varsayılan 2 misafir. stay-selection.ts:10-13 yalnız `{ checkIn, checkOut }` yayınlıyor; o gecenin en ucuz oda/planı forma aktarılmıyor, form kendi seçili odasıyla teklif alıyor.

**Etki:** 3 kişilik aile takvimde 1 kişilik odanın fiyatını 'en ucuz' görüp tarih seçiyor, formda daha yüksek tutarla karşılaşıyor (aynı sayfada iki farklı fiyat). Para hatası toleransı çok düşük misafirde güven kaybı ve terk.

**Önerilen aksiyon:** PriceCalendar'a `guests={initial.guests}` geçirin, API'ye `?guests=` parametresi ekleyin (oda filtresi `maxOccupancy >= guests`); BookingWidget misafir sayısı değişince aynı köprüyle yayınlasın. Gün yanıtına `roomTypeId`/`ratePlanId` ekleyip `publishStaySelection`'a dahil edin ki form aynı oda/planı seçsin. Kısa vadede alt başlığı '{guests} kişilik en ucuz oda için; misafir sayınız farklıysa fiyat değişir' biçiminde belirgin gösterin.

**Yapılan düzeltme:** Same short-term subtitle text as F134. A guests parameter in the calendar API and room/rate per day need backend and BookingWidget changes (crossOwner). — dosyalar: `src/components/property/PriceCalendar.tsx`

## F325 — Fotoğrafı olmayan ilanda ilana ait olmayan stok görseller ilanın fotoğrafı gibi gösteriliyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | High                                             |
| Durum               | Aday                                             |
| Konum               | `src/components/property/PropertyGallery.tsx:13` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | robustness · observability                       |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                      |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                      |

**Kanıt:** PropertyGallery.tsx:13-17 `const FALLBACK_IMAGES = ["https://images.unsplash.com/photo-1566073771259-...", ...]`; 23 `const galleryImages = images.length > 0 ? images : FALLBACK_IMAGES;`; 31 alt yine `{title} - görsel {index}`. listing.ts:9-12 `LISTABLE_PROPERTY = { isActive: true, licenseStatus: "VERIFIED" }` fotoğraf şartı koymuyor, görselsiz ilan yayında stok otel/havuz fotoğraflarıyla görünüyor.

**Etki:** Misafir tesisle ilgisi olmayan görsellere bakarak karşılaştırıp ödeme yapabilir (yanıltıcı temsil, şikâyet/iade riski); ekran okuyucu bunları 'İlan adı - görsel 1' diye ilana aitmiş gibi duyurur. Ev sahibi fotoğraf eksikliğini fark etmez.

**Önerilen aksiyon:** FALLBACK_IMAGES'ı kaldırın; `images.length === 0` iken 16:9 nötr yer tutucu (aria-hidden ikon + `t("gallery.noPhotos")` = 'Bu ilan için henüz fotoğraf yok') gösterin, küçük resim ızgarasını render etmeyin.

**Yapılan düzeltme:** FALLBACK_IMAGES removed. With images.length===0 the gallery shows a 16:9 neutral placeholder (aria-hidden SVG + gallery.noPhotos) and no thumbnail grid. Existing gray classes only. — dosyalar: `src/components/property/PropertyGallery.tsx`

## F326 — Galeri alt metinleri fotoğrafın içeriğini aktarmıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | High                                             |
| Durum               | Aday                                             |
| Konum               | `src/components/property/PropertyGallery.tsx:31` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | accessibility · Non-text Content                 |
| Sezgisel madde      | H14 — Erişilebilirlik                            |
| WCAG                | 1.1.1                                            |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: pdp)               |

**Kanıt:** PropertyGallery.tsx:31 `alt={t("gallery.imageAlt", { title, index: activeIndex + 1 })}` → 'İstanbul Galata Loft Suites - görsel 1'. Veri modelinde açıklama alanı yok: schema.prisma:121 `images String[]`; PropertyPhoto (1061-1086) caption/alt alanı içermiyor.

**Etki:** Görme engelli misafir oda, manzara, banyo gibi karar verdiren görsel bilginin hiçbirine erişemiyor; tüm fotoğraflar 'görsel 1…n' olarak eşdeğer.

**Önerilen aksiyon:** PropertyPhoto'ya `caption` (≤120 karakter) alanı ekleyin, ev sahibi fotoğraf yükleme formunda etiketli alan olarak isteyin ('Deniz manzaralı balkon'); `alt={caption ?? t("gallery.imageAlt", { title, index, total })}`; caption'ı ana görselin altında `<figcaption>` olarak da gösterin.

**Yapılan düzeltme:** Alt text now includes the total ('{title} - fotoğraf {index} / {total}'; imageAlt key updated in tr and en). Describing the photo content needs a caption field on PropertyPhoto and the host upload form (backend). — dosyalar: `src/components/property/PropertyGallery.tsx`

## F327 — Küçük resim düğmelerinde seçili durum ve eylem adı programatik olarak yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | High                                             |
| Durum               | Aday                                             |
| Konum               | `src/components/property/PropertyGallery.tsx:42` |
| Kullanıcılar        | misafir                                          |
| Prensip             | accessibility · Name, Role, Value                |
| Sezgisel madde      | H14 — Erişilebilirlik                            |
| WCAG                | 4.1.2                                            |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                      |

**Kanıt:** PropertyGallery.tsx:42-49 `<button type="button" onClick={() => setActiveIndex(index)} className={... index === activeIndex ? "ring-2 ring-primary-600" : "opacity-70 hover:opacity-100"}>` — `aria-pressed`/`aria-current` yok; düğmenin adı yalnız içteki görselin alt'ı: 52 `t("gallery.thumbnailAlt")` = '{title} - küçük görsel {index}' (eylem değil isim). Ana görsel değişimi (29-37) duyurulmuyor; toplam fotoğraf sayısı yok.

**Etki:** Ekran okuyucu kullanıcısı hangi fotoğrafın büyük gösterildiğini, kaç fotoğraf olduğunu ve düğmenin ne yaptığını bilemiyor; seçili durum yalnız görsel halka/opaklıkla aktarılıyor.

**Önerilen aksiyon:** Küçük resimleri `<div role="group" aria-label={t("gallery.thumbnails")}>` içine alın; her düğmeye `aria-pressed={index === activeIndex}` ve `aria-label={t("gallery.show", { index: index + 1, total })}` ('Fotoğraf 2 / 8'i göster') verin, içteki img `alt=""`; ana görselin altına `aria-live="polite"` sr-only sayaç 'Fotoğraf 2 / 8'.

**Yapılan düzeltme:** Thumbnails are inside <div role="group" aria-label=gallery.thumbnails>. Each button has aria-pressed and aria-label gallery.show ('Fotoğraf 2 / 8 göster'), and the inner img has alt="". An sr-only aria-live=polite counter announces changes to the main photo. — dosyalar: `src/components/property/PropertyGallery.tsx`

## F328 — Şikâyet formu açılıp kapanınca klavye odağı kayboluyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | High                                            |
| Durum               | Aday                                            |
| Konum               | `src/components/property/ReviewsSection.tsx:56` |
| Kullanıcılar        | misafir                                         |
| Prensip             | accessibility · Focus Order                     |
| Sezgisel madde      | H14 — Erişilebilirlik                           |
| WCAG                | 2.4.3                                           |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: pdp)                     |

**Kanıt:** ReviewsSection.tsx:56-96 `{open ? (<span>…<select>…</span>) : (<button onClick={() => setOpen(true)}>…)}` — odaktaki 'Şikâyet et' düğmesi DOM'dan kaldırılıyor, odak `body`'ye düşüyor; 'Vazgeç' (80-86) ve başarılı gönderim (42 `setOpen(false)`) sonrası da aynı. Tetikleyicide `aria-expanded`/`aria-controls` yok, Escape ile kapanma yok.

**Etki:** Klavye ve ekran okuyucu kullanıcısı her açma/kapamada sayfa başına dönüyor, 50 yorumluk listede kaldığı yeri yeniden arıyor; formun açıldığı duyurulmuyor.

**Önerilen aksiyon:** `selectRef`/`triggerRef` ekleyin: açılınca `selectRef.current?.focus()`, kapanınca `triggerRef.current?.focus()`; tetikleyiciyi kaldırmak yerine `aria-expanded={open}` `aria-controls={`report-panel-${reviewId}`}` ile yerinde tutun; panelde `onKeyDown` Escape → kapat.

**Yapılan düzeltme:** ReportButton: the trigger now stays in the DOM with aria-expanded and aria-controls=report-panel-{id}. Opening moves focus to the select, and closing (Vazgeç, Escape or a successful send) returns it to the trigger. Escape works through onKeyDown on the panel. Submit is disabled with aria-busy while busy to stop double sends. Mobile buttons and select are min-h 44px. — dosyalar: `src/components/property/ReviewsSection.tsx`

## F329 — YZ yorum özeti EN arayüzde de Türkçe üretiliyor ve dil işareti yok

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | High                                                                                 |
| Durum               | Aday                                                                                 |
| Konum               | `src/components/property/ReviewsSection.tsx:188`                                     |
| Diğer konumlar      | `src/lib/ai/review-summary.ts:67`, `src/components/property/ReviewHighlights.tsx:56` |
| Kullanıcılar        | misafir                                                                              |
| Prensip             | learnability · consistency                                                           |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                          |
| WCAG                | 3.1.2                                                                                |
| Renk/tema           | Hayır                                                                                |
| Efor                | M                                                                                    |
| Kaynak denetçiler   | area:pdp                                                                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: pdp)                                                   |

**Kanıt:** ReviewsSection.tsx:187-190 `apiFetch<ReviewSummary>(`/api/properties/${propertyId}/reviews/summary`)` dil göndermiyor; ReviewHighlights.tsx:55-57 ise `?locale=${encodeURIComponent(locale)}` gönderiyor. review-summary.ts:67 sistem istemi 'Doğrulanmış misafir yorumlarını Türkçe özetle'; önbellek anahtarı `review-summary:${propertyId}:${version}` dil içermiyor. Özet kapsayıcısı (209) `lang` taşımıyor; `<html lang="en">` altında Türkçe metin.

**Etki:** EN arayüzü kullanan yabancı misafir özeti okuyamıyor; ekran okuyucu Türkçe metni İngilizce sesle bozuk okuyor. Aynı bölümde 'Öne çıkan temalar' İngilizce, özet Türkçe.

**Önerilen aksiyon:** Özet isteğine `?locale=` ekleyin; `summarizeReviews(id, locale)` istemine hedef dili ve önbellek anahtarına `:${locale}` ekleyin. Geçişte özet kapsayıcısına `lang="tr"` ve EN arayüzde görünür '(Türkçe özet)' notu koyun.

**Yapılan düzeltme:** The summary request now sends ?locale=, the loader depends on locale, and lang="tr" is set on the summary text and pros/cons lists. In non-tr UIs a visible note is shown (summary.inTurkish). Locale support in the API and summarizeReviews (prompt plus cache key) is a backend change (crossOwner). — dosyalar: `src/components/property/ReviewsSection.tsx`

## F447 — Doğrulanmış erişilebilirlik özelliği olmayan ilanlarda bölüm tamamen kayboluyor

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | Medium                                                                       |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                              |
| Konum               | `src/app/property/[id]/page.tsx:186`                                         |
| Diğer konumlar      | `src/components/property/AccessibilitySection.tsx`                           |
| Kullanıcılar        | misafir                                                                      |
| Prensip             | learnability · Observability (Dix) — 'bilgi yok' ile 'özellik yok' ayrılmalı |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                                   |
| Renk/tema           | Hayır                                                                        |
| Efor                | S                                                                            |
| Kaynak denetçiler   | runtime:pdp, area:pdp                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                 |

**Kanıt:** RUNTIME 006/007 Galata başlık listesi: Açıklama, Olanaklar, Fiyat takvimi, Misafir yorumları — 'Erişilebilirlik' yok; Grand Deluxe'te (p4) H2 'Erişilebilirlik' + 4 doğrulanmış özellik var. Kod: page.tsx:186 accessibility.length > 0 koşulu.

**Etki:** Engelli misafir özelliğin olmadığını mı yoksa beyan edilmediğini mi anlayamıyor; ev sahibine sorma yolu da gösterilmiyor.

**Önerilen aksiyon:** Bölümü her zaman render edin; boşken 'Bu ilan için doğrulanmış erişilebilirlik bilgisi yok. Rezervasyondan önce ev sahibine sorun' + mesaj bağlantısı gösterin.

## F536 — İçerik bildirme kanalı zor bulunuyor: ilan sayfasının en altında, genel form ise yalnızca güven merkezinden erişilebilir

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Gözlemlendi                                                  |
| Konum               | `src/app/property/[id]/page.tsx:194`                         |
| Diğer konumlar      | `src/components/layout/Footer.tsx`, `src/app/trust/page.tsx` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · Synthesizability / keşfedilebilirlik          |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                      |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | runtime:compliance                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** Kaynakta /report'a giden yalnızca iki bağlantı var: property/[id]/page.tsx:194 ve trust/page.tsx:50. Footer'da yalnızca /trust bağlantısı var (Footer.tsx:58). p11, mobile, /property/cmv2uybda001j92w2qsl5p0ww: 'Bu ilanı bildir' 5290 px yüksekliğindeki belgenin y=3340 noktasında, yorumlardan sonra, 14px, gri (rgb(75,85,99)) ve 80x19 px. Genel /report'a ulaşmak için footer, 'Güven merkezi' ve ardından son kartın sondan ikinci öğesi 'Yasa dışı içerik bildir (DSA)' izlenmeli (3 adım).

**Etki:** Dolandırıcılık şüphesi olan misafir bildirim yolunu bulamıyor. DSA md. 16'nın 'kolay erişilebilir mekanizma' beklentisi zayıf kalıyor.

**Önerilen aksiyon:** Footer'ın Destek sütununa ve Yardım Merkezi'ne 'İçerik bildir' bağlantısı ekleyin. İlan sayfasında başlık ve ev sahibi bilgisinin yakınına ikon ve etiketli bir 'Bildir' eylemi koyun. Yorum kartlarından da aynı akışa bağlantı verin.

## F537 — Masaüstünde yapışkan rezervasyon kutusu ekran yüksekliğinden uzun: 'Rezervasyonu Onayla' kaydırma boyunca kesik/görünmez

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | Medium                                                              |
| Durum               | Gözlemlendi                                                         |
| Konum               | `src/app/property/[id]/page.tsx:204`                                |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx`                          |
| Kullanıcılar        | misafir                                                             |
| Prensip             | learnability · Observability (Dix) — birincil eylem görünür kalmalı |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                      |
| Renk/tema           | Hayır                                                               |
| Efor                | S                                                                   |
| Kaynak denetçiler   | runtime:pdp                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                        |

**Kanıt:** RUNTIME probe p3-layout.mjs 1280x800: widget h=908 (>800). scrollY 0: submit top=1051 (ekran altı); scrollY 400 ve 800 (yapışkan evre): submit 785–829, cart bottom 887 → CTA yarım, 'Sepete ekle' görünmez; ancak sol sütun bitince (scrollY≥1100) görünür. 1366x680'de scrollY 900: submit top 785 > 680 (görünmez). Ekran: runtime/probes/property/p3-desktop-sticky-600.png (CTA'nın yalnız üst kenarı). Kod: page.tsx:204 lg:sticky lg:top-6, max-height sınırı yok.

**Etki:** Yapışkanlığın amacı (CTA'yı hep görünür tutmak) tersine dönüyor; dizüstü ekranlarda kullanıcı fiyatı görüp düğmeyi aramak zorunda.

**Önerilen aksiyon:** Yapışkan kapsayıcıya lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto verin veya fiyat içgörüsü/plan listesini sticky dışına alıp sticky kısmı 'tarih–misafir–toplam–CTA' ile sınırlayın; alternatif olarak CTA'yı widget içinde sticky bottom-0 yapın.

## F538 — Takvim ile rezervasyon kutusu durumu senkron değil; seçim URL'e yazılmıyor

| Alan                | Değer                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                 |
| Durum               | Gözlemlendi                                                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:108`                                        |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx`, `src/components/booking/stay-selection.ts` |
| Kullanıcılar        | misafir                                                                                |
| Prensip             | robustness · Consistency / Observability (Dix) — tek gerçek durum                      |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                            |
| Renk/tema           | Hayır                                                                                  |
| Efor                | M                                                                                      |
| Kaynak denetçiler   | runtime:pdp                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                           |

**Kanıt:** RUNTIME probe p9-sync.mjs: ?checkIn=2027-01-27&checkOut=2027-01-29 ile açılış → widget '27 Oca–29 Oca' ama takvimde aria-pressed gün yok. Takvimden 10–12 Oca seçince widget güncellendi; ardından widget seçicisinde tarih değiştirilince widget 'Tarih seçin' gösterirken takvim hâlâ '10 Ocak, 11 Ocak' pressed ve durum metni 'Seçildi: 10 Oca 2027 – 12 Oca 2027. Rezervasyon formu güncellendi.' URL hiç değişmedi; yenileme sonrası widget yine 27–29 Oca. Kod: PriceCalendar yalnız publish ediyor (156-175), subscribe etmiyor; BookingWidget.tsx:97-104 tek yönlü abonelik.

**Etki:** Sayfada aynı anda iki farklı tarih aralığı 'seçili' görünür; yanıltıcı durum mesajı; paylaşım/yenileme/geri tuşunda seçim kaybı.

**Önerilen aksiyon:** Tarih aralığını tek kaynakta tutun (URL arama parametreleri veya ortak store); PriceCalendar initialCheckIn/Out ve widget değişikliklerine abone olsun; her değişiklikte router.replace ile ?checkIn&checkOut&guests&roomId&ratePlanId güncellensin.

## F539 — Fiyat takvimi 21–31 ayrı Tab durağı; ok tuşu gezinmesi yok — rezervasyon kutusuna ulaşmak 53 Tab

| Alan                | Değer                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                 |
| Durum               | Gözlemlendi                                                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:285`                                        |
| Diğer konumlar      | `src/app/property/[id]/page.tsx`                                                       |
| Kullanıcılar        | misafir                                                                                |
| Prensip             | flexibility · Flexibility — kısayol/verimlilik (Dix: Customisability, Multi-threading) |
| Sezgisel madde      | H7 — Esneklik/verim                                                                    |
| WCAG                | 2.4.1 Bypass Blocks (destekleyici), 2.1.1                                              |
| Renk/tema           | Hayır                                                                                  |
| Efor                | M                                                                                      |
| Kaynak denetçiler   | runtime:pdp                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                           |

**Kanıt:** RUNTIME probe p1: takvimde 21 etkin günün 21'i tabbable, role=grid yok; ilk güne odaklanıp ArrowRight/ArrowDown → odak değişmiyor. p7b-tabwalk.mjs (Grand Deluxe): sayfa başından tarih düğmesine 53 Tab (21 takvim günü, 6 atıf bağlantısı, 3 alıntı, 2 şikâyet, 4 kanıt bağlantısı). Yeni ayda gün sayısı 30-31'e çıkıyor. Widget DOM'da sol sütundan sonra; 'Rezervasyona geç' atlama bağlantısı yok (yalnız 'İçeriğe geç').

**Etki:** Klavye/anahtar kullanıcıları için yüksek motor maliyet; rezervasyon kutusuna ulaşmak yorucu.

**Önerilen aksiyon:** Takvimi APG grid desenine çevirin: tek Tab durağı (roving tabindex), ok tuşları/Home/End/PageUp-Down ile gezinme. Başlık bloğuna 'Rezervasyon yap' atlama bağlantısı (#booking) ekleyin ve widget'a id verin.

## F540 — Takvimde her gün '★ En ucuz' ve 'Çok uygun': işaret bilgi taşımıyor, ekran okuyucu her günde 'ayın en ucuz gecesi' diyor

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Gözlemlendi                                          |
| Konum               | `src/components/property/PriceCalendar.tsx:305`      |
| Kullanıcılar        | misafir                                              |
| Prensip             | learnability · Minimal tasarım / Observability (Dix) |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                         |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | runtime:pdp                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                         |

**Kanıt:** RUNTIME probe p1-gallery-calendar.mjs: Ekim 21/21 etkin günde 'En ucuz' (cheapestCount=21), Kasım 30/30, tek fiyat (distinct ₺1.890,00); p9-sync: Aralık API cheapest 31/31, distinct price 1. Ekran crops/property/006-1.png ve 007-1.png: tüm hücreler yeşil kalın çerçeveli + '★ En ucuz'; mobilde yazı iki satıra kırılıyor ('★ En / ucuz'). aria-label örneği '11 Ekim 2026: ₺1.907,18, fiyat seviyesi Çok uygun, ayın en ucuz gecesi'.

**Etki:** Gerçek fırsat günü ayırt edilemiyor; görsel gürültü ve ekran okuyucuda her hücrede gereksiz uzun anons.

**Önerilen aksiyon:** cheapest rozetini yalnız ayın fiyatları farklıysa ve gün gerçekten tek/az sayıdaki minimum ise gösterin (ör. distinct>1 && cheapestCount<=3); tüm fiyatlar eşitse bant renklendirmeyi de nötr yapın ve 'Bu ay tüm gecelerin fiyatı aynı' notu verin.

## F541 — Mobilde takvimden tarih seçince 'Rezervasyon formu güncellendi' deniyor ama form 1,5 ekran aşağıda ve yol gösterilmiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Gözlemlendi                                     |
| Konum               | `src/components/property/PriceCalendar.tsx:355` |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx`      |
| Kullanıcılar        | misafir                                         |
| Prensip             | learnability · Feedback / Browsability (Dix)    |
| Sezgisel madde      | H12 — Feedback                                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | runtime:pdp                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** RUNTIME probe p11-en-err.mjs (390px, en): takvimden 20–23 Eki seçildikten sonra form top=1327px, total top=1863px (vh 896) — görünür değil; durum: 'Selected: Oct 20, 2026 – Oct 23, 2026. The booking form has been updated.' Sayfada widget'a giden bağlantı/düğme yok.

**Etki:** Kullanıcı güncellenen toplamı görmeden ya tekrar seçim yapıyor ya da formu arıyor; geri bildirim eyleme dönüştürülemiyor.

**Önerilen aksiyon:** Aralık tamamlandığında durum satırına 'Toplam ₺6.357 — Rezervasyona geç' düğmesi ekleyin (widget'a kaydırıp odak versin) veya mobil yapışkan özet çubuğunu (bkz. mobil bulgu) güncel toplamla vurgulayın.

## F542 — Galeri: alt metinler içerik anlatmıyor, seçili küçük görsel durumu bildirilmiyor, ok tuşu gezinmesi yok

| Alan                | Değer                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Severity            | Medium                                                                     |
| Durum               | Gözlemlendi                                                                |
| Konum               | `src/components/property/PropertyGallery.tsx:42`                           |
| Diğer konumlar      | `messages/tr/property.json`                                                |
| Kullanıcılar        | misafir                                                                    |
| Prensip             | accessibility · Observability (Dix) — durum ve içerik algılanabilir olmalı |
| Sezgisel madde      | H14 — Erişilebilirlik                                                      |
| WCAG                | 1.1.1 Non-text Content, 4.1.2 Name Role Value                              |
| Renk/tema           | Hayır                                                                      |
| Efor                | M                                                                          |
| Kaynak denetçiler   | runtime:pdp                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                               |

**Kanıt:** RUNTIME p1-gallery-calendar.mjs: ana görsel alt='İstanbul Galata Loft Suites - görsel 1'; düğme adları '… - küçük görsel 1/2/3'; aria-pressed/aria-current yok (null); ilk küçük görselde ArrowRight → odak ve ana görsel değişmiyor; Tab+Enter ile görsel 2'ye geçiyor (alt 'görsel 2'). Ana görsel düğme/bağlantı değil (büyütme yok). Metin: messages/tr/property.json:14-15.

**Etki:** Görme engelli misafir oda/havuz/manzara hakkında bilgi alamıyor; hangi fotoğrafın açık olduğunu duyamıyor.

**Önerilen aksiyon:** Fotoğraf başlığı/açıklaması alanı ekleyip alt'a yazın (yoksa 'Fotoğraf 2 / 3'); seçili düğmeye aria-current='true' (veya aria-pressed), düğme adını '2. fotoğrafı göster' yapın; ok tuşlarıyla önceki/sonraki ve ana görseli tam ekran açan erişilebilir lightbox ekleyin; 'n / toplam' sayacı gösterin.

## F543 — Yorum şikâyeti: oturum gerektiği ancak gönderimden sonra söyleniyor, giriş bağlantısı da verilmiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Gözlemlendi                                     |
| Konum               | `src/components/property/ReviewsSection.tsx:46` |
| Diğer konumlar      | `messages/tr/reviews.json`                      |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · Recoverability / feedforward       |
| Sezgisel madde      | H13 — Feedforward                               |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | runtime:compliance                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** p11, anon, mobile, /property/cmv2uybda001j92w2qsl5p0ww: 'Şikâyet et' tıklanınca neden select'i ve 'Gönder' açılıyor; seçim yapıp gönderince 12px gri metinle (role=status) 'Şikâyet için giriş yapmalısınız.' çıkıyor. Yakınında bağlantı yok (sayı 0) ve form açık kalıyor. Ekran görüntüsü: RT/crops/compliance/p11-review-report-view-mobile.png.

**Etki:** Anonim misafir zaman harcadıktan sonra engelleniyor. Girişe nasıl gideceği ve döndüğünde seçiminin korunup korunmayacağı belirsiz. Hata, durum metniyle aynı görünümde olduğu için gözden kaçıyor.

**Önerilen aksiyon:** Oturum yoksa 'Şikâyet et' doğrudan 'Şikâyet etmek için giriş yapın' mesajını ve /login?next=<ilan>#review-<id> bağlantısını göstersin; ya da anonim DSA formuna (/report?reviewId=…) yönlendirsin. Hata durumunu text-red-700 ve role=alert ile işaretleyin.

## F544 — Yorum şikâyeti açılınca klavye odağı kayboluyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Gözlemlendi                                     |
| Konum               | `src/components/property/ReviewsSection.tsx:91` |
| Kullanıcılar        | misafir                                         |
| Prensip             | accessibility · Klavye erişilebilirliği         |
| Sezgisel madde      | H14 — Erişilebilirlik                           |
| WCAG                | 2.4.3 Focus Order (A)                           |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | runtime:compliance                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** p11: 'Şikâyet et' butonuna tıklandıktan sonra focused=body. Buton DOM'dan kaldırılıp yerine select ve butonlar konuyor; odak yönetimi yapılmıyor (ReviewsSection.tsx:88-96).

**Etki:** Klavye ve ekran okuyucu kullanıcısı sayfanın başına atılıyor ve açılan şikâyet kontrollerini bulmak için baştan gezinmek zorunda kalıyor.

**Önerilen aksiyon:** open=true olduğunda useEffect ile select'e focus() verin. Vazgeç ya da gönderim sonrasında odağı 'Şikâyet et' butonuna geri döndürün.

## F545 — Yorum yıldızları 5 ölçeğini aşıyor: '★★★★★★★★' ve '5 üzerinden 8 puan', özet '8/5'

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Medium                                             |
| Durum               | Gözlemlendi                                        |
| Konum               | `src/components/property/ReviewsSection.tsx:166`   |
| Diğer konumlar      | `prisma/seed.ts`, `src/lib/llm/demo.ts`            |
| Kullanıcılar        | misafir                                            |
| Prensip             | robustness · Consistency (Dix) — ölçek tutarlılığı |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                        |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | runtime:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** RUNTIME p4-reviews-a11y.mjs (Grand Deluxe): her yorumda 8 dolu yıldız, aria-label '5 üzerinden 8 puan'; YZ özeti '2 doğrulanmış yorumun ortalaması 8/5.' (crops/property/p4-2.png, p4-3.png). Başlıkta '8.9' (10 ölçeği). Kaynak: prisma/seed.ts:1282 rating: 8 + (g % 3) (API POST 1-5 doğrularken seed 8-10 yazıyor); Stars bileşeni sınırlamıyor (ReviewsSection.tsx:170-172).

**Etki:** Anlamsız puan güveni bozar; ekran okuyucu 'beşte sekiz' okur; iki farklı ölçek (10 ve 5) karışıyor.

**Önerilen aksiyon:** Seed'i 1–5 aralığına çekin ve veri tabanına CHECK kısıtı koyun; Stars'ta Math.min(5, Math.max(0, rating)) ile koruyun; başlık puanına ölçeği yazın ('8,9/10') ve yorum ölçeğiyle tutarlı hale getirin.

## F546 — Yorumlarda sıralama/filtre/sayfalama yok; API sessizce en yeni 50 yorumla sınırlı

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Gözlemlendi                                       |
| Konum               | `src/components/property/ReviewsSection.tsx:269`  |
| Diğer konumlar      | `src/lib/reviews/review-service.ts`               |
| Kullanıcılar        | misafir                                           |
| Prensip             | flexibility · Flexibility — Customisability (Dix) |
| Sezgisel madde      | H7 — Esneklik/verim                               |
| Renk/tema           | Hayır                                             |
| Efor                | M                                                 |
| Kaynak denetçiler   | runtime:pdp                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** RUNTIME p4-reviews-a11y.mjs: yorum bölümünde yalnız 'Alıntıyı yorumda göster' ve 'Şikâyet et' düğmeleri; select/sekme/‘daha fazla’ yok. Kod: review-service.ts:131 listReviews(take = 50) orderBy createdAt desc; ReviewsSection.tsx:183-186 tek istek, sayfalama yok.

**Etki:** Yorumu çok olan ilanlarda kullanıcı en düşük puanlıları/kendi gezi tipini göremez; 50'den sonrası erişilemez ve bu bildirilmez.

**Önerilen aksiyon:** Sıralama (en yeni / en yüksek / en düşük puan) ve puan/alt-puan filtresi ekleyin; imleç tabanlı 'Daha fazla yorum göster' (yüklenen sayıyı aria-live ile duyurarak) ve 'X yorumdan 10'u gösteriliyor' sayacı koyun.

## F915 — Yavaş ağda ilan sayfası açılırken geri bildirim yok; aynı ilan sorgusu iki kez

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Medium                               |
| Durum               | Aday                                 |
| Konum               | `src/app/property/[id]/page.tsx:116` |
| Kullanıcılar        | misafir                              |
| Prensip             | robustness · responsiveness          |
| Sezgisel madde      | H15 — Performans                     |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | area:pdp                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**         |

**Kanıt:** src/app/property/[id]/ altında `loading.tsx` yok; page.tsx:116 `getProperty` → 117-118 çeviriler → 124 `listPublicFeatures` sıralı bekleniyor; generateMetadata (97-104) `getProperty`'yi React `cache()` olmadan ikinci kez çağırıyor.

**Etki:** Mobil ağda arama sonucuna tıklayan misafir sayfa hazır olana dek önceki sayfada geri bildirimsiz bekliyor, tekrar tıklıyor veya vazgeçiyor.

**Önerilen aksiyon:** src/app/property/[id]/loading.tsx: başlık çubuğu, 16:9 galeri ve widget iskeleti + `role="status"` sr-only 'İlan yükleniyor'; `getProperty`'yi `cache` (react) ile sarın; özellikler ve çevirileri `Promise.all` ile paralel alın; AccessibilitySection'ı Suspense içinde akıtın.

## F916 — İlan bulunamadı ve sunucu hatası için yerelleştirilmiş, yönlendirici sayfa yok

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Medium                               |
| Durum               | Aday                                 |
| Konum               | `src/app/property/[id]/page.tsx:121` |
| Diğer konumlar      | `messages/tr/property.json:3`        |
| Kullanıcılar        | misafir                              |
| Prensip             | robustness · recoverability          |
| Sezgisel madde      | H9 — Hata mesajları                  |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | area:pdp                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**         |

**Kanıt:** page.tsx:120-122 `notFound()`; src/app altında hiç `not-found.tsx` ve `error.tsx` yok (find boş) → Next varsayılan İngilizce 404/hata sayfası, Header ve arama bağlantısı olmadan. messages/tr/property.json:3 `"notFoundTitle": "Property Bulunamadı"` (Türkçe başlıkta İngilizce kelime).

**Etki:** Kaldırılmış ilan bağlantısıyla gelen TR misafir İngilizce, çıkışsız bir sayfa görüyor; aramaya dönmek için adres çubuğunu kullanıyor.

**Önerilen aksiyon:** src/app/property/[id]/not-found.tsx: Header + h1 'İlan bulunamadı veya artık yayında değil' + 'Aramaya dön' ve 'Ana sayfa' bağlantıları; src/app/property/[id]/error.tsx: yerelleştirilmiş metin + `reset()` çağıran 'Tekrar dene'; notFoundTitle → 'İlan bulunamadı'.

## F917 — İlan sayfasında karşılaştırmaya ekle, favorilere ekle ve paylaş eylemleri yok

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Aday                                              |
| Konum               | `src/app/property/[id]/page.tsx:138`              |
| Kullanıcılar        | misafir                                           |
| Prensip             | flexibility · multithreading / task migratability |
| Sezgisel madde      | H7 — Esneklik/verim                               |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:pdp                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** page.tsx:138-159 başlık alanında hiçbir eylem yok; CompareToggle yalnız search/page.tsx:542'de, favori yalnız PropertyCard.tsx:70-74'te kullanılıyor; paylaş yok.

**Etki:** Misafir birincil görevin 'karşılaştır' adımını en çok bilgi gördüğü sayfada yapamıyor, aramaya dönmek zorunda; paylaşılan bağlantıyla gelen kullanıcı ilanı kaydedemiyor, cihazlar arası aktarmak için adres çubuğunu kopyalıyor.

**Önerilen aksiyon:** h1 yanına `<CompareToggle propertyId={property.id} />`, `aria-pressed`'li 'Favorilere ekle' düğmesi ve 'Paylaş' (`navigator.share`; yoksa panoya kopyala + `role="status"` 'Bağlantı kopyalandı') ekleyin.

## F918 — İlan sayfasında arama sonuçlarına dönüş veya ekmek kırıntısı yok (projede hiç breadcrumb yok)

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Medium                               |
| Durum               | Aday                                 |
| Konum               | `src/app/property/[id]/page.tsx:138` |
| Kullanıcılar        | misafir                              |
| Prensip             | learnability · synthesizability      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü    |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | lens:nav                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**         |

**Kanıt:** 138-142: şehir ve ülke düz `<p>`, ardından h1; `/search?destination=…` bağlantısı yok. Sayfa checkIn/checkOut/guests alıyor (109-115) ama destination almıyor, bu yüzden dönüş bağlantısı kurulamıyor. `grep -i breadcrumb src` sonuç vermiyor.

**Etki:** Mobilde ilan sayfasına derin linkle gelen misafir aynı şehirdeki diğer seçeneklere dönemiyor. Tarayıcı geri tuşu da filtreleri sıfırlıyor (bkz. önceki bulgu).

**Önerilen aksiyon:** `<nav aria-label="Konum"><ol>` breadcrumb ekleyin: Ana sayfa › {city} konaklamaları (`/search?destination={city}&checkIn…&guests…`) › {title} (`aria-current="page"`). PropertyCard'dan gelen arama sorgusunu `from` parametresiyle taşıyıp "← Sonuçlara dön" bağlantısı gösterin.

## F919 — Hiç yorumu olmayan ilanda '0.0' puan rozeti gösteriliyor

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Medium                               |
| Durum               | Aday                                 |
| Konum               | `src/app/property/[id]/page.tsx:143` |
| Kullanıcılar        | misafir, ev sahibi                   |
| Prensip             | learnability · familiarity           |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi          |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | area:pdp                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**         |

**Kanıt:** page.tsx:143-150 rozet koşulsuz render ediliyor; schema.prisma:118 `ratingAvg Float @default(0)` → yeni ilanda '0.0' + '0 değerlendirme'.

**Etki:** Misafir yeni ilanı 'en kötü puanlı' sanıyor; ev sahibinin ilanı haksız biçimde dezavantajlı görünüyor.

**Önerilen aksiyon:** `property.ratingCount === 0` ise rozet yerine `t("noRatingsYet")` = 'Henüz değerlendirme yok' (veya 'Yeni ilan') metni gösterin.

## F920 — Puan rozetinde ölçek belirtilmiyor ve yorum yıldızlarıyla tutarsız

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/app/property/[id]/page.tsx:144`                         |
| Diğer konumlar      | `src/lib/reviews/review-service.ts:38`, `prisma/seed.ts:416` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · consistency                                   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                  |
| Renk/tema           | Hayır                                                        |
| Efor                | M                                                            |
| Kaynak denetçiler   | area:pdp                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** page.tsx:144-146 `<span …>{property.ratingAvg.toFixed(1)}</span>` ölçek yok; seed değerleri 10'luk (prisma/seed.ts:416 `ratingAvg: 8.8`), recomputeRating (review-service.ts:38-45) ise 1–5 ortalaması yazıyor; yorumlar '5 üzerinden' yıldız (reviews.json starsLabel) ve alt puanlar '/5' (ReviewsSection.tsx:296). docs/img/property.png: '8.8' rozeti. Ekran okuyucu '8.8 260 değerlendirme' okuyor, 'puan' bağlamı yok.

**Etki:** Misafir 8.8'i 5 üzerinden yıldızlarla kıyaslayamıyor; ilk yeni yorumla puan 8.8'den ~4.5'e düşmüş görünecek; ilanlar arası karşılaştırma yanıltıcı.

**Önerilen aksiyon:** Veride tek ölçeğe normalleştirin; rozete görünür '/5' (veya '/10') ekleyin: `<span aria-hidden="true">4,4</span><span className="sr-only">5 üzerinden 4,4 puan</span>`; isteğe bağlı sözel etiket ('Çok iyi').

## F921 — Yapışkan rezervasyon kutusu masaüstünde ekrandan uzun, gönder düğmesi görünmüyor

| Alan                | Değer                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Severity            | Medium                                                                  |
| Durum               | Aday                                                                    |
| Konum               | `src/app/property/[id]/page.tsx:204`                                    |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:135`, `src/app/layout.tsx:57` |
| Kullanıcılar        | misafir                                                                 |
| Prensip             | robustness · task conformance                                           |
| Sezgisel madde      | H7 — Esneklik/verim                                                     |
| Renk/tema           | Hayır                                                                   |
| Efor                | S                                                                       |
| Kaynak denetçiler   | lens:mobile                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                            |

**Kanıt:** page.tsx:204 `lg:sticky lg:top-6` sarmalayıcısında yükseklik ya da kaydırma sınırı yok. BookingWidget.tsx:135-263; başlık, tarih, misafir, oda, fiyat planları, teklif dökümü, PriceInsight, 'Rezervasyon yap', sepete ekle ve ipucunu içeriyor. docs/img/property.png'de (1280×860) kutu y≈290'da başlıyor, 'Toplam' satırı 837px'te ve gönder düğmesi ekranın altında. Kutu sol sütun boyunca yapışık kaldığı için 1366×768 dizüstünde gönder düğmesi sol sütun (50 yorum) bitene kadar görünmüyor. Ayrıca top-6 (24px), layout.tsx:57'deki yapışkan DEMO şeridinin (≈26px) altına giriyor.

**Etki:** Yaygın 768px yükseklikli dizüstülerde misafir fiyatı görüyor ama 'Rezervasyon yap' düğmesini bulmak için sayfanın en altına inmesi gerekiyor.

**Önerilen aksiyon:** Sarmalayıcıya `lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto` ekle ya da yalnız toplam ve CTA bölümünü yapışkan yap (PriceInsight ve sepete ekle normal akışta kalsın). Demo modunda top değerini şerit yüksekliği kadar artır (ör. `[[data-demo=true]_&]:lg:top-10`).

## F922 — Takvim ile rezervasyon formu tarihleri senkron değil (tek yönlü köprü)

| Alan                | Değer                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Severity            | Medium                                                                              |
| Durum               | Aday                                                                                |
| Konum               | `src/components/property/PriceCalendar.tsx:108`                                     |
| Diğer konumlar      | `src/app/property/[id]/page.tsx:188`, `src/components/booking/BookingWidget.tsx:97` |
| Kullanıcılar        | misafir                                                                             |
| Prensip             | learnability · consistency                                                          |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                         |
| Renk/tema           | Hayır                                                                               |
| Efor                | M                                                                                   |
| Kaynak denetçiler   | area:pdp                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                        |

**Kanıt:** page.tsx:188 `<PriceCalendar propertyId={property.id} initialCheckIn={initial.checkIn} />` — checkOut geçmiyor; PriceCalendar.tsx:108-109 `checkIn`/`checkOut` state'i `null` başlıyor (initialCheckIn yalnız ayı belirliyor, 102-106). BookingWidget URL tarihlerini (BookingWidget.tsx:69-70) ve kendi DateRangePicker'ını (153) kullanıyor; stay-selection.ts yalnız takvimden forma yayın yapıyor.

**Etki:** Aramadan tarihlerle gelen misafir formda tarihleri görüyor ama takvimde seçim yok; formda tarihi değiştirince takvim eski haliyle kalıyor — aynı sayfada iki farklı 'seçili tarih'.

**Önerilen aksiyon:** `initialCheckOut` geçirip state'i iki tarihle başlatın; BookingWidget `handleDateChange` içinde `publishStaySelection` çağırıp PriceCalendar'da `subscribeStaySelection` ile dinleyin (veya ikisini ortak bir client context sağlayıcısına alın).

## F923 — Seçili aralıkta çıkış günü işaretlenmiyor; giriş/çıkış uçları ayırt edilmiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:177` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · observability                      |
| Sezgisel madde      | H12 — Feedback                                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** PriceCalendar.tsx:177-179 `inRange = date === checkIn || (checkOut !== null && date > checkIn && date < checkOut)` — çıkış günü dahil değil; 297 aralıktaki tüm günler aynı `ring-2` alıyor; hücrede 'Giriş'/'Çıkış' metni yok.

**Etki:** Misafir çıkış gününe tıkladığında o gün işaretlenmediği için seçimin başarısız olduğunu sanıp yeniden tıklıyor; bu tıklama yeni bir giriş seçimi başlatıyor.

**Önerilen aksiyon:** Gün rolünü hesaplayın (checkIn | checkOut | between); uç günlerde hücrede görünür 'Giriş'/'Çıkış' metni (minStay satırının yerine) ve kalın kenarlık, aradaki gecelerde dolgu deseni; çıkış gününü vurguya dahil edin.

## F924 — Vergi hariç gösterim seçeneği sayfadaki 'fiyatlar vergi dahildir' notuyla çelişiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:187` |
| Diğer konumlar      | `src/app/property/[id]/page.tsx:156`            |
| Kullanıcılar        | misafir                                         |
| Prensip             | learnability · consistency                      |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                     |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** page.tsx:156-158 `market.totalPriceDisplay === "required" && <p>{t("totalPriceNote")}</p>` → 'Gösterilen fiyatlar vergi ve zorunlu ücretler dahil toplamdır.'; PriceCalendar.tsx:187-195 pazardan bağımsız `<input type="checkbox" checked={taxesIncluded} …>` ile vergi hariç fiyat gösterilebiliyor (alt başlık 'vergi ve ücretler hariç').

**Etki:** Kutuyu kaldıran misafir sayfa başı 'vergi dahil' derken vergisiz takvim fiyatını toplam sanabiliyor (para hatası).

**Önerilen aksiyon:** PriceCalendar'a `totalPriceRequired` prop'u geçin; zorunlu pazarlarda kutuyu render etmeyin. Diğer pazarlarda notu 'Aksi belirtilmedikçe…' diye değiştirin ve vergi hariç modda takvim üstünde 'Vergiler hariç gösteriliyor' satırı gösterin.

## F925 — Asenkron bölümler yer ayırmadan yükleniyor; okurken içerik kayıyor

| Alan                | Değer                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                              |
| Durum               | Aday                                                                                                |
| Konum               | `src/components/property/PriceCalendar.tsx:224`                                                     |
| Diğer konumlar      | `src/components/property/ReviewsSection.tsx:208`, `src/components/property/ReviewHighlights.tsx:71` |
| Kullanıcılar        | misafir                                                                                             |
| Prensip             | robustness · responsiveness                                                                         |
| Sezgisel madde      | H15 — Performans                                                                                    |
| Renk/tema           | Hayır                                                                                               |
| Efor                | S                                                                                                   |
| Kaynak denetçiler   | area:pdp                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                        |

**Kanıt:** PriceCalendar.tsx:224-235 her ay/vergi değişiminde tablo (≈6×56 px + lejant) kaldırılıp tek satır 'Fiyatlar yükleniyor…' gösteriliyor; ReviewsSection.tsx:208 özet geldiğinde listenin üstüne ekleniyor; ReviewHighlights.tsx:71 yüklenirken `null` dönüp sonra yorumların üstüne blok ekliyor.

**Etki:** Mobil misafir yorum okurken üstte özet/öne çıkanlar belirince metin aşağı kayıyor; ay değiştirirken sayfa yüksekliği zıplıyor, yanlış öğeye dokunma riski.

**Önerilen aksiyon:** Takvimde önceki ızgarayı `aria-busy="true"` ve `opacity-60` ile yerinde tutup veri gelince değiştirin (veya sabit `min-h` iskelet); özet ve öne çıkanlar için yükleme sırasında sabit yükseklikli iskelet kutular render edin.

## F926 — Fiyat takvimi hatasında yeniden deneme yok ve yönlendirici metin eksik

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:229` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · recoverability                     |
| Sezgisel madde      | H9 — Hata mesajları                             |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** PriceCalendar.tsx:229-233 `<p className="mt-3 text-sm text-red-700" role="alert">{t("error")}</p>` → 'Fiyat takvimi yüklenemedi'; istek yalnız `[propertyId, month, taxes]` değişince (123-138) tekrarlanıyor, düğme yok. Hata altında 355-357 hâlâ 'Giriş için bir gün seçin…' yazıyor.

**Etki:** Mobil ağda geçici hata alan misafir takvimi geri getiremiyor (sayfayı yenilemek ya da ay değiştirip dönmek zorunda); metin ne yapacağını söylemiyor.

**Önerilen aksiyon:** Effect bağımlılıklarına `retry` sayacı ekleyin, hatanın yanına `<button type="button" onClick={() => setRetry(n => n + 1)}>Tekrar dene</button>`; metni 'Fiyat takvimi yüklenemedi. Tekrar deneyin ya da tarihleri rezervasyon formundan seçin.' yapın; hata varken selectHint'i gizleyin.

## F927 — Takvimde ok tuşlarıyla gezinme yok; her gün ayrı Tab durağı

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:249` |
| Kullanıcılar        | misafir                                         |
| Prensip             | flexibility · substitutivity                    |
| Sezgisel madde      | H7 — Esneklik/verim                             |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** PriceCalendar.tsx:249-327 her müsait gün ayrı `<button type="button">`; `onKeyDown` veya roving `tabIndex` yok. Takvimi geçmek için ayda 30'a kadar Tab.

**Etki:** Yalnız klavye/anahtar cihazı kullanan misafir için tarih seçimi ve takvimi geçmek yavaş; BookingWidget tarih seçicisinden farklı etkileşim modeli.

**Önerilen aksiyon:** Roving tabindex: yalnız odaktaki/seçili gün `tabIndex=0`; ArrowLeft/Right ±1 gün, ArrowUp/Down ±7, Home/End hafta başı/sonu, PageUp/PageDown önceki/sonraki ay (aynı gün numarasına odak); tablo öncesine sr-only 'Ok tuşlarıyla gün değiştirin' ipucu (`aria-describedby`).

## F928 — Takvim seçimi ekran okuyucuya rolüyle aktarılmıyor; aria-pressed anlamı yanıltıcı

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:288` |
| Kullanıcılar        | misafir                                         |
| Prensip             | accessibility · Name, Role, Value               |
| Sezgisel madde      | H14 — Erişilebilirlik                           |
| WCAG                | 4.1.2                                           |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** PriceCalendar.tsx:288 `aria-pressed={selected}` aralıktaki her güne 'basılı' durumu veriyor; basılı güne tekrar basmak durumu kaldırmıyor, yeni giriş başlatıyor (selectDay 170-174). aria-label (289-294) giriş/çıkış rolünü içermiyor; çıkış günü 'basılı değil'.

**Etki:** Ekran okuyucu kullanıcısı aralıkta gezinirken hangi günün giriş, hangisinin çıkış olduğunu duyamıyor; durum satırı (355) bir kez duyurulup değişiyor.

**Önerilen aksiyon:** `aria-pressed`'i kaldırın; aria-label sonuna rol ekleyin: ', giriş tarihi' / ', çıkış tarihi' / ', seçili konaklama gecesi'. İleri adımda ARIA grid deseni (`role="grid"`, `aria-selected`) kullanın.

## F929 — Sabit yükseklikli takvim hücresinde 10–11 px metin: 360 px ve metin büyütmede taşma riski

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:295` |
| Kullanıcılar        | misafir                                         |
| Prensip             | accessibility · Resize Text / Text Spacing      |
| Sezgisel madde      | H14 — Erişilebilirlik                           |
| WCAG                | 1.4.4                                           |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** PriceCalendar.tsx:295 `flex h-14 w-full flex-col …`, 302 `text-[11px]` fiyat, 307 `text-[10px]` '★ En ucuz', 237 `table-fixed border-spacing-1`. 360 px'de hücre ≈ (360−32−8×4)/7 ≈ 42 px; '★ En ucuz' (~50 px) iki satıra kırılır; gün + fiyat + iki satır etiket 56 px'i doldurur; %200 metin büyütme veya 1.4.12 aralığında içerik sabit h-14 dışına taşar (statik hesap; tarayıcıda doğrulanmalı). EN 'min 3 nights' daha uzun.

**Etki:** Düşük görüşlü veya mobil misafir fiyatları kırpılmış/üst üste görüyor; 10 px metin varsayılan boyutta da zor okunuyor.

**Önerilen aksiyon:** `h-14` → `min-h-14`; en küçük metni `text-xs` (12 px) yapın; `<sm` genişlikte para sembolünü hücreden kaldırıp alt başlıkta belirtin ('Fiyatlar ₺'), '★ En ucuz' yerine yalnız '★' + lejant; çok dar ekranda liste görünümüne geçin.

## F930 — Girişe kapalı günler ve en ucuz gecedeki min. konaklama hücrede görünmüyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:305` |
| Kullanıcılar        | misafir                                         |
| Prensip             | learnability · predictability                   |
| Sezgisel madde      | H13 — Feedforward                               |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** PriceCalendar.tsx:305-320 hücrede yalnız `day.cheapest` → '★ En ucuz' ya da `!day.cheapest && day.minStay` → 'min N gece' gösteriliyor; `closedToArrival` yalnız aria-label'da (278), görsel karşılığı yok; en ucuz gecede minStay gizleniyor. Lejant (334-351) bu durumları içermiyor.

**Etki:** Gören misafir en ucuz geceye tıklıyor, ancak sonra 'giriş yapılamıyor' (167) mesajı ya da teklifte min. konaklama hatası alıyor; deneme-yanılma.

**Önerilen aksiyon:** Girişe kapalı günlere görünür 'Giriş yok' metni (+ aria-hidden ikon); en ucuz gecede birleşik '★ En ucuz · min 3' satırı; lejanda 'Giriş yok' ve 'min N gece' öğeleri.

## F931 — Galeride önceki/sonraki, konum sayacı, büyütme ve kaydırma yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/property/PropertyGallery.tsx:28` |
| Kullanıcılar        | misafir                                          |
| Prensip             | flexibility · substitutivity                     |
| Sezgisel madde      | H7 — Esneklik/verim                              |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** PropertyGallery.tsx:28-38 ana görsel etkileşimsiz `<div className="relative aspect-[16/9] w-full"><Image … /></div>`; tek gezinme yolu 40-62 `grid grid-cols-4` küçük resim ızgarası (20 fotoğrafta 5 satır). Ok tuşu/kaydırma işleyicisi, 'n / N' göstergesi, tam ekran görünüm yok.

**Etki:** Mobil misafir alışkın olduğu kaydırma hareketiyle fotoğraf değiştiremiyor, kaçıncı fotoğrafta olduğunu bilmiyor, ayrıntı için büyütemiyor; çok fotoğraflı ilanda ızgara sayfayı uzatıyor.

**Önerilen aksiyon:** Ana görsel üstüne 'Önceki fotoğraf'/'Sonraki fotoğraf' aria-label'lı ≥44 px düğmeler ve görünür '3 / 12' sayacı; galeride ArrowLeft/ArrowRight; ana görseli `<button>` yapıp `<dialog>` tam ekran (Esc kapatır, odak tetikleyiciye döner); mobilde küçük resimleri `overflow-x-auto snap-x` şeride çevirin, 8'den fazlasında '+N fotoğraf' düğmesi.

## F932 — Öne çıkan alıntı düğmesi alıntı bloğu gibi görünüyor; eylemi görünür metinle belirtilmiyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Medium                                             |
| Durum               | Aday                                               |
| Konum               | `src/components/property/ReviewHighlights.tsx:105` |
| Kullanıcılar        | misafir                                            |
| Prensip             | learnability · predictability                      |
| Sezgisel madde      | H11 — Affordance                                   |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | area:pdp                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** ReviewHighlights.tsx:101-108 `<button … className="mt-1 block w-full border-l-4 border-indigo-400 pl-2 text-left italic text-gray-800 hover:bg-indigo-50 …">` — görünüm blockquote; eylem metni yalnız `sr-only` (107) ve `title` ('Alıntıyı yorumda göster'); hover efekti beyaz kartta çok zayıf ve dokunmatikte yok.

**Etki:** Misafir alıntıya dokunarak kaynak yoruma gidebileceğini fark etmiyor; atıflı doğrulama özelliği kullanılmıyor.

**Önerilen aksiyon:** Alıntıdan sonra düğme içinde görünür 'Yorumda göster ↓' (ok aria-hidden, `text-sm underline`) ekleyin; sağda ok ikonu ile tıklanabilirlik ipucu verin.

## F933 — Şikâyet gönderiminde bekleme durumu yok; çift gönderim ve tekrar şikâyet mümkün

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/property/ReviewsSection.tsx:34` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · responsiveness                     |
| Sezgisel madde      | H12 — Feedback                                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** ReviewsSection.tsx:34-52 `submit()` için `sending` durumu yok; 73-79 'Gönder' istek sürerken etkin. Başarıdan sonra 41-42 `setOpen(false)` 'Şikâyet et' düğmesini (89-95) geri getiriyor; ikinci gönderim 409 'Bu yorumu zaten şikâyet ettiniz' ile başarı mesajının yerine geçiyor.

**Etki:** Yavaş ağda iki kez basan misafir önce başarı sonra hata görüyor, şikâyetin alınıp alınmadığından emin olamıyor.

**Önerilen aksiyon:** `const [sending, setSending]`; gönderimde düğmeyi `disabled` + 'Gönderiliyor…' yapın; başarıdan sonra tetikleyici yerine statik 'Şikâyet edildi' metni gösterin; REPORT_EXISTS'i bilgi olarak ele alın ('Bu yorumu daha önce şikâyet ettiniz').

## F934 — Sunucu hata mesajları EN arayüzde Türkçe gösteriliyor

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | Medium                                                                       |
| Durum               | Aday                                                                         |
| Konum               | `src/components/property/ReviewsSection.tsx:47`                              |
| Diğer konumlar      | `src/components/property/ReviewsSection.tsx:262`, `src/lib/api-client.ts:40` |
| Kullanıcılar        | misafir                                                                      |
| Prensip             | learnability · consistency                                                   |
| Sezgisel madde      | H9 — Hata mesajları                                                          |
| Renk/tema           | Hayır                                                                        |
| Efor                | S                                                                            |
| Kaynak denetçiler   | area:pdp                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                 |

**Kanıt:** ReviewsSection.tsx:44-50 `e instanceof ApiError ? e.message : t("report.failed")` — sunucu metinleri yalnız Türkçe: review-service.ts reportReview 'Kendi yorumunuzu şikâyet edemezsiniz', 'Bu yorumu zaten şikâyet ettiniz' (REPORT_EXISTS), 'Yorum bulunamadı'; errors.ts:160 'Kayıt bulunamadı'; api-client.ts:40 'İstek başarısız'.

**Etki:** EN arayüzündeki misafir şikâyet sonucunu ve yükleme hatalarını anlayamıyor.

**Önerilen aksiyon:** `e.code`'u mesaj anahtarına eşleyin: REPORT_EXISTS → `report.alreadyReported`, FORBIDDEN → `report.ownReview`, NOT_FOUND → `report.notFound`, UNAUTHORIZED → `report.loginRequired`, diğer → `report.failed`; `e.message`'ı asla render etmeyin.

## F935 — Oturumsuz kullanıcıya giriş gerektiği önceden söylenmiyor; hata mesajında giriş yolu yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/property/ReviewsSection.tsx:89` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · recoverability                     |
| Sezgisel madde      | H13 — Feedforward                               |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** ReviewsSection.tsx:27 bileşen yorumu 'oturum gerekir' diyor ama 89-95 tetikleyici herkese aynı; neden seçip gönderdikten sonra 45-46 401 → 'Şikâyet için giriş yapmalısınız.' düz metin, bağlantı yok; catch dalında form açık kalıyor.

**Etki:** Oturumsuz misafir formu doldurup gönderdikten sonra reddediliyor; giriş sayfasına kendisi gidip yorumu yeniden bulmak zorunda.

**Önerilen aksiyon:** ui.tsx `useSession()` ile oturum yoksa tetikleyiciyi `<Link href={`/login?next=/property/${propertyId}#review-${reviewId}`}>Şikâyet için giriş yapın</Link>` yapın; 401 dalında `t.rich` ile aynı bağlantıyı içeren mesaj gösterin.

## F936 — Şikâyet başarı ve hata mesajları aynı görünüm ve aynı rolde

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/property/ReviewsSection.tsx:97` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · observability                      |
| Sezgisel madde      | H9 — Hata mesajları                             |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** ReviewsSection.tsx:97-101 `<p role="status" className="mt-1 text-gray-700">{status}</p>` hem 'Şikâyetiniz alındı, teşekkürler.' hem 'Şikâyet gönderilemedi' için kullanılıyor; ikon/önek yok, hata `role="alert"` değil.

**Etki:** Misafir sonucun başarı mı hata mı olduğunu metni dikkatle okumadan ayırt edemiyor; ekran okuyucu hatayı kibar bildirim olarak geçiyor.

**Önerilen aksiyon:** Durumu `{ kind: "success" | "error", text }` olarak tutun; hata için `role="alert"` + görünür 'Hata:' öneki ve aria-hidden ⚠ ikonu, başarı için ✓ ikonu (renk değişmeden); ui.tsx `Status` bileşenini (144-155) yeniden kullanın.

## F937 — Boş yıldızların kontrastı düşük; puan ölçeği yalnız soluk gliflerle veriliyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/property/ReviewsSection.tsx:171` |
| Kullanıcılar        | misafir                                          |
| Prensip             | accessibility · Non-text Contrast                |
| Sezgisel madde      | H14 — Erişilebilirlik                            |
| WCAG                | 1.4.11                                           |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** ReviewsSection.tsx:171 `<span aria-hidden="true" className="text-gray-400">` — #9ca3af beyaz zeminde ≈2.5:1 (< 3:1); '5 üzerinden' bilgisinin görsel tek taşıyıcısı bu glifler.

**Etki:** Düşük görüşlü misafir 3 dolu yıldızı 3/3 sanabiliyor.

**Önerilen aksiyon:** Paleti değiştirmeden: yıldızların yanına görünür sayısal metin '4/5' ekleyin; böylece yıldızlar destekleyici olur (renk tonu değişikliği tercih edilirse tema kapsamına girer).

## F938 — Yorumlar 50 ile sınırlı; sayfalama, sıralama, filtre ve 'kaç tanesi gösteriliyor' bilgisi yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/property/ReviewsSection.tsx:184` |
| Diğer konumlar      | `src/lib/reviews/review-service.ts:131`          |
| Kullanıcılar        | misafir                                          |
| Prensip             | flexibility · customizability                    |
| Sezgisel madde      | H7 — Esneklik/verim                              |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** review-service.ts:131 `listReviews(propertyId, take = 50)`; ReviewsSection.tsx:184 sayfa parametresiz çağırıyor, 270-318 tümünü tek listede çiziyor. Başlıkta 260 değerlendirme (docs/img/property.png), özet '30 yoruma dayanır' (review-summary.ts:28 MAX_REVIEWS=30), listede 50 — açıklama yok.

**Etki:** Misafir eski veya düşük puanlı yorumlara ulaşamıyor, puan/tarihe göre sıralayamıyor; üç farklı sayı (260/30/50) güveni zedeliyor; mobilde 50 yorum çok uzun kaydırma.

**Önerilen aksiyon:** İmleç tabanlı sayfalama: ilk 10 yorum + 'Daha fazla yorum göster (10/260)' düğmesi, yüklenen ilk yeni öğeye odak; sıralama `<select>` (En yeni / En yüksek puan / En düşük puan) ve puan filtresi; liste üstünde '260 yorumdan 1–10 gösteriliyor'.

## F939 — Yorum özeti kapsayıcısı aria-live: uzun özet bağlamsız ve kesintili duyuruluyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/property/ReviewsSection.tsx:207` |
| Kullanıcılar        | misafir                                          |
| Prensip             | accessibility · Status Messages                  |
| Sezgisel madde      | H14 — Erişilebilirlik                            |
| WCAG                | 4.1.3                                            |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** ReviewsSection.tsx:207 `<div aria-live="polite">` 208-255'teki tüm özeti (≤800 karakter + 5 olumlu + 5 olumsuz + kaynaklar; review-summary.ts:22-25) kapsıyor; özet asenkron geldiğinde kullanıcı neredeyse orada tamamı okunuyor.

**Etki:** Ekran okuyucu kullanıcısı galeride ya da formdayken uzun bir metin okumasıyla kesiliyor, yaptığı işin bağlamını kaybediyor.

**Önerilen aksiyon:** Kapsayıcıdan `aria-live`'ı kaldırın; gerekiyorsa yalnız kısa sr-only `<p role="status">Yorum özeti hazır</p>` kullanın; hata metnini (255) `role="status"` ile verin.

## F940 — Yorum listesi hatasında ham teknik mesaj ve yeniden deneme yok

| Alan                | Değer                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                        |
| Durum               | Aday                                                                                                          |
| Konum               | `src/components/property/ReviewsSection.tsx:260`                                                              |
| Diğer konumlar      | `src/components/property/ReviewHighlights.tsx:70`, `src/components/ui/ui.tsx:255`, `src/lib/api-client.ts:40` |
| Kullanıcılar        | misafir                                                                                                       |
| Prensip             | robustness · recoverability                                                                                   |
| Sezgisel madde      | H9 — Hata mesajları                                                                                           |
| Renk/tema           | Hayır                                                                                                         |
| Efor                | S                                                                                                             |
| Kaynak denetçiler   | area:pdp                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                  |

**Kanıt:** ReviewsSection.tsx:260-264 `<p role="alert" …>{reviews.error}</p>` — useLoader (ui.tsx:255, 266) `e.message` döndürüyor, örn. api-client.ts:40 `İstek başarısız (${res.status})`; useLoader'ın `reload`'u (ui.tsx:262) yorumlar, özet (255) ve öne çıkanlar (ReviewHighlights.tsx:70) için hiç kullanılmıyor.

**Etki:** Misafir 'İstek başarısız (500)' gibi teknik bir metin görüyor, ne yapacağını bilmiyor; yorumlar için tüm sayfayı yenilemek zorunda.

**Önerilen aksiyon:** `t("loadFailed")` = 'Yorumlar yüklenemedi.' + `<Button variant="secondary" onClick={reviews.reload}>Tekrar dene</Button>`; özet ve öne çıkanlar için de aynı düğme; ham mesajı yalnız console'a yazın.

## F941 — Uzun listelerde sayfalama yok (yorumlar, ev sahibi rezervasyonları)

| Alan                | Değer                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                              |
| Durum               | Aday                                                                                                                                |
| Konum               | `src/components/property/ReviewsSection.tsx:271`                                                                                    |
| Diğer konumlar      | `src/lib/reviews/review-service.ts:131`, `src/components/host/HostDashboard.tsx:161`, `src/components/host/PromotionsPanel.tsx:184` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                  |
| Prensip             | robustness · responsiveness                                                                                                         |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                                                                                        |
| Renk/tema           | Hayır                                                                                                                               |
| Efor                | M                                                                                                                                   |
| Kaynak denetçiler   | lens:mobile                                                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                        |

**Kanıt:** ReviewsSection.tsx:270-271 tüm yorumları tek seferde render ediyor. API (api/properties/[id]/reviews/route.ts:12 `listReviews(id)`, review-service.ts:131 `take = 50`) 50'ye kadar yorum döndürüyor ve 'daha fazla' seçeneği yok. HostDashboard.tsx:161 `bookings.map` tüm rezervasyonları tek tabloda gösteriyor. PromotionsPanel.tsx:184 de aynı.

**Etki:** Mobilde ilan sayfasının DOM'u ve kaydırma uzunluğu büyüyor; rezervasyon formu sayfanın altında olduğu için bu, PDP sorununu ağırlaştırıyor. Ev sahibi yüzlerce satırlık bir tabloda gezinmek zorunda kalıyor.

**Önerilen aksiyon:** Yorumlarda ilk 5'i göster ve 'Daha fazla yorum (N)' düğmesi ekle (sunucuda `cursor`/`take`), puan filtresi koy. Ev sahibi rezervasyonlarında durum filtresi ve 20'şerli sayfalama ya da 'Daha fazla yükle' kullan.

## F942 — Ev sahibi yanıtı gösteriliyor ama yanıt yazacak arayüz yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/property/ReviewsSection.tsx:309` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · task conformance                    |
| Sezgisel madde      | H7 — Esneklik/verim                              |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** ReviewsSection.tsx:309-314 `r.hostReply` gösteriliyor; API `POST /api/reviews/[id]/reply` (reply/route.ts:10-13, HOST/ADMIN) mevcut, ancak src/components/host ve src/app/host altında 'reply' geçen bileşen yok (grep boş); ilan sayfasında ev sahibine özel eylem yok.

**Etki:** Ev sahibi olumsuz yorumlara yanıt veremiyor; misafirin gördüğü 'Ev sahibinin yanıtı' alanı pratikte boş kalıyor.

**Önerilen aksiyon:** Oturumdaki kullanıcı ilanın ev sahibiyse (useSession + hostId) yanıtsız yorumlarda 'Yanıtla' düğmesi ve etiketli `<textarea>` (2–1000 karakter, sayaçlı), gönderimde bekleme durumu; ayrıca ev sahibi panelinde yorum listesi.

## F1132 — Puan rozeti ölçeksiz ve yorumlara bağlantı değil

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Low                                  |
| Durum               | Gözlemlendi                          |
| Konum               | `src/app/property/[id]/page.tsx:144` |
| Kullanıcılar        | misafir                              |
| Prensip             | learnability · Browsability (Dix)    |
| Sezgisel madde      | H6 — Tanıma > hatırlama              |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | runtime:pdp                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**         |

**Kanıt:** RUNTIME p4: başlık 'ratingBadge: 8.9 1240 değerlendirme', ratingIsLink=false; ekran okuyucuya '8.9' bağlamsız sayı.

**Etki:** Kullanıcı ölçeği (10 mu 5 mi) ve yorumlara hızlı geçişi bilemiyor.

**Önerilen aksiyon:** '8,9/10 · Çok iyi' biçiminde görünür/aria metni verin ve tüm bloğu #reviews-title'a bağlantı yapın.

## F1133 — Erişilebilirlik 'Kanıt fotoğrafı' bağlantıları aynı adlı ve uyarısız yeni sekmede; 'Doğrulanmış' açıklaması yalnız title ipucunda

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Low                                                   |
| Durum               | Gözlemlendi                                           |
| Konum               | `src/components/property/AccessibilitySection.tsx:51` |
| Kullanıcılar        | misafir                                               |
| Prensip             | accessibility · Predictability (Dix)                  |
| Sezgisel madde      | H14 — Erişilebilirlik                                 |
| WCAG                | 2.4.4 Link Purpose (In Context)                       |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | runtime:pdp                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                          |

**Kanıt:** RUNTIME p4-reviews-a11y.mjs (Grand Deluxe): 4 bağlantı da metni 'Kanıt fotoğrafı', target=_blank, aria-label yok; rozet açıklaması yalnız title='Platform ekibi bu özelliği … doğruladı.' (klavye/dokunmatikle erişilemez).

**Etki:** Bağlantı listesinde hangi kanıtın hangi özelliğe ait olduğu anlaşılmıyor; beklenmedik sekme açılması.

**Önerilen aksiyon:** aria-label='Basamaksız giriş için kanıt fotoğrafı (yeni sekmede açılır)' verin; görsel 'yeni sekme' simgesi ekleyin; 'Doğrulanmış' açıklamasını bölüm girişine görünür metin olarak yazın.

## F1134 — Takvim hücrelerinde 10–11px metin; mobilde '★ En ucuz' iki satıra kırılıyor

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Low                                                 |
| Durum               | Gözlemlendi                                         |
| Konum               | `src/components/property/PriceCalendar.tsx:302`     |
| Kullanıcılar        | misafir                                             |
| Prensip             | accessibility · Okunabilirlik (Dix — Observability) |
| Sezgisel madde      | H14 — Erişilebilirlik                               |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | runtime:pdp                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** RUNTIME tarama tinyText (006/007): 11px '₺1.907' ×14+, 10px '★ En ucuz'; p3-layout mobil hücre 44,6x56 içinde spans 12px/11px/10px. Ekran crops/property/007-1.png.

**Etki:** Düşük görüşlü/yaşlı misafir fiyatı okumakta zorlanıyor.

**Önerilen aksiyon:** Fiyatı en az 12–13px yapın, 'En ucuz' metnini mobilde yalnız ★ simgesine indirip açıklamayı aria-label/lejantta bırakın; hücre yüksekliğini esnek tutun.

## F1163 — Alıntıya atlama azaltılmış hareket tercihini yok sayıyor; geri dönüş yolu yok

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Low                                               |
| Durum               | Aday (2 kaynak birleşti)                          |
| Konum               | `src/components/property/ReviewHighlights.tsx:65` |
| Diğer konumlar      | `src/components/search/ResultsMap.tsx:136`        |
| Kullanıcılar        | misafir                                           |
| Prensip             | robustness · recoverability                       |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                 |
| WCAG                | 2.3.3                                             |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:pdp, lens:a11y                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** ReviewHighlights.tsx:65 `el.scrollIntoView({ behavior: "smooth", block: "center" })` — açık `smooth` değeri globals.css:6-13 `scroll-behavior: auto !important` azaltılmış hareket kuralını geçersiz kılar; atlamadan sonra öne çıkanlara dönüş bağlantısı yok.

**Etki:** Hareket hassasiyeti olan kullanıcı animasyonlu uzun kaydırmaya maruz kalıyor; misafir alıntıyı okuduktan sonra temalara dönmek için geri kaydırıyor.

**Önerilen aksiyon:** `behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"`; vurgulanan yorumun içine 'Öne çıkan temalara dön' bağlantısı (tetikleyici düğmeye odak döndürür).

## F1326 — Özel not-found / error sayfaları yok; 404 ve çalışma hataları İngilizce varsayılan sayfaya düşüyor

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Low                                  |
| Durum               | Aday                                 |
| Konum               | `src/app/property/[id]/page.tsx:121` |
| Kullanıcılar        | tümü                                 |
| Prensip             | robustness · recoverability          |
| Sezgisel madde      | H9 — Hata mesajları                  |
| WCAG                | 3.1.2                                |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | lens:a11y                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**         |

**Kanıt:** property/[id]/page.tsx:120-122 `if (!property) { notFound(); }`; src/app altında not-found.tsx, error.tsx, global-error.tsx yok — Next varsayılan İngilizce 404/hata ekranı (lang="tr" kök içinde), Header ve geri dönüş yolu olmadan gösteriliyor.

**Etki:** Yayından kalkmış ilana e-postadan gelen misafir İngilizce, gezinmesiz bir sayfada kalıyor; ekran okuyucu metni Türkçe kurallarla okuyor.

**Önerilen aksiyon:** Yerelleştirilmiş `app/not-found.tsx` ve `app/error.tsx` (PageShell, h1, arama/ana sayfa bağlantısı, 'Tekrar dene') ekleyin.

## F1327 — Puan ondalık ayırıcısı dile göre biçimlenmiyor

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Low                                  |
| Durum               | Aday                                 |
| Konum               | `src/app/property/[id]/page.tsx:145` |
| Kullanıcılar        | misafir                              |
| Prensip             | learnability · consistency           |
| Sezgisel madde      | H4 — Tutarlılık/standartlar          |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | area:pdp                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**         |

**Kanıt:** page.tsx:145 `{property.ratingAvg.toFixed(1)}` → TR arayüzde '8.8' (docs/img/property.png); Türkçe yazımda '8,8'. Diğer sayılar Intl ile biçimleniyor (src/lib/i18n/format.ts `number`).

**Etki:** TR misafir için tutarsız sayı yazımı; '8.8' bin ayırıcısıyla karışabilir.

**Önerilen aksiyon:** Sunucu biçimlendiricisiyle (src/i18n/server-format.ts) `number(ratingAvg, { minimumFractionDigits: 1, maximumFractionDigits: 1 })` kullanın.

## F1328 — Uzun sayfada bölüm içi gezinme ve puan → yorumlar bağlantısı yok

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Low                                  |
| Durum               | Aday                                 |
| Konum               | `src/app/property/[id]/page.tsx:147` |
| Kullanıcılar        | misafir                              |
| Prensip             | flexibility · substitutivity         |
| Sezgisel madde      | H7 — Esneklik/verim                  |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | area:pdp                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**         |

**Kanıt:** page.tsx:147-149 `<span className="text-sm text-gray-600">{t("ratingCount", …)}</span>` düz metin; Açıklama/Olanaklar/Fiyat takvimi/Yorumlar için sayfa içi gezinme yok (ReviewsSection `id="reviews-title"` hedefi mevcut).

**Etki:** Misafir yorumlara veya fiyat takvimine atlamak için kaydırıyor; mobilde uzun sayfada yönelim kaybı.

**Önerilen aksiyon:** '260 değerlendirme'yi `<a href="#reviews-title">` yapın; h1 altına `<nav aria-label="Sayfa bölümleri">` içinde yatay kaydırılabilir çapa bağlantıları (Fotoğraflar, Olanaklar, Fiyatlar, Yorumlar, Rezervasyon).

## F1329 — Kayıt numarası etiketinde açıklamasız kanun numarası; TR ve EN tutarsız

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Low                                  |
| Durum               | Aday                                 |
| Konum               | `src/app/property/[id]/page.tsx:153` |
| Diğer konumlar      | `messages/tr/property.json:7`        |
| Kullanıcılar        | misafir                              |
| Prensip             | learnability · familiarity           |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi          |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | area:pdp                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**         |

**Kanıt:** page.tsx:151-155 `{registrationLabel}: <span className="font-mono">{property.licenseNumber}</span>`; messages/tr/property.json:7 'Turizm tesisi izin belgesi no (7464)' — EN karşılığı '(Law 7464)'; TR'de 7464'ün kanun numarası olduğu belirtilmiyor.

**Etki:** Misafir '(7464)'ü belge numarasının parçası sanabiliyor.

**Önerilen aksiyon:** TR: 'Turizm tesisi belge no (7464 sayılı Kanun)' ya da etiket 'Turizm tesisi belge no' + küçük not '7464 sayılı Kanun kapsamında'.

## F1330 — Kanıt fotoğrafı bağlantısı uyarısız yeni sekmede açılıyor; bağlantı adı tekrarlı

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Low                                                   |
| Durum               | Aday                                                  |
| Konum               | `src/components/property/AccessibilitySection.tsx:52` |
| Kullanıcılar        | misafir                                               |
| Prensip             | learnability · predictability                         |
| Sezgisel madde      | H13 — Feedforward                                     |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | area:pdp                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                          |

**Kanıt:** AccessibilitySection.tsx:51-60 `<a href={feature.evidencePhotoUrl} target="_blank" rel="noopener" className="text-xs text-[#003580] underline">{t("evidence")}</a>` — her özellikte aynı 'Kanıt fotoğrafı' adı, yeni sekme bildirimi yok.

**Etki:** Ekran okuyucu kullanıcısı bağlantı listesinde ayırt edemiyor; beklenmedik sekme değişiminde bağlamı kaybediyor, mobilde geri dönmek zor.

**Önerilen aksiyon:** `aria-label={t("evidenceFor", { feature: t(`codes.${feature.code}`) })}` + görünür '(yeni sekmede)' ya da aria-hidden ikon + sr-only 'yeni sekmede açılır'; alternatif olarak fotoğrafı sayfa içi `<dialog>`da açın.

## F1331 — Fiyat takviminde seçim sonrası (mobilde) rezervasyon formuna geçiş yolu yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:162` |
| Diğer konumlar      | `src/app/property/[id]/page.tsx:203`            |
| Kullanıcılar        | misafir                                         |
| Prensip             | learnability · predictability                   |
| Sezgisel madde      | H13 — Feedforward                               |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | lens:status                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** PriceCalendar.tsx:156-165 `setStatus(t("selected", …))` → 'Seçildi: … Rezervasyon formu güncellendi.'; property/[id]/page.tsx:161-213 tek sütunlu mobil düzende BookingWidget yorumların altında kalıyor; bağlantı veya odak taşıma yok.

**Etki:** Mobil misafir formun nerede güncellendiğini bulmak için uzun sayfa boyunca kaydırıyor.

**Önerilen aksiyon:** Durum metnine 'Rezervasyon formuna git' bağlantısı (BookingWidget form'una id + tabIndex=-1) ve mobilde alt sabit 'Toplamı gör — Devam et' çubuğu.

## F1332 — İlk tıklamada kullanıcı seçmeden forma çıkış tarihi yazılıyor; seçimi temizleme yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:170` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · recoverability                     |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü               |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** PriceCalendar.tsx:170-174 `const out = addDaysIso(day.date, Math.max(1, day.minStay ?? 1)); … publishStaySelection({ checkIn: day.date, checkOut: out }); setStatus(t("selectCheckOut", …))` — durum 'Şimdi çıkış tarihini seçin' derken form zaten 1 gecelik konaklamaya güncellenmiş; 'Seçimi temizle' kontrolü yok.

**Etki:** Çıkışı seçmeden forma geçen misafir farkında olmadan 1 gecelik teklifle devam edebiliyor; yanlış seçimi geri almak için sayfayı yenilemesi gerekiyor.

**Önerilen aksiyon:** Metni 'Giriş: {date}. Formda geçici çıkış {out} olarak ayarlandı; farklı bir çıkış günü seçebilirsiniz.' yapın; durum satırı yanına `type="button"` 'Seçimi temizle' (checkIn/checkOut → null, durum duyurusu).

## F1333 — İleri ay gezintisi sınırsız; ufuk ötesinde 'müsait gece yok' yanıltıcı

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:214` |
| Kullanıcılar        | misafir                                         |
| Prensip             | learnability · predictability                   |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** PriceCalendar.tsx:214-221 'Sonraki' düğmesinde `disabled` koşulu yok; price-calendar.ts `horizonEnd = addDays(today, PRICE_CALENDAR_HORIZON_DAYS - 1)` (365 gün) sonrası tüm günler müsait değil ve 330-332 'Bu ayda müsait gece yok.' gösteriliyor. Belirli aya atlama yok (10 ay için 10 tıklama + 10 istek).

**Etki:** Misafir 13. ayda tesisin dolu olduğunu sanıyor; uzak tarih arayan çok sayıda tıklama yapıyor.

**Önerilen aksiyon:** API yanıtına `horizonEnd` ekleyin; ufuk ayında 'Sonraki'yi `disabled` yapıp 'Fiyatlar en fazla 12 ay ileri için gösterilir' notu; ay başlığını `<select aria-label="Ay seç">` ile değiştirilebilir yapın.

## F1334 — Geçmiş ve dolu günler aynı (üstü çizili) görünüyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/property/PriceCalendar.tsx:264` |
| Kullanıcılar        | misafir                                         |
| Prensip             | learnability · familiarity                      |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                     |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** PriceCalendar.tsx:255-271 geçmiş ve müsait olmayan gelecek günler aynı sınıfı alıyor: 264 `border-dashed border-gray-300 bg-gray-50 text-gray-500` + 266 `line-through` + '—'; yalnız aria-label (261) farklı. docs/img/v4-price-calendar.png'de 2–31 Ekim gelecek günleri geçmiş gibi üstü çizili.

**Etki:** Misafir dolu günleri geçmiş tarih sanıp takvimin bozuk olduğunu düşünebiliyor.

**Önerilen aksiyon:** Geçmiş günlerde kenarlık ve '—' olmadan yalnız soluk gün numarası; dolu gelecek günlerde üstü çizmeyi kaldırıp görünür 'Dolu' metni; lejandı güncelleyin.

## F1335 — 10–11px metinler ve sabit yükseklikli takvim hücreleri

| Alan                | Değer                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                              |
| Durum               | Aday                                                                                                             |
| Konum               | `src/components/property/PriceCalendar.tsx:295`                                                                  |
| Diğer konumlar      | `src/components/property/PriceCalendar.tsx:302`, `src/components/pwa/TripsView.tsx:170`, `src/app/layout.tsx:59` |
| Kullanıcılar        | misafir                                                                                                          |
| Prensip             | accessibility · okunabilirlik (legibility)                                                                       |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                            |
| Renk/tema           | Hayır                                                                                                            |
| Efor                | S                                                                                                                |
| Kaynak denetçiler   | lens:mobile                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                     |

**Kanıt:** PriceCalendar.tsx:295'teki hücre `flex h-14 w-full flex-col` (sabit 56px) içinde gün (text-xs), :302'de fiyat `text-[11px]`, :307'de '★ En ucuz' ve :315'te 'min N gece' `text-[10px]`. 360px'te 7 sütun ≈42px genişlikte kalıyor; '★ En ucuz' iki satıra kırılıyor ve 4 satır 56px'e sığmıyor. TripsView.tsx:170'te rezervasyon kodu `text-[11px]`, layout.tsx:59'da DEMO etiketi `text-[10px]`.

**Etki:** Mobil fiyat takviminde fiyat ve 'en ucuz' etiketi zor okunuyor, taşan metin bir sonraki satırla çakışıyor. Resepsiyonda okunacak rezervasyon kodu çok küçük.

**Önerilen aksiyon:** Hücrede sabit `h-14` yerine `min-h-14` kullan. 640px altında yalnız gün ve kısaltılmış fiyat göster ('2,1B'); 'En ucuz'u hücre köşesinde ★ simgesi ve lejantla belirt. En küçük punto 12px olsun. Rezervasyon kodunu `text-sm font-mono tracking-wide` yap.

## F1336 — Galeri mobilde kaydırma, sayaç ve tam ekran desteklemiyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/property/PropertyGallery.tsx:40` |
| Diğer konumlar      | `src/components/property/PropertyGallery.tsx:28` |
| Kullanıcılar        | misafir                                          |
| Prensip             | learnability · familiarity                       |
| Sezgisel madde      | H11 — Affordance                                 |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | lens:mobile                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** PropertyGallery.tsx:28-37 tek bir ana görsel, :40-60 `grid grid-cols-4 gap-2 p-2` küçük resim düğmeleri. Parmakla kaydırma, '1/8' sayacı ya da tam ekran/yakınlaştırma yok. Küçük resimlerde seçili durum yalnız `ring-2` ve opaklıkla belirtiliyor; `aria-current` ya da `aria-pressed` yok (:45-48).

**Etki:** Mobil misafir fotoğraflar arasında kaydırarak gezemiyor ve ayrıntı için yakınlaştıramıyor. Seçili küçük resim ekran okuyucuya bildirilmiyor.

**Önerilen aksiyon:** lg altında `flex snap-x snap-mandatory overflow-x-auto` kaydırmalı bir şerit ve 'n/N' sayacı kullan. Ana görsele dokununca tam ekran `dialog` açılsın (pinch-zoom serbest). Küçük resimlere `aria-current={index===activeIndex}` ekle.

## F1337 — Şikâyet nedeni varsayılan olarak 'Saldırgan / uygunsuz' seçili

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/property/ReviewsSection.tsx:31` |
| Kullanıcılar        | misafir, admin                                  |
| Prensip             | robustness · task conformance (hata önleme)     |
| Sezgisel madde      | H5 — Hata önleme                                |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** ReviewsSection.tsx:31 `useState<string>("OFFENSIVE")`; form açılır açılmaz 'Gönder' (73-79) bu nedenle gönderiyor.

**Etki:** Aceleci misafir yanlış nedenle şikâyet gönderiyor; yönetici kuyruğu yanlış sınıflanıyor.

**Önerilen aksiyon:** Başlangıcı `""` yapın, ilk seçenek `<option value="" disabled>Neden seçin</option>`; neden seçilene dek 'Gönder' `disabled`.

## F1338 — 'Diğer' nedeni için açıklama alanı yok (API destekliyor)

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/property/ReviewsSection.tsx:39` |
| Kullanıcılar        | misafir, admin                                  |
| Prensip             | robustness · task conformance                   |
| Sezgisel madde      | H7 — Esneklik/verim                             |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** ReviewsSection.tsx:37-40 gövde yalnız `JSON.stringify({ reason })`; src/app/api/reviews/[id]/report/route.ts:9-10 `note: z.string().trim().max(500).optional()` kabul ediyor.

**Etki:** Misafir 'Diğer' seçince sorunu açıklayamıyor; yönetici bağlamsız şikâyeti değerlendiremiyor.

**Önerilen aksiyon:** Neden altında etiketli `<textarea maxLength={500}>` ('Açıklama (isteğe bağlı)') + karakter sayacı; OTHER seçiliyse zorunlu; gövdeye `note` ekleyin.

## F1339 — Her yorumda bağlamsız, özdeş 'Şikâyet et' ve 'Gönder' düğme adları

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/property/ReviewsSection.tsx:89` |
| Kullanıcılar        | misafir                                         |
| Prensip             | accessibility · Headings and Labels             |
| Sezgisel madde      | H14 — Erişilebilirlik                           |
| WCAG                | 2.4.6                                           |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:pdp                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** ReviewsSection.tsx:89-95 `{t("report.open")}` ('Şikâyet et') 50 yorumda aynı; 78 `{t("report.submit")}` = 'Gönder'.

**Etki:** Ekran okuyucu düğme listesinde 50 adet 'Şikâyet et' görüyor; hangi yoruma ait olduğunu bilmiyor.

**Önerilen aksiyon:** Yazar span'ine `id={`review-author-${r.id}`}` verip tetikleyiciye `aria-describedby` bağlayın veya `aria-label={t("report.openFor", { author })}`; gönder metnini 'Şikâyeti gönder' yapın.

## F1340 — Yorum şikâyeti ve fiyat alarmında hata/başarı aynı görünümde; 'giriş gerekli' mesajları bağlantısız

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/property/ReviewsSection.tsx:97` |
| Diğer konumlar      | `src/components/booking/PriceInsight.tsx:77`    |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · recoverability                     |
| Sezgisel madde      | H9 — Hata mesajları                             |
| WCAG                | 3.3.1                                           |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | lens:status                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** ReviewsSection.tsx:97-101 `<p role="status" className="mt-1 text-gray-700">{status}</p>` hem 'Şikâyetiniz alındı' hem hata için; 44-50 401'de 'report.loginRequired' metni bağlantısız; 73-79 gönder butonunda busy yok. PriceInsight.tsx:77-78 'alertLoginRequired' da bağlantısız.

**Etki:** Misafir şikâyetin iletilip iletilmediğini ayırt edemiyor; giriş gerektiğini öğrenince sayfadaki yerini kaybederek girişe gitmek zorunda.

**Önerilen aksiyon:** Durumda kind ayrımı (hata: role=alert + '⚠ Hata:' öneki), 401 için loginHref() bağlantısı, gönderimde busy/disabled.

## F1341 — Yorum doğrulama açıklaması uzun, 12 px ve her zaman açık

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/property/ReviewsSection.tsx:203` |
| Kullanıcılar        | misafir                                          |
| Prensip             | learnability · synthesizability (bilgi önceliği) |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                     |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** ReviewsSection.tsx:203-205 `<p className="mt-1 text-xs text-gray-700">{t("verification")}</p>` — reviews.json:3 ≈360 karakterlik, soruyla başlayan ('Yorumlar nasıl doğrulanır?') paragraf başlığın hemen altında sürekli açık.

**Etki:** Yorumlara ulaşmadan önce küçük puntolu yoğun metin; mobilde ekranın büyük kısmını kaplıyor, çoğu misafir okumadan geçiyor.

**Önerilen aksiyon:** `<details><summary className="text-sm">Yorumlar nasıl doğrulanır?</summary><p className="text-sm">…</p></details>`; çeviride soru ile gövdeyi ayrı anahtarlara bölün.

## F1342 — Uzun açıklayıcı/yasal metin blokları varsayılan açık (ilerici açıklama yok)

| Alan                | Değer                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                          |
| Durum               | Aday                                                                                                                         |
| Konum               | `src/components/property/ReviewsSection.tsx:204`                                                                             |
| Diğer konumlar      | `messages/tr/reviews.json:3`, `messages/tr/resolution.json:65`, `src/components/resolution/BookingResolutionPanel.tsx:78-88` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                           |
| Prensip             | learnability · Bilişsel yük / ilerici açıklama                                                                               |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                                                                                 |
| Renk/tema           | Hayır                                                                                                                        |
| Efor                | S                                                                                                                            |
| Kaynak denetçiler   | lens:copy                                                                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                 |

**Kanıt:** ReviewsSection.tsx:203-205 reviews.json:3 (~60 kelime) 'Yorumlar nasıl doğrulanır? …' her ilanın yorumlarının üstünde; resolution.json:65 depozito notu (3 cümle); payouts.json:43 politika; host.json promotions.intro; RnplOption zaman çizelgesi 4 madde; BookingResolutionPanel.tsx:78-88 iade talep formu her onaylı rezervasyonda açık.

**Etki:** Mobil ekranda asıl içerik (yorumlar, eylem) aşağı itilir; okuma yükü artar.

**Önerilen aksiyon:** Bu metinleri <details><summary>Yorumlar nasıl doğrulanır?</summary>…</details> içine alın; iade talep formunu 'Sorun mu yaşadınız? İade talep et' düğmesiyle açılır yapın.

## F1343 — Atıf numaraları: yorum kartında açıklamasız '[n]', çok küçük dokunma hedefleri

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/property/ReviewsSection.tsx:286` |
| Kullanıcılar        | misafir                                          |
| Prensip             | learnability · predictability                    |
| Sezgisel madde      | H11 — Affordance                                 |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** ReviewsSection.tsx:286-288 `<span className="text-xs text-gray-700">[{citationOrder.get(r.id)}]</span>` ne olduğu yazmıyor; 132-139 atıf bağlantıları `align-super text-xs` (~12 px); 243-250 'Kaynaklar' satırında yalnız ', ' ile ayrılmış (satır içi istisnası nedeniyle 2.5.8 ihlali değil, ama mobilde isabet zor).

**Etki:** Misafir kartındaki '[2]'nin özetteki kaynağa karşılık geldiğini anlamıyor; mobilde komşu atıfa yanlış dokunuyor.

**Önerilen aksiyon:** Kart etiketini 'Özette kaynak [2]' yapın; atıf bağlantılarına `inline-block min-h-6 min-w-6 px-1 text-center`, Kaynaklar listesine `gap-2` verin.

## F1344 — Yorum tarihleri kısa sayısal biçimde; EN'de ay/gün karışıklığı

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/property/ReviewsSection.tsx:289` |
| Kullanıcılar        | misafir                                          |
| Prensip             | learnability · familiarity                       |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                      |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:pdp                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** ReviewsSection.tsx:289 `f.date(r.createdAt)` varsayılan 'short' → src/lib/i18n/format.ts DATE_OPTIONS.short `{ day: "2-digit", month: "2-digit", year: "numeric" }`; EN için `en-US` → '10/09/2026' (9 Ekim mi 10 Eylül mü belirsiz).

**Etki:** ABD dışından EN kullanan misafir yorumun güncelliğini yanlış okuyor.

**Önerilen aksiyon:** `f.date(r.createdAt, "medium")` → '9 Eki 2026' / 'Oct 9, 2026'; ev sahibi yanıtı için `hostRepliedAt` tarihini de gösterin.
