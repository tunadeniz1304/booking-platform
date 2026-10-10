# Rezervasyon kutusu ve fiyat dökümü — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 69 bulgu · Severity: Critical 1, High 18, Medium 32, Low 18

## F30 — Rezervasyon kutusundaki iki aylık tarih seçicide gün düğmeleri üst üste biniyor (360px ve masaüstü kenar çubuğu)

| Alan                | Değer                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Severity            | Critical                                                                                         |
| Durum               | Aday                                                                                             |
| Konum               | `src/components/booking/BookingWidget.tsx:152`                                                   |
| Diğer konumlar      | `src/components/search/DateRangePicker.tsx:188`, `src/components/search/DateRangePicker.tsx:215` |
| Kullanıcılar        | misafir                                                                                          |
| Prensip             | accessibility · WCAG 1.4.10 Reflow + task conformance                                            |
| Sezgisel madde      | H5 — Hata önleme                                                                                 |
| Renk/tema           | Hayır                                                                                            |
| Efor                | M                                                                                                |
| Kaynak denetçiler   | area:widget                                                                                      |
| **Düzeltme durumu** | **Zaten uygun** (paket: widget)                                                                  |

**Kanıt:** BookingWidget.tsx:152-156 `<div className="absolute left-0 right-0 z-20"><DateRangePicker ... monthCount={2} />`. Açılır pencere, kutunun iç genişliğiyle sınırlı. DateRangePicker.tsx:188 `grid gap-4 grid-cols-2`, :198 `grid grid-cols-7 gap-1`, :215 gün düğmesi `h-9 w-9` (36px sabit). lg kenar çubuğu yaklaşık 395px (docs/img/property.png); açılır pencere ~347px, ay ~150px, sütun ~18px. Aynı CSS headless Chromium ile ölçüldü: ilk 4 gün düğmesinin sol kenarı 42/64/85/107px, genişliği 36px. Yani her düğme bir sonrakiyle ~14px örtüşüyor. 360px ekranda sütun ~13px'e iniyor. Karşılaştırma: SearchBar.tsx:107 aynı seçiciye `lg:w-[560px]` veriyor, widget vermiyor.

**Etki:** Tarih değiştirmek isteyen misafir hem mobilde hem lg+ masaüstünde birbirine geçmiş rakamlar görüyor. Tıklama üstte duran komşu güne düşüyor ve yanlış giriş/çıkış seçiliyor. İade edilemez planda bu, yanlış tarihe ödeme yapmak demek. Tarih hatası toleransı en düşük görev bu.

**Önerilen aksiyon:** BookingWidget.tsx:152'de açılır pencereye kendi genişliğini ver: `absolute right-0 z-20 w-[min(36rem,calc(100vw-2rem))]`. Kenar çubuğu ve mobilde `monthCount={1}` geç; 2 ay yalnız ≥640px genişlikte ve pencere kutudan taşabiliyorsa gösterilsin. DateRangePicker.tsx:215'te sabit `w-9` yerine `w-full max-w-9 aspect-square mx-auto` kullanılsın ki düğme hücresine sığsın.

**Yapılan düzeltme:** In wave 1, DateRangePicker was changed to measure its container and drop to 1 month when narrow (TWO_MONTH_MIN_WIDTH), and day buttons became 'aspect-square w-full min-w-0', so they fit their cells with no overlap in the 395px sidebar or at 360px. In the widget I only connected onClose and added a close button (see F361/F362). — dosyalar: `src/components/booking/BookingWidget.tsx`

## F155 — Misafir sayısı oda kapasitesine göre sınırlanmıyor; hata EN arayüzde Türkçe, alanla ilişkisiz ve çözüm önermiyor

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | High                                                             |
| Durum               | Gözlemlendi                                                      |
| Konum               | `src/components/booking/BookingWidget.tsx:172`                   |
| Diğer konumlar      | `src/lib/pricing/quote.ts`, `src/components/booking/useQuote.ts` |
| Kullanıcılar        | misafir                                                          |
| Prensip             | robustness · Hata önleme / Recoverability (Dix)                  |
| Sezgisel madde      | H5 — Hata önleme                                                 |
| WCAG                | 3.3.1 Error Identification, 3.3.3 Error Suggestion               |
| Renk/tema           | Hayır                                                            |
| Efor                | S                                                                |
| Kaynak denetçiler   | runtime:pdp                                                      |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                            |

**Kanıt:** RUNTIME probe p2-widget.mjs: Galata'da odalar 2 ve 3 kişilik, seçenekler '1 misafir'…'6 misafir'. 3 ve 6 seçilince quote alanı 'Bu oda en fazla 2 kişiliktir', 'Rezervasyonu Onayla' ve 'Sepete ekle' disabled. EN probe p11-en-err.mjs (mobil, en): aynı mesaj Türkçe 'Bu oda en fazla 2 kişiliktir'; #guest-count aria-invalid=null, aria-describedby=null; mesaj role'süz. Kod: BookingWidget.tsx:172 sabit [1..6]; metin sunucuda sabit: src/lib/pricing/quote.ts:345.

**Etki:** Kullanıcı önce imkânsız bir seçimi yapıp devre dışı CTA ile karşılaşıyor; yabancı misafir nedenini anlayamıyor; 3 kişilik 'Terash Loft'a geçmesi gerektiği söylenmiyor.

**Önerilen aksiyon:** Misafir seçeneklerini max(oda kapasitesi) ile sınırlayın veya kapasiteyi aşan odaları seçenekte '(en fazla 2 kişi)' diye devre dışı bırakın; aşımda 'Bu oda en fazla 2 kişi. 3 kişilik Terash Loft'u seçin' + odayı değiştiren düğme önerin. Sunucu hata kodunu (ör. code:'OVER_CAPACITY', params) döndürsün, metin istemcide next-intl ile çevrilsin; select'e aria-invalid + aria-describedby bağlayın.

**Yapılan düzeltme:** Capacity is now checked in the client, in the UI language. When guestCount > selectedRoom.capacity, no quote is requested (roomId undefined), a widget.overCapacity / overCapacityNoRoom message is shown, and the guest and room selects get aria-invalid plus aria-describedby linked to the message. Room options too small for the guest count show the 'roomOptionTooSmall' label. If a room fits, a 'switch to that room' button (Button secondary) appears and the switch is announced in the aria-live area. The server error code (OVER_CAPACITY) needs a backend change. — dosyalar: `src/components/booking/BookingWidget.tsx`

## F156 — İptal politikası sayfada hiç yok; fiyat seçenekleri ayırt edilemiyor ve fiyat farkı gösterilmiyor

| Alan                | Değer                                                           |
| ------------------- | --------------------------------------------------------------- |
| Severity            | High                                                            |
| Durum               | Gözlemlendi                                                     |
| Konum               | `src/components/booking/BookingWidget.tsx:219`                  |
| Diğer konumlar      | `src/app/property/[id]/page.tsx`                                |
| Kullanıcılar        | misafir                                                         |
| Prensip             | learnability · Predictability / Feedforward (Dix) — Familiarity |
| Sezgisel madde      | H13 — Feedforward                                               |
| Renk/tema           | Hayır                                                           |
| Efor                | M                                                               |
| Kaynak denetçiler   | runtime:pdp                                                     |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                           |

**Kanıt:** RUNTIME probe p12-text.mjs (Grand Deluxe, desktop TR): main metninde 'iptal' yalnız plan alt yazılarında: 'İptal politikasına göre iade' (Standart, Esnek, Kahvaltı dahil üçünde aynı); politika metni/bağlantısı yok (policy links: []). p2-widget.mjs: plan etiketleri 'İade edilemez / İade edilemez' (tekrar), Standart ve 'Esnek — şimdi rezerve et, sonra öde' aynı alt yazı; fiyat farkı yalnız radyo seçilince görünüyor (Galata 2 gece: ₺3.814,36 / ₺4.238,18 / ₺4.365,32). Kod: page.tsx:44-82 select'te cancellationPolicy alınmıyor (schema.prisma:139-140'ta ilişki var); BookingWidget.tsx:219-224.

**Etki:** Misafir iade koşulunu (son ücretsiz iptal tarihi) bilmeden para riski alıyor; seçenekleri karşılaştırmak için hepsini tek tek tıklayıp hatırlamak zorunda (tanıma yerine hatırlama).

**Önerilen aksiyon:** Mülkün CancellationPolicy'sini sorgulayıp widget'ta plan başına somut metin gösterin: 'Ücretsiz iptal: 10 Eki 23:59'a kadar', 'İade edilemez — %10 daha ucuz'. Her radyonun yanında toplam veya fark ('+₺424') gösterin; aynı metni tekrar etmeyin. Sayfaya 'İptal politikası' bölümü + checkout özetinde planı ekleyin.

**Yapılan düzeltme:** Every plan row now shows its difference from the cheapest plan ('+%X' or 'en uygun fiyat'), calculated from priceModifierBps. A plan name that matches the start of the refund text ('İade edilemez / İade edilemez') is no longer repeated. The refundable/nonRefundable texts are more concrete, and an 'İptal koşullarını gör' link points to the page's #policies section. A per-plan free-cancellation date needs the backend to return it with the plan. — dosyalar: `src/components/booking/BookingWidget.tsx`

## F157 — Oturumsuz 'Sepete ekle' girişe yönlendiriyor ve dönüşte tüm seçimler kayboluyor

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | High                                                                         |
| Durum               | Gözlemlendi                                                                  |
| Konum               | `src/components/cart/AddToCartButton.tsx:57`                                 |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx`                                   |
| Kullanıcılar        | misafir                                                                      |
| Prensip             | robustness · Recoverability / Persistence (Dix) — kullanıcı emeği korunmuyor |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                            |
| Renk/tema           | Hayır                                                                        |
| Efor                | M                                                                            |
| Kaynak denetçiler   | runtime:pdp                                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                                        |

**Kanıt:** RUNTIME probe p5-anon-flow.mjs: anon olarak takvimden 20–23 Eki, 3 misafir, 'Terash Loft', 'İade edilemez' seçildi (toplam ₺9.535,92) → 'Sepete ekle' → hiçbir uyarı olmadan /login?redirect=%2Fproperty%2Fcmv2uydl30fot92w2i9c8a4fa (sorgu dizesi yok). Giriş sonrası hedef URL'e dönüş simülasyonu: '12 Eki 2026 - 13 Eki 2026', 2 misafir, Loft, Standart, ₺2.119,09 — tüm seçim sıfırlandı. Giriş sayfası metni bağlam vermiyor ('Rezervasyonlarınıza ve favorilerinize erişin.'). Kod: AddToCartButton.tsx:58-60 yalnız pathname+search; widget seçimi URL'e hiç yazılmıyor (p9-sync: takvim seçimi sonrası URL değişmedi, yenilemede eski değerler).

**Etki:** Kullanıcı 4-5 adımlık seçimini kaybeder, sepete ekleyemediğini fark etmeyebilir veya yanlış tarih/odayla devam eder; dönüşüm kaybı.

**Önerilen aksiyon:** Seçimleri URL'e yansıtın (router.replace ile ?checkIn&checkOut&guests&roomId&ratePlanId) ve 401'de bu tam URL'i redirect olarak gönderin; dönüşte bekleyen 'sepete ekle' niyetini (ör. ?intent=add-to-cart) otomatik tamamlayın. Oturumsuzken düğmenin altında 'Sepete eklemek için giriş yapmanız gerekecek' feedforward'u ve giriş sayfasında 'Sepete eklemek için giriş yapın' bağlam başlığı gösterin.

**Yapılan düzeltme:** On a 401, the login redirect URL now carries the selections (checkIn, checkOut, guests, roomId, ratePlanId) plus intent=add-to-cart, built with loginHref. When the user comes back, the add is completed once as soon as the quote is ready, and intent is removed from the URL. For signed-out users (useSession) the hint says 'giriş istenecek; seçimleriniz korunur'. The button has aria-busy and aria-describedby, and the extra role=alert was removed. A context heading on the login page belongs to another owner. — dosyalar: `src/components/cart/AddToCartButton.tsx`

## F178 — Rezervasyon kutusunda misafir seçimi 1–6 ile sınırlı, aramadan gelen 7+ misafir '1 misafir' görünüyor

| Alan                | Değer                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                    |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                |
| Konum               | `src/components/booking/BookingWidget.tsx:172`                                                                                                                          |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:162`, `src/components/search/SearchBar.tsx:187`, `src/components/booking/BookingWidget.tsx:71`, `src/lib/pricing/quote.ts:344-345` |
| Kullanıcılar        | misafir                                                                                                                                                                 |
| Prensip             | robustness · observability                                                                                                                                              |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                       |
| Kaynak denetçiler   | lens:mobile, lens:forms                                                                                                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: widget)                                                                                                                                          |

**Kanıt:** SearchBar.tsx:162 yetişkin için `Math.min(30, adults + 1)`, :187 çocuk için `Math.min(10, …)` kullanıyor. :46 toplamı `guests` olarak URL'ye yazıyor (en fazla 40). BookingWidget.tsx:71-72 `initial.guests` değerini state'e olduğu gibi alıyor, ama :166-176 select seçenekleri sabit `[1, 2, 3, 4, 5, 6]`. `value={8}` hiçbir option'la eşleşmeyince React ilk seçeneği seçili gösteriyor. Ekranda '1 misafir' yazarken useQuote (:87-94) ve gönderim (:116-124 guestCount) 8 kişiyle hesaplanıyor.

**Etki:** Kalabalık aile ya da grup aramasında misafir ilan sayfasında '1 misafir' görüyor, fiyat ise 8 kişi için geliyor (ya da kapasite hatası çıkıyor). Ekrandaki durum gerçek durumla çelişiyor, yani kişi sayısı ve para hatası riski var. Kullanıcı select'i '1'e düzeltirse aramadaki niyeti sessizce kayboluyor.

**Önerilen aksiyon:** Seçenekleri sabit dizi yerine `1..max(maxRoomCapacity, initial.guests)` aralığından üret. Daha iyisi SearchBar'daki −/+ adımlayıcıyı ortak bileşen yapıp burada kullan (üst sınır = seçili oda kapasitesi). initial.guests kapasiteyi aşıyorsa görünür bir uyarı göster: 'Bu oda en fazla N kişilik; birden fazla oda için sepete ekleyin'. Çocuk sayısını da aramadan taşı.

**Yapılan düzeltme:** Guest options are now 1..max(largest room capacity, current guestCount), so a value of 7+ from search shows up in the select. If it exceeds capacity, a visible warning plus a room suggestion is shown (as in F155). Carrying children separately belongs to SearchBar (crossOwner). — dosyalar: `src/components/booking/BookingWidget.tsx`

## F360 — Misafir sayısı modeli ekranlar arasında tutarsız: aramadaki oda sayısı hiç gönderilmiyor, 6'dan fazla misafir widget'ta yanlış görünüyor

| Alan                | Değer                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                              |
| Durum               | Aday                                                                                                                                                                                                                                                              |
| Konum               | `src/components/booking/BookingWidget.tsx:71`                                                                                                                                                                                                                     |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:166-177`, `src/components/search/SearchBar.tsx:24-26`, `src/components/search/SearchBar.tsx:46`, `src/components/cart/AddToCartButton.tsx:50-52`, `src/app/cart/page.tsx:138-167`, `src/app/property/[id]/page.tsx:112` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                           |
| Prensip             | learnability · consistency / task conformance                                                                                                                                                                                                                     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                             |
| Efor                | M                                                                                                                                                                                                                                                                 |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                                                                                                                                                                                                                             |

**Kanıt:** SearchBar.tsx:24-26'da yetişkin, çocuk ve oda sayısı (`roomsCount`) ayrı sayaçlar. Ama :46'da yalnızca `params.set("guests", String(totalGuests))` gönderiliyor, roomsCount hiçbir yere iletilmiyor. Yetişkin sınırı 30, çocuk sınırı 10 (:162, :187). BookingWidget.tsx:71-73 `useState(initial?.guests && initial.guests >= 1 ? Math.floor(initial.guests) : 2)` aramadan gelen değeri olduğu gibi alıyor, ama :172 select yalnızca `[1, 2, 3, 4, 5, 6]` seçeneğini sunuyor. Değer 8 olduğunda kontrollü select görsel olarak ilk seçeneği gösterirken teklif 8 misafirle hesaplanıyor. AddToCartButton.tsx:50-52 `adults, children: 0, quantity: 1` gönderiyor; sepet sayfası (cart/page.tsx:138-167) ise yetişkin ve çocuğu ayrı alanlarda düzenletiyor.

**Etki:** 8 kişilik arama yapan misafir ilan sayfasında '1 misafir' görür, ama ödeyeceği fiyat 8 kişilik hesaplanır. Bu doğrudan bir para ve beklenti hatası. Aramada '2 oda' seçen kullanıcının seçimi sessizce yok sayılır. Çocuklar sepete hiç taşınmaz.

**Önerilen aksiyon:** Tek bir `GuestPicker` bileşeni (yetişkin, çocuk, oda; aynı sınırlar) yapın ve SearchBar, BookingWidget ve sepet satırında kullanın. URL'ye `adults`, `children`, `rooms` olarak taşıyın. Seçim desteklenmiyorsa (ör. oda sayısı) sayaçtan kaldırın. Widget seçenek listesi, initial.guests değerini ve oda kapasitesini kapsayacak şekilde dinamik üretilsin, kapasite aşılırsa açık bir uyarı gösterilsin. AddToCart'a gerçek `children` değeri iletilsin.

**Yapılan düzeltme:** In the widget, guest options are generated dynamically, the value from search is kept, and capacity overflow produces a warning. A shared GuestPicker, carrying adults/children/rooms in the URL, and the real children value need SearchBar, cart and the URL contract (crossOwner). — dosyalar: `src/components/booking/BookingWidget.tsx`

## F361 — Çıkış tarihi seçilince takvim kapanıyor ve klavye odağı kayboluyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | High                                           |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/BookingWidget.tsx:109` |
| Kullanıcılar        | misafir                                        |
| Prensip             | accessibility · WCAG 2.4.3 Focus Order         |
| Sezgisel madde      | H14 — Erişilebilirlik                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: widget)                 |

**Kanıt:** BookingWidget.tsx:106-110 `const handleDateChange = ... if (v.checkOut) setCalendarOpen(false);`. O anda odak, tıklanan gün düğmesinde (DateRangePicker.tsx:209). Pencere unmount olunca odaklanmış öğe DOM'dan kalkıyor; tetikleyici düğmeye ref veya `focus()` çağrısı yok.

**Etki:** Klavye ve ekran okuyucu kullanıcısında odak `<body>`'ye düşüyor. Sonraki Tab sayfanın başından başlıyor. Ekran okuyucu yeni tarih özetini ve hesaplanan fiyatı bağlam içinde duyurmuyor; kullanıcı rezervasyon kutusunu yeniden bulmak zorunda kalıyor.

**Önerilen aksiyon:** Tarih düğmesine `const triggerRef = useRef<HTMLButtonElement>(null)` bağla. handleDateChange içinde `setCalendarOpen(false)` çağrısından sonra `requestAnimationFrame(() => triggerRef.current?.focus())` çalıştır. Escape ile kapatmada da aynı odak iadesi yapılsın.

**Yapılan düzeltme:** Added triggerRef and closeCalendar(returnFocus). Once the check-out date is picked, or on Escape (DateRangePicker onClose) or the close button, focus returns to the date button via requestAnimationFrame. The trigger also got aria-haspopup=dialog, focusRing and min-h-[44px]. — dosyalar: `src/components/booking/BookingWidget.tsx`

## F362 — Takvim açılır penceresi Escape veya dış tıklamayla kapanmıyor ve arkasındaki alanlara giden odağı tamamen örtüyor

| Alan                | Değer                                                    |
| ------------------- | -------------------------------------------------------- |
| Severity            | High                                                     |
| Durum               | Aday                                                     |
| Konum               | `src/components/booking/BookingWidget.tsx:151`           |
| Kullanıcılar        | misafir                                                  |
| Prensip             | accessibility · WCAG 2.4.11 Focus Not Obscured (Minimum) |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                        |
| Renk/tema           | Hayır                                                    |
| Efor                | S                                                        |
| Kaynak denetçiler   | area:widget                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: widget)                           |

**Kanıt:** BookingWidget.tsx:151-158 `{calendarOpen && (<div className="absolute left-0 right-0 z-20">...`. Ne `onKeyDown` Escape işleyicisi ne de dış tıklama dinleyicisi var; pencere yalnızca düğmeye yeniden basınca (:145) ya da çıkış tarihi seçilince (:109) kapanıyor. DOM sırasında son gün düğmesinden sonraki odak `#guest-count` (:166). Bu select ve oda select'i, z-20 ile üstte duran ~300px yüksekliğindeki pencerenin altında kalıyor. Kıyas: DestinationAutocomplete.tsx:48 dış tıklamayı `mousedown` ile yakalıyor.

**Etki:** Yalnız klavye kullanan misafir takvimden Tab ile çıkınca odak görünmeyen misafir sayısı select'ine düşüyor ve neyi değiştirdiğini göremiyor (AA ihlali). Fare veya dokunmatik kullanıcı pencereyi dışarı tıklayarak kapatamıyor; mobilde oda ve plan seçimini kapatıyor.

**Önerilen aksiyon:** Sarmalayıcı `div.relative`'e `ref` ve `onKeyDown={(e) => { if (e.key === "Escape") { setCalendarOpen(false); triggerRef.current?.focus(); } }}` ekle. `useEffect` ile `document`'e `mousedown` ve `focusin` dinleyicisi bağla; hedef ref dışındaysa `setCalendarOpen(false)` çağır. Pencereye `role="dialog" aria-label={t("widget.dates")}` ver. İçine görünür bir "Kapat" düğmesi ekle.

**Yapılan düzeltme:** Escape now closes the picker through its onClose. While it is open, mousedown and focusin listeners on document close it when the target is outside datesRef. A visible 'Takvimi kapat' button (Button secondary) was added under the picker. The picker root already has role=dialog and aria-label. — dosyalar: `src/components/booking/BookingWidget.tsx`

## F363 — Misafir seçimi 1-6 ile sabit; aramadan gelen 6'dan büyük değer select'te görünmüyor ama teklif o değerle hesaplanıyor; oda kapasitesi yok sayılıyor

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | High                                                                      |
| Durum               | Aday                                                                      |
| Konum               | `src/components/booking/BookingWidget.tsx:172`                            |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:162`, `src/lib/pricing/quote.ts:345` |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | robustness · task conformance                                             |
| Sezgisel madde      | H5 — Hata önleme                                                          |
| Renk/tema           | Hayır                                                                     |
| Efor                | M                                                                         |
| Kaynak denetçiler   | area:widget                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: widget)                                            |

**Kanıt:** BookingWidget.tsx:71-73 `initial?.guests && initial.guests >= 1 ? Math.floor(initial.guests) : 2`: üst sınır yok. :172 `{[1, 2, 3, 4, 5, 6].map(...)}`. SearchBar.tsx:162 `Math.min(30, adults + 1)` ve :187 `Math.min(10, children + 1)`, yani aramada 40 kişiye kadar seçilebiliyor. :191-198 oda seçenekleri `capacity`'ye göre süzülmüyor ve devre dışı bırakılmıyor. quote.ts:345 `Bu oda en fazla ${room.maxOccupancy} kişiliktir` hatası ancak sonradan geliyor.

**Etki:** 8 kişi arayan misafir ilan sayfasına geliyor. Select hiçbir seçeneğe eşleşmediği için boş görünüyor, oysa useQuote guests=8 ile çalışıyor. Ekrandaki ile hesaplanan uyuşmuyor. 2 kişilik odada 5 misafir seçen kullanıcı da ön uyarı almadan hata görüyor.

**Önerilen aksiyon:** Seçenekleri `1..Math.max(6, initialGuests, ...availableRooms.map(r => r.capacity))` aralığından üret. Oda seçeneklerinde `capacity < guestCount` olanları `disabled` yap ve metne `t("widget.tooSmall", { capacity })` ekle. Kapasitesi yeten ilk odayı otomatik seç ve bunu role="status" ile bildir.

**Yapılan düzeltme:** Options are 1..max(capacity, guestCount). Rooms that are too small are labelled in the option text ('… · N misafir için küçük'). Instead of switching rooms silently, there is a 'switch to the right room' button, and the switch is announced in the polite live area. — dosyalar: `src/components/booking/BookingWidget.tsx`

## F364 — Misafir/oda sayısı ekranlar arasında farklı modelleniyor; seçilen değer sessizce kayboluyor veya yanlış görünüyor

| Alan                | Değer                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                        |
| Durum               | Aday                                                                                                                                                                                                                        |
| Konum               | `src/components/booking/BookingWidget.tsx:172`                                                                                                                                                                              |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:46`, `src/components/search/SearchBar.tsx:141`, `src/components/search/SearchBar.tsx:162`, `src/components/booking/BookingWidget.tsx:71-73`, `src/components/plan/TripPlanner.tsx:155` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                     |
| Prensip             | learnability · consistency                                                                                                                                                                                                  |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                                                       |
| Efor                | M                                                                                                                                                                                                                           |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                                                                                                                                                                                       |

**Kanıt:** SearchBar.tsx:162 yetişkin en çok 30, 187 çocuk en çok 10, 209 oda en çok 30 seçtirir; 141 özet '{guests} misafir · {rooms} oda' der ama 46 yalnız `params.set("guests", String(totalGuests))` gönderir — oda sayısı ve çocuk ayrımı hiçbir yere gitmez. BookingWidget.tsx:71-73 URL'den 8 misafiri alır ama 172 seçenekleri `[1,2,3,4,5,6]`; kontrol değeri listede olmadığından kutu boş/ilk seçenek görünürken useQuote 94 satırında 8 kişi için teklif ister. TripPlanner misafir max 10, sepet ayrı Yetişkin/Çocuk alanları (cart/page.tsx:138-167).

**Etki:** Kalabalık grup araması yapan misafir ilan sayfasında görmediği bir misafir sayısıyla fiyat alır ya da sunucudan anlaşılmaz bir hata görür; seçtiği '3 oda' tamamen yok sayılır (yanlış beklenti, para/tarih hatası).

**Önerilen aksiyon:** Tek bir misafir modeli (yetişkin, çocuk, oda) tanımlayıp SearchBar→PropertyCard→BookingWidget→checkout zincirinde aynı parametrelerle taşıyın; widget'ta select yerine SearchBar'daki sayaçları kullanın ve oda kapasitesini aşan değerde 'Bu oda en fazla N kişi alır' alan uyarısı verin; desteklenmeyen 'oda' seçimini ya gönderin ya da arayüzden kaldırın.

**Yapılan düzeltme:** In the widget, values are no longer lost or displayed wrongly (dynamic options plus a capacity warning). A single guest model across the SearchBar, PropertyCard, checkout and cart chain needs other owners. — dosyalar: `src/components/booking/BookingWidget.tsx`

## F365 — Kişi sayısı 6'dan fazla olduğunda ilan formu yanlış değer gösteriyor (görünen ile fiyatlanan farklı)

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | High                                           |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/BookingWidget.tsx:172` |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:162`      |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · observability                     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                 |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | lens:nav                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: widget)                 |

**Kanıt:** SearchBar.tsx:162 yetişkini 30'a, :187 çocuğu 10'a kadar izin veriyor; guests değeri 40'a çıkabiliyor (46). BookingWidget.tsx:71-73 `initial.guests >= 1 ? Math.floor(initial.guests) : 2`, üst sınır yok. Seçenekler yalnız `[1, 2, 3, 4, 5, 6]` (172). guestCount=8 iken kontrollü `<select value={8}>` eşleşen seçenek bulamıyor ve ilk seçeneği ("1 misafir") gösteriyor. useQuote (87-94) ve checkout parametresi (122 `guestCount`) ise 8 kullanıyor.

**Etki:** Grup misafiri formda "1 misafir" görürken fiyat 8 kişi için hesaplanıyor ya da kapasite hatası alınıyor. Checkout'ta 8 görünüyor; ödeme adımında çelişkili bilgi oluşuyor.

**Önerilen aksiyon:** Seçenekleri `Math.max(...rooms.map(r => r.capacity))` değerine kadar üretin ve mevcut guestCount'u her zaman dahil edin. Başlangıç değerini bu üst sınıra sıkıştırın ve satır içi uyarı gösterin: "Aramanız 8 kişi içindi; bu tesiste oda başına en çok 6 kişi kalabilir". SearchBar üst sınırını platform kapasitesiyle hizalayın.

**Yapılan düzeltme:** guestCount is always in the option list, so the displayed value matches the priced value. When it exceeds capacity, no quote is requested and an inline warning plus a room suggestion is shown. Aligning the SearchBar upper limit is crossOwner. — dosyalar: `src/components/booking/BookingWidget.tsx`

## F366 — Tek fiyat planında iade ve yemek bilgisi hiç gösterilmiyor; iptal koşulu kutuda, dökümde ve checkout özetinde yok

| Alan                | Değer                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Severity            | High                                                                            |
| Durum               | Aday                                                                            |
| Konum               | `src/components/booking/BookingWidget.tsx:203`                                  |
| Diğer konumlar      | `src/components/booking/QuoteBreakdown.tsx:92`, `src/app/checkout/page.tsx:172` |
| Kullanıcılar        | misafir                                                                         |
| Prensip             | robustness · observability                                                      |
| Sezgisel madde      | H13 — Feedforward                                                               |
| Renk/tema           | Hayır                                                                           |
| Efor                | M                                                                               |
| Kaynak denetçiler   | area:widget                                                                     |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                                           |

**Kanıt:** BookingWidget.tsx:203 `{plans.length > 1 && (<fieldset ...>`. :222 `plan.refundable ? t("widget.refundable") : t("widget.nonRefundable")` yalnızca bu blok içinde. QuoteBreakdown.tsx:34-117 iade veya iptal satırı içermiyor. checkout/page.tsx:172-203 özet tablosunda plan veya iptal koşulu yok. src/app/property ve src/components/property altında iptal politikası gösterilmiyor (grep: cancellationPolicy/freeCancellation yalnız RnplOption'da).

**Etki:** Odanın tek planı "İade edilemez" ise misafir bunu ödeme öncesi hiçbir yerde görmüyor. İptal etmek istediğinde para kaybediyor. Ücretsiz iptal son tarihi de hiçbir adımda yok.

**Önerilen aksiyon:** plans.length === 1 olduğunda oda select'inin altına statik bir satır çiz: plan adı, `refundable`/`nonRefundable` ve yemek bilgisi. Teklif yanıtına sunucudan `cancellation: { freeUntil, refundable }` özeti eklensin. QuoteBreakdown'da toplamın altına `t("quote.freeCancelUntil", { date })` veya `t("quote.nonRefundable")` satırı gösterilsin; aynı satır checkout özetinde de yer alsın.

**Yapılan düzeltme:** When plans.length === 1, a static line under the room select shows the plan name, refund status and meal info, and the policy link appears whenever there is at least one plan. A cancellation line in QuoteBreakdown and in the checkout summary needs a server-side quote.cancellation summary (backend) and the checkout page (other owner). — dosyalar: `src/components/booking/BookingWidget.tsx`

## F367 — Fiyat seçeneği 'İptal politikasına göre iade' diyor; iade son tarihi/oranı gösterilmiyor

| Alan                | Değer                                                             |
| ------------------- | ----------------------------------------------------------------- |
| Severity            | High                                                              |
| Durum               | Aday                                                              |
| Konum               | `src/components/booking/BookingWidget.tsx:222`                    |
| Diğer konumlar      | `messages/tr/booking.json:12`, `src/app/compare/page.tsx:169-173` |
| Kullanıcılar        | misafir                                                           |
| Prensip             | learnability · predictability (feedforward)                       |
| Sezgisel madde      | H13 — Feedforward                                                 |
| Renk/tema           | Hayır                                                             |
| Efor                | M                                                                 |
| Kaynak denetçiler   | lens:copy                                                         |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                             |

**Kanıt:** BookingWidget.tsx:222 `plan.refundable ? t("widget.refundable") : t("widget.nonRefundable")` → booking.json:12 'İptal politikasına göre iade'. Politika türü/son tarih hiçbir yerde yok; karşılaştırma sayfası ise aynı bilgiyi compare.json freeCancel 'Girişten {hours} saat öncesine kadar ücretsiz iptal' ile somut veriyor (compare/page.tsx:169-173).

**Etki:** Misafir iade edilebilir ve edilemez plan arasındaki fiyat farkının neye karşılık geldiğini bilmeden seçim yapar; iptalde beklemediği kesintiyle karşılaşır (para).

**Önerilen aksiyon:** Plan satırına politika özetini ekleyin: '{tarih} 23:59'a kadar ücretsiz iptal, sonra %50 iade' (compare'deki freeCancellationHours verisini plan düzeyinde döndürün); iade edilemez planda 'İptal ederseniz iade yapılmaz' cümlesini kullanın.

**Yapılan düzeltme:** Refund texts are now more concrete ('İade edilebilir (iptal koşullarına göre)', 'İade edilemez: iptal ederseniz ücret geri ödenmez'), and a link goes to the cancellation terms section (#policies). A per-plan free-cancellation date and refund percentage need the backend to return them. — dosyalar: `src/components/booking/BookingWidget.tsx`

## F368 — Sunucudan gelen hata metinleri ve vergi/ücret etiketleri yalnız Türkçe; EN arayüzde Türkçe görünüyor; hata kodu kullanılmıyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                |
| Konum               | `src/components/booking/BookingWidget.tsx:234`                                                                                                                                                                                                                                                                                      |
| Diğer konumlar      | `src/components/booking/QuoteBreakdown.tsx:60`, `src/components/booking/QuoteBreakdown.tsx:69`, `src/components/booking/useQuote.ts:117`, `src/lib/api-client.ts:40`, `src/components/cart/AddToCartButton.tsx:65`, `src/components/booking/PriceInsight.tsx:80`, `src/lib/pricing/tax.ts:97`, `src/lib/booking/restrictions.ts:56` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                             |
| Prensip             | robustness · recoverability (WCAG 3.1.2 Language of Parts)                                                                                                                                                                                                                                                                          |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                               |
| Efor                | M                                                                                                                                                                                                                                                                                                                                   |
| Kaynak denetçiler   | area:widget                                                                                                                                                                                                                                                                                                                         |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                                                                                                                                                                                                                                                                                               |

**Kanıt:** BookingWidget.tsx:234 `{error && <p className="text-sm text-red-600">{error}</p>}`. useQuote.ts:117 `error: body.error ?? FETCH_FAILED`. useQuote.ts:56-57 `code` döndürülüyor ama widget kullanmıyor. Sunucu metinleri sabit Türkçe: quote.ts:345 `Bu oda en fazla ... kişiliktir`, restrictions.ts:56 `${v.date} gecesi için satış kapalı` (ham ISO tarih), quote.ts:227 `Oda seçilen tarihler için müsait değil`. QuoteBreakdown.tsx:60, :69 ve :106 `f.label`/`x.label` sunucudan geliyor; tax.ts:97 `label: "Hizmet bedeli"`. api-client.ts:40 `İstek başarısız (${res.status})`. AddToCartButton.tsx:65 ve PriceInsight.tsx:80 `err.message` gösteriyor. en/quote.json:4 "tax": "Accommodation tax" anahtarı hiç kullanılmıyor.

**Etki:** EN arayüzü kullanan misafir fiyatın neden alınamadığını ("Bu tarihte en az 2 gece konaklama gerekir") ve döküm satırlarını ("Konaklama vergisi", "KDV", "Hizmet bedeli") anlamıyor. Ekran okuyucu Türkçe metni İngilizce sesle okuyor. TR kullanıcısı da "2026-10-11 gecesi" gibi ham tarih görüyor.

**Önerilen aksiyon:** useQuote'tan gelen `code` ve `details.restriction` değerlerini messages/<locale>/quote.json içindeki `errors.SOLD_OUT`, `errors.MIN_STAY` ({nights}), `errors.STOP_SELL` ({date} f.date ile biçimlenmiş) ve `errors.CAPACITY` ({capacity}) anahtarlarına eşle; sunucu metnini yalnızca bilinmeyen kodda yedek olarak kullan. Vergi ve ücret satırında `code`/`kind` → `quote.taxKind.<KIND>` çevirisini kullan, etiketi yedek tut. api-client'taki varsayılan metni çağıran tarafta `t("common.requestFailed")` ile değiştir.

**Yapılan düzeltme:** The widget maps the useQuote code: SOLD_OUT, RESTRICTED and NOT_FOUND are shown from booking.widget.errors.* in the UI language, and unknown codes fall back to the server text. Capacity is checked in the client (F155). QuoteBreakdown translates fee and tax labels by code (F371). AddToCartButton and PriceInsight now use the shared useErrorText instead of err.message. Restriction parameters (minStay, date) are not passed to the client, and the capacity error needs its own code (backend/useQuote). — dosyalar: `src/components/booking/BookingWidget.tsx`, `src/components/booking/QuoteBreakdown.tsx`, `src/components/cart/AddToCartButton.tsx`, `src/components/booking/PriceInsight.tsx`

## F369 — Rezervasyon hunisinde buton etiketleri işi bitmiş gibi gösteriyor; adım göstergesi yok

| Alan                | Değer                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                             |
| Durum               | Aday                                                                                                             |
| Konum               | `src/components/booking/BookingWidget.tsx:252`                                                                   |
| Diğer konumlar      | `src/app/checkout/page.tsx:235`, `messages/tr/booking.json (widget.submit)`, `messages/tr/checkout.json (title)` |
| Kullanıcılar        | misafir                                                                                                          |
| Prensip             | learnability · predictability                                                                                    |
| Sezgisel madde      | H13 — Feedforward                                                                                                |
| Renk/tema           | Hayır                                                                                                            |
| Efor                | S                                                                                                                |
| Kaynak denetçiler   | lens:status                                                                                                      |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                                                                            |

**Kanıt:** BookingWidget.tsx:252 `{t("widget.submit")}` = 'Rezervasyonu Onayla' (messages/tr/booking.json) → checkout/page.tsx:235 `{submitting ? t("processing") : t("title")}` = 'Rezervasyonu Tamamla' (checkout.json); bu yalnızca HELD (lib/config/app-config.ts:53 BOOKING_HOLD_TTL_MINUTES = 15) oluşturuyor; asıl ödeme booking/[id]'de 'Öde ve onayla' (payment.json payAndConfirm). Hiçbir sayfada 'Adım 2/3' benzeri ilerleme yok.

**Etki:** Misafir 'Rezervasyonu Tamamla' sonrası işin bittiğini sanıp sayfayı kapatabiliyor; 15 dk sonra rezervasyon EXPIRED oluyor (oda kaybı, destek yükü, güven kaybı).

**Önerilen aksiyon:** Etiketler: widget 'Devam et', checkout 'Odayı ayırt ve ödemeye geç'. Checkout ve HELD rezervasyon sayfasının üstüne `<ol aria-label="Rezervasyon adımları">` (1 Seçim · 2 Özet · 3 Ödeme · 4 Onay), geçerli adımda `aria-current="step"`; checkout'ta 'Bir sonraki adımda ödeme yapacaksınız; oda 15 dakika sizin için tutulacak' açıklaması.

**Yapılan düzeltme:** The widget button text is now 'Rezervasyona devam et' / 'Continue to booking'. Under it there is a feedforward hint linked with aria-describedby ('Henüz ödeme alınmaz…'). The step indicator and the checkout button text belong to the checkout and booking page owners. — dosyalar: `src/components/booking/BookingWidget.tsx`

## F370 — Rezervasyon düğmeleri sonucu yanlış vaat ediyor ve adım göstergesi yok ('Onayla' → 'Tamamla' → 'Öde')

| Alan                | Değer                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                            |
| Durum               | Aday                                                                                                                                            |
| Konum               | `src/components/booking/BookingWidget.tsx:252`                                                                                                  |
| Diğer konumlar      | `messages/tr/booking.json:16`, `src/app/checkout/page.tsx:235`, `messages/tr/checkout.json:10`, `src/components/booking/BookingActions.tsx:318` |
| Kullanıcılar        | misafir                                                                                                                                         |
| Prensip             | learnability · predictability (feedforward)                                                                                                     |
| Sezgisel madde      | H13 — Feedforward                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                           |
| Efor                | S                                                                                                                                               |
| Kaynak denetçiler   | lens:copy                                                                                                                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                                                                                                           |

**Kanıt:** BookingWidget.tsx:252 düğme metni booking.json:16 'Rezervasyonu Onayla' ama 126 yalnızca `router.push(`/checkout?...`)` yapar. checkout/page.tsx:235 düğme checkout.json:10 'Rezervasyonu Tamamla' — 104-141 yalnız HELD rezervasyon oluşturup /booking/{id}'e gider. Gerçek ödeme ancak üçüncü ekranda BookingActions.tsx:318 'Öde ve onayla' ile yapılır. Hiçbir ekranda '1/3 Seçim · 2/3 Bilgiler · 3/3 Ödeme' gibi bir ilerleme göstergesi yok; tutma süresi (holdUntil) yalnız 3. ekranda görünür (BookingActions.tsx:268-272). Ekran görüntüsü docs/img/checkout-breakdown.png de başlık ve düğmenin ikisinin de 'Rezervasyonu Tamamla' olduğunu gösteriyor.

**Etki:** Misafir 'Onayla'ya bastığında rezervasyonu yaptığını sanıp sayfayı kapatabilir; 'Tamamla'dan sonra ödeme beklendiğini fark etmeyen kullanıcının odası tutma süresi dolunca düşer (EXPIRED).

**Önerilen aksiyon:** Widget düğmesini 'Devam et' veya 'Rezervasyon bilgilerine geç', checkout düğmesini 'Odayı ayır ve ödemeye geç' yapın; üç ekrana 'Adım 1/3–3/3' ilerleme göstergesi (aria-current='step') ekleyin; checkout'ta 'Bir sonraki adımda kart bilgileriniz istenecek; oda X dakika tutulur' feedforward cümlesi koyun.

**Yapılan düzeltme:** Duplicate of F369. Widget label and feedforward are fixed; the checkout label, the step indicator (aria-current=step) and the hold-time note are crossOwner. — dosyalar: `src/components/booking/BookingWidget.tsx`

## F371 — Fiyat kırılımındaki vergi/ücret etiketleri ve gelir önerisi gerekçeleri veri kaynağında yalnız Türkçe

| Alan                | Değer                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                            |
| Durum               | Aday                                                                                                                                                                                                            |
| Konum               | `src/components/booking/QuoteBreakdown.tsx:60`                                                                                                                                                                  |
| Diğer konumlar      | `data/tax-rules.json:8`, `data/tax-rules.json:16`, `src/lib/pricing/tax.ts:97`, `src/components/host/RevenueDashboard.tsx:194`, `src/lib/pricing/revenue-engine.ts:95`, `src/lib/pricing/revenue-engine.ts:100` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                                              |
| Prensip             | learnability · familiarity (dil/i18n)                                                                                                                                                                           |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                                     |
| WCAG                | 3.1.2                                                                                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                                                                                           |
| Efor                | M                                                                                                                                                                                                               |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                                                                                                                                                                           |

**Kanıt:** QuoteBreakdown.tsx:60 `<dt>{f.label}</dt>`, 69 `{x.label}`, 105 `label: x.label` — etiketler data/tax-rules.json:8 'KDV', 16 ve 23 'Konaklama vergisi' ile tax.ts:97 'Hizmet bedeli' sabitinden gelir; EN arayüzde 'KDV (%10) dahil' çıkar. quote.json'daki 'tax'/'subtotal' çeviri anahtarları hiç kullanılmıyor. RevenueDashboard.tsx:194 `{c.label}` → revenue-engine.ts:95 `Doluluk %${...}`, 100 `Varışa ${leadDays} gün` (yalnız TR).

**Etki:** EN misafir toplam fiyatın neden oluştuğunu (KDV kısaltması dâhil) anlayamaz; para hatası toleransı düşük kullanıcıda güven kaybı. EN ev sahibi fiyat önerisi gerekçesini okuyamaz.

**Önerilen aksiyon:** Vergi/ücret satırlarını `code`/`kind` ile i18n anahtarına eşleyin (quote.taxes.VAT='KDV'/'VAT', ACCOMMODATION_TAX, SERVICE_FEE) ve label'ı yalnız bilinmeyen kodda kullanın; revenue-engine label'larını {factor, params} yapısına çevirip istemcide t('revenue.factorDetail.*', params) ile biçimleyin.

**Yapılan düzeltme:** QuoteBreakdown: the VAT, ACCOMMODATION_TAX and SERVICE_FEE codes go through quote.taxKind.* in fee and tax rows and in the includedTax label, and unknown codes fall back to the server label. The TR texts are the same as before, so e2e 'Konaklama vergisi' is preserved. The RevenueDashboard / revenue-engine part belongs to another owner. — dosyalar: `src/components/booking/QuoteBreakdown.tsx`

## F372 — RNPL ücretsiz iptal ve tahsilat zamanı saat ve saat dilimi olmadan, UTC'ye göre yalnız tarih olarak gösteriliyor

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | High                                                       |
| Durum               | Aday                                                       |
| Konum               | `src/components/booking/RnplOption.tsx:57`                 |
| Diğer konumlar      | `src/lib/i18n/format.ts:63`, `messages/tr/payment.json:43` |
| Kullanıcılar        | misafir                                                    |
| Prensip             | robustness · observability                                 |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                |
| Renk/tema           | Hayır                                                      |
| Efor                | M                                                          |
| Kaynak denetçiler   | area:widget                                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: widget)                      |

**Kanıt:** RnplOption.tsx:57-58 `const due = f.date(offer.dueAt, "long"); const freeUntil = f.date(offer.freeCancellationUntil, "long");`. format.ts:63 `date(value, style = "short", timeZone = "UTC")`. rnpl-terms.ts:36 son tarih `checkInInstant(checkIn, clock) - hours`, yani tesis yerel saatiyle check-in saatine bağlı bir an (ör. 14:00). payment.json:43 metni: "{date} tarihine kadar ücretsiz iptal".

**Etki:** Misafir "23 Nisan 2027 tarihine kadar ücretsiz iptal" görüyor ve günün sonuna kadar süresi olduğunu sanıyor. Gerçek son an 23 Nisan 14:00 (tesis saati); 20:00'de iptal eden kullanıcı ücret ödüyor. UTC'nin batısındaki tesislerde gösterilen tarih bir gün ileri de kayabiliyor.

**Önerilen aksiyon:** Teklif yanıtına `timeZone` (tesis) ekle. `f.dateTime(offer.freeCancellationUntil, tz)` ile tarih ve saati birlikte göster. Mesajı "{date} {time} ({tzName}) saatine kadar ücretsiz iptal" yap; dueAt için de aynısını uygula.

**Yapılan düzeltme:** RnplChoice now shows dueAt and freeCancellationUntil as date + time + short time zone name through the payment.rnpl.moment message, using f.date(…,'long',tz) and f.time(…,tz). tz is the optional offer.timeZone if present, otherwise the viewer's time zone (no longer UTC). The TR stepFreeCancel text was changed to '… saatine kadar'. Having the server return the property's timeZone in the offer is a backend change. — dosyalar: `src/components/booking/RnplOption.tsx`

## F373 — RNPL seçilip geri alınınca cüzdan kredisi kutusu boş görünüyor ama kredi ödemede yine kullanılıyor (gizli durum)

| Alan                | Değer                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                            |
| Durum               | Aday                                                                                            |
| Konum               | `src/components/booking/WalletCreditOption.tsx:39`                                              |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:241`, `src/components/booking/BookingActions.tsx:91` |
| Kullanıcılar        | misafir                                                                                         |
| Prensip             | robustness · observability                                                                      |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                  |
| Renk/tema           | Hayır                                                                                           |
| Efor                | S                                                                                               |
| Kaynak denetçiler   | area:widget                                                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: widget)                                                                  |

**Kanıt:** WalletCreditOption.tsx:39-40 `const [use, setUse] = useState(false); const [amount, setAmount] = useState(0);`: bileşen her mount'ta 'kullanma' durumuyla başlıyor. Mount/unmount'ta `onChange` çağrılmıyor. BookingActions.tsx:241 `{status === "HELD" && !challenge && !rnpl && (<WalletCreditOption ...` RNPL seçilince bileşeni kaldırıyor. :61 `creditMinor` ebeveynde eski değeriyle kalıyor. :91 `rnpl ? {...} : creditMinor > 0 ? { creditMinor } : {}` ödemeye ekliyor.

**Etki:** Senaryo: "Kredimi kullan" (₺500) işaretle → "Şimdi rezerve et, sonra öde" seç (kredi kutusu kaybolur) → "Şimdi öde"ye dön. Kutu işaretsiz görünür ama ödeme isteği ₺500 kredi içerir. Kullanıcı kredisini harcamaya görünür biçimde onay vermeden cüzdanından düşülüyor; ekranda kart tutarı da yanlış anlaşılıyor.

**Önerilen aksiyon:** WalletCreditOption'a `useEffect(() => () => onChange(0), [onChange])` ekle (unmount'ta sıfırla). Daha iyisi `use` ve `amount` durumunu ebeveyne taşıyıp bileşeni kontrollü yap (`value`/`onChange`). BookingActions'ta `rnpl` true olduğunda `setCreditMinor(0)` çağır.

**Yapılan düzeltme:** WalletCreditOption now calls onChange(0) on unmount (an onChange ref plus an effect with empty deps, so changing the callback does not cause a reset). The hidden credit no longer survives after RNPL is selected. Also, the amount field is now type=text with inputMode=decimal and parseAmountToMinor ('1.250,50' is accepted), linked to the hint and error through aria-describedby. aria-invalid is set only when invalid, the extra role=alert was removed, and the hint includes an example format. — dosyalar: `src/components/booking/WalletCreditOption.tsx`

## F452 — RNPL zaman çizelgesi çelişkili: ücretsiz iptal tarihi tahsilattan sonra, 'tahsilattan önce iptal' ifadesi belirsiz; liste biçimleri tutarsız

| Alan                | Değer                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                        |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                                                               |
| Konum               | `src/components/booking/RnplOption.tsx:84`                                                                                                    |
| Diğer konumlar      | `messages/tr/payment.json`, `src/components/booking/RnplPlan.tsx`, `src/components/booking/RnplPlan.tsx:66-75`, `messages/tr/payment.json:40` |
| Kullanıcılar        | misafir                                                                                                                                       |
| Prensip             | learnability · Synthesizability: kullanıcı sistemin ileride ne yapacağını doğru kurabilmeli                                                   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                         |
| Efor                | S                                                                                                                                             |
| Kaynak denetçiler   | runtime:checkout, area:checkout                                                                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                  |

**Kanıt:** RUNTIME p10-rnpl.mjs (masaüstü; o anki çerez nedeniyle EN göründü, TR metinleri payment.json:41-43): seçildiğinde 'Today: TRY 0.00 is charged; your card is only saved.', 'March 17, 2027: TRY 4,276.36 is charged…', 'Free cancellation until March 19, 2027; cancel before the charge and you pay nothing.' gösterildi. Tahsilat 17 Mart, ücretsiz iptal 19 Mart; 17-19 arası iptalde ne olacağı (iade) söylenmiyor. 'Bugün ₺0,00 tahsil edilir' ifadesi doğal değil. Seçenek listesi <ol> ama list-disc (madde imli, RnplOption.tsx:84-85), plan kartında list-decimal (RnplPlan.tsx:66-67). Metinler 12px. Ekran görüntüsü: crops/checkout/p10-rnpl-zoom.png. Olumlu: seçimde düğme 'Reserve now (no payment today)' olarak değişiyor.

**Etki:** Misafir iptal ederse para kaybedip kaybetmeyeceğini net anlayamıyor. RNPL'nin güven vermesi beklenirken belirsizlik yaratıyor.

**Önerilen aksiyon:** Metin şöyle olsun: 'Bugün ödeme yok; kartınız yalnızca kaydedilir.' / '17 Mart: ₺4.276,36 kartınızdan çekilir.' / '19 Mart'a kadar iptal ederseniz: 17 Mart'tan önceyse hiç ödeme alınmaz, sonra ise tamamı iade edilir.' Her iki listede list-decimal kullanılsın ya da zaman çizelgesi tek bileşene alınsın.

## F577 — EN arayüzde Türkçe içerik lang etiketsiz ve çevrilmemiş (açıklama, olanaklar, oda/yatak, plan adları, vergi satırı); 'guest(s)'

| Alan                | Değer                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                     |
| Durum               | Gözlemlendi                                                                                                |
| Konum               | `src/components/booking/BookingWidget.tsx:193`                                                             |
| Diğer konumlar      | `src/app/property/[id]/page.tsx`, `src/components/booking/QuoteBreakdown.tsx`, `messages/en/property.json` |
| Kullanıcılar        | misafir                                                                                                    |
| Prensip             | accessibility · Familiarity / Consistency (Dix)                                                            |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                |
| WCAG                | 3.1.2 Language of Parts                                                                                    |
| Renk/tema           | Hayır                                                                                                      |
| Efor                | M                                                                                                          |
| Kaynak denetçiler   | runtime:pdp                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                               |

**Kanıt:** RUNTIME p7-keyboard-misc.mjs (en, desktop): html lang='en'; açıklama 'Galata Kulesi'nin gölgesinde…' en yakın lang='en'; olanak 'Ücretsiz WiFi'; oda 'Loft - 2 people - Çift Kişilik Yatak'; planlar 'İade edilemez','Standart','Esnek — şimdi rezerve et, sonra öde'; kırılım 'Konaklama vergisi (1%)'; alt başlık 'Lowest price for 1 night, 1 guest(s)' (messages/en/property.json:19). Ekran crops/property/120-0.png, 120-1.png.

**Etki:** Ekran okuyucu Türkçe metni İngilizce telaffuzla okur; yabancı misafir plan ve vergi satırlarını anlayamaz.

**Önerilen aksiyon:** DB kaynaklı metinleri çeviri alanlarıyla (title_en, description_en, ratePlan.name_en) sunun; çeviri yoksa ilgili öğeye lang='tr' verin. Vergi etiketini sunucu kodundan (code) istemcide çevirin; ICU plural kullanın: '{guests, plural, one {# guest} other {# guests}}'.

## F578 — 'Rezervasyonu Onayla' onaylamıyor: oturumsuz kullanıcı ödeme özetine gidiyor, giriş gerektiği ancak son düğmede ortaya çıkıyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Gözlemlendi                                             |
| Konum               | `src/components/booking/BookingWidget.tsx:252`          |
| Diğer konumlar      | `src/app/checkout/page.tsx`, `messages/tr/booking.json` |
| Kullanıcılar        | misafir                                                 |
| Prensip             | learnability · Predictability / Feedforward (Dix)       |
| Sezgisel madde      | H13 — Feedforward                                       |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | runtime:pdp                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** RUNTIME p5-anon-flow.mjs: anon 'Rezervasyonu Onayla' → /checkout?propertyId…&quoteId=… (oturum kontrolü yok); sayfa başlığı ve düğmesi 'Rezervasyonu Tamamla'. Burada düğmeye basınca POST /api/bookings 401 → /login?redirect=%2Fcheckout%3F…quoteId… . Giriş sayfası bağlam vermiyor. (Olumlu: redirect checkout URL'ini koruyor.) Metin: messages/tr/booking.json:16 'Rezervasyonu Onayla'.

**Etki:** 'Onayla' etiketi kesin işlem beklentisi yaratıyor (bazı kullanıcılar tıklamaktan çekinir); oturumsuz kullanıcı iki ekran sonra beklenmedik şekilde girişe atılıyor, teklif süresi dolabiliyor.

**Önerilen aksiyon:** Widget düğmesini 'Devam et — rezervasyonu gözden geçir' gibi adlandırın; oturumsuzken düğme altında 'Bir sonraki adımda giriş yapmanız istenecek' yazın ya da girişi checkout'a girerken (redirect korunarak) isteyin; giriş sayfasında 'Rezervasyonunuzu tamamlamak için giriş yapın' başlığı gösterin.

## F579 — Yazılmış ama 'Uygula'ya basılmamış kupon, rezervasyonda sessizce yok sayılıyor

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | Medium                                                                    |
| Durum               | Gözlemlendi                                                               |
| Konum               | `src/components/booking/CouponField.tsx:31`                               |
| Diğer konumlar      | `src/app/checkout/page.tsx`                                               |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | robustness · Hata önleme: kullanıcının girdiği veri sessizce kaybolmamalı |
| Sezgisel madde      | H5 — Hata önleme                                                          |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | runtime:checkout                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                              |

**Kanıt:** RUNTIME p12-checkout-coupon.mjs (masaüstü, TR; POST yakalandı ve abort edildi, rezervasyon oluşmadı): kupon alanına seed kuponu 'HOSGELDIN' (150 TL) yazıldı, Uygula'ya basılmadan 'Rezervasyonu Tamamla' tıklandı. Giden gövde {propertyId, roomId, checkIn, checkOut, guestCount:2, quoteId}; couponCode yok. Ekranda uyarı yok. Aynı kupon Uygula ile girildiğinde '−₺150,00' satırı çıkıyor (p12-valid-coupon.png). KOD: yazılan değer CouponField içindeki yerel state'te kalıyor (CouponField.tsx:31) ve checkout yalnız uygulanmış kuponu gönderiyor (checkout/page.tsx:117).

**Etki:** İndirim kodunu yazıp doğrudan 'Rezervasyonu Tamamla'ya basan misafir indirimini kaybediyor; burada 150 TL.

**Önerilen aksiyon:** CouponField'ın girdi değeri checkout'a taşınsın (onChange prop). Gönderimde alan dolu ve uygulanandan farklıysa önce kupon uygulansın, ya da gönderim durdurulup alanın altında 'Kuponu uygulamak için Uygula'ya basın veya alanı temizleyin' gösterilsin ve odak kupon alanına taşınsın.

## F580 — Fiyat içgörüsündeki 'gecelik' fiyat teklifle çelişiyor ve aralık anlamsız derecede geniş

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Gözlemlendi                                             |
| Konum               | `src/components/booking/PriceInsight.tsx:100`           |
| Diğer konumlar      | `src/lib/pricing/insight.ts`                            |
| Kullanıcılar        | misafir                                                 |
| Prensip             | robustness · Consistency (Dix) / Gerçek dünya eşleşmesi |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                             |
| Renk/tema           | Hayır                                                   |
| Efor                | M                                                       |
| Kaynak denetçiler   | runtime:pdp                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** RUNTIME: Grand Deluxe varsayılan oda — teklif '₺4.850,00 × 1 gece', içgörü 'gecelik ₺3.650,00' (crops/property/p4-2.png, p4-3.png). Galata 'Terash Loft' — teklif ₺3.500 × 2 gece, içgörü 'gecelik ₺2.800,00' (p2-widget.mjs). Aralık: '(%90 güven): ₺457,82 – ₺3.952,18' (8,6 kat; her yüklemede değişiyor: ₺436,02–₺3.763,98). Sayfa üstü 'Gösterilen fiyatlar vergi … dahil toplamdır' derken içgörü vergisiz taban fiyat (insight.ts:109-110,158 'taban fiyat'); ratePlanId/misafir parametresi gönderilmiyor (PriceInsight.tsx:36).

**Etki:** Karar anında yan yana iki farklı gecelik fiyat; '%90 güven' istatistik jargonu geniş okuryazarlık yelpazesindeki misafir için anlamsız, güveni azaltır.

**Önerilen aksiyon:** İçgörüyü teklifin gecelik tutarıyla (aynı oda+plan+misafir, vergi dahil) hesaplayın veya 'oda taban fiyatı' olduğunu açıkça yazın; aralığı yalnız dar ve kalibre ise gösterin, metni 'Bu tarihler için fiyat olağan seviyede' gibi sade tutun.

## F581 — İngilizce fiyat dökümünde vergi etiketleri Türkçe ('Konaklama vergisi', 'KDV')

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Medium                                              |
| Durum               | Gözlemlendi                                         |
| Konum               | `src/components/booking/QuoteBreakdown.tsx:69`      |
| Diğer konumlar      | `data/tax-rules.json`, `messages/en/quote.json`     |
| Kullanıcılar        | misafir                                             |
| Prensip             | learnability · Consistency: arayüz dili karışmamalı |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                         |
| WCAG                | 3.1.2 Language of Parts (AA)                        |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | runtime:checkout                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** RUNTIME tarama 122/123 (anon EN masaüstü ve mobil) bodyTextSample: 'TRY 2,415.00 × 2 nights', 'Konaklama vergisi (2%) TRY 87.82', 'KDV (10%) included: TRY 439.10'; crops/checkout/123-anon-en-mobile-0.png. KOD: etiketler data/tax-rules.json:8,16'dan geliyor ve doğrudan render ediliyor (QuoteBreakdown.tsx:60,69,106). messages/en/quote.json içindeki 'tax': 'Accommodation tax' anahtarı kullanılmıyor.

**Etki:** Yabancı misafir toplama eklenen kalemi anlayamıyor ve fiyat şeffaflığı zayıflıyor.

**Önerilen aksiyon:** Vergi ve ücret kodu (VAT, ACCOMMODATION_TAX) üzerinden t('tax'), t('vat') gibi çevrilmiş etiketler kullanılsın; bilinmeyen kodlarda data etiketine geri düşülsün.

## F582 — Meşgulken kendini devre dışı bırakan düğmeler odağı body'ye düşürüyor (Sepete ekle, Fiyat alarmı kur)

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Gözlemlendi                                       |
| Konum               | `src/components/cart/AddToCartButton.tsx:77`      |
| Diğer konumlar      | `src/components/booking/PriceInsight.tsx`         |
| Kullanıcılar        | misafir                                           |
| Prensip             | accessibility · Robustness — Responsiveness (Dix) |
| Sezgisel madde      | H14 — Erişilebilirlik                             |
| WCAG                | 2.4.3 Focus Order                                 |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | runtime:pdp                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** RUNTIME p2-widget.mjs: 'Fiyat alarmı kur' tıklandıktan sonra 'focus after alert: body' (PriceInsight.tsx:121 disabled={busy}). p6-guest-cart.mjs: odaklı 'Sepete ekle'ye Enter → 100 ms sonra 'focus: body' (AddToCartButton.tsx:77 disabled={disabled||busy}).

**Etki:** Klavye/ekran okuyucu kullanıcısı işlemden sonra sayfa başına atılır; sonuç mesajını ve 'Sepete git' bağlantısını bulmak için baştan gezinmek zorunda.

**Önerilen aksiyon:** busy sırasında disabled yerine aria-disabled='true' + tıklamayı yok sayma kullanın (odak düğmede kalsın); sonuç geldiğinde gerekirse odağı durum mesajına/‘Sepete git’ bağlantısına taşıyın.

## F1003 — Tarih seçilmeden 'yarın–ertesi gün' varsayılanı atanıyor; fiyat ve CTA kullanıcının seçmediği tarihlerle etkin

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/booking/BookingWidget.tsx:69` |
| Kullanıcılar        | misafir                                       |
| Prensip             | learnability · predictability                 |
| Sezgisel madde      | H5 — Hata önleme                              |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:widget                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** BookingWidget.tsx:69-70 `useState(validStay ? initial!.checkIn! : addDaysISO(1))` ve `addDaysISO(2)`. :131'deki `t("widget.selectDates")` boş durumu ilk yüklemede hiç görünmüyor. useQuote.ts:136 anahtar yoksa zaten boşta (`loading:false`) dönebiliyor.

**Etki:** Ana sayfadan veya doğrudan bağlantıyla gelen misafir, hiç seçmediği yarınki 1 gece için hazır bir toplam ve etkin "Rezervasyonu Onayla" görüyor. Okuryazarlığı düşük kullanıcı tarihleri fark etmeden ilerleyebiliyor.

**Önerilen aksiyon:** `validStay` false ise checkIn ve checkOut'u "" ile başlat. Fiyat alanında "Fiyatı görmek için tarih seçin" yönergesini ve tarih düğmesini öne çıkar. Varsayılan korunacaksa özet yanında görünür bir "Örnek tarihler, değiştirin" etiketi göster.

## F1004 — Aramada seçilen oda müsait değilse başka oda sessizce seçiliyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/booking/BookingWidget.tsx:80` |
| Kullanıcılar        | misafir                                       |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:widget                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** BookingWidget.tsx:74-76 `rooms.find((r) => r.id === initial?.roomId)?.id ?? rooms[0]?.id` ve :80-81 `availableRooms.find((room) => room.id === selectedRoomId) ?? availableRooms[0]`. Arama kartındaki oda (initial.roomId) `available=false` ise ilk müsait oda kullanılıyor; bunu bildiren bir mesaj yok. BookingWidget.tsx:40 yorumu: "kartta gösterilen toplamla aynı teklif için".

**Etki:** Arama kartında belirli bir oda ve toplam gören misafir, ilan sayfasında farklı bir odanın farklı toplamını görüyor ve nedenini bilmiyor. Kart ile PDP toplamı arasındaki tutarlılık bozuluyor ve güven azalıyor.

**Önerilen aksiyon:** `initial.roomId` varsa ama `availableRooms` içinde yoksa oda select'inin altına `<p role="status">{t("widget.roomReplaced", { name })}</p>` göster: "Seçtiğiniz oda artık müsait değil; {name} gösteriliyor".

## F1005 — İlan formundaki seçimler URL'ye yazılmıyor; checkout'ta 'değiştir' yolu yok, tarihler ham ISO biçiminde

| Alan                | Değer                                                           |
| ------------------- | --------------------------------------------------------------- |
| Severity            | Medium                                                          |
| Durum               | Aday                                                            |
| Konum               | `src/components/booking/BookingWidget.tsx:106`                  |
| Diğer konumlar      | `src/app/checkout/page.tsx:196`, `src/app/checkout/page.tsx:51` |
| Kullanıcılar        | misafir                                                         |
| Prensip             | robustness · recoverability                                     |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                               |
| Renk/tema           | Hayır                                                           |
| Efor                | S                                                               |
| Kaynak denetçiler   | lens:nav                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                    |

**Kanıt:** handleDateChange (106-110) ve kişi seçimi (169) yalnız setState çağırıyor. checkout/page.tsx:165-237'de ilana dönüş bağlantısı yok. 196 `{checkIn} → {checkOut}` ham ISO gösteriyor (ekran görüntüsünde "2026-10-29 → 2026-11-01"); sepet ise biçimli tarih kullanıyor (cart/page.tsx:129 `f.date(…, "medium")`). Parametre adları da tutarsız: ilanda `guests`, checkout'ta `guestCount` (51).

**Etki:** Misafir ilanda tarihleri değiştirip checkout'a geçiyor, bir hata fark edip Geri'ye basınca form eski URL parametreleriyle yeniden kuruluyor ve önceki tarihler görünüyor. Tüm seçimler yeniden yapılıyor. Ham ISO tarihi doğrulamak düşük okuryazarlıktaki kullanıcı için zor.

**Önerilen aksiyon:** BookingWidget seçim değiştikçe `router.replace` ile checkIn/checkOut/guests/roomId/ratePlanId değerlerini URL'ye yazsın (`scroll: false`). Checkout'a "Tarihleri / odayı değiştir" bağlantısı ekleyin: `/property/${propertyId}?checkIn=…&checkOut=…&guests=${guestCount}&roomId=…&ratePlanId=…`. Tarihleri `f.date(…, "medium")` ile biçimleyip gece sayısını yanına yazın. Parametre adını tek bir değerde (`guests`) birleştirin.

## F1006 — Yalnız giriş tarihi seçiliyken özet 'Tarih seçin'e dönüyor; çıkış için yönlendirme yok; fiyat alanı sessizce boşalıyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/BookingWidget.tsx:131` |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:63`       |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · observability                     |
| Sezgisel madde      | H13 — Feedforward                              |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** BookingWidget.tsx:129-132 `return checkIn && checkOut ? ... : t("widget.selectDates");`. DateRangePicker.tsx:114 ilk tıklamada `checkOut: ""` gönderiyor. SearchBar.tsx:63 aynı durumda `t("bar.checkInOnly", { date })` → "{date} - çıkış?" gösteriyor. Widget'ta bu yok. Takvim içinde "çıkış tarihini seçin" yönergesi de yok.

**Etki:** Giriş gününü seçen misafir özetin "Tarih seçin"e döndüğünü görüyor ve seçiminin kaybolduğunu sanıyor. Pencereyi kapatırsa fiyat, PriceInsight ve CTA açıklamasız kayboluyor. Arama çubuğuyla davranış tutarsız.

**Önerilen aksiyon:** booking.json'a `widget.checkInOnly` ("{date} - çıkış tarihini seçin") ekle ve checkOut boşken özet bunu göstersin. Takvim penceresinin üstüne `<p role="status">` koy: giriş seçilmemişse "Giriş tarihini seçin", seçilmişse "Çıkış tarihini seçin". Pencere eksik seçimle kapanırsa fiyat alanında aynı yönerge görünsün.

## F1007 — Fiyat planları karşılaştırılamıyor: fiyat farkı yok, 'İptal politikasına göre iade' belirsiz, yarım/tam pansiyon gösterilmiyor, ad ile alt metin tekrar ediyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/components/booking/BookingWidget.tsx:222`               |
| Diğer konumlar      | `messages/tr/booking.json:12`, `messages/en/booking.json:12` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · predictability                                |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                      |
| Renk/tema           | Hayır                                                        |
| Efor                | M                                                            |
| Kaynak denetçiler   | area:widget                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** BookingWidget.tsx:219-224 `{plan.name}<span ...>{plan.refundable ? t("widget.refundable") : t("widget.nonRefundable")}{plan.mealPlan === "BREAKFAST" ? ... : ""}`. `priceModifierBps` (:19) gösterilmiyor. schema.prisma:257-262 `ROOM_ONLY | BREAKFAST | HALF_BOARD | FULL_BOARD` var ama yalnız BREAKFAST işleniyor. tr/booking.json:12 "İptal politikasına göre iade". docs/img/property.png'de "İade edilemez / İade edilemez" tekrar ediyor; "Standart" ile "Esnek" aynı alt metni taşıyor.

**Etki:** Misafir planlar arasındaki fiyat ve koşul farkını görmek için her planı tek tek seçip toplamı hatırlamak zorunda kalıyor. Yarım veya tam pansiyon dahil olduğu halde bunu bilmiyor. "Standart" ile "Esnek"in farkını anlayamıyor.

**Önerilen aksiyon:** Her plana göreli fiyat farkını ekle: `priceModifierBps` ≠ 0 ise "+%10" veya "−%15" (ya da sunucudan plan başına toplam). mealPlan'in dört değerini de i18n anahtarlarına eşle (widget.meal.ROOM_ONLY "Yalnız oda", HALF_BOARD "Yarım pansiyon", FULL_BOARD "Tam pansiyon"). "İptal politikasına göre iade" yerine "{date} tarihine kadar ücretsiz iptal" yaz. Plan adı alt metinle aynıysa alt metni gizle.

## F1008 — Fiyat alanının aria-live bölgesi tüm dökümü sarıyor; her değişiklikte uzun duyuru yapılıyor

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | Medium                                                              |
| Durum               | Aday                                                                |
| Konum               | `src/components/booking/BookingWidget.tsx:232`                      |
| Diğer konumlar      | `src/app/checkout/page.tsx:208`                                     |
| Kullanıcılar        | misafir                                                             |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages (aşırı ayrıntılı duyuru) |
| Sezgisel madde      | H12 — Feedback                                                      |
| Renk/tema           | Hayır                                                               |
| Efor                | S                                                                   |
| Kaynak denetçiler   | area:widget                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                        |

**Kanıt:** BookingWidget.tsx:232-236 `<div ... aria-live="polite">` içinde yükleniyor metni, hata ve tüm `<QuoteBreakdown>` (dl satırları, vergi notları, FX notu) var. checkout/page.tsx:206-209'da `<section ... aria-live="polite">` başlık, döküm ve CouponField'ın tamamını sarıyor.

**Etki:** Ekran okuyucu kullanıcısı misafir sayısını, odayı veya planı her değiştirdiğinde önce "Fiyat hesaplanıyor…", ardından 5-8 satırlık dökümün tamamını dinliyor. Asıl bilgi olan yeni toplam kayboluyor ve odak gezinmesi kesiliyor.

**Önerilen aksiyon:** Kapsayıcıdaki `aria-live`'ı kaldır. Ayrı bir `<p className="sr-only" role="status">` ekle; yalnız kısa metin duyursun: yükleniyorsa `t("widget.calculating")`, hata varsa hata, teklif gelince `t("widget.totalAnnounce", { total })` ("Yeni toplam: ₺6.357,27"). Checkout'taki section için de aynısını uygula; kupon durumu kendi `role="status"`'una sahip olsun.

## F1009 — Fiyat alınamadığında 'Tekrar dene' yok; dolu veya kısıt hatasında alternatif eylem önerilmiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/BookingWidget.tsx:234` |
| Diğer konumlar      | `src/components/booking/useQuote.ts:108`       |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · recoverability                    |
| Sezgisel madde      | H9 — Hata mesajları                            |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** BookingWidget.tsx:234 yalnız `<p className="text-sm text-red-600">{error}</p>`. useQuote.ts:72-73 `refreshKey` destekliyor ama widget useQuote'u :87-94'te `refreshKey` olmadan çağırıyor. useQuote.ts:108 fetch'te zaman aşımı yok; yavaş ağda "Fiyat hesaplanıyor…" süresiz kalıyor.

**Etki:** Anlık bir ağ kesintisinde misafir "Fiyat alınamadı" ve pasif CTA ile kalıyor. Yeniden denemek için misafir sayısını değiştirip geri almak gibi bir hile bulmak zorunda. Dolu tarihte başka tarih veya oda önerisi yok.

**Önerilen aksiyon:** `const [refreshKey, setRefreshKey] = useState(0)` ekle, useQuote'a geçir ve hata metninin yanına `<button type="button" onClick={() => setRefreshKey(k => k + 1)}>{t("widget.retry")}</button>` koy. `code === "SOLD_OUT"` veya `"RESTRICTED"` ise "Başka tarih seç" düğmesi takvimi açsın. fetch'e `AbortSignal.timeout(10000)` ekle ve zaman aşımı hata metnine düşsün.

## F1010 — Pasif CTA'ların nedeni açıklanmıyor; pasif düğmeler odaklanamıyor; 'Uygun oda yok' boş durumu yönlendirmesiz

| Alan                | Değer                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                       |
| Durum               | Aday                                                                                         |
| Konum               | `src/components/booking/BookingWidget.tsx:249`                                               |
| Diğer konumlar      | `src/components/cart/AddToCartButton.tsx:77`, `src/components/booking/BookingWidget.tsx:190` |
| Kullanıcılar        | misafir                                                                                      |
| Prensip             | robustness · observability                                                                   |
| Sezgisel madde      | H13 — Feedforward                                                                            |
| Renk/tema           | Hayır                                                                                        |
| Efor                | S                                                                                            |
| Kaynak denetçiler   | area:widget                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                 |

**Kanıt:** BookingWidget.tsx:249 `disabled={!selectedRoom || !quote}` ve :261 `disabled={!quote}`. AddToCartButton.tsx:77 `disabled={disabled || busy || !roomTypeId}`. Nedeni anlatan bir metin veya `aria-describedby` yok. :190 `{availableRooms.length === 0 && <option value="">{t("widget.noRooms")}</option>}` dışında boş durum mesajı yok.

**Etki:** Tarih eksikken, teklif başarısızken veya oda yokken misafir iki gri düğme görüyor ve nedenini bilmiyor. Ekran okuyucu kullanıcısı `disabled` düğmeleri Tab ile hiç bulamıyor; ana CTA'nın varlığından habersiz kalıyor.

**Önerilen aksiyon:** `disabled` yerine `aria-disabled={!canSubmit}` kullan ve handleSubmit'te koruma ekle. Düğmenin altına `id="submit-reason"` olan bir neden metni koy ("Fiyatı görmek için tarih seçin" / "Bu tarihlerde müsait oda yok") ve `aria-describedby="submit-reason"` ile bağla. Oda yoksa select yerine "Bu tesiste müsait oda yok" mesajı ve aramaya dönüş bağlantısı göster.

## F1011 — 'Rezervasyonu Onayla' düğmesi rezervasyonu onaylamıyor, yalnız checkout'a geçiyor; 'henüz ücret alınmaz' bilgisi yok

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/components/booking/BookingWidget.tsx:252`               |
| Diğer konumlar      | `messages/tr/booking.json:16`, `messages/en/booking.json:16` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · familiarity                                   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                  |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | area:widget                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** BookingWidget.tsx:252 `{t("widget.submit")}` = tr "Rezervasyonu Onayla" / en "Confirm booking". :126 `router.push(`/checkout?${params}`)`. Sonraki adımların etiketleri: checkout.json "title": "Rezervasyonu Tamamla", ardından payment.json "payAndConfirm": "Öde ve onayla". Aynı akışta üç adım üç ayrı "onay/tamamla" etiketi kullanıyor.

**Etki:** Okuryazarlığı düşük misafir ilk düğmeye bastığında rezervasyonun onaylandığını veya ücretin çekildiğini sanıyor. Kaygı, geri dönme ya da akışı terk etme sonucu doğuyor. Sonraki "Tamamla" ve "Öde ve onayla" düğmeleri de beklentiyi karıştırıyor.

**Önerilen aksiyon:** widget.submit'i "Rezervasyona devam et" / "Continue to book" olarak değiştir. Düğmenin altına `t("widget.noChargeYet")` ekle: "Sonraki adımda bilgilerinizi kontrol edeceksiniz; henüz ücret alınmaz." Checkout'ta "1/2 Bilgileri kontrol et" türü bir adım göstergesi kullan.

## F1012 — Yazılıp uygulanmamış kupon kodu, rezervasyon gönderilince sessizce yok sayılıyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/booking/CouponField.tsx:31` |
| Diğer konumlar      | `src/app/checkout/page.tsx:117`             |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · task conformance               |
| Sezgisel madde      | H5 — Hata önleme                            |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:widget                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** CouponField.tsx:31-32 `const [value, setValue] = useState(applied); const apply = () => onApply(value.trim());`: girilen metin yalnız bileşen içinde kalıyor. checkout/page.tsx:117 yalnız teklifte uygulanmış kuponu gönderiyor. :230-236 gönder düğmesi, uygulanmamış bir kod alanda dururken bunu kontrol etmiyor.

**Etki:** Misafir kodu yazıp doğrudan "Rezervasyonu Tamamla"ya basıyor; rezervasyon indirimsiz tam fiyatla oluşuyor ve uyarı gelmiyor. Bu doğrudan para kaybı.

**Önerilen aksiyon:** CouponField'a `onDirtyChange?: (dirty: boolean) => void` ekle (`value.trim().toUpperCase() !== applied.toUpperCase()`). Checkout handleSubmit, alan kirliyse gönderimi durdursun, alan altında "Kupon kodunu uygulamadınız: Uygula'ya basın ya da alanı temizleyin" göstersin ve alana odaklansın. Ya da kod `onBlur`'da otomatik uygulansın.

## F1013 — Kupon uygulanırken meşgul geri bildirimi yok; alan metni ile uygulanan kod ayrışabiliyor; hatada aria-invalid yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/booking/CouponField.tsx:56` |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · responsiveness                 |
| Sezgisel madde      | H12 — Feedback                              |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:widget                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** CouponField.tsx:56-62 "Uygula" düğmesinin meşgul veya pasif durumu yok. :76-84 durum yalnız `applied && status` iken çiziliyor; teklif yeniden alınırken (quote=null) kayboluyor. Kullanıcı uygulanan kodu düzenlerse alan "KIS20" gösterirken durum "Kupon uygulandı." diyor. :40-55 input'ta `aria-invalid` yok; durum `<p>`'si (:77) kendi `role="status"`'una sahip değil ve ebeveynin aria-live'ına bağımlı.

**Etki:** Misafir "Uygula"ya basınca bir şey olup olmadığını anlamıyor ve tekrar basıyor. Hangi kodun geçerli olduğu belirsizleşiyor. Ekran okuyucu geçersiz kodu alanda hata olarak duymuyor.

**Önerilen aksiyon:** CouponField'a `loading` prop'u geçir: düğme metni "Uygulanıyor…", `aria-busy` ve pasif. Durum metnini kodla birlikte yaz ("„{code}" kuponu uygulandı"). `aria-invalid={!!applied && !!status && status !== "APPLIED"}` ekle. Durum `<p>`'sine `role="status"` ver ve sürekli DOM'da tut.

## F1014 — Fiyat içgörüsü asenkron yüklenip toplam ile CTA arasına giriyor; her tarih değişiminde kaybolup yeniden çıkıyor (yerleşim kayması)

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/PriceInsight.tsx:54`   |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:238` |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · responsiveness                    |
| Sezgisel madde      | H15 — Performans                               |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** PriceInsight.tsx:54-55 `const data = insight?.key === key ? insight.data : null; if (!data) return null;`: anahtar değişince eski veri hemen atılıyor, yükleme sırasında yer ayrılmıyor. BookingWidget.tsx:238-245 bileşeni QuoteBreakdown ile ana CTA arasına koyuyor; docs/img/price-insight.png'de ~140px'lik kutu bu konumda görünüyor.

**Etki:** Mobilde "Rezervasyonu Onayla"ya basmak üzere olan misafirin altında içerik ~140px aşağı kayıyor; dokunuş "Fiyat alarmı kur"a ya da boşluğa gidiyor. Fiyattan CTA'ya giden tarama yolu ikincil bilgiyle bölünüyor.

**Önerilen aksiyon:** PriceInsight'ı AddToCartButton'ın altına taşı. Yüklenirken `min-h-[7rem]` bir yer tutucu çiz. Anahtar değiştiğinde yeni veri gelene kadar önceki veriyi `aria-busy="true"` ile göstermeye devam et.

## F1015 — Oturum yokken 'Fiyat alarmı kur' yalnız metin gösteriyor, giriş bağlantısı yok; yandaki 'Sepete ekle' ise girişe yönlendiriyor (tutarsızlık)

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Aday                                         |
| Konum               | `src/components/booking/PriceInsight.tsx:77` |
| Diğer konumlar      | `src/components/cart/AddToCartButton.tsx:57` |
| Kullanıcılar        | misafir                                      |
| Prensip             | learnability · consistency                   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                  |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:widget                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** PriceInsight.tsx:77-78 `err instanceof ApiError && err.status === 401 ? t("alertLoginRequired")` ile yalnız "Fiyat alarmı kurmak için giriş yapın." metni çıkıyor. AddToCartButton.tsx:57-61 aynı 401'de `router.push(`/login?redirect=...`)` yapıyor. Aynı form içinde aynı duruma iki farklı tepki veriliyor.

**Etki:** Oturumsuz misafir mesajı görüyor ama girişe nasıl gideceğini bilmiyor; giriş yaptıktan sonra da sayfaya dönüp tekrar denemesi gerekiyor. Diğer düğme ise uyarı vermeden sayfadan çıkarıyor; hangi düğmenin ne yapacağı öngörülemiyor.

**Önerilen aksiyon:** alertLoginRequired'ı `t.rich` ile `<Link href={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}>` içeren bir metne çevir (ui.tsx:219 desenindeki gibi). Sepete ekle için de önce aynı satır içi mesaj ve bağlantı gösterilsin (aşağıdaki bulguya bakın).

## F1016 — Fiyat alarmının ne yapacağı önceden söylenmiyor; kurulan alarm arayüzden görülemiyor veya iptal edilemiyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/booking/PriceInsight.tsx:118` |
| Kullanıcılar        | misafir                                       |
| Prensip             | robustness · recoverability                   |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü             |
| Renk/tema           | Hayır                                         |
| Efor                | M                                             |
| Kaynak denetçiler   | area:widget                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** PriceInsight.tsx:118-125 düğme yalnız `{t("setAlert")}` ("Fiyat alarmı kur") diyor; kanal (e-posta, price-alerts.ts:207 `to: alert.user.email`) ve eşik belirtilmiyor. :121 `disabled={busy}`; meşgul durumunda metin değişmiyor, yalnız opaklık düşüyor. :70 başarı metni "Fiyat alarmı kuruldu." ama yönetim bağlantısı yok. API'de GET ve DELETE var (price-alerts/route.ts:16, :37), fakat src/app altında bunları kullanan bir sayfa yok (grep).

**Etki:** Misafir alarmın nereye ve ne zaman bildirim göndereceğini bilmeden kuruyor; geri almak veya listelemek için bir yol yok. Kullanıcı kontrolü ve geri alma eksik.

**Önerilen aksiyon:** Düğmeye `aria-describedby` ile bağlı bir ipucu ekle: "Fiyat düşerse {email} adresine e-posta göndeririz." Meşgulken metni "Kuruluyor…" yap. Başarı mesajına "Geri al" (DELETE ?id=) düğmesi ve hesap altındaki alarm listesine bağlantı ekle; liste sayfası yoksa oluştur.

## F1017 — Yüzde ve ondalık sayılar yerel biçim yardımcısını atlıyor; TR'de '%12.5' ile '%12,5' bir arada

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                       |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                                                         |
| Konum               | `src/components/booking/QuoteBreakdown.tsx:20`                                                                                                                                                                                                                                                                                                                               |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx:75`, `src/components/admin/AdminDashboard.tsx:443`, `src/components/host/RevenueDashboard.tsx:195`, `src/components/host/RevenueDashboard.tsx:264`, `src/components/admin/SupportAdmin.tsx:93`, `src/components/search/RankingWhy.tsx:27-34`, `src/components/account/WalletPanel.tsx:69`, `src/components/host/PayoutPanel.tsx:73` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                                                                                                                                                                                                                    |
| Prensip             | learnability · consistency                                                                                                                                                                                                                                                                                                                                                   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                        |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                            |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                                                                                                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                 |

**Kanıt:** QuoteBreakdown.tsx:19-20 `t("rate", { rate: String(bps / 100) })`, misafirin checkout vergi satırı. PromotionsPanel.tsx:75 `String(p.discountBps / 100)`. AdminDashboard.tsx:443 `(v * 100).toFixed(1)`. RevenueDashboard.tsx:195 `×{c.multiplier.toFixed(2)}` ve :264 `(k.occupancy * 100).toFixed(1)`. SupportAdmin.tsx:93 `row.confidence.toFixed(2)`. RankingWhy.tsx:27 ve :34 `toFixed(3)`. Doğru kullanım örnekleri: WalletPanel.tsx:69 ve PayoutPanel.tsx:73 `f.number(bps / 100, { maximumFractionDigits: 2 })`, PriceInsight `f.number(level, { style: "percent" })`.

**Etki:** Aynı arayüzde cashback oranı "%1,5", vergi oranı "%1.5" görünür. Para ekranlarında ayırıcı karmaşası, kullanıcının tutar okumasına duyduğu güveni azaltır. Doluluk ve deney oranları da ev sahibi ile admin panelinde farklı biçimde yazılır.

**Önerilen aksiyon:** Formatter'a `percent(bps)` ve `decimal(value, digits)` metotları ekleyin (Intl.NumberFormat ile). Bu yedi çağrı yerinde toFixed ve String yerine bunları kullanın. ICU iletisine sayı yerine önceden biçimlenmiş metin geçirme kuralını kod incelemesi kontrol listesine ekleyin.

## F1018 — Değişken gece fiyatlarında gecelik döküm görülemiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/QuoteBreakdown.tsx:40` |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · observability                     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                 |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** QuoteBreakdown.tsx:37-41 `uniform ? t("nightsUniform", ...) : t("nightsVariable", { count: n })` → "3 gece (gecelik fiyatlar değişken)". `quote.nights` (useQuote.ts:15 `Array<{ date; amount }>`) eldeyken gecelere göre tutarlar gösterilmiyor.

**Etki:** Hafta sonu veya sezon fiyatı farklı olan konaklamada misafir ara toplamın nasıl oluştuğunu doğrulayamıyor. Para hatasına toleransı düşük kullanıcıda güveni azaltıyor ve tarih kaydırarak karşılaştırmayı zorlaştırıyor.

**Önerilen aksiyon:** Değişken durumda `<details><summary>{t("nightsShow")}</summary><ul>{quote.nights.map(n => <li key={n.date}>{f.date(n.date, "medium")}: {fmt(n.amount, quote.currency)}</li>)}</ul></details>` ekle; dl dışında, döküm notlarının yanında dursun.

## F1019 — RNPL zaman çizelgesi tahsilat ile ücretsiz iptal son tarihi arasındaki pencereyi açıklamıyor; '₺0,00 tahsil edilir' ifadesi doğal değil

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/components/booking/RnplOption.tsx:84`                   |
| Diğer konumlar      | `messages/tr/payment.json:41`, `messages/en/payment.json:43` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · synthesizability                              |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                  |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | area:widget                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** RnplOption.tsx:89-92 adımlar `stepToday`, `stepCharge`, `stepFreeCancel`, `stepFailure`. tr/payment.json:41 "Bugün: {today} tahsil edilir; kartınız yalnızca kaydedilir." (today = ₺0,00, :56). :43 "{date} tarihine kadar ücretsiz iptal; tahsilattan önce iptal ederseniz hiç ödeme alınmaz." docs/img/v5-rnpl-checkout.png: tahsilat 21 Nisan, ücretsiz iptal 23 Nisan. :84-85 `<ol className="... list-disc">` sıralı listeyi madde imiyle gösteriyor.

**Etki:** Misafir 22 Nisan'da (tahsilattan sonra, son tarihten önce) iptal ederse ne olacağını bilemiyor; paranın iade edilip edilmeyeceği yazmıyor. "₺0,00 tahsil edilir" ifadesi kafa karıştırıyor.

**Önerilen aksiyon:** stepFreeCancel'i şöyle yaz: "{date} {time}'e kadar ücretsiz iptal: tahsilattan önce iptal ederseniz ödeme alınmaz, tahsilattan sonra iptal ederseniz tutarın tamamı iade edilir." stepToday'i "Bugün ödeme alınmaz; kartınız yalnızca kaydedilir." yap. Listeyi `list-decimal` ile numaralandır.

## F1020 — 'Şimdi rezerve et, sonra öde' metinleri çelişkili ve eksik; kredi seçeneği sessizce kayboluyor

| Alan                | Değer                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                     |
| Konum               | `src/components/booking/RnplOption.tsx:89`                                                                                                               |
| Diğer konumlar      | `messages/tr/payment.json:41`, `messages/tr/payment.json:44`, `src/components/booking/BookingActions.tsx:241`, `src/components/booking/RnplPlan.tsx:152` |
| Kullanıcılar        | misafir                                                                                                                                                  |
| Prensip             | learnability · predictability                                                                                                                            |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                    |
| Efor                | S                                                                                                                                                        |
| Kaynak denetçiler   | lens:copy                                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                             |

**Kanıt:** RnplOption.tsx:56 `const today = f.money(0, ...)`; 89 `t("stepToday", { today })` → payment.json:41 'Bugün: ₺0,00 tahsil edilir; kartınız yalnızca kaydedilir.'; payment.json:44 '...ek süre içinde ödenmezse rezervasyon otomatik iptal edilir' — ek süre uzunluğu yok. BookingActions.tsx:241 `status === "HELD" && !challenge && !rnpl &&` WalletCreditOption'ı RNPL seçilince açıklamasız gizler.

**Etki:** Misafir '₺0 tahsil edilir' ile ne olacağını anlamaz; tahsilat başarısızlığında ne kadar süresi olduğunu bilmeden rezervasyonunu kaybedebilir; kredi seçimi neden kaybolduğunu anlamaz.

**Önerilen aksiyon:** stepToday'i 'Bugün kartınızdan ödeme alınmaz; kart yalnızca kaydedilir.' yapın; stepFailure'a süreyi parametre olarak verin ('{days} gün içinde'); RNPL seçilince kredi kutusunun yerine 'Cüzdan kredisi bu seçenekle birlikte kullanılamaz' notu gösterin.

## F1021 — Kredi ve 'sonra öde' seçenekleri ödeme formunun üstüne gecikmeli ekleniyor; RNPL seçilince kredi açıklamasız kayboluyor

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                      |
| Durum               | Aday                                                                                        |
| Konum               | `src/components/booking/WalletCreditOption.tsx:56`                                          |
| Diğer konumlar      | `src/components/booking/RnplOption.tsx:33`, `src/components/booking/BookingActions.tsx:241` |
| Kullanıcılar        | misafir                                                                                     |
| Prensip             | robustness · observability                                                                  |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                              |
| Renk/tema           | Hayır                                                                                       |
| Efor                | M                                                                                           |
| Kaynak denetçiler   | area:widget                                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                |

**Kanıt:** WalletCreditOption.tsx:56 `if (!opts || opts.maxUsableMinor <= 0) return null;` ve RnplOption.tsx:30-41 `offer` null iken hiçbir şey çizilmiyor; yükleme sırasında yer ayrılmıyor. BookingActions.tsx:238-249 ikisi de kart formunun üstünde. :241 `!rnpl &&` RNPL seçilince kredi kutusunu kaldırıyor; sebebi yalnız kod yorumunda yazıyor (:62 "kredi ile birlikte kullanılamaz").

**Etki:** Kart numarasını yazmaya başlamış misafirin altındaki form iki ayrı istek dönünce aşağı kayıyor; dokunuşlar yanlış alana gidiyor. "Sonra öde"yi seçince kredi seçeneği kayboluyor ve kullanıcı kredisinin nereye gittiğini bilmiyor.

**Önerilen aksiyon:** Her iki bileşen yüklenirken `min-h` iskelet çizsin ya da kart formunun altına taşınsın. RNPL seçiliyken WalletCreditOption'ı kaldırmak yerine `disabled` fieldset olarak göster ve altına "'Sonra öde' seçeneğinde cüzdan kredisi kullanılamaz" notunu ekle.

## F1022 — Geçersiz kredi tutarında ödeme engellenmiyor; kredi sessizce 0'a düşüyor ve tüm tutar karttan çekiliyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Medium                                             |
| Durum               | Aday                                               |
| Konum               | `src/components/booking/WalletCreditOption.tsx:64` |
| Diğer konumlar      | `src/components/booking/BookingActions.tsx:314`    |
| Kullanıcılar        | misafir                                            |
| Prensip             | robustness · observability                         |
| Sezgisel madde      | H5 — Hata önleme                                   |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | area:widget                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** WalletCreditOption.tsx:63-64 `const ok = ...; onChange(nextUse && ok ? nextAmount : 0);`: geçersiz tutarda ebeveyne 0 gidiyor. :101-105 hata gösteriliyor, ama BookingActions.tsx:314-319 "Öde ve onayla" yalnız `disabled={busy}` ile korunuyor ve tutar göstermiyor.

**Etki:** Krediyi kullanmak isteyen misafir sınırı aşan bir tutar yazıyor (ör. ₺600, en fazla ₺500) ve hata satırını kaçırıp öde'ye basıyor. Kredisiz, tam tutar karttan çekiliyor; ekranda ise kredi kutusu işaretli duruyor.

**Önerilen aksiyon:** WalletCreditOption'a `onValidityChange(valid)` ekle. Geçersizken BookingActions gönderimi engellesin ve tutar alanına odaklansın. Ya da `onBlur`'da tutarı `maxUsableMinor`'a kırp ve "En fazla {max} kullanılabilir, tutar düzeltildi" diye bildir. Öde düğmesinde karttan çekilecek tutarı göster: "₺X öde ve onayla".

## F1023 — Para girişlerinde iki farklı desen: type=number ve virgül kabul eden metin alanı

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                           |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                                                                                             |
| Konum               | `src/components/booking/WalletCreditOption.tsx:87`                                                                                                                                                                                                                                                                                                                                                               |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:252`, `src/components/host/HostDashboard.tsx:401`, `src/components/host/HostDashboard.tsx:501`, `src/app/search/page.tsx:334`, `src/components/host/DepositSettings.tsx:140`, `src/components/resolution/OpenClaimForm.tsx:71`, `src/components/admin/ClaimAdmin.tsx:210`, `src/components/transfers/TransferMarket.tsx:174`, `src/components/cart/SplitPayPanel.tsx:218` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                                                                                                                                                                                                                                               |
| Prensip             | learnability · consistency                                                                                                                                                                                                                                                                                                                                                                                       |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                                                                                                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                            |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                |
| Kaynak denetçiler   | lens:mobile                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                                                     |

**Kanıt:** Desen A (type=number): WalletCreditOption.tsx:87-93 `type="number" inputMode="decimal" … onChange={(e) => update(true, Math.round(Number(e.target.value) * 100))}`; HostDashboard.tsx:252 taban fiyat, :401 fiyat farkı, :501 takvim fiyatı; search/page.tsx:334/346 fiyat filtresi. Desen B (virgül kabul eden metin): DepositSettings.tsx:140 `inputMode="decimal" pattern="\d+([.,]\d{1,3})?"`, OpenClaimForm.tsx:71, ClaimAdmin.tsx:210, TransferMarket.tsx:174 (ve :122 `ask.replace(",", ".")`), SplitPayPanel.tsx:218. Kod tabanı TR kullanıcısının virgül yazdığını bildiği hâlde (TransferMarket), Desen A'da tarayıcı virgüllü değeri geçersiz sayarsa `value` boş dönüyor ve `Number("")=0` oluyor.

**Etki:** TR klavyesinde ondalık tuşu ',' olan mobil kullanıcı cüzdan kredisine '12,50' yazdığında tutar sessizce 0'a düşebilir. Ev sahibinin fiyat alanları ekrana göre farklı davranıyor. Para hatasına toleransı düşük kullanıcı için öngörülemez.

**Önerilen aksiyon:** Tek bir `<MoneyInput>` bileşeni yaz: `type="text" inputMode="decimal"`, virgül ve noktayı kabul eden `parseMoney` ile ayrıştırma, geçersiz girişte değeri sıfıra çevirmeden alanın altında hata. Desen A'daki tüm para alanlarını buna geçir. Para birimini ve örnek biçimi ('Örn. 1.250,50') ipucu olarak göster.

## F1024 — Cüzdan kredisi tutar alanında ipucu ve hata girdiye bağlı değil; uyarı her tuş vuruşunda tekrarlanıyor

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Medium                                              |
| Durum               | Aday                                                |
| Konum               | `src/components/booking/WalletCreditOption.tsx:183` |
| Kullanıcılar        | misafir                                             |
| Prensip             | accessibility · Bilgi ve ilişkiler / Hata tanımlama |
| Sezgisel madde      | H14 — Erişilebilirlik                               |
| WCAG                | 1.3.1                                               |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | area:checkout                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** WalletCreditOption.tsx:183-193 `<input type="number" ... aria-invalid={!valid} />`: aria-describedby yok. :195-197 "En fazla {amount}" ipucu ve :198-202 `<p role="alert">` hata metni girdiye bağlanmamış. Hata öğesi koşullu mount edildiği için kullanıcı yazarken her geçersiz değerde yeniden duyuruluyor.

**Etki:** Ekran okuyucu kullanıcısı alana odaklandığında üst sınırı duymuyor. Yazarken kesintili uyarılar alıyor.

**Önerilen aksiyon:** İpucu ve hataya id verin ve girdiye `aria-describedby="credit-max credit-error"` ekleyin. role="alert" yerine sabit bir `aria-live="polite"` kapsayıcı kullanın ve doğrulamayı onBlur'da yapın.

## F1025 — Yetişkin/çocuk ayrımı rezervasyon kutusunda kayboluyor; sepete herkes yetişkin olarak ekleniyor

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                   |
| Durum               | Aday                                                                                     |
| Konum               | `src/components/cart/AddToCartButton.tsx:50`                                             |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:162`, `src/components/search/SearchBar.tsx:24` |
| Kullanıcılar        | misafir                                                                                  |
| Prensip             | learnability · consistency                                                               |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                              |
| Renk/tema           | Hayır                                                                                    |
| Efor                | L                                                                                        |
| Kaynak denetçiler   | area:widget                                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                             |

**Kanıt:** AddToCartButton.tsx:50-51 `adults, children: 0`. BookingWidget.tsx:162-177 tek bir "Misafir Sayısı" select'i var ve :260 `adults={guestCount}` geçiriyor. SearchBar.tsx:24-25 ise `adults` ve `children` ayrı tutuyor, :46'da toplamı `guests` olarak aktarıyor. Sepet kalemi cart.json:21-22'de "Yetişkin" ve "Çocuk" sütunlarıyla gösteriliyor.

**Etki:** 2 yetişkin + 2 çocukla arama yapan aile kutuda "4 misafir" görüyor. Sepette "4 Yetişkin, 0 Çocuk" yazıyor. Kişi başı vergi veya çocuk politikası olan tesislerde fiyat ve koşullar yanlış yansıyabiliyor, kullanıcı da girdiği bilginin kaybolduğunu görüyor.

**Önerilen aksiyon:** Misafir select'ini SearchBar'daki gibi yetişkin ve çocuk sayaçlarıyla değiştir. property/[id]/page.tsx:109-115 `adults` ve `children` parametrelerini okusun. Teklif, checkout ve AddToCartButton çağrısına ikisi ayrı ayrı geçirilsin.

## F1026 — 'Sepete ekle' başarıdan sonra tekrar etkin kalıyor ve aynı kalem yeniden eklenebiliyor; başarı mesajı seçim değişince bayat kalıyor

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Aday                                         |
| Konum               | `src/components/cart/AddToCartButton.tsx:55` |
| Diğer konumlar      | `src/lib/cart/cart-service.ts:312`           |
| Kullanıcılar        | misafir                                      |
| Prensip             | robustness · observability                   |
| Sezgisel madde      | H5 — Hata önleme                             |
| Renk/tema           | Hayır                                        |
| Efor                | M                                            |
| Kaynak denetçiler   | area:widget                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** AddToCartButton.tsx:55 `setStatus({ kind: "ok", text: t("add.added") })` sonrasında :77'deki koşullar düğmeyi yeniden etkinleştiriyor. cart-service.ts:312-322 `tx.cartItem.create(...)` aynı oda, tarih ve misafir için her seferinde yeni satır açıyor; birleştirme yok. `status`, prop'lar (oda, tarih, misafir) değişince sıfırlanmıyor.

**Etki:** Eklenip eklenmediğinden emin olamayan misafir ikinci kez basıyor ve sepette iki aynı oda oluşuyor; fark edilmezse grup ödemesinde iki oda ücreti çıkıyor. Tarihi değiştirdikten sonra "Sepete eklendi." yazısı yeni seçimin de eklendiği izlenimini veriyor.

**Önerilen aksiyon:** Başarıdan sonra aynı (oda, plan, tarih, misafir) anahtarı için düğmeyi "Sepette, sepete git" bağlantısına çevir. `useEffect(() => setStatus(null), [roomTypeId, ratePlanId, checkIn, checkOut, adults])` ekle. Sunucuda aynı kalem için 409 DUPLICATE_ITEM dön ya da adedi artır, UI'da bunu bildir.

## F1027 — 'Sepete ekle' oturum yokken uyarısız girişe gidiyor; widget seçimleri URL'de olmadığından dönüşte kayboluyor ve ekleme yapılmıyor

| Alan                | Değer                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Severity            | Medium                                                                              |
| Durum               | Aday                                                                                |
| Konum               | `src/components/cart/AddToCartButton.tsx:57`                                        |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:69`, `src/app/property/[id]/page.tsx:109` |
| Kullanıcılar        | misafir                                                                             |
| Prensip             | robustness · recoverability                                                         |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                   |
| Renk/tema           | Hayır                                                                               |
| Efor                | M                                                                                   |
| Kaynak denetçiler   | area:widget                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                        |

**Kanıt:** AddToCartButton.tsx:57-61 `router.push(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)`. BookingWidget.tsx:69-83 tarih, misafir, oda ve plan yalnız React durumunda; URL güncellenmiyor. property/[id]/page.tsx:109-115 bu değerleri URL'den okuyabiliyor ama widget yazmıyor.

**Etki:** Tarih ve oda seçip "Sepete ekle"ye basan oturumsuz misafir aniden giriş sayfasına gidiyor. Dönüşte varsayılan veya arama tarihleriyle karşılaşıyor, kalem eklenmemiş oluyor ve tüm seçimi yeniden yapıyor.

**Önerilen aksiyon:** Yönlendirme adresini güncel seçimden üret: `/property/${propertyId}?checkIn=..&checkOut=..&guests=..&roomId=..&ratePlanId=..&addToCart=1`. Dönüşte `addToCart=1` varsa eklemeyi otomatik tamamla ve bildir. Yönlendirmeden önce düğme altında "Sepete eklemek için giriş yapın" ve giriş bağlantısı göster (feedforward).

## F1081 — 'Giriş - Çıkış' etiketi tarih düğmesine bağlı değil

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Gözlemlendi (2 kaynak birleşti)                |
| Konum               | `src/components/booking/BookingWidget.tsx:142` |
| Kullanıcılar        | misafir                                        |
| Prensip             | accessibility · Observability (Dix)            |
| Sezgisel madde      | H14 — Erişilebilirlik                          |
| WCAG                | 1.3.1 Info and Relationships                   |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | runtime:pdp, area:widget                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** RUNTIME p2-widget.mjs: label htmlFor=null, düğmenin adı yalnız '12 Eki 2026 - 13 Eki 2026' (aria-labelledby yok); boşken yalnız 'Tarih seçin'.

**Etki:** Ekran okuyucu alanın giriş-çıkış tarihi olduğunu duymuyor.

**Önerilen aksiyon:** Düğmeye id verip label htmlFor ile bağlayın veya aria-labelledby='dates-label dates-value' kullanın.

## F1158 — Kupon alanı CSS uppercase yüzünden TR'de 'HOSGELDİN' gösteriyor, uygulanan kod 'HOSGELDIN'

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | Low                                                                   |
| Durum               | Gözlemlendi                                                           |
| Konum               | `src/components/booking/CouponField.tsx:53`                           |
| Kullanıcılar        | misafir                                                               |
| Prensip             | learnability · Consistency: girilen ve uygulanan değer aynı görünmeli |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                           |
| Renk/tema           | Hayır                                                                 |
| Efor                | S                                                                     |
| Kaynak denetçiler   | runtime:checkout                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                          |

**Kanıt:** RUNTIME p12-checkout-coupon.mjs: 'hosgeldin' yazıldı; input görsel olarak 'HOSGELDİN' (noktalı İ) gösterirken döküm 'Kupon HOSGELDIN' diyor (crops/checkout/p12-valid-coupon.png). Neden: sayfa lang=tr ve input'ta 'uppercase' sınıfı.

**Etki:** Kullanıcı kodu yanlış yazdığını düşünebilir; kodu kopyalayıp paylaşırken farklı karakter görülür.

**Önerilen aksiyon:** Input'a lang='en' verilsin ya da CSS uppercase kaldırılıp onChange'de value.toLocaleUpperCase('en-US') uygulansın.

## F1159 — Mobilde kupon 'Uygula' düğmesinin metni kenarlığından taşıyor

| Alan                | Değer                                                         |
| ------------------- | ------------------------------------------------------------- |
| Severity            | Low                                                           |
| Durum               | Gözlemlendi                                                   |
| Konum               | `src/components/booking/CouponField.tsx:56`                   |
| Kullanıcılar        | misafir                                                       |
| Prensip             | accessibility · Affordance: düğme sınırları içeriği kapsamalı |
| Sezgisel madde      | H11 — Affordance                                              |
| Renk/tema           | Hayır                                                         |
| Efor                | S                                                             |
| Kaynak denetçiler   | runtime:checkout                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                  |

**Kanıt:** RUNTIME p13-checkout-errors.mjs (390x844): kupon satırında rowW=308, scrollWidth=313; 'Uygula' 54x38 boyutuna sıkışmış, kupon uygulandığında 'Kaldır' 38x38. Ekran görüntüleri: crops/checkout/p13-mobile-coupon-applied.png, p13-too-many-guests.png (uygulamadan önce de 'Uygula' kenara değiyor).

**Etki:** Kırık görünüm güveni azaltıyor ve dokunma hedefi daralıyor.

**Önerilen aksiyon:** Düğmelere shrink-0 whitespace-nowrap verilsin, input'a min-w-0 eklensin; 390px'te 'Kaldır' alt satıra alınsın.

## F1160 — Geçersiz kupon mesajı yönlendirmiyor; alan aria-invalid almıyor, boş 'Uygula' geri bildirimsiz

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Gözlemlendi                                 |
| Konum               | `src/components/booking/CouponField.tsx:76` |
| Diğer konumlar      | `messages/tr/quote.json`                    |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · Recoverability (Dix)           |
| Sezgisel madde      | H9 — Hata mesajları                         |
| WCAG                | 3.3.1, 3.3.3                                |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | runtime:pdp                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** RUNTIME p5-anon-flow.mjs /checkout: 'yanlis123' → 'Kupon bulunamadı.' (12px kırmızı), input aria-invalid=null (describedby bağlı), odak 'Uygula'da; alan CSS uppercase ile 'YANLİS123' gösteriyor (Türkçe İ dönüşümü, gönderilen değer küçük harf); boş kodla 'Uygula' → hiçbir durum yok. Ekran runtime/probes/property/p5-coupon-invalid.png.

**Etki:** Kullanıcı yazım mı, süre mi, ilan uyumu mu sorun anlamıyor; ekran okuyucu alanın hatalı olduğunu duymuyor.

**Önerilen aksiyon:** Hatada aria-invalid='true' verin; metni eyleme dönüştürün: 'Kupon bulunamadı. Kodu kontrol edin (büyük/küçük harf fark etmez) veya kaldırın.'; boş gönderimde 'Kupon kodu girin' gösterin; text-transform yerine değeri toLocaleUpperCase('en') ile normalize edin.

## F1161 — Oturumsuz fiyat alarmı: 'giriş yapın' deniyor ama giriş bağlantısı yok

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Gözlemlendi                                  |
| Konum               | `src/components/booking/PriceInsight.tsx:77` |
| Diğer konumlar      | `messages/tr/booking.json`                   |
| Kullanıcılar        | misafir                                      |
| Prensip             | learnability · Recoverability (Dix)          |
| Sezgisel madde      | H9 — Hata mesajları                          |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | runtime:pdp                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** RUNTIME p2-widget.mjs anon: 'Fiyat alarmı kur' → durum 'Fiyat alarmı kurmak için giriş yapın.' (düz metin), bağlantı yok; odak body'de.

**Etki:** Kullanıcı yönlendirmeyi kendisi bulmak zorunda; alarm niyeti kaybolur.

**Önerilen aksiyon:** Mesajı 'Giriş yap' bağlantısıyla verin (redirect=geçerli URL + seçimler + intent=price-alert); oturumsuzken düğme etiketinde '(giriş gerekir)' feedforward'u.

## F1162 — 'Konaklama vergisi (%1) ₺19,09' satırı ₺2.100'ün %1'i değil; hesap tabanı açıklanmıyor

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Low                                                       |
| Durum               | Gözlemlendi                                               |
| Konum               | `src/components/booking/QuoteBreakdown.tsx:64`            |
| Kullanıcılar        | misafir                                                   |
| Prensip             | learnability · Familiarity (Dix) — gerçek dünya eşleşmesi |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                               |
| Renk/tema           | Hayır                                                     |
| Efor                | S                                                         |
| Kaynak denetçiler   | runtime:pdp                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                              |

**Kanıt:** RUNTIME 006-0.png ve p2: '₺2.100,00 × 1 gece', 'Konaklama vergisi (%1) ₺19,09' (₺2.100 × %1 = ₺21); Grand Deluxe ₺4.850 → ₺44,09. KDV dahil satırı ayrı ('KDV (%10) dahil: ₺190,91').

**Etki:** Kendi hesabını yapan kullanıcı hata olduğunu düşünür.

**Önerilen aksiyon:** Etiketi 'Konaklama vergisi (%1, KDV hariç tutar üzerinden)' yapın veya bilgi ipucuyla taban tutarı gösterin.

## F1385 — Ana CTA'ya basıldıktan sonra yönlendirme sırasında meşgul durumu yok

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/BookingWidget.tsx:126` |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · responsiveness                    |
| Sezgisel madde      | H12 — Feedback                                 |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** BookingWidget.tsx:112-127 handleSubmit yalnız `router.push(...)` çağırıyor. :247-253 düğmenin meşgul metni veya `aria-busy`'si yok (checkout/page.tsx:235'te `submitting ? t("processing")` deseni var).

**Etki:** Yavaş mobil ağda misafir düğmeye bastıktan sonra 1-3 sn boyunca geri bildirim almıyor ve tekrar basıyor ya da sayfadan çıkıyor.

**Önerilen aksiyon:** `const [pending, startTransition] = useTransition()` ekle, `startTransition(() => router.push(...))` yap. Düğmede `pending ? t("widget.continuing") : ...` ve `aria-busy={pending}` kullan.

## F1386 — Odak göstergeleri tutarsız: tarih düğmesi ve ana CTA'da özel stil yok, select'lerde 1px halka, diğerlerinde 2px halka; ortak focusRing kullanılmıyor

| Alan                | Değer                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                           |
| Durum               | Aday                                                                                                                          |
| Konum               | `src/components/booking/BookingWidget.tsx:147`                                                                                |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:170`, `src/components/booking/BookingWidget.tsx:250`, `src/components/ui/ui.tsx:18` |
| Kullanıcılar        | misafir                                                                                                                       |
| Prensip             | learnability · consistency                                                                                                    |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                   |
| Renk/tema           | Hayır                                                                                                                         |
| Efor                | S                                                                                                                             |
| Kaynak denetçiler   | area:widget                                                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                  |

**Kanıt:** BookingWidget.tsx:147 tarih düğmesinde `focus` sınıfı yok, yalnız `hover:border-[#003580]`. :170 ve :188 select'lerde `focus:outline-none focus:ring-1`. :250 submit'te focus sınıfı yok. AddToCartButton.tsx:79 `focus-visible:ring-2 ... ring-offset-2`. ui.tsx:18-19'da ortak `focusRing` tanımlı ve PriceInsight.tsx:122'de kullanılıyor, ama widget'ta kullanılmıyor.

**Etki:** Klavye kullanıcısı aynı kutuda odak konumunu kontrolden kontrole farklı kalınlık ve biçimde görüyor; 1px halka ince sınırla karışabiliyor.

**Önerilen aksiyon:** Tarih düğmesi, iki select, radyolar ve submit için ui.tsx'teki mevcut `focusRing` sınıfını kullan. Bu yeni renk tanımlamıyor, mevcut halka rengini kullanıyor.

## F1387 — Teklif hatası (dolu veya kısıt) varken fiyat içgörüsü gecelik fiyat göstermeye devam ediyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/BookingWidget.tsx:238` |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · consistency                     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                    |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** BookingWidget.tsx:238-245 PriceInsight yalnız `selectedRoom && checkIn && checkOut && checkIn < checkOut` koşuluna bağlı; `error`'a bakmıyor. Hata satırı (:234) "Oda seçilen tarihler için müsait değil" derken içgörü "Bu tarihler için fiyat olağan (gecelik ₺2.100,00)" diyor.

**Etki:** Misafir aynı kutuda hem "müsait değil" hem bir gecelik fiyat görüyor ve rezervasyonun mümkün olup olmadığını anlamıyor.

**Önerilen aksiyon:** PriceInsight'ı `quote &&` koşuluyla göster ya da `code === "SOLD_OUT" || code === "RESTRICTED"` iken gizle (useQuote'un `code` alanını widget'ta oku).

## F1388 — Kupon alanında mobil klavye otomatik düzeltme ve büyük harf ayarı yok; 'Kaldır' düğmesi bağlamsız

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/booking/CouponField.tsx:40` |
| Kullanıcılar        | misafir                                     |
| Prensip             | flexibility · substitutivity                |
| Sezgisel madde      | H7 — Esneklik/verim                         |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:widget                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** CouponField.tsx:40-55 input'ta `autoComplete="off"` var ama `autoCapitalize`, `autoCorrect` ve `spellCheck` yok; büyük harf yalnız CSS `uppercase` ile gösteriliyor (:53). :63-74 düğme yalnız `{t("couponRemove")}` ("Kaldır") diyor, aria-label'ı yok.

**Etki:** Mobilde klavye "yaz10" kodunu otomatik düzeltip "Yaz 10" yapabiliyor ve kupon bulunamıyor. Ekran okuyucunun düğme listesinde "Kaldır"ın neyi kaldırdığı belli değil.

**Önerilen aksiyon:** Input'a `autoCapitalize="characters" autoCorrect="off" spellCheck={false}` ekle. Kaldır düğmesine `aria-label={t("couponRemoveLabel", { code: applied })}` ("{code} kuponunu kaldır") ver.

## F1389 — Mobil klavye öznitelikleri (enterKeyHint, autoCapitalize, spellCheck) hiç kullanılmıyor

| Alan                | Değer                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                                                                                     |
| Durum               | Aday                                                                                                                                                                                                                                    |
| Konum               | `src/components/booking/CouponField.tsx:40`                                                                                                                                                                                             |
| Diğer konumlar      | `src/components/search/DestinationAutocomplete.tsx:127-143`, `src/components/support/SupportChat.tsx:122-130`, `src/components/booking/BookingMessages.tsx:182-189`, `src/app/register/page.tsx:66-104`, `src/app/login/page.tsx:88-96` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                 |
| Prensip             | flexibility · substitutivity (mobil giriş verimi)                                                                                                                                                                                       |
| Sezgisel madde      | H7 — Esneklik/verim                                                                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:forms                                                                                                                                                                                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                            |

**Kanıt:** `grep enterKeyHint` → 0, `grep autoCapitalize|spellCheck` → 0. src/components/booking/CouponField.tsx:40-55 kupon kodu yalnız CSS `uppercase` (değer küçük harf kalır), spellCheck açık; src/components/search/DestinationAutocomplete.tsx:127-143 `type="text"` (search değil), Enter tuşu etiketi 'Git'; src/components/support/SupportChat.tsx:122-130 ve src/components/booking/BookingMessages.tsx:182-189 'Gönder' ipucu yok.

**Etki:** Mobil ağırlıklı misafir kuponda otomatik düzeltme/büyük harf sorunları yaşar; klavyedeki eylem tuşu beklenen eylemi göstermez.

**Önerilen aksiyon:** Kupon: `autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="done"`; varış: `type="search" enterKeyHint="search"`; e-posta alanları: `autoCapitalize="none" spellCheck={false}`; ad alanları `autoCapitalize="words"`; sohbet/mesaj `enterKeyHint="send"`.

## F1390 — Fiyat içgörüsünde istatistik jargonu: 'içgörü', '(%90 güven)'

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Low                                                          |
| Durum               | Aday                                                         |
| Konum               | `src/components/booking/PriceInsight.tsx:111`                |
| Diğer konumlar      | `messages/tr/booking.json:27`, `messages/en/booking.json:27` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · familiarity                                   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                  |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | area:widget                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** PriceInsight.tsx:109-116 `t("interval", { level: f.number(data.level, { style: "percent" }), ... })` → tr/booking.json:27 "Beklenen gecelik fiyat aralığı (%90 güven): ₺483,98 – ₺4.178,02" (docs/img/price-insight.png). Başlık :19 "Fiyat içgörüsü".

**Etki:** Bilgisayar okuryazarlığı düşük misafir "güven" yüzdesini ve bu kadar geniş aralığın ne anlama geldiğini çözemiyor; bilgi karar vermesine yardım etmiyor.

**Önerilen aksiyon:** Başlığı "Bu tarihler için fiyat değerlendirmesi" yap. Aralık metnini "Bu odada gecelik fiyat genelde {low} ile {high} arasında" olarak sadeleştir; güven düzeyini `<details>` içine al.

## F1391 — Vergi oranı metninde ondalık ayırıcı Türkçede nokta çıkıyor ('%8.5')

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/QuoteBreakdown.tsx:20` |
| Diğer konumlar      | `messages/tr/quote.json:11`                    |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · consistency                     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                    |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** QuoteBreakdown.tsx:19-20 `t("rate", { rate: String(bps / 100) })`. tr/quote.json:11 " (%{rate})". 850 bps için TR arayüzde "(%8.5)" yazılıyor; tutarlar ise `f.money` ile "₺572,73" virgülüyle biçimleniyor.

**Etki:** Aynı satırda iki farklı ondalık ayırıcı görünüyor; TR kullanıcısı "8.5"i sekiz bin beş yüz gibi okuyabiliyor.

**Önerilen aksiyon:** `f.number(bps / 10000, { style: "percent", maximumFractionDigits: 2 })` ile biçimlendir. Mesajı `" ({rate})"` yap; yüzde işaretini Intl koysun.

## F1392 — Fiyat dökümünün başlığı yok; rezervasyon formu adlandırılmış bir landmark değil

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/QuoteBreakdown.tsx:34` |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:135` |
| Kullanıcılar        | misafir                                        |
| Prensip             | accessibility · Başlık ve landmark ile gezinme |
| Sezgisel madde      | H14 — Erişilebilirlik                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** QuoteBreakdown.tsx:34-35 `<div className="space-y-2 text-sm"><dl ...>` başlıksız. BookingWidget.tsx:135 `<form onSubmit=...>` `aria-labelledby` taşımıyor; :139 h2'nin id'si yok. Yalnız checkout bir "Fiyat Özeti" h2'si sağlıyor (checkout/page.tsx:210).

**Etki:** Ekran okuyucu kullanıcısı başlık (H) veya landmark ile gezinirken fiyat dökümüne ve rezervasyon formuna doğrudan atlayamıyor; sayfayı satır satır taramak zorunda.

**Önerilen aksiyon:** BookingWidget h2'sine `id="booking-widget-title"` ver ve forma `aria-labelledby="booking-widget-title"` ekle. Widget içinde dökümden önce `<h3 className="sr-only">{t("widget.priceDetails")}</h3>` koy.

## F1393 — Teklifin geçerlilik süresi (15 dk) gösterilmiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/booking/QuoteBreakdown.tsx:75` |
| Kullanıcılar        | misafir                                        |
| Prensip             | robustness · observability                     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                 |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** useQuote.ts:32 `expiresAt: string` yanıtta var; quote/route.ts:10 "Teklif 15 dk saklanır". QuoteBreakdown.tsx:75-91 toplam satırında veya altında `expiresAt` kullanılmıyor. Checkout'ta süre dolunca "Fiyat teklifinin süresi doldu; güncel fiyat yüklendi." (checkout.json) hatası ancak gönderimde geliyor.

**Etki:** Sayfada uzun süre kalan misafir fiyatın garanti olduğunu sanıyor; gönderimde fiyat değişti veya süre doldu hatası sürpriz oluyor.

**Önerilen aksiyon:** Toplamın altına `t("quote.validUntil", { time: f.time(quote.expiresAt) })` ("Bu fiyat {time}'e kadar geçerli") ekle. Süre dolunca useQuote'un `refreshKey`'ini artırarak teklifi otomatik yenile ve değişen fiyatı vurgula.

## F1394 — Kredi tutarı alanı temizlenince 0'a sıçrıyor; para birimi göstergesi yok; sınır ve hata metni alana bağlı değil

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | Low                                                                         |
| Durum               | Aday                                                                        |
| Konum               | `src/components/booking/WalletCreditOption.tsx:92`                          |
| Kullanıcılar        | misafir                                                                     |
| Prensip             | accessibility · WCAG 1.3.1 — kısıt ve hata metni alanla ilişkilendirilmemiş |
| Sezgisel madde      | H14 — Erişilebilirlik                                                       |
| Renk/tema           | Hayır                                                                       |
| Efor                | S                                                                           |
| Kaynak denetçiler   | area:widget                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                |

**Kanıt:** WalletCreditOption.tsx:92-93 `value={amount / 100}` ve `onChange={(e) => update(true, Math.round(Number(e.target.value) * 100))}`: boş değer `Number("")=0` olunca alan anında "0" gösteriyor. :84-85 etiket "Kullanılacak kredi" para birimi içermiyor. :98-100 "En fazla …" ipucu ve :101-105 hata `aria-describedby` ile bağlı değil (yalnız `aria-invalid`, :94).

**Etki:** Misafir tutarı silip yeniden yazamıyor, alan sürekli "0"a dönüyor. Ekran okuyucu alana odaklanınca sınırı duymuyor; hata yalnız bir kez `role=alert` ile okunuyor.

**Önerilen aksiyon:** Taslak string durumu tut ve sayıya yalnız `onBlur`'da veya geçerli girişte çevir. Etikete para birimi ekle ("Kullanılacak kredi (₺)") ya da alanın yanına `aria-hidden` sembol koy. İpucu ve hata `<p>`'lerine id ver ve `aria-describedby={`${id}-max ${id}-err`}` bağla.

## F1395 — Cüzdan kredisi alanı: aria-invalid var ama hata metni alana bağlı değil; alan temizlenemiyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Low                                                |
| Durum               | Aday                                               |
| Konum               | `src/components/booking/WalletCreditOption.tsx:94` |
| Kullanıcılar        | misafir                                            |
| Prensip             | accessibility · WCAG 1.3.1 / 3.3.1                 |
| Sezgisel madde      | H14 — Erişilebilirlik                              |
| WCAG                | 3.3.1                                              |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | lens:forms                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** src/components/booking/WalletCreditOption.tsx:86-96 `aria-invalid={!valid}` ama `aria-describedby` yok; hata :101-105 ve azami :98-100 ayrı <p>'ler. :92-93 `value={amount / 100}` + `Math.round(Number(e.target.value) * 100)` — alan silinince 0'a döner, kullanıcı boşaltıp yeniden yazamaz; varsayılan olarak azami kredi dolu (:48).

**Etki:** Ekran okuyucu misafir 'geçersiz' duyar ama nedenini duymaz; görsel kullanıcı tutarı düzeltirken 0'a sıçrayan alanla uğraşır.

**Önerilen aksiyon:** Field bileşenini kullan (hint=max, error=invalid); state'i string tut ve yalnız blur/submit'te minor'a çevir; ondalık için C3 ayrıştırıcısını kullan.

## F1396 — 'Sepete ekle' durum alanında aria-live içinde role=alert var (çift duyuru); ipucu metni düğmeye bağlı değil

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/components/cart/AddToCartButton.tsx:84` |
| Kullanıcılar        | misafir                                      |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages   |
| Sezgisel madde      | H14 — Erişilebilirlik                        |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:widget                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** AddToCartButton.tsx:84 `<div aria-live="polite">` içinde :94 `<p role="alert" ...>`. :83 `<p className="mt-1 text-xs text-gray-500">{t("add.hint")}</p>` düğmeyle `aria-describedby` üzerinden ilişkilendirilmemiş.

**Etki:** Bazı ekran okuyucularda hata iki kez okunuyor. Düğmenin "birden çok oda veya tesisi tek ödemede ayırtma" amacı odakta duyurulmuyor; iki CTA arasındaki fark ekran okuyucu kullanıcısına anlatılmıyor.

**Önerilen aksiyon:** İpucuna `id={hintId}` ver ve düğmeye `aria-describedby={hintId}` ekle. Dış div'deki `aria-live`'ı kaldırıp başarı için `role="status"`, hata için `role="alert"` olan ve sürekli DOM'da duran ayrı öğeler kullan.
