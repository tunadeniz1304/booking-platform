# Rezervasyon detayı, mesajlaşma, seyahatler — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 76 bulgu · Severity: Critical 1, High 10, Medium 42, Low 23

## F9 — Ev sahibi hasar talebi açamıyor: 'Hasar talebi aç' formu yalnız misafirin erişebildiği /booking/[id] sayfasında

| Alan                | Değer                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Critical                                                                                                                                                     |
| Durum               | Gözlemlendi                                                                                                                                                  |
| Konum               | `src/app/booking/[id]/page.tsx:178`                                                                                                                          |
| Diğer konumlar      | `src/lib/booking-service.ts`, `src/components/host/HostDashboard.tsx`, `src/components/resolution/BookingResolutionPanel.tsx`, `src/app/resolution/page.tsx` |
| Kullanıcılar        | ev sahibi                                                                                                                                                    |
| Prensip             | learnability · Görev uygunluğu / ulaşılabilirlik (Dix: learnability – predictability; flexibility – task migratability)                                      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                                                        |
| Efor                | M                                                                                                                                                            |
| Kaynak denetçiler   | runtime:resolution                                                                                                                                           |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: trips)                                                                                                                         |

**Kanıt:** RUNTIME p7-host (host, desktop, TR): ev sahibinin rezervasyonu /booking/cmv2uyfom0o6i92w2pxo0j5nw açılınca sayfa "Hata ¦ Rezervasyon bulunamadı ¦ Ana sayfaya dön" gösterdi (C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/resolution/shots/host-booking.png). Sebep booking-service.ts:940 `requireOwnership(booking.userId, …)`: sayfayı yalnız rezervasyonun misafiri görebiliyor. OpenClaimForm'un role=HOST dalı ("Hasar talebi aç", resolution.json:84,86) yalnızca BookingResolutionPanel içinde, o da yalnızca bu sayfada render ediliyor (page.tsx:178-180). Grep sonucu başka bir mount noktası yok. /host panelindeki "Çözüm merkezi (hasar talepleri)" bağlantısı (HostDashboard.tsx:105-108) /resolution sayfasına gidiyor. Orada host için yalnızca "Taleplerim ¦ Henüz bir talebiniz yok." var, form ya da yönlendirme yok (page-host-tr-_resolution.png).

**Etki:** Ev sahibi depozito tanımlayabiliyor ama hasar olduğunda talep açacak bir yer bulamıyor. Depozito özelliği işlevsiz kalıyor, hasar bedeli tahsil edilemiyor (para kaybı) ve host destek kanallarına yöneliyor.

**Önerilen aksiyon:** BookingResolutionPanel'i ev sahibinin rezervasyon bağlamına da yerleştirin: /host/messages/[bookingId] ya da yeni bir /host/bookings/[id] sayfası. Panelin deposit uç noktası zaten role=HOST döndürüyor. Ek olarak /resolution sayfasında HOST rolü için "Hasar talebi aç" butonu olsun, uygun (süresi açık) rezervasyonlar seçilebilsin. HostDashboard'daki bağlantı metni gerçekten talep açılabilen yere gitsin.

**Yapılan düzeltme:** I added BookingResolutionPanel (deposit, claims and the host's 'Hasar talebi aç' form) to the host booking page src/app/host/messages/[bookingId]/page.tsx, in the same card under the messages, so a host can now open a claim from the booking context. Still open, owned by other files: the host button on /resolution and the HostDashboard link text. — dosyalar: `src/app/host/messages/[bookingId]/page.tsx`

## F70 — Ev sahibi mesaj sayfasında h1 yok ve konuşma bağlamı (misafir, mülk, tarih, durum) hiç gösterilmiyor

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | High                                                             |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                  |
| Konum               | `src/app/host/messages/[bookingId]/page.tsx:17`                  |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx`                     |
| Kullanıcılar        | ev sahibi                                                        |
| Prensip             | learnability · Synthesizability / recognition over recall        |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                          |
| WCAG                | 1.3.1 Info and Relationships (A), 2.4.6 Headings and Labels (AA) |
| Renk/tema           | Hayır                                                            |
| Efor                | M                                                                |
| Kaynak denetçiler   | runtime:trips, area:trips                                        |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: trips)                             |

**Kanıt:** Tarama 100/101 (host, 1280x800 ve 390x844): h1=[], axe 'page-has-heading-one'; başlıklar yalnız 'H2: Mesajlar'. p-host.mts (HOST rolü, API taklit): main metni '← Ev sahibi paneli Mesajlar Güvenliğiniz için… Misafir: Merhaba, erken giriş mümkün mü? … Gönder Yanıt taslağı öner' — misafir adı, mülk adı, giriş/çıkış tarihi, rezervasyon durumu yok; tek bağlantı '/host'. Kartın en üstünde boş bir ayırıcı çizgi var (section border-t pt-6, BookingMessages.tsx:127, kart p-8 içinde) — ekran crops/booking/100-host-…-0.png. Geri bağlantısı '← Ev sahibi paneli' 114x19 px ve ok karakteri metnin parçası (SR 'sol ok' okur).

**Etki:** Birden çok rezervasyonu olan ev sahibi kime yanıt verdiğini doğrulayamıyor (yanlış misafire bilgi verme riski); ekran okuyucu kullanıcısı sayfanın konusunu başlıktan alamıyor.

**Önerilen aksiyon:** Thread yanıtına (veya ayrı host uç noktasına) {guestFirstName, propertyTitle, roomName, checkIn, checkOut, status} ekleyin; sayfada h1 'Mesajlar — {misafir}, {mülk}' ve altında tarih/durum dl'si gösterin; BookingMessages'a headingLevel prop'u verip bu sayfada başlık hiyerarşisini düzeltin. Kart içindeki border-t'yi bu sayfada kaldırın; ok karakterini aria-hidden span'e alın, bağlantıya py-2 verin.

**Yapılan düzeltme:** Host page: added an h1 (host.messagesPage.title) and an intro sentence. The back-link arrow now sits in an aria-hidden span; the link got py-2 and focusRing. BookingMessages got a new divider prop; the host page passes divider={false}, which removes the empty border-t at the top of the card. Heading order is now h1 > h2. Not done: guest name, property, dates and status, because the thread response doesn't include them and the host can't access /api/bookings/:id (skipped: needs backend/API change). — dosyalar: `src/app/host/messages/[bookingId]/page.tsx`, `src/components/booking/BookingMessages.tsx`

## F152 — Oturumsuz ev sahibi mesaj sayfası ham sunucu hatası gösteriyor; giriş yolu yok; EN arayüzde Türkçe metin

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | High                                                 |
| Durum               | Gözlemlendi                                          |
| Konum               | `src/components/booking/BookingMessages.tsx:121`     |
| Diğer konumlar      | `src/app/host/messages/[bookingId]/page.tsx`         |
| Kullanıcılar        | ev sahibi                                            |
| Prensip             | robustness · Recoverability (forward error recovery) |
| Sezgisel madde      | H9 — Hata mesajları                                  |
| WCAG                | 3.1.2 Language of Parts (AA)                         |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | runtime:trips                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: trips)                        |

**Kanıt:** anon.mjs (1280x800): TR /host/messages/cmv2uyfom0o6i92w2pxo0j5nw main metni '← Ev sahibi paneli Mesajlar Oturum açmanız gerekiyor'; EN aynı sayfa '← Host dashboard Messages Oturum açmanız gerekiyor' (lang=en sayfada Türkçe, lang işaretsiz); main içinde yalnız '/host' bağlantısı, h1 yok, 6 konsol hatası. Ekran: scratchpad/runtime/probes/booking/anon-en-_host_messages_cmv2uyfom0o6i92w2pxo0j5nw.png. Aynı durumda /booking/<id> düzgün 'Giriş gerekli' + 'Giriş Yap' gösteriyor (tutarsız).

**Etki:** E-postadaki bağlantıdan gelen ve oturumu düşmüş ev sahibi çıkmaz sokakta kalıyor; EN kullanıcı hatayı okuyamıyor.

**Önerilen aksiyon:** BookingMessages catch bloğunda ApiError.status===401 için t('loginRequired') + /login?redirect=<mevcut yol> bağlantısı gösterin; sunucu mesajını doğrudan basmak yerine code->çeviri anahtarı eşlemesi yapın. Host sayfasını RoleGate (ui.tsx) roles=['HOST'] ile sarın.

**Yapılan düzeltme:** BookingMessages: an ApiError 401 on load, send or draft now shows chat.loginRequired with a loginHref() link that returns to the current page. 403/404 map to the chat.notFound translation. Other errors go through useErrorText (common.errors mapping), with the translated fallback when there is no code; the raw server message is no longer printed. The host page is wrapped in RoleGate roles=['HOST'] (login link when signed out). The booking detail page's login link now uses loginHref() too. — dosyalar: `src/components/booking/BookingMessages.tsx`, `src/app/host/messages/[bookingId]/page.tsx`, `src/app/booking/[id]/page.tsx`

## F153 — Mesaj gönderildikten (veya hata aldıktan) sonra klavye odağı body'ye düşüyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | High                                               |
| Durum               | Gözlemlendi                                        |
| Konum               | `src/components/booking/BookingMessages.tsx:199`   |
| Kullanıcılar        | misafir, ev sahibi                                 |
| Prensip             | accessibility · Observability / dialog sürekliliği |
| Sezgisel madde      | H14 — Erişilebilirlik                              |
| WCAG                | 2.4.3 Focus Order (A)                              |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | runtime:trips                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: trips)                      |

**Kanıt:** p-booking.mts (1280x800 TR, API taklit): textarea -> Tab -> odak 'button Gönder' -> Enter; başarıdan sonra document.activeElement = body, textarea değeri ''. Hata yolunda (2500 karakter) da 'focus: body'. Neden: düğme disabled={busy || !text.trim()} — gönderim sırasında ve metin temizlenince odaktaki düğme devre dışı kalıyor. Ev sahibi sayfasında 'Yanıt taslağı öner' sonrası da odak body (p-host.mts).

**Etki:** Klavye/ekran okuyucu kullanıcısı her mesajdan sonra sayfanın başından tekrar gezinmek zorunda; ardışık mesajlaşma pratikte kullanılamaz hâle geliyor.

**Önerilen aksiyon:** Gönderim başarılı/başarısız olduğunda textareaRef.current.focus() çağırın. Meşgulken disabled yerine aria-disabled='true' + handler içinde erken return kullanın; boş metin için düğmeyi DOM'da odaklanabilir bırakıp aria-disabled ile işaretleyin.

**Yapılan düzeltme:** The 'Gönder' and 'Yanıt taslağı öner' buttons now use aria-disabled and aria-busy instead of disabled, with an early return in the handlers so a double submit can't happen. They keep the same opacity through aria-disabled:opacity-50 and are min-h-[44px] on mobile. In finally, focus returns to the textarea via inputRef. The error text is in an aria-live wrapper and linked to the textarea with aria-describedby/aria-invalid (the extra role=alert was removed). — dosyalar: `src/components/booking/BookingMessages.tsx`

## F154 — Bildirim izni reddedilince buton kalkıyor, odak kayboluyor ve durum ekran okuyucuya duyurulmuyor; 'kapat' (default) sonucunda hiç geri bildirim yok

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | High                                              |
| Durum               | Gözlemlendi                                       |
| Konum               | `src/components/pwa/PushToggle.tsx:61`            |
| Diğer konumlar      | `src/components/ui/ui.tsx`                        |
| Kullanıcılar        | misafir                                           |
| Prensip             | accessibility · Observability / responsiveness    |
| Sezgisel madde      | H12 — Feedback                                    |
| WCAG                | 4.1.3 Status Messages (AA), 2.4.3 Focus Order (A) |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | runtime:trips                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: trips)                     |

**Kanıt:** p-trips.mts (390x844 TR; /api/push/subscription -> enabled:true taklit; Notification.permission/requestPermission init script ile yönetildi): 'Bu cihazda bildirimleri aç' odak+Enter, izin 'denied' -> data-state='denied', metin 'Bildirim izni reddedildi. Tarayıcı ayarlarından izin verebilirsiniz.' bir aria-live/role=status içinde değil (inLive=false, <Status> bölgesi boş), odak body. İzin 'default' (pencere kapatıldı) -> state 'off', aynı düğme geri geliyor, hiçbir mesaj yok. Ekran: scratchpad/runtime/probes/booking/trips-denied.png.

**Etki:** Ekran okuyucu kullanıcısı düğmeye basınca sessizlik duyar ve odağını kaybeder; görsel kullanıcı 'default' durumunda neden açılmadığını anlamaz, tekrar tekrar dener.

**Önerilen aksiyon:** Durum metnini mevcut <Status message=…> (aria-live) bölgesine yazın; buton kaldırıldığında odağı tabIndex=-1 durum paragrafına taşıyın. 'default' için 'İzin verilmedi; tekrar deneyebilirsiniz' mesajı gösterin. Reddedilmişte tarayıcıya göre izin açma adımlarına yardım bağlantısı ekleyin.

**Yapılan düzeltme:** PushToggle: the state texts (unsupported, server-off, denied, enabled) are now inside an aria-live='polite' region that is always mounted. On 'default' (prompt closed) the Status region announces pwa.push.dismissed; after turning off it announces pwa.push.disabledDone. Denied now also shows deniedHelp with steps to allow it in the browser. After an action, focus goes to the new button; if no button remains (denied), it goes to the state paragraph (tabIndex=-1). The Button busy prop is used instead of disabled, so focus is not lost. — dosyalar: `src/components/pwa/PushToggle.tsx`

## F177 — Mesaj listesi yüklenince ve her yeni mesajda tüm sayfayı aşağı kaydırıyor

| Alan                | Değer                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Severity            | High                                                               |
| Durum               | Aday (2 kaynak birleşti)                                           |
| Konum               | `src/components/booking/BookingMessages.tsx:74`                    |
| Diğer konumlar      | `src/app/search/page.tsx:577`, `src/app/booking/[id]/page.tsx:174` |
| Kullanıcılar        | misafir                                                            |
| Prensip             | learnability · predictability                                      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                  |
| Renk/tema           | Hayır                                                              |
| Efor                | S                                                                  |
| Kaynak denetçiler   | area:trips, lens:mobile                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: trips)                                      |

**Kanıt:** `listRef.current?.lastElementChild?.scrollIntoView?.({ block: 'nearest' });` deps `[thread?.messages.length]` (73-75). İlk yüklemede de çalışıyor, boş durumda bile (son eleman 133'teki 'Henüz mesaj yok' li). scrollIntoView pencere dahil tüm kaydırılabilir ataları kaydırıyor. Detay sayfasında mesajlar bölümü detay, toplam, RNPL ve işlemlerden sonra geliyor (page.tsx:136-176). Masaüstü ekran görüntüsünde 'Mesajlar' başlığı 860px yüksekliğin y≈715 noktasında (v5-rnpl-plan.png); 360px mobilde liste kesin olarak ekranın altında kalıyor.

**Etki:** Onay sayfasını açan misafirin ekranı birkaç yüz ms sonra kendiliğinden mesaj listesine atlar. Durum başlığı, rezervasyon numarası ve toplam tutar görünümden çıkar. SSE ile gelen her mesaj, misafir aşağıdaki talep formunu doldururken görünümü çeker.

**Önerilen aksiyon:** Yalnız liste kabını kaydır: `const el = listRef.current; if (el) el.scrollTop = el.scrollHeight;`. Bunu yalnız kullanıcı zaten listenin dibindeyse (`el.scrollHeight - el.scrollTop - el.clientHeight < 80`) veya mesaj kullanıcının kendisininse yap. Dipte değilse 'Yeni mesaj ↓' düğmesi göster. scrollIntoView kullanma.

**Yapılan düzeltme:** Confirmed: scrollIntoView was scrolling the whole page. Now only the list container is scrolled (el.scrollTop = el.scrollHeight), and only when the user is already at the bottom (within 80px, tracked by onScroll) or has just sent their own message. No 'new message' button was added. — dosyalar: `src/components/booking/BookingMessages.tsx`

## F355 — Rezervasyon detayı, Seyahatlerim ve ev sahibi mesaj sayfasının belge başlığı yok (genel site başlığı)

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | High                                                                        |
| Durum               | Aday                                                                        |
| Konum               | `src/app/booking/[id]/page.tsx:41`                                          |
| Diğer konumlar      | `src/app/trips/page.tsx:9`, `src/app/host/messages/[bookingId]/page.tsx:11` |
| Kullanıcılar        | misafir, ev sahibi                                                          |
| Prensip             | accessibility · WCAG 2.4.2 Page Titled                                      |
| Sezgisel madde      | H14 — Erişilebilirlik                                                       |
| WCAG                | 2.4.2                                                                       |
| Renk/tema           | Hayır                                                                       |
| Efor                | S                                                                           |
| Kaynak denetçiler   | area:trips                                                                  |
| **Düzeltme durumu** | **Zaten uygun** (paket: trips)                                              |

**Kanıt:** Üç sayfa da 'use client' ve metadata tanımlamıyor. Rota klasörlerinde yalnız page.tsx var, layout.tsx yok. Başlık kök layout.tsx:14-18'deki `title: t('meta.title')` = 'booking-platform — konaklama arama ve rezervasyon (demo)' (common.json:3). Metadata yalnız privacy, property, ranking ve report sayfalarında tanımlı (grep generateMetadata).

**Etki:** Birden çok rezervasyon veya mesaj sekmesi açan kullanıcı sekmeleri ayırt edemez. Ekran okuyucu her sayfada aynı başlığı okur, tarayıcı geçmişi ve yer imleri anlamsızlaşır.

**Önerilen aksiyon:** Rota başına `layout.tsx` içinde `generateMetadata` ekle (Next 16 kuralları için önce node_modules/next/dist/docs okunmalı, bkz. AGENTS.md) ya da React 19 `<title>` öğesini bileşende render et. Örnekler: rezervasyon için `${t(`status.${status}`)} · ${property.title}`, Seyahatlerim için 'Seyahatlerim', host mesaj sayfası için 'Mesajlar · {ilan adı}'. Yükleme ve hata durumlarında da anlamlı bir başlık kullan.

**Yapılan düzeltme:** Page titles (<title>/metadata) were handled globally in wave 1. I was told not to add titles, so no change.

## F356 — Ödeme/gönderim başarısında görünüm değişiyor ama ekran okuyucu duyurusu ve odak yönetimi yok

| Alan                | Değer                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                      |
| Durum               | Aday                                                                                                                                                                                                                      |
| Konum               | `src/app/booking/[id]/page.tsx:117`                                                                                                                                                                                       |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:172`, `src/app/checkout/cart/page.tsx:176`, `src/components/compliance/NoticeForm.tsx:62`, `src/components/compliance/AppealForm.tsx:57`, `src/app/reset-password/page.tsx:37` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                   |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages / 2.4.3 Focus Order                                                                                                                                                            |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                     |
| WCAG                | 4.1.3                                                                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                                                                     |
| Efor                | S                                                                                                                                                                                                                         |
| Kaynak denetçiler   | lens:status                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: trips)                                                                                                                                                                                      |

**Kanıt:** BookingActions.tsx:172 başarıda `onChanged()` → booking/[id]/page.tsx:51-65 yeniden yükleme → 117-119 başlık 'Rezervasyonunuz onaylandı' oluyor, ödeme formu DOM'dan kalkıyor; başlık canlı bölge değil, odak body'ye düşüyor. checkout/cart/page.tsx:176-212 `done` görünümü tüm main'i değiştiriyor. compliance/NoticeForm.tsx:62 ve AppealForm.tsx:57 'sent' dalında `<Status message>` içerikle birlikte mount ediliyor (önceden var olan canlı bölge yok); reset-password/page.tsx:37 'done' AuthCard da aynı.

**Etki:** Ekran okuyucu kullanan misafir ödemenin geçip geçmediğini öğrenemiyor, tekrar ödemeye kalkışabiliyor; klavye kullanıcısı odak sayfa başına düştüğü için konumunu kaybediyor.

**Önerilen aksiyon:** booking/[id] sayfasında her zaman mount edilen `<div role="status" aria-live="polite">` ve ödeme sonrası 'Ödeme alındı, rezervasyonunuz onaylandı. Onay e-postası gönderildi.' metni; durum h1'ine `tabIndex={-1}` + `ref.focus()`. Sepet başarı h1'i, NoticeForm/AppealForm 'gönderildi' başlığı ve reset-password 'done' başlığına aynı odak taşıma; Status bileşenini koşulsuz mount et.

**Yapılan düzeltme:** booking/[id]: added an always-mounted sr-only <p role='status'>. After load(), the old and new status are compared: CONFIRMED announces 'Ödeme alındı, rezervasyonunuz onaylandı…', CANCELLED announces an 'iptal edildi' message, and any other change announces a generic message. The h1 gets tabIndex=-1 and receives focus with ref.focus() when the status changes. The heading text is unchanged (e2e tests rely on it). Still open in other owners' files: checkout/cart, NoticeForm, AppealForm, reset-password. — dosyalar: `src/app/booking/[id]/page.tsx`

## F357 — Ödeme, iptal veya bildirim açma sonrası durum değişikliği duyurulmuyor, odak kayboluyor

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | High                                                                                     |
| Durum               | Aday                                                                                     |
| Konum               | `src/app/booking/[id]/page.tsx:171`                                                      |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:169`, `src/components/pwa/PushToggle.tsx:115` |
| Kullanıcılar        | misafir                                                                                  |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages                                               |
| Sezgisel madde      | H12 — Feedback                                                                           |
| WCAG                | 4.1.3                                                                                    |
| Renk/tema           | Hayır                                                                                    |
| Efor                | M                                                                                        |
| Kaynak denetçiler   | area:trips                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: trips)                                                            |

**Kanıt:** page.tsx:171 `onChanged={() => void load()}`. BookingActions.tsx:169-172 başarılı ödemede `else onChanged();`; başarı mesajı yok. Ödeme formu (`status === 'HELD' && ...`, 265) gönder düğmesi odaktayken DOM'dan kalkıyor. h1 (page.tsx:117-119) canlı bölge değil, metin sessizce 'Rezervasyonunuz onaylandı' oluyor. PushToggle.tsx:115 `{view === 'on' && <p>{t('enabled')}</p>}` live region dışında, aç düğmesi de unmount oluyor.

**Etki:** Ekran okuyucu kullanan misafir ödeme sonrası hiçbir şey duymaz, odak body'ye düşer. Ödemenin alınıp alınmadığından emin olamaz, destek arar veya başka yoldan tekrar ödemeye çalışır. Para işleminde başarı algılanamıyor.

**Önerilen aksiyon:** page.tsx'te BookingActions koşulunun dışında kalıcı bir `<p role='status'>` bölgesi aç. load() sonrası önceki ve yeni status karşılaştırılıp 'Ödeme alındı, rezervasyonunuz onaylandı' veya 'Rezervasyon iptal edildi' yazılsın. h1'e `tabIndex={-1}` ve ref verip durum değişince `focus()` çağır. PushToggle'da `<Status message={view === 'on' ? t('enabled') : null} />` kullan ve yeni render edilen düğmeye ref ile odak ver.

**Yapılan düzeltme:** Same change as F356 (persistent status region plus focus on the h1). The PushToggle part was fixed under F154 (live region and focus on the new button). — dosyalar: `src/app/booking/[id]/page.tsx`, `src/components/pwa/PushToggle.tsx`

## F358 — Mesaj listesi klavyeyle kaydırılamıyor (Safari), sohbet rolü tanımlı değil

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | High                                             |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:132` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | accessibility · WCAG 2.1.1 Keyboard              |
| Sezgisel madde      | H14 — Erişilebilirlik                            |
| WCAG                | 2.1.1                                            |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: trips)                    |

**Kanıt:** `<ol ref={listRef} aria-live='polite' className='mt-4 max-h-80 space-y-2 overflow-y-auto'>` tabIndex olmayan bir kaydırma kabı. İçindeki öğelerde odaklanabilir bir şey yok, yalnız metin var. Chrome 130+ ve Firefox kaydırıcıyı otomatik odaklanabilir yapıyor, Safari yapmıyor.

**Etki:** Safari'de (macOS ve VoiceOver kullanıcıları dahil) yalnız klavye kullanan kişi, 320px yükseklikten taşan eski mesajları okuyamıyor.

**Önerilen aksiyon:** `<ol>` öğesine `tabIndex={0}`, `role='log'` ve `aria-labelledby='msg-title'` ekle. Global `:focus-visible` outline [tabindex] için zaten uygulanıyor (globals.css:61).

**Yapılan düzeltme:** The scrollable message container is now a <div role='log' aria-labelledby='msg-title' tabIndex={0}> wrapped around the <ol>, so list semantics are kept. role=log is polite by default, so the extra aria-live on the ol was removed. — dosyalar: `src/components/booking/BookingMessages.tsx`

## F359 — Mesaj kutusunun kenarlığı ve yer tutucusu yetersiz kontrastlı, görünür etiket yok

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | High                                                           |
| Durum               | Aday                                                           |
| Konum               | `src/components/booking/BookingMessages.tsx:187`               |
| Kullanıcılar        | misafir, ev sahibi                                             |
| Prensip             | accessibility · WCAG 1.4.11 Non-text Contrast / 1.4.3 Contrast |
| Sezgisel madde      | H14 — Erişilebilirlik                                          |
| WCAG                | 1.4.11                                                         |
| Renk/tema           | Evet — onaylandı, sonraki oturumda uygulanacak                 |
| Efor                | S                                                              |
| Kaynak denetçiler   | area:trips                                                     |
| **Düzeltme durumu** | **Onaylandı — sonraki oturumda uygulanacak (renk)**            |

**Kanıt:** `className='w-full rounded-lg border border-gray-300 p-2 text-sm'`. #d1d5db beyaz üzerinde ≈1.5:1 (eşik 3:1). Yer tutucu Tailwind preflight varsayılanı gray-400 #9ca3af, ≈2.5:1 (eşik 4.5:1). Etiket `className='sr-only'` (179). Alanın görsel olarak fark edilmesi bu iki zayıf ipucuna kalıyor (docs/img/messaging.png).

**Etki:** Az gören kullanıcılar, özellikle mobilde güneş altında, mesaj yazma alanını ve yer tutucu talimatını seçemiyor.

**Önerilen aksiyon:** Renk değişikliği gerektiren kısım: kenarlığı en az gray-500 (#6b7280, ≈4.8:1) yap ve placeholder'ı `placeholder:text-gray-500` ile koyulaştır. Bu tema rengini etkilediği için onay gerekir. Renk dışı tamamlayıcı adım: etiketi görünür yap (`sr-only` kaldırılır, bkz. ayrı etiket bulgusu). Bu yalnızca alanı metinle tanımlar, 1.4.11'i tek başına karşılamaz.

## F437 — Durum bandı her durumda yeşil: iptal, süresi dolmuş, ödeme bekleyen rezervasyonlar 'başarı' rengiyle gösteriliyor

| Alan                | Değer                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Severity            | Medium                                                                          |
| Durum               | Gözlemlendi (3 kaynak birleşti)                                                 |
| Konum               | `src/app/booking/[id]/page.tsx:116`                                             |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx`, `src/app/account/page.tsx:170-181` |
| Kullanıcılar        | misafir                                                                         |
| Prensip             | learnability · Familiarity / consistency                                        |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                     |
| WCAG                | 1.4.1 Use of Color (ihlal değil — metin var — ancak renk yanlış anlam taşıyor)  |
| Renk/tema           | Hayır                                                                           |
| Efor                | S                                                                               |
| Kaynak denetçiler   | runtime:trips, area:trips, lens:consistency                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                    |

**Kanıt:** p-variants.mts (API taklit): CANCELLED 'Rezervasyon iptal edildi', EXPIRED 'Ödeme süresi doldu', HELD 'Oda sizin için tutuluyor — ödemeyi tamamlayın', PENDING 'Rezervasyon beklemede' — hepsinde bant rgb(21,128,61) (bg-green-700). Ekran: scratchpad/runtime/probes/booking/status-CANCELLED.png. İptal sonrası (p-cancel-accept.mts, 390x844) yeşil bant + yeşil (text-green-700, BookingActions.tsx:366) 'İptal edildi. Politika gereği iade yok.' — sıfır iade 'olumlu' renkle; ekran after-cancel-mobile.png.

**Etki:** Hızlı bakan/düşük okuryazarlıklı misafir yeşili 'her şey yolunda' diye okuyor; HELD durumunda ödemenin henüz yapılmadığını kaçırabilir, iptal edilmiş rezervasyonu geçerli sanabilir.

**Önerilen aksiyon:** Paleti değiştirmeden: yeşil bandı yalnız CONFIRMED/COMPLETED'da gösterin; diğer durumlarda bandı kaldırıp mevcut beyaz kart başlığı + durum ikonu ve metin rozeti (ör. ✕ 'İptal edildi', ⏳ 'Ödeme bekleniyor') kullanın. İade bilgisini 'info' yerine nötr metinle verin.

## F449 — Ödeme bekleyen (HELD) durum, onaylanan rezervasyonla aynı yeşil başarı bandıyla gösteriliyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                               |
| Konum               | `src/app/booking/[id]/page.tsx:116`                                           |
| Kullanıcılar        | misafir                                                                       |
| Prensip             | learnability · Consistency ve familiarity: renk anlamı durumla tutarlı olmalı |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                |
| Renk/tema           | Evet — kapsam dışı                                                            |
| Efor                | S                                                                             |
| Kaynak denetçiler   | runtime:checkout, area:checkout                                               |
| **Düzeltme durumu** | **Kapsam dışı (renk/tema)**                                                   |

**Kanıt:** RUNTIME p2-guest-create.mjs: HELD sayfasında 'Oda sizin için tutuluyor — ödemeyi tamamlayın' bg-green-700 bant içinde (crops/checkout/p2-desktop-booking-s-0.png). Onaydan sonraki 'Rezervasyonunuz onaylandı' da aynı yeşil bantta (p5-retry-s-0.png); iptal ve süresi dolan durumlar da aynı sınıfı kullanıyor (sabit sınıf, page.tsx:116). İkon ya da adım etiketi yok.

**Etki:** Hızlı göz atan misafir yeşil bandı başarı olarak algılayıp ödemeyi yapmadan ayrılabilir.

**Önerilen aksiyon:** Renk dışı çözüm: başlığa durum ikonu (saat ya da onay işareti) ve 'Adım 2/2 · Ödeme bekleniyor' etiketi eklensin. Renk çözümü: bant tonu duruma göre seçilsin (HELD: nötr ya da amber, CONFIRMED: yeşil, CANCELLED/EXPIRED: gri). Renk paletine dokunduğu için kullanıcı onayı gerekir.

## F450 — Mesaj kutusunun görünür etiketi yok (yalnızca placeholder); güvenlik notu alana bağlı değil

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Gözlemlendi (2 kaynak birleşti)                  |
| Konum               | `src/components/booking/BookingMessages.tsx:179` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | accessibility · Familiarity / observability      |
| Sezgisel madde      | H6 — Tanıma > hatırlama                          |
| WCAG                | 3.3.2 Labels or Instructions (A)                 |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | runtime:trips, area:trips                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** p-booking.mts B1: label 'Mesajınız' class='sr-only'; görünür tek ipucu placeholder 'Mesajınızı yazın' (yazmaya başlayınca kayboluyor); aria-describedby=null — 'Güvenliğiniz için telefon, e-posta, IBAN ve bağlantılar otomatik gizlenir…' notu (satır 131) alana bağlı değil. Ekran crops/booking/072-guest-…-0.png ve 073-…-1.png.

**Etki:** Düşük okuryazarlık/yaşlı kullanıcılar ve bilişsel yükü yüksek mobil kullanıcılar alanın amacını yazarken kaybediyor; SR kullanıcısı maskeleme kuralını alana gelince duymuyor.

**Önerilen aksiyon:** Görünür etiket ekleyin ('Ev sahibine mesajınız' / 'Misafire mesajınız', role'e göre); safetyNotice p'sine id verip textarea aria-describedby ile bağlayın (sayaç id'si ile birlikte).

## F451 — Mesajda istemci tarafı uzunluk sınırı/sayaç yok; hata ancak gönderimden sonra geliyor ve alana bağlanmıyor

| Alan                | Değer                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Severity            | Medium                                                                 |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                        |
| Konum               | `src/components/booking/BookingMessages.tsx:182`                       |
| Diğer konumlar      | `src/lib/config/app-config.ts`, `src/lib/messaging/message-service.ts` |
| Kullanıcılar        | misafir, ev sahibi                                                     |
| Prensip             | robustness · Error prevention / responsiveness                         |
| Sezgisel madde      | H5 — Hata önleme                                                       |
| WCAG                | 3.3.1 Error Identification (A) — hata alanla ilişkilendirilmemiş       |
| Renk/tema           | Hayır                                                                  |
| Efor                | S                                                                      |
| Kaynak denetçiler   | runtime:trips, area:trips                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                           |

**Kanıt:** p-booking.mts B1/B5/B6: textarea maxLength=-1, aria-describedby=null; 2500 karakter kabul edildi, sayaç yok; Gönder -> ~1.2 sn sonra role=alert 'Mesaj en fazla 2000 karakter olabilir'; textarea aria-invalid=null, odak body. Sunucu sınırı MESSAGE_MAX_LENGTH 2000 (app-config.ts:299). Olumlu: metin korunuyor (2500).

**Etki:** Uzun check-in talimatı yazan ev sahibi sınırı ancak gönderdikten sonra öğreniyor ve neyi ne kadar kısaltacağını bilmiyor.

**Önerilen aksiyon:** Sınırı thread yanıtında (maxLength) istemciye verin; textarea'ya maxLength yerine canlı sayaç ('1980/2000', aria-describedby ile bağlı, eşik aşınca aria-live polite) ekleyin; hata p'sine id verip aria-describedby + aria-invalid ile alana bağlayın.

## F565 — Giriş bağlantıları geri dönüş adresi taşımıyor (/booking/<id> ve /trips)

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Gözlemlendi                                                  |
| Konum               | `src/app/booking/[id]/page.tsx:81`                           |
| Diğer konumlar      | `src/components/pwa/TripsView.tsx`, `src/app/login/page.tsx` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | flexibility · Task migratability / dialog sürekliliği        |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                            |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | runtime:trips                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** anon.mjs (TR/EN, 1280x800): /booking/cmv2uyf700o3c92w2ti427b8v 'Giriş Yap' href='/login'; /trips 'Giriş yap' href='/login'. Giriş sayfası ?redirect= destekliyor (src/app/login/page.tsx:63,141) ve başka akışlar kullanıyor (checkout/page.tsx:123, AddToCartButton.tsx:59).

**Etki:** Onay e-postasındaki 'rezervasyonu görüntüle' bağlantısıyla gelen misafir girişten sonra ana sayfaya atılıyor, rezervasyonu yeniden aramak zorunda.

**Önerilen aksiyon:** href={`/login?redirect=${encodeURIComponent(pathname)}`} (TripsView.tsx:91 için '/trips').

## F566 — Yazdır çıktısı: başlık/menü/footer, iptal düğmesi ve formlar basılıyor; onay bandı soluk, 2 sayfa

| Alan                | Değer                              |
| ------------------- | ---------------------------------- |
| Severity            | Medium                             |
| Durum               | Gözlemlendi                        |
| Konum               | `src/app/booking/[id]/page.tsx:95` |
| Kullanıcılar        | misafir                            |
| Prensip             | learnability · Task conformance    |
| Sezgisel madde      | H8 — Estetik/minimal tasarım       |
| Renk/tema           | Hayır                              |
| Efor                | S                                  |
| Kaynak denetçiler   | runtime:trips                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**       |

**Kanıt:** p-print-sse.mts emulateMedia('print'): görünür öğe sayıları header 1, nav 1, footer 1, DEMO şeridi 1, iptal düğmesi 1, mesaj formu 1, talep formu 1; hiçbir stil sayfasında @media print kuralı yok, print:hidden sınıfı 0. PDF (scratchpad/runtime/probes/booking/booking-print.pdf) 2 sayfa; arka plan düştüğü için 'Rezervasyonunuz onaylandı' ve 'Konaklamayı Görüntüle' beyaz metinleri açık griye dönüyor; tema/dil seçicileri ve 'Çıkış yap' basılıyor.

**Etki:** Resepsiyonda/vize başvurusunda kullanılacak çıktı kalabalık, iki sayfa ve en önemli satır (onay durumu) okunaksız.

**Önerilen aksiyon:** Header, Footer, DEMO şeridi, BookingActions, BookingMessages, BookingResolutionPanel ve eylem satırına print:hidden; banda print:bg-white print:text-gray-900 print:border; yalnız baskıda görünen adres, giriş saati, misafir adı ve QR/kod bloğu ekleyin.

## F567 — İptal edilen/süresi dolan rezervasyonda mesaj geçmişi tamamen gizleniyor

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Medium                                                    |
| Durum               | Gözlemlendi                                               |
| Konum               | `src/app/booking/[id]/page.tsx:174`                       |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx`              |
| Kullanıcılar        | misafir                                                   |
| Prensip             | learnability · Recognition over recall / task conformance |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                   |
| Renk/tema           | Hayır                                                     |
| Efor                | S                                                         |
| Kaynak denetçiler   | runtime:trips                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                              |

**Kanıt:** p-variants.mts: CANCELLED/EXPIRED/PENDING sayfalarında başlıklar yalnız 'Grand Deluxe Hotel', 'Mesajlar' bölümü yok. p-cancel-accept.mts: thread'de 'İade konusunu konuşalım' ev sahibi mesajı varken iptalden sonra messagesSectionVisible=false, mesaj görünmüyor. BookingMessages zaten salt-okunur modu destekliyor (canWrite=false -> 'Mesajlaşma yalnızca onaylı rezervasyonlarda açıktır.', satır 216-218) ama sayfa bileşeni yalnız CONFIRMED/COMPLETED'da render ediyor.

**Etki:** Uyuşmazlık/iade sürecinin tam ortasında misafir ev sahibiyle yaptığı yazılı anlaşmalara erişemiyor.

**Önerilen aksiyon:** BookingMessages'ı tüm durumlarda render edin; yazma izni sunucunun canWrite alanına bırakılsın (salt-okunur geçmiş + 'kapalı' notu).

## F568 — Fatura indirme yolu arayüzde yok (API mevcut)

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Gözlemlendi                                  |
| Konum               | `src/app/booking/[id]/page.tsx:182`          |
| Diğer konumlar      | `src/app/api/bookings/[id]/invoice/route.ts` |
| Kullanıcılar        | misafir                                      |
| Prensip             | learnability · Synthesizability / görünürlük |
| Sezgisel madde      | H6 — Tanıma > hatırlama                      |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | runtime:trips                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** Gerçek oturumlu tarama 072/073 gövde metni ve Tab sırası: 'Rezervasyonu iptal et', textarea, 'Çözüm merkezine git', talep alanları, 'Talebi gönder', 'Konaklamayı Görüntüle', 'Rezervasyonlarım', 'Yazdır' — fatura/invoice yok. src altında hiçbir .tsx '/invoice' referansı yok (grep). GET /api/bookings/<id>/invoice anon curl -> 401 JSON (rota canlı); route.ts:7 'Mock e-Arşiv fatura PDF'i (yalnızca rezervasyon sahibi; CONFIRMED/COMPLETED)'.

**Etki:** Masraf beyanı için fatura isteyen misafir destek talebi açmak zorunda; özellik keşfedilemez.

**Önerilen aksiyon:** CONFIRMED/COMPLETED için eylem satırına 'Faturayı indir (PDF)' bağlantısı ekleyin: href=`/api/bookings/${id}/invoice`, dosya türü ipucu ile.

## F569 — Canlı bağlantı yeniden kurulunca kaçırılan mesajlar gelmiyor; bağlantı durumu gösterilmiyor

| Alan                | Değer                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Severity            | Medium                                                                           |
| Durum               | Gözlemlendi                                                                      |
| Konum               | `src/components/booking/BookingMessages.tsx:59`                                  |
| Diğer konumlar      | `src/app/api/bookings/[id]/messages/stream/route.ts`, `src/lib/messaging/hub.ts` |
| Kullanıcılar        | misafir, ev sahibi                                                               |
| Prensip             | robustness · Observability / responsiveness                                      |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                   |
| Renk/tema           | Hayır                                                                            |
| Efor                | M                                                                                |
| Kaynak denetçiler   | runtime:trips                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                     |

**Kanıt:** p-print-sse.mts (akış taklidi her bağlantıda kapanıyor = ağ kopması simülasyonu): bağlantı arasında 'sunucuya' eklenen 'Kapı kodu değişti, lütfen bu mesajı okuyun' mesajı 13 yeniden bağlanma boyunca hiç gösterilmedi; thread GET sayısı 2'de kaldı (yalnız ilk yükleme). Akış olaylarında id: alanı yok (stream/route.ts:85) -> Last-Event-ID kullanılamaz; hub.ts:51 yorumu 'istemci GET ile yakalar' diyor ama istemci yeniden bağlantıda GET yapmıyor. 429 TOO_MANY_STREAMS (route.ts:66-71) durumunda EventSource kalıcı kapanır, UI'da gösterge yok (sayfada bağlantı durumu öğesi bulunamadı).

**Etki:** Mobil ağ değişiminde/uyku sonrası gelen kritik mesajlar (kapı kodu, gecikme) sayfa yenilenene kadar görünmüyor; kullanıcı 'canlı' olduğunu varsayıyor.

**Önerilen aksiyon:** es.onopen'da (ilk açılış hariç) thread'i yeniden GET edip add() ile birleştirin; olaylara id: ekleyip Last-Event-ID desteği verin; es.onerror'da readyState===CLOSED ise 'Canlı güncelleme durdu — Yenile' düğmesi gösterin; 30-60 sn yedek yoklama ekleyin.

## F570 — Gönderim sürerken yazılan metin başarıdan sonra siliniyor; meşgul durumu metinle bildirilmiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Gözlemlendi                                     |
| Konum               | `src/components/booking/BookingMessages.tsx:88` |
| Kullanıcılar        | misafir, ev sahibi                              |
| Prensip             | robustness · Responsiveness / recoverability    |
| Sezgisel madde      | H12 — Feedback                                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | runtime:trips                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** p-variants.mts RACE (POST 2 sn geciktirildi): gönderim sırasında ' Ayrıca otopark var mı?' yazıldı -> değer 'Merhaba, saat kaçta giriş yapabiliriz? Ayrıca otopark var mı?'; yanıt gelince değer '' ve sunucuya yalnız ilk cümle gitti (ikinci soru kayboldu). p-booking.mts B8: gönderim sırasında düğme metni 'Gönder' kalıyor (yalnız disabled), textarea düzenlenebilir.

**Etki:** Yavaş mobil ağda (hedef kitle) ardışık soru yazan misafirin metni sessizce kayboluyor.

**Önerilen aksiyon:** Başarıda setText(prev => prev.startsWith(sent) ? prev.slice(sent.length).trimStart() : prev) kullanın veya gönderim sırasında textarea'yı readOnly + aria-busy yapın; düğme etiketini 'Gönderiliyor…' yapın (support.json chat.sending anahtarı zaten var).

## F571 — AI taslağı ev sahibinin yazdığı metni onaysız eziyor; taslak uyarısı duyurulmuyor, AI rozeti yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Gözlemlendi                                      |
| Konum               | `src/components/booking/BookingMessages.tsx:106` |
| Diğer konumlar      | `src/components/ui/ui.tsx`                       |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · Recoverability (user control)       |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | runtime:trips                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** p-host.mts (HOST, API taklit): textarea'ya 'Evet, 12:00 gibi gelebilirsiniz; odayı hazırlıyoruz.' yazıldı -> 'Yanıt taslağı öner' Enter -> değer 'Merhaba, girişiniz 15:00 itibarıyla mümkündür. İyi yolculuklar!' ile değişti (önceki metin kayıp, geri al yok). 'Yapay zekâ taslağı — göndermeden önce kontrol edin…' notu live region'da değil, textarea'ya bağlı değil (aria-describedby null); [data-ai-generated] LlmBadge sayısı 0; odak body.

**Etki:** Ev sahibi kendi yazdığı (daha doğru) yanıtı kaybediyor; SR kullanıcısı metnin AI tarafından değiştirildiğini fark etmeyebilir ve AI metnini kontrolsüz gönderebilir.

**Önerilen aksiyon:** Metin doluysa taslağı ayrı öneri kutusunda gösterin veya 'Mevcut metni değiştir?' onayı isteyin; 'Taslağı geri al' ile önceki metni geri yükleyin; notu role=status içine alıp aria-describedby ile bağlayın, yanına <LlmBadge mode=…/> koyun; işlem bitince odağı textarea'ya verin.

## F572 — AI taslağından gönderilen mesaj konuşmada (alıcı dahil) işaretlenmiyor

| Alan                | Değer                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Severity            | Medium                                                             |
| Durum               | Gözlemlendi                                                        |
| Konum               | `src/components/booking/BookingMessages.tsx:164`                   |
| Diğer konumlar      | `src/lib/messaging/message-service.ts`, `src/components/ui/ui.tsx` |
| Kullanıcılar        | misafir, ev sahibi                                                 |
| Prensip             | robustness · Observability (şeffaflık)                             |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                     |
| Renk/tema           | Hayır                                                              |
| Efor                | S                                                                  |
| Kaynak denetçiler   | runtime:trips                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                       |

**Kanıt:** p-booking.mts C1/C3: SSE ile gelen fromAiDraft:true ev sahibi mesajı misafirde 'Ev sahibi: Hoş geldiniz! Erken giriş mümkün. 11.10.2026 00:32' olarak, hiçbir AI işareti olmadan göründü ([data-ai-generated]=0). p-host.mts: ev sahibinin AI taslağından gönderdiği mesaj kendi görünümünde de işaretsiz. fromAiDraft DB'ye yazılıyor (message-service.ts:155) ama BookingMessages render'ında kullanılmıyor; projede 'her AI çıktısının yanında' rozet için LlmBadge (ui.tsx) mevcut.

**Etki:** Misafir otomatik üretilmiş bir yanıtı kişisel taahhüt sanabilir (ör. 'erken giriş mümkün'); AI şeffaflığı ilkesine aykırı, uyuşmazlıkta güveni zedeler.

**Önerilen aksiyon:** m.fromAiDraft true ise meta satırında küçük 'AI taslağından' etiketi/LlmBadge gösterin (sr-only öneke de ekleyin).

## F573 — Service worker yokken izin verilince bildirim düğmesi 'İşleniyor…' durumunda sonsuza dek asılı kalıyor

| Alan                | Değer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Severity            | Medium                                                                   |
| Durum               | Gözlemlendi                                                              |
| Konum               | `src/components/pwa/PushToggle.tsx:64`                                   |
| Diğer konumlar      | `src/components/pwa/ServiceWorkerRegistrar.tsx`, `src/lib/pwa/client.ts` |
| Kullanıcılar        | misafir                                                                  |
| Prensip             | robustness · Responsiveness                                              |
| Sezgisel madde      | H12 — Feedback                                                           |
| Renk/tema           | Hayır                                                                    |
| Efor                | S                                                                        |
| Kaynak denetçiler   | runtime:trips                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                             |

**Kanıt:** p-trips.mts 'granted-no-sw' (390x844, izin granted, push etkin taklit): tıklamadan 1.5 sn sonra 'İşleniyor…', 9.5 sn sonra hâlâ 'İşleniyor…'; navigator.serviceWorker.getRegistration() = yok; odak body. navigator.serviceWorker.ready kayıt olmadan hiç çözülmez; kayıt dev'de ve NEXT_PUBLIC_PWA_DISABLED=true iken atlanıyor (ServiceWorkerRegistrar.tsx:12-13); pushSupported() yalnız API varlığına bakıyor (client.ts:16-23).

**Etki:** PWA kapalı yapılandırmada kullanıcı sonsuz bekleme görür, hata mesajı yok; güven ve zaman kaybı.

**Önerilen aksiyon:** detectPushState'te getRegistration() boşsa kartı 'unsupported' gösterin; enable()'da serviceWorker.ready'yi 10 sn zaman aşımıyla yarıştırıp t('error') gösterin.

## F574 — Oturumlu /trips'te ağ 25 sn boşa çıkmadı; istemci tarafı sürekli bağlantı/döngü değil, ayrıca anon yüklemede 3 kez refresh

| Alan                | Değer                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                |
| Durum               | Gözlemlendi                                                                                           |
| Konum               | `src/components/pwa/TripsView.tsx:44`                                                                 |
| Diğer konumlar      | `src/app/api/itinerary/route.ts`, `src/lib/booking/itinerary.ts`, `src/components/pwa/PushToggle.tsx` |
| Kullanıcılar        | misafir                                                                                               |
| Prensip             | robustness · Responsiveness                                                                           |
| Sezgisel madde      | H15 — Performans                                                                                      |
| Renk/tema           | Hayır                                                                                                 |
| Efor                | M                                                                                                     |
| Kaynak denetçiler   | runtime:trips                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                          |

**Kanıt:** Tarama 066/067 (guest /trips, iki viewport): networkIdleTimeout=true, loadMs 26541/26476 — 128 ziyaret içinde yalnız bu rota; içerik yine de render olmuş. trips-net.mjs (anon, gerçek sunucu): networkidle 2.09 sn, açık kalan istek 0, WS yalnız Next HMR; /api/user/me, /api/itinerary, /api/push/subscription (dev StrictMode nedeniyle ikişer) + 3x POST /api/auth/refresh (TripsView.loadItinerary kendi refresh'ini apiFetch'in tekilleştirilmiş refreshSession'ından ayrı yapıyor, satır 38-44). p-trips.mts (üç API taklit): networkidle 1.3–1.7 sn, EventSource/yoklama yok. Sonuç: sürekli açık bağlantı ya da sonsuz render döngüsü YOK; gecikme oturumlu gerçek sunucu yanıtlarından birinde (büyük olasılıkla /api/itinerary: imza+QR üretimi, itinerary.ts:56-73). Hazır storageState'lerin erişim token'ı 20:48Z'de dolmuş, refresh 401 verdiği için oturumlu ölçüm tekrarlanamadı — kök neden doğrulanmadı.

**Etki:** Seyahat kartı/QR resepsiyonda hızlı açılmalı; yavaş yanıt süresince yalnız 'Seyahatler yükleniyor…' görünür, mobil veride terk riski.

**Önerilen aksiyon:** /api/itinerary ve /api/push/subscription'a Server-Timing ekleyip oturumlu ölçün; QR SVG'yi rezervasyon başına önbelleğe alın; loadItinerary'de AbortController ile zaman aşımı + 'Tekrar dene'; kendi refresh çağrısını kaldırıp apiFetch'in tekil refreshSession'ını kullanın.

## F575 — /trips hata ve boş durumları: tekrar dene yok, boşta yönlendirme yok, QR yokken QR ipucu gösteriliyor

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Medium                                 |
| Durum               | Gözlemlendi                            |
| Konum               | `src/components/pwa/TripsView.tsx:104` |
| Kullanıcılar        | misafir                                |
| Prensip             | robustness · Recoverability            |
| Sezgisel madde      | H9 — Hata mesajları                    |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | runtime:trips                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** p-trips-states.mts (390x844): /api/itinerary 500 -> yalnız role=alert 'Seyahatler yüklenemedi.', main'de hiç eylem yok. Boş liste -> 'Yaklaşan onaylı rezervasyonunuz yok.' + ardından 'Girişte bu QR kodu gösterin. Kod kişisel bilgi içermez…' (sayfada QR yok), eylem 0.

**Etki:** Hata alan kullanıcı yalnızca sayfayı yenilemeyi tahmin edebilir; boş durumda sonraki adım belirsiz, alakasız QR metni kafa karıştırır.

**Önerilen aksiyon:** Hata durumunda 'Tekrar dene' düğmesi (loadItinerary'yi yeniden çalıştırır); boş durumda 'Konaklama ara' (/) ve 'Tüm rezervasyonlarım' (/account) bağlantıları; qrHint'i yalnız items.length>0 iken render edin (satır 179).

## F576 — Seyahat kartı rezervasyon detayına bağlanmıyor; kod 11px ve kopyalanamıyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Medium                                             |
| Durum               | Gözlemlendi                                        |
| Konum               | `src/components/pwa/TripsView.tsx:131`             |
| Kullanıcılar        | misafir                                            |
| Prensip             | flexibility · Dialogue initiative / substitutivity |
| Sezgisel madde      | H7 — Esneklik/verim                                |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | runtime:trips                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** p-trips.mts (390x844, itinerary taklit): trip-card içinde a/button sayısı 0; kod 11px ui-monospace (TripsView.tsx:170). Tarama 066/067 tinyText: '11px code.break-all.text-[11px] "BK1.cmv2uyf700o3c92w2ti427b8v.GvTvtzPNrmepLzIkYf75"'. PWA kısayolu ve push bildirimleri /trips'e açılıyor (src/lib/pwa/manifest.ts:40, src/lib/push/notifications.ts:46), ama buradan iptal/mesaj/fatura için detaya geçiş yok. Ekran crops/booking/067-guest-tr-mobile-_trips-0.png.

**Etki:** Bildirime dokunup /trips'e gelen misafir ev sahibine yazmak veya rezervasyonu yönetmek için menülerde kaybolur; resepsiyonda 52 karakterlik 11px kodu okumak/söylemek zor.

**Önerilen aksiyon:** Başlığı /booking/{id} bağlantısı yapın ve 'Rezervasyonu yönet' bağlantısı ekleyin; kodu en az text-sm gösterin, 'Kodu kopyala' düğmesi + role=status geri bildirimi ekleyin.

## F601 — Rezervasyon detayında başlık bandı tüm durumlarda yeşil (İptal/Süresi doldu/Beklemede dahil)

| Alan                | Değer                               |
| ------------------- | ----------------------------------- |
| Severity            | Medium                              |
| Durum               | Aday (2 kaynak birleşti)            |
| Konum               | `src/app/booking/[id]/page.tsx:116` |
| Kullanıcılar        | misafir                             |
| Prensip             | learnability · consistency          |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi         |
| WCAG                | 1.4.1                               |
| Renk/tema           | Evet — kapsam dışı                  |
| Efor                | S                                   |
| Kaynak denetçiler   | lens:a11y, lens:nav                 |
| **Düzeltme durumu** | **Kapsam dışı (renk/tema)**         |

**Kanıt:** 116-119 `<div className="bg-green-700 px-8 py-6 text-white"><h1 ...>{isStatusKey(booking.status) ? t(`status.${booking.status}`) : booking.status}</h1>` — CANCELLED, EXPIRED ve HELD (ödeme bekliyor) için de başarı yeşili.

**Etki:** Misafir: 'İptal edildi' ya da 'Ödeme bekliyor' durumunu başarı rengiyle görüp yanlış yorumlayabilir (özellikle metni okumadan hızla göz atan, düşük okuryazarlıklı kullanıcı).

**Önerilen aksiyon:** Duruma göre ton + renk dışı ipucu: başlığa durum ikonu (✓ onaylandı, ⏳ ödeme bekliyor, ✕ iptal) ve HELD için 'Ödeme {saat}'e kadar tamamlanmalı' alt metni ekleyin; bant rengini durum eşlemesine bağlayın (mevcut paletten — renk/tema dokunuşu gerektirir).

## F602 — Rezervasyon detay başlığı her durumda (iptal, süresi doldu, ödeme bekliyor) aynı 'başarı' bandında; ikon/açıklama yok

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | Medium                                                                |
| Durum               | Aday (2 kaynak birleşti)                                              |
| Konum               | `src/app/booking/[id]/page.tsx:116`                                   |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:117`, `messages/tr/booking.json:32-38` |
| Kullanıcılar        | misafir                                                               |
| Prensip             | robustness · observability                                            |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                        |
| Renk/tema           | Hayır                                                                 |
| Efor                | S                                                                     |
| Kaynak denetçiler   | lens:status, lens:copy                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                          |

**Kanıt:** booking/[id]/page.tsx:116 `<div className="bg-green-700 px-8 py-6 text-white">` durumdan bağımsız; 117-119 başlık yalnız durum adını veriyor ('Rezervasyon iptal edildi', 'Ödeme süresi doldu'), ikon veya ne yapılacağına dair açıklama yok.

**Etki:** Hızlı bakan mobil misafir bandı 'her şey yolunda' olarak okuyabiliyor; HELD durumunda ödemenin henüz yapılmadığını kaçırabiliyor.

**Önerilen aksiyon:** Renge dokunmadan: başlığın önüne durum ikonu (✓ onaylı, ⏳ ödeme bekliyor, ✕ iptal/süresi doldu; aria-hidden) ve altına durum açıklaması + eylem ('Ödemeyi 14:32'ye kadar tamamlayın' / 'Aynı tarihleri yeniden ara'). Bandın renginin duruma göre değişmesi ayrı bir tema kararıdır, kapsam dışı bırakılabilir.

## F603 — Başlık hiyerarşisi tutarsız: host mesaj sayfasında h1 yok, arama sonuçları 'Filtreler' h2'sinin altına düşüyor, aynı h2 düzeyi üç farklı boyutta

| Alan                | Değer                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                                                                              |
| Konum               | `src/app/host/messages/[bookingId]/page.tsx:17`                                                                                                                                                                                                                                       |
| Diğer konumlar      | `src/app/search/page.tsx:326`, `src/components/property/PropertyCard.tsx:133`, `src/app/account/page.tsx:274`, `src/components/account/PasskeyManager.tsx:104`, `src/components/ui/ui.tsx:107`, `src/app/booking/[id]/page.tsx:117`, `src/components/booking/BookingMessages.tsx:128` |
| Kullanıcılar        | ev sahibi, misafir                                                                                                                                                                                                                                                                    |
| Prensip             | accessibility · WCAG 1.3.1 / 2.4.6 ve consistency                                                                                                                                                                                                                                     |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                                 |
| WCAG                | 1.3.1                                                                                                                                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                 |
| Efor                | S                                                                                                                                                                                                                                                                                     |
| Kaynak denetçiler   | lens:consistency, lens:a11y                                                                                                                                                                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                          |

**Kanıt:** host/messages/[bookingId]/page.tsx:17-24 `<main>` içinde önce geri bağlantısı, ardından BookingMessages geliyor. İlk başlık BookingMessages.tsx'teki `<h2 id="msg-title">`, sayfada h1 yok, hangi rezervasyon ya da misafir olduğu da yazmıyor. search/page.tsx:326'da kenar çubuğu `<h2>{t("filters.title")}</h2>`, sonuç alanında başlık yok, kartlar PropertyCard.tsx:133'te `<h3>`, dolayısıyla belge yapısında sonuçlar 'Filtreler'in alt başlığı. Hesap sayfasında aynı h2 düzeyi :274 `text-2xl`, PasskeyManager.tsx:104 `text-xl` ve Card (ui.tsx:107) `text-lg`. booking/[id]/page.tsx:117'de sayfanın h1'i rezervasyon durum cümlesi.

**Etki:** Ekran okuyucuyla başlıklar arasında gezinen host mesaj sayfasında sayfa başlığı bulamaz. Misafir arama sonuçlarına başlıkla atlayamaz. Görsel olarak aynı önemdeki bölümler farklı büyüklükte göründüğünden sayfa taraması zorlaşır.

**Önerilen aksiyon:** host/messages sayfasını PageShell'e taşıyın: title "Mesajlar: {ilan} · {tarihler}", geri bağlantısı intro'da. Arama sayfasında sonuç listesinin üstüne `<h2 className="sr-only">{t("resultsHeading")}</h2>` ekleyin. Card başlığını tek h2 stili kabul edip hesap sayfasındaki h2'leri ona hizalayın. Booking detayında h1'i "Rezervasyon {kısa no}" yapın, durumu h1 altında rozet olarak gösterin.

## F604 — Ev sahibi 'Yanıt taslağı öner' yazılmış metnin üzerine onaysız yazıyor

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Aday (2 kaynak birleşti)                             |
| Konum               | `src/components/booking/BookingMessages.tsx:106`     |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx:211`     |
| Kullanıcılar        | ev sahibi                                            |
| Prensip             | flexibility · dialog initiative (kullanıcı kontrolü) |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                    |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | lens:forms, lens:status                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                         |

**Kanıt:** src/components/booking/BookingMessages.tsx:99-113 `const res = await apiFetch(…/draft); setText(res.draft); setFromDraft(true);` — mevcut `text` dolu olsa da koşulsuz değiştiriliyor; geri al yok.

**Etki:** Mobilde misafire yanıt yazan ev sahibi taslak düğmesine basınca kendi metnini kaybeder.

**Önerilen aksiyon:** `text.trim()` doluysa taslağı ayrı önizleme kutusunda göster ('Taslağı ekle' / 'Değiştir' / 'Vazgeç') ya da önceki metni saklayıp 'Geri al' bağlantısı sun.

## F981 — Yeniden yükleme bir kez başarısız olursa sayfa kalıcı olarak 'Hata' ekranında kalıyor

| Alan                | Değer                              |
| ------------------- | ---------------------------------- |
| Severity            | Medium                             |
| Durum               | Aday                               |
| Konum               | `src/app/booking/[id]/page.tsx:57` |
| Kullanıcılar        | misafir                            |
| Prensip             | robustness · recoverability        |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü     |
| Renk/tema           | Hayır                              |
| Efor                | S                                  |
| Kaynak denetçiler   | area:trips                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**       |

**Kanıt:** load() başarı yolunda `setBooking(data.booking); setPlan(...)` yapıyor ama hiçbir yerde `setError(null)` yok (51-65). Render önceliği `loading ? … : error ? (hata görünümü) : booking ? …` (101-114). load() ödeme ve iptal sonrası `onChanged` ile yeniden çağrılıyor (171).

**Etki:** Başarılı ödemenin hemen ardından geçici bir 503 alınırsa onaylanan rezervasyon tamamen 'Hata' ekranıyla değişiyor. Sonraki başarılı yüklemede de öyle kalıyor. Misafir ödemenin başarısız olduğunu sanabilir.

**Önerilen aksiyon:** load() başında ve başarı yolunda `setError(null)` çağır. Rezervasyon zaten yüklüyse hatayı sayfanın yerine geçirme; `error && !booking` iken tam hata görünümünü, aksi hâlde kart üstünde `role='alert'` satır içi bant ve 'Tekrar dene' göster.

## F982 — Hata metinleri ham ve yalnız Türkçe gösteriliyor ('Failed to fetch', sunucu mesajları EN arayüzde Türkçe)

| Alan                | Değer                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                         |
| Durum               | Aday                                                                                                                                                                           |
| Konum               | `src/app/booking/[id]/page.tsx:61`                                                                                                                                             |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx:57`, `src/components/booking/BookingMessages.tsx:93`, `src/components/booking/BookingMessages.tsx:109`, `src/lib/api-client.ts:40` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                             |
| Prensip             | learnability · familiarity / consistency (dil)                                                                                                                                 |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                                                                          |
| Efor                | M                                                                                                                                                                              |
| Kaynak denetçiler   | area:trips                                                                                                                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                   |

**Kanıt:** `setError(err instanceof Error ? err.message : t('detail.loadFailed'))`. fetch'in TypeError'ı da Error olduğu için 'Failed to fetch' veya 'Load failed' 'Hata' başlığı altında çıkıyor. ApiError mesajları sunucudaki Türkçe metinler: 'Rezervasyon bulunamadı' (booking-service.ts:114), 'Mesaj en fazla 2000 karakter olabilir' (message-service.ts:135), 'İstek başarısız (502)' (api-client.ts:40). Bunlar BookingMessages.tsx:57, 93 ve 109'da doğrudan gösteriliyor. Projede kod→çeviri eşleme deseni zaten var (resolution/shared.tsx:128 KNOWN_ERROR_CODES).

**Etki:** EN arayüzdeki misafir ve ev sahibi Türkçe veya teknik İngilizce hata görüyor. Ne yapacağını anlamıyor.

**Önerilen aksiyon:** Hataları `err.status`/`err.code` ile çevir: BOOKING_NOT_FOUND/404 → t('detail.notFound') ('Rezervasyon bulunamadı veya bu hesaba ait değil'), ApiError olmayan ağ hatası → t('detail.network'), VALIDATION_ERROR (mesaj) → t('chat.tooLong', {max}), CONFLICT → t('chat.closed'), diğerleri → mevcut fallback anahtarları. ApiError dışındaki hataların `message` alanını asla gösterme.

## F983 — Oturumsuz durumda girişten sonra bağlama geri dönülmüyor; ev sahibi mesaj sayfasında giriş bağlantısı da yok

| Alan                | Değer                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                   |
| Durum               | Aday                                                                                                                                     |
| Konum               | `src/app/booking/[id]/page.tsx:81`                                                                                                       |
| Diğer konumlar      | `src/components/pwa/TripsView.tsx:91`, `src/app/host/messages/[bookingId]/page.tsx:22`, `src/components/booking/BookingMessages.tsx:121` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                       |
| Prensip             | robustness · recoverability                                                                                                              |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                    |
| Efor                | S                                                                                                                                        |
| Kaynak denetçiler   | area:trips                                                                                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                             |

**Kanıt:** page.tsx:80-85 `<Link href='/login'` ve TripsView.tsx:91 `href='/login'`. Login sayfası `?redirect` destekliyor (login/page.tsx:63 `get('redirect') ?? '/'`) ve checkout/page.tsx:123 bunu kullanıyor. host/messages/[bookingId]/page.tsx:14-27 oturum durumunu hiç ele almıyor: 401 olunca BookingMessages.tsx:121 ham 'Oturum açmanız gerekiyor' (errors.ts:26) metnini bağlantısız gri metin olarak gösteriyor.

**Etki:** Oturumu düşen misafir giriş yapınca ana sayfaya atılıyor ve rezervasyonu yeniden bulamıyor (bkz. navigasyon çıkmazı). Ev sahibinin giriş yapacak bir yolu yok.

**Önerilen aksiyon:** `href={`/login?redirect=${encodeURIComponent(`/booking/${id}`)}`}` kullan. TripsView'da `/login?redirect=%2Ftrips` kullan. BookingMessages'ta `err instanceof ApiError && err.status === 401` durumunda redirect'li bir giriş bağlantısı render et.

## F984 — Yükleme hatalarında 'Tekrar dene' yok, hata başlığı yalnız 'Hata', zaman aşımı yok

| Alan                | Değer                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                          |
| Durum               | Aday                                                                                                                            |
| Konum               | `src/app/booking/[id]/page.tsx:105`                                                                                             |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx:121`, `src/components/pwa/TripsView.tsx:104`, `src/components/pwa/TripsView.tsx:97` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                              |
| Prensip             | robustness · recoverability                                                                                                     |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                             |
| Renk/tema           | Hayır                                                                                                                           |
| Efor                | S                                                                                                                               |
| Kaynak denetçiler   | area:trips                                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                    |

**Kanıt:** page.tsx:104-113 `<h1 className='text-xl font-bold text-red-600'>{t('detail.error')}</h1>` ('Hata') ve yalnızca 'Ana sayfaya dön' bağlantısı var. BookingMessages.tsx:121 `{error ?? t('loading')}`; yeniden deneme yok. TripsView.tsx:104-110 `t('loadError')`; yeniden deneme yok. Çevrimdışı durumlar (97-103, 115-123) `online` olayını dinlemiyor. apiFetch (api-client.ts:65) zaman aşımı koymuyor; askıda kalan ağda 'Yükleniyor...' sonsuza kadar duruyor.

**Etki:** Yavaş veya kesintili mobil ağda misafir sayfayı elle yenilemesi gerektiğini bilmiyor. Ana sayfaya dönünce rezervasyona tekrar ulaşamıyor.

**Önerilen aksiyon:** Hata görünümlerine `<button onClick={() => { setLoading(true); void load(); }}>Tekrar dene</button>` ekle. Başlığı 'Rezervasyon yüklenemedi' gibi belirli bir metin yap. TripsView'da `window.addEventListener('online', reload)` ile bağlantı gelince yeniden çek ve çevrimdışı bandına 'Yenile' düğmesi koy. İsteklere `signal: AbortSignal.timeout(15000)` ekleyip zaman aşımında yeniden denenebilir bir hata göster.

## F985 — Fiyat kırılımı ve iptal politikası API'de var ama detay sayfasında gösterilmiyor

| Alan                | Değer                               |
| ------------------- | ----------------------------------- |
| Severity            | Medium                              |
| Durum               | Aday                                |
| Konum               | `src/app/booking/[id]/page.tsx:156` |
| Kullanıcılar        | misafir                             |
| Prensip             | robustness · task conformance       |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü      |
| Renk/tema           | Hayır                               |
| Efor                | M                                   |
| Kaynak denetçiler   | area:trips                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**        |

**Kanıt:** BookingDetail arayüzü (16-31) `priceBreakdown` ve `policySnapshot` alanlarını almıyor. Oysa API tüm genel alanları döndürüyor (booking-service.ts:894-910; şemada `priceBreakdown Json?` 'geceler, ara toplam, vergiler, toplam', `policySnapshot Json?` 'Rezervasyon anındaki iptal politikası'). Sayfa yalnız 'Toplam Tutar' ve tek tutar gösteriyor (156-161). Yeniden kullanılabilecek components/booking/QuoteBreakdown.tsx mevcut.

**Etki:** Misafir gecelik fiyat × gece sayısını, vergileri ve indirimleri doğrulayamıyor. Ücretsiz iptal son tarihini bilmeden iptal kararı veriyor.

**Önerilen aksiyon:** Arayüze iki alanı ekle. Toplamın üstünde QuoteBreakdown ile `<dl>` biçiminde gece, ara toplam, vergi, indirim ve toplamı göster. İptal düğmesinin yanında policySnapshot'tan 'Ücretsiz iptal: {tarih saat} tarihine kadar' satırını göster.

## F986 — Tutma (hold) süresi dolunca sayfa güncellenmiyor, geri sayım yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/app/booking/[id]/page.tsx:168`             |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:268` |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · responsiveness / observability     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:trips                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** `holdExpiresAt={booking.holdExpiresAt}` yalnız 'Oda sizin için {time}'e kadar tutuluyor.' metni için kullanılıyor (BookingActions.tsx:268-271). Sayfada zamanlayıcı veya yeniden çekme yok. Süre dolsa da h1 HELD 'ödemeyi tamamlayın' olarak kalıyor ve ödeme formu açık duruyor.

**Etki:** Misafir süresi dolmuş tutmaya kart bilgisi girip ödeme deniyor ve hata alıyor. Kalan süreyi hesaplaması gerekiyor.

**Önerilen aksiyon:** page.tsx'te `setTimeout(load, Date.parse(holdExpiresAt) - Date.now() + 1000)` kur. Kalan dakikayı dakikada bir güncellenen 'Kalan süre: 12 dk' metniyle göster; son 2 dakikada `aria-live='polite'` ile duyur. Süre dolunca 'Süre doldu. Tarihler uygunsa yeniden rezervasyon yapın' metni ve tesis bağlantısı göster.

## F987 — Fatura PDF ucu var ama arayüzde fatura indirme bağlantısı yok

| Alan                | Değer                               |
| ------------------- | ----------------------------------- |
| Severity            | Medium                              |
| Durum               | Aday                                |
| Konum               | `src/app/booking/[id]/page.tsx:182` |
| Kullanıcılar        | misafir                             |
| Prensip             | robustness · task conformance       |
| Sezgisel madde      | H7 — Esneklik/verim                 |
| Renk/tema           | Hayır                               |
| Efor                | S                                   |
| Kaynak denetçiler   | area:trips                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**        |

**Kanıt:** `GET /api/bookings/[id]/invoice` e-Arşiv fatura PDF'i döndürüyor (invoice/route.ts:7 'yalnızca rezervasyon sahibi; CONFIRMED/COMPLETED'). Hiçbir .tsx dosyası `/invoice` adresine bağlantı vermiyor (grep). Detay sayfasının alt satırında (182-201) yalnız tesisi görüntüleme, Rezervasyonlarım ve Yazdır var.

**Etki:** İş seyahati yapan veya gider belgesi isteyen misafir faturasına ulaşamıyor ve destek talebi açmak zorunda kalıyor.

**Önerilen aksiyon:** CONFIRMED/COMPLETED durumunda `<a href={`/api/bookings/${booking.id}/invoice`} target='_blank' rel='noopener'>Faturayı indir (PDF, yeni sekmede açılır)</a>` ekle ve metni booking.detail.invoice anahtarına taşı.

## F988 — 'Rezervasyonlarım' (/account) ve 'Seyahatlerim' (/trips) iki ayrı merkez; ekranlar farklı olanına yönlendiriyor ve ikisi de ana menüde yok

| Alan                | Değer                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                     |
| Durum               | Aday                                                                                                                                                                                                                       |
| Konum               | `src/app/booking/[id]/page.tsx:189`                                                                                                                                                                                        |
| Diğer konumlar      | `src/app/checkout/cart/page.tsx:205-210`, `src/app/pay/share/[token]/page.tsx:162`, `src/app/offline/page.tsx:14`, `src/app/account/page.tsx:262-264`, `src/components/layout/Header.tsx:19-30`, `messages/tr/pwa.json:25` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                    |
| Prensip             | learnability · consistency / synthesizability                                                                                                                                                                              |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                |
| WCAG                | 3.2.4                                                                                                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                                                                                      |
| Efor                | M                                                                                                                                                                                                                          |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                               |

**Kanıt:** booking/[id]/page.tsx:189-194 `href="/account"` ve metin booking.json:56 "Rezervasyonlarım". checkout/cart/page.tsx:205-210 `href="/trips"` ve cart.json:51 "Seyahatlerim". pay/share/[token]/page.tsx:162 ile offline/page.tsx:14 /trips'e gidiyor. account/page.tsx:262 bağlantıyı pwa.json:25 "Seyahatlerim (çevrimdışı)" olarak adlandırıyor. Header.tsx:19-30 NAV_ITEMS bu iki sayfadan hiçbirini içermiyor. /account tüm rezervasyonları detaya bağlantı olmadan, /trips ise yalnızca yaklaşan onaylıları QR ile listeliyor.

**Etki:** Misafir 'rezervasyonum nerede' sorusuna iki farklı yanıt öğrenir. İki sayfa farklı alt kümeler gösterdiği için bir rezervasyonu birinde görüp diğerinde göremez. Ana menüde bulunmadığından mobilde bulunabilirlik düşer.

**Önerilen aksiyon:** Tek bir 'Rezervasyonlarım' merkezi belirleyin (/trips ya da /account/bookings). Yaklaşan, geçmiş ve iptal sekmeleri olsun, her kart detaya bağlansın, QR çevrimdışı görünümü yaklaşan sekmesinin parçası olsun. Header NAV_ITEMS'a oturum açıkken görünen 'Rezervasyonlarım' öğesi ekleyin. Tüm 'geri' bağlantıları aynı hedefe ve aynı anahtara (nav.bookings) gitsin.

## F989 — Ev sahibi mesaj sayfasında h1 ve rezervasyon bağlamı yok; oturumsuzken giriş yolu yok

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Medium                                                 |
| Durum               | Aday                                                   |
| Konum               | `src/app/host/messages/[bookingId]/page.tsx:70`        |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx:121`       |
| Kullanıcılar        | ev sahibi                                              |
| Prensip             | accessibility · WCAG 2.4.6 Headings and Labels / 1.3.1 |
| Sezgisel madde      | H14 — Erişilebilirlik                                  |
| WCAG                | 2.4.6                                                  |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | lens:nav                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                           |

**Kanıt:** 70-76: main içinde yalnız geri bağlantı ve `<BookingMessages>` var; bileşenin başlığı h2 "Mesajlar" (BookingMessages.tsx:118/128). Sayfada h1 yok; misafir, ilan ve tarih bilgisi yok. RoleGate olmadığı için oturumsuzken API hata metni gri `<p>` içinde (BookingMessages.tsx:121) giriş bağlantısı olmadan gösteriliyor.

**Etki:** Mobilden mesaja dönen ev sahibi hangi rezervasyonla yazıştığını göremiyor. Ekran okuyucu kullanıcısı h1 ile gezinemiyor. Oturumu düşmüşse çıkış yolu yok.

**Önerilen aksiyon:** "Mesajlar — {ilan} · {giriş}–{çıkış} · {misafir sayısı}" biçiminde bir h1 ekleyin (/api/bookings/{id} ile). Sayfayı `<RoleGate roles={["HOST","ADMIN"]}>` ve loginHref ile sarın.

## F990 — Canlı bağlantı (SSE) koptuğunda kullanıcı bilgilendirilmiyor, kaçan mesajlar yeniden çekilmiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/booking/BookingMessages.tsx:59` |
| Kullanıcılar        | misafir, ev sahibi                              |
| Prensip             | robustness · responsiveness / observability     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                  |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:trips                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** `const es = new EventSource(...)` için yalnız 'message' dinleyicisi var; `onerror` ve `open` işleyicisi yok (59-66). hub.ts:51 yorumu 'mesaj DB'de kalıcıdır, istemci GET ile yakalar' diyor ama yeniden bağlanınca GET yapılmıyor. `add` thread null iken `prev` döndürüyor (42-47), yani ilk GET'ten önce gelen olaylar atılıyor. 429 TOO_MANY_STREAMS (stream/route.ts) da sessizce başarısız oluyor.

**Etki:** Kullanıcı sohbetin canlı olduğunu sanıyor ama sayfayı yenileyene kadar mesaj kaçırıyor.

**Önerilen aksiyon:** `es.onerror` içinde 'Canlı bağlantı kesildi — yeniden bağlanılıyor' (`role='status'`) göster. Hatadan sonraki `open` olayında GET'i yeniden çağırıp id'ye göre birleştir. thread null iken olayları tamponla ve yükleme bitince ekle.

## F991 — Canlı mesajlaşmada bağlantı durumu görünmüyor; ileti dizisi yükleme hatası hata gibi görünmüyor ve yeniden deneme yok

| Alan                | Değer                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                             |
| Durum               | Aday                                                                                               |
| Konum               | `src/components/booking/BookingMessages.tsx:59`                                                    |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx:121`, `src/components/resolution/ClaimMessages.tsx:40` |
| Kullanıcılar        | ev sahibi, misafir                                                                                 |
| Prensip             | robustness · observability                                                                         |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                     |
| WCAG                | 4.1.3                                                                                              |
| Renk/tema           | Hayır                                                                                              |
| Efor                | M                                                                                                  |
| Kaynak denetçiler   | lens:status                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                       |

**Kanıt:** BookingMessages.tsx:59-66 `new EventSource(...)` için onerror/bağlantı durumu işlenmiyor; 113-121 dizi yüklenemezse hata `text-gray-500` paragrafında (`{error ?? t("loading")}`), role=alert ve 'Tekrar dene' yok. resolution/ClaimMessages.tsx hiç canlı güncellenmiyor (yalnız kendi gönderiminde onSent=reload).

**Etki:** Mesajlara mobilden bakan ev sahibi bağlantı koptuğunda yeni misafir mesajlarını görmüyor ama ekran güncelmiş gibi duruyor; talep tarafları karşı yanıtı sayfayı yenilemeden görmüyor.

**Önerilen aksiyon:** `es.onerror`'da role=status 'Canlı bağlantı koptu — yeniden bağlanılıyor…', yeniden bağlanınca GET /messages ile boşlukları doldur; yükleme hatasını role=alert + 'Tekrar dene' ile göster; ClaimMessages için görünür sekmede periyodik yenileme veya aynı SSE deseni.

## F992 — Engellenen mesajda hangi içeriğin sorun olduğu söylenmiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/booking/BookingMessages.tsx:91` |
| Kullanıcılar        | misafir, ev sahibi                              |
| Prensip             | robustness · recoverability                     |
| Sezgisel madde      | H9 — Hata mesajları                             |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:trips                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** `if (err instanceof ApiError && err.code === 'MESSAGE_BLOCKED') setError(tt('message.blocked'));`. Sunucu `details: { reasons }` gönderiyor (trust/message-risk.ts:23-31). Gerekçe çevirileri trust.json `reasons.*` altında hazır ama kullanılmıyor.

**Etki:** Kullanıcı mesajındaki bağlantının mı, IBAN'ın mı, yoksa 'acil' kelimesinin mi engellemeye yol açtığını bilmiyor ve deneme yanılmaya düşüyor.

**Önerilen aksiyon:** Hata metnine `tt('message.reasonsLabel')` ve `reasons.map(r => tt.has(`reasons.${r}`) ? tt(`reasons.${r}`) : r).join(', ')` ekle. Ardından 'Bu kısmı çıkarıp tekrar gönderin' ipucunu göster. Metin zaten kutuda korunuyor.

## F993 — Yapay zekâ taslağı ev sahibinin yazdığı metni onaysız ve geri alınamaz şekilde siliyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:106` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · recoverability                      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** draft() içinde koşulsuz `setText(res.draft);`. Kutuda metin varken de taslak düğmesi etkin (`disabled={busy}`, 208). Geri alma yok.

**Etki:** Yarıya kadar yanıt yazmış ev sahibi 'Yanıt taslağı öner'e basınca kendi metnini kaybediyor.

**Önerilen aksiyon:** `text.trim()` doluysa ya 'Yazdığınız metin taslakla değiştirilsin mi?' onayı sor ya da taslağı mevcut metnin altına ekle. Önceki metni state'te tutup 10 saniye görünen 'Geri al' düğmesiyle `setText(prev)` yap.

## F994 — Mesajın kimden geldiği görsel olarak yalnız hizalama ve renkle anlaşılıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:137` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | learnability · familiarity / synthesizability    |
| Sezgisel madde      | H6 — Tanıma > hatırlama                          |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** `<li className={mine ? 'text-right' : 'text-left'}>` ve balon `mine ? 'bg-[#003580] text-white' : 'bg-gray-100 text-gray-900'` (160-162). Gönderen adı yalnız `<span className='sr-only'>` içinde (164-166) ve misafirin kendi mesajında 'Siz' değil 'Misafir:' diyor. messaging.png'de hiç isim görünmüyor.

**Etki:** Sohbet uygulaması alışkanlığı olmayan misafir ve 360px'te max-w-[80%] balonların neredeyse üst üste geldiği ekranda kullanıcı kimin yazdığını ayırt edemiyor. Ekran okuyucu kullanıcısı kendi mesajını 'Misafir' olarak duyuyor.

**Önerilen aksiyon:** Her balonun üstüne görünür bir text-xs satır ekle: kendi mesajı için 'Siz', karşı taraf için 'Ev sahibi' / 'Misafir' (varsa ad). sr-only metni de aynı yap. Renk değişmiyor.

## F995 — Mesaj balonunda satır sonları kayboluyor, uzun kelimeler 360px'te taşıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:160` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | robustness · task conformance                    |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                     |
| WCAG                | 1.4.10                                           |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** Balon sınıfı `inline-block max-w-[80%] rounded-lg px-3 py-2 text-sm` içinde `whitespace-pre-wrap` ve `break-words` yok. textarea `rows={3}` ile çok satırlı yazmayı teşvik ediyor ama gönderilen satır sonları tek paragrafa çöküyor. Bölünmeyen uzun dizeler (ör. ~52 karakterlik BK1… kodu) mobilde yatay taşma yaratıyor.

**Etki:** Ev sahibinin '1. Anahtar kutusu… 2. Kapı kodu…' gibi adımlı talimatları tek satırlık okunaksız bir metne dönüşüyor.

**Önerilen aksiyon:** Balona `whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-left` sınıflarını ekle.

## F996 — Rezervasyon mesajlarında gönderen yalnızca konum ve renkle ayırt ediliyor; talep mesajları ve destek sohbetinde görünür etiket var

| Alan                | Değer                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                      |
| Durum               | Aday                                                                                                                                                        |
| Konum               | `src/components/booking/BookingMessages.tsx:164`                                                                                                            |
| Diğer konumlar      | `src/components/resolution/ClaimMessages.tsx:77-89`, `src/components/support/SupportChat.tsx:100-110`, `src/components/booking/BookingMessages.tsx:179-191` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                          |
| Prensip             | accessibility · consistency / WCAG 1.4.1 Use of Color                                                                                                       |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                 |
| WCAG                | 1.4.1                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                       |
| Efor                | S                                                                                                                                                           |
| Kaynak denetçiler   | lens:consistency                                                                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                |

**Kanıt:** BookingMessages.tsx:158-167 gönderen için yalnızca `mine ? "bg-[#003580] text-white" : "bg-gray-100"` ve `text-right/text-left` kullanıyor, gönderen adı :164 `<span className="sr-only">`. ClaimMessages.tsx:86 görünür `{m.mine ? t("messages.you") : t(`role.${m.role}`)} · {f.dateTime(...)}` gösteriyor. SupportChat.tsx:106 görünür `t("you")` ve `t("assistant")` etiketi kullanıyor. Mesaj kutusu etiketi de farklı: BookingMessages.tsx:179 sr-only label ve placeholder, ClaimMessages Field ile görünür etiket.

**Etki:** Dar ekranda ya da renk ayrımı zayıf kullanıcıda ev sahibi ile misafir mesajlarını ayırt etmek zorlaşır. Hosta gönderilecek mesajı yanlış okuma riski doğar. Üç sohbet ekranı üç farklı okuma deseni öğretir.

**Önerilen aksiyon:** BookingMessages'te sr-only span'i görünür küçük bir başlıkla değiştirin (`<p className="text-xs text-gray-600">{mine ? t("you") : t("host")} · {f.dateTime}</p>`, ClaimMessages'teki gibi). Mesaj kutusunu Field ile görünür etiketli yapın. Üç sohbeti ortak bir `MessageList` ve `MessageItem` bileşenine taşıyın.

## F997 — Karakter sınırları ve asgari uzunluklar söylenmiyor, sayaç yok; mesaj kutusunda maxLength hiç yok

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Konum               | `src/components/booking/BookingMessages.tsx:182`                                                                                                                                                                                                                                                                                                                                                                                         |
| Diğer konumlar      | `src/components/support/SupportChat.tsx:122-133`, `src/components/resolution/OpenClaimForm.tsx:79-90`, `src/components/compliance/NoticeForm.tsx:98-108`, `src/components/compliance/AppealForm.tsx:68-78`, `src/components/host/HostDashboard.tsx:262-273`, `src/components/compliance/AppealQueue.tsx:138-148`, `src/components/compliance/ComplianceDashboard.tsx:124-126,185-194`, `src/components/admin/AdminDashboard.tsx:231-242` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                                                                                                                                                                                                                                                                                |
| Prensip             | learnability · predictability, feedforward                                                                                                                                                                                                                                                                                                                                                                                               |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                                                                                                                                                                                                                                                                                                        |
| WCAG                | 3.3.2                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Kaynak denetçiler   | lens:forms                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                                                                             |

**Kanıt:** src/components/booking/BookingMessages.tsx:182-189 textarea'da maxLength yok; sunucu src/lib/messaging/message-service.ts:134-135 `Mesaj en fazla ${max} karakter olabilir` (varsayılan 2000, app-config.ts:299) — kullanıcı ancak gönderince öğreniyor. Projede hiç karakter sayacı yok (`grep length}` sonuçsuz); maxLength'li alanlar sessizce kesiyor: SupportChat.tsx:127 (1000), OpenClaimForm.tsx:85-86 (10–4000), NoticeForm.tsx:103-104, AppealForm.tsx:73-74, HostDashboard.tsx:268-269 (açıklama min 10, metinde yazmıyor). Asgari uzunluk hiç belirtilmeyenler: AppealQueue.tsx:143 (min 10), ComplianceDashboard.tsx:125 (min 3), :190 (min 10).

**Etki:** Uzun mesaj yazan misafir/ev sahibi metnini gönderdiğinde reddedilir; kopyala-yapıştırla gelen uzun metin uyarısız kesilir; yönetici kısa gerekçede tarayıcının genel mesajıyla karşılaşır.

**Önerilen aksiyon:** Ortak <TextAreaField maxLength minLength> bileşeni: altında `aria-live="polite"` sayaç ('{n}/{max}', son %10'da metin uyarısı) ve hint'te asgari uzunluk ('en az 10 karakter'); aria-describedby ile bağla. BookingMessages'a `maxLength={2000}` (config'den) ekle.

## F998 — Gönder, taslak ve bildirim düğmeleri işlem sırasında disabled olunca odak kayboluyor; gönderimde meşgul metni yok

| Alan                | Değer                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                   |
| Durum               | Aday                                                                                                                     |
| Konum               | `src/components/booking/BookingMessages.tsx:199`                                                                         |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx:208`, `src/components/pwa/PushToggle.tsx:117`, `src/components/ui/ui.tsx:38` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                       |
| Prensip             | accessibility · WCAG 2.4.3 Focus Order                                                                                   |
| Sezgisel madde      | H12 — Feedback                                                                                                           |
| WCAG                | 2.4.3                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                    |
| Efor                | S                                                                                                                        |
| Kaynak denetçiler   | area:trips                                                                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                             |

**Kanıt:** `disabled={busy || !text.trim()}`: tıklamada `setBusy(true)` odaktaki düğmeyi devre dışı bırakıyor, başarıda `setText('')` disabled durumunu sürdürüyor. Taslak düğmesi `disabled={busy}` (208). Düğme etiketi gönderim sırasında 'Gönder' olarak kalıyor. PushToggle.tsx:117-124 `disabled={busy}` ve ardından görünüm değişince düğme başka bir düğmeyle değişiyor.

**Etki:** Klavye ve ekran okuyucu kullanıcısı gönderdikten sonra odağı kaybediyor, sanal imleç sayfa başına dönebiliyor. Mesaj kutusuna geri dönmek için uzun bir Tab yolu gerekiyor.

**Önerilen aksiyon:** Meşgulken `disabled` yerine `aria-disabled='true'` kullan ve işleyicide `if (busy) return` ile koru. Başarıdan sonra `textareaRef.current?.focus()` çağır. Gönderimde düğmede 'Gönderiliyor…' göster. PushToggle'da yeni düğmeye ref ile odak ver.

## F999 — Taslak üretimi sırasında ilerleme metni, bittiğinde duyuru ve odak taşıma yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:211` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · observability                       |
| Sezgisel madde      | H12 — Feedback                                   |
| WCAG                | 4.1.3                                            |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** draft() sürerken düğme yine `{t('suggestDraft')}` ('Yanıt taslağı öner') diyor, yalnızca disabled. Başarıda metin kutuya sessizce yazılıyor. `aiDraftNotice` (190) live region olmayan düz bir `<p>`. LLM çağrısı saniyeler sürebiliyor. Projedeki benzer akış 'Öneri hazırlanıyor…' metnini gösteriyor (host.json:91).

**Etki:** Ev sahibi işlemin sürüp sürmediğini anlamıyor ve tekrar tıklıyor. Ekran okuyucu kullanıcısı taslağın eklendiğini öğrenemiyor.

**Önerilen aksiyon:** `busy` iken etiketi t('drafting') = 'Taslak hazırlanıyor…' yap. Başarıda textarea'ya odak ver ve `role='status'` ile 'Taslak mesaj kutusuna eklendi; göndermeden önce kontrol edip düzenleyin' duyur.

## F1000 — iPhone'da anlık bildirim için yol gösterilmiyor; yanıltıcı 'desteklemiyor' mesajı çıkıyor

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Medium                                 |
| Durum               | Aday                                   |
| Konum               | `src/components/pwa/PushToggle.tsx:19` |
| Kullanıcılar        | misafir                                |
| Prensip             | learnability · help / feedforward      |
| Sezgisel madde      | H10 — Yardım/dokümantasyon             |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | area:trips                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** `if (!pushSupported()) return { view: 'unsupported', status: null };` → 'Tarayıcınız anlık bildirimleri desteklemiyor.' (pwa.json:35). iOS/iPadOS Safari'de Web Push yalnız ana ekrana eklenmiş web uygulamasında var. Sekmede `'PushManager' in window` false döndüğü için bu mesaj gösteriliyor.

**Etki:** iPhone kullanan misafire özellik imkânsızmış gibi sunuluyor; aslında ana ekrana ekleyerek açabilir.

**Önerilen aksiyon:** iOS'ta ve standalone değilken (`!matchMedia('(display-mode: standalone)').matches && /iPhone|iPad/.test(navigator.userAgent)`) şu talimatı göster: 'iPhone'da bildirim için: Paylaş → Ana Ekrana Ekle, ardından uygulamayı ana ekrandan açın.'

## F1001 — Çevrimdışı bandı veri tazeliğini göstermiyor: yalnız tarih, saat yok ve UTC

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Medium                                 |
| Durum               | Aday                                   |
| Konum               | `src/components/pwa/TripsView.tsx:121` |
| Kullanıcılar        | misafir                                |
| Prensip             | robustness · observability             |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü         |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | area:trips                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** `t('offlineBanner', { time: fmt.date(data.generatedAt, 'long') })`. Yer tutucunun adı `time` ama `date()` yalnız gün, ay ve yıl biçimliyor ve varsayılan `timeZone = 'UTC'` (lib/i18n/format.ts:64). Türkiye'de 00:00-03:00 arasında kaydedilen plan bir önceki günün tarihiyle görünüyor.

**Etki:** Çevrimdışı misafir gösterilen planın 5 dakikalık mı 2 günlük mü olduğunu ayırt edemiyor. Bu arada iptal veya değişiklik olduysa yanlış bilgiyle tesise gidebilir.

**Önerilen aksiyon:** `fmt.dateTime(data.generatedAt)` kullan (yerel saat dilimi) veya Intl.RelativeTimeFormat ile '3 saat önce kaydedildi' göster.

## F1002 — Rezervasyon kimliği tutarsız ve okunamaz: detayda ham cuid, seyahat kartında 52 karakterlik 11px kod

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Aday                                                                          |
| Konum               | `src/components/pwa/TripsView.tsx:170`                                        |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:121`, `src/lib/notifications/templates.ts:181` |
| Kullanıcılar        | misafir                                                                       |
| Prensip             | learnability · consistency                                                    |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                   |
| Renk/tema           | Hayır                                                                         |
| Efor                | M                                                                             |
| Kaynak denetçiler   | area:trips                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                  |

**Kanıt:** Detay sayfasında 'Rezervasyon numarası: <b>{id}</b>' ham cuid, ör. 'cmummzo3200m53s50ynklp0sx' (page.tsx:121-124, v5-rnpl-plan.png). TripsView'da 'Rezervasyon kodu' `<code className='break-all text-[11px] text-gray-900'>{item.code}</code>` = `BK1.<id>.<22 karakter imza>` (booking-code.ts:23), ~52 karakter. E-posta yine bookingId kullanıyor (templates.ts:181). Kopyalama düğmesi yok.

**Etki:** Resepsiyonda 'rezervasyon numaranız' sorulan misafir iki farklı değer görüyor. 52 karakteri sesli okuyamıyor, 11px metin mobilde zor okunuyor, numarayı elle seçip kopyalaması gerekiyor.

**Önerilen aksiyon:** Tek bir insan-okunur referans tanımla (ör. id'nin son 8 karakteri büyük harfle, 'MZO3-200M' gibi gruplanmış). Her yerde aynı etiketi kullan ('Rezervasyon no'). İmzalı kodu yalnız QR içinde tut. Referansı `text-sm font-mono` ile göster ve 'Kopyala' düğmesi ekle (`navigator.clipboard.writeText` + `role='status'` 'Kopyalandı').

## F1151 — 'Giriş Yap' / 'Giriş yap' büyük harf tutarsızlığı aynı ekranda

| Alan                | Değer                              |
| ------------------- | ---------------------------------- |
| Severity            | Low                                |
| Durum               | Gözlemlendi                        |
| Konum               | `src/app/booking/[id]/page.tsx:84` |
| Diğer konumlar      | `messages/tr/booking.json`         |
| Kullanıcılar        | misafir                            |
| Prensip             | learnability · Consistency         |
| Sezgisel madde      | H4 — Tutarlılık/standartlar        |
| Renk/tema           | Hayır                              |
| Efor                | S                                  |
| Kaynak denetçiler   | runtime:trips                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**       |

**Kanıt:** Tarama 044 Tab sırası: başlıkta 'a "Giriş yap"' hemen ardından içerikte 'a "Giriş Yap"' (booking.json detail.login); /trips'te 'Giriş yap' (anon.mjs).

**Etki:** Küçük cila sorunu; tutarsız terminoloji güven algısını hafifçe düşürür.

**Önerilen aksiyon:** booking.json detail.login değerini 'Giriş yap' yapın.

## F1152 — Rezervasyon sayfası yüklenirken büyük düzen kayması (CLS 0.75)

| Alan                | Değer                                                           |
| ------------------- | --------------------------------------------------------------- |
| Severity            | Low                                                             |
| Durum               | Gözlemlendi                                                     |
| Konum               | `src/app/booking/[id]/page.tsx:102`                             |
| Kullanıcılar        | misafir                                                         |
| Prensip             | robustness · Responsiveness: içerik yüklenirken yerinde kalmalı |
| Sezgisel madde      | H15 — Performans                                                |
| Renk/tema           | Hayır                                                           |
| Efor                | S                                                               |
| Kaynak denetçiler   | runtime:checkout                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                    |

**Kanıt:** RUNTIME p16-mobile-layout.mjs (390x844): PerformanceObserver layout-shift değeri 0.7524 (t=746ms, kaynak FOOTER), ardından FORM.space-y-3 0.007 (RNPL ve kredi seçenekleri sonradan ekleniyor). p2'de RNPL seçeneği 800 ms'de henüz yoktu, yenilemede vardı.

**Etki:** Yükleme sırasında dokunan mobil kullanıcı yanlış öğeye basabiliyor; kart formu RNPL eklenince aşağı kayıyor.

**Önerilen aksiyon:** 'Yükleniyor' yerine gerçek kart düzeninde, min-height'lı bir iskelet gösterilsin. RNPL ve kredi seçenekleri için yer tutucu ayrılsın ya da ödeme formu bu istekler bitince birlikte render edilsin.

## F1153 — Rezervasyon numarası 25 karakterlik ham veritabanı kimliği

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | Low                                                                 |
| Durum               | Gözlemlendi                                                         |
| Konum               | `src/app/booking/[id]/page.tsx:121`                                 |
| Kullanıcılar        | misafir, ev sahibi                                                  |
| Prensip             | learnability · Familiarity: insanın okuyup söyleyebileceği referans |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                         |
| Renk/tema           | Hayır                                                               |
| Efor                | M                                                                   |
| Kaynak denetçiler   | runtime:checkout                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                        |

**Kanıt:** RUNTIME p2: 'Rezervasyon numarası: cmv2vvnye001bkd9zog9rjey5' (crops/checkout/p2-desktop-booking-s-0.png).

**Etki:** Telefonla destek ya da otel girişinde numarayı okumak ve yazmak hataya açık.

**Önerilen aksiyon:** Kısa ve gruplanmış bir referans (ör. BK-7F3K-29QM) üretilip gösterilsin; ham id yalnız URL'de kalsın.

## F1154 — Rezervasyon için iki farklı, okunması zor kimlik: ham DB id ve 52 karakterlik kod

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | Low                                      |
| Durum               | Gözlemlendi                              |
| Konum               | `src/app/booking/[id]/page.tsx:121`      |
| Diğer konumlar      | `src/components/pwa/TripsView.tsx`       |
| Kullanıcılar        | misafir, ev sahibi                       |
| Prensip             | learnability · Consistency / familiarity |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi              |
| Renk/tema           | Hayır                                    |
| Efor                | M                                        |
| Kaynak denetçiler   | runtime:trips                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**             |

**Kanıt:** Tarama 072: 'Rezervasyon numarası: cmv2uyf700o3c92w2ti427b8v' (25 karakter küçük harf+rakam); tarama 066: 'Rezervasyon kodu BK1.cmv2uyf700o3c92w2ti427b8v.GvTvtzPNrmepLzIkYf75_Q'. Aynı rezervasyon iki sayfada iki farklı adla/biçimde.

**Etki:** Telefonda/resepsiyonda kodu söylemek ve karşılaştırmak zor; 'numara' ile 'kod' aynı şey mi belirsiz.

**Önerilen aksiyon:** 8-10 karakterlik insan-dostu referans (ör. 'BK-7F3K-2Q9M') üretip her iki sayfada aynı etiketle gösterin; imzalı kod yalnız QR içinde kalsın.

## F1155 — Ödeme adımında fiyat dökümü yok; yalnız 'Toplam Tutar' gösteriliyor

| Alan                | Değer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Severity            | Low                                                                      |
| Durum               | Gözlemlendi                                                              |
| Konum               | `src/app/booking/[id]/page.tsx:156`                                      |
| Kullanıcılar        | misafir                                                                  |
| Prensip             | learnability · Tanıma > hatırlama: ödeme anında neyin ödendiği görülmeli |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                  |
| Renk/tema           | Hayır                                                                    |
| Efor                | M                                                                        |
| Kaynak denetçiler   | runtime:checkout                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                             |

**Kanıt:** RUNTIME p4 MAIN metni: 'Toplam Tutar ₺4.276,36' dışında gece fiyatı, vergi ya da kupon satırı yok. Checkout'ta görülen döküm (gecelik × gece, konaklama vergisi, KDV dahil, kupon −₺150) ödeme adımında tekrarlanmıyor.

**Etki:** Kupon uygulanmış mı, vergiler dahil mi, kullanıcı checkout ekranını hatırlamak zorunda; güven kontrolü zorlaşıyor.

**Önerilen aksiyon:** Rezervasyon anındaki teklif kalemleri saklanıp QuoteBreakdown bileşeniyle katlanabilir bir 'Fiyat dökümü' bölümünde gösterilsin.

## F1156 — Kaydırılabilir mesaj listesi odaklanabilir ama erişilebilir adı/rolü yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Gözlemlendi                                      |
| Konum               | `src/components/booking/BookingMessages.tsx:132` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | accessibility · Observability                    |
| Sezgisel madde      | H14 — Erişilebilirlik                            |
| WCAG                | 4.1.2 Name, Role, Value (A) — iyileştirme        |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | runtime:trips                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** p-variants.mts LIST (14 mesaj): ol scrollHeight 950 / clientHeight 320; iptal düğmesinden Tab -> odak 'ol' (Chrome otomatik odaklanabilir kaydırıcı), erişilebilir ad tüm içerikten türüyor ('Misafir: Mesaj 1: uzun bir içerik…'); aria-label/role/tabindex yok.

**Etki:** SR kullanıcısı listeye gelince tüm konuşmanın okunmasına maruz kalıyor; bölgenin ne olduğu söylenmiyor.

**Önerilen aksiyon:** ol'a role='log' aria-label={t('title')} tabIndex={0} ve görünür focus halkası (focusRing) ekleyin; aria-relevant='additions'.

## F1157 — Push kartı misafire teknik jargon gösteriyor ('VAPID anahtarları yok')

| Alan                | Değer                                   |
| ------------------- | --------------------------------------- |
| Severity            | Low                                     |
| Durum               | Gözlemlendi                             |
| Konum               | `src/components/pwa/PushToggle.tsx:113` |
| Diğer konumlar      | `messages/tr/pwa.json`                  |
| Kullanıcılar        | misafir                                 |
| Prensip             | learnability · Familiarity              |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi             |
| Renk/tema           | Hayır                                   |
| Efor                | S                                       |
| Kaynak denetçiler   | runtime:trips                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**            |

**Kanıt:** Tarama 066/067 (gerçek oturum, /trips): 'Anlık bildirimler bu sunucuda yapılandırılmamış (VAPID anahtarları yok); e-posta bildirimleri çalışmaya devam eder.' Ekran crops/booking/066-guest-tr-desktop-_trips-0.png.

**Etki:** Teknik olmayan misafir için anlamsız ve güven azaltıcı; eyleme dönük bilgi yok.

**Önerilen aksiyon:** Kullanıcı diliyle: 'Bu cihaza anlık bildirim şu an kullanılamıyor; e-posta bildirimleri açık.' — ya da server-off durumunda kartı gizleyin.

## F1369 — Detay sayfasının yükleniyor durumu duyurulmuyor, genel ve tutarsız metin

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | Low                                                                         |
| Durum               | Aday                                                                        |
| Konum               | `src/app/booking/[id]/page.tsx:102`                                         |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx:121`, `messages/tr/chat.json:3` |
| Kullanıcılar        | misafir                                                                     |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages                                  |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                              |
| WCAG                | 4.1.3                                                                       |
| Renk/tema           | Hayır                                                                       |
| Efor                | S                                                                           |
| Kaynak denetçiler   | area:trips                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                |

**Kanıt:** `<p className='text-center text-gray-500'>{t('detail.loading')}</p>` içinde role='status' veya aria-live yok. TripsView.tsx:82 ve RoleGate (ui.tsx:209) aria-live kullanıyor, yani tutarsız. Metin 'Yükleniyor...' üç nokta (booking.json:46, chat.json:3), common.json:11'de ise 'Yükleniyor…'.

**Etki:** Ekran okuyucu kullanıcısı sayfanın yüklendiğini veya ne yüklendiğini bilmiyor.

**Önerilen aksiyon:** `role='status'` ekle. Metni 'Rezervasyon yükleniyor…' ve 'Mesajlar yükleniyor…' olarak bağlamlı yap ve tüm çevirilerde '…' karakterine birleştir.

## F1370 — Ayrıntı sayfalarının h1'i bağlam taşımıyor; bazı yükleme ve boş durumlarda h1 hiç yok

| Alan                | Değer                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                               |
| Durum               | Aday                                                                                                                                              |
| Konum               | `src/app/booking/[id]/page.tsx:117`                                                                                                               |
| Diğer konumlar      | `src/app/resolution/[id]/page.tsx:53`, `src/app/checkout/cart/page.tsx:217`, `src/app/cart/page.tsx:52`, `src/app/pay/share/[token]/page.tsx:168` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                |
| Prensip             | accessibility · WCAG 2.4.6 Headings and Labels                                                                                                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                    |
| WCAG                | 2.4.6                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                             |
| Efor                | S                                                                                                                                                 |
| Kaynak denetçiler   | lens:nav                                                                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                      |

**Kanıt:** booking/[id] 117-119 h1 yalnız durum ("Rezervasyonunuz onaylandı"); ilan adı h2 (130). resolution/[id]/page.tsx:53 her talep için aynı başlık: "Talep ayrıntısı". Hata h1'i "Hata" (105). h1 olmayan durumlar: checkout/cart/page.tsx:217-223 (noCart), cart/page.tsx:52-58 (loading), pay/share:168-174 (loading), booking/[id] loading (101-102).

**Etki:** Birden çok rezervasyon veya talep sekmesi açık olan kullanıcı ve ekran okuyucu kullanıcısı h1'den hangi kaydın açık olduğunu anlayamıyor.

**Önerilen aksiyon:** h1'i "{property.title} — {durum}" yapın ya da durumu alt başlığa taşıyın. Talep sayfasında yükleme sonrası "{tür} talebi · {ilan}" gösterin (ClaimDetail'den callback ile). Yükleme ve boş durumlarda da sayfa h1'ini render edin.

## F1371 — Durum başlığı PENDING/EXPIRED/CANCELLED için sonraki adımı söylemiyor; mesajlaşmanın yokluğu açıklanmıyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/app/booking/[id]/page.tsx:118`         |
| Kullanıcılar        | misafir                                     |
| Prensip             | learnability · predictability (feedforward) |
| Sezgisel madde      | H13 — Feedforward                           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:trips                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** Başlıklar 'Rezervasyon beklemede', 'Ödeme süresi doldu' ve 'Rezervasyon iptal edildi' (booking.json:35-39); açıklayıcı alt cümle veya eylem yok. Mesajlaşma yalnız `['CONFIRMED','COMPLETED'].includes(booking.status)` iken render ediliyor (174-176); HELD/PENDING durumunda bölüm sessizce yok.

**Etki:** Misafir neyin beklendiğini ve ne yapması gerektiğini bilmiyor. Ödeme öncesi ev sahibine soru sormak isteyince mesaj alanını bulamıyor.

**Önerilen aksiyon:** Her durum için bir alt metin ekle: neyin beklendiği ve sonraki adım (EXPIRED için 'Oda serbest bırakıldı; tarihler uygunsa yeniden rezervasyon yapın' + tesis bağlantısı). HELD/PENDING için 'Mesajlaşma rezervasyon onaylandıktan sonra açılır.' notunu göster.

## F1372 — Mobilde aşırı iç boşluk (p-8/px-8) içerik alanını daraltıyor

| Alan                | Değer                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                                      |
| Durum               | Aday                                                                                                                                                                                     |
| Konum               | `src/app/booking/[id]/page.tsx:128`                                                                                                                                                      |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:116`, `src/app/host/messages/[bookingId]/page.tsx:21`, `src/components/auth/AuthCard.tsx:22`, `src/app/login/page.tsx:79`, `src/app/register/page.tsx:56` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                       |
| Prensip             | learnability · consistency                                                                                                                                                               |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                                                    |
| Efor                | S                                                                                                                                                                                        |
| Kaynak denetçiler   | lens:mobile                                                                                                                                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                             |

**Kanıt:** booking/[id]/page.tsx:116 `px-8 py-6` ve :128 `space-y-6 px-8 py-6`; host/messages/[bookingId]/page.tsx:21 `p-8`; AuthCard.tsx:22, login/page.tsx:79 ve register/page.tsx:56 `p-8`. Hepsi `px-4`'lük main içinde; 360px'te içerik ≈264px'e iniyor. Ortak Card bileşeni (ui.tsx:104) ise `p-5` kullanıyor.

**Etki:** Mesaj balonları (max-w-[80%]) ≈210px'e iniyor; ev sahibinin mobil mesajlaşmasında satıra birkaç kelime sığıyor. Ekranlar arasında kenar boşlukları tutarsız.

**Önerilen aksiyon:** `p-4 sm:p-8` ve `px-4 sm:px-8` kullan; mümkün olan yerlerde ortak Card bileşenine geç.

## F1373 — Uzun tek sütunlu sayfada sayfa içi gezinme yok; gezinme düğmeleri en altta

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/app/booking/[id]/page.tsx:182`              |
| Kullanıcılar        | misafir                                          |
| Prensip             | flexibility · dialog initiative / multithreading |
| Sezgisel madde      | H7 — Esneklik/verim                              |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** Sıra şöyle: durum bandı → detay → toplam → RNPL → işlemler → mesajlar (max-h-80) → çözüm paneli (depozito, talepler, talep formu) → en sonda 'Konaklamayı Görüntüle / Rezervasyonlarım / Yazdır' satırı (182-201).

**Etki:** 360px mobilde 'Rezervasyonlarım' ve 'Yazdır'a ulaşmak için birkaç ekran kaydırmak gerekiyor; mesajlara doğrudan atlama yolu yok.

**Önerilen aksiyon:** Bandın altına kısa bir sayfa içi bağlantı satırı ekle: 'Mesajlar' (`#msg-title`), 'Hasar ve çözüm' (`#resolution-panel-title`), 'Yazdır'. Ya da gezinme satırını mesajlar bölümünün üstüne taşı.

## F1374 — Yazdır çıktısına özel stil yok: menü, mesajlar, form ve düğmeler de basılıyor

| Alan                | Değer                               |
| ------------------- | ----------------------------------- |
| Severity            | Low                                 |
| Durum               | Aday                                |
| Konum               | `src/app/booking/[id]/page.tsx:195` |
| Kullanıcılar        | misafir                             |
| Prensip             | robustness · task conformance       |
| Sezgisel madde      | H8 — Estetik/minimal tasarım        |
| Renk/tema           | Hayır                               |
| Efor                | S                                   |
| Kaynak denetçiler   | area:trips                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**        |

**Kanıt:** `<button onClick={print}>` doğrudan window.print() çağırıyor. Projede hiç `print:` sınıfı veya `@media print` yok (grep). Header, DEMO şeridi, çerez bandı, özel mesaj yazışması, mesaj kutusu, talep formu ve footer çıktıya giriyor.

**Etki:** Basılan onay belgesi kalabalık, birkaç sayfa uzunluğunda oluyor ve özel yazışmaları içeriyor.

**Önerilen aksiyon:** Header, Footer, BookingActions, BookingMessages, BookingResolutionPanel ve düğme satırına `print:hidden` ekle. Kartta `print:shadow-none` kullan. Çıktıda yalnız rezervasyon no, tesis, tarihler, toplam ve iptal politikası kalsın.

## F1375 — Ev sahibi mesaj sayfasında rezervasyon bağlamı ve oturum kapısı yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/app/host/messages/[bookingId]/page.tsx:22`  |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx:121` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · observability                       |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                   |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | lens:status                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** host/messages/[bookingId]/page.tsx:17-23 yalnız 'Geri' bağlantısı + BookingMessages; misafir/tarih/ilan bilgisi yok, RoleGate yok → oturumsuzken BookingMessages.tsx:121 gri metinle sunucu mesajını gösteriyor.

**Etki:** Ev sahibi hangi rezervasyonla yazıştığını görmek için panele dönmek zorunda; oturum düştüğünde giriş yolu yok.

**Önerilen aksiyon:** Başlığa ilan adı, tarih aralığı ve misafir sayısı; sayfayı `<RoleGate roles={['HOST','ADMIN']}>` ile sar.

## F1376 — Gönderen, mesajının alıcıya dolandırıcılık uyarısıyla gösterildiğini bilmiyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:138` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | robustness · observability                       |
| Sezgisel madde      | H12 — Feedback                                   |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** `{!mine && m.risk && (` risk bandı yalnız alıcıya gösteriliyor. Yorum satırı 16: 'yalnızca alıcıya bant olarak gösterilir'. Gönderenin kendi balonunda bu konuda hiçbir işaret yok.

**Etki:** Meşru bir harici bağlantı (EXTERNAL_LINK) paylaşan ev sahibi, misafire 'şüpheli' göründüğünü bilmiyor ve mesajını düzeltemiyor.

**Önerilen aksiyon:** `mine && m.risk` durumunda kendi balonunun altına nötr bir not ekle: 'Bu mesaj alıcıya güvenlik uyarısıyla gösterildi: {gerekçeler}'.

## F1377 — Canlı bölge gürültüsü: geçmiş risk bantları role=alert, kendi mesajlar da duyuruluyor, boş durum liste öğesi

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:140` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages       |
| Sezgisel madde      | H14 — Erişilebilirlik                            |
| WCAG                | 4.1.3                                            |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** Her risk bandı `role='alert'` (140). Thread yüklenince tüm işaretli geçmiş mesajların uyarıları aynı anda DOM'a giriyor. `<ol aria-live='polite'>` (132) kullanıcının kendi gönderdiği mesajı da (`add(message)`, 87) zaman damgasıyla birlikte duyuruyor. Boş durum `<li>` olarak render ediliyor (133); ekran okuyucu 'liste, 1 öğe' diyor.

**Etki:** Sayfa açılışında art arda ve kesintili (assertive) duyurular oluyor. Ekran okuyucu kullanıcısı gönderdiği metni tekrar dinliyor.

**Önerilen aksiyon:** Listeye `role='log'` ve `aria-relevant='additions'` ver. Geçmiş risk bantlarından `role='alert'` kaldır (başlıklı düz bant yeterli). Yalnız karşı taraftan yeni gelen mesajları ayrı bir `role='status'` alanında kısa duyur. Boş durumu `<ol>` dışında `<p>` olarak render et.

## F1378 — Zaman damgaları makine-okunur değil, gün gruplaması yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:170` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | learnability · familiarity                       |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                      |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** `<div className='mt-0.5 text-xs text-gray-500'>{f.dateTime(m.createdAt)}` düz metin. Her mesajda '29.09.2026 15:12' tam tarihi tekrarlanıyor (messaging.png). `<time dateTime>` öğesi ve 'Bugün/Dün' ayracı yok.

**Etki:** Uzun sohbette hangi mesajın ne zaman geldiğini taramak zorlaşıyor; tekrar eden tarih görsel kalabalık yaratıyor.

**Önerilen aksiyon:** `<time dateTime={m.createdAt}>` kullan. Mesajları gün başlıklarıyla grupla ('Bugün', 'Dün', '29 Eylül') ve grup içinde yalnız saati göster.

## F1379 — 'fromAiDraft' işareti metin silinip yeniden yazılsa da açık kalıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:186` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · task conformance (veri doğruluğu)   |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                   |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** `setFromDraft(true)` taslakta (107) çalışıyor, sıfırlama yalnız başarılı gönderimde (89). `onChange={(e) => setText(e.target.value)}` (186) işareti sıfırlamıyor. Kutu tamamen temizlense de 'Yapay zekâ taslağı' notu (190) görünür kalıyor ve mesaj `fromAiDraft: true` ile kaydediliyor.

**Etki:** Ev sahibinin kendi yazdığı mesaj AI taslağı olarak işaretleniyor; denetim kaydı ve şeffaflık verisi yanlış oluyor.

**Önerilen aksiyon:** onChange içinde `if (!e.target.value.trim()) setFromDraft(false)` ekle; isteğe bağlı olarak taslaktan büyük oranda farklılaşınca da sıfırla.

## F1380 — Mesaj kutusu 14px; iOS Safari odaklanınca sayfayı yakınlaştırıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:187` |
| Kullanıcılar        | misafir, ev sahibi                               |
| Prensip             | learnability · predictability (mobil)            |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** textarea `text-sm` (14px). iOS Safari 16px altındaki form alanlarına odaklanınca otomatik yakınlaştırıyor.

**Etki:** iPhone'da mesaj yazmaya başlayan misafirin ekranı büyüyor, gönder düğmesi görünümden çıkıyor ve elle uzaklaştırması gerekiyor.

**Önerilen aksiyon:** `text-base sm:text-sm` kullan.

## F1381 — Taslak düğmesi yapay zekâ kullanıldığını önceden söylemiyor, taslakta standart AI rozeti yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/booking/BookingMessages.tsx:190` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | learnability · consistency                       |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                      |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:trips                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** Taslak yanıtı `{ draft, llmMode }` ve `ai_generated` içeriyor (message-service.ts:188, draft/route.ts) ama bileşen yalnız `res.draft` okuyor (103-107). Diğer AI çıktıları `<LlmBadge mode=…>` kullanıyor (HostDashboard.tsx:570, SupportChat.tsx:107, ReviewsSection.tsx:212). Düğme metni 'Yanıt taslağı öner' (chat.json:16) yapay zekâyı anmıyor.

**Etki:** Ev sahibi tıklamadan önce içeriği yapay zekânın üreteceğini bilmiyor. Demo veya yedek mod çıktısını canlı model çıktısından ayırt edemiyor.

**Önerilen aksiyon:** llmMode'u state'te tut ve aiDraftNotice'in yanında `<LlmBadge mode={llmMode} />` render et. Düğmeyi 'Yapay zekâ ile yanıt taslağı öner' olarak yeniden adlandır.

## F1382 — Bildirim izni penceresi kapatılınca geri bildirim yok; 'reddedildi' durumunda yeniden kontrol yolu yok

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Low                                    |
| Durum               | Aday                                   |
| Konum               | `src/components/pwa/PushToggle.tsx:61` |
| Kullanıcılar        | misafir                                |
| Prensip             | robustness · observability             |
| Sezgisel madde      | H12 — Feedback                         |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | area:trips                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** `setView(permission === 'denied' ? 'denied' : 'off'); return;`. Kullanıcı izin penceresini kapatırsa ('default') hiçbir mesaj çıkmıyor. denied metni (pwa.json:36) tarayıcı ayarına yönlendiriyor ama durum yalnız ilk effect'te (42-52) hesaplanıyor ve 'tekrar kontrol et' düğmesi yok.

**Etki:** Kullanıcı düğmenin çalışmadığını sanıyor. Ayarlardan izin verdikten sonra sayfayı yenilemesi gerektiğini bilmiyor.

**Önerilen aksiyon:** 'default' sonucunda `Status` ile 'İzin verilmedi; tekrar denemek için düğmeye basın.' göster. denied görünümüne 'Ayarları değiştirdim, tekrar kontrol et' düğmesi ekleyip detectPushState'i yeniden çağır veya `navigator.permissions.query({ name: 'notifications' })` onchange olayını dinle.

## F1383 — Çıkış saati, gece sayısı ve giriş/çıkış saatleri eksik

| Alan                | Değer                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Severity            | Low                                                                    |
| Durum               | Aday                                                                   |
| Konum               | `src/components/pwa/TripsView.tsx:151`                                 |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:136`, `src/lib/booking/itinerary.ts:44` |
| Kullanıcılar        | misafir                                                                |
| Prensip             | robustness · task conformance                                          |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                         |
| Renk/tema           | Hayır                                                                  |
| Efor                | S                                                                      |
| Kaynak denetçiler   | area:trips                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                           |

**Kanıt:** Seyahat kartı giriş saatini (`checkInFrom`, 147) gösteriyor ama çıkışta saat yok (151-154). itinerary.ts select'i `checkOutTime` alanını almıyor, oysa modelde `checkOutTime @default('11:00')` var. Detay sayfasının `<dl>`'si (page.tsx:136-154) ne saatleri ne de gece sayısını gösteriyor. checkInTime ham '14:00' olarak EN'de de aynı ('from 14:00').

**Etki:** Misafir çıkış saatini öğrenmek için ilana dönmek zorunda kalıyor; konaklama süresini tarihlerden kendisi hesaplıyor.

**Önerilen aksiyon:** İtinerary'ye `checkOutTime` ekle ve 'Çıkış saati: {time}' satırını göster. Detay `<dl>`'sine 'Süre: 2 gece' ile giriş/çıkış saatlerini ekle. Saatleri `fmt.time` ile dile göre biçimlendir.

## F1384 — QR ipucu seyahat yokken de gösteriliyor; boş durumda sonraki adım yok

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Low                                    |
| Durum               | Aday                                   |
| Konum               | `src/components/pwa/TripsView.tsx:179` |
| Kullanıcılar        | misafir                                |
| Prensip             | learnability · predictability          |
| Sezgisel madde      | H13 — Feedforward                      |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | area:trips                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** `<p className='text-xs text-gray-700'>{t('qrHint')}</p>` koşulun dışında, yani `items.length === 0` iken de 'Girişte bu QR kodu gösterin' görünüyor. Boş durum (124-127) 'Yaklaşan onaylı rezervasyonunuz yok.' metninde eylem bağlantısı yok ve ödemesi tamamlanmamış rezervasyonların burada görünmediğini açıklamıyor.

**Etki:** QR olmayan ekranda QR talimatı kafa karıştırıyor. HELD rezervasyonu olan misafir rezervasyonunun neden listede olmadığını anlamıyor.

**Önerilen aksiyon:** qrHint'i yalnız öğe varken ve listenin üstünde göster. Boş duruma `<Link href='/'>Konaklama ara</Link>` ve 'Ödemesi tamamlanmamış rezervasyonlar burada görünmez' notunu ekle.
