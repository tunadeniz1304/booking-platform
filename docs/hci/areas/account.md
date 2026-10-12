# Hesap, gizlilik, cüzdan — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 117 bulgu · Severity: Critical 8, High 25, Medium 48, Low 36

## F3 — "Rezervasyonu İptal Et" tek dokunuşta, onay ve iade önizlemesi olmadan geri dönüşsüz iptal isteği gönderiyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Critical                                                                      |
| Durum               | Gözlemlendi                                                                   |
| Konum               | `src/app/account/page.tsx:328`                                                |
| Diğer konumlar      | `messages/tr/account.json`                                                    |
| Kullanıcılar        | misafir, ev sahibi                                                            |
| Prensip             | robustness · Kurtarılabilirlik / hata önleme (Dix: recoverability, Nielsen 5) |
| Sezgisel madde      | H5 — Hata önleme                                                              |
| Renk/tema           | Hayır                                                                         |
| Efor                | M                                                                             |
| Kaynak denetçiler   | runtime:account                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountA)                                       |

**Kanıt:** Probe p6-cancel (guest, mobile 390x844, /account): ilk 'Rezervasyonu İptal Et' butonuna bir kez tıklandı. dialogs=[] (confirm/modal yok). Aynı anda 'DELETE /api/bookings/cmv2w67nj002kkd9ze3hbupk4' isteği çıktı (probe page.route ile 500'e çevrildi, sunucuya ulaşmadı; p7-verify booking hâlâ CONFIRMED). Kartta yalnız tarih/misafir/toplam (₺4.276,36) var; iptal politikası, iade tutarı, ceza bilgisi yok. Kod: page.tsx:327-335 onClick={() => cancelBooking(booking.id)} → 139-154 doğrudan fetch DELETE. Ekran: probes/account/shots/p6-after-cancel-error-mobile.png

**Etki:** Mobilde kaydırma sırasında yanlış dokunuş bir rezervasyonu anında iptal eder; iade dışı tarifelerde para kaybı. Kullanıcı ne kadar iade alacağını iptalden önce göremez.

**Önerilen aksiyon:** Tıklamada erişilebilir bir onay modalı aç: ilan/tarih, iptal politikası, sunucudan alınan iade önizlemesi (iade edilecek tutar + ceza) ve 'Vazgeç' varsayılan odakla; asıl DELETE yalnız 'Evet, iptal et' ile. Alternatif: butonu /booking/[id] sayfasındaki ayrıntılı iptal akışına yönlendir. Başarıda 'Rezervasyon iptal edildi, ₺X iade edilecek' durum mesajı (role=status).

**Yapılan düzeltme:** page.tsx cancelBooking: before the DELETE, a danger-tone useConfirm dialog now opens. Focus starts on Vazgeç. It shows the listing, the dates, the total and a note on the refund policy that links to /booking/{id}. After a successful cancel, the card shows a status message with the refund amount and percentage taken from the DELETE response. Not done: a refund preview before cancelling, because there is no preview endpoint (needs backend/API change). — dosyalar: `src/app/account/page.tsx`

## F10 — Rezervasyon iptali tek tıkla, onay sorulmadan ve iade tutarı gösterilmeden yapılıyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                                                                                                                                                                  |
| Durum               | Aday (5 kaynak birleşti)                                                                                                                                                                                                                                                                                  |
| Konum               | `src/app/account/page.tsx:328`                                                                                                                                                                                                                                                                            |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:207-233`, `src/app/account/page.tsx:139`, `src/app/account/page.tsx:338`, `src/components/booking/BookingActions.tsx:208`, `src/components/booking/BookingActions.tsx:207-223`, `messages/tr/account.json:31`, `src/components/booking/BookingActions.tsx:207` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                   |
| Prensip             | robustness · recoverability (hata önleme)                                                                                                                                                                                                                                                                 |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                                                                                                                                          |
| WCAG                | 3.3.4                                                                                                                                                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                     |
| Efor                | M                                                                                                                                                                                                                                                                                                         |
| Kaynak denetçiler   | area:account, lens:forms, lens:mobile, lens:copy, lens:nav                                                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountA)                                                                                                                                                                                                                                                                   |

**Kanıt:** page.tsx:327-329 `onClick={() => cancelBooking(booking.id)}`, ardından 142-144 `fetch(`/api/bookings/${bookingId}`, { method: "DELETE" })` çağrılıyor. Sunucu tarafında bookings/[id]/route.ts:30-31 `cancelAndRefund` çalışıyor ('İade tutarı ... iptal politikasına göre hesaplanır'), işlem geri alınamaz. Aynı eylem BookingActions.tsx:208'de `if (!window.confirm(t("cancel.confirm"))) return;` ile korunuyor.

**Etki:** Mobildeki misafir yanlışlıkla dokunduğunda iadesiz ya da kısmi iadeli rezervasyon anında iptal oluyor. Bu para kaybı demek ve geri alma yolu yok. Rezervasyon ayrıntı sayfasıyla da tutarsız bir davranış.

**Önerilen aksiyon:** DELETE'ten önce role="alertdialog" bir onay penceresi gösterin. Pencerede ilan adı, giriş/çıkış tarihleri ve iptal politikasına göre beklenen iade tutarı (policySnapshot ya da bir önizleme ucu) yer alsın. Varsayılan odak 'Vazgeç' düğmesinde olsun, birincil düğme 'Rezervasyonu iptal et' olsun. En azından BookingActions'taki cancel.confirm metnini kullanın.

**Yapılan düzeltme:** Same fix as F3: accessible confirm dialog plus a refund message after cancelling. A refund preview before cancelling needs an API change. — dosyalar: `src/app/account/page.tsx`

## F11 — Hesabım sayfasında rezervasyon iptali onaysız ve iade bilgisi vermeden yapılıyor; rezervasyon detayındaki aynı eylemden farklı

| Alan                | Değer                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                                                                                                                                                                |
| Durum               | Aday (3 kaynak birleşti)                                                                                                                                                                                                                                                                                |
| Konum               | `src/app/account/page.tsx:139`                                                                                                                                                                                                                                                                          |
| Diğer konumlar      | `src/app/account/page.tsx:326-336`, `src/components/booking/BookingActions.tsx:207-233`, `messages/tr/account.json:34`, `messages/tr/payment.json:20-26`, `src/components/booking/BookingActions.tsx:208`, `src/components/booking/BookingActions.tsx:214`, `messages/tr/payment.json (cancel.confirm)` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                 |
| Prensip             | robustness · recoverability / consistency (aynı eylem iki ekranda farklı davranıyor)                                                                                                                                                                                                                    |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                                                                                                                                        |
| WCAG                | 3.3.4                                                                                                                                                                                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:consistency, lens:a11y, lens:status                                                                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountA)                                                                                                                                                                                                                                                                 |

**Kanıt:** src/app/account/page.tsx:139-147 `const cancelBooking = async (bookingId) => { setCancellingId(bookingId); try { const res = await fetch(`/api/bookings/${bookingId}`, { method: "DELETE" }); ... setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: "CANCELLED" } : b))`. Burada confirm yok. Düğme :327-335 `onClick={() => cancelBooking(booking.id)}`. Aynı DELETE uç noktası src/components/booking/BookingActions.tsx:208'de `if (!window.confirm(t("cancel.confirm"))) return;` ile korunuyor, :214-223'te de iade tutarını gösteriyor (`t("cancel.refunded", { amount, percent })` / `t("cancel.noRefund")`). Etiketler de farklı: messages/tr/account.json:34 "Rezervasyonu İptal Et", messages/tr/payment.json:25 "Rezervasyonu iptal et". Hesap sayfası iptali HELD durumunda göstermiyor (`PENDING || CONFIRMED`), detay sayfası gösteriyor (`HELD || CONFIRMED`).

**Etki:** Misafir 'Rezervasyonlarım' listesinde tek bir yanlış dokunuşla (mobilde kolayca) onaylı ve ödenmiş rezervasyonu geri alınamaz biçimde iptal eder. İade politikası gereği para kaybı olabilir ve hiç bildirilmez. Detay sayfasında onay isteyip burada istememek, kullanıcıya iptalin güvenli olduğu yanlış modelini öğretir.

**Önerilen aksiyon:** account/page.tsx içindeki cancelBooking'i kaldırın. Ya listede yalnızca rezervasyon detayına giden bir bağlantı kalsın, ya da iptal BookingActions'taki cancel() ile aynı ortak bir `useCancelBooking` kancasına taşınsın: önce iade politikası ve tutarını içeren onay diyaloğu (window.confirm yerine ortak Dialog), ardından `t("cancel.refunded", …)` mesajı `role="status"` ile gösterilsin. Etiket tek anahtarda toplansın (payment.cancel.button). Durum kümesi detaydakiyle aynı olsun (HELD/CONFIRMED).

**Yapılan düzeltme:** Moved to apiFetch, a ConfirmDialog step and a refund status message in the same style as BookingActions. Not done: a shared useCancelBooking hook, because BookingActions belongs to another owner. — dosyalar: `src/app/account/page.tsx`

## F12 — Hesabım ve Seyahatlerim listelerinden rezervasyon ayrıntısına bağlantı yok

| Alan                | Değer                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Critical                                                                                                                                                                       |
| Durum               | Aday (3 kaynak birleşti)                                                                                                                                                       |
| Konum               | `src/app/account/page.tsx:285`                                                                                                                                                 |
| Diğer konumlar      | `src/components/pwa/TripsView.tsx:137`, `src/app/account/page.tsx:372`, `src/app/account/page.tsx:160`, `src/components/pwa/TripsView.tsx:133`, `src/app/account/page.tsx:281` |
| Kullanıcılar        | misafir                                                                                                                                                                        |
| Prensip             | robustness · recoverability / task conformance                                                                                                                                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                          |
| Efor                | S                                                                                                                                                                              |
| Kaynak denetçiler   | lens:nav, lens:a11y, lens:mobile                                                                                                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountA)                                                                                                                                        |

**Kanıt:** account/page.tsx:285-287 `<h3 className="text-lg font-semibold text-gray-900">{booking.property.title}</h3>` düz metin; kartta yalnız iptal ve favori düğmeleri var (325-351). TripsView.tsx:137 `<h2 ...>{item.propertyTitle}</h2>` da bağlantısız. Kod tabanında /booking/[id]'ye giden yollar yalnızca checkout/page.tsx:141 (oluşturma sonrası router.push), checkout/cart/page.tsx:196, TripPlanner.tsx:104 ve ClaimForm.tsx:95. Ödeme (BookingActions, HELD), iadeli iptal, ev sahibiyle mesajlaşma (BookingMessages), talep açma (BookingResolutionPanel) ve RNPL planı yalnız booking/[id]/page.tsx:163-180'de render ediliyor. getStatusLabel (160-168) HELD ve EXPIRED durumlarını çevirmiyor, ham kod gösteriliyor.

**Etki:** Checkout sonrası sayfadan ayrılan misafir, HELD durumdaki rezervasyonun ödemesine tutma süresi dolmadan geri dönemiyor. Ev sahibine mesaj yazamıyor, talep açamıyor, onayı yazdıramıyor. Kurtarmanın tek yolu tarayıcı geçmişi; rezervasyon ve para kaybı riski var.

**Önerilen aksiyon:** account/page.tsx:285'te başlığı `<Link href={`/booking/${booking.id}`}>` ile sarın. Kart altına birincil eylem ekleyin: HELD için "Ödemeyi tamamla", diğer durumlarda "Ayrıntılar". TripsView.tsx:137'de aynı bağlantıyı item.id ile ekleyin. Favori başlıklarını (372-374) `/property/${favorite.propertyId}` bağlantısı yapın. getStatusLabel'a HELD ("Ödeme bekleniyor") ve EXPIRED ("Süresi doldu") etiketlerini ekleyin.

**Yapılan düzeltme:** Each booking title links to /booking/{id}. Each card has an 'Ayrıntılar ve mesajlar' link, and HELD cards also have an 'Ödemeyi tamamla' link. Favorite titles link to /property/{id}. Added HELD, EXPIRED and unknown status labels. The TripsView part belongs to another owner (crossOwner). — dosyalar: `src/app/account/page.tsx`

## F17 — Süresi dolan erişim token'ı Hesabım sayfasını çıkış yolu olmayan bir hata ekranında bırakıyor

| Alan                | Değer                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Critical                                                                                                                       |
| Durum               | Aday                                                                                                                           |
| Konum               | `src/app/account/page.tsx:83`                                                                                                  |
| Diğer konumlar      | `src/app/account/page.tsx:117`, `src/app/account/page.tsx:123`, `src/app/account/page.tsx:142`, `src/app/account/page.tsx:197` |
| Kullanıcılar        | tümü                                                                                                                           |
| Prensip             | robustness · recoverability                                                                                                    |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                            |
| Renk/tema           | Hayır                                                                                                                          |
| Efor                | M                                                                                                                              |
| Kaynak denetçiler   | area:account                                                                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA)                                                                                               |

**Kanıt:** page.tsx:82-89 ham fetch kullanılıyor: `fetch("/api/user/me"), fetch("/api/bookings")` ve `if (!userRes.ok || !bookingsRes.ok) throw new Error(t("errors.userLoad"))`. apiFetch'teki 401 sonrası `/api/auth/refresh` ile yeniden deneme (api-client.ts:66-68) devre dışı kalıyor. ACCESS_TOKEN_TTL_SECONDS = 5*60 (app-config.ts:356). Proxy, korumalı API'ye geçerli token olmadan gelen isteğe 401 dönüyor (proxy.ts:163). Yükleniyor ve hata durumlarında Header render edilmiyor (page.tsx:183-205), bu yüzden token'ı tazeleyecek olan Header'daki fetchCurrentUser (Header.tsx:52) hiç çalışmıyor. 'Tekrar Dene' düğmesi `window.location.reload()` (197) çağırıyor ve aynı 401'i tekrar alıyor. Mutasyonlar da ham fetch kullanıyor (117, 123, 142).

**Etki:** Son API etkinliğinden 5 dakikadan sonra /account'u doğrudan açan herkes (yer imi, PWA, yeni sekme, yenileme, ya da 5 dakikadan uzun bekledikten sonra istemci tarafı gezinme) 'Kullanıcı bilgileri yüklenemedi' mesajını ve bitmeyen bir tekrar deneme döngüsünü görüyor. Giriş bağlantısı yok. Misafir rezervasyonunu iptal edemiyor, çıkış yapamıyor, oturum ve passkey yönetimine ulaşamıyor. Sayfada 5 dakikadan uzun kalan kullanıcının iptal ya da favori işlemi 401 alıyor ve tüm sayfa hata ekranına dönüyor. Oturumu olmayan ziyaretçi de giriş yönlendirmesi yerine yanıltıcı bir hata görüyor.

**Önerilen aksiyon:** Tüm fetch çağrılarını apiFetch'e geçirin (yenileme ve yeniden deneme hazır). Yenilemeden sonra yine 401 gelirse `router.replace('/login?redirect=/account')` yapın ya da içeriği RoleGate ile sarın. Header'ı her durumda render edin. Hata metni oturum süresinin dolduğunu ayırt etsin ve 'Giriş yap' bağlantısı versin.

**Yapılan düzeltme:** All loads now go through apiFetch, which refreshes the session on a 401 and retries. If the 401 persists, a login-required message with loginHref('/account') shows inside PageShell (Header/main/h1). Retry re-runs the load without reloading the page. — dosyalar: `src/app/account/page.tsx`

## F18 — Rezervasyon detayına (mesajlar, ödeme planı, çözüm merkezi) kalıcı bir giriş yolu yok

| Alan                | Değer                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                              |
| Durum               | Aday                                                                                                                  |
| Konum               | `src/app/account/page.tsx:281`                                                                                        |
| Diğer konumlar      | `src/components/pwa/TripsView.tsx:131`, `src/app/booking/[id]/page.tsx:190`, `src/lib/notifications/templates.ts:181` |
| Kullanıcılar        | misafir                                                                                                               |
| Prensip             | robustness · task conformance (görev uygunluğu): navigasyon çıkmazı                                                   |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                     |
| Renk/tema           | Hayır                                                                                                                 |
| Efor                | M                                                                                                                     |
| Kaynak denetçiler   | area:trips                                                                                                            |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountA)                                                                               |

**Kanıt:** account/page.tsx:281-353 `bookings.map((booking) => ( <div key={booking.id} className='rounded-2xl bg-white p-6 shadow-sm'>` kartında `/booking/${booking.id}` bağlantısı yok; kartta yalnız iptal ve favori düğmeleri var. TripsView.tsx:131-175 seyahat kartında hiç `Link` yok. booking/[id]/page.tsx:189-194 'Rezervasyonlarım' `href='/account'` ile yine bu bağlantısız kartlara gidiyor. Onay e-postası (notifications/templates.ts:167-185) yalnızca `c.bookingNo(b.bookingId)` metnini içeriyor, bağlantı yok. Projede `/booking/` bağlantısı veren yerler: checkout/page.tsx:141 (ödeme sonrası tek seferlik `router.push`), checkout/cart/page.tsx:196, TripPlanner.tsx:104, transfers/ClaimForm.tsx:95. Yani misafir hesabından veya Seyahatlerim'den rezervasyon detayına ulaşamıyor.

**Etki:** Misafir onay sayfasını kapattıktan sonra ev sahibine mesaj yazamaz (BookingMessages misafir için yalnızca bu sayfada açılıyor), ödeme planını, depozito ve çözüm panelini göremez, yazdıramaz. URL'yi hatırlamak zorunda kalır. 'Seyahati yönet' birincil görevinin mesajlaşma adımı tamamlanamıyor.

**Önerilen aksiyon:** account/page.tsx:285'teki `<h3>` başlığını `<Link href={`/booking/${booking.id}`}>` ile sar veya karta 'Ayrıntılar ve mesajlar' bağlantısı ekle. TripsView kartına (h2'nin altına) `<Link href={`/booking/${item.id}`}>` ekle (ör. 'Rezervasyon ayrıntıları ve mesajlar'). Onay, iptal ve süre dolumu e-postalarına `${APP_URL}/booking/${bookingId}` bağlantısı ekle. page.tsx:190'daki 'Rezervasyonlarım' hedefini `/account#bookings` yap ve account sayfasındaki rezervasyon `<section>` öğesine `id='bookings'` ver.

**Yapılan düzeltme:** Booking cards on the account page now have a link to the details page. The TripsView link and the email links belong to another owner or the backend. — dosyalar: `src/app/account/page.tsx`

## F19 — Rezervasyon ayrıntı sayfasına kalıcı bir yol yok: HELD rezervasyon ödenemiyor, ev sahibine mesaj ve talep açma erişilemez

| Alan                | Değer                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                    |
| Durum               | Aday                                                                                                        |
| Konum               | `src/app/account/page.tsx:282`                                                                              |
| Diğer konumlar      | `src/components/pwa/TripsView.tsx:130`, `src/app/account/page.tsx:160`, `src/app/booking/[id]/page.tsx:174` |
| Kullanıcılar        | misafir                                                                                                     |
| Prensip             | robustness · recoverability                                                                                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                           |
| Renk/tema           | Hayır                                                                                                       |
| Efor                | S                                                                                                           |
| Kaynak denetçiler   | lens:status                                                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA)                                                                            |

**Kanıt:** account/page.tsx:282-353 rezervasyon kartlarında `/booking/[id]` bağlantısı yok. Tüm UI'da `/booking/` hedefi yalnızca checkout/page.tsx:141 (router.push), checkout/cart/page.tsx:196, transfers/ClaimForm.tsx:95, plan/TripPlanner.tsx:104'te. pwa/TripsView.tsx:130-176 seyahat kartları da bağlantısız. getStatusLabel (account/page.tsx:160-168) HELD/EXPIRED'i çevirmiyor → ham 'HELD' sarı rozet; iptal butonu (326) HELD için hiç yok. BookingMessages ve BookingResolutionPanel yalnız booking/[id]/page.tsx:174-180'de.

**Etki:** Misafir ödeme sayfasından ayrılırsa (sekme kapandı, telefon kilitlendi) 15 dk'lık tutmayı ödemeye geri dönemiyor → EXPIRED. Onaylı rezervasyonda ev sahibine mesaj, hasar/iade talebi, RNPL planı yalnızca ilk yönlendirmede görülebiliyor: 'öde' ve 'seyahati yönet' adımları bloke.

**Önerilen aksiyon:** Hesabım kart başlığını `<Link href={`/booking/${booking.id}`}>` yap; HELD için birincil 'Ödemeyi tamamla (14:32'ye kadar)' butonu, CONFIRMED/COMPLETED için 'Ayrıntılar ve mesajlar' bağlantısı; durum eşlemesine HELD='Ödeme bekleniyor', EXPIRED='Süresi doldu' ekle; TripsView kartına item.id ile aynı bağlantı.

**Yapılan düzeltme:** Added a link to booking details, an 'Ödemeyi tamamla' link for HELD, and HELD/EXPIRED labels. The hold expiry time is not in the list data, so it is not shown. TripsView is in crossOwner. — dosyalar: `src/app/account/page.tsx`

## F20 — Hesap silme, yaklaşan rezervasyonların politikaya göre iptalini, cüzdan kredisinin kaybını ve ilanların yayından kalkmasını önceden söylemiyor

| Alan                | Değer                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Severity            | Critical                                                                                               |
| Durum               | Aday                                                                                                   |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:65`                                                          |
| Diğer konumlar      | `messages/tr/privacy.json:53`, `messages/en/privacy.json:53`, `src/lib/privacy/privacy-service.ts:409` |
| Kullanıcılar        | misafir, ev sahibi                                                                                     |
| Prensip             | robustness · task conformance / feedforward (predictability)                                           |
| Sezgisel madde      | H13 — Feedforward                                                                                      |
| WCAG                | 3.3.4                                                                                                  |
| Renk/tema           | Hayır                                                                                                  |
| Efor                | M                                                                                                      |
| Kaynak denetçiler   | area:account2                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountB)                                                                |

**Kanıt:** PrivacyCenter.tsx:65 `<p ...>{t("deleteBody")}</p>` → messages/tr/privacy.json:53 "Kişisel alanlarınız silinir veya takma adla değiştirilir... Bu işlem geri alınamaz." Oysa sunucu src/lib/privacy/privacy-service.ts:409-421 gelecekteki HELD/CONFIRMED/PENDING rezervasyonları `cancelAndRefund(b.id, userId, now)` ile rezervasyon anındaki iptal politikasına göre (refund.ts `policySnapshot`) iptal ediyor, :472 `tx.property.updateMany({ where: { hostId: userId }, data: { isActive: false } })` ilanları pasife alıyor; cüzdan kredisi (walletCredit) anonim hesapta kalıyor ve parola hash'i kullanılamaz yapıldığı için (:452-461) kullanıcıya erişilemez oluyor. Metinde bunların hiçbiri yok.

**Etki:** İade edilmez/kısmi iadeli yaklaşan rezervasyonu olan misafir, onay kutusunu işaretleyip parolasını girdikten sonra rezervasyonunu ve ödediği parayı/kalan cüzdan kredisini kaybediyor; ev sahibi ilanlarının yayından kalktığını bilmiyor. Para toleransı çok düşük misafir için geri alınamaz para kaybı.

**Önerilen aksiyon:** Onay grubunu (PrivacyCenter.tsx:71) açarken bir önizleme uç noktası (ör. GET /api/account?preview=delete) çağırıp sonuçları onay kutusunun üstünde madde madde gösterin: "N yaklaşan rezervasyonunuz iptal politikası uyarınca iptal edilecek (tahmini iade: ₺X, iade edilmeyecek: ₺Y)", "Cüzdanınızdaki ₺Z kredi silinecek", "M ilanınız yayından kaldırılacak". deleteBody metnine statik olarak da bu üç sonucu ekleyin; onay kutusu metnini "Rezervasyonlarımın iptal edileceğini ve kredimin silineceğini anladım" olarak somutlaştırın.

**Yapılan düzeltme:** PrivacyCenter delete card: added a 'deleteEffects' list before confirmation (upcoming bookings cancelled under the cancellation terms, possibly no or partial refund; wallet credit deleted; transfer listings withdrawn; listings taken offline; existing host obligations must be resolved first). The acknowledge checkbox text now names these consequences concretely. Focus moves to the checkbox when the confirmation step opens. A per-user preview with counts and amounts (GET preview) needs a backend endpoint and was not done. — dosyalar: `src/components/privacy/PrivacyCenter.tsx`

## F71 — Erişim belirteci süresi dolunca /account kalıcı hata ekranında kalıyor; "Tekrar Dene" oturumu yenilemiyor

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | High                                                                                 |
| Durum               | Gözlemlendi                                                                          |
| Konum               | `src/app/account/page.tsx:83`                                                        |
| Diğer konumlar      | `src/lib/api-client.ts`                                                              |
| Kullanıcılar        | misafir, ev sahibi, admin                                                            |
| Prensip             | robustness · Kurtarılabilirlik / tutarlı davranış (Dix: recoverability, consistency) |
| Sezgisel madde      | H9 — Hata mesajları                                                                  |
| Renk/tema           | Hayır                                                                                |
| Efor                | S                                                                                    |
| Kaynak denetçiler   | runtime:account                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA)                                                     |

**Kanıt:** Probe p5-expiry (guest, desktop): access token süresi (~5 dk) dolmuş, refresh token geçerli oturumla /account açıldı → 'GET /api/user/me 401, GET /api/bookings 401', ekran 'Kullanıcı bilgileri yüklenemedi / Tekrar Dene'. 'Tekrar Dene' (window.location.reload) aynı 401'leri üretti. Ardından /account/sessions açılınca apiFetch 'POST /api/auth/refresh 200' yaptı ve geri dönülen /account normal yüklendi. Neden: page.tsx:74 ve 82-85 düz fetch kullanıyor; diğer bileşenler apiFetch (otomatik refresh) kullanıyor. Ekran: probes/account/shots/p5-account-expired-access.png

**Etki:** Birkaç dakika boşta kalan ya da e-posta/rezervasyon detayındaki 'Rezervasyonlarım' bağlantısıyla gelen giriş yapmış kullanıcı hesabına ulaşamaz; tek çıkış başka bir sayfaya gitmek. Birincil 'rezervasyonlarımı gör' görevi engellenir.

**Önerilen aksiyon:** page.tsx'teki /api/user/me, /api/bookings, /api/favorites çağrılarını apiFetch ile yap (401'de refresh + tekrar). Refresh de başarısızsa router.replace('/login?redirect=/account'). Hata ekranını PageShell içinde (Header + main + h1) göster.

**Yapılan düzeltme:** Same as F17: apiFetch refreshes the session, a persistent 401 shows a login link, and the error state renders inside PageShell. — dosyalar: `src/app/account/page.tsx`

## F72 — /account: anon kullanıcı veya erişim tokenı süresi dolmuş kullanıcı kabuksuz bir çıkmaza düşüyor; 'Tekrar Dene' sonsuz döngü, #main yok

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | High                                                                  |
| Durum               | Gözlemlendi                                                           |
| Konum               | `src/app/account/page.tsx:191`                                        |
| Diğer konumlar      | `src/app/account/page.tsx:83`, `src/components/layout/Header.tsx:104` |
| Kullanıcılar        | misafir, ev sahibi, admin                                             |
| Prensip             | robustness · Recoverability: hatadan ileri ya da geri bir yol olmalı  |
| Sezgisel madde      | H9 — Hata mesajları                                                   |
| WCAG                | 2.4.1 Bypass Blocks (skip-link hedefi yok), 1.3.1                     |
| Renk/tema           | Hayır                                                                 |
| Efor                | S                                                                     |
| Kaynak denetçiler   | runtime:shell                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA)                                      |

**Kanıt:** P12, anon /account, 390x844: header, footer, main ve h1 yok. Etkileşimli öğeler yalnız 'İçeriğe geç' (hedef #main yok; axe skip-link, landmark-one-main, page-has-heading-one, 046/047) ve 'Tekrar Dene' (window.location.reload, aynı hatayı veriyor). P16, guest: 'token' çerezi silindi, refresh_token geçerli. '/' sayfasında Header 401 → POST /api/auth/refresh 200 → /api/user/me 200 ile kurtarıyor. '/account' sayfasında ise 401 /api/user/me ve 401 /api/bookings dönüyor, refresh hiç denenmiyor ve 'Kullanıcı bilgileri yüklenemedi' görünüyor. Erişim tokenı ömrü yaklaşık 5 dk (iat→exp). Hata metni text-red-600/red-50 ayrıca axe color-contrast ihlali veriyor. Ekran görüntüsü: RT/probes/shell/p12-anon-account-mobile.png.

**Etki:** 5 dk boşta kaldıktan sonra başlıktaki 'Hesabım' avatarına dokunan her oturumlu kullanıcı çıkmaza düşüyor; anon kullanıcıya giriş yolu gösterilmiyor. Geri dönmek için tarayıcının geri tuşu dışında yol yok.

**Önerilen aksiyon:** page.tsx:82-85'teki ham fetch çağrılarını apiFetch ile değiştirin (401'de refresh yapıyor). Kalıcı 401 durumunda router.replace('/login?next=/account') ile yönlendirin. loading ve error dallarını PageShell içinde (Header + main#main + Footer) render edin. Hata kutusuna role='alert', 'Giriş yap' ve 'Ana sayfa' bağlantıları ekleyin; metin rengini text-red-700 yapın.

**Yapılan düzeltme:** The loading, error and session-expired states render inside PageShell (Header, main#main, h1, Footer). The error state has a Status role=alert, a Retry button that calls the reload function, and a link to the home page. — dosyalar: `src/app/account/page.tsx`

## F73 — Oturumsuz /account: başlık çubuğu, main, h1 ve giriş bağlantısı yok; tek eylem sonsuz "Tekrar Dene"

| Alan                | Değer                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Severity            | High                                                                                   |
| Durum               | Gözlemlendi                                                                            |
| Konum               | `src/app/account/page.tsx:191`                                                         |
| Diğer konumlar      | `src/components/ui/ui.tsx`                                                             |
| Kullanıcılar        | misafir, tümü                                                                          |
| Prensip             | accessibility · Gezinilebilirlik ve hata kurtarma (Dix: recoverability, observability) |
| Sezgisel madde      | H9 — Hata mesajları                                                                    |
| WCAG                | 1.3.1, 2.4.1, 4.1.3                                                                    |
| Renk/tema           | Hayır                                                                                  |
| Efor                | S                                                                                      |
| Kaynak denetçiler   | runtime:account                                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA)                                                       |

**Kanıt:** Tarama 046/047 (anon, /account, desktop+mobile): h1=[], landmarks header/nav/main/footer=0; axe: landmark-one-main, page-has-heading-one, region, skip-link (#main hedefi yok). Probe p1-layout: links yalnız 'İçeriğe geç->#main' ve çerez bandındaki '/privacy'; header=0; hata <p> role/aria-live yok. 'Tekrar Dene' sonrası aynı ekran. Tarama tabOrder: Tab yalnız 'İçeriğe geç' ↔ 'Tekrar Dene' arasında dönüyor. Karşılaştırma: /account/sessions ve /account/privacy RoleGate ile 'Bu sayfa için giriş yapın' + /login bağlantısı gösteriyor. Ekran: full/shots/046-anon-tr-desktop-_account.png

**Etki:** Oturumu olmayan (veya oturumu düşmüş) misafir 'Kullanıcı bilgileri yüklenemedi' gibi teknik bir hatayla karşılaşır, giriş yolunu ve site gezinmesini kaybeder; ekran okuyucu kullanıcısı sayfa yapısı bulamaz ve hata duyurulmaz.

**Önerilen aksiyon:** Hesap sayfasını PageShell + RoleGate ile sar (diğer hesap alt sayfalarıyla tutarlı) ya da 401'de /login?redirect=/account'a yönlendir. Hata durumunu Header'lı düzende, h1 ve role=alert ile göster; 'Tekrar Dene' yanında 'Giriş yap' bağlantısı ver.

**Yapılan düzeltme:** Same as F72. On 401 it shows 'yeniden giriş yapın' with a link to /login?redirect=/account. — dosyalar: `src/app/account/page.tsx`

## F74 — Hesap hata metni kırmızı-50 zemin üzerinde 4.41:1 kontrast (AA altı)

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | High                                                  |
| Durum               | Gözlemlendi                                           |
| Konum               | `src/app/account/page.tsx:195`                        |
| Kullanıcılar        | tümü                                                  |
| Prensip             | accessibility · Algılanabilirlik (Dix: observability) |
| Sezgisel madde      | H14 — Erişilebilirlik                                 |
| WCAG                | 1.4.3                                                 |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | runtime:account                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA)                      |

**Kanıt:** Tarama 046/047 axe color-contrast (serious): <p class="text-red-600">Kullanıcı bilgileri yüklenemedi</p>. Probe p1-layout: color rgb(220,38,38) on rgb(254,242,242), 16px normal → hesaplanan 4.41:1 (eşik 4.5:1). Aynı metin p6'da 'Rezervasyon iptal edilemedi' için de bu bileşende görünüyor.

**Etki:** Düşük görüşlü kullanıcılar ve güneş altında mobil kullananlar hata mesajını okumakta zorlanır.

**Önerilen aksiyon:** Renk dışı çözüm: mesajı büyük metin eşiğine taşı (text-xl/20px font-bold → 3:1 eşiği yeterli) ve role=alert + ikon ekle; ya da metni uygulamanın zaten kullandığı hata stilindeki gibi beyaz kart içinde göster (diğer bileşenler Status/role=alert ile text-red-700 kullanıyor, 5.91:1). Palete yeni renk eklemek gerekmez.

**Yapılan düzeltme:** The text-red-600 on red-50 box was removed. The error now uses the existing Status primitive (text-red-700, role=alert). No new color was added to the palette. — dosyalar: `src/app/account/page.tsx`

## F75 — Rezervasyon ve favori kartları tıklanamaz: rezervasyon detayına/belgeye ve ilana bağlantı yok

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | High                                                             |
| Durum               | Gözlemlendi                                                      |
| Konum               | `src/app/account/page.tsx:285`                                   |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx`                                  |
| Kullanıcılar        | misafir, ev sahibi                                               |
| Prensip             | learnability · Gezinme / tanıma (Dix: browsability, recognition) |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                          |
| Renk/tema           | Hayır                                                            |
| Efor                | S                                                                |
| Kaynak denetçiler   | runtime:account                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA)                                 |

**Kanıt:** Probe p6-cancel: 9 rezervasyon kartının hepsinde links=0. Probe p9-fav: 'Favorilerim' bölümünde 10 kart, 0 bağlantı, 0 görsel; main içindeki tüm bağlantılar yalnız ['/account/sessions','/trips','/resolution']. Kod: page.tsx:285 ve 372 başlıklar düz <h3>. Ters yönde src/app/booking/[id]/page.tsx:189-194 'Rezervasyonlarım' → /account bağlantısı var (tek yönlü gezinme). Ekran: crops/account/060-guest-tr-desktop-_account-1.png

**Etki:** Misafir rezervasyon onay belgesini, adresi, ev sahibiyle mesajlaşmayı veya yazdırmayı hesabından açamaz; favori ilanı tekrar bulmak için aramaya dönmek zorunda kalır. Sık görev (rezervasyonumu görüntüle) çıkmaza girer.

**Önerilen aksiyon:** Rezervasyon başlığını /booking/{id}'ye, favori başlığını (ve küçük görsel) /property/{propertyId}'ye bağla; kart içinde 'Ayrıntılar' ikincil butonu ekle. Bağlantı metni ilan adını içersin.

**Yapılan düzeltme:** Booking titles link to /booking/{id}, there is a 'Ayrıntılar ve mesajlar' secondary link, and favorite titles link to /property/{id}. Link text includes the listing name for screen readers (sr-only). — dosyalar: `src/app/account/page.tsx`

## F76 — Yeniden kimlik doğrulama diyaloğunda odak tuzağı yok; arka plan etkileşimli, kapanınca odak body'ye düşüyor

| Alan                | Değer                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                             |
| Durum               | Gözlemlendi                                                                                                                                                                      |
| Konum               | `src/components/account/ReauthDialog.tsx:68`                                                                                                                                     |
| Diğer konumlar      | `src/components/account/SessionManager.tsx`, `src/components/privacy/PrivacyCenter.tsx`, `src/components/account/AgentMandates.tsx`, `src/components/account/PasskeyManager.tsx` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                        |
| Prensip             | accessibility · Klavye erişimi ve odak yönetimi (Dix: observability, consistency)                                                                                                |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                            |
| WCAG                | 2.4.3, 2.4.11                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                            |
| Efor                | S                                                                                                                                                                                |
| Kaynak denetçiler   | runtime:account                                                                                                                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountB)                                                                                                                                                 |

**Kanıt:** Probe p2-sessions (guest, desktop, /account/sessions; DELETE 403 REAUTH_REQUIRED ile mock'landı): açılışta odak #reauth-password (iyi), aria-modal=true. Tab x6: 'Passkey ile doğrula' → 'Vazgeç' → 'Yardım Merkezi' → 'COVID-19…' → 'İade politikası' → 'Para iadesi' (overlay arkasındaki footer). Shift+Tab x3 parola alanından: 'Çıkış yap' (header) → 'Hesabım' → 'Dil'. Body çocuklarının hiçbiri inert/aria-hidden değil. Escape diyaloğu kapattı ama 'focus after Escape: body' (tetikleyici 'Oturumu kapat' butonuna dönmedi). Aynı davranış p4'te AgentMandates ve PasskeyManager tetiklemesinde de (focus body). Ekran: probes/account/shots/p2-reauth-dialog.png

**Etki:** Klavye/ekran okuyucu kullanıcısı güvenlik diyaloğundan çıkıp yarı saydam katman arkasındaki öğelere (ör. header 'Çıkış yap') ulaşır; kapatınca sayfadaki yerini kaybeder ve listenin başından başlamak zorunda kalır.

**Önerilen aksiyon:** Yerel <dialog> + showModal() kullan (otomatik odak tuzağı ve inert arka plan) ya da açıkken kardeş öğelere inert ver ve Tab/Shift+Tab'i ilk-son odaklanabilir öğe arasında döndür. useReauth içinde açılıştan önce document.activeElement'i sakla, onDone/onCancel'da ona focus() ver.

**Yapılan düzeltme:** ReauthDialog now uses a native <dialog> with showModal(). That gives a focus trap and an inert background (top layer, so no portal is needed). Escape is handled through onCancel+preventDefault. The opening element is saved on mount and gets focus back on close. While busy, buttons use aria-disabled instead of disabled so focus does not fall to body. Triggers in PasskeyManager, SessionManager, AgentMandates and PrivacyCenter got the same treatment (busy/aria-disabled), so focus stays on the trigger and returns to it. — dosyalar: `src/components/account/ReauthDialog.tsx`, `src/components/account/PasskeyManager.tsx`, `src/components/account/SessionManager.tsx`, `src/components/account/AgentMandates.tsx`, `src/components/privacy/PrivacyCenter.tsx`

## F77 — Hesap silme son onayı, gelecekteki rezervasyonların otomatik iptal edileceğini ve iadenin politikaya bağlı olduğunu söylemiyor

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | High                                                                                      |
| Durum               | Gözlemlendi                                                                               |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:76`                                             |
| Diğer konumlar      | `messages/tr/privacy.json`, `src/lib/privacy/privacy-service.ts`                          |
| Kullanıcılar        | misafir, ev sahibi                                                                        |
| Prensip             | learnability · Öngörülebilirlik / feedforward (Dix: predictability, operation visibility) |
| Sezgisel madde      | H13 — Feedforward                                                                         |
| Renk/tema           | Hayır                                                                                     |
| Efor                | M                                                                                         |
| Kaynak denetçiler   | runtime:account                                                                           |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountB)                                                   |

**Kanıt:** Probe p3-privacy (guest, desktop+mobile, /account/privacy): 'Hesabımı sil' → onay grubu metni yalnız 'Hesabınızı kalıcı olarak silmek istediğinize emin misiniz? / İşlemin geri alınamayacağını anladım. / Evet, hesabımı sil / Vazgeç'. Kart metni (privacy.json:53) yalnız anonimleştirmeden bahsediyor. Oysa aynı hesapta p7-verify ile 5 CONFIRMED + 2 HELD rezervasyon görüldü ve privacy-service.ts:409-430 silmede bunları cancelAndRefund ile 'rezervasyon anındaki iptal politikasına göre' iptal ediyor, açık devir ilanlarını geri çekiyor. Son butona TIKLANMADI.

**Etki:** Kullanıcı hesabını silerken yaklaşan tatillerinin iptal edileceğini ve iadenin kısmi/sıfır olabileceğini öğrenmeden onaylar; para kaybı ve geri dönüşsüz sonuç.

**Önerilen aksiyon:** Onay adımında GET ile aktif rezervasyon/devir ilanı/yükümlülük özetini çek ve listele (ilan, tarih, tahmini iade); ev sahibi yükümlülüğü varsa (ACCOUNT_HAS_OBLIGATIONS) butonu baştan devre dışı bırakıp nedenini göster. deleteBody metnine 'Gelecekteki rezervasyonlarınız iptal politikasına göre iptal edilir' cümlesini ekle; onay için e-posta yazdırma gibi ikinci bir sürtünme ekle.

**Yapılan düzeltme:** Same change as F20 (static consequence list plus concrete acknowledge text). Showing the summary of active bookings and obligations before confirming needs a preview endpoint (backend), so it was not done. The extra friction step (typing the email) is a product decision and was left out. — dosyalar: `src/components/privacy/PrivacyCenter.tsx`

## F158 — Yükleniyor ve hata durumlarında Header, <main> ve erişilebilir durum metni yok

| Alan                | Değer                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                                                                                                                                                                                               |
| Durum               | Aday (3 kaynak birleşti)                                                                                                                                                                                                                                                                                           |
| Konum               | `src/app/account/page.tsx:184`                                                                                                                                                                                                                                                                                     |
| Diğer konumlar      | `src/app/account/page.tsx:191`, `src/app/layout.tsx:46`, `src/app/account/page.tsx:191-205`, `src/app/search/page.tsx:619`, `src/components/pwa/PushToggle.tsx:111`, `src/app/cart/page.tsx:72-92`, `src/app/account/page.tsx:276-279`, `src/components/pwa/TripsView.tsx:124-127`, `src/app/account/page.tsx:160` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                               |
| Prensip             | accessibility · Status Messages / Bypass Blocks                                                                                                                                                                                                                                                                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                                                                                                                                                                     |
| WCAG                | 4.1.3                                                                                                                                                                                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                              |
| Efor                | S                                                                                                                                                                                                                                                                                                                  |
| Kaynak denetçiler   | area:account, lens:consistency, lens:a11y                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA)                                                                                                                                                                                                                                                                                   |

**Kanıt:** page.tsx:184-187 `<div className="flex min-h-screen items-center justify-center"><div className="h-12 w-12 animate-spin ..." /></div>`: metin, role="status" ya da aria-label yok. `<main id="main">` olmadığı için layout.tsx:46'daki `href="#main"` atlama bağlantısının hedefi yok. Hata görünümünde (191-205) de Header ve main yok, hata `<p>` öğesinde role="alert" yok.

**Etki:** Ekran okuyucu kullanıcısı yükleme süresince boş bir sayfa duyuyor. Üç isteğin bir kısmı sıralı yapıldığı için bu süre uzun olabiliyor. Klavye kullanıcısının 'İçeriğe geç' bağlantısı bir yere götürmüyor. Hata durumunda gezinme yok (WCAG 2.4.1 ve 4.1.3).

**Önerilen aksiyon:** Her durumda Header, Footer ve `<main id="main">` render edin (PageShell kullanılabilir). Yükleniyor durumu: `<p role="status">{t("loading")}</p>` ve spinner'a aria-hidden="true". Hata durumu: role="alert" ile birlikte ana sayfa ve giriş bağlantısı.

**Yapılan düzeltme:** Loading uses PageShell with role=status and the visible text common.loading; the spinner has aria-hidden. Error uses PageShell with role=alert, a Retry button and a home link. — dosyalar: `src/app/account/page.tsx`

## F161 — Hesabım: favori veya iptal hatası tüm sayfayı hata ekranıyla değiştiriyor

| Alan                | Değer                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                          |
| Durum               | Aday (2 kaynak birleşti)                                                                                                      |
| Konum               | `src/app/account/page.tsx:191`                                                                                                |
| Diğer konumlar      | `src/app/account/page.tsx:133`, `src/app/account/page.tsx:150`, `src/app/account/page.tsx:87`, `src/app/account/page.tsx:183` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                            |
| Prensip             | robustness · recoverability                                                                                                   |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                           |
| Renk/tema           | Hayır                                                                                                                         |
| Efor                | S                                                                                                                             |
| Kaynak denetçiler   | lens:forms, lens:status                                                                                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA)                                                                                              |

**Kanıt:** src/app/account/page.tsx:133 `setError(… t("errors.favoriteFailed"))` ve :150 `setError(… t("errors.cancelFailed"))` sayfa yükleme hatasıyla aynı `error` state'ini kullanıyor; :191-205 `if (error) return (<div …><p>{error}</p><button onClick={() => window.location.reload()}>…` — rezervasyon listesi, cüzdan, passkey vb. tümü kayboluyor.

**Etki:** Favori eklemedeki geçici bir ağ hatası misafirin rezervasyonlar ekranını siliyor; 'Tekrar Dene' tüm sayfayı yeniden yüklüyor, bağlam ve kaydırma konumu kaybolur.

**Önerilen aksiyon:** Eylem hataları için ayrı `actionError` state'i kullan ve ilgili kartın içinde role="alert" satır içi mesaj göster; tam sayfa hata yalnız ilk yükleme başarısızsa. 'Tekrar Dene' `loadData()`'yı çağırsın, `window.location.reload()` değil.

**Yapılan düzeltme:** Added a separate notice state ({key, kind, text}). Errors from cancel and favorite actions show inline in the affected card, inside a persistent aria-live region (errors use role=alert), so the page stays in place. Retry no longer uses window.location.reload. — dosyalar: `src/app/account/page.tsx`

## F162 — Yeniden doğrulama penceresi odağı içinde tutmuyor, arka planı etkisiz kılmıyor ve kapanınca odağı geri vermiyor

| Alan                | Değer                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                      |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                  |
| Konum               | `src/components/account/ReauthDialog.tsx:68`                                                                                                                                              |
| Diğer konumlar      | `src/components/account/ReauthDialog.tsx:42`, `src/components/account/ReauthDialog.tsx:159`, `src/components/account/AgentMandates.tsx:72`, `src/components/privacy/PrivacyCenter.tsx:46` |
| Kullanıcılar        | tümü                                                                                                                                                                                      |
| Prensip             | accessibility · Focus Order                                                                                                                                                               |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                     |
| WCAG                | 2.4.3                                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                                     |
| Efor                | M                                                                                                                                                                                         |
| Kaynak denetçiler   | area:account, area:account2                                                                                                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountB)                                                                                                                                                          |

**Kanıt:** ReauthDialog.tsx:68-75 `<div className="fixed inset-0 ..."><div role="dialog" aria-modal="true" ...>`: Tab/Shift+Tab tuzağı yok, arka plan kardeş öğeleri `inert` değil. 42-43 yalnızca açılışta `input.current?.focus()` yapıyor. Tetikleyen öğe saklanmadığı için kapanınca odak geri dönmüyor. Pencere portal kullanmadan bölümün içine render ediliyor (SessionManager.tsx:157, PasskeyManager.tsx:168). Effect `[onCancel]` bağımlılığına sahip ve useReauth onCancel'ı her render'da yeniden oluşturuyor (165-168). Bu yüzden üst bileşen yeniden render edildiğinde odak parola alanına geri atlıyor.

**Etki:** Klavye kullanıcısı Tab ile pencereden çıkıp örtünün altında görünmeyen düğmelere gidebiliyor. aria-modal'ı yok sayan ekran okuyucular (ör. VoiceOver iOS) arka planı okuyor. Pencere kapanınca odak <body>'ye düşüyor ve kullanıcı sayfanın başından yeniden gezinmek zorunda kalıyor.

**Önerilen aksiyon:** Yerel `<dialog>` ve `showModal()` kullanın (odak tuzağı, inert ve Escape yerleşik gelir) ya da bir focus-trap ekleyin. Açılışta `document.activeElement` saklanıp kapanışta `.focus()` ile geri verilsin. useReauth içindeki onDone ve onCancel'ı useCallback ile sabitleyin. Pencereyi createPortal ile body'ye taşıyın.

**Yapılan düzeltme:** Same fix as F76. In addition, useReauth now keeps pending in a ref, and onDone/onCancel are fixed with useCallback. The dialog effect runs only on mount ([] dependencies), so a parent re-render no longer pulls focus back to the password field. The window keydown listener was removed. The password field got aria-invalid/aria-describedby, and focus returns to it after an error. — dosyalar: `src/components/account/ReauthDialog.tsx`

## F179 — Hesap ve Oturumlar sayfalarının <title> etiketi sayfaya özgü değil

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | High                                                           |
| Durum               | Aday                                                           |
| Konum               | `src/app/account/page.tsx:1`                                   |
| Diğer konumlar      | `src/app/account/sessions/page.tsx:1`, `src/app/layout.tsx:16` |
| Kullanıcılar        | tümü                                                           |
| Prensip             | accessibility · Page Titled                                    |
| Sezgisel madde      | H14 — Erişilebilirlik                                          |
| WCAG                | 2.4.2                                                          |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | area:account                                                   |
| **Düzeltme durumu** | **Zaten uygun** (paket: accountA)                              |

**Kanıt:** page.tsx:1 ve sessions/page.tsx:1 "use client" ve metadata yok. Kök layout.tsx:16 `title: t("meta.title")` her sayfaya 'booking-platform — konaklama arama ve rezervasyon (demo)' başlığını veriyor (common.json:3). Yalnızca privacy, property, ranking ve report sayfaları kendi metadata'sını tanımlıyor.

**Etki:** Ekran okuyucu kullanıcısı ve çok sekmeli çalışan masaüstü kullanıcısı hangi sayfada olduğunu sekme başlığından anlayamıyor. Tarayıcı geçmişi ve yer imleri ayırt edilemiyor.

**Önerilen aksiyon:** page.tsx dosyalarını generateMetadata dışa aktaran sunucu bileşenine çevirip istemci içeriğini alt bileşene taşıyın: 'Hesabım — Booking', 'Oturumlar — Hesabım'. Alternatif olarak layout'ta `title.template` kullanın.

**Yapılan düzeltme:** Page titles were handled globally in wave 1 (src/app/account/layout.tsx), and the task says not to add titles.

## F180 — Favori ya da iptal hatası tüm sayfayı tam ekran hata görünümüne çeviriyor

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | High                             |
| Durum               | Aday                             |
| Konum               | `src/app/account/page.tsx:133`   |
| Diğer konumlar      | `src/app/account/page.tsx:150`   |
| Kullanıcılar        | misafir, tümü                    |
| Prensip             | robustness · recoverability      |
| Sezgisel madde      | H9 — Hata mesajları              |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | area:account                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA) |

**Kanıt:** page.tsx:133 `setError(err instanceof Error ? err.message : t("errors.favoriteFailed"))` ve 150'de iptal için aynısı. Bu, ilk yükleme hatasında kullanılan state'in aynısı. 191-205 `if (error) { return (<div className="flex min-h-screen ..."><p className="text-red-600">{error}</p><button onClick={() => window.location.reload()}`.

**Etki:** Bir favoriyi kaldırırken yaşanan geçici bir hata bütün hesap içeriğini (rezervasyonlar, cüzdan, passkey'ler) siliyor. Ekranda yalnızca 'Favori kaldırılamadı' ve sayfayı yenileyen bir düğme kalıyor. Kaydırma konumu ve bağlam kayboluyor, Header da olmadığı için başka yere gidilemiyor.

**Önerilen aksiyon:** Eylem hataları için ayrı bir state kullanın (ör. `actionError: { id, text }`). Hatayı ilgili kartta, düğmenin yanında satır içi `<p role="alert">` olarak gösterin. Sayfa render'ı korunsun, aynı düğme yeniden deneme işlevi görsün.

**Yapılan düzeltme:** Same as F161: inline per-card error, and the same button can be pressed again to retry. — dosyalar: `src/app/account/page.tsx`

## F181 — 'Rezervasyonlarım' listesi HELD/EXPIRED durumunu ham kodla gösteriyor ve rezervasyon detayına/ödemeye bağlantı yok

| Alan                | Değer                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Severity            | High                                                                 |
| Durum               | Aday                                                                 |
| Konum               | `src/app/account/page.tsx:160`                                       |
| Diğer konumlar      | `src/app/account/page.tsx:281-353`, `messages/tr/account.json:20-24` |
| Kullanıcılar        | misafir                                                              |
| Prensip             | robustness · observability                                           |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                       |
| Renk/tema           | Hayır                                                                |
| Efor                | S                                                                    |
| Kaynak denetçiler   | lens:copy                                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA)                                     |

**Kanıt:** account/page.tsx:160-168 `const labels = { PENDING, CONFIRMED, CANCELLED, COMPLETED }; return labels[status] || status;` — HELD ve EXPIRED için 'HELD'/'EXPIRED' ham metni sarı rozetle çıkar (170-181 varsayılan renk). 281-353 kart içinde /booking/{id} bağlantısı hiç yok; yalnız iptal ve favori düğmeleri var. booking.json'da HELD için 'Oda sizin için tutuluyor — ödemeyi tamamlayın' metni mevcut ama burada kullanılmıyor.

**Etki:** Ödemesi yarım kalan misafir rezervasyonunu 'HELD' olarak görür, anlamını bilmez ve ödemeyi tamamlayacağı sayfaya buradan ulaşamaz; tutma süresi dolar. Rezervasyon numarası/QR/mesaj gibi detaylara erişim de yoktur.

**Önerilen aksiyon:** Durum etiketlerini booking.status anahtarlarından (6 durum) alın; her karta 'Ayrıntıları gör' bağlantısı, HELD için birincil 'Ödemeyi tamamla (HH:MM'e kadar)' bağlantısı ekleyin; bilinmeyen durumda ham kod yerine 'Durum bilinmiyor' gösterin.

**Yapılan düzeltme:** getStatusLabel now covers HELD/EXPIRED and shows 'Durum bilinmiyor' for unknown values. Added the details link and the HELD payment link. The hold deadline time is not in the list API, so it is not shown. — dosyalar: `src/app/account/page.tsx`

## F182 — HELD ve EXPIRED rezervasyonlar ham İngilizce kodla ve 'beklemede' rengiyle görünüyor, ödemeye devam yolu yok

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | High                                                       |
| Durum               | Aday                                                       |
| Konum               | `src/app/account/page.tsx:167`                             |
| Diğer konumlar      | `prisma/schema.prisma:400`, `src/app/account/page.tsx:326` |
| Kullanıcılar        | misafir                                                    |
| Prensip             | learnability · familiarity                                 |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                |
| Renk/tema           | Hayır                                                      |
| Efor                | S                                                          |
| Kaynak denetçiler   | area:account                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountA)                    |

**Kanıt:** page.tsx:161-167 yalnızca PENDING, CONFIRMED, CANCELLED ve COMPLETED etiketlerini eşliyor, gerisi için `return labels[status] || status;`. getStatusColor varsayılan olarak sarı dönüyor (178-179). prisma/schema.prisma:400-407 BookingStatus enum'unda HELD ve EXPIRED de var. Eylem düğmeleri yalnızca `PENDING || CONFIRMED` için gösteriliyor (326).

**Etki:** Rezervasyonu tutulmuş (ödeme bekleyen) TR misafir rozet olarak 'HELD' görüyor ve Hesabım'dan ödemeye ya da iptale geçemiyor. Süresi dolmuş bir tutma da beklemede gibi sarı görünüyor. Misafir rezervasyonun hâlâ geçerli olduğunu sanıp konaklamayı kaçırabilir.

**Önerilen aksiyon:** tr/en account.json'a status.held ('Ödeme bekleniyor') ve status.expired ('Süresi doldu') anahtarlarını ekleyin ve rozete metinle birlikte ikon koyun. HELD için birincil bağlantı 'Ödemeyi tamamla' → /booking/{id}, EXPIRED için 'Yeniden ara' bağlantısı ekleyin. Bilinmeyen durumlar için de çevrilmiş bir yedek etiket ('Durum bilinmiyor') kullanın.

**Yapılan düzeltme:** Added HELD/EXPIRED/unknown labels and the 'Ödemeyi tamamla' link. Not done: a badge icon and a separate color for HELD (skipped, color/theme); the 'Yeniden ara' link for EXPIRED (the details link covers it). — dosyalar: `src/app/account/page.tsx`

## F183 — Hesabım sayfası yükleme ve hata durumunda çıkmaz sokak: Header ve giriş bağlantısı yok, 'Tekrar dene' aynı hatayı yineliyor

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | High                             |
| Durum               | Aday                             |
| Konum               | `src/app/account/page.tsx:191`   |
| Diğer konumlar      | `src/app/account/page.tsx:183`   |
| Kullanıcılar        | tümü                             |
| Prensip             | robustness · recoverability      |
| Sezgisel madde      | H9 — Hata mesajları              |
| WCAG                | 2.4.1                            |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | lens:nav                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountA) |

**Kanıt:** 183-189 yükleme durumu yalnız spinner div; metin, role="status", Header ve main yok. 191-205 hata durumu `<p className="text-red-600">{error}</p>` + `onClick={() => window.location.reload()}`; Header yok, `id="main"` yok (layout.tsx:46 'İçeriğe geç' hedefsiz kalıyor). 87-89 `if (!userRes.ok || !bookingsRes.ok) throw new Error(t("errors.userLoad"))` 401'i 500'den ayırmıyor. Oysa RoleGate (ui.tsx:214-225) aynı durumda giriş bağlantısı veriyor. booking/[id]/page.tsx:189-191 'Rezervasyonlarım' düğmesi bu sayfaya yönlendiriyor.

**Etki:** Oturumu düşmüş kullanıcı "Kullanıcı bilgileri yüklenemedi" görüyor; tekrar dene aynı sonuca götürüyor. Menü olmadığı için tarayıcı dışında çıkış yolu yok. Ekran okuyucu kullanıcısı yalnızca görsel spinner ile sonsuz yüklemeyi algılayamıyor.

**Önerilen aksiyon:** Sayfayı PageShell veya Header+Footer ile sarın. 401'de `t("common.loginRequired")` ve loginHref("/account") gösterin, diğer hatalarda useLoader.reload kullanın. Spinner'a `role="status"` ve görünür "Yükleniyor…" metni ekleyin.

**Yapılan düzeltme:** PageShell wrapper, login link on 401, a Retry button that re-runs the load, and a loading state with role=status and visible text. — dosyalar: `src/app/account/page.tsx`

## F184 — Hesabım sayfasında gelişmiş paneller (AI ödeme yetkisi, passkey, KYC, cüzdan) rezervasyonların üstünde

| Alan                | Değer                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Severity            | High                                                                                   |
| Durum               | Aday                                                                                   |
| Konum               | `src/app/account/page.tsx:249`                                                         |
| Diğer konumlar      | `src/components/account/AgentMandates.tsx:114-160`, `messages/tr/account.json:104-116` |
| Kullanıcılar        | misafir                                                                                |
| Prensip             | learnability · Bilişsel yük / ilerici açıklama                                         |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                                           |
| Renk/tema           | Hayır                                                                                  |
| Efor                | M                                                                                      |
| Kaynak denetçiler   | lens:copy                                                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountA)                                                |

**Kanıt:** account/page.tsx:249-255 sırasıyla WalletPanel, IdentityVerification, PasskeyManager, AgentMandates; misafirin birincil görevi olan 'Rezervasyonlarım' ancak 271-357'de. AgentMandates (account.json:104-116) 'Yapay zekâ ajanı ödeme yetkileri', 'İmzalı yetki belgesi', 'ilan kimliklerini virgülle ayırarak girin' gibi ileri düzey içerikle tüm kullanıcılara açık form gösterir.

**Etki:** Seyahatini yönetmek isteyen (özellikle düşük okuryazarlıklı, mobil) misafir anlamadığı panellerden geçmek zorunda; yanlışlıkla ödeme yetkisi oluşturma riski.

**Önerilen aksiyon:** Hesabım'ı sekmelere/bölümlere ayırın: 'Rezervasyonlar' (varsayılan, üstte), 'Favoriler', 'Cüzdan', 'Güvenlik' (passkey, oturumlar), 'Gelişmiş' (AI yetkileri, <details> içinde varsayılan kapalı); sayfa başına bölüm bağlantıları ekleyin.

**Yapılan düzeltme:** Bookings and favorites moved above Wallet, Identity, Passkey and Agent panels; the shortcut links now sit under the profile. Not done: tabs, or putting advanced panels inside <details> (needs product decision). — dosyalar: `src/app/account/page.tsx`

## F185 — Rezervasyon listelerinden rezervasyon detayına gidilemiyor; mesaj, talep ve bekleyen ödeme ekranlarına yol yok

| Alan                | Değer                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Severity            | High                                                                                |
| Durum               | Aday                                                                                |
| Konum               | `src/app/account/page.tsx:282`                                                      |
| Diğer konumlar      | `src/components/pwa/TripsView.tsx:130-137`, `src/app/booking/[id]/page.tsx:163-180` |
| Kullanıcılar        | misafir                                                                             |
| Prensip             | robustness · task conformance / browsability                                        |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                             |
| Renk/tema           | Hayır                                                                               |
| Efor                | S                                                                                   |
| Kaynak denetçiler   | lens:consistency                                                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountA)                                             |

**Kanıt:** src/app/account/page.tsx:282-301: rezervasyon kartında başlık düz `<h3 className="text-lg font-semibold">{booking.property.title}</h3>`, kartta hiçbir `/booking/${id}` bağlantısı yok. src/components/pwa/TripsView.tsx:130-137: seyahat kartında da `<h2>{item.propertyTitle}</h2>` var, bağlantı yok. Kod tabanında `/booking/` bağlantısı yalnızca şu noktalarda üretiliyor: checkout/page.tsx:141 (router.push), checkout/cart/page.tsx:196, TripPlanner.tsx:104, transfers/ClaimForm.tsx:95. Mesajlaşma (BookingMessages), hasar/iade talebi (BookingResolutionPanel), HELD ödeme formu ve RNPL planı ise yalnızca src/app/booking/[id]/page.tsx:163-180'de bulunuyor.

**Etki:** Ödeme ekranını kapatan ya da sonra geri dönen misafir; HELD rezervasyonunu ödeyemez, ev sahibine mesaj yazamaz, iade talebi açamaz, makbuz yazdıramaz. Rezervasyon numarasını bilmeyen kullanıcı için bu görevler fiilen kapalıdır. Destek yüküne ve kaçan ödemelere yol açar.

**Önerilen aksiyon:** account/page.tsx'te rezervasyon başlığını `<Link href={`/booking/${booking.id}`}>` yapın ve karta 'Ayrıntılar' adlı ikincil bir bağlantı ekleyin. TripsView kartına da aynı bağlantıyı ekleyin. HELD durumundaki karta birincil 'Ödemeyi tamamla' bağlantısı koyun. Bağlantı metni her iki listede aynı anahtardan gelsin (ör. booking.detail.open).

**Yapılan düzeltme:** The account page has the details and payment links. The TripsView link is in crossOwner. — dosyalar: `src/app/account/page.tsx`

## F186 — Çerez tercihini değiştirmek için kullanıcıdan çerezi elle silmesi isteniyor; tercih penceresini yeniden açacak kontrol yok

| Alan                | Değer                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                               |
| Durum               | Aday                                                                                                                                               |
| Konum               | `src/app/privacy/page.tsx:81`                                                                                                                      |
| Diğer konumlar      | `messages/tr/privacy.json:34`, `messages/en/privacy.json:34`, `src/components/privacy/CookieConsent.tsx:25`, `src/components/layout/Footer.tsx:73` |
| Kullanıcılar        | tümü                                                                                                                                               |
| Prensip             | flexibility · user control / customizability                                                                                                       |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                              |
| Efor                | M                                                                                                                                                  |
| Kaynak denetçiler   | area:account2                                                                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountB)                                                                                                                   |

**Kanıt:** privacy/page.tsx:80-85 `t.rich("cookies.body", { ..., code: (c) => <code>{c}</code> })` → messages/tr/privacy.json:34 "Tercihiniz <code>cookie_consent</code> çerezinde saklanır; çerezi silerek tercihinizi değiştirebilirsiniz." src/components/privacy/CookieConsent.tsx içinde bandı yeniden açan bir olay/işlev yok (grep: open/reopen/addEventListener bulunamadı). Footer.tsx:73 'Çerezler' bağlantısı yalnız bu paragrafa (#p-cookies) gidiyor.

**Etki:** Bilgisayar okuryazarlığı düşük misafir, tarayıcı geliştirici ayarlarında belirli bir çerezi silmeyi bilmediği için analitik onayını geri çekemiyor; onay vermek kadar kolay geri çekme sağlanmıyor (KVKK/GDPR beklentisi).

**Önerilen aksiyon:** CookieConsent bileşenine `window.dispatchEvent(new Event("cookie-consent:open"))` ile tetiklenen bir yeniden açma işlevi ekleyin; privacy/page.tsx çerez bölümüne ve Footer 'Çerezler' bağlantısının yanına "Çerez tercihlerini değiştir" `<button>`'u koyun; metindeki `<code>cookie_consent</code>` talimatını "Tercihinizi istediğiniz an 'Çerez tercihlerini değiştir' düğmesiyle güncelleyebilirsiniz" ile değiştirin.

**Yapılan düzeltme:** Added a client 'CookiePreferencesButton' export to PrivacyCenter.tsx. It deletes the cookie_consent cookie and reloads the page, so the cookie banner opens again. The button is placed in the cookies section of src/app/privacy/page.tsx. The privacy.notice.cookies.body text no longer tells users to delete the cookie by hand and points to the button instead (patch). Adding the same button next to the 'Cookies' link in Footer needs another owner, so it is in crossOwner. — dosyalar: `src/components/privacy/PrivacyCenter.tsx`, `src/app/privacy/page.tsx`

## F187 — Sunucu ve istemci hata mesajları yalnız Türkçe; EN arayüzde ham Türkçe/İngilizce teknik metin gösteriliyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                                                                                                                                                                                         |
| Durum               | Aday                                                                                                                                                                                                                                                                                                         |
| Konum               | `src/components/account/AgentMandates.tsx:87`                                                                                                                                                                                                                                                                |
| Diğer konumlar      | `src/components/account/AgentMandates.tsx:102`, `src/components/account/IdentityVerification.tsx:82`, `src/components/privacy/PrivacyCenter.tsx:38`, `src/components/privacy/PrivacyCenter.tsx:51`, `src/components/ui/ui.tsx:266`, `src/lib/api-client.ts:40`, `src/components/account/ReauthDialog.tsx:16` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                         |
| Prensip             | accessibility · Language of Parts / consistency                                                                                                                                                                                                                                                              |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                          |
| WCAG                | 3.1.2                                                                                                                                                                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                        |
| Efor                | M                                                                                                                                                                                                                                                                                                            |
| Kaynak denetçiler   | area:account2                                                                                                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountB)                                                                                                                                                                                                                                                                      |

**Kanıt:** AgentMandates.tsx:87 `setStatus({ error: errorMessage(err) })` → `err.message` doğrudan gösteriliyor. Sunucu mesajları sabit Türkçe: src/lib/http/errors.ts:42 "Bu işlem için e-posta adresinizi doğrulamanız gerekiyor", :152 "Doğrulama hatası"; api-client.ts:40 `İstek başarısız (${res.status})`; ui.tsx:266 `fallback = "Beklenmeyen bir hata oluştu"`; ReauthDialog.tsx:16 `super("Yeniden doğrulama iptal edildi")`. Ağ kesildiğinde `fetch` TypeError'ı "Failed to fetch" olarak TR arayüze sızıyor. Hiçbir `<p role="alert">` içinde `lang` özniteliği yok.

**Etki:** EN kullanan misafir/ev sahibi hata nedenini anlayamıyor; ekran okuyucu Türkçe metni İngilizce sesle okuyor (WCAG 3.1.2 ihlali). TR kullanıcı yavaş/kopuk ağda "Failed to fetch" gibi anlamsız teknik metin görüyor. Hata nedenini anlayamayan kullanıcı ne yapacağını bilemiyor.

**Önerilen aksiyon:** apiFetch hatalarında `err.code`'u (EMAIL_NOT_VERIFIED, VALIDATION_ERROR, KYC_RATE_LIMITED, ACCOUNT_HAS_OBLIGATIONS, RATE_LIMITED, SERVICE_UNAVAILABLE, NOT_FOUND) messages/<locale>/common.json içinde `errors.codes.*` anahtarlarına eşleyen bir `useApiErrorMessage()` yardımcı kancası yazın; tanınmayan kodlarda `common.unexpectedError` gösterin. `TypeError` (ağ hatası) için "Bağlantı kurulamadı, internetinizi kontrol edip tekrar deneyin" anahtarı ekleyin. errorMessage() varsayılanını ve ReauthCancelledError metnini çeviri anahtarına taşıyın.

**Yapılan düzeltme:** Added a new 'useAccountErrorText' hook (exported from ReauthDialog.tsx). It builds on useErrorText (common.errors / network error) and adds account-specific mappings: ReauthCancelled, NotAllowedError/InvalidStateError, and RATE_LIMITED/REAUTH_RATE_LIMITED/KYC_RATE_LIMITED mapped to account.errors.codes.*. Raw messages from client-side (non-API) errors are never shown. Server messages, which exist only in Turkish, are shown only when locale=tr; other locales get the caller's translated fallback. errorMessage/err.message usage was removed from AgentMandates, IdentityVerification and PrivacyCenter. ReauthCancelledError no longer carries a user-facing message. Not done: the ui.tsx errorMessage default and the api-client 'İstek başarısız' message belong to other owners (crossOwner). — dosyalar: `src/components/account/ReauthDialog.tsx`, `src/components/account/AgentMandates.tsx`, `src/components/account/IdentityVerification.tsx`, `src/components/privacy/PrivacyCenter.tsx`

## F188 — Yetki tutarı type=number alanında; TR binlik ayırıcı ve fazla ondalık sessizce yanlış tutara dönüşüyor, biçim hatası yanlış mesajla bildiriliyor

| Alan                | Değer                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                         |
| Durum               | Aday                                                                                         |
| Konum               | `src/components/account/AgentMandates.tsx:118`                                               |
| Diğer konumlar      | `src/components/account/AgentMandates.tsx:59`, `src/components/account/AgentMandates.tsx:76` |
| Kullanıcılar        | misafir                                                                                      |
| Prensip             | robustness · error prevention / predictability                                               |
| Sezgisel madde      | H5 — Hata önleme                                                                             |
| WCAG                | 3.3.1                                                                                        |
| Renk/tema           | Hayır                                                                                        |
| Efor                | M                                                                                            |
| Kaynak denetçiler   | area:account2                                                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountB)                                                             |

**Kanıt:** AgentMandates.tsx:118-125 `<input ... type="number" inputMode="decimal" min="1" step="0.01" required />` ve form `noValidate` (:116). :59 `Number(String(form.get("amount")).replace(",", "."))` — type=number'da değer zaten normalize edildiği için replace ölü kod; Chrome'da TR kullanıcının "1.500" (bin beş yüz) yazması 1.5 olarak okunuyor. Geçersiz biçimde input değeri "" → Number("")=0 → :61 "Sıfırdan büyük bir tutar girin." (biçim hatası değil). :60 `amount <= 0` kontrolü `min="1"` ile çelişiyor (0,5 kabul). `toMinor(amount, currency)` (money.ts:152 `value.toFixed(exp)`) 10.005 gibi değerleri sessizce yuvarlıyor. Ayrıca type=number'da fare tekerleği değeri değiştiriyor.

**Etki:** Misafir ₺1.500 limit vermek isterken ₺1,50 limitli yetki oluşturabiliyor; ajan ödemesi sonradan MANDATE_AMOUNT_EXCEEDED ile başarısız oluyor ve kullanıcı nedenini anlamıyor. Biçim hatasında yanlış yönlendiren mesaj görüyor.

**Önerilen aksiyon:** Alanı `type="text" inputMode="decimal" autoComplete="off"` yapın; locale'e göre (tr: binlik '.', ondalık ',') ayrıştıran bir `parseLocalizedAmount` ile değeri çözün; başarısızlıkta ayrı bir `amountFormat` mesajı ("Tutarı 1500 veya 1500,50 biçiminde girin") gösterin; `min="1"` özniteliğini kaldırın ya da doğrulamayı >= 1 ile hizalayın; alanın altına canlı önizleme (`aria-live="polite"`) olarak `f.money(toMinor(...), currency)` ile "Limit: ₺1.500,00" yazdırın; para birimi sembolünü alanın soluna ek (adornment) olarak koyun.

**Yapılan düzeltme:** AgentMandates amount field: type=text inputMode=decimal autoComplete=off, controlled. min/step removed (this also removes the mouse-wheel issue). Value parsed with parseAmountToMinor: '1.500' gives 150000 and too many decimals give null. A separate amountFormat message covers bad format and amountInvalid covers <=0. Focus moves to the field on error. Added an example format in the hint (amountHint) and a live preview below the field with aria-live=polite, formatted with f.money ('Limit: ₺1.500,00'). The currency select is controlled so the preview uses the right currency. toMinor/float rounding removed. The currency adornment was skipped (visual/layout change). — dosyalar: `src/components/account/AgentMandates.tsx`

## F189 — Yetki iptali onaysız ve anında; geri alınamıyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | High                                           |
| Durum               | Aday                                           |
| Konum               | `src/components/account/AgentMandates.tsx:213` |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · recoverability                    |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü              |
| WCAG                | 3.3.4                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:account2                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountB)               |

**Kanıt:** AgentMandates.tsx:213-221 `<Button variant="danger" onClick={() => void revoke(m)} ...>{t("revoke")}</Button>` — tek tıklamada DELETE /api/account/agent-mandates/{nonce} çağrılıyor. Sunucu (src/lib/agentic/mandate.ts revokeMandate) iptali kalıcı denetim kaydına yazıyor; 'iptali geri al' yolu yok. Yeni yetki vermek yeniden doğrulama (reauth) ve ajana yeni belge iletmeyi gerektiriyor.

**Etki:** Mobilde yanlışlıkla dokunan misafir, ajanının devam eden rezervasyon ödemesini bozuyor; yeni yetki için parola girip belgeyi ajana tekrar iletmek zorunda kalıyor. Hangi yetkinin iptal edildiğini ancak liste yenilenince görüyor.

**Önerilen aksiyon:** İptal düğmesi tıklanınca satır içi onay gösterin: "₺1.500 limitli, 12.10.2026 14:30'a kadar geçerli yetki iptal edilsin mi? Ajan bu yetkiyle ödeme yapamaz." + 'Evet, iptal et' / 'Vazgeç' (PrivacyCenter.tsx:71-105'teki role="group" kalıbını yeniden kullanın). Onay düğmesine odak verin.

**Yapılan düzeltme:** AgentMandates revoke now asks first through useConfirm (tone=danger, initial focus on Cancel). The body states the amount limit, the expiry date and that the action cannot be undone. During the request the button gets busy={revoking===nonce}, which prevents double submission. The button has min-h-[44px] on mobile. Errors are shown with errorText(…, revokeFailed). — dosyalar: `src/components/account/AgentMandates.tsx`

## F190 — Giriş alanı kenarlıkları 3:1 bileşen kontrastının altında

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | High                                                                           |
| Durum               | Aday                                                                           |
| Konum               | `src/components/account/ReauthDialog.tsx:99`                                   |
| Diğer konumlar      | `src/components/account/PasskeyManager.tsx:155`, `src/components/ui/ui.tsx:21` |
| Kullanıcılar        | tümü                                                                           |
| Prensip             | accessibility · Non-text Contrast                                              |
| Sezgisel madde      | H14 — Erişilebilirlik                                                          |
| WCAG                | 1.4.11                                                                         |
| Renk/tema           | Evet — onaylandı ve uygulandı                                                  |
| Efor                | S                                                                              |
| Kaynak denetçiler   | area:account                                                                   |
| **Düzeltme durumu** | **Düzeltildi (onaylı renk düzeltmesi)**                                        |

**Kanıt:** ReauthDialog.tsx:99 `border border-gray-300` (#d1d5db beyaz zeminde yaklaşık 1,5:1). PasskeyManager.tsx:155'te de aynısı. Ortak inputClass (ui.tsx:21) gray-400 kullanıyor, o da yaklaşık 2,5:1.

**Etki:** Az gören ve parlak güneşte mobil kullanan misafir alanın sınırını göremiyor, nereye yazacağını bulmakta zorlanıyor.

**Önerilen aksiyon:** Kenarlık rengi en az gray-500 düzeyine çekilmeli. Bu bir renk/tema değişikliği olduğu için kullanıcı onayı gerekiyor. Renge dokunmadan kısmi önlem olarak alanın üstüne görünür etiket konabilir ve odak halkası korunabilir.

## F191 — Hata metinleri arayüz diline çevrilmiyor: EN'de Türkçe, TR'de İngilizce tarayıcı hatası görünüyor

| Alan                | Değer                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                          |
| Durum               | Aday                                                                                                                                                                                          |
| Konum               | `src/components/account/SessionManager.tsx:39`                                                                                                                                                |
| Diğer konumlar      | `src/components/account/ReauthDialog.tsx:61`, `src/components/account/PasskeyManager.tsx:40`, `src/lib/auth/passkey-client.ts:84`, `src/lib/api-client.ts:40`, `src/app/account/page.tsx:102` |
| Kullanıcılar        | tümü                                                                                                                                                                                          |
| Prensip             | accessibility · Language of Parts                                                                                                                                                             |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                           |
| WCAG                | 3.1.2                                                                                                                                                                                         |
| Renk/tema           | Hayır                                                                                                                                                                                         |
| Efor                | M                                                                                                                                                                                             |
| Kaynak denetçiler   | area:account                                                                                                                                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountB)                                                                                                                                                              |

**Kanıt:** SessionManager.tsx:39 `return err instanceof Error && err.message ? err.message : fallback;`. Sunucudaki ApiError mesajları Türkçe sabit metin: user-sessions.ts:179 'Oturum bulunamadı', recent-auth.ts 'Parola hatalı', passkey.ts:259 'Hesapta kayıtlı passkey yok', proxy.ts:126 'Çok fazla istek...'. api-client.ts:40 'İstek başarısız (${res.status})'. passkey-client.ts:84-86 'Passkey işlemi iptal edildi veya zaman aşımına uğradı' sabit TR metnini ReauthDialog.tsx:61 çeviriyle ezmeden kullanıyor. Ağ hatasındaki TypeError 'Failed to fetch' mesajı SessionManager:39 ve page.tsx:102/133/150'de ham haliyle gösteriliyor.

**Etki:** EN konuşan misafir Türkçe hata metinleri görüyor ve anlamadığı için sorunu çözemiyor. TR'de düşük okuryazarlıktaki kullanıcı 'Failed to fetch' gibi İngilizce teknik bir ifade görüyor. Ekran okuyucu, lang="en" sayfadaki Türkçe metni İngilizce sesle okuyor.

**Önerilen aksiyon:** ApiError.code değerlerini tr/en çeviri anahtarlarına eşleyin (NOT_FOUND, UNAUTHORIZED, REAUTH_RATE_LIMITED, RATE_LIMITED, VALIDATION_ERROR, NETWORK). err.message'ı kullanıcıya hiç göstermeyin. ReauthDialog'da NotAllowedError ve InvalidStateError'ı PasskeyManager.tsx:36-38'deki gibi t() ile karşılayın. passkeyErrorMessage çevrilmiş metinleri parametre olarak alsın.

**Yapılan düzeltme:** SessionManager and PasskeyManager now use useAccountErrorText instead of err.message/passkeyErrorMessage. In ReauthDialog, WebAuthn errors map to t('passkeys.cancelled'/'alreadyRegistered'), UNAUTHORIZED maps to t('reauth.wrongPassword') for password attempts and t('failed') for passkey, and network errors map to common.errors.network. 'Failed to fetch' and Turkish server text no longer reach the EN interface. — dosyalar: `src/components/account/SessionManager.tsx`, `src/components/account/PasskeyManager.tsx`, `src/components/account/ReauthDialog.tsx`

## F192 — Yeniden doğrulamadan sonra 'Bu cihaz' oturumunu kapatmak 'Oturum bulunamadı' hatasıyla başarısız oluyor

| Alan                | Değer                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Severity            | High                                                                   |
| Durum               | Aday                                                                   |
| Konum               | `src/components/account/SessionManager.tsx:75`                         |
| Diğer konumlar      | `src/lib/auth/recent-auth.ts:128`, `src/lib/auth/user-sessions.ts:179` |
| Kullanıcılar        | tümü                                                                   |
| Prensip             | robustness · task conformance                                          |
| Sezgisel madde      | H9 — Hata mesajları                                                    |
| Renk/tema           | Hayır                                                                  |
| Efor                | M                                                                      |
| Kaynak denetçiler   | area:account                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: accountB)                                       |

**Kanıt:** SessionManager.tsx:75 `await reauth.run(() => apiFetch(`/api/account/sessions?${query}`, { method: "DELETE" }))`. Sorgudaki id eski oturum id'si (133). Yeniden doğrulamada recent-auth.ts:124-133 `refreshAuthTime` → `revokeSession(...)` mevcut oturum ailesini iptal edip yeni bir oturum açıyor. Tekrarlanan DELETE eski id ile gidiyor ve user-sessions.ts:179 `throw new NotFoundError("Oturum bulunamadı")` ile düşüyor. catch bloğu (83-84) load() çağırmadığı için liste eski satırı 'Bu cihaz' olarak göstermeye devam ediyor. RECENT_AUTH_MAX_AGE_SECONDS=300 (app-config.ts:525) olduğundan yeniden doğrulama çoğu durumda devreye giriyor.

**Etki:** Paylaşılan bir cihazda 'bu cihazda çıkış yap' isteyen kullanıcı hata mesajı görüyor ve yeni bir oturumla girişli kalıyor. Liste bayat kaldığı için tekrar denemek de aynı 404'ü veriyor. Güvenlik açısından kritik bir görev başarısız oluyor.

**Önerilen aksiyon:** Mevcut oturum için ayrı bir yol kullanın: yeniden doğrulama gerekirse sunucu tarafında `?scope=current` ile sid'i token'dan çözün ya da doğrudan logout() çağırın. catch içinde her zaman `await load()` çağırın. 404'ü 'zaten kapatılmış' olarak ele alıp listeyi yenileyin.

**Yapılan düzeltme:** SessionManager: closing the 'This device' session no longer calls DELETE+reauth. After confirmation it calls logout() directly (which closes the current session on the server) and goes to /login. Other sessions: a 404 NOT_FOUND is now treated as 'already closed' (sessions.alreadyClosed), and load() runs on both success and error, so the list never stays stale. — dosyalar: `src/components/account/SessionManager.tsx`

## F193 — Yükümlülük nedeniyle silinemeyen hesapta ayrıntı ve çözüm yolu gösterilmiyor; engel ancak parola girildikten sonra ortaya çıkıyor

| Alan                | Değer                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| Severity            | High                                                                                    |
| Durum               | Aday                                                                                    |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:51`                                           |
| Diğer konumlar      | `src/lib/privacy/privacy-service.ts:403`, `src/components/privacy/PrivacyCenter.tsx:58` |
| Kullanıcılar        | ev sahibi, misafir                                                                      |
| Prensip             | robustness · recoverability / error prevention                                          |
| Sezgisel madde      | H9 — Hata mesajları                                                                     |
| WCAG                | 3.3.3                                                                                   |
| Renk/tema           | Hayır                                                                                   |
| Efor                | M                                                                                       |
| Kaynak denetçiler   | area:account2                                                                           |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: accountB)                                                 |

**Kanıt:** PrivacyCenter.tsx:50-52 `catch (err) { setFeedback({ error: errorMessage(err) }); setBusy(false); }`. Sunucu src/lib/privacy/privacy-service.ts:403-407 `ConflictError("Hesap silinemiyor: devam eden ev sahibi rezervasyonları, bekleyen ödemeler veya açık talepler var", "ACCOUNT_HAS_OBLIGATIONS", obligations)` — `details` içinde hostedBookings/pendingPayouts/openClaims sayıları dönüyor ama UI `err.details`'i kullanmıyor; hata kartın değil sayfanın en üstündeki Status'ta (:58) görünüyor.

**Etki:** Ev sahibi onay kutusu + yeniden doğrulamayı tamamladıktan sonra hangi rezervasyon/ödeme/talep yüzünden silemediğini ve nereden çözeceğini bilmiyor; mobilde hata mesajı ekranın üstünde kaldığı için hiç görmeyebiliyor.

**Önerilen aksiyon:** `err instanceof ApiError && err.code === "ACCOUNT_HAS_OBLIGATIONS"` durumunda silme kartının içinde liste gösterin: "3 gelecek ev sahibi rezervasyonu → /host/bookings", "1 bekleyen ödeme → /host/payouts", "1 açık talep → /resolution" (bağlantılı). Mümkünse 'Hesabımı sil' tıklandığında önce bir ön kontrol çağrısıyla bu engelleri onay adımından önce gösterin; hata alanını silme kartının içine taşıyın.

**Yapılan düzeltme:** PrivacyCenter: for ApiError ACCOUNT_HAS_OBLIGATIONS, err.details (hostedBookings/pendingPayouts/openClaims) is read and shown inside the delete card as a list with counts and links (/host, /host/payouts, /resolution). The delete error moved from the top of the page into the card (Status). Other errors are localized. Showing the obligations before confirmation and reauth needs a pre-check endpoint (backend), so it was not done. — dosyalar: `src/components/privacy/PrivacyCenter.tsx`

## F436 — Passkey adı alanında görünür etiket yok; yalnız placeholder

| Alan                | Değer                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                         |
| Durum               | Gözlemlendi (3 kaynak birleşti)                                                                                |
| Konum               | `src/components/account/PasskeyManager.tsx:146`                                                                |
| Diğer konumlar      | `messages/tr/account.json`, `src/components/cart/SplitPayPanel.tsx:338-346`, `src/app/search/page.tsx:331-353` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                      |
| Prensip             | accessibility · Etiketler ve talimatlar (Dix: observability)                                                   |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                          |
| WCAG                | 3.3.2                                                                                                          |
| Renk/tema           | Hayır                                                                                                          |
| Efor                | S                                                                                                              |
| Kaynak denetçiler   | runtime:account, area:account, lens:forms                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p044)                                                                                |

**Kanıt:** Probe p4: label[for=passkey-name] class='sr-only' ('Passkey adı'), görünen tek ipucu placeholder 'Ad (ör. Dizüstü)'; alanın isteğe bağlı olduğu belirtilmiyor. Ekran: crops/account/060-guest-tr-desktop-_account-1.png (üstte) — yazmaya başlayınca ipucu kayboluyor.

**Etki:** Kullanıcı yazarken alanın amacını unutur; bilişsel engelli ve düşük okuryazarlıklı kullanıcılar için alanın zorunlu olup olmadığı belirsiz.

**Önerilen aksiyon:** Görünür label 'Passkey adı (isteğe bağlı)' ekle (sr-only kaldır), placeholder'ı örnek olarak koru; boş bırakılınca 'Adsız passkey' olacağını ipucu satırında yaz.

**Yapılan düzeltme:** Removed the sr-only class, so the 'Passkey adı (isteğe bağlı)' / 'Passkey name (optional)' label is now visible. Added a hint line linked to the input with aria-describedby (passkey-name-hint). It says blank names show as the unnamed label, which it reuses through {unnamed}. The placeholder is now just an example ('ör. Dizüstü' / 'e.g. Laptop'), and the input and button still sit on one row.

## F438 — Kimlik doğrulama hatası ham sağlayıcı kodu olarak gösteriliyor ("Sağlayıcı kodu: document_unreadable")

| Alan                | Değer                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                     |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                            |
| Konum               | `src/components/account/IdentityVerification.tsx:124`                                                      |
| Diğer konumlar      | `messages/tr/trust.json`, `src/lib/trust/kyc.ts`, `messages/tr/trust.json:35`, `messages/en/trust.json:35` |
| Kullanıcılar        | misafir, ev sahibi                                                                                         |
| Prensip             | learnability · Anlaşılır hata mesajı (Dix: familiarity)                                                    |
| Sezgisel madde      | H9 — Hata mesajları                                                                                        |
| Renk/tema           | Hayır                                                                                                      |
| Efor                | S                                                                                                          |
| Kaynak denetçiler   | runtime:account, area:account2                                                                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p043)                                                                            |

**Kanıt:** Probe p4 (guest, desktop; GET /api/account/identity REQUIRES_INPUT + lastError=document_unreadable olarak mock'landı — kyc.ts:105 'Bulanık fotoğraf' test belgesinin gerçek sonucu): bölüm metni 'Durum: Ek bilgi gerekiyor / Sağlayıcı kodu: document_unreadable / … / Yeniden dene'. Ne yapılması gerektiği (net fotoğraf, süresi geçerli belge) yazmıyor. Ekran: probes/account/shots/p4-kyc-mock.png

**Etki:** Misafir/ev sahibi neden başarısız olduğunu ve nasıl düzelteceğini anlamaz; özellikle ev sahibi için ilan yayınlamayı engelleyen adımda destek talebine yol açar.

**Önerilen aksiyon:** lastError kodlarını çeviri anahtarına eşle (document_unreadable → 'Belge fotoğrafı okunamadı; ışıklı ortamda, parlama olmadan tekrar çekin', document_expired → 'Belgenizin süresi dolmuş; geçerli bir belge kullanın', document_fraudulent → 'Belge doğrulanamadı; destekle iletişime geçin'); kodu yalnız destek için küçük ek bilgi olarak bırak.

**Yapılan düzeltme:** lastError codes are now mapped to actionable trust.kyc.errors.<code> text: document_unreadable, document_expired, document_fraudulent, the Stripe document_* codes, consent_declined, abandoned, device_not_supported, country_not_supported and under_supported_age. Any other code falls back to errors.unknown via t.has. The raw code now appears only as a small 'Hata kodu (destek için): {code}' line, with a /support link next to it.

## F439 — Hesap silme ve 'Vazgeç' adımlarında odak body'ye düşüyor; onay grubu duyurulmuyor

| Alan                | Değer                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                               |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                                                                      |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:67`                                                                                                        |
| Diğer konumlar      | `src/components/privacy/PrivacyCenter.tsx:97`, `src/components/account/AgentMandates.tsx:212`, `src/components/account/IdentityVerification.tsx:128` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                   |
| Prensip             | accessibility · Odak yönetimi (Dix: observability)                                                                                                   |
| Sezgisel madde      | H12 — Feedback                                                                                                                                       |
| WCAG                | 2.4.3                                                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                                |
| Efor                | S                                                                                                                                                    |
| Kaynak denetçiler   | runtime:account, area:account2                                                                                                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p097)                                                                                                                      |

**Kanıt:** Probe p3-privacy (desktop ve mobil): 'Hesabımı sil' Enter → 'focus after Hesabımı sil: body' (buton DOM'dan kalkıyor); 'Vazgeç' tıklaması sonrası da 'focus: body'. Onay grubu role=group, aria-live yok. Son buton 'Evet, hesabımı sil' onay kutusu işaretlenene kadar disabled (doğru) — son butona tıklanmadı.

**Etki:** Ekran okuyucu kullanıcısı onay adımının açıldığını duymaz, nerede olduğunu kaybeder; vazgeçince sayfanın başına döner.

**Önerilen aksiyon:** Onay grubu açıldığında başlığına (tabIndex=-1) veya onay kutusuna focus() ver; 'Vazgeç'te odağı yeniden görünen 'Hesabımı sil' butonuna döndür (ref + useEffect).

**Yapılan düzeltme:** Opening the confirm step still moves focus to the checkbox, and the group's name is read when focus enters it. 'Vazgeç' now sets a returnFocus ref, and an effect moves focus back to the 'Hesabımı sil' button when it reappears (the button now has a ref) instead of dropping it to body.

## F453 — İşlem hatası tüm hesap sayfasını başlıksız tek hata kutusuyla değiştiriyor

| Alan                | Değer                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Severity            | Medium                                                                          |
| Durum               | Gözlemlendi                                                                     |
| Konum               | `src/app/account/page.tsx:150`                                                  |
| Kullanıcılar        | misafir, ev sahibi                                                              |
| Prensip             | robustness · Hata sonrası bağlamın korunması (Dix: recoverability, persistence) |
| Sezgisel madde      | H9 — Hata mesajları                                                             |
| Renk/tema           | Hayır                                                                           |
| Efor                | S                                                                               |
| Kaynak denetçiler   | runtime:account                                                                 |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p007)                                                |

**Kanıt:** Probe p6-cancel (mobil): mock'lanmış 500 iptal hatasından sonra sayfa: h1=0, main=0, header=0, metin yalnız 'Rezervasyon iptal edilemedi / Tekrar Dene'. Kod: cancelBooking (150) ve toggleFavorite (133) setError çağırıyor; 191-205 error doluysa tüm sayfa erken return ile değişiyor. Ekran: probes/account/shots/p6-after-cancel-error-mobile.png

**Etki:** Bir favori/iptal hatası kullanıcının rezervasyon listesini, navigasyonu ve kaydırma konumunu siler; neyin başarısız olduğu ve verinin durumu belirsizleşir, yeniden yükleme gerekir.

**Önerilen aksiyon:** Yükleme hatası ile işlem hatasını ayır: işlem hatalarını ilgili kartın içinde (veya sayfa üstünde) role=alert satır içi mesaj olarak göster, listeyi koru. Tam sayfa hata yalnız ilk yükleme başarısızsa ve PageShell içinde gösterilsin.

**Yapılan düzeltme:** Cancel and favorite errors were already shown inside the affected card (ActionNotice + renderNotice, role=alert in a persistent aria-live region), and the full-page error used PageShell. As part of F605 the full-page error branch is now gone: load failures appear per section with their own retry.

## F454 — Rezervasyon durumu ham enum olarak görünüyor: "HELD" (TR ve EN)

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Medium                                                 |
| Durum               | Gözlemlendi                                            |
| Konum               | `src/app/account/page.tsx:161`                         |
| Diğer konumlar      | `messages/tr/account.json`, `messages/en/account.json` |
| Kullanıcılar        | misafir                                                |
| Prensip             | learnability · Gerçek dünya dili (Dix: familiarity)    |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                            |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | runtime:account                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p007)                        |

**Kanıt:** Probe p6-cancel (TR): iki kartta status 'HELD'. Probe p7-verify (EN): durum çipleri ['Cancelled','HELD','Confirmed','Completed']. getStatusLabel (160-168) yalnız PENDING/CONFIRMED/CANCELLED/COMPLETED eşliyor; HELD için çeviri yok, renk de varsayılan sarı.

**Etki:** Misafir rezervasyonunun ödeme bekleyen/tutulmuş olduğunu anlamaz; 'HELD' İngilizce teknik terim, süresi dolabileceği bilgisi de verilmiyor.

**Önerilen aksiyon:** status.held anahtarı ekle (TR: 'Ödeme bekleniyor / Tutuluyor', EN: 'On hold – awaiting payment'), varsa tutma bitiş süresini ve 'Ödemeyi tamamla' bağlantısını göster; bilinmeyen durumlar için genel 'İşleniyor' etiketi kullan.

**Yapılan düzeltme:** HELD already had a translation and a 'Complete payment' link; the status is now rendered by the new shared BookingStatusBadge (label + icon). Unknown statuses show 'Durum bilinmiyor' instead of the raw code. HELD cards also show the payment deadline: holdExpiresAt (already in the /api/bookings response) is added to the Booking type and shown with the new bookings.holdUntil message.

## F455 — Hesap sayfası bilgi mimarisi: rezervasyonlar 2+ ekran aşağıda, gizlilik merkezi hiç bağlanmamış

| Alan                | Değer                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                     |
| Durum               | Gözlemlendi                                                                                |
| Konum               | `src/app/account/page.tsx:249`                                                             |
| Diğer konumlar      | `src/components/layout/Footer.tsx`                                                         |
| Kullanıcılar        | misafir, ev sahibi                                                                         |
| Prensip             | learnability · Minimal tasarım, sık görev önceliği (Dix: task migratability, browsability) |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                                               |
| Renk/tema           | Hayır                                                                                      |
| Efor                | M                                                                                          |
| Kaynak denetçiler   | runtime:account                                                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p007)                                                            |

**Kanıt:** Probe p4 (desktop) h2 konumları: Profil y=207, Cüzdan 352, Kimlik doğrulama 907, Passkey 1178, AI ödeme yetkileri 1385, Rezervasyonlarım 1859. Probe p8 (mobil 390): Rezervasyonlarım y=1909 (≈2.3 ekran), Favorilerim y=4881, sayfa yüksekliği 7687px. p9: main içinde /account/privacy bağlantısı yok; 'Gizlilik ve verilerim'e yalnız footer'daki 47x16px 'Verilerim' bağlantısıyla (tarama targetsLt24) ulaşılıyor. Oturum/Seyahat/Çözüm bağlantıları formların arasına sıkışmış tek satır metin (page.tsx:257-269).

**Etki:** Mobil ağırlıklı misafir en sık işi olan rezervasyonlarını görmek için KYC test belgesi, passkey ve AI yetki formlarını geçmek zorunda; KVKK haklarını kullanacağı sayfayı keşfetmesi zor.

**Önerilen aksiyon:** Hesabı bölümlere ayır (sekme veya sol menü/alt sayfalar): 'Rezervasyonlarım' (varsayılan, en üstte), 'Favoriler', 'Cüzdan', 'Güvenlik' (passkey + oturumlar + kimlik doğrulama), 'Gizlilik ve verilerim', 'Gelişmiş: AI ödeme yetkileri'. Mobilde üstte yatay kaydırmalı sekme şeridi; /account/privacy'yi bu menüye ekle.

**Yapılan düzeltme:** Added an 'Hesap bölümleri' nav under the h1 (a <ul> that scrolls sideways on mobile and wraps from sm up). It jumps to bookings, favorites, wallet and security, and links to trips, sessions, /account/privacy and resolution. Bookings and favorites stay right after the profile. Identity verification, passkeys and a new Oturumlar card (sessions link + logout) are grouped under #account-security. AgentMandates moved into a <details id="account-advanced"> that is closed by default.

## F456 — Favori 'Kaldır' anında siliyor: geri alma yok, odak kayboluyor, 10 özdeş buton adı

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Medium                                                |
| Durum               | Gözlemlendi                                           |
| Konum               | `src/app/account/page.tsx:398`                        |
| Kullanıcılar        | misafir                                               |
| Prensip             | robustness · Geri alınabilirlik (Dix: recoverability) |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                     |
| WCAG                | 2.4.6                                                 |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | runtime:account                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p007)                       |

**Kanıt:** Probe p4 (DELETE /api/favorites mock'landı, sunucu değişmedi; p7 favori sayısı 10): ilk 'Kaldır' Enter → dialogs [], kart sayısı 10→9, 'focus: body', 'Geri al'/toast 0. Butonların aria-label'ı yok (p4 'Favorilere Ekle|aria=null', 'Rezervasyonu İptal Et|aria=null'); tarama tabOrder'da ardışık 'Kaldır','Kaldır','Kaldır'.

**Etki:** Yanlışlıkla kaldırılan favori geri getirilemez (ilanı arayıp yeniden eklemek gerekir); klavye kullanıcısı listede yerini kaybeder; ekran okuyucu hangi ilanın kaldırılacağını duymaz.

**Önerilen aksiyon:** Kaldırınca 5 sn 'Villa Amara favorilerden kaldırıldı · Geri al' (role=status) göster; odağı bir sonraki kartın butonuna taşı. aria-label='{ilan adı} favorilerden kaldır' ve rezervasyon butonlarına da ilan adını ekle.

**Yapılan düzeltme:** Removing from the favorites list now goes through removeFavorite. It shows '{title} favorilerden kaldırıldı.' in a persistent role=status region with a 'Geri al' button that stays until the next favorite action (no time limit). Undo POSTs the favorite back at its original position. Focus moves to the next or previous card's remove button (or to Geri al if the list is empty), and back to the restored card after undo. Remove, cancel and favorite-toggle buttons now include the listing title as sr-only text and use aria-disabled instead of disabled, so focus is not lost while a request runs. The redundant aria-pressed on the toggle, whose label already changes, was dropped. After a successful cancel, focus moves to that card's details link.

## F457 — AI ödeme yetkisi ekranı misafir için anlaşılmaz: jargon, ajan/belge kullanımına yardım yok, ana sayfada orta konumda

| Alan                | Değer                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Severity            | Medium                                                                           |
| Durum               | Gözlemlendi                                                                      |
| Konum               | `src/components/account/AgentMandates.tsx:115`                                   |
| Diğer konumlar      | `messages/tr/account.json`                                                       |
| Kullanıcılar        | misafir                                                                          |
| Prensip             | learnability · Gerçek dünya eşleşmesi ve yardım (Dix: familiarity, guessability) |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                                       |
| Renk/tema           | Hayır                                                                            |
| Efor                | M                                                                                |
| Kaynak denetçiler   | runtime:account                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p040)                                                  |

**Kanıt:** Tarama 060/061 metni: 'Bir yapay zekâ ajanının sizin adınıza rezervasyon ödemesi yapabilmesi için sınırlı bir yetki (mandate) verin…'. Probe p4 (POST mock'lu başarı): 'Bu yetki belgesi yalnızca şimdi gösterilir. Ajanınıza iletin; başkalarıyla paylaşmayın.' + base64 token textarea + 'Kopyala'. Hangi ajanların desteklendiği, belgenin nasıl iletileceği, kullanılınca ne olacağı için yardım/bağlantı yok. Bölüm passkey ile rezervasyonlar arasında, varsayılan açık form olarak duruyor (p4 y=1385). Ekran: probes/account/shots/p4-mandate-issued.png

**Etki:** Okuryazarlığı geniş yelpazedeki misafir, para harcama yetkisi veren bir formu ne işe yaradığını anlamadan doldurabilir veya bölümden çekinir; güven ve bilişsel yük sorunu.

**Önerilen aksiyon:** Bölümü varsayılan kapalı 'Gelişmiş' alana taşı; 'mandate' yerine düz dil ('Ajanınızın harcayabileceği üst sınır'), 3 adımlı mini açıklama ve 'Nasıl kullanılır?' yardım bağlantısı ekle; özet önizleme göster ('X saat boyunca en fazla ₺1.500, yalnız 1 ilan için'). Token yerine mümkünse 'Ajana bağlantı paylaş' akışı.

**Yapılan düzeltme:** The section was already inside the closed-by-default "advanced" <details id="account-advanced"> on the account page, so it did not need moving. I rewrote the intro in plain language without the word "mandate" and switched the English copy from "mandate" to "permission". I added a 3-step "Nasıl kullanılır?" disclosure and a live one-sentence summary of what will be granted. A "share a link with the agent" flow, offered instead of a token, needs a new server API, so I did not build it.

## F458 — AI yetkisinin ilan kısıtı kullanıcıdan dahili ilan kimliklerini ezberden yazmasını istiyor

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Gözlemlendi                                          |
| Konum               | `src/components/account/AgentMandates.tsx:153`       |
| Kullanıcılar        | misafir                                              |
| Prensip             | learnability · Tanıma > hatırlama (Dix: recognition) |
| Sezgisel madde      | H6 — Tanıma > hatırlama                              |
| Renk/tema           | Hayır                                                |
| Efor                | M                                                    |
| Kaynak denetçiler   | runtime:account                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p040)                      |

**Kanıt:** Alan ipucu: 'Yalnız belirli ilanlar için yetki vermek istiyorsanız ilan kimliklerini virgülle ayırarak girin.' İlan kimlikleri cuid (örn. URL /property/{id}, booking/[id]/page.tsx:184). Probe p4: alana 'villa-amara' yazıldı, istemci doğrulaması olmadan POST gönderildi (mock'landı). Favoriler/rezervasyonlardan seçim yok.

**Etki:** Misafir ilan kimliğini bilmez; kısıt alanı fiilen kullanılamaz ya da yanlış girilir ve yetki beklenenden geniş kalır.

**Önerilen aksiyon:** Serbest metin yerine favoriler + geçmiş rezervasyonlardan çoklu seçim (combobox/checkbox listesi, ilan adı ve şehirle) sun; ayrıca ilan adıyla arama. Girilen kimlikleri istemci tarafında doğrula ve seçilen ilan adlarını özet olarak göster.

**Yapılan düzeltme:** I replaced the free-text ID input with a checkbox fieldset of listings taken from the guest's favorites and bookings, showing title, city and currency. A listing can also be added by pasting its page link. That link is checked with GET /api/properties/{id}: a 404 or a malformed link shows a field error, and a valid one is added and pre-checked. Selection is capped at 20.

## F459 — Oturumlar listesi ayırt edilemiyor: 10 özdeş "Chrome · Windows", mevcut oturum üstte değil, butonların erişilebilir bağlamı yok

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | Medium                                                           |
| Durum               | Gözlemlendi                                                      |
| Konum               | `src/components/account/SessionManager.tsx:129`                  |
| Diğer konumlar      | `messages/tr/account.json`                                       |
| Kullanıcılar        | misafir, ev sahibi, admin                                        |
| Prensip             | accessibility · Gözlemlenebilirlik / tanıma (Dix: observability) |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                          |
| WCAG                | 2.4.6                                                            |
| Renk/tema           | Hayır                                                            |
| Efor                | S                                                                |
| Kaynak denetçiler   | runtime:account                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p046)                           |

**Kanıt:** Probe p2-sessions (guest, desktop): 10 satırın hepsi 'Chrome · Windows', ipHint yok; 'Bu cihaz' rozeti 2. satırda (ilk satır 00:32 son etkinlikli başka oturum). 10 butonun hepsi 'Oturumu kapat', aria-label=null, 109x26px; mevcut oturumun butonu da aynı etiket. Sayfa açıklaması 'Tanımadığınız bir cihaz görürseniz oturumu kapatın' diyor. Tarama 063 mobil: butonlar iki satıra kırılıyor. Ekran: crops/account/062-guest-tr-desktop-_account_sessions-0.png

**Etki:** Kullanıcı tanımadığı cihazı ayırt edemez, güvenlik tavsiyesi uygulanamaz; ekran okuyucu kullanıcısı 10 aynı 'Oturumu kapat' duyar ve hangisinin kendi cihazı olduğunu bilemez.

**Önerilen aksiyon:** Mevcut oturumu her zaman ilk sıraya sabitle ve butonunu 'Bu cihazdan çıkış yap' olarak etiketle; diğerlerine aria-label='{cihaz}, son etkinlik {tarih} oturumunu kapat' ver (AgentMandates revokeLabel deseni gibi). Konum/IP ipucu, ilk görülme yeri ve 'x gün önce' göreli zaman ekle; aynı cihaz/tarayıcıdan eski oturumları gruplandır.

**Yapılan düzeltme:** The current session is now always sorted first; the rest keep the server's last-seen order. The current row's button reads 'Bu cihazda çıkış yap' (revokeCurrent). Every other row gets aria-label revokeLabel 'Oturumu kapat: {device}, son etkinlik {date}'. Each row now shows relative time ('3 gün önce') via Intl.RelativeTimeFormat, using the load timestamp rather than the clock at render. On mobile the row stacks (flex-col → sm:flex-row) so the button no longer wraps. Not done: grouping same-device sessions, and location or first-seen place, because the API exposes no location and ipHint is null server-side (not my file).

## F583 — 'Kopyala' düğmesi başarı/başarısızlık geri bildirimi vermiyor; pano yoksa sessizce hiçbir şey olmuyor

| Alan                | Değer                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                                                 |
| Durum               | Aday (3 kaynak birleşti)                                                                                                                                                                               |
| Konum               | `src/components/account/AgentMandates.tsx:180`                                                                                                                                                         |
| Diğer konumlar      | `src/components/transfers/TransferMarket.tsx:131-139`, `src/components/cart/SplitPayPanel.tsx:130-138`, `src/components/transfers/TransferMarket.tsx:209`, `src/components/cart/SplitPayPanel.tsx:132` |
| Kullanıcılar        | misafir                                                                                                                                                                                                |
| Prensip             | robustness · observability                                                                                                                                                                             |
| Sezgisel madde      | H12 — Feedback                                                                                                                                                                                         |
| WCAG                | 4.1.3                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                  |
| Efor                | S                                                                                                                                                                                                      |
| Kaynak denetçiler   | area:account2, lens:consistency, lens:status                                                                                                                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p040)                                                                                                                                                                        |

**Kanıt:** AgentMandates.tsx:177-183 `onClick={() => void navigator.clipboard?.writeText(issued)}` — Promise sonucu işlenmiyor; `navigator.clipboard` güvensiz bağlamda (http) undefined iken optional chaining sessizce no-op; reddedilen izin yakalanmıyor. Belge 'yalnızca şimdi gösterilir' (account.json:120).

**Etki:** Misafir belgeyi kopyaladığını sanıp sayfadan ayrılıyor; belge tek seferlik olduğu için kaybediliyor ve yeniden doğrulama ile yeni yetki vermek zorunda kalıyor.

**Önerilen aksiyon:** writeText'i await edip başarıda düğme metnini 2 sn "Kopyalandı" yapın ve `Status` alanına `t("copied")` yazın; hata ya da clipboard yoksa `t("copyFailed")` ("Kopyalanamadı; metni seçip Ctrl+C ile kopyalayın") gösterip textarea'yı `select()` edin.

**Yapılan düzeltme:** Confirmed: the Copy button ignored the result of the writeText promise. Copy now awaits navigator.clipboard.writeText. On success the button shows "Kopyalandı" for 2 seconds and the status line announces t("copied"). When the clipboard is missing or permission is refused, t("copyFailed") is shown as an alert and the token textarea is focused with its text selected for manual Ctrl+C.

## F585 — Hesap silindi mesajı anında yönlendirmeyle kayboluyor; ana sayfada onay yok

| Alan                | Değer                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                             |
| Durum               | Aday (2 kaynak birleşti)                                                                                                           |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:47`                                                                                      |
| Diğer konumlar      | `src/app/register/page.tsx:41`, `src/app/login/page.tsx:63`, `src/components/layout/Header.tsx:60`, `src/app/account/page.tsx:214` |
| Kullanıcılar        | tümü                                                                                                                               |
| Prensip             | robustness · observability                                                                                                         |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                     |
| WCAG                | 4.1.3                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                              |
| Efor                | S                                                                                                                                  |
| Kaynak denetçiler   | area:account2, lens:status                                                                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p097)                                                                                                    |

**Kanıt:** PrivacyCenter.tsx:47-49 `setFeedback({ message: t("deleted") }); router.push("/"); router.refresh();` — mesaj ("Hesabınız silindi. Ana sayfaya yönlendiriliyorsunuz…") aynı tikte sayfa değiştiği için görünmüyor/okunmuyor; '/' sayfası bir silme onayı göstermiyor.

**Etki:** Kullanıcı en kritik geri alınamaz eylemin başarılı olup olmadığını öğrenemiyor; ekran okuyucu kullanıcısı yalnız sayfa değişikliğini algılıyor. Belirsizlik yeniden giriş denemesine/destek talebine yol açıyor.

**Önerilen aksiyon:** Yönlendirmeyi `/?accountDeleted=1` yapın ve ana sayfada (ya da ayrı bir /goodbye sayfasında) `role="status"` ile "Hesabınız silindi; iade edilen rezervasyonlar için e-posta alacaksınız" bildirimini gösterin; alternatif olarak mesajı gösterip 'Ana sayfaya git' düğmesiyle kullanıcı kontrolünde yönlendirin.

**Yapılan düzeltme:** Confirmed: the message was lost in the instant router.push('/'). Removed the redirect. After deletion the header cache is cleared (setSessionUserCache(null)), router.refresh() runs, and the page shows a 'Hesabınız silindi' card whose h2 (tabIndex=-1) gets focus. The card lists cancelled bookings and withdrawn transfer listings from the DELETE response and has a 'Ana sayfaya git' ButtonLink, so the user decides when to leave. Nothing on the home page needs to change.

## F605 — Tek bir uç nokta hatası tüm hesap sayfasını kilitliyor ve hatanın kaynağını yanlış söylüyor

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | Medium                          |
| Durum               | Aday                            |
| Konum               | `src/app/account/page.tsx:87`   |
| Diğer konumlar      | `src/app/account/page.tsx:96`   |
| Kullanıcılar        | tümü                            |
| Prensip             | robustness · recoverability     |
| Sezgisel madde      | H9 — Hata mesajları             |
| Renk/tema           | Hayır                           |
| Efor                | M                               |
| Kaynak denetçiler   | area:account                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p007) |

**Kanıt:** page.tsx:87-89 `if (!userRes.ok || !bookingsRes.ok) throw new Error(t("errors.userLoad"))`: rezervasyon hatası da 'Kullanıcı bilgileri yüklenemedi' olarak raporlanıyor. 96 `await fetchFavorites()` hatası tüm sayfayı 'Favoriler yüklenemedi' ekranına çeviriyor.

**Etki:** Yalnızca favoriler servisi çöktüğünde bile kullanıcı çıkış yapamıyor, passkey ve oturumlarına ulaşamıyor. Yanlış mesaj nedeniyle destek ekibine de yanlış bilgi veriyor.

**Önerilen aksiyon:** Bölümleri Promise.allSettled ile bağımsız yükleyin ve her bölümde kendi hatasını, yeniden deneme düğmesiyle gösterin. Profil, çıkış ve güvenlik bölümleri her durumda render edilsin.

**Yapılan düzeltme:** Confirmed: Promise.all made any single endpoint failure replace the whole page, with a misleading userLoad message. The page now uses Promise.allSettled. A 401 from any endpoint shows the session-expired view; other failures are stored per section (user/bookings/favorites) with their own message (new errors.bookingsLoad; userLoad and favoritesLoad reused) and a retry button that reloads only that section. Profile, security, logout, wallet and the other sections always render. The favorite toggle on booking cards is hidden while favorites have failed to load.

## F606 — Hesabım'daki iptalden sonra iade sonucu bildirilmiyor

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | Medium                           |
| Durum               | Aday                             |
| Konum               | `src/app/account/page.tsx:146`   |
| Kullanıcılar        | misafir                          |
| Prensip             | robustness · observability       |
| Sezgisel madde      | H12 — Feedback                   |
| WCAG                | 4.1.3                            |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | area:account                     |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p007) |

**Kanıt:** page.tsx:145-148 `if (!res.ok) throw ...; setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: "CANCELLED" } : b))`. Yanıt gövdesindeki `refund { refundMinor, refundPercent }` okunmuyor ve durum mesajı gösterilmiyor. BookingActions.tsx:214-222 aynı yanıtla `cancel.refunded` / `cancel.noRefund` mesajını gösteriyor.

**Etki:** Misafir ne kadar iade alacağını öğrenemiyor, para konusunda belirsizlik kalıyor. Ekran okuyucu kullanıcısı da yalnızca rozetin sessizce değiştiğini fark edebiliyor.

**Önerilen aksiyon:** Yanıtı JSON olarak okuyun. Kartın içinde sürekli bağlı duran bir aria-live bölgesinde şu mesajı gösterin: 'Rezervasyon iptal edildi. {amount} (%{percent}) iade edilecek' ya da 'Bu iptal için iade yok'. BookingActions'taki çeviri anahtarlarını yeniden kullanın.

**Yapılan düzeltme:** cancelBooking already reads the DELETE response's refund and shows bookings.cancelDone.refunded/noRefund/plain in the card's persistent aria-live region (renderNotice). Focus now also moves to the card's details link after a successful cancel.

## F607 — Aynı rezervasyon durumu üç ekranda üç farklı etiket ve görsel ile gösteriliyor; hesap sayfasında HELD/EXPIRED ham kod olarak çıkıyor

| Alan                | Değer                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                           |
| Durum               | Aday                                                                                                                                                                                                                             |
| Konum               | `src/app/account/page.tsx:160`                                                                                                                                                                                                   |
| Diğer konumlar      | `src/app/account/page.tsx:170-181`, `src/app/booking/[id]/page.tsx:34-39`, `src/components/host/HostDashboard.tsx:57-74`, `src/components/host/HostDashboard.tsx:168`, `messages/tr/account.json`, `messages/tr/host.json:29-36` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                                                               |
| Prensip             | learnability · consistency                                                                                                                                                                                                       |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                                                                                            |
| Efor                | S                                                                                                                                                                                                                                |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p007)                                                                                                                                                                                           |

**Kanıt:** account/page.tsx:160-168 yalnızca PENDING, CONFIRMED, CANCELLED ve COMPLETED değerlerini eşliyor, gerisi için `return labels[status] || status`. /api/bookings durum süzmediği için HELD ve EXPIRED ham olarak çıkıyor, :178'de de sarı rozet alıyor. booking/[id]/page.tsx:34 STATUS_KEYS altı durumu kapsıyor ve booking.json'daki cümle biçimli metinleri ("Oda sizin için tutuluyor — ödemeyi tamamlayın") h1 olarak kullanıyor. HostDashboard.tsx:57-74 ve :168 host.bookingStatus'u ("İptal", "Tutuldu") düz tablo metni olarak yazıyor. Etiketler de uyuşmuyor: account.status.cancelled "İptal Edildi", host "İptal", booking "Rezervasyon iptal edildi".

**Etki:** Misafir hesap sayfasında "HELD" gibi teknik bir kod görür ve ödemenin beklediğini anlamaz. Ev sahibi ile misafir aynı rezervasyonu farklı adlarla konuşur, bu da destek yazışmalarında karışıklığa yol açar.

**Önerilen aksiyon:** `BookingStatusBadge` adlı ortak bir bileşen yapın: altı durumun hepsi için tek bir `bookingStatus.<STATUS>` kısa etiketi ve her durum için ayırt edici bir ikon (renge ek olarak) olsun. Mevcut renk sınıfları korunabilir. account, HostDashboard ve booking detay alt başlığında bu bileşeni kullanın. Uzun açıklama cümleleri ayrı bir `bookingStatusHint.<STATUS>` anahtarında dursun.

**Yapılan düzeltme:** Created src/components/booking/BookingStatusBadge.tsx: short labels from common.bookingStatus.<STATUS> for all six statuses plus UNKNOWN, a distinct aria-hidden SVG icon per status, and the existing colour classes unchanged. It also exports bookingStatusKey() and BOOKING_STATUSES. The account page uses it. HostDashboard and the booking detail page still need to adopt it (see crossOwner). No bookingStatusHint keys were added, because the long sentences already live in booking.json.

## F608 — Misafirin birincil görevi olan rezervasyonlar sayfanın en altında, alt sayfa bağlantıları gömülü

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | Medium                                                                |
| Durum               | Aday                                                                  |
| Konum               | `src/app/account/page.tsx:249`                                        |
| Diğer konumlar      | `src/app/account/page.tsx:257`, `src/components/layout/Footer.tsx:64` |
| Kullanıcılar        | misafir                                                               |
| Prensip             | learnability · synthesizability                                       |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                          |
| Renk/tema           | Hayır                                                                 |
| Efor                | M                                                                     |
| Kaynak denetçiler   | area:account                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p007)                                       |

**Kanıt:** page.tsx:249-255 sırası: WalletPanel, IdentityVerification, PasskeyManager, AgentMandates ('Yapay zekâ ajanı ödeme yetkileri'). Rezervasyonlar ancak bunlardan sonra geliyor (271-357). Alt sayfa bağlantıları (257-269) ' · ' ile ayrılmış bir `<p>` içinde, nav değil. /account/privacy yalnızca Footer.tsx:64'te bağlı.

**Etki:** 360px ekrandaki misafir rezervasyonlarını bulmak için dört karmaşık paneli geçmek zorunda. Oturum yönetimi bağlantısını fark etmek zor. Ekran okuyucu ' · ' ayraçlarını okuyor.

**Önerilen aksiyon:** Rezervasyonlar ve favorileri profilin hemen altına alın ya da sekme veya çapa menüsü ekleyin. Bağlantıları h1'in altına `<nav aria-label="Hesap bölümleri"><ul>` olarak taşıyın: Oturumlar, Seyahatlerim, Çözüm merkezi, Gizlilik ve verilerim. AgentMandates gibi ileri düzey bölümleri 'Gelişmiş' başlığı altında daraltılabilir yapın.

**Yapılan düzeltme:** The ' · '-separated <p> of links is replaced by <nav aria-label="Hesap bölümleri"><ul> right under the h1. It covers Oturumlar, Seyahatlerim, Çözüm merkezi and Gizlilik ve verilerim, plus in-page anchors. Rezervasyonlar and Favoriler come first. AgentMandates sits in a <details> that starts collapsed, with the summary 'Gelişmiş: yapay zekâ ajanı ödeme yetkileri'.

## F609 — Hesap sayfasından 'Gizlilik ve verilerim'e bağlantı yok; yalnız altbilgide

| Alan                | Değer                                   |
| ------------------- | --------------------------------------- |
| Severity            | Medium                                  |
| Durum               | Aday                                    |
| Konum               | `src/app/account/page.tsx:257`          |
| Diğer konumlar      | `src/components/layout/Footer.tsx:63`   |
| Kullanıcılar        | tümü                                    |
| Prensip             | learnability · recognition / navigation |
| Sezgisel madde      | H6 — Tanıma > hatırlama                 |
| WCAG                | 3.2.3                                   |
| Renk/tema           | Hayır                                   |
| Efor                | S                                       |
| Kaynak denetçiler   | area:account2                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p007)         |

**Kanıt:** account/page.tsx:257-269 hesap bağlantıları: `/account/sessions`, `/trips`, `/resolution` — `/account/privacy` yok. Tek giriş Footer.tsx:63-68 `href="/account/privacy"` (text-xs). privacy.json:38 KVKK metni de bu sayfaya yönlendiriyor.

**Etki:** Verisini indirmek veya hesabını silmek isteyen kullanıcı 'Hesabım'da aradığı işlevi bulamıyor; mobilde uzun sayfanın en altındaki küçük altbilgi bağlantısını keşfetmesi zor.

**Önerilen aksiyon:** account/page.tsx:257 bağlantı satırına `<Link href="/account/privacy">{tPrivacy("accountPage.title")}</Link>` ekleyin; tercihen hesap sayfasında 'Gizlilik ve güvenlik' başlıklı bir bölümde Oturumlar ile birlikte gruplayın.

**Yapılan düzeltme:** The account section nav links to /account/privacy using the existing privacy.accountPage.title ('Gizlilik ve verilerim'). It sits next to Oturumlar and the security group anchor.

## F610 — Rezervasyon ve favori kartlarından ayrıntı ya da ilan sayfasına gidilemiyor

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | Medium                           |
| Durum               | Aday                             |
| Konum               | `src/app/account/page.tsx:285`   |
| Diğer konumlar      | `src/app/account/page.tsx:372`   |
| Kullanıcılar        | misafir                          |
| Prensip             | flexibility · task migratability |
| Sezgisel madde      | H7 — Esneklik/verim              |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | area:account                     |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p007) |

**Kanıt:** page.tsx:285-287 `<h3 className="text-lg font-semibold text-gray-900">{booking.property.title}</h3>` düz metin. Favori başlığı (372-374) da düz metin. Oysa src/app/booking/[id]/page.tsx ve src/app/property/[id]/page.tsx sayfaları mevcut.

**Etki:** Misafir fatura, mesajlar, depozito ya da ödeme gibi rezervasyon ayrıntılarına ulaşamıyor. Favori bir ilanı yeniden rezerve etmek için baştan arama yapması gerekiyor.

**Önerilen aksiyon:** Rezervasyon başlığını `<Link href={`/booking/${booking.id}`}>` ile, favori başlığını `<Link href={`/property/${favorite.propertyId}`}>` ile sarın. Kartlara ayrıca 'Ayrıntıları gör' bağlantısı ekleyin.

**Yapılan düzeltme:** Already fixed in the current code: booking titles link to /booking/{id}, favorite titles link to /property/{propertyId}, and every booking card has an 'Ayrıntılar ve mesajlar' link (sr-only title), plus 'Ödemeyi tamamla' for HELD bookings.

## F611 — Gizlilik ve verilerim sayfasının kendi <title>'ı yok

| Alan                | Değer                                |
| ------------------- | ------------------------------------ |
| Severity            | Medium                               |
| Durum               | Aday                                 |
| Konum               | `src/app/account/privacy/page.tsx:8` |
| Diğer konumlar      | `src/app/account/page.tsx:59`        |
| Kullanıcılar        | tümü                                 |
| Prensip             | accessibility · Page Titled          |
| Sezgisel madde      | H14 — Erişilebilirlik                |
| WCAG                | 2.4.2                                |
| Renk/tema           | Hayır                                |
| Efor                | S                                    |
| Kaynak denetçiler   | area:account2                        |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p009)     |

**Kanıt:** account/privacy/page.tsx:1 `"use client"` ve :8 `export default function AccountPrivacyPage()` — `generateMetadata`/`metadata` yok; başlık layout.tsx:16 genel `t("meta.title")` olarak kalıyor. Aynı durum src/app/account/page.tsx:1/59 (hesap sayfası; cüzdan, kimlik ve yetki kartlarının bulunduğu sayfa).

**Etki:** Ekran okuyucu ve çok sekmeli masaüstü kullanıcısı sekme/geçmişte 'Gizlilik ve verilerim' sayfasını ayırt edemiyor; sayfaya gelindiğinde başlık duyurusu bağlam vermiyor.

**Önerilen aksiyon:** Sayfayı sunucu bileşeni sarmalayıcıya bölün (page.tsx sunucu, içerik istemci bileşeni) ve `generateMetadata` ile `title: t("privacy.accountPage.title")` döndürün; aynı kalıbı /account için `account.title` ile uygulayın.

**Yapılan düzeltme:** Not a real problem in the current code. src/app/account/privacy/layout.tsx already exports generateMetadata returning titles.accountPrivacy ('Gizlilik ve verilerim'). src/app/account/layout.tsx does the same with titles.account. The client page inherits these titles.

## F612 — Aydınlatma metninde sayılan düzeltme/itiraz/bilgi talebi hakları için kanal yok

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | Medium                                                                       |
| Durum               | Aday                                                                         |
| Konum               | `src/app/privacy/page.tsx:93`                                                |
| Diğer konumlar      | `messages/tr/privacy.json:38`, `src/components/privacy/PrivacyCenter.tsx:59` |
| Kullanıcılar        | tümü                                                                         |
| Prensip             | robustness · task conformance                                                |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                                   |
| Renk/tema           | Hayır                                                                        |
| Efor                | M                                                                            |
| Kaynak denetçiler   | area:account2                                                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p031)                                       |

**Kanıt:** privacy/page.tsx:92-100 `t.rich("rights.body", ...)` → privacy.json:38 "öğrenme, bilgi talep etme, düzeltme, silme ve itiraz haklarına sahipsiniz. Verilerinizi indirmek veya hesabınızı silmek için <link>..." — PrivacyCenter.tsx yalnız dışa aktarma (:59-62) ve silme (:64-107) sunuyor; düzeltme/itiraz/bilgi talebi için form, e-posta veya destek bağlantısı yok; veri sorumlusu bölümünde (privacy.json:11) iletişim bilgisi yok.

**Etki:** Kullanıcı ad/e-posta düzeltme ya da analitik işlemeye itiraz gibi haklarını nasıl kullanacağını bulamıyor; metin ile sunulan işlevler uyuşmuyor.

**Önerilen aksiyon:** PrivacyCenter'a üçüncü kart ekleyin: 'Diğer talepler (düzeltme, itiraz, bilgi)' — /support'a önceden doldurulmuş kategoriyle bağlantı veya basit talep formu; profil düzeltmesi için ilgili ayar sayfasına bağlantı. Aydınlatma metninin 'Veri sorumlusu' bölümüne başvuru kanalını (e-posta/form) yazın.

**Yapılan düzeltme:** I added the request channel to the privacy notice. The controller section now has a paragraph (controller.contact) and the rights section has another (rights.requests). Both link to /support, where the 'İnsana bağlan' button opens a ticket with the human support team. The third card in PrivacyCenter belongs to another package, so I sent it as a crossOwner request.

## F613 — Yetki kuralları açıklanmıyor: tek kullanımlık, ödeme başına üst sınır, para birimi eşleşmesi zorunlu

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | Medium                                                         |
| Durum               | Aday                                                           |
| Konum               | `src/components/account/AgentMandates.tsx:115`                 |
| Diğer konumlar      | `messages/tr/account.json:105`, `messages/tr/account.json:106` |
| Kullanıcılar        | misafir                                                        |
| Prensip             | learnability · synthesizability / help                         |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                     |
| WCAG                | 3.3.2                                                          |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | area:account2                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p040)                                |

**Kanıt:** AgentMandates.tsx:115 `<p ...>{t("intro")}</p>` → account.json:105 "Yetki tutar, süre ve isteğe bağlı olarak ilanlarla sınırlıdır". Sunucu davranışı: nonce tek checkout oturumuna bağlanır (mandate.ts durableNonceStore.bind, ikinci kullanım MANDATE_REPLAYED), `charge.amountMinor > claims.maxAmountMinor` ödeme başına kontrol (:448), `MANDATE_CURRENCY_MISMATCH` (:443). 'Azami tutar' (account.json:106) toplam mı rezervasyon başına mı belirsiz; para birimi alanında (:129-137) ilanın para birimiyle eşleşmesi gerektiği söylenmiyor.

**Etki:** Misafir aynı yetkiyle birden fazla rezervasyon yaptırabileceğini veya EUR yetkisiyle TRY fiyatlı ilanı ödeyebileceğini sanıyor; ajan ödemeleri öngörülemez biçimde reddediliyor.

**Önerilen aksiyon:** Intro'nun altına 3 maddelik kural listesi ekleyin: "Her yetki tek bir rezervasyon ödemesinde kullanılabilir", "Tutar, o tek ödemenin üst sınırıdır", "Para birimi ilanın fiyat para birimiyle aynı olmalı". 'Azami tutar' etiketini "Rezervasyon başına en fazla tutar" yapın; para birimi alanına bu kuralı `hint` olarak verin.

**Yapılan düzeltme:** I added a 3-item rules list under a "Bilmeniz gerekenler" heading: single use, the amount is a cap per payment, and the currency must match the listing. The amount label is now "Rezervasyon başına en fazla tutar" and the currency field has a hint. When a selected listing is priced in a different currency, the currency field shows an inline error and submit focuses that field instead of sending.

## F614 — İlan kısıtı için kullanıcıdan ezbere ilan kimliği yazması isteniyor; geçersiz kimlik doğrulanmıyor

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | Medium                                                                         |
| Durum               | Aday                                                                           |
| Konum               | `src/components/account/AgentMandates.tsx:154`                                 |
| Diğer konumlar      | `messages/tr/account.json:116`, `src/components/account/AgentMandates.tsx:209` |
| Kullanıcılar        | misafir                                                                        |
| Prensip             | learnability · recognition over recall                                         |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                        |
| WCAG                | 3.3.2                                                                          |
| Renk/tema           | Hayır                                                                          |
| Efor                | M                                                                              |
| Kaynak denetçiler   | area:account2                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p040)                                                |

**Kanıt:** AgentMandates.tsx:153-154 `<Field id="mandate-properties" label={t("properties")} hint={t("propertiesHint")}><input id="mandate-properties" name="propertyIds" .../>` → account.json:116 "ilan kimliklerini virgülle ayırarak girin". Kimliklerin nereden bulunacağı söylenmiyor (yalnız /property/[id] URL'sinde var). Sunucu şeması (mandate.ts:106) `z.array(z.string().min(1).max(64)).min(1).max(20)` var olmayan kimliği reddetmiyor; 20 sınırı ipucunda yok, aşılırsa genel "Doğrulama hatası" dönüyor.

**Etki:** Misafir kimlikleri bulamıyor; yanlış/yazım hatalı kimlikle oluşan yetki hiçbir ilanda çalışmıyor (ajan ödemesi MANDATE_PROPERTY_MISMATCH ile düşüyor) ve kullanıcı nedenini göremiyor.

**Önerilen aksiyon:** Serbest metin yerine favoriler/son görüntülenen/sepetteki ilanlardan çoklu seçim (checkbox listesi veya combobox, `aria-multiselectable`) sunun; serbest giriş korunacaksa istemci tarafında kimlikleri GET ile doğrulayıp bilinmeyenleri alan hatası olarak gösterin ve ipucuna "En fazla 20 ilan; kimliği ilan sayfası adresinin sonunda bulabilirsiniz" ekleyin. Listede yalnız sayı yerine ilan adlarını gösterin (AgentMandates.tsx:209).

**Yapılan düzeltme:** Listings are now picked from favorites and bookings, and pasted links are validated against the listing API, so unknown IDs never reach the mandate. The hint states the limit of 20 and checkboxes are disabled once 20 are selected. The issued-permission list shows listing names (t("scopedTo") with Intl.ListFormat) instead of only a count, and falls back to the count when an ID is not in the known list.

## F615 — Tanıma yerine hatırlama: ham ilan kimliği ve 'Fotoğraf N' seçenekleri

| Alan                | Değer                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Severity            | Medium                                                             |
| Durum               | Aday                                                               |
| Konum               | `src/components/account/AgentMandates.tsx:154`                     |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx:83-84,218-230,301-310` |
| Kullanıcılar        | misafir, ev sahibi                                                 |
| Prensip             | learnability · familiarity, recognition over recall                |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                            |
| Renk/tema           | Hayır                                                              |
| Efor                | M                                                                  |
| Kaynak denetçiler   | lens:forms                                                         |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p040)                             |

**Kanıt:** src/components/account/AgentMandates.tsx:153-155 serbest metin; messages/tr/account.json `"propertiesHint": "…ilan kimliklerini virgülle ayırarak girin."` — kullanıcı arayüzde hiçbir yerde görmediği cuid'leri yazmak zorunda. src/components/host/AccessibilityPanel.tsx:83-84 `t("host.photoOption", { index })` → kanıt seçenekleri 'Fotoğraf 1, Fotoğraf 2…' (:225-228, :304-307), küçük resim yok.

**Etki:** Misafir ajan yetkisini ilanla sınırlayamaz (ya da yanlış kimlik girer → yetki boşa çıkar); ev sahibi hangi fotoğrafın rampa/kapı kanıtı olduğunu seçenek metninden anlayamaz.

**Önerilen aksiyon:** İlan kısıtı için favoriler/arama tabanlı çoklu seçim (başlık + şehir) bileşeni; kanıt seçimi için küçük resimli radyo ızgarası (img alt + 'Fotoğraf 3, yükleme tarihi').

**Yapılan düzeltme:** The AgentMandates part is fixed: users now choose listings by title and city instead of typing IDs from memory. The other half of the finding, the 'Fotoğraf N' evidence options in src/components/host/AccessibilityPanel.tsx, is not my file, so I handed it to that file's owner under crossOwner.

## F616 — Yetki vermeden önce özet/onay yok; neyin verileceği tek bakışta görülmüyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/account/AgentMandates.tsx:158` |
| Diğer konumlar      | `src/components/account/AgentMandates.tsx:83`  |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · predictability / feedforward    |
| Sezgisel madde      | H13 — Feedforward                              |
| WCAG                | 3.3.4                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:account2                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p040)                |

**Kanıt:** AgentMandates.tsx:157-161 `<Button type="submit" disabled={busy}>{busy ? t("creating") : t("create")}</Button>` — 'Yetki ver' doğrudan POST yapıyor; yeniden doğrulama (useReauth) yalnız sunucu 403 REAUTH_REQUIRED döndüğünde çıkıyor, yakın zamanda doğrulanmış oturumda hiçbir onay görülmüyor. Form başarıdan sonra sıfırlanmıyor (:83-85), aynı düğmeye tekrar basmak ikinci bir yetki üretiyor.

**Etki:** Para harcama yetkisi veren misafir, hangi tutar/süre/ilan kapsamıyla yetki verdiğini son kez görmeden onaylıyor; çift gönderimle gereksiz ikinci aktif yetki oluşabiliyor.

**Önerilen aksiyon:** Gönder düğmesinin hemen üstüne canlı özet ekleyin: "Ajanınız {süre} boyunca tek bir rezervasyon için en fazla {₺tutar} ödeyebilecek ({tüm ilanlar | N ilan})."; düğme metnini dinamik yapın ("₺1.500'e kadar yetki ver"); başarıdan sonra `e.currentTarget.reset()` ile formu temizleyin.

**Yapılan düzeltme:** I added a summary box right above the submit button, linked to it with aria-describedby: "Özet: Ajanınız {duration} boyunca tek bir rezervasyon için en fazla {amount} ödeyebilecek ({scope})." The button label now includes the amount ("En fazla {amount} için yetki ver"). After a successful grant the form resets amount, selected listings and duration, so pressing the button again cannot create a second permission.

## F617 — Tek seferlik yetki belgesi için odak taşınmıyor, sayfadan çıkış uyarısı yok, yeni yetki eskisini sessizce değiştiriyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/account/AgentMandates.tsx:163` |
| Diğer konumlar      | `messages/tr/account.json:119`                 |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · observability / error prevention  |
| Sezgisel madde      | H5 — Hata önleme                               |
| WCAG                | 2.4.3                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:account2                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p041)                |

**Kanıt:** AgentMandates.tsx:83-84 `setIssued(out.mandate); setStatus({ message: t("created") });` — odak 'Yetki ver' düğmesinde kalıyor; :163-185 belge kutusu formun altında beliriyor. Status mesajı yalnız "Yetki oluşturuldu." diyor, belgeyi şimdi kopyalamak gerektiğini söylemiyor. `beforeunload` koruması yok; ikinci yetki verildiğinde `issued` üzerine yazılıyor. 'Kaydettim/Kapat' eylemi yok.

**Etki:** Ekran okuyucu kullanıcısı belgenin nerede olduğunu bilmiyor; mobil kullanıcı kutuyu görmeden sayfadan ayrılıp belgeyi kaybedebiliyor; ikinci yetkide ilk belge geri getirilemez biçimde ekrandan kalkıyor.

**Önerilen aksiyon:** Belge kutusuna `ref` + `tabIndex={-1}` verip oluşturma sonrası `focus()` ve `scrollIntoView()` uygulayın; created mesajını "Yetki oluşturuldu. Aşağıdaki belgeyi şimdi kopyalayın; tekrar gösterilmeyecek." yapın; `issued` doluyken `beforeunload` uyarısı ekleyin; kutuya 'Belgeyi kaydettim, kapat' düğmesi koyun; yeni yetki öncesi kopyalanmamış belge varsa uyarın.

**Yapılan düzeltme:** Confirmed. When `issued` is set, an effect now moves focus to the token textarea, which selects its value, and scrolls it to the center of the view. The textarea is `aria-describedby` the one-time warning (#mandate-token-note). The `created` message now says to copy the document now because it won't be shown again. While the token is shown and not yet copied, a `beforeunload` warning is active (same pattern as TransferMarket). A 'Belgeyi kaydettim, kapat' button closes the box and returns focus to the submit button. Granting a new permission while an uncopied token is on screen first asks for confirmation through useConfirm.

## F618 — Kullanılmış yetki hâlâ 'Etkin' görünüyor ve iptal düğmesi sunuluyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/account/AgentMandates.tsx:199` |
| Diğer konumlar      | `messages/tr/account.json:131`                 |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · observability / predictability    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                 |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:account2                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p041)                |

**Kanıt:** AgentMandates.tsx:196-205 aynı satırda `{t(`status.${m.status}`)}` ("Etkin") ve `{m.used && <span ...>{t("used")}</span>}` ("Kullanıldı") birlikte çıkıyor; :212 `m.status === "active"` ise iptal düğmesi gösteriliyor. Sunucu listMandates (mandate.ts) used durumunu status'a yansıtmıyor; nonce bir checkout'a bağlandıktan sonra başka ödemede kullanılamıyor.

**Etki:** Misafir 'Etkin + Kullanıldı' rozetlerini çelişkili okuyor; ajanının yetkiyi tekrar kullanabileceğini sanıyor ya da gereksiz iptal yapıyor.

**Önerilen aksiyon:** used=true olan etkin yetki için tek birleşik durum gösterin: "Kullanıldı — yeni ödeme için geçerli değil"; iptal düğmesini yalnız `status === "active" && !m.used` iken gösterin ya da etiketini "Bağlı ödemeyi durdur" gibi gerçek etkisine göre değiştirin.

**Yapılan düzeltme:** Confirmed: the server returns status 'active' even after the nonce is bound (`used`). An active permission with used=true now shows one combined badge, 'Kullanıldı — yeni ödeme için geçerli değil' (reusing the existing used badge classes). The revoke button and the 'valid until' text are hidden for it. The separate 'Kullanıldı' badge now appears only on expired or revoked permissions.

## F619 — Hesap kartlarında tarih biçimleri tutarsız ve EN'de belirsiz (kısa sayısal biçim)

| Alan                | Değer                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                             |
| Durum               | Aday                                                                                                               |
| Konum               | `src/components/account/AgentMandates.tsx:208`                                                                     |
| Diğer konumlar      | `src/components/account/IdentityVerification.tsx:121`, `src/lib/i18n/format.ts:72`, `messages/tr/account.json:132` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                 |
| Prensip             | learnability · consistency                                                                                         |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                        |
| Renk/tema           | Hayır                                                                                                              |
| Efor                | S                                                                                                                  |
| Kaynak denetçiler   | area:account2                                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p041)                                                                                    |

**Kanıt:** AgentMandates.tsx:208 `t("validUntil", { date: f.dateTime(m.expiresAt) })` → format.ts:72 `dateStyle: "short"` (EN: "10/11/26, 2:30 PM"; ay/gün sırası ve 2 haneli yıl). IdentityVerification.tsx:121 `fmt.date(data.verifiedAt)` varsayılan "short" ("10/11/2026"). WalletPanel.tsx:114/129/156 `fmt.date(..., "long")`. TR metin account.json:132 "Geçerlilik: {date}" bitiş mi başlangıç mı belirtmiyor; süresi dolmuş yetkide de aynı metin.

**Etki:** EN arayüzü kullanan Türk misafir 10/11'i 10 Kasım olarak okuyup yetkinin bitişini yanlış anlıyor; aynı sayfada üç farklı tarih biçimi öğrenmeyi zorlaştırıyor.

**Önerilen aksiyon:** Hesap kartlarında tarihler için `"medium"` biçimini ("11 Eki 2026" / "Oct 11, 2026") ve saat gereken yerde `dateStyle: "medium"` kullanan bir dateTime varyantı kullanın; validUntil metnini aktifte "{date} tarihine kadar geçerli", süresi dolmuşta "{date} tarihinde sona erdi" olarak ayırın.

**Yapılan düzeltme:** Confirmed. Dates in the list and the revoke confirmation now use a local memoized `Intl.DateTimeFormat(f.locale, { dateStyle: "medium", timeStyle: "short" })`, since format.ts is not mine and `f.date` defaults to UTC. The end-date text is split by status: active shows validUntil ('{date} tarihine kadar geçerli'), expired shows expiredOn ('{date} tarihinde sona erdi'). The IdentityVerification date is listed in crossOwner.

## F620 — Demo doğrulama sonucu ekran okuyucuya duyurulmuyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Medium                                                |
| Durum               | Aday                                                  |
| Konum               | `src/components/account/IdentityVerification.tsx:80`  |
| Diğer konumlar      | `src/components/account/IdentityVerification.tsx:104` |
| Kullanıcılar        | misafir, ev sahibi                                    |
| Prensip             | accessibility · Status Messages                       |
| Sezgisel madde      | H12 — Feedback                                        |
| WCAG                | 4.1.3                                                 |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | area:account2                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p043)                       |

**Kanıt:** IdentityVerification.tsx:80 `await load();` — başarılı başlatmadan sonra yalnız rozet metni (:113-118, live region değil) değişiyor; `setInfo` çağrılmıyor. Ayrıca :104-108 `{info && (<p role="status">...)}` koşullu eklendiği için içerikle birlikte eklenen role=status bazı ekran okuyucularda okunmuyor.

**Etki:** Ekran okuyucu kullanıcısı 'Doğrulamayı başlat'a bastıktan sonra sonucun Doğrulandı mı, Ek bilgi gerekiyor mu olduğunu duymuyor; form kaybolduğu için (VERIFIED) sessizlik daha da kafa karıştırıcı.

**Önerilen aksiyon:** Bileşende her zaman DOM'da duran tek bir `<div aria-live="polite">` (ui.tsx `Status` bileşeni) kullanın; load() sonrası `setInfo(t("resultAnnounce", { status: t(`status.${fresh.status}`) }))` ile "Doğrulama sonucu: Doğrulandı" yazın.

**Yapılan düzeltme:** Confirmed: the old code never called setInfo after the mock start, and its role=status <p> was inserted conditionally. A role=status div now stays in the DOM, and after load() the mock start writes t('resultAnnounce', {status}) into it. The polling and refresh results are announced the same way.

## F621 — Stripe dönüşü ve 'İnceleniyor' durumunda yenileme/bilgi yok

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Aday                                                 |
| Konum               | `src/components/account/IdentityVerification.tsx:88` |
| Diğer konumlar      | `src/lib/trust/kyc.ts:408`                           |
| Kullanıcılar        | misafir, ev sahibi                                   |
| Prensip             | robustness · observability / responsiveness          |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                       |
| Renk/tema           | Hayır                                                |
| Efor                | M                                                    |
| Kaynak denetçiler   | area:account2                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p043)                      |

**Kanıt:** IdentityVerification.tsx:88 `const canStart = data && data.status !== "VERIFIED" && data.status !== "PENDING";` — PENDING'de hiçbir eylem veya açıklama yok; durum yalnız bileşen ilk yüklemede (:50-62) çekiliyor. Sağlayıcı dönüş adresi kyc.ts:408 `${appUrl()}/account?kyc=return` ama bileşen `kyc` sorgu parametresini okumuyor, kullanıcıyı karta kaydırmıyor veya 'sonuç işleniyor' demiyor.

**Etki:** Stripe'tan dönen kullanıcı uzun hesap sayfasının en üstüne düşüyor, doğrulamanın alınıp alınmadığını görmüyor; 'İnceleniyor' ne kadar sürer bilmiyor ve sonucu görmek için sayfayı elle yenilemesi gerekiyor.

**Önerilen aksiyon:** `useSearchParams().get("kyc") === "return"` ise kartı `scrollIntoView` + odak ile öne getirip `role="status"` ile "Doğrulama sonucunuz işleniyor; birkaç dakika sürebilir" gösterin; PENDING iken 10-15 sn aralıkla (en fazla birkaç dakika) `load()` ile yoklayın ve 'Durumu yenile' düğmesi ekleyin; PENDING için beklenen süreyi metinle yazın.

**Yapılan düzeltme:** Confirmed. On ?kyc=return (read from window.location in the initial fetch callback, so no useSearchParams Suspense requirement), the card heading is scrolled into view and focused, and returnPending or the result is announced. While PENDING the component polls every 15 s (at most 20 times, about 5 min), shows the expected-duration text and has a 'Durumu yenile' button (stillPending or the result is announced). In Stripe mode a PENDING session can be restarted with an explanation, because an abandoned Stripe session otherwise stays PENDING and was a dead end.

## F622 — Sağlayıcı ham hata/durum kodları çözüm önermeden gösteriliyor

| Alan                | Değer                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                      |
| Durum               | Aday                                                                                                                        |
| Konum               | `src/components/account/IdentityVerification.tsx:124`                                                                       |
| Diğer konumlar      | `messages/tr/trust.json:35`, `src/components/host/PayoutPanel.tsx:222`, `src/components/resolution/ClaimDetail.tsx:161-164` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                          |
| Prensip             | robustness · recoverability (hata mesajları)                                                                                |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                         |
| Renk/tema           | Hayır                                                                                                                       |
| Efor                | S                                                                                                                           |
| Kaynak denetçiler   | lens:copy                                                                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p043)                                                                                             |

**Kanıt:** IdentityVerification.tsx:123-124 `t("lastError", { code: data.lastError })` → trust.json:35 'Sağlayıcı kodu: {code}'; PayoutPanel.tsx:222 `{p.failureCode ? ` (${p.failureCode})` : ""}`; ClaimDetail.tsx:161-164 'Ödeme sağlayıcısı durumu: {status}' ham PSP durumu; AdminDashboard.tsx:168 outbox `{m.lastError}`.

**Etki:** Kimlik doğrulaması başarısız olan misafir/ev sahibi ve ödemesi başarısız ev sahibi ne yapması gerektiğini bilmez; destek yükü artar.

**Önerilen aksiyon:** Bilinen sağlayıcı kodlarını i18n'e eşleyin (ör. document_expired → 'Belgenizin süresi dolmuş. Geçerli bir belgeyle yeniden deneyin.'), bilinmeyende 'Doğrulama tamamlanamadı. Yeniden deneyin veya destekle iletişime geçin' + destek bağlantısı; ham kodu yalnız 'Ayrıntı' altında küçük gösterin.

**Yapılan düzeltme:** Fixed for IdentityVerification in the same way as F438: known codes map to i18n text with a solution, unknown codes show a generic 'try again or contact support' message plus a support link, and the raw code is only a small detail line. The PayoutPanel, ClaimDetail and AdminDashboard parts of the evidence are in files other packages own.

## F623 — Form alanı kenarlıkları 3:1 bileşen kontrastını sağlamıyor

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | Medium                                                                      |
| Durum               | Aday                                                                        |
| Konum               | `src/components/account/IdentityVerification.tsx:140`                       |
| Diğer konumlar      | `src/components/ui/ui.tsx:21`, `src/components/account/ReauthDialog.tsx:99` |
| Kullanıcılar        | tümü                                                                        |
| Prensip             | accessibility · Non-text Contrast                                           |
| Sezgisel madde      | H14 — Erişilebilirlik                                                       |
| WCAG                | 1.4.11                                                                      |
| Renk/tema           | Evet — kapsam dışı                                                          |
| Efor                | S                                                                           |
| Kaynak denetçiler   | area:account2                                                               |
| **Düzeltme durumu** | **Kapsam dışı (renk/tema)**                                                 |

**Kanıt:** IdentityVerification.tsx:140 `border border-gray-300` (#d1d5db / beyaz ≈ 1.47:1); ui.tsx:21 `inputClass` `border-gray-400` (#9ca3af / beyaz ≈ 2.54:1) — AgentMandates tutar/para birimi/süre/ilan alanları; ReauthDialog.tsx:99 parola alanı `border-gray-300`.

**Etki:** Az gören kullanıcılar ve parlak ortamda mobil kullanan misafirler giriş alanının sınırlarını seçemiyor; boş alanın varlığı fark edilmiyor.

**Önerilen aksiyon:** Kenarlık tonunu en az gray-500 düzeyine çekmek renk/tema değişikliği gerektirir (kapsam dışı işaretli). Renk değişmeden ara çözüm: alanlara `border-2` ile kalınlık veya iç gölge eklemek kontrastı değiştirmez; bu nedenle kalıcı çözüm tema ekibinin kararıdır.

## F624 — Kimlik doğrulama ve yetki verme, doğrulanmamış e-postada çıkmaz sokağa giriyor

| Alan                | Değer                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                       |
| Durum               | Aday                                                                                                                                         |
| Konum               | `src/components/account/IdentityVerification.tsx:150`                                                                                        |
| Diğer konumlar      | `src/components/account/AgentMandates.tsx:158`, `src/app/api/account/identity/route.ts:21`, `src/app/api/account/agent-mandates/route.ts:31` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                           |
| Prensip             | robustness · error prevention / recoverability                                                                                               |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                             |
| WCAG                | 3.3.3                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                        |
| Efor                | M                                                                                                                                            |
| Kaynak denetçiler   | area:account2                                                                                                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p043)                                                                                                              |

**Kanıt:** src/app/api/account/identity/route.ts POST `requireVerifiedEmail(req)` ve src/app/api/account/agent-mandates/route.ts POST `requireVerifiedEmail(req)` → 403 EMAIL_NOT_VERIFIED, mesaj errors.ts:42. IdentityVerification.tsx:150-156 ve AgentMandates.tsx:158 düğmeleri e-posta durumu bilinmeden etkin; hata yalnız metin olarak gösteriliyor. Projede /api/auth/verify-email/resend mevcut ama hiçbir yerden önerilmiyor.

**Etki:** Misafir test belgesini seçip veya formu doldurup (AgentMandates'te parolayı da girip) sonunda yalnız 'e-postanızı doğrulayın' metniyle karşılaşıyor; doğrulama e-postasını yeniden almak için bir yol görmüyor.

**Önerilen aksiyon:** `err.code === "EMAIL_NOT_VERIFIED"` için hata yanında 'Doğrulama e-postasını yeniden gönder' düğmesi (POST /api/auth/verify-email/resend) ve sonuç mesajı gösterin; tercihen /api/user/me'den e-posta doğrulama durumunu okuyup bu iki kartın başında önden uyarı gösterin.

**Yapılan düzeltme:** Confirmed: POST requires a verified email. On ApiError code EMAIL_NOT_VERIFIED, the translated error now comes with a 'resend verification email' button (POST /api/auth/verify-email/resend, Button busy guard) and a persistent role=status result. It reuses auth.verify.resend/resending/resendFailed/loginToResend and adds kyc.emailSent and kyc.emailAlreadyVerified. The suggested up-front warning was not added, because /api/user/me does not expose email verification status.

## F625 — Gerçek sağlayıcı modunda 'Doğrulamayı başlat' dış siteye gideceğini ve neye ihtiyaç olduğunu söylemiyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Medium                                                |
| Durum               | Aday                                                  |
| Konum               | `src/components/account/IdentityVerification.tsx:155` |
| Diğer konumlar      | `messages/tr/trust.json:36`                           |
| Kullanıcılar        | misafir, ev sahibi                                    |
| Prensip             | learnability · predictability / feedforward           |
| Sezgisel madde      | H13 — Feedforward                                     |
| WCAG                | 3.2.5                                                 |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | area:account2                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p043)                       |

**Kanıt:** IdentityVerification.tsx:130-149 açıklama yalnız `data.provider === "mock"` için (mockNotice); Stripe modunda :155 `t("start")` ("Doğrulamayı başlat") tıklanınca :77 `window.location.assign(res.redirectUrl)` ile sağlayıcı sayfasına gidiliyor. Kamera, kimlik belgesi gereksinimi ve günlük deneme sınırı (kyc.ts KYC_MAX_STARTS_PER_DAY) hiçbir yerde anlatılmıyor.

**Etki:** Mobil misafir, belgesi yanında değilken başlatıp yarıda bırakıyor ve günlük deneme hakkını tüketiyor; beklenmedik site değişimi güvensizlik (oltalama şüphesi) yaratıyor.

**Önerilen aksiyon:** Stripe modunda düğmenin üstüne: "Güvenli doğrulama sağlayıcısının sayfasına yönlendirileceksiniz. Geçerli kimlik belgeniz ve kameralı bir cihaz gerekir. Günde en fazla N deneme hakkınız var." metnini ekleyin; düğme metnini "Doğrulamaya devam et (sağlayıcı sayfası)" yapın.

**Yapılan düzeltme:** In Stripe mode a role=note box above the button now says you will go to the provider's (Stripe) page and return here, and that you need a valid ID document and a device with a camera. It also states the daily attempt limit: data.maxStartsPerDay when the API sends it, otherwise generic wording. The button text is now 'Doğrulamaya devam et (sağlayıcı sayfası)'.

## F626 — Onay pencereleri hangi öğenin etkileneceğini ve sonucunu söylemiyor (yerel window.confirm)

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Aday                                                                          |
| Konum               | `src/components/account/PasskeyManager.tsx:87`                                |
| Diğer konumlar      | `src/components/account/SessionManager.tsx:71`, `messages/tr/account.json:97` |
| Kullanıcılar        | tümü                                                                          |
| Prensip             | robustness · recoverability (hata önleme)                                     |
| Sezgisel madde      | H5 — Hata önleme                                                              |
| Renk/tema           | Hayır                                                                         |
| Efor                | M                                                                             |
| Kaynak denetçiler   | area:account                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p044)                                               |

**Kanıt:** PasskeyManager.tsx:87 `window.confirm(t("passkeys.confirmDelete"))` yalnızca 'Bu passkey silinsin mi?' diyor (account.json:61). Passkey adı da sonucu da yok: son passkey silinirse parolasız giriş kaybolur ve ödemede passkey doğrulaması yerine 3DS'e düşülür. SessionManager.tsx:71 `window.confirm(confirmText)` 'Bu oturum kapatılsın mı?' diyor (account.json:97), cihaz adı yok. Ayrıca tarayıcı 'ek iletişim kutularını engelle' ayarıyla confirm'ü sessizce false döndürebiliyor.

**Etki:** Birkaç passkey'i ya da oturumu olan kullanıcı yanlış öğeyi silebiliyor. Engellenmiş confirm durumunda düğme hiçbir şey yapmıyormuş gibi görünüyor.

**Önerilen aksiyon:** Onay metnine adı ve sonucu ekleyin: '“{name}” passkey'i silinsin mi? Bu cihazla parolasız giriş yapamayacaksınız.' Son passkey için ayrıca uyarın. window.confirm yerine uygulama içi role="alertdialog" kullanın; ReauthDialog'un kabuğu yeniden kullanılabilir.

**Yapılan düzeltme:** Confirmed the problem: the code used window.confirm with a generic text. Replaced it with useConfirm (a native <dialog>, danger tone, 'Passkey'i sil' confirm label). The title names the passkey (“{name}” silinsin mi?), and the body gives the date added and what deleting it means. When it is the last passkey, an extra paragraph warns that passwordless sign-in turns off and risky payments fall back to 3D Secure. SessionManager was already migrated by its owner.

## F627 — Tekrarlanan eylem düğmeleri hangi öğeye ait olduğunu söylemiyor ('Sil', 'Şikâyet et', 'Mesajlar', 'Kabul et')

| Alan                | Değer                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                    |
| Durum               | Aday                                                                                                                                                                                      |
| Konum               | `src/components/account/PasskeyManager.tsx:138`                                                                                                                                           |
| Diğer konumlar      | `src/components/property/ReviewsSection.tsx:94`, `src/components/host/HostDashboard.tsx:175`, `src/components/host/RevenueDashboard.tsx:209`, `src/components/cart/SplitPayPanel.tsx:235` |
| Kullanıcılar        | tümü                                                                                                                                                                                      |
| Prensip             | accessibility · WCAG 2.4.6 Headings and Labels                                                                                                                                            |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                     |
| WCAG                | 2.4.6                                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                                     |
| Efor                | S                                                                                                                                                                                         |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p044)                                                                                                                                                           |

**Kanıt:** PasskeyManager.tsx:138 her satırda 'Sil'; ReviewsSection.tsx:94 her yorumda 'Şikâyet et'; HostDashboard.tsx:175 her satırda 'Mesajlar' bağlantısı; RevenueDashboard.tsx:209 her öneride 'Kabul et'/'Reddet'; SplitPayPanel.tsx:235 `aria-label={t("removeParticipant")}` katılımcı numarasız. Buna karşın AgentMandates revokeLabel, cart item.removeLabel ve PromotionsPanel.tsx:212-213 sr-only ad ekleyerek doğru yapıyor.

**Etki:** Ekran okuyucu bağlantı/düğme listesinde aynı adlardan oluşan bir liste duyar; yanlış passkey'i silme veya yanlış öneriyi kabul etme riski.

**Önerilen aksiyon:** İlgili öğeyi ada ekleyin: 'Sil: {passkey adı}', '{yazar} yorumunu şikâyet et', '{mülk} {tarih} mesajları', '{oda} {tarih} önerisini kabul et', 'Katılımcı {n}'i kaldır' — ICU parametreli anahtarlar veya sr-only span ile.

**Yapılan düzeltme:** Confirmed: every row's button was just 'Sil'. Each delete button now has aria-label passkeys.deleteLabel, 'Sil: {name}, eklendi {date}'. It starts with the visible word, so label-in-name holds, and the date also tells unnamed passkeys apart. The other files listed in the finding belong to other packages.

## F628 — Yeniden doğrulama hataları nasıl düzeltileceğini söylemiyor (bekleme süresi, ağ hatası)

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Aday                                         |
| Konum               | `src/components/account/ReauthDialog.tsx:58` |
| Kullanıcılar        | tümü                                         |
| Prensip             | robustness · recoverability                  |
| Sezgisel madde      | H9 — Hata mesajları                          |
| WCAG                | 3.3.3                                        |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:account                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p045)              |

**Kanıt:** ReauthDialog.tsx:58-62 `err.code === "REAUTH_RATE_LIMITED" ? t("rateLimited") : passkeyErrorMessage(err, t("failed"))`. Sunucunun gönderdiği details.retryAfterSeconds (recent-auth.ts:37-40) kullanılmıyor, account.json:79 yalnızca 'daha sonra tekrar deneyin' diyor. Durum kodu olmayan ağ hatası passkey-client.ts:89 üzerinden 'Doğrulama başarısız' mesajına düşüyor. Kalan deneme hakkı (REAUTH_MAX_ATTEMPTS=5, app-config.ts:527) gösterilmiyor.

**Etki:** Kilitlenen kullanıcı ne kadar bekleyeceğini bilmeden denemeye devam ediyor. Çevrimdışı kullanıcı parolasını yanlış girdiğini sanıp gereksiz yere parola sıfırlamaya gidebiliyor.

**Önerilen aksiyon:** rateLimited metnini '{minutes} dakika sonra tekrar deneyin' olarak details.retryAfterSeconds ile doldurun. Ağ hatası için 'Bağlantı kurulamadı, internetinizi kontrol edin' gösterin. Yanlış parola için 'Parola hatalı' mesajının yanına /forgot-password bağlantısı koyun.

**Yapılan düzeltme:** Confirmed: REAUTH_RATE_LIMITED showed the generic 'try again later' text and ignored details.retryAfterSeconds. It now shows the new account.reauth.rateLimitedFor text, '{minutes} dakika sonra tekrar deneyin', with the minutes rounded up from retryAfterSeconds; if that value is missing it falls back to rateLimited. A wrong password or a lockout now also shows a 'Şifremi unuttum' link to /forgot-password, reusing auth.login.forgotPassword. Network errors were already handled: useAccountErrorText maps TypeError to common.errors.network. Remaining attempts are still not shown because the server does not send that count.

## F629 — Modal diyaloglar kısa ekranda ve klavye açıkken taşıyor, kaydırılamıyor

| Alan                | Değer                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                     |
| Durum               | Aday                                                                                       |
| Konum               | `src/components/account/ReauthDialog.tsx:68`                                               |
| Diğer konumlar      | `src/components/booking/StepUpDialog.tsx:50`, `src/components/account/ReauthDialog.tsx:43` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                  |
| Prensip             | accessibility · WCAG 1.4.10 Reflow                                                         |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                      |
| WCAG                | 1.4.10                                                                                     |
| Renk/tema           | Hayır                                                                                      |
| Efor                | S                                                                                          |
| Kaynak denetçiler   | lens:mobile                                                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p045)                                                            |

**Kanıt:** ReauthDialog.tsx:68 ve StepUpDialog.tsx:50 `fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4` kullanıyor; panellerde (:69-75 ve :51-57) `max-h` ya da `overflow-y-auto` yok. ReauthDialog açılışta (:43) parola alanına odaklanıyor, bu da mobil klavyeyi açıyor. Gövde kaydırması kilitlenmiyor.

**Etki:** Yatay telefonda (~375px yükseklik) ya da klavye açıkken 'Doğrula' ve 'İptal' düğmeleri görünür alanın dışında kalıyor ve panel kaydırılamıyor; arkadaki sayfa kayıyor. Hassas işlemler (oturum kapatma, hesap silme, ödeme step-up) yarıda kalıyor.

**Önerilen aksiyon:** Panele `max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain` ekle. Mobilde alt sayfa düzenine geç (`items-end sm:items-center`, `rounded-t-xl`). Diyalog açıkken `document.body.style.overflow="hidden"` uygula. z-index'i `z-[60]` yap (bkz. sabit bant bulgusu).

**Yapılan düzeltme:** The panel is already a native <dialog> with showModal, which uses the top layer, so a z-index change is not needed. Added max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain so the dialog scrolls on short screens and when the keyboard is open. Background scroll is now locked: the open effect sets body overflow to hidden and restores the old value on close. The password input uses text-base sm:text-sm so iOS does not zoom on focus. I skipped the bottom-sheet layout. StepUpDialog needs the same change (see crossOwner).

## F630 — Hesabında passkey olmayan kullanıcıya da 'Passkey ile doğrula' seçeneği gösteriliyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/account/ReauthDialog.tsx:114` |
| Kullanıcılar        | tümü                                          |
| Prensip             | learnability · predictability                 |
| Sezgisel madde      | H13 — Feedforward                             |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:account                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p045)               |

**Kanıt:** ReauthDialog.tsx:114-121 `{supported && (<button ... onClick={() => void attempt(reauthWithPasskey)}>` yalnızca tarayıcı desteğini kontrol ediyor. Sunucu passkey.ts:255-260'ta 'Hesapta kayıtlı passkey yok' hatası fırlatıyor. Pencere tam da hiç passkey'i olmayan kullanıcı ilk passkey'ini eklerken açılıyor (PasskeyManager.tsx:75). Açıklama metni de 'parolanızı ya da passkey'inizi' diyor (account.json:72).

**Etki:** Kullanıcı işe yaramayacak bir yolu deniyor, bir hata alıyor ve deneme hakkı tüketebiliyor. Yalnızca parolayla doğrulayabileceğini öğrenmesi gecikiyor.

**Önerilen aksiyon:** useReauth ve ReauthDialog'a `hasPasskey` bilgisi geçirin. PasskeyManager liste uzunluğundan bilir, diğerleri REAUTH_REQUIRED yanıtının details alanında `methods` döndürebilir. Passkey yoksa düğmeyi gizleyin ve açıklamayı 'parolanızı girin' olarak değiştirin.

**Yapılan düzeltme:** Confirmed: the passkey button only checked browser support. ReauthDialog gets an optional hasPasskey prop and useReauth an optional options arg ({ hasPasskey }); both are backward compatible. If hasPasskey is not passed, the dialog calls GET /api/account/passkeys (requireAuth only) when it opens. The passkey button only appears once a registered passkey is known, and if that request fails it falls back to showing the button as before. The description switches to the new descriptionPasswordOnly text when there is no passkey path.

## F631 — Listeden öğe kaldırılınca klavye odağı kayboluyor

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | Medium                                                                         |
| Durum               | Aday                                                                           |
| Konum               | `src/components/account/SessionManager.tsx:82`                                 |
| Diğer konumlar      | `src/components/account/PasskeyManager.tsx:95`, `src/app/account/page.tsx:121` |
| Kullanıcılar        | tümü                                                                           |
| Prensip             | accessibility · Focus Order                                                    |
| Sezgisel madde      | H14 — Erişilebilirlik                                                          |
| WCAG                | 2.4.3                                                                          |
| Renk/tema           | Hayır                                                                          |
| Efor                | S                                                                              |
| Kaynak denetçiler   | area:account                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p046)                                                |

**Kanıt:** SessionManager.tsx:81-82 `setStatus(...); await load();` çağrısı odaktaki 'Oturumu kapat' düğmesinin bulunduğu satırı (129-142) DOM'dan kaldırıyor. PasskeyManager.tsx:94-95 silmeden sonra aynısını yapıyor. page.tsx:121 `setFavorites(prev => prev.filter(...))` odaktaki 'Kaldır' düğmesini (397-405) kaldırıyor. Hiçbir yerde odak programla taşınmıyor.

**Etki:** Klavye ve ekran okuyucu kullanıcısının odağı <body>'ye düşüyor. Kullanıcı nerede olduğunu bilemiyor ve sayfanın başından yeniden gezinmek zorunda kalıyor.

**Önerilen aksiyon:** Kaldırmadan sonra odağı tabIndex={-1} verilmiş durum mesajına, sonraki öğenin eylem düğmesine ya da liste yoksa bölüm başlığına taşıyın.

**Yapılan düzeltme:** Confirmed: after a revoke, load() removed the focused row. A pendingFocus ref now records the removed row's index. After the list reloads, an effect moves focus to the next row's button, else the previous one, else the h2 (now tabIndex=-1). For 'others' it goes to the h2, and after a successful retry too. Focus is moved only if it fell to <body>, so it is never taken from somewhere else.

## F632 — Başarı mesajları sonradan eklenen role=status öğesiyle veriliyor, ekran okuyucu kaçırabilir

| Alan                | Değer                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Severity            | Medium                                                                          |
| Durum               | Aday                                                                            |
| Konum               | `src/components/account/SessionManager.tsx:97`                                  |
| Diğer konumlar      | `src/components/account/PasskeyManager.tsx:109`, `src/components/ui/ui.tsx:144` |
| Kullanıcılar        | tümü                                                                            |
| Prensip             | accessibility · Status Messages                                                 |
| Sezgisel madde      | H12 — Feedback                                                                  |
| WCAG                | 4.1.3                                                                           |
| Renk/tema           | Hayır                                                                           |
| Efor                | S                                                                               |
| Kaynak denetçiler   | area:account                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p046)                                                 |

**Kanıt:** SessionManager.tsx:97-104 `{status && (<p role={status.kind === "error" ? "alert" : "status"} ...>`: canlı bölge, içeriğiyle birlikte koşullu olarak DOM'a ekleniyor ve rolü alert ile status arasında değişiyor. PasskeyManager.tsx:109-116'da da aynısı var. Projenin kendi Status bileşeni (ui.tsx:144-155) ise sürekli bağlı bir aria-live konteyner kullanıyor.

**Etki:** NVDA ya da JAWS kullanıcısı 'Oturum kapatıldı' veya 'Passkey eklendi' mesajlarını duymayabilir ve işlemin başarılı olduğunu bilemez.

**Önerilen aksiyon:** ui.tsx'teki Status bileşenini kullanın ya da her zaman DOM'da duran bir `<div aria-live="polite" aria-atomic="true">` içinde yalnızca metni güncelleyin.

**Yapılan düzeltme:** Confirmed: a conditional <p role=alert\|status> was used. It is replaced by ui.tsx's Status component: success text goes to an always-mounted role=status region, and errors go to role=alert with icon and prefix.

## F633 — Liste yüklenemediğinde 'Yükleniyor…' yazısı hiç kaybolmuyor ve yeniden deneme yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/account/SessionManager.tsx:105` |
| Diğer konumlar      | `src/components/account/PasskeyManager.tsx:117` |
| Kullanıcılar        | tümü                                            |
| Prensip             | robustness · recoverability                     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:account                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p046)                 |

**Kanıt:** SessionManager.tsx:60-63 hata durumunda yalnızca setStatus çağrılıyor ve sessions null kalıyor. Bu yüzden 105-106 `sessions === null ? <p>{t("loading")}</p>` hata uyarısıyla aynı anda görünüyor. PasskeyManager.tsx:61-63 ve 117-118'de de aynısı oluyor.

**Etki:** Kullanıcı aynı anda hem 'Oturumlar yükleniyor…' hem 'Oturumlar yüklenemedi' görüyor. Sayfayı yenilemekten başka çıkar yol yok.

**Önerilen aksiyon:** Ayrı bir loadError state'i tutun. Hata varsa yükleniyor metnini gizleyin, hata mesajıyla birlikte load() çağıran bir 'Tekrar dene' düğmesi gösterin.

**Yapılan düzeltme:** Confirmed: 'Yükleniyor…' and the error showed together, with no retry. There is now a separate loadError state. While it is set, the loading text is hidden and a Status error is shown with a 'Tekrar Dene' Button (reuses account.retry; busy while reloading) that calls load(). A successful load clears the error. A 401 during a retry also redirects to loginHref().

## F634 — Oturum kapatma ve passkey ekleme/silme sürerken düğme metni değişmiyor

| Alan                | Değer                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                            |
| Durum               | Aday                                                                                                                                              |
| Konum               | `src/components/account/SessionManager.tsx:141`                                                                                                   |
| Diğer konumlar      | `src/components/account/PasskeyManager.tsx:162`, `src/components/account/PasskeyManager.tsx:138`, `src/components/account/SessionManager.tsx:154` |
| Kullanıcılar        | tümü                                                                                                                                              |
| Prensip             | robustness · observability                                                                                                                        |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                             |
| Efor                | S                                                                                                                                                 |
| Kaynak denetçiler   | area:account                                                                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p046)                                                                                                                   |

**Kanıt:** SessionManager.tsx:138-141 `disabled={busy}` ile `{t("revoke")}`, 151-154 'Diğer tüm oturumları kapat'. PasskeyManager.tsx:157-162 'Passkey ekle' etiketi ağ isteği ve işletim sistemi istemi boyunca değişmiyor. 135-138 'Sil' de öyle. Buna karşılık hesap sayfası `cancelling` ve `removing` metinlerini kullanıyor (page.tsx:332-334, 402-404).

**Etki:** Yavaş ağda kullanıcı yalnızca soluklaşan düğmeleri görüyor. Hangi işlemin sürdüğünü ve passkey eklerken cihaz istemini beklemesi gerektiğini anlamıyor.

**Önerilen aksiyon:** sessions.revoking 'Kapatılıyor…', passkeys.adding 'Passkey oluşturuluyor… cihazınızdaki istemi onaylayın' ve passkeys.deleting 'Siliniyor…' anahtarlarını ekleyin. Metni yalnızca tetiklenen düğmede gösterin ve bölüme aria-busy verin.

**Yapılan düzeltme:** Confirmed. busy is replaced by revoking (session id, or OTHERS). Only the triggered button changes its text to sessions.revoking 'Kapatılıyor…' / 'Signing out…' and gets aria-busy; its aria-label is dropped while busy so the visible text is its name. The list <ul> gets aria-busy while an action runs. Buttons stay busy until the list has reloaded, and for this-device logout until navigation.

## F635 — Tekrarlanan eylem düğmeleri hangi öğeye ait olduklarını söylemiyor

| Alan                | Değer                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                         |
| Durum               | Aday                                                                                                                                           |
| Konum               | `src/components/account/SessionManager.tsx:141`                                                                                                |
| Diğer konumlar      | `src/components/account/PasskeyManager.tsx:138`, `src/app/account/page.tsx:334`, `src/app/account/page.tsx:404`, `messages/en/account.json:95` |
| Kullanıcılar        | tümü                                                                                                                                           |
| Prensip             | accessibility · Headings and Labels                                                                                                            |
| Sezgisel madde      | H13 — Feedforward                                                                                                                              |
| WCAG                | 2.4.6                                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                          |
| Efor                | S                                                                                                                                              |
| Kaynak denetçiler   | area:account                                                                                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p046)                                                                                                                |

**Kanıt:** SessionManager.tsx:141 her satırda 'Oturumu kapat' yazıyor. Bu, sizi çıkış yaptıran mevcut cihaz satırında da aynı. EN'de en/account.json:95 'Sign out', hesap çıkışı da 'Sign Out' (en:3). PasskeyManager.tsx:138 'Sil', page.tsx:334 'Rezervasyonu İptal Et', 404 'Kaldır', 349-350 'Favorilere Ekle'. Projede örnek desen hazır: account.json:135 mandates.revokeLabel '{amount} limitli yetkiyi iptal et'.

**Etki:** Düğmeler arasında gezinen ekran okuyucu kullanıcısı art arda 'Oturumu kapat, Oturumu kapat…' duyuyor. EN kullanıcısı kendi oturumundan mı yoksa uzaktaki bir oturumdan mı çıktığını ayırt edemiyor.

**Önerilen aksiyon:** aria-label ile nesneyi belirtin: sessions.revokeLabel '{device} oturumunu kapat', passkeys.deleteLabel '“{name}” passkey'ini sil', bookings.cancelLabel '{property} rezervasyonunu iptal et', favorites.removeLabel. Mevcut cihaz satırında görünür etiket 'Bu cihazda çıkış yap' olsun. EN revoke etiketi 'Sign out this session' olsun.

**Yapılan düzeltme:** Confirmed: every row button was 'Oturumu kapat'. Non-current rows now have aria-label revokeLabel, which starts with the visible text (label-in-name) and adds the device and last-seen date. The current row's visible text is revokeCurrent 'Bu cihazda çıkış yap' / 'Sign out on this device'. EN revoke changes from 'Sign out' to 'Sign out session'; the key is used only in SessionManager.

## F636 — Yükleme hatalarında 'Tekrar dene' yolu yok (cüzdan, kimlik durumu, yetki listesi)

| Alan                | Değer                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                               |
| Durum               | Aday                                                                                                 |
| Konum               | `src/components/account/WalletPanel.tsx:79`                                                          |
| Diğer konumlar      | `src/components/account/IdentityVerification.tsx:99`, `src/components/account/AgentMandates.tsx:186` |
| Kullanıcılar        | misafir, ev sahibi                                                                                   |
| Prensip             | robustness · recoverability                                                                          |
| Sezgisel madde      | H9 — Hata mesajları                                                                                  |
| Renk/tema           | Hayır                                                                                                |
| Efor                | S                                                                                                    |
| Kaynak denetçiler   | area:account2                                                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p052)                                                                      |

**Kanıt:** WalletPanel.tsx:79-83 `{error && (<p role="alert" ...>{t("loadFailed")}</p>)}` — yeniden deneme yok, useEffect (:59-67) tek sefer çalışıyor. IdentityVerification.tsx:99-103 aynı; AgentMandates.tsx:186 `<Status error={status.error ?? list.error} .../>` list.reload var ama kullanıcıya düğme sunulmuyor; ayrıca list.error doluyken yeni bir başarı mesajı (`!error && message`, ui.tsx:152) bastırılıyor.

**Etki:** Yavaş/kesintili mobil ağdaki misafir bakiyesini, doğrulama durumunu veya yetkilerini görmek için tüm hesap sayfasını yenilemek zorunda; sayfa yenilemesi diğer kartların form durumunu da siliyor.

**Önerilen aksiyon:** Her hata paragrafının yanına `<Button variant="secondary" onClick={reload}>{t("retry")}</Button>` ekleyin (WalletPanel'de fetch'i `useLoader`'a taşıyın; IdentityVerification'da `load()`'u çağırın; AgentMandates'te `list.reload`). AgentMandates'te liste hatasını form Status'undan ayırıp liste başlığının altına taşıyın.

**Yapılan düzeltme:** Confirmed: the old useEffect ran only once and the error paragraph had no retry. WalletPanel now refetches through an attempt counter and shows a secondary Button with the existing common errorPage.retry text next to the alert. The button uses busy so it keeps focus during the retry. The alert remounts on each new failure so it is announced again. After a successful retry, focus moves to the wallet h2 (tabIndex -1). The IdentityVerification and AgentMandates parts are handed off in crossOwner.

## F637 — Cüzdanda kredinin nerede/nasıl kullanılacağı ve bekleyen tutarlar gösterilmiyor

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | Medium                                                     |
| Durum               | Aday                                                       |
| Konum               | `src/components/account/WalletPanel.tsx:102`               |
| Diğer konumlar      | `messages/tr/wallet.json:19`, `messages/tr/wallet.json:33` |
| Kullanıcılar        | misafir                                                    |
| Prensip             | learnability · synthesizability / help                     |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                 |
| Renk/tema           | Hayır                                                      |
| Efor                | M                                                          |
| Kaynak denetçiler   | area:account2                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p052)                     |

**Kanıt:** WalletPanel.tsx:101-121 yalnız bakiye ve 'En yakın son kullanma: {date}' (o tarihte ne kadarının yanacağı yok); :123-133 bekleyen cashback `t("pending.item", { date, rate })` → wallet.json:33 "{date} tarihinde krediye dönüşür (%{rate}); iade/talep penceresi bekleniyor." — tutar ve hangi rezervasyon olduğu (bookingId mevcut) yok. Kredinin ödeme adımında 'Kredimi kullan' ile uygulandığı (wallet.json:37) cüzdan kartında hiç söylenmiyor.

**Etki:** Misafir kredisini nasıl harcayacağını bilmiyor, birden fazla rezervasyonda hangi cashback'in hangisine ait olduğunu ve ne kadar geleceğini göremiyor; 'iade/talep penceresi' jargonu anlamı bulanıklaştırıyor.

**Önerilen aksiyon:** Bakiye altına "Kredinizi ödeme adımında 'Kredimi kullan' ile harcayabilirsiniz" yardım satırı ekleyin; nextExpiry'yi "{tutar} kredinin süresi {date} tarihinde doluyor" yapın (sunucu `nextExpiryMinor` döndürsün); bekleyen öğede ilan adı + tahmini tutar (`estimatedMinor`) ve rezervasyon bağlantısı gösterin; "iade/talep penceresi" yerine "iptal/şikâyet süresi bitince" yazın.

**Yapılan düzeltme:** Added a help line under the balance that interpolates checkout.use, so it stays consistent with p006's renaming. The expiry line now reads '{date} tarihinde {amount} tutarın süresi doluyor'; the amount comes from the server's nextExpiryMinor if sent, otherwise it is summed from live lots. pending.item no longer says 'iade/talep penceresi' and now says 'İptal/şikâyet süresi bitince'. Each pending item links to /booking/{id} and shows the estimated amount and property title when the API sends them. Those two fields still need the server change described in crossOwner.

## F638 — Tam kullanılmış kredi, son kullanma tarihi geçince 'Süresi doldu' olarak (kırmızı) gösteriliyor

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Aday                                         |
| Konum               | `src/components/account/WalletPanel.tsx:152` |
| Diğer konumlar      | `src/lib/wallet/wallet-service.ts:684`       |
| Kullanıcılar        | misafir                                      |
| Prensip             | robustness · observability / accuracy        |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                  |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:account2                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p052)              |

**Kanıt:** WalletPanel.tsx:151-156 `l.expired ? t("lots.expired") : l.remainingMinor === 0 ? t("lots.used") : ...` — sunucu wallet-service.ts `expired: l.expiresAt.getTime() <= now.getTime()` kalan tutara bakmıyor; tamamen harcanmış lot süresi geçince 'Kalan ₺0 / ₺100 · Süresi doldu' görünür. Lot listesi oluşturulma tarihi veya kaynak rezervasyon göstermiyor.

**Etki:** Krediyi harcamış misafir parasının yandığını düşünüyor; para hatası toleransı çok düşük kullanıcıda destek talebi ve güven kaybı.

**Önerilen aksiyon:** Koşul sırasını değiştirin: önce `l.remainingMinor === 0 → "Kullanıldı"`, sonra `l.expired && l.remainingMinor > 0 → "Süresi doldu ({kalan} kullanılmadan)"`; her lota `fmt.date(l.createdAt, "medium")` ile 'Kazanıldı: …' ekleyin.

**Yapılan düzeltme:** Confirmed. A plain reorder would have been wrong: the expiry sweep sets remainingMinor to 0 and moves the rest to expiredMinor, so an expired unused lot would show 'Kullanıldı'. The new logic computes lost = expiredMinor + (expired ? remaining : 0). If lost > 0 it shows 'Süresi doldu ({amount} kullanılmadan)' in the existing red. Otherwise remaining 0 shows 'Kullanıldı', and a live lot shows 'Son kullanma: {date}'. Until the server sends expiredMinor, an expired lot at ₺0 shows a neutral 'Son kullanma tarihi: {date}' and is never called expired. Each lot also shows 'Kazanıldı: {date}' (or 'İade edildi:' for refunds) and a booking link when bookingId is sent.

## F639 — Hesap silme sonrası onay mesajı görünmeden ana sayfaya yönlendiriliyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:47` |
| Kullanıcılar        | tümü                                          |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H12 — Feedback                                |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | lens:nav                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p097)               |

**Kanıt:** 47-49 `setFeedback({ message: t("deleted") }); router.push("/"); router.refresh();` Status bileşeni PrivacyCenter içinde ve hemen unmount oluyor; ana sayfada karşılık gelen bir mesaj yok.

**Etki:** Geri alınamaz bir işlemin sonucu kullanıcıya hiç gösterilmiyor. Kullanıcı hesabın silinip silinmediğinden ve verilerin ne zaman kaldırılacağından emin olamıyor.

**Önerilen aksiyon:** `/?accountDeleted=1` adresine yönlendirip ana sayfada kapatılabilir bir role="status" bandı gösterin ("Hesabınız silindi; verileriniz … içinde kaldırılır"), ya da "Ana sayfaya dön" bağlantılı ayrı bir onay ekranı kullanın.

**Yapılan düzeltme:** Same fix as F585: the deletion result stays on the page as a focused result card. It says what happened to the data (signed out, personal fields deleted or pseudonymised, records anonymised) and has a link back to the home page.

## F640 — Yeniden doğrulamadan 'Vazgeç' denince kırmızı hata olarak (ve sabit Türkçe) gösteriliyor

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                      |
| Durum               | Aday                                                                                        |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:50`                                               |
| Diğer konumlar      | `src/components/account/ReauthDialog.tsx:16`, `src/components/account/AgentMandates.tsx:87` |
| Kullanıcılar        | tümü                                                                                        |
| Prensip             | learnability · consistency / user control                                                   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                 |
| Renk/tema           | Hayır                                                                                       |
| Efor                | S                                                                                           |
| Kaynak denetçiler   | area:account2                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p097)                                                             |

**Kanıt:** PrivacyCenter.tsx:50-52 `catch (err) { setFeedback({ error: errorMessage(err) }) ...}` ReauthCancelledError'ı ayırt etmiyor; ReauthDialog.tsx:16 mesajı sabit "Yeniden doğrulama iptal edildi". Aynı durumda AgentMandates.tsx:87 `if (!(err instanceof ReauthCancelledError)) setStatus(...)` sessiz kalıyor — iki ekran tutarsız.

**Etki:** Kullanıcı bilinçli olarak vazgeçtiğinde role="alert" ile kırmızı hata duyuyor/görüyor; EN arayüzde Türkçe metin çıkıyor; kendi kontrolündeki bir eylemin 'hata' gibi sunulması güveni zedeliyor.

**Önerilen aksiyon:** PrivacyCenter.remove() catch bloğuna `if (err instanceof ReauthCancelledError) { setBusy(false); return; }` ekleyin (AgentMandates ile aynı davranış); isteğe bağlı olarak nötr bir `privacy.center.deleteCancelled` mesajı gösterin.

**Yapılan düzeltme:** Confirmed: the hard-coded Turkish text had already been localised through useAccountErrorText, but cancelling still showed a red role=alert error. The catch in remove() now does `if (err instanceof ReauthCancelledError) { setBusy(false); return; }`, the same silent behaviour as AgentMandates.

## F1082 — Çift ve tutarsız çıkış eylemi: header 'Çıkış yap' + sayfa başında kırmızı 'Çıkış Yap'

| Alan                | Değer                                                         |
| ------------------- | ------------------------------------------------------------- |
| Severity            | Low                                                           |
| Durum               | Gözlemlendi                                                   |
| Konum               | `src/app/account/page.tsx:213`                                |
| Diğer konumlar      | `messages/tr/account.json`, `messages/tr/nav.json`            |
| Kullanıcılar        | misafir, ev sahibi, admin                                     |
| Prensip             | learnability · Tutarlılık, minimal tasarım (Dix: consistency) |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                   |
| Renk/tema           | Hayır                                                         |
| Efor                | S                                                             |
| Kaynak denetçiler   | runtime:account                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p007)                               |

**Kanıt:** Tarama 060 tabOrder: 'button "Çıkış yap"' (header) hemen ardından 'button "Çıkış Yap"' (sayfa). Ekran crops/account/060-guest-tr-desktop-_account-0.png: h1 yanında kırmızı çerçeveli 'Çıkış Yap' (danger görünümü), header'da beyaz çerçeveli 'Çıkış yap'. Büyük/küçük harf farkı account.json 'logout' vs nav 'logout'.

**Etki:** Hesap sayfasının en görünür eylemi nadir kullanılan çıkış; kırmızı stil yıkıcı bir işlem izlenimi veriyor, tekrarlayan öğe klavye sırasını uzatıyor.

**Önerilen aksiyon:** Sayfa içi çıkışı kaldır veya 'Güvenlik' bölümünün altına ikincil olarak taşı; metni tek anahtarla ('Çıkış yap') birleştir.

**Yapılan düzeltme:** Removed the red 'Çıkış Yap' button next to the h1. Logout now lives in the security group's Oturumlar card as a secondary button (existing gray secondary style) next to the sessions link. It uses the header's key nav.logout ('Çıkış yap'), so the casing matches, and has a double-click guard (aria-disabled/aria-busy).

## F1083 — Hesap alt sayfalarında geri/ekmek kırıntısı yok; header hesap bağlantısı aria-current taşımıyor

| Alan                | Değer                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Severity            | Low                                                                    |
| Durum               | Gözlemlendi                                                            |
| Konum               | `src/app/account/sessions/page.tsx:11`                                 |
| Diğer konumlar      | `src/app/account/privacy/page.tsx`, `src/components/layout/Header.tsx` |
| Kullanıcılar        | misafir, ev sahibi, admin                                              |
| Prensip             | learnability · Gezinme görünürlüğü (Dix: browsability)                 |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                         |
| Renk/tema           | Hayır                                                                  |
| Efor                | S                                                                      |
| Kaynak denetçiler   | runtime:account                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p009)                                        |

**Kanıt:** Probe p2: /account/sessions main içinde bağlantı yok ('main links: []'). /account/privacy'de yalnız 'aydınlatma metninde' bağlantısı (tarama 064 tabOrder). Probe p1: header 'Hesabım' bağlantısı /account'ta accountLinkAriaCurrent=null (diğer nav öğeleri aria-current kullanıyor, Header.tsx:90).

**Etki:** Kullanıcı hesap merkezine dönmek için tarayıcı geri tuşuna veya avatar ikonuna güvenmek zorunda; nerede olduğunu (Hesap > Oturumlar) görmez.

**Önerilen aksiyon:** PageShell'e isteğe bağlı breadcrumb prop'u ekle ('Hesabım › Oturumlar'); Header hesap bağlantısına pathname.startsWith('/account') iken aria-current="page" ver.

**Yapılan düzeltme:** Added a new AccountBreadcrumb component: <nav aria-label=account.breadcrumb><ol>, a 'Hesabım' link to /account, a hidden › separator, and the current page marked aria-current='page'. It renders right under the h1 (in PageShell intro) on /account/sessions and /account/privacy. PageShell has no breadcrumb slot and ui.tsx is not mine, so it sits in intro. The Header account link already sets aria-current when pathname.startsWith('/account') (Header.tsx:172/275).

## F1084 — Yeniden doğrulama iptali bileşenlere göre tutarsız: AI yetkisinde sessiz, oturum/passkey'de kırmızı hata

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                      |
| Durum               | Gözlemlendi                                                                              |
| Konum               | `src/components/account/AgentMandates.tsx:87`                                            |
| Diğer konumlar      | `src/components/account/SessionManager.tsx`, `src/components/account/PasskeyManager.tsx` |
| Kullanıcılar        | misafir, ev sahibi                                                                       |
| Prensip             | robustness · Tutarlılık ve geri bildirim (Dix: consistency, responsiveness)              |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                              |
| Renk/tema           | Hayır                                                                                    |
| Efor                | S                                                                                        |
| Kaynak denetçiler   | runtime:account                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p041)                                                   |

**Kanıt:** Probe p4: AI yetkisi reauth diyaloğunda Escape → durum metni '' ve odak body. Passkey ekle → Escape → 'Yeniden doğrulama iptal edildi' (role=alert, text-red-700). Probe p2 oturumlar → Escape → aynı kırmızı role=alert mesaj. Ayrıca p4: başarılı yetkiden sonra odak body (token alanına gitmiyor), 'Kopyala' (AgentMandates.tsx:177-183) clipboard yazıyor ama 'Kopyalandı' geri bildirimi yok.

**Etki:** Kullanıcının kendi vazgeçmesi bir yerde hata gibi, bir yerde hiç bildirilmiyor; tek seferlik gösterilen belgenin kopyalandığından emin olunamıyor.

**Önerilen aksiyon:** Ortak bir durum deseni: kullanıcı iptalinde nötr role=status ('İşlem iptal edildi, değişiklik yapılmadı'); hata yalnız gerçek hatada role=alert. Yetki oluşunca odağı token textarea'ya taşı; Kopyala'da 2 sn 'Kopyalandı' metni (aria-live).

**Yapılan düzeltme:** In AgentMandates, cancelling the re-auth now sets a neutral `info` text ('İşlem iptal edildi; yetki verilmedi.') in a separate, always-present role=status paragraph, with no red alert. If focus has fallen to body, it goes back to the submit button. After a successful grant, focus moves to the token textarea. Copy feedback was already in place. PasskeyManager still shows the cancel as a red error and SessionManager is silent; both are listed in crossOwner.

## F1085 — KYC demo formu: buton seçiciden 278px uzakta, kontrol yükseklikleri tutarsız, demo notu 12px

| Alan                | Değer                                                           |
| ------------------- | --------------------------------------------------------------- |
| Severity            | Low                                                             |
| Durum               | Gözlemlendi                                                     |
| Konum               | `src/components/account/IdentityVerification.tsx:129`           |
| Kullanıcılar        | misafir, ev sahibi                                              |
| Prensip             | learnability · Gestalt yakınlık / tutarlılık (Dix: consistency) |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                     |
| Renk/tema           | Hayır                                                           |
| Efor                | S                                                               |
| Kaynak denetçiler   | runtime:account                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p043)                                 |

**Kanıt:** Probe p4 (desktop): #kyc-doc sağ kenarı x=219, 'Yeniden dene/Doğrulamayı başlat' butonu x=497 (boşluk 278px); select yüksekliği 31px, buton 36px. mockNotice <p> text-xs select ile aynı sarmalayıcıda olduğu için sarmalayıcıyı genişletiyor. Ekranlar: crops/account/060-guest-tr-desktop-_account-0.png, probes/account/shots/p4-kyc-mock.png

**Etki:** Seçim ile başlatma eylemi görsel olarak kopuk; 'Demo modu' açıklaması küçük ve soluk kaldığı için gerçek belge istendiği sanılabilir.

**Önerilen aksiyon:** mockNotice'i formun üstüne ayrı bilgi kutusu (role=note, text-sm) olarak taşı; select'i inputClass ile (py-2) diğer alanlarla aynı yüksekliğe getir, butonu select'in hemen yanına hizala.

**Yapılan düzeltme:** mockNotice moved out of the select wrapper into a separate role=note box (text-sm) above the form. The select now uses inputClass inside Field, in a w-full sm:w-64 wrapper, so the submit Button sits right next to it with items-end alignment and a matching control height.

## F1086 — Reauth diyaloğu kayıtlı passkey yokken de "Passkey ile doğrula" sunuyor

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | Low                                                            |
| Durum               | Gözlemlendi                                                    |
| Konum               | `src/components/account/ReauthDialog.tsx:114`                  |
| Kullanıcılar        | misafir, ev sahibi                                             |
| Prensip             | learnability · Feedforward / hata önleme (Dix: predictability) |
| Sezgisel madde      | H13 — Feedforward                                              |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | runtime:account                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p045)                                |

**Kanıt:** Probe p2: diyalog butonları ['Doğrula(disabled)','Passkey ile doğrula','Vazgeç']; aynı hesapta /account 'Kayıtlı passkey yok.' (tarama 060 metni). supported yalnız tarayıcı yeteneğine bakıyor (36. satır).

**Etki:** Kullanıcı başarısız olacak bir seçeneği dener, tarayıcı passkey penceresi boşa açılır ve hata görür.

**Önerilen aksiyon:** Kullanıcının kayıtlı passkey sayısını (/api/account/passkeys veya oturum bilgisi) kontrol et; yoksa butonu gizle ya da 'Passkey eklemediniz' açıklamasıyla devre dışı göster.

**Yapılan düzeltme:** Same fix as F630: 'Passkey ile doğrula' is hidden unless the account has a registered passkey, whether that comes from the hasPasskey prop or from /api/account/passkeys.

## F1087 — Cüzdan geçmişi zayıf: kazanım tarihi/kaynak rezervasyon yok, harcamalar yok, sütunlar kayık, bekleyen cashback tutarı yok

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Low                                                   |
| Durum               | Gözlemlendi                                           |
| Konum               | `src/components/account/WalletPanel.tsx:141`          |
| Diğer konumlar      | `messages/tr/wallet.json`                             |
| Kullanıcılar        | misafir                                               |
| Prensip             | learnability · Durum görünürlüğü (Dix: observability) |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                        |
| Renk/tema           | Hayır                                                 |
| Efor                | M                                                     |
| Kaynak denetçiler   | runtime:account                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p052)                |

**Kanıt:** Probe p4 (GET /api/account/wallet lot/bekleyen verisiyle mock'landı): 'Kredi hareketleri' satırları yalnız 'Cashback / Kalan ₺100,00 / ₺100,00 / Son kullanma: 15 Ocak 2027'; createdAt ve bookingId gösterilmiyor; kredi harcamaları listelenmiyor. justify-between nedeniyle orta sütun satırdan satıra kayıyor. 'Bekleyen cashback: 30 Ekim 2026 tarihinde krediye dönüşür (%2)' — tutar yok. Rozet 'Gümüş seviye'/'Üye seviye' (wallet.json:11) Türkçede 'seviyesi' olmalı; altındaki metin 'Altın seviyesi' diyor. Ekran: probes/account/shots/p4-wallet-mock.png

**Etki:** Misafir kredisinin nereden geldiğini ve nereye harcandığını izleyemez; son kullanma tarihli krediyi kaçırabilir.

**Önerilen aksiyon:** Hareketleri tarih sıralı tablo/ızgara olarak göster (Tarih · Açıklama 'Grand Deluxe Hotel konaklaması cashback'i' · +/− tutar · Kalan · Son kullanma), checkout'ta kullanılan krediyi eksi satır olarak ekle; bekleyen cashback'te tahmini tutarı göster. tierBadge'i '{tier} seviyesi' yap.

**Yapılan düzeltme:** The credit history is now one list sorted newest first. Each row is a two-column grid: description and earned date on the left, the signed amount right-aligned, then a row with remaining amount and status, so columns no longer shift between rows. Spend rows (shown as −amount, 'Ödemede kullanıldı' / 'Ödeme için ayrıldı', with a booking link) appear when the API sends spends. Pending cashback shows 'Tahmini tutar' when estimatedMinor is sent. tierBadge is now '{tier} seviyesi', the same value p006 uses. The spends, estimatedMinor and propertyTitle data need the wallet-service change in crossOwner.

## F1088 — Gizlilik merkezinde başlık ile ilk kart arasında 68px boş alan (boş canlı bölge)

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Gözlemlendi                                      |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:58`    |
| Diğer konumlar      | `src/components/ui/ui.tsx`                       |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | learnability · Görsel düzen (Dix: observability) |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                     |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | runtime:account                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p097)                  |

**Kanıt:** Probe p3-privacy: 'gap intro->first card px: 68' (desktop ve mobil). Status bileşeni (ui.tsx:146) boşken min-h-[1.25rem] + space-y-6 iki kez boşluk ekliyor. Ekran: crops/account/064-guest-tr-desktop-_account_privacy-0.png

**Etki:** Sayfa boş/yükleniyor gibi görünür; mobilde içerik gereksiz aşağı itilir.

**Önerilen aksiyon:** Status'u kartların altına veya ilgili kartın içine taşı ya da boşken sr-only/yüksekliksiz render et (aria-live kapsayıcısı DOM'da kalsın).

**Yapılan düzeltme:** Removed the always-present empty Status between the page intro and the first card. The export feedback Status (the live region stays in the DOM) now sits inside the export card under its button, so no empty gap shows above the cards.

## F1089 — Veri dışa aktarmada ~2 sn ilerleme göstergesi yok; buton etkin kalıyor ve indirme engellense de 'indirildi' diyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Low                                                   |
| Durum               | Gözlemlendi                                           |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:61`         |
| Kullanıcılar        | misafir, ev sahibi                                    |
| Prensip             | robustness · Yanıt verebilirlik (Dix: responsiveness) |
| Sezgisel madde      | H12 — Feedback                                        |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | runtime:account                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p097)                       |

**Kanıt:** Probe p3b-export (desktop, acceptDownloads=false): tıklamadan sonra 1.7 sn boyunca 'disabled=false text=Verilerimi indir fb=' (geri bildirim yok), ~2.0 sn'de 'Verileriniz indirildi (verilerim.json).' — tarayıcı indirmeyi kaydetmediği hâlde başarı mesajı. Kod: download() (22-40) busy state'i yok.

**Etki:** Kullanıcı tekrar tıklayıp birden çok dosya indirir veya işlem başlamadı sanır; mobilde blob indirmesi engellenirse yanlış başarı bildirimi.

**Önerilen aksiyon:** busy state ekle (buton disabled + 'Hazırlanıyor…', aria-busy); mesajı 'Dosyanız hazırlandı; indirme başlamadıysa buraya tıklayın' olarak değiştir ve yedek bağlantı sun.

**Yapılan düzeltme:** Added an `exporting` state. The button uses Button busy (aria-busy/aria-disabled, keeps focus, blocks double clicks) and reads 'Hazırlanıyor…' while working. The success text now says the file is ready ('Dosyanız hazırlandı') instead of 'downloaded', and a fallback `<a download>` link offers the file again if the download did not start.

## F1164 — Rezervasyon listesi sayfalama imlecini yok sayıyor, 50'den sonrası görünmüyor

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | Low                             |
| Durum               | Aday                            |
| Konum               | `src/app/account/page.tsx:84`   |
| Kullanıcılar        | misafir                         |
| Prensip             | robustness · task conformance   |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü  |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | area:account                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p008) |

**Kanıt:** page.tsx:84 `fetch("/api/bookings")` imleç işlemiyor. bookings/route.ts:44-48 X-Next-Cursor başlığını gönderiyor. BOOKINGS_PAGE_SIZE_DEFAULT=50 (app-config.ts:98).

**Etki:** Çok rezervasyonu olan kullanıcı eski rezervasyonlarının sessizce eksik olduğunu fark etmiyor.

**Önerilen aksiyon:** X-Next-Cursor başlığını okuyun ve 'Daha fazla rezervasyon göster' düğmesi ekleyin. Liste başlığında toplam sayıyı gösterin.

**Yapılan düzeltme:** Confirmed: the code already reads X-Next-Cursor through fetchBookingsPage() and has a 'load more' Button (busy, appends without duplicates, moves focus to the first new booking, 401 → session expired) with a shown-count line. The API gives no total, so the page shows how many are loaded instead. The keys it uses (account.bookings.loadMore, account.bookings.shown) were missing from messages, so I added them to the p008 patch.

## F1165 — Favoriler ve alt paneller sıralı yükleniyor, ilk görüntü gecikiyor

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | Low                              |
| Durum               | Aday                             |
| Konum               | `src/app/account/page.tsx:96`    |
| Kullanıcılar        | misafir                          |
| Prensip             | robustness · responsiveness      |
| Sezgisel madde      | H15 — Performans                 |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | area:account                     |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p008) |

**Kanıt:** page.tsx:82-96 user ve bookings paralel çekildikten sonra `await fetchFavorites()` sıralı çalışıyor. Alt paneller (WalletPanel, IdentityVerification, PasskeyManager, AgentMandates; 249-255) üç isteğin tamamı bitince mount oluyor ve kendi isteklerini ancak o zaman başlatıyor (PasskeyManager.tsx:55-64).

**Etki:** Yavaş mobil ağda misafir uzun süre yalnızca spinner görüyor, ardından paneller tek tek 'Yükleniyor…' gösteriyor.

**Önerilen aksiyon:** Favorileri de aynı Promise.all'a alın. Sayfa iskeletini hemen render edin ve her bölümde kendi iskelet görünümünü gösterin.

**Yapılan düzeltme:** Already fixed in the current code. user, bookings and favorites load together in a single Promise.allSettled, and each section fails on its own with its own retry. The heading, section nav, skeletons and the Wallet/Identity/Passkey/AgentMandates panels render right away, so the panels start their own requests in parallel.

## F1166 — Hesap sayfasındaki çıkış düğmesinde bekleme durumu ve çift tıklama koruması yok

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | Low                              |
| Durum               | Aday                             |
| Konum               | `src/app/account/page.tsx:213`   |
| Kullanıcılar        | tümü                             |
| Prensip             | robustness · responsiveness      |
| Sezgisel madde      | H12 — Feedback                   |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | area:account                     |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p008) |

**Kanıt:** page.tsx:213-217 `onClick={async () => { await logout(); router.push("/"); }}`: disabled ya da busy yok, router.refresh() da yok. Header.tsx:60-65'teki çıkış ise refresh yapıyor. logout() çevrimdışı veriyi temizlemeyi bekliyor (api-client.ts:97).

**Etki:** Yavaş cihazda kullanıcı tepki görmediği için birkaç kez tıklıyor. Çıkıştan sonra önbellekteki sunucu bileşenleri eski oturumu gösterebilir.

**Önerilen aksiyon:** busy state ekleyin ve düğme metnini 'Çıkış yapılıyor…' yapıp düğmeyi devre dışı bırakın. router.refresh() çağırın ya da Header'daki ortak handleLogout'u yeniden kullanın.

**Yapılan düzeltme:** Already fixed. handleLogout guards with a loggingOut state and uses Button busy with the label nav.loggingOut ('Çıkış yapılıyor…'). After logout it clears the session user cache, calls invalidateFavoriteIds(), then router.push('/') and router.refresh(), the same as Header.

## F1167 — Çıkış eylemi iki yerde farklı görünümle var; hesap sayfasında yıkıcı (kırmızı) stil kullanılıyor

| Alan                | Değer                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                          |
| Durum               | Aday                                                                                                                                         |
| Konum               | `src/app/account/page.tsx:213`                                                                                                               |
| Diğer konumlar      | `src/components/layout/Header.tsx:60-65`, `src/components/layout/Header.tsx:114-120`, `messages/tr/account.json:3`, `messages/tr/nav.json:6` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                           |
| Prensip             | learnability · consistency                                                                                                                   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                        |
| Efor                | S                                                                                                                                            |
| Kaynak denetçiler   | lens:consistency                                                                                                                             |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p008)                                                                                                             |

**Kanıt:** account/page.tsx:213-221 `className="rounded-md border border-red-300 … text-red-600"` ve `{t("logout")}` ("Çıkış Yap"). Bu stil :330'daki 'Rezervasyonu İptal Et' düğmesiyle aynı, ayrıca `router.refresh()` çağrılmıyor. Header.tsx:114-120 aynı eylemi nötr beyaz çerçeveli düğme olarak sunuyor ve :62-64'te `router.refresh()` yapıyor. Etiketler de farklı: "Çıkış Yap" ile "Çıkış yap".

**Etki:** Yıkıcı eylemlerle aynı görünen çıkış düğmesi kullanıcıyı gereksiz tedirgin eder. İki ayrı implementasyon, sunucu bileşenlerinin oturum sonrası yenilenmesinde farklı sonuç verebilir.

**Önerilen aksiyon:** Hesap sayfasındaki çıkış düğmesini kaldırın (Header'daki yeterli) ya da Button `variant="secondary"` ile ortak bir `useLogout()` kancası kullanın. Etiketi nav.logout anahtarında birleştirin.

**Yapılan düzeltme:** Already fixed. The logout control is now a neutral Button variant="secondary" (not the red destructive style) labelled tNav("logout"), the same label as Header, and it does the same refresh. account.logout is no longer used by this page.

## F1168 — Avatar baş harfleri ekran okuyucuda gereksiz yere okunuyor, avatarUrl kullanılmıyor

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | Low                              |
| Durum               | Aday                             |
| Konum               | `src/app/account/page.tsx:228`   |
| Kullanıcılar        | tümü                             |
| Prensip             | accessibility · Non-text Content |
| Sezgisel madde      | H14 — Erişilebilirlik            |
| WCAG                | 1.1.1                            |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | area:account                     |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p008) |

**Kanıt:** page.tsx:228-231 baş harfleri gösteren div'de aria-hidden yok, ekran okuyucu addan önce 'AY' okuyor. User arayüzündeki avatarUrl alanı (21) hiç render edilmiyor. Baş harfler Header.tsx'teki gibi `.toUpperCase()` ile büyütülmüyor.

**Etki:** Ekran okuyucu kullanıcısı anlamsız harfler duyuyor. Küçük harfle kaydolmuş kullanıcının avatarı Header'dakinden farklı görünüyor.

**Önerilen aksiyon:** Baş harf div'ine aria-hidden="true" verin. avatarUrl varsa `<img alt="">` gösterin. Baş harfleri büyük harfe çevirin.

**Yapılan düzeltme:** Already fixed. The initials div is aria-hidden="true" and its text is uppercased. If avatarUrl is set, an <img alt=""> renders instead, falling back to the initials when the image fails to load (onError).

## F1169 — Bağlantı rengi için dört farklı sınıf kullanılıyor ve alt çizgi kullanımı tutarsız

| Alan                | Değer                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                                                                          |
| Durum               | Aday                                                                                                                                                                                                                         |
| Konum               | `src/app/account/page.tsx:258`                                                                                                                                                                                               |
| Diğer konumlar      | `src/app/search/page.tsx:301`, `src/app/checkout/page.tsx:157`, `src/app/checkout/cart/page.tsx:197`, `src/app/admin/page.tsx:18`, `src/app/trust/page.tsx:13`, `src/app/login/page.tsx:115`, `src/styles/globals.css:17-21` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                         |
| Prensip             | learnability · consistency                                                                                                                                                                                                   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                  |
| WCAG                | 1.4.1                                                                                                                                                                                                                        |
| Renk/tema           | Evet — kapsam dışı                                                                                                                                                                                                           |
| Efor                | S                                                                                                                                                                                                                            |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                             |
| **Düzeltme durumu** | **Kapsam dışı (renk/tema)**                                                                                                                                                                                                  |

**Kanıt:** account/page.tsx:258-268 `text-blue-700 hover:underline`. search/page.tsx:301 ve :546 `text-blue-700 underline`. checkout/page.tsx:157 ve checkout/cart/page.tsx:197 `text-primary-600 hover:underline`. admin/page.tsx:18 ve ClaimList.tsx:26 `text-[#003580] underline`. trust/page.tsx:13 `text-brand underline hover:no-underline`. login/page.tsx:115 `text-[#003580] hover:underline`. Bazı bağlantılar yalnızca hover'da altı çizili oluyor, bazıları hep çizili, trust sayfası ise hover'da çizgiyi kaldırıyor. globals.css:17-21 yeni kod için `text-brand` öneriyor.

**Etki:** Kullanıcı neyin bağlantı olduğunu ekrandan ekrana farklı ipuçlarıyla öğrenir. Altı çizili olmayan metin bağlantıları renk ayrımı zayıf kullanıcı için yalnızca renkle ayırt edilir.

**Önerilen aksiyon:** Ortak bir `linkClass` (ya da `<TextLink>`) tanımlayın: `text-brand underline underline-offset-2` ve focusRing. Tüm metin bağlantılarında bunu kullanın. Renk değeri mevcut marka mavisi kalır, yalnızca token birleştirilir. Alt çizgiyi her zaman göstermek renk dışı bir düzeltmedir (WCAG 1.4.1).

## F1170 — Hesap sayfası rolden bağımsız: yöneticiye misafir listeleri ve yanlış çözüm merkezi bağlantısı

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | Low                             |
| Durum               | Aday                            |
| Konum               | `src/app/account/page.tsx:266`  |
| Kullanıcılar        | ev sahibi, admin                |
| Prensip             | flexibility · customizability   |
| Sezgisel madde      | H8 — Estetik/minimal tasarım    |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | area:account                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p008) |

**Kanıt:** page.tsx:266-268 her rol için `/resolution` ve `tRes("link")` kullanılıyor. Yöneticinin kuyruğu /admin/claims ve resolution.json'daki adminLink ile hostLink başka sayfalarda kullanılıyor (admin/page.tsx:27, HostDashboard.tsx:108). ADMIN'e de 'Rezervasyonlarım' ve 'Favorilerim' boş durumlarıyla gösteriliyor. Misafir rol rozeti 'Kullanıcı' (account.json:18) yazıyor.

**Etki:** Yönetici kendi talep kuyruğu yerine boş bir 'Taleplerim' sayfasına gidiyor. Misafir kendini sistemin diliyle 'Kullanıcı' olarak görüyor.

**Önerilen aksiyon:** Bağlantıları role göre verin: HOST için ev sahibi paneli ve hostLink, ADMIN için /admin/claims ve adminLink. ADMIN'de rezervasyon ve favori bölümlerini boşsa gizleyin. role.user etiketini 'Misafir' yapın.

**Yapılan düzeltme:** Role-based links were already in the code: HOST gets /host plus resolution.hostLink, ADMIN gets /admin plus /admin/claims with resolution.adminLink, and ADMIN does not see empty bookings or favorites sections. What was missing was the label: the p008 patch now changes account.role.user to 'Misafir' / 'Guest'. That key is used only in account/page.tsx.

## F1171 — Rezervasyon ve favori listeleri liste ve tanım listesi semantiği kullanmıyor

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | Low                                                            |
| Durum               | Aday                                                           |
| Konum               | `src/app/account/page.tsx:275`                                 |
| Diğer konumlar      | `src/app/account/page.tsx:362`, `src/app/account/page.tsx:304` |
| Kullanıcılar        | tümü                                                           |
| Prensip             | accessibility · Info and Relationships                         |
| Sezgisel madde      | H14 — Erişilebilirlik                                          |
| WCAG                | 1.3.1                                                          |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | area:account                                                   |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p008)                               |

**Kanıt:** page.tsx:275 `<div className="mt-4 space-y-4">` ve 282 `<div key={booking.id}`. 362 ve 369'da da aynısı. 304-323 etiket/değer çiftleri düz `<p>`. Buna karşılık SessionManager.tsx:110 ve PasskeyManager.tsx:122 `<ul>` kullanıyor.

**Etki:** Ekran okuyucu kaç rezervasyon olduğunu duyurmuyor. 'Giriş' ile tarih arasındaki ilişki yapısal olarak kurulmamış.

**Önerilen aksiyon:** Listeleri `<ul role="list">` ve `<li>` ile işaretleyin. Ayrıntıları `<dl><dt>Giriş</dt><dd>…</dd></dl>` olarak yazın.

**Yapılan düzeltme:** Already fixed. The bookings and favorites lists use <ul role="list"> with <li> cards, and the check-in, check-out, guests and total details are a <dl> with <dt>/<dd> pairs.

## F1172 — Boş durumlarda sonraki adım önerilmiyor

| Alan                | Değer                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                          |
| Durum               | Aday                                                                                         |
| Konum               | `src/app/account/page.tsx:278`                                                               |
| Diğer konumlar      | `src/app/account/page.tsx:363-366`, `src/app/cart/page.tsx:82-91`, `messages/tr/pwa.json:13` |
| Kullanıcılar        | misafir                                                                                      |
| Prensip             | learnability · predictability                                                                |
| Sezgisel madde      | H13 — Feedforward                                                                            |
| Renk/tema           | Hayır                                                                                        |
| Efor                | S                                                                                            |
| Kaynak denetçiler   | lens:copy                                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p008)                                                              |

**Kanıt:** account/page.tsx:276-279 'Henüz rezervasyonunuz yok.' (account.json:28) ve 363-366 'Henüz favori eklemediniz.' — eylem bağlantısı yok; pwa trips.empty de aynı. cart/page.tsx:82-91 ise sepeti hiç olmamış kullanıcıya da 'Süresi dolan sepeti geri yükle' düğmesini gösterir.

**Etki:** Yeni kullanıcı ne yapacağını bilmez; sepet sayfasındaki anlamsız düğme kafa karıştırır.

**Önerilen aksiyon:** Boş durumlara 'Konaklama ara' bağlantısı ekleyin; 'Süresi dolan sepeti geri yükle'yi yalnız sunucu süresi dolmuş sepet olduğunu bildirdiğinde gösterin.

**Yapılan düzeltme:** The empty states for bookings and favorites already had a primary 'search stays' link, but it used a missing key, account.searchStays. I switched it to the existing common.notFound.search ('Konaklama ara' / 'Search stays'), which TripsView uses for the same link. TripsView's empty state already links to search. The cart page already has a browse link and hides 'reopen' after the server says there is nothing to restore. Showing it only when there is an expired cart needs an API change, filed as crossOwner.

## F1173 — Puan TR ondalık biçiminde değil, değerlendirmesi olmayan ilanda '0.0' görünüyor

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | Low                              |
| Durum               | Aday                             |
| Konum               | `src/app/account/page.tsx:380`   |
| Kullanıcılar        | misafir                          |
| Prensip             | learnability · consistency       |
| Sezgisel madde      | H4 — Tutarlılık/standartlar      |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | area:account                     |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p008) |

**Kanıt:** page.tsx:380 `{favorite.property.ratingAvg.toFixed(1)}` TR'de '4.5' üretiyor (olması gereken '4,5'). Oysa useFormat().number mevcut (format.ts). ratingCount 0 olduğunda '0.0' ve '0 değerlendirme' görünüyor. Rozette puanın ölçeğini belirten bir bağlam yok.

**Etki:** TR misafir ondalık ayıracında tutarsızlık görüyor. Değerlendirmesiz bir ilan çok düşük puanlı gibi algılanıyor.

**Önerilen aksiyon:** `fmt.number(ratingAvg, { minimumFractionDigits: 1, maximumFractionDigits: 1 })` kullanın. ratingCount 0 ise 'Henüz değerlendirme yok' yazın. Rozete görsel olarak gizli 'Puan' metni ekleyin.

**Yapılan düzeltme:** Already fixed. Favorites use the shared RatingBadge (locale-aware 1-decimal format, '/5' scale, sr-only label) when ratingCount > 0, and otherwise show property.noRatingYet ('Henüz puan yok') instead of '0.0'.

## F1174 — Oturumlar sayfasında Hesabım'a dönüş bağlantısı yok

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Low                                    |
| Durum               | Aday                                   |
| Konum               | `src/app/account/sessions/page.tsx:11` |
| Kullanıcılar        | tümü                                   |
| Prensip             | learnability · predictability          |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü      |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | area:account                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p009)        |

**Kanıt:** sessions/page.tsx:11-13 yalnızca `<PageShell title={t("title")} intro={t("description")}><RoleGate>...` içeriyor, breadcrumb ya da geri bağlantısı yok. Sayfaya yalnızca hesap sayfasından gelinebiliyor (page.tsx:258).

**Etki:** Kullanıcı hesap hiyerarşisinde nerede olduğunu göremiyor. Geri dönmek için tarayıcının geri tuşuna ya da Header ikonuna güvenmek zorunda.

**Önerilen aksiyon:** Başlığın üstüne `<nav aria-label="Konum"><Link href="/account">Hesabım</Link> › Oturumlar</nav>` ekleyin.

**Yapılan düzeltme:** Confirmed: the sessions page had no way back. It now shows the AccountBreadcrumb 'Hesabım › Oturumlar' under the title, with a link to /account. The description text moved into a <p> after it.

## F1175 — Aydınlatma metninde her bölüm ayrı 'region' yer imi oluşturuyor

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Low                                    |
| Durum               | Aday                                   |
| Konum               | `src/app/privacy/page.tsx:36`          |
| Kullanıcılar        | tümü                                   |
| Prensip             | accessibility · Info and Relationships |
| Sezgisel madde      | H8 — Estetik/minimal tasarım           |
| WCAG                | 1.3.1                                  |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | area:account2                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p031)        |

**Kanıt:** privacy/page.tsx:36, 43, 55, 62, 69, 76, 88 — yedi `<section aria-labelledby="p-...">`; aria-labelledby ile adlandırılan her section 'region' yer imine dönüşüyor (Header/main/footer ile birlikte 10+ yer imi).

**Etki:** Ekran okuyucu kullanıcısının yer imi listesi şişiyor; başlıklarla zaten gezinilebilen içerik için gezinmeyi yavaşlatıyor.

**Önerilen aksiyon:** Bölümlerden `aria-labelledby`'yi kaldırın (h2 başlıkları gezinmeye yeter) veya `<section>` yerine `<div>` kullanın; başlık id'lerini (#p-cookies çapası için) koruyun.

**Yapılan düzeltme:** I confirmed the problem: there were 7 sections with aria-labelledby. I removed aria-labelledby from all of them, so they are now unnamed sections and no longer create region landmarks. The h2 ids stay in place, so the Footer's /privacy#p-cookies anchor still works.

## F1176 — Kopyala düğmeleri arasında geri bildirim tutarsız (yetki belgesi kopyalanınca bildirim yok)

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Low                                                   |
| Durum               | Aday                                                  |
| Konum               | `src/components/account/AgentMandates.tsx:180`        |
| Diğer konumlar      | `src/components/transfers/TransferMarket.tsx:135-140` |
| Kullanıcılar        | misafir                                               |
| Prensip             | robustness · observability (geri bildirim)            |
| Sezgisel madde      | H12 — Feedback                                        |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | lens:copy                                             |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p041)                      |

**Kanıt:** AgentMandates.tsx:177-183 `onClick={() => void navigator.clipboard?.writeText(issued)}` — başarı/başarısızlık bildirilmez; TransferMarket.tsx 'Kopyalandı.' ve hata mesajı, SplitPayPanel 'Kopyalandı' veriyor.

**Etki:** Yalnız bir kez gösterilen imzalı belgenin kopyalandığından emin olunamaz.

**Önerilen aksiyon:** Kopyalama sonucunu aria-live alanında 'Kopyalandı' / 'Kopyalanamadı; metni seçip elle kopyalayın' olarak gösterin.

**Yapılan düzeltme:** Already fixed by an earlier package (F583). copyToken() (AgentMandates.tsx ~L290) announces t("copied") through Status's role=status and changes the button label to 'Kopyalandı' for 2 seconds. On failure it shows t("copyFailed") as an alert and focuses and selects the textarea for manual copying. The only change here is that a successful copy now also sets `tokenCopied`, which turns off the leave-page warning and the replace confirmation.

## F1177 — Yetki listesinde yükleniyor durumu yok

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/account/AgentMandates.tsx:189` |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · observability                     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                 |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:account2                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p041)                |

**Kanıt:** AgentMandates.tsx:188-190 başlık her zaman render ediliyor; `{list.data?.length === 0 && <p>{t("empty")}</p>}` yalnız boş durumda; `list.data === null && !list.error` için hiçbir metin yok (WalletPanel.tsx:84 ve IdentityVerification.tsx:98'de 'Yükleniyor…' var).

**Etki:** Yavaş ağda 'Verilmiş yetkiler' başlığının altı boş kalıyor; kullanıcı yetkisi olmadığını sanabiliyor; diğer kartlarla tutarsız.

**Önerilen aksiyon:** `{!list.data && !list.error && <p className="text-sm text-gray-600">{t("loading")}</p>}` ekleyin ve account.json mandates altına `loading` anahtarı tanımlayın.

**Yapılan düzeltme:** Confirmed. Under the list heading, the existing common.loading key ('Yükleniyor…') is now shown while `list.data === null && !list.error`, so no new key was needed.

## F1178 — Yetki iptal düğmelerinin erişilebilir adları aynı tutarlı yetkilerde ayırt edilemiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/account/AgentMandates.tsx:216` |
| Diğer konumlar      | `messages/tr/account.json:135`                 |
| Kullanıcılar        | misafir                                        |
| Prensip             | accessibility · Link/Button Purpose            |
| Sezgisel madde      | H14 — Erişilebilirlik                          |
| WCAG                | 2.4.6                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:account2                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p041)                |

**Kanıt:** AgentMandates.tsx:216-218 `aria-label={t("revokeLabel", { amount: f.money(m.maxAmountMinor, m.currency) })}` → "₺1.500,00 limitli yetkiyi iptal et"; aynı tutarla verilen iki yetkide iki düğme aynı adı taşıyor (bitiş tarihi veya veriliş zamanı yok).

**Etki:** Ekran okuyucunun düğme listesinde kullanıcı hangi yetkiyi iptal edeceğini seçemiyor.

**Önerilen aksiyon:** revokeLabel'ı "{amount} limitli, {date} tarihine kadar geçerli yetkiyi iptal et" yapıp `date: f.dateTime(m.expiresAt)` geçin; satırda veriliş zamanını (`m.issuedAt`) da görünür metin olarak gösterin.

**Yapılan düzeltme:** Confirmed. revokeLabel now includes the expiry: '{amount} limitli, {date} tarihine kadar geçerli yetkiyi iptal et'. The call passes `date` in the medium date-time format. Each row also shows when the permission was granted ('Verildi: {date}' from issuedAt).

## F1179 — Hesap sayfasındaki kartlar ortak bileşenleri kullanmıyor; kenarlık, köşe, başlık boyutu ve odak halkası tutarsız

| Alan                | Değer                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                |
| Durum               | Aday                                                                                               |
| Konum               | `src/components/account/IdentityVerification.tsx:93`                                               |
| Diğer konumlar      | `src/components/account/WalletPanel.tsx:72`, `src/components/account/IdentityVerification.tsx:140` |
| Kullanıcılar        | tümü                                                                                               |
| Prensip             | learnability · consistency                                                                         |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                        |
| Renk/tema           | Hayır                                                                                              |
| Efor                | S                                                                                                  |
| Kaynak denetçiler   | area:account2                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p043)                                                                    |

**Kanıt:** IdentityVerification.tsx:93 `<section ... className="mt-8 rounded-xl bg-white p-6 shadow-sm">` + h2 `text-xl`; WalletPanel.tsx:72 `mt-6 rounded-2xl ... p-6`; AgentMandates.tsx:114 ortak `Card` (ui.tsx:104 `rounded-xl border border-gray-200 ... p-5`, h2 `text-lg`). IdentityVerification.tsx:150-154 gönder düğmesi ortak `Button` yerine elle sınıflandırılmış ve `focusRing` içermiyor; :140 select `inputClass` yerine kendi sınıfı (odak halkası yok). Ekran görüntüsü docs/img/v4-wallet.png: mock modda select ile düğme arasında geniş boşluk (mockNotice paragrafı :132 aynı flex öğesinde).

**Etki:** Aynı sayfadaki kartlar farklı görünüp farklı odak göstergesi veriyor; klavye kullanıcısı bazı kontrollerde yalnız tarayıcı varsayılan halkasını görüyor; select ile ilgili düğme görsel olarak ayrışıyor.

**Önerilen aksiyon:** IdentityVerification ve WalletPanel'i `Card` ile sarın; gönder düğmesini `<Button type="submit">`, select'i `className={inputClass}` ve `Field` ile yeniden yazın; mockNotice paragrafını flex satırının dışına (formun üstüne) taşıyın.

**Yapılan düzeltme:** The section is now the shared Card (id='kyc', so the heading id stays kyc-title) in a mt-8 wrapper. The submit button is the shared Button (busy guard and focusRing), the select uses Field and inputClass (focus ring), and mockNotice is outside the flex row. Side effect: Button's primary hover colour (#002b66) replaces the old hand-written hover (#00224f); no palette change. Neighbouring sections on the account page (PasskeyManager, SessionManager and the page's own sections) still use the older section style.

## F1180 — Kimlik doğrulama zorunluluk metni, doğrulama tamamlandıktan sonra da gösteriliyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Low                                                   |
| Durum               | Aday                                                  |
| Konum               | `src/components/account/IdentityVerification.tsx:127` |
| Kullanıcılar        | misafir, ev sahibi                                    |
| Prensip             | learnability · predictability                         |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                          |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | area:account2                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p043)                       |

**Kanıt:** IdentityVerification.tsx:89-90 `const showHost = data?.required.host && (...)`, `const showGuest = data?.required.guest;` durum kontrolü yok; :126-127 VERIFIED kullanıcıya da "Misafirlerin rezervasyon için kimliğini doğrulaması gerekir." gösteriliyor.

**Etki:** Doğrulanmış kullanıcı ek bir işlem gerekip gerekmediğinden emin olamıyor.

**Önerilen aksiyon:** `showHost`/`showGuest` koşullarına `data.status !== "VERIFIED"` ekleyin; VERIFIED'de "Rezervasyon için gereken doğrulama tamam." gibi olumlu teyit gösterin.

**Yapılan düzeltme:** Confirmed. When the status is VERIFIED, the requirement lines are replaced by positive confirmations, requiredHostDone and requiredGuestDone; requiredHost and requiredGuest are shown only when the user is not verified.

## F1181 — Yeni passkey'in ödeme doğrulamasında 24 saat kullanılamayacağı söylenmiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/account/PasskeyManager.tsx:77` |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · predictability                  |
| Sezgisel madde      | H13 — Feedforward                              |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:account                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p044)                |

**Kanıt:** PasskeyManager.tsx:77 başarı mesajı 'Passkey eklendi.' (account.json:62). Sunucuda passkey.ts:258 'yeni passkey'ler 24 saat bekler' kuralı var. Bu sürede pay.ts:300-310 3DS'e düşüyor. Bölüm açıklaması (account.json:50) passkey'i riskli ödemeler için öneriyor.

**Etki:** Riskli bir ödemeden hemen önce passkey ekleyen misafir yine 3DS ya da farklı bir doğrulama ile karşılaşıyor ve sistemin tutarsız davrandığını düşünüyor.

**Önerilen aksiyon:** addedOk metnini şöyle genişletin: 'Passkey eklendi. Girişte hemen, ödeme doğrulamasında güvenliğiniz için 24 saat sonra kullanılabilir.'

**Yapılan düzeltme:** Confirmed in passkey.ts: PASSKEY_STEP_UP_COOLDOWN_HOURS (default 24) applies only to step-up, so login and reauth work right away. Changed the text of account.passkeys.addedOk, which is used only in PasskeyManager, to say the passkey works for sign-in now and for payment verification after 24 hours.

## F1182 — Passkey tarihleri UTC takvim günü olarak ve saatsiz gösteriliyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/account/PasskeyManager.tsx:128` |
| Kullanıcılar        | tümü                                            |
| Prensip             | learnability · consistency                      |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                     |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:account                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p044)                 |

**Kanıt:** PasskeyManager.tsx:128-129 `fmt.date(p.createdAt)` çağrısı format.ts'deki `date(value, style = "short", timeZone = "UTC")` varsayılanına düşüyor. TR saatiyle 01:30'da eklenen passkey bir önceki günün tarihiyle görünüyor. SessionManager.tsx:123-125 ise yerel saatli fmt.dateTime kullanıyor.

**Etki:** Güvenlik denetimi yapan kullanıcı 'son kullanım' zamanını yanlış günle görüyor ve saat bilgisi olmadığı için yetkisiz kullanımı fark edemiyor.

**Önerilen aksiyon:** createdAt ve lastUsedAt için fmt.dateTime(...) kullanın ya da timeZone parametresini vermeden yerel saat dilimiyle biçimlendirin.

**Yapılan düzeltme:** Confirmed: fmt.date defaults to the UTC time zone and shows no time. createdAt and lastUsedAt now use fmt.dateTime, which uses the local time zone and includes the time; so do the new delete aria-label and the confirm body. There is no hydration risk, because the list loads on the client after mount.

## F1183 — Escape işlem sürerken de pencereyi kapatıyor, devre dışı 'Vazgeç' düğmesiyle tutarsız

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/components/account/ReauthDialog.tsx:45` |
| Kullanıcılar        | tümü                                         |
| Prensip             | learnability · consistency                   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                  |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:account                                 |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p045)             |

**Kanıt:** ReauthDialog.tsx:44-46 `if (e.key === "Escape") onCancel();` busy durumuna bakmıyor ve window'a bağlı. Öte yandan 'Vazgeç' düğmesi 127'de `disabled={busy}`.

**Etki:** Doğrulama isteği sürerken Escape'e basılırsa pencere kapanıyor ve 'iptal edildi' hatası çıkıyor. Ama sunucu oturumu tazelemiş olabilir, kullanıcı sonucun ne olduğunu anlamıyor.

**Önerilen aksiyon:** busy iken Escape'i yok sayın ya da AbortController ile isteği gerçekten iptal edip bunu bildirin. Dinleyiciyi window yerine pencere öğesine bağlayın.

**Yapılan düzeltme:** Not reproducible in the current code. The dialog is a native <dialog>, and Escape goes through its onCancel handler on the dialog element, not on window. That handler calls e.preventDefault() and only calls onCancel() when !busy, which matches the aria-disabled Vazgeç button.

## F1184 — Parola hatası alana programatik olarak bağlanmıyor, hatadan sonra odak alana dönmüyor

| Alan                | Değer                                                         |
| ------------------- | ------------------------------------------------------------- |
| Severity            | Low                                                           |
| Durum               | Aday                                                          |
| Konum               | `src/components/account/ReauthDialog.tsx:92`                  |
| Kullanıcılar        | tümü                                                          |
| Prensip             | accessibility · Error Identification / Info and Relationships |
| Sezgisel madde      | H14 — Erişilebilirlik                                         |
| WCAG                | 3.3.1                                                         |
| Renk/tema           | Hayır                                                         |
| Efor                | S                                                             |
| Kaynak denetçiler   | area:account                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p045)                               |

**Kanıt:** ReauthDialog.tsx:92-100 input'ta aria-invalid ve aria-describedby yok. 101-105 hata `<p role="alert">` öğesinin id'si yok. Hatadan sonra (63 `setBusy(false)`) odak düğmede kalıyor. Projede ui.tsx:47-88'deki Field bileşeni bu bağlantıyı zaten kuruyor.

**Etki:** Ekran okuyucu kullanıcısı alana döndüğünde alanın hatalı olduğunu duymuyor. Klavye kullanıcısı yeniden yazmak için alana kendisi dönmek zorunda.

**Önerilen aksiyon:** Hata paragrafına id="reauth-error" verin. Input'a `aria-invalid={!!error}` ve `aria-describedby="reauth-desc reauth-error"` ekleyin. Hata sonrasında `input.current?.select()` ile odağı alana taşıyın.

**Yapılan düzeltme:** Mostly fixed already: the input had aria-invalid and an aria-describedby pointing at a useId error id, the error has role=alert, and focus went back to the input after a password failure. I added input.select() after the focus so a wrong password can be retyped right away.

## F1185 — Yeniden doğrulama formunda parola yöneticisi için kullanıcı adı bağlamı ve 'parolayı göster' yok

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/components/account/ReauthDialog.tsx:92` |
| Kullanıcılar        | tümü                                         |
| Prensip             | flexibility · substitutivity                 |
| Sezgisel madde      | H7 — Esneklik/verim                          |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:account                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p045)              |

**Kanıt:** ReauthDialog.tsx:82-100 formda yalnızca `type="password" autoComplete="current-password"` alanı var. E-postayı taşıyan gizli bir `autocomplete="username"` alanı yok, parolayı göster/gizle düğmesi de yok.

**Etki:** Parola yöneticileri hangi hesap için doldurduğunu bilemeyebiliyor. Mobilde parolayı elle yazan kullanıcı yazım hatasını göremiyor.

**Önerilen aksiyon:** Kullanıcı e-postasını taşıyan readonly ve görsel olarak gizli bir `<input autoComplete="username">` ekleyin. aria-pressed kullanan bir 'Parolayı göster' düğmesi ekleyin.

**Yapılan düzeltme:** Added a hidden readonly <input type=email autoComplete=username> filled with the session email from fetchCurrentUser, so password managers know which account the password is for. The password field now has name=password, autoCapitalize=none, autoCorrect=off and spellCheck=false. Added a 'Parolayı göster' checkbox (new key showPassword) with a 44px-tall label that switches the field between password and text. I did not reuse the eye-icon PasswordRevealInput, because p023 is still creating it and it is not committed yet.

## F1186 — Passkey ile doğrulama sürerken 'Doğrulanıyor...' yazısı parola düğmesinde çıkıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/account/ReauthDialog.tsx:112` |
| Kullanıcılar        | tümü                                          |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H12 — Feedback                                |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:account                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p045)               |

**Kanıt:** ReauthDialog.tsx:112 parola gönderme düğmesinde `{busy ? t("verifying") : t("verify")}`. Passkey düğmesinin etiketi (118-121) busy iken de 'Passkey ile doğrula' olarak kalıyor.

**Etki:** Kullanıcı cihazındaki passkey istemini beklemesi gerektiğini anlamıyor ve parola yolunun çalıştığını sanıyor.

**Önerilen aksiyon:** Hangi yolun çalıştığını `mode: "password" | "passkey"` ile tutun. Passkey düğmesinde 'Cihazınızdaki istemi onaylayın…' yazsın ve forma aria-busy="true" verilsin.

**Yapılan düzeltme:** Replaced the busy boolean with mode: "password" \| "passkey" \| null, so busy = mode !== null. 'Doğrulanıyor...' now appears only on the password button. During passkey auth the passkey button reads the new passkeyPrompt text, 'Cihazınızdaki istemi onaylayın…'. An sr-only role=status region announces which path is in progress, and the form keeps aria-busy.

## F1187 — Kullanıcının kendi vazgeçtiği doğrulama kırmızı hata uyarısı olarak duyuruluyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/account/SessionManager.tsx:38` |
| Diğer konumlar      | `src/components/account/PasskeyManager.tsx:39` |
| Kullanıcılar        | tümü                                           |
| Prensip             | robustness · recoverability                    |
| Sezgisel madde      | H9 — Hata mesajları                            |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:account                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p046)                |

**Kanıt:** SessionManager.tsx:38 `if (err instanceof ReauthCancelledError) return tr("cancelled");` sonucu 84'te kind "error" oluyor ve role="alert" ile kırmızı gösteriliyor. PasskeyManager.tsx:39'da da aynısı.

**Etki:** Bilerek 'Vazgeç' diyen kullanıcı bir hata yaptığını sanıyor ve ekran okuyucu bunu acil bir uyarı olarak bölüyor.

**Önerilen aksiyon:** ReauthCancelledError gelince status'u null bırakın ya da nötr bir role="status" ile 'İşlem yapılmadı' yazın.

**Yapılan düzeltme:** Confirmed: a ReauthCancelledError became a red role=alert. It is now caught explicitly: status stays null, the button is released, and there is no reload, since nothing changed.

## F1188 — Toplu oturum kapatmada kaç oturumun kapatıldığı bildirilmiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/account/SessionManager.tsx:81` |
| Kullanıcılar        | tümü                                           |
| Prensip             | robustness · observability                     |
| Sezgisel madde      | H12 — Feedback                                 |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:account                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p046)                |

**Kanıt:** SessionManager.tsx:81 scope=others için de tekil 'Oturum kapatıldı' (account.json:100) mesajını veriyor. API ise `{ revoked: count }` döndürüyor (sessions/route.ts:30). 154'teki düğme etiketi 90'da hesaplanan `others` sayısını göstermiyor.

**Etki:** Kullanıcı işlemden önce kaç cihazın etkileneceğini, sonra da kaçının kapatıldığını bilmiyor.

**Önerilen aksiyon:** Düğme etiketini 'Diğer {count} oturumu kapat' yapın. Başarı mesajı için '{count} oturum kapatıldı' metniyle plural ICU kullanın.

**Yapılan düzeltme:** Confirmed. The 'others' button now reads revokeOthers with an ICU plural count ('Diğer {count} oturumu kapat'; the key is used only here). After the DELETE, the success text uses the new revokedCount plural built from the API's {revoked} value. Single-session revokes keep revokedOk.

## F1189 — Sadakat rozetinde genel <span> üzerinde aria-label kullanılıyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/account/WalletPanel.tsx:41` |
| Kullanıcılar        | misafir                                     |
| Prensip             | accessibility · Name, Role, Value           |
| Sezgisel madde      | H14 — Erişilebilirlik                       |
| WCAG                | 4.1.2                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:account2                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p052)             |

**Kanıt:** WalletPanel.tsx:40-45 `<span aria-label={t("tierAria", { tier: name })} ...>{t("tierBadge", { tier: name })}</span>` — rolü olmayan span'de aria-label ARIA 1.2'de desteklenmiyor; ekran okuyucular çoğunlukla yok sayıyor, bazıları görünür metinle çelişen etiketi okuyor.

**Etki:** Ekran okuyucu kullanıcıları arasında tutarsız duyurum; 'Sadakat seviyesi' bağlamı bazılarında hiç okunmuyor.

**Önerilen aksiyon:** aria-label'ı kaldırıp `<span className="sr-only">{t("tierAriaPrefix")} </span>` ("Sadakat seviyesi:") ile görünür metni birleştirin ya da span'e `role="img"` vermek yerine düz metinle bırakın.

**Yapılan düzeltme:** Confirmed. Removed aria-label from the role-less span in TierBadge. An sr-only prefix span ('Sadakat programı:' / 'Loyalty program:', new key wallet.tierPrefix) now sits in front of the visible text, so screen readers hear 'Sadakat programı: Altın seviyesi'. wallet.tierAria is no longer used, but I left it in the messages.

## F1190 — Eşzamansız eylemlerde bekleme durumu yok: yetki iptali ve veri dışa aktarma

| Alan                | Değer                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                           |
| Durum               | Aday                                                                                          |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:61`                                                 |
| Diğer konumlar      | `src/components/account/AgentMandates.tsx:213`, `src/components/privacy/PrivacyCenter.tsx:35` |
| Kullanıcılar        | tümü                                                                                          |
| Prensip             | robustness · responsiveness                                                                   |
| Sezgisel madde      | H15 — Performans                                                                              |
| Renk/tema           | Hayır                                                                                         |
| Efor                | S                                                                                             |
| Kaynak denetçiler   | area:account2                                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p097)                                                               |

**Kanıt:** PrivacyCenter.tsx:61 `<Button onClick={download}>{t("exportButton")}</Button>` — busy/disabled yok; büyük veri setinde istek sürerken tekrar tıklama birden fazla indirme başlatıyor. AgentMandates.tsx:213-215 iptal düğmesi istek sırasında etkin kalıyor ve metni değişmiyor. Ek olarak PrivacyCenter.tsx:33-35 `a.click(); a.remove(); URL.revokeObjectURL(url);` nesne URL'sini aynı tikte iptal ediyor (bazı mobil tarayıcılarda indirmenin başlamamasına yol açabilir).

**Etki:** Yavaş ağdaki kullanıcı tıklamanın algılanıp algılanmadığını bilmiyor; tekrar tekrar basıyor, birden çok dosya iniyor.

**Önerilen aksiyon:** download() ve revoke() için ayrı `exporting` / `revokingNonce` state'i tutun; düğmeyi `disabled` + `aria-busy` yapıp metni "Hazırlanıyor…" / "İptal ediliyor…" olarak değiştirin; `URL.revokeObjectURL`'ü `setTimeout(..., 0)` ya da birkaç saniye sonrasına erteleyin.

**Yapılan düzeltme:** PrivacyCenter part: export busy state as in F1089, plus the object URL is no longer revoked in the same tick. It is kept in state for the fallback link and revoked in an effect cleanup on the next export or on unmount. The AgentMandates revoke button belongs to another package's file and was not touched.

## F1191 — Devre dışı 'Evet, hesabımı sil' düğmesinin neden pasif olduğu programatik olarak bağlanmamış

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/privacy/PrivacyCenter.tsx:92` |
| Kullanıcılar        | tümü                                          |
| Prensip             | accessibility · Info and Relationships        |
| Sezgisel madde      | H13 — Feedforward                             |
| WCAG                | 1.3.1                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:account2                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p097)               |

**Kanıt:** PrivacyCenter.tsx:92 `<Button variant="danger" disabled={!acknowledged || busy} onClick={remove}>` — `disabled` düğme sekme sırasından çıkıyor; onay kutusuyla ilişki `aria-describedby` ile kurulmuyor. Onay kutusu :80-86 `h-4 w-4` (16px; etiket tıklanabilir olduğu için hedef boyutu telafi ediliyor).

**Etki:** Ekran okuyucu kullanıcısı Tab ile 'Vazgeç'e atlıyor, silme düğmesinin varlığını ve etkinleştirme koşulunu kaçırabiliyor.

**Önerilen aksiyon:** `disabled` yerine `aria-disabled={!acknowledged}` kullanıp onClick'te onay yoksa onay kutusuna odak verin; düğmeye `aria-describedby="delete-ack-label"` ekleyip etikete bu id'yi verin.

**Yapılan düzeltme:** Confirmed. The 'Evet, hesabımı sil' button now uses aria-disabled instead of disabled, so it stays in the tab order. Until the checkbox is ticked the button has aria-describedby pointing at the checkbox label (id=delete-ack-label). Clicking it without the checkbox ticked moves focus to the checkbox.
