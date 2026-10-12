# Ana sayfa ve arama formu — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 78 bulgu · Severity: High 29, Medium 30, Low 19

## F31 — Tarih ızgarası gün düğmelerinin erişilebilir adı yalnız gün numarası; ay/yıl, giriş/çıkış/aralık durumu ve seçim yönergesi programatik değil

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                    |
| Durum               | Doğrulandı (4 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                          |
| Konum               | `src/components/search/DateRangePicker.tsx:209`                                                                                                                                                                                                                                                                                                                                                         |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:84`, `src/components/booking/BookingWidget.tsx:142`, `src/components/search/DateRangePicker.tsx:163`, `messages/tr/search.json`, `messages/en/search.json`, `src/components/search/DateRangePicker.tsx:33-42`, `src/components/property/PriceCalendar.tsx:282-291`, `src/components/plan/TripPlanner.tsx:146-154`, `src/components/host/HostDashboard.tsx:478-497` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                                                                                                 |
| Prensip             | accessibility · WCAG 1.3.1 Info and Relationships / 2.4.6 Headings and Labels / 1.4.1 Use of Color                                                                                                                                                                                                                                                                                                      |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                                                                                                                                                   |
| WCAG                | 1.3.1                                                                                                                                                                                                                                                                                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                   |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:a11y, lens:copy, runtime:home, area:widget, lens:consistency                                                                                                                                                                                                                                                                                                                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: homeA)                                                                                                                                                                                                                                                                                                                                                                    |

**Kanıt:** DateRangePicker.tsx:209-226 `<button ... aria-pressed={isIn || isOut}>{d.getDate()}</button>` — ad yalnız '15'; iki ay yan yanayken iki farklı '15' ayırt edilemiyor, ay/yıl/haftanın günü yok; giriş mi çıkış mı olduğu yalnız aria-pressed (ikisi için aynı). Aralıktaki günler yalnız `bg-blue-100 text-[#003580]` (:220-221), bugün yalnız `ring-1 ring-inset` (:223) ile işaretli. :163-169 ay başlıkları span, ızgarayla ilişkilendirilmemiş ve ay değişimi duyurulmuyor; :191-197 hafta günleri düz div. Ok tuşu gezinmesi/roving tabindex yok (iki ayda ~60 Tab durağı). Tetikleyici SearchBar.tsx:84 'Giriş - Çıkış' `<span>`, tetikleyiciye bağlı değil → düğme adı 'Tarih seçin'; BookingWidget.tsx:142 `<label>` htmlFor'suz.

**Etki:** Ekran okuyucu kullanan misafir hangi ayın hangi gününü seçtiğini, ilk tıklamanın giriş ikincinin çıkış olduğunu ve seçili aralığı doğrulayamaz; tarih hatası toleransı düşük görevde yanlış tarihli rezervasyon riski. Klavye kullanıcısı misafir alanına ulaşmak için onlarca Tab basar.

**Önerilen aksiyon:** DateRangePicker.tsx:209'daki düğmeye `aria-label={`${f.date(toISODate(d), "long")}${isIn ? `, ${t("picker.checkIn")}` : ""}${isOut ? `, ${t("picker.checkOut")}` : ""}${range ? `, ${t("picker.inRange")}` : ""}`}` verin (yeni anahtarlar messages/tr|en/search.json picker altına); `aria-pressed` yerine bugün için `aria-current="date"` ekleyin. Her ay için ay başlığına id verip gün ızgarasını `role="group" aria-labelledby={id}` ile sarın; ay başlık kapsayıcısına `aria-live="polite"`. Picker üstüne bir `<p className="sr-only" aria-live="polite">` yönerge satırı ekleyin ('Giriş için bir gün seçin' / 'Şimdi çıkış tarihini seçin' — PriceCalendar'daki property.calendar.selectHint metinleri yeniden kullanılabilir). Tetikleyiciye `aria-labelledby` ile 'Giriş - Çıkış' span'ını + özeti bağlayın (SearchBar.tsx:84-85; BookingWidget.tsx:142'de label'a id + düğmeye aria-labelledby). Aralık için renk dışı ipucu: aralık günlerine `underline` ya da sr metni yeterli; renk sınıflarına dokunmayın. İsteğe bağlı ikinci adım: roving tabindex + Ok/Home/End/PageUp/PageDown.

**Yapılan düzeltme:** DateRangePicker.tsx: each day button now has an aria-label with the full date including the weekday (local Intl format), plus ', giriş tarihi' / ', çıkış tarihi' / ', konaklama süresinde' where they apply. Today gets aria-current="date". Each month grid is wrapped in role=group with aria-labelledby pointing to its month label (useId). The month label row has aria-live=polite. An sr-only aria-live instruction line was added (hintCheckIn/hintCheckOut/hintDone). Days in the range get a non-color cue (underline decoration-dotted, no color class changed). Weekday headings are aria-hidden because the day labels already include the weekday. Roving tabindex with Arrow/Home/End/PageUp/PageDown is in, so the grid is a single Tab stop. Not done here: connecting the trigger label in SearchBar/BookingWidget, which is a different owner (see crossOwner). — dosyalar: `src/components/search/DateRangePicker.tsx`

## F38 — Ana sayfa kartları para birimini aktarmıyor; TRY dışı ilan ₺ ile gösterilir

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | High                                                                         |
| Durum               | Doğrulandı (2 kaynak birleşti)                                               |
| Konum               | `src/app/page.tsx:95`                                                        |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:43`, `src/app/search/page.tsx:516` |
| Kullanıcılar        | misafir                                                                      |
| Prensip             | learnability · familiarity / consistency (gerçek dünya eşleşmesi)            |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                  |
| Renk/tema           | Hayır                                                                        |
| Efor                | S                                                                            |
| Kaynak denetçiler   | lens:copy, area:cards                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                                |

**Kanıt:** page.tsx:86-99 PropertyCard'a `priceMinor={property.basePriceMinor}` geçiliyor ama `currency` geçilmiyor; PropertyCard.tsx:43 `currency = "TRY"` varsayılanı → :186 `f.money(priceMinor, currency)`. lib/search.ts:821/836 getPopularProperties `currency` alanını zaten döndürüyor; api/properties/route.ts:38 `currency: z.enum(CURRENCIES).default("TRY")` ev sahibinin EUR/USD ilan açmasına izin veriyor. Arama sayfası search/page.tsx:516 `currency={property.currency}` geçiyor (tutarsızlık). Seed verisi yalnız TRY olduğu için demoda görünmez.

**Etki:** Ev sahibi EUR fiyatlı ilan yayınladığında misafir ana sayfada aynı minor tutarı ₺ olarak görür (ör. 120 € → 120 ₺); ilan sayfasında gerçek fiyatla karşılaşınca yanıltılmış hisseder — fiyat bilgisinde para birimi hatası.

**Önerilen aksiyon:** page.tsx:95'in altına `currency={property.currency}` ekleyin; PropertyCard.tsx:17/43'te `currency` prop'unu zorunlu yapıp `= "TRY"` varsayılanını kaldırın ki başka çağıranlar da unutamasın.

**Yapılan düzeltme:** In page.tsx the PropertyCard call now receives currency={property.currency}. Making the PropertyCard currency prop required is another owner's file, so it is listed in crossOwner. — dosyalar: `src/app/page.tsx`

## F39 — İki aylık tarih seçici dar kapsayıcıda taşıyor; 36 px gün düğmeleri 15-17 px'lik ızgara izlerine sıkışıp üst üste biniyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                             |
| Konum               | `src/components/search/DateRangePicker.tsx:215`                                                                                                                                                                                                                                                                                                                                                                                            |
| Diğer konumlar      | `src/components/search/DateRangePicker.tsx:188`, `src/components/search/DateRangePicker.tsx:165`, `src/components/search/SearchBar.tsx:108`, `src/components/search/SearchBar.tsx:112`, `src/components/booking/BookingWidget.tsx:152`, `src/components/booking/BookingWidget.tsx:156`, `src/components/search/SearchBar.tsx:108-112`, `src/components/search/DateRangePicker.tsx:198`, `src/components/booking/BookingWidget.tsx:153-156` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Prensip             | robustness · task conformance / Reflow (WCAG 1.4.10), Target Size                                                                                                                                                                                                                                                                                                                                                                          |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                                                                                                                                                                                                                                                                           |
| WCAG                | 1.4.10                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Kaynak denetçiler   | lens:a11y, lens:mobile, area:home                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeA)                                                                                                                                                                                                                                                                                                                                                                                                              |

**Kanıt:** DateRangePicker.tsx:188 `grid gap-4 ${monthCount === 2 ? "grid-cols-2" : "grid-cols-1"}`, :198 `grid grid-cols-7 gap-1` (Tailwind 3.4: repeat(7,minmax(0,1fr)), yani iz sıfıra kadar daralabilir), :215 sabit `h-9 w-9`. :163-167 iki `w-32` ay etiketi + `gap-6` + iki ok düğmesi ≈344 px yer istiyor. SearchBar.tsx:108 lg altında `absolute left-0 right-0` + :112 `monthCount={2}`: 360 px ekranda picker iç genişliği ≈270 px → ay sütunu ≈127 px → iz ≈14,7 px, adım (iz+gap) ≈19 px < 36 px düğme. BookingWidget.tsx:152-156 aynı (`monthCount={2}`); property/[id]/page.tsx:203 lg:col-span-1 kenar çubuğunda 1280 px masaüstünde bile iz ≈17 px (adım ≈21 px). Masaüstü SearchBar'da (lg:w-[560px]) adım ≈37 px ile sığıyor, sorun yalnız mobil arama ve her ekranda ilan widget'ı.

**Etki:** Mobilde ana sayfa araması ve her cihazda ilan sayfası 'Rezervasyon' takviminde rakamlar sıkışıp düğmeler çakışıyor; bir sonraki düğme öncekinin sağ yarısını örttüğü için görünen rakama dokunmak komşu günü seçebiliyor, ikinci ay picker'ın sağından taşıyor. Tarih hatasına toleransı en düşük birincil görevde (tarih seç → rezervasyon) yanlış giriş/çıkış riski; özet satırı sonradan gösterse de fark edilmeyebilir.

**Önerilen aksiyon:** 1) BookingWidget.tsx:156'da `monthCount={1}` kullanın; SearchBar.tsx:112'de lg altında tek ay gösterin (ör. `const isWide = useMediaQuery('(min-width:1024px)')` → `monthCount={isWide ? 2 : 1}` ya da DateRangePicker'da ikinci ay sarmalayıcısına `hidden lg:block`). 2) DateRangePicker.tsx:215'te sabit `h-9 w-9` yerine `aspect-square w-full min-w-0` verin ki düğme izi doldursun, taşmasın. 3) :165 ay etiketlerinde `w-32` yerine `flex-1 min-w-0 truncate`. 4) Picker köküne (:139) `max-w-[calc(100vw-2rem)]` ekleyin. Renk sınıfına dokunulmaz.

**Yapılan düzeltme:** DateRangePicker.tsx: a ResizeObserver measures the root width. Below 540px the picker drops to one month automatically, which covers the listing sidebar and mobile without changing the parents. Day buttons changed from h-9 w-9 to aspect-square w-full min-w-0, so they fill their grid track and no longer overlap. Month labels changed from w-32 to a grid of min-w-0 truncate items inside a flex-1 container, so the arrows stay inside the box. The root has max-w-[calc(100vw-2rem)]. On mobile the arrow buttons are min-h/min-w 44px. No color classes were changed. — dosyalar: `src/components/search/DateRangePicker.tsx`

## F40 — Misafir/oda sayacı düğmeleri bağlamsız ('Azalt'/'Artır' x3), yeni değer duyurulmuyor, sınırda düğme pasifleşmiyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                             |
| Konum               | `src/components/search/SearchBar.tsx:154`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:163`, `src/components/search/SearchBar.tsx:179`, `src/components/search/SearchBar.tsx:188`, `src/components/search/SearchBar.tsx:201`, `src/components/search/SearchBar.tsx:210`, `messages/tr/search.json`, `messages/en/search.json`, `src/components/search/SearchBar.tsx:159`, `src/components/search/SearchBar.tsx:184`, `src/components/search/SearchBar.tsx:206`, `messages/tr/search.json:58` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Prensip             | accessibility · WCAG 2.4.6 Headings and Labels / 4.1.3 Status Messages / 4.1.2                                                                                                                                                                                                                                                                                                                                                             |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                                                                                                                                                                                      |
| WCAG                | 2.4.6                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Kaynak denetçiler   | lens:forms, lens:a11y, lens:status, lens:copy, area:home                                                                                                                                                                                                                                                                                                                                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                                                                                                                                                                                                                                                                                                                                                                                              |

**Kanıt:** SearchBar.tsx:154,179,201 `aria-label={t("bar.decrease")}` ve :163,188,210 `aria-label={t("bar.increase")}` — messages/tr/search.json `"decrease": "Azalt"`, `"increase": "Artır"`; yetişkin, çocuk ve oda satırları aynı adları taşıyor ve satırlar role=group ile etiketlenmemiş. Değer span'leri (:159, :184, :206) canlı bölge değil. Sınırda `Math.max(1, …)`/`Math.min(30, …)` sessizce değeri koruyor, düğme `disabled` olmuyor.

**Etki:** Ekran okuyucu kullanan misafir art arda 'Azalt, Artır' duyar; hangi sayacı değiştirdiğini ve yeni değeri bilemez; sınırdaki düğmeye basınca hiçbir geri bildirim almaz. Yanlış misafir sayısıyla arama → yanlış kapasite/fiyat.

**Önerilen aksiyon:** messages/tr|en/search.json bar altına `decreaseAdults`/`increaseAdults`/`decreaseChildren`/`increaseChildren`/`decreaseRooms`/`increaseRooms` ('Yetişkin sayısını azalt' vb.) ekleyip ilgili düğmelere verin; her satırı `<div role="group" aria-labelledby="adults-label">` ile sarın (p'ye id). Değer span'lerine `aria-live="polite" aria-atomic="true"`. Sınırda `disabled={adults <= 1}` / `disabled={adults >= 30}` (çocuk 0/10, oda 1/30) ekleyin; pasif görünüm için mevcut `disabled:opacity-50` gibi opaklık sınıfı yeterli (renk paleti değişmez).

**Yapılan düzeltme:** SearchBar.tsx has a new CounterRow subcomponent. Each row is role=group with aria-labelledby (useId) and has row-specific button names (bar.decreaseAdults/increaseAdults/…Children/…Rooms). The visible number is aria-hidden, and an sr-only aria-live=polite aria-atomic span announces '{label}: {count}'. At the limits (adults 1/30, children 0/10, rooms 1/min(30, adults)) the buttons get aria-disabled plus a guarded no-op instead of disabled, so focus is not lost, and aria-disabled:opacity-50 shows the state with no color change. Touch targets are h-11 w-11 on mobile and the old h-8 w-8 from lg up. — dosyalar: `src/components/search/SearchBar.tsx`

## F56 — Varış noktası combobox'ı ARIA combobox desenini uygulamıyor (ok tuşu, aria-activedescendant, Escape, durum duyurusu yok; geçersiz listbox yapısı)

| Alan                | Değer                                                                                                                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                             |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                                                       |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:127`                                                                                                                                                                                                                                                                          |
| Diğer konumlar      | `src/components/search/DestinationAutocomplete.tsx:41`, `src/components/search/DestinationAutocomplete.tsx:73`, `src/components/search/DestinationAutocomplete.tsx:152`, `src/components/search/DestinationAutocomplete.tsx:167`, `src/components/search/SearchBar.tsx:79`, `messages/tr/search.json`, `messages/en/search.json` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                          |
| Prensip             | accessibility · WCAG 4.1.2 Name, Role, Value / 4.1.3 Status Messages / 2.1.1 Keyboard                                                                                                                                                                                                                                            |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                                                                            |
| WCAG                | 4.1.2                                                                                                                                                                                                                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                            |
| Efor                | M                                                                                                                                                                                                                                                                                                                                |
| Kaynak denetçiler   | lens:forms, lens:a11y, lens:status                                                                                                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                                                                                                                                                                                                                                                                                    |

**Kanıt:** DestinationAutocomplete.tsx:127-143 input `role="combobox" aria-expanded aria-autocomplete="list"` ama `onKeyDown` ve `aria-activedescendant` yok. :147-152 `<ul role="listbox">` içinde rolsüz başlık `<li>` (:152-158, 'Aranıyor...'/'Öneriler' durum metni burada) ve rolsüz 'Sonuç bulunamadı' li'si (:159-161); :163-168 seçenekler `<li><button type="button" role="option" aria-selected={false}>` — li sarmalayıcı listbox-option sahipliğini bozuyor, aria-selected hep false, her öneri ayrı Tab durağı. :41-50 liste yalnız `mousedown` dış tıklamada kapanıyor; Escape, Tab ile çıkış/blur kapatmıyor. :99-102 seçimde `setOpen(false)` odaktaki düğmeyi DOM'dan kaldırıyor → odak body'ye düşüyor. :73 `if (cancelled || !res.ok) return;` API hatasında önceki sorgunun önerileri ekranda kalıyor.

**Etki:** Klavye/ekran okuyucu kullanan misafir önerileri ok tuşlarıyla gezemez, 8 öneri düğmesini Tab'la geçmek zorunda kalır, öneri gelip gelmediği/kaç tane olduğu duyurulmaz; seçimden sonra odak kaybolur; liste Tab ile çıkınca açık kalıp mobil düzende (SearchBar.tsx:73 flex-col) alttaki tarih ve misafir tetikleyicilerini örter; API hatasında eski öneriler güncelmiş gibi görünür.

**Önerilen aksiyon:** DestinationAutocomplete.tsx'te `activeIndex` state'i ekleyin; input'a `onKeyDown`: ArrowDown/ArrowUp activeIndex'i döndürsün ve listeyi açsın, Enter `selectOption(options[activeIndex])` + `preventDefault`, Escape `setOpen(false)`; input'a `aria-activedescendant={open && activeIndex>=0 ? `dest-opt-${activeIndex}` : undefined}`. Seçenekleri `<li id={`dest-opt-${idx}`} role="option" aria-selected={idx===activeIndex} onMouseDown={(e)=>{e.preventDefault(); selectOption(opt);}}>` yapın (iç button kalksın, Tab durağı olmasın, odak input'ta kalsın). Başlık/boş durum li'lerine `role="presentation"` verin ya da listbox dışına taşıyın; listbox dışında `<p role="status" className="sr-only">` ile 'Aranıyor…' / '{n} öneri' / 'Sonuç bulunamadı' duyurun (messages/tr|en/search.json autocomplete altına çoğul anahtar). Kök div'e `onBlur={(e)=>{ if(!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false); }}`. :73'te `!res.ok` durumunda `setOptions([])` yapın.

**Yapılan düzeltme:** DestinationAutocomplete.tsx now follows the APG combobox pattern. activeIndex state drives aria-activedescendant. ArrowDown/ArrowUp wrap around and open the list when it is closed. Enter selects the active option, and with no active option the form submits as before. Escape closes the list, a second Escape clears the value, and Tab closes it. Options are li[role=option][id=destination-opt-N] with aria-selected={idx===activeIndex}, and mousedown preventDefault means they are not Tab stops and focus stays in the input. The heading moved outside the listbox as p#destination-listbox-heading, and the listbox uses aria-labelledby. The empty state is an aria-hidden p outside the listbox. A persistent sr-only role=status reports searching, '{count} suggestions' (new key autocomplete.count) or noResults. The root's onBlur closes the list when relatedTarget is outside it. The active option uses scrollIntoView. On !res.ok the options are cleared. aria-expanded and aria-controls now follow whether the listbox is actually shown. — dosyalar: `src/components/search/DestinationAutocomplete.tsx`

## F115 — Tarih seçicide ikinci ayın ilk satırındaki önceki ay günleri seçilebilir ve ayırt edilemiyor: "Kasım" altında 28'e basınca 28 Ekim seçiliyor

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | High                                                                      |
| Durum               | Gözlemlendi                                                               |
| Konum               | `src/components/search/DateRangePicker.tsx:38`                            |
| Diğer konumlar      | `src/components/search/SearchBar.tsx`                                     |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | robustness · Robustness / task conformance; Learnability / predictability |
| Sezgisel madde      | H5 — Hata önleme                                                          |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | runtime:home                                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeA)                                             |

**Kanıt:** RUNTIME probes/home/outofmonth.mjs (/, desktop 1280x800, TR, bugün 11 Eki 2026): Kasım 2026 ızgarasının ilk satırı '26 27 28 29 30 31 1', hepsi normal görünümlü ve etkin (cls=normal, disabled yok). 'Kasım' altındaki ilk '28' tıklanınca buton metni '28 Eki 2026 - çıkış?' oldu, ardından '5' ile '28 Eki 2026 - 5 Kas 2026'. Sonraki aya geçince Aralık ızgarası '30' (30 Kasım) ile başlıyor. Ekran görüntüsü: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/home/dp-checkin-desktop-tr.png (Ekim ve Kasım ızgaralarında 26-31 iki kez görünüyor). Kod: monthMatrix (satır 38) baştaki boşluğu önceki ayın gerçek Date nesneleriyle dolduruyor. Satır 199-227 bunları ayın kendi günleriyle aynı stil ve etkin durumla çiziyor.

**Etki:** Kullanıcı Kasım başı için tarih seçtiğini sanırken Ekim sonu seçiyor. Konaklama yanlış tarihe ve yanlış gece sayısına göre aranıyor ya da rezerve ediliyor. Bu, birincil görevde para ve zaman kaybettiren bir hata.

**Önerilen aksiyon:** monthMatrix'te baştaki dolgu için Date yerine null döndür ve null hücreleri boş <div aria-hidden> olarak çiz (Booking/Airbnb deseni). Dolgu hücreleri gösterilecekse disabled + text-gray-300 + aria-hidden yap. Sadece m.month ile eşleşen günleri tıklanabilir bırak.

**Yapılan düzeltme:** monthMatrix now returns null for the leading padding instead of previous-month dates. Those cells render as an empty <div aria-hidden> and are not clickable, so 28 under November can no longer select 28 October. — dosyalar: `src/components/search/DateRangePicker.tsx`

## F116 — Rezervasyon kutusundaki tarih seçici sığmıyor: günler ve hafta başlıkları üst üste biniyor, 'sonraki ay' oku kartın dışına taşıyor

| Alan                | Değer                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                       |
| Durum               | Gözlemlendi                                                                                                |
| Konum               | `src/components/search/DateRangePicker.tsx:188`                                                            |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx`                                                                 |
| Kullanıcılar        | misafir                                                                                                    |
| Prensip             | accessibility · Robustness — Recoverability/ dokunma hedefleri; Dix 'Substitutivity' yok (tek ay görünümü) |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                      |
| WCAG                | 2.5.8 Target Size (Minimum), 1.4.10 Reflow                                                                 |
| Renk/tema           | Hayır                                                                                                      |
| Efor                | S                                                                                                          |
| Kaynak denetçiler   | runtime:pdp                                                                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeA)                                                                              |

**Kanıt:** RUNTIME probe p2-widget.mjs + p3-layout.mjs: mobil 390px popover genişliği 308px, iç scrollWidth 346px; 36x36 gün düğmeleri 15px'lik sütunlarda → her komşu düğme 17px üst üste (btnOverlapPx=[17,17,17,17,17,17]). Ekran: runtime/probes/property/p3-mobile-picker.png ('CunCmtPaz' birleşik, seçili '12' çipi '13'ün altında, '›' kartın sağ dışında). Masaüstü 1280: popW 344 ≈ aynı sıkışma (p2-picker-desktop.png: '12 13' çakışık). Kod: BookingWidget.tsx:153-157 monthCount={2} dar 395px sütunda; DateRangePicker.tsx:188 grid-cols-2, 215 h-9 w-9 sabit.

**Etki:** Misafir yanlış güne dokunuyor ya da ayı ilerletemiyor; en sık görev (tarih seçimi) mobilde güvenilmez. Çakışan hedefler WCAG 2.5.8'i ihlal eder.

**Önerilen aksiyon:** Widget içinde monthCount={1} kullanın (veya kapsayıcı genişliğine göre 1/2), gün düğmelerini w-full aspect-square yapın; mobilde seçiciyi tam ekran alt sayfa (bottom sheet) olarak açın; nav okları kapsayıcı içinde kalsın.

**Yapılan düzeltme:** Same fix as F39: automatic single month at narrow width, aspect-square w-full day buttons, nav arrows kept inside the container, and truncated weekday headings so they no longer merge into each other. A bottom-sheet presentation was not built (that would be a product/layout decision). — dosyalar: `src/components/search/DateRangePicker.tsx`

## F117 — Tarih seçici klavye/ekran okuyucu ile kullanılamaz: odak body'ye düşüyor, Esc kapatmıyor, gün adı sadece '11'

| Alan                | Değer                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| Severity            | High                                                                                    |
| Durum               | Gözlemlendi                                                                             |
| Konum               | `src/components/search/DateRangePicker.tsx:209`                                         |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx`                                              |
| Kullanıcılar        | misafir                                                                                 |
| Prensip             | accessibility · Robustness — Observability/Responsiveness (Dix); dialog semantiği eksik |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                   |
| WCAG                | 2.4.3 Focus Order, 4.1.2 Name Role Value, 1.3.1 Info and Relationships                  |
| Renk/tema           | Hayır                                                                                   |
| Efor                | M                                                                                       |
| Kaynak denetçiler   | runtime:pdp                                                                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: homeA)                                                    |

**Kanıt:** RUNTIME probe p2-widget.mjs (desktop+mobile): açınca odak açma düğmesinde kalıyor (popover'a geçmiyor); Escape sonrası aria-expanded=true (kapanmadı); dışarı tıklama sonrası da açık; aralık tamamlanınca popover kapanıyor ve 'focus after range complete: body'. Gün düğmesi erişilebilir adı yalnız '11' (aria-label yok: dayName '(no aria-label) text="11"'); ay/yıl bağlamı ve 'giriş/çıkış' rolü yok; role=dialog yok. İkinci ay ızgarasında önceki ayın 26-31 günleri tekrar etkin düğme olarak çiziliyor (p3-mobile-picker.png Kasım satırı '26 27 28 29 30 31').

**Etki:** Ekran okuyucu kullanıcısı hangi ayın '11'ini seçtiğini bilemez; klavye kullanıcısı seçim sonrası sayfanın başına atılır ve formu yeniden bulmak zorunda kalır.

**Önerilen aksiyon:** Popover'ı role=dialog aria-modal=false + aria-labelledby ile sarın; açılışta seçili/bugünkü güne odak verin, Esc ve dış tıklama ile kapatıp odağı açma düğmesine geri verin (handleDateChange'te setCalendarOpen(false) sonrası buttonRef.focus()). Gün düğmelerine aria-label='20 Ekim 2026, Salı' + seçimde 'giriş tarihi/çıkış tarihi' ekleyin; ok tuşlarıyla roving tabindex (APG date picker grid). Diğer ayın günlerini boş hücre yapın.

**Yapılan düzeltme:** Root is role=dialog with aria-label (picker.dialogLabel). On open, focus moves to the selected or first available day. Roving tabindex and arrow-key navigation are in, and moving past the visible months shifts the view. Day names carry the full date and selection state, and previous-month days are no longer shown. Escape calls the new optional onClose prop (handled in onKeyDown on the root). The parents still need to pass onClose, close on an outside click, and return focus to the trigger when the range completes or the picker closes. That is in parent components (crossOwner). — dosyalar: `src/components/search/DateRangePicker.tsx`

## F118 — Varış yeri combobox'ında klavye modeli yok: ArrowDown/Up/Enter/Escape etkisiz, aria-activedescendant hiç ayarlanmıyor, liste blur'da kapanmıyor

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | High                                                        |
| Durum               | Gözlemlendi                                                 |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:127`     |
| Kullanıcılar        | misafir, tümü                                               |
| Prensip             | accessibility · Accessibility; Flexibility / substitutivity |
| Sezgisel madde      | H14 — Erişilebilirlik                                       |
| WCAG                | 2.1.1 Keyboard, 4.1.2 Name, Role, Value                     |
| Renk/tema           | Hayır                                                       |
| Efor                | M                                                           |
| Kaynak denetçiler   | runtime:home                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                               |

**Kanıt:** RUNTIME probes/home/combobox.mjs (/, desktop, TR): 'İst' yazıldıktan sonra ArrowDown, ArrowDown, ArrowUp ve Escape tuşlarında activedesc=null, aria-expanded='true', listbox açık ve tüm seçenekler aria-selected='false'. Hiçbir durum değişmiyor. Enter, öneriyi seçmek yerine formu 'İst' ile gönderiyor (/search?destination=%C4%B0st&guests=2). Tab ile çıkınca liste açık kalıyor (ekran görüntüsü C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/home/cb-tabout-desktop.png). combobox-tab.mjs: odakta liste kendiliğinden açılıyor ve tarih alanına varmadan önce 8 seçenek düğmesi Tab durağı oluyor. Seçenekte Enter'dan sonra odak 'body'ye düşüyor. Mobilde açık kalan liste tarih düğmesini örttü ve Playwright tıklaması bir seçenek düğmesine düştü. Kod: input (127-143) onKeyDown içermiyor. Kapatma yalnız document mousedown ile yapılıyor (43-50). Seçim sonrası odak geri verilmiyor (99-102).

**Etki:** Klavye ve ekran okuyucu kullanıcıları öneriyi beklenen combobox kalıbıyla seçemiyor. Enter yarım metinle arıyor. Açık kalan liste sonraki alanları örtüyor ve fazladan 8 Tab durağı ekliyor.

**Önerilen aksiyon:** WAI-ARIA APG 'combobox with listbox popup' kalıbını uygula: activeIndex state'i tut. ArrowDown/Up indeksi döngüsel değiştirsin. Seçeneklere id ver ve input'a aria-activedescendant ata. Enter aktif seçeneği seçsin, aktif seçenek yoksa formu göndersin. Escape listeyi kapatsın (ikinci Escape değeri temizlesin). onBlur'da kapat. Seçenekleri tabIndex=-1 li[role=option] yap. Seçimden sonra input'ta odak kalsın.

**Yapılan düzeltme:** Same change as F56: keyboard model, activedescendant, Escape/Tab/blur closing, and focus stays in the input after a selection. — dosyalar: `src/components/search/DestinationAutocomplete.tsx`

## F119 — Öneri listesi başlığı (ÖNERİLER/POPÜLER DESTİNASYONLAR) 2.53:1 kontrastla 12px büyük harf

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | High                                                    |
| Durum               | Gözlemlendi                                             |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:152` |
| Kullanıcılar        | misafir                                                 |
| Prensip             | accessibility · Accessibility                           |
| Sezgisel madde      | H14 — Erişilebilirlik                                   |
| WCAG                | 1.4.3 Contrast (Minimum)                                |
| Renk/tema           | Evet — onaylandı ve uygulandı                           |
| Efor                | S                                                       |
| Kaynak denetçiler   | runtime:home                                            |
| **Düzeltme durumu** | **Düzeltildi (onaylı renk düzeltmesi)**                 |

**Kanıt:** RUNTIME probes/home/axe-open.mjs light: color-contrast (serious) '.uppercase | Element has insufficient color contrast of 2.53 (foreground color: #9ca3af, background color: #ffffff, font size: 9.0pt (12px)'. Dark: 3.66 (#6b7280 / #111827). Ekran görüntüsü C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/home/cb-noresult-tr.png. Kod: 152 'text-xs font-semibold uppercase tracking-wide text-gray-400'.

**Etki:** Az gören ve güneş altında mobil kullanan misafir liste bağlamını ('Popüler' mi 'Öneriler' mi) okuyamıyor.

**Önerilen aksiyon:** Paletten mevcut text-gray-600 tonunu kullan (gövde metinleriyle aynı, yeni renk eklemeden). Renk dokunulmazsa başlığı 14px ve normal harfe çevirmek de okunabilirliği artırır, ancak kontrastı tek başına çözmez.

## F120 — Öneri listbox'ının ARIA yapısı geçersiz (axe critical): option'lar li içinde button, başlık ve 'Sonuç bulunamadı' listbox içinde; aria-selected hep false; sonuç durumu duyurulmuyor

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | High                                                                         |
| Durum               | Gözlemlendi                                                                  |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:163`                      |
| Kullanıcılar        | misafir, tümü                                                                |
| Prensip             | accessibility · Accessibility; Robustness / observability                    |
| Sezgisel madde      | H14 — Erişilebilirlik                                                        |
| WCAG                | 1.3.1 Info and Relationships, 4.1.2 Name, Role, Value, 4.1.3 Status Messages |
| Renk/tema           | Hayır                                                                        |
| Efor                | S                                                                            |
| Kaynak denetçiler   | runtime:home                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                                |

**Kanıt:** RUNTIME probes/home/axe-open.mjs (/, desktop, liste açık, 'Bod' ve boş sorgu): aria-required-children (critical) '#destination-listbox | Element has children which are not allowed: li'. aria-required-parent (critical) 8 düğüm 'Required ARIA parents role not present: group, listbox'. listitem (serious) 9 düğüm. combobox2.mjs 'Zzzyxq': liste 'Öneriler | Sonuç bulunamadı' gösteriyor ve sayfada aria-live/status bölgesi 0 (combobox.mjs liveRegions=[]). Yeniden açılışta seçili değer 'Bodrum' için aria-selected=false. Kod: 147-151 ul[role=listbox]. 152-158 başlık li. 159-161 boş durum li. 163-167 <li><button role=option aria-selected={false}>.

**Etki:** Ekran okuyucu seçenek sayısını, konumunu ve seçili öğeyi doğru bildiremiyor. 'Sonuç bulunamadı' ve 'Aranıyor…' durumları kör kullanıcıya hiç ulaşmıyor.

**Önerilen aksiyon:** Yapıyı <ul role=listbox aria-label> > <li role=option id aria-selected> olarak düzelt. Başlığı listbox dışına <div id> olarak taşı ve aria-labelledby ile bağla (ya da role=group + aria-labelledby kullan). Boş ve yükleniyor durumlarını listbox dışında role=status olan görünmez bir bölgeye '{n} öneri' veya 'Sonuç bulunamadı' metniyle yaz. aria-selected'ı aktif veya geçerli değere bağla.

**Yapılan düzeltme:** Same change as F56: valid listbox > option structure, heading and empty state moved outside the listbox, aria-selected bound to the active option, and a role=status announcement. — dosyalar: `src/components/search/DestinationAutocomplete.tsx`

## F121 — Tarih seçici Escape ve dış tıklamayla kapanmıyor; aralık tamamlanınca odak body'ye düşüyor; tetikleyicide aria-haspopup/aria-controls yok

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | High                                                           |
| Durum               | Gözlemlendi                                                    |
| Konum               | `src/components/search/SearchBar.tsx:35`                       |
| Diğer konumlar      | `src/components/search/DateRangePicker.tsx`                    |
| Kullanıcılar        | misafir                                                        |
| Prensip             | accessibility · Flexibility / dialog initiative; Accessibility |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                              |
| WCAG                | 2.4.3 Focus Order, 4.1.2 Name, Role, Value                     |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | runtime:home                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                  |

**Kanıt:** RUNTIME probes/home/datepicker.mjs (desktop): Enter ile açılıyor (aria-expanded true), ancak odak tetikleyicide kalıyor. Escape sonrası expanded=true, açık. (5,600) noktasına dış tıklamadan sonra expanded=true, açık. Çıkış tarihi seçildikten sonra 'focus after range complete: body'. Tetikleyici: haspopup=null, controls=null. Kod: handleDateChange (32-36) setDateOpen(false) çağırıyor, odaklı gün düğmesi DOM'dan kalkıyor ve odak geri verilmiyor. dateRef (27) hiçbir dinleyiciye bağlı değil. Tetikleyici 85-90.

**Etki:** Klavye kullanıcısı seçiciyi kapatmak için tetikleyiciye geri dönmek zorunda. Seçim bitince odak sayfa başına düşüyor ve ekran okuyucu bağlamı kayboluyor. Açık popover, alttaki popüler destinasyon kartlarını örtüyor.

**Önerilen aksiyon:** Escape ve dış tıklamada kapat, odağı tetikleyiciye döndür (triggerRef.current.focus()). Aralık tamamlanınca da kapatıp odağı tetikleyiciye veya sonraki alana (misafirler) taşı. Açılınca odağı seçili ya da bugünkü güne taşı. Tetikleyiciye aria-haspopup='dialog' ve aria-controls ver, popover'a role='dialog' aria-label='Giriş ve çıkış tarihleri' ekle.

**Yapılan düzeltme:** SearchBar: Escape (onKeyDown on the wrapper) closes the picker and returns focus to the trigger. A document pointerdown outside the picker closes it. When the range is complete, focus returns to the trigger. The trigger has aria-haspopup=dialog and aria-controls. The popover wrapper has role=dialog and aria-label={bar.datesDialog}. On open, focus moves to the selected day button, or the first selectable one if none is selected. — dosyalar: `src/components/search/SearchBar.tsx`

## F122 — Oda sayısı, yetişkin/çocuk ayrımı ve çocuk yaşı aramaya hiç gönderilmiyor; arayüz '6 oda' gösterse de URL yalnız guests=3

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | High                                                                      |
| Durum               | Gözlemlendi                                                               |
| Konum               | `src/components/search/SearchBar.tsx:46`                                  |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | robustness · Robustness / task conformance; Learnability / predictability |
| Sezgisel madde      | H13 — Feedforward                                                         |
| Renk/tema           | Hayır                                                                     |
| Efor                | M                                                                         |
| Kaynak denetçiler   | runtime:home                                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: homeB)                                      |

**Kanıt:** RUNTIME probes/home/guests.mjs desktop: 1 yetişkin + 2 çocuk + 6 oda seçildi, özet '3 misafir · 6 oda'. 'Ara' sonrası URL 'http://localhost:3000/search?guests=3' oldu, rooms veya children parametresi yok. Sonuç sayfası yalnız '3 misafir' gösteriyor. Panelde çocuk yaşı seçimi yok (select sayısı 0). 1 yetişkine 6 oda verilebiliyor, kısıt yok. Kod: handleSubmit (38-48) yalnız params.set('guests', totalGuests). roomsCount (26) hiç kullanılmıyor. Odalar üst sınırı 30 (209).

**Etki:** Kullanıcının girdiği oda sayısı sessizce yok sayılıyor. 2 oda arayan aile tek oda kapasitesine ve fiyatına göre sonuç görüyor, bu da yanlış toplam fiyat beklentisi yaratıyor. Çocuklar yetişkin gibi sayılıyor.

**Önerilen aksiyon:** rooms, adults ve children (ve children_ages) parametrelerini URL'e ekle, /search tarafında kapasite ve fiyat hesabına aktar. Destek yoksa 'Odalar' satırını kaldır (yanlış feedforward vermesin). rooms <= adults kısıtı koy. Çocuk sayısı arttıkça her çocuk için yaş seçimi iste.

**Yapılan düzeltme:** The URL now includes adults, rooms and, when greater than 0, children (guests is kept). The room count is limited to the number of adults (maxRooms=min(30, adults); lowering adults also lowers rooms) and the row says so with the hint bar.roomsHint. Remaining (needs backend/API change + product decision): /search does not read or filter on rooms/adults/children, and asking for children's ages needs a product and backend decision. See crossOwner. — dosyalar: `src/components/search/SearchBar.tsx`

## F123 — Mobilde iki aylık tarih seçici 334px'e sıkışıyor: 36px gün düğmeleri 21px aralıkla üst üste biniyor, gün başlıkları çakışıyor, tam ekran değil

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | High                                                                |
| Durum               | Gözlemlendi                                                         |
| Konum               | `src/components/search/SearchBar.tsx:112`                           |
| Diğer konumlar      | `src/components/search/DateRangePicker.tsx`                         |
| Kullanıcılar        | misafir                                                             |
| Prensip             | accessibility · Robustness / observability; WCAG 2.5.8 hedef boyutu |
| Sezgisel madde      | H14 — Erişilebilirlik                                               |
| WCAG                | 2.5.8 Target Size (Minimum), 1.4.10 Reflow                          |
| Renk/tema           | Hayır                                                               |
| Efor                | M                                                                   |
| Kaynak denetçiler   | runtime:home                                                        |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: homeB)                                |

**Kanıt:** RUNTIME probes/home/datepicker-mobile.mjs (/, mobile 390x844, TR): popover position=absolute, genişlik 334px (left 28, right 362). dayBtnW=36, dayPitch=21 (bitişik düğmeler arası mesafe), 59 komşu düğme çifti üst üste biniyor. Ay başlıkları 'Ekim 2026@69-197', 'Kasım 2026@221-349'. Ekran görüntüsü C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/home/dp-mobile-tr.png: 'CumCmtPaz' başlıkları birbirine girmiş, rakamlar bitişik, 'Sonraki ay' oku panel kenarının dışına taşıyor. Kod: SearchBar.tsx:108 'absolute left-0 right-0 … lg:w-[560px]' + 112 monthCount={2} sabit. DateRangePicker.tsx:188 grid-cols-2 ve 215 'h-9 w-9' sabit genişlik.

**Etki:** Mobil ağırlıklı misafirde yanlış güne dokunma riski yüksek (hedefin etkin alanı yaklaşık 21px). Okunabilirlik düşük. Ekrandaki diğer içerik (çerez bandı, hero) seçiciyle yarışıyor ve birincil görev zorlaşıyor.

**Önerilen aksiyon:** <lg genişlikte monthCount=1 kullan veya seçiciyi tam ekran bir dialog/bottom-sheet olarak aç (fixed inset-0, başlıkta 'Kapat' ve altta 'Tamam' ile, dikey kaydırmalı aylar). Gün düğmelerini 'aspect-square w-full min-w-[40px]' yap ki ızgara hücresine sığsın.

**Yapılan düzeltme:** Below lg, monthCount=1 (matchMedia via useSyncExternalStore). The popover now sits in the normal page flow on mobile (lg:absolute only on desktop), so it neither squeezes into two months nor covers other fields. Making the day buttons fluid (h-9 w-9 → aspect-square w-full) lives in DateRangePicker.tsx, which another owner has, so it is in crossOwner. — dosyalar: `src/components/search/SearchBar.tsx`

## F124 — Misafir/oda açılır paneli mobilde "Ara" düğmesini örtüyor; kapatma düğmesi yok, Escape ve dış tıklama paneli kapatmıyor

| Alan                | Değer                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Severity            | High                                                                       |
| Durum               | Gözlemlendi                                                                |
| Konum               | `src/components/search/SearchBar.tsx:144`                                  |
| Kullanıcılar        | misafir                                                                    |
| Prensip             | flexibility · Flexibility / dialog initiative; Robustness / recoverability |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                          |
| Renk/tema           | Hayır                                                                      |
| Efor                | S                                                                          |
| Kaynak denetçiler   | runtime:home                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                              |

**Kanıt:** RUNTIME probes/home/guests.mjs mobile (/, 390x844): panel açıkken elementFromPoint(Ara merkezi) 'covered by DIV.flex items-center justify-between py-2' döndü. Escape sonrası aria-expanded=true, h1'e dış tıklamadan sonra da true. Zorla tıklamada URL '/' olarak kaldı ve arama yapılmadı. Masaüstünde de Escape ve dış tıklama paneli kapatmıyor. Ekran görüntüsü: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/home/guests-mobile-tr.png. Kod: guestsRef (satır 28) tanımlı ama hiçbir dış tıklama veya Escape dinleyicisine bağlı değil. Panel 'absolute right-0 z-30 mt-1 w-72' (144). İçinde 'Tamam' düğmesi yok.

**Etki:** Mobilde misafir sayısını değiştiren kullanıcı ana CTA olan 'Ara'yı göremiyor. Paneli kapatmanın tek yolu misafir alanına yeniden dokunmak ve bu yol keşfedilebilir değil. Birincil arama görevinde belirgin sürtünme oluşuyor.

**Önerilen aksiyon:** Panelin altına 'Tamam' düğmesi ekle. dateRef ve guestsRef için mousedown/pointerdown ile dış tıklamada kapat, Escape'te kapat ve odağı tetikleyici düğmeye geri ver. Mobilde paneli bottom-sheet (fixed bottom-0) olarak aç ya da 'Ara'yı panelin içine ikinci CTA olarak koy.

**Yapılan düzeltme:** The guests panel has a 'Done' button (bar.done, Button secondary, 44px on mobile) that closes the panel and focuses the trigger. Escape closes it and returns focus. Clicking outside closes it. On mobile the panel sits in the normal page flow (lg:absolute only on desktop), so it no longer covers the 'Search' button. The trigger has aria-controls. — dosyalar: `src/components/search/SearchBar.tsx`

## F125 — Misafir sayaçlarının altı düğmesi de yalnız 'Azalt'/'Artır' adını taşıyor; sınırda devre dışı olmuyor; değer değişimi duyurulmuyor

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | High                                                                      |
| Durum               | Gözlemlendi                                                               |
| Konum               | `src/components/search/SearchBar.tsx:154`                                 |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | accessibility · Accessibility; Robustness / observability                 |
| Sezgisel madde      | H12 — Feedback                                                            |
| WCAG                | 2.4.6 Headings and Labels, 4.1.2 Name, Role, Value, 4.1.3 Status Messages |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | runtime:home                                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                             |

**Kanıt:** RUNTIME probes/home/guests.mjs ariaSnapshot: 'button "Azalt": −', 'text: "2"', 'button "Artır": +' satırları Yetişkinler, Çocuklar ve Odalar için aynı adla 3 kez tekrarlanıyor. 3 kez eksiye basınca yetişkin 1'de kaldı, ama 'minus disabled? false aria-disabled null'. Çocuk 0'da eksi de etkin. 40 kez artıya basınca yetişkin 30'da kaldı ve 'plus disabled? false'. Sayfadaki canlı bölge sayısı 0. Düğmeler 32x32 (mobil probe 'Azalt 32x32'). Kod: 151-157, 160-167, 176-183, 185-192, 198-213 aria-label={t('bar.decrease')} gibi. Değer <span> içinde ve canlı bölge yok (159, 184, 206). messages/tr/search.json:58-59.

**Etki:** Ekran okuyucu kullanıcısı hangi sayacı değiştirdiğini ve yeni değeri bilmiyor. Sınırda basınca hiçbir şey olmuyor ve bu durum geri bildirimsiz kalıyor.

**Önerilen aksiyon:** aria-label'ı satıra özgü yap: 'Yetişkin sayısını azalt' / 'Çocuk sayısını artır' (ICU: '{label} sayısını azalt'). Sınırda disabled ver (adults<=1, children<=0, rooms<=1, üst sınırlar). Her satırı role=group aria-labelledby ile sar. Değer span'ine aria-live='polite' ekle ya da düğme adına mevcut değeri ekle ('Yetişkin: 2, azalt'). Dokunma hedefini mobilde 40-44px'e çıkar.

**Yapılan düzeltme:** Same change as F40: row-specific labels, group role, live announcement, aria-disabled at the limits and 44px buttons on mobile. — dosyalar: `src/components/search/SearchBar.tsx`

## F171 — Bugünün hücresi klavyeyle odaklandığında görünür odak göstergesi yok

| Alan                | Değer                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                            |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                        |
| Konum               | `src/components/search/DateRangePicker.tsx:223`                                                                                                                                                 |
| Diğer konumlar      | `src/styles/globals.css:61`, `src/components/property/PropertyGallery.tsx:45-46`, `src/app/login/page.tsx:95`, `src/components/booking/BookingWidget.tsx:170`, `src/components/ui/ui.tsx:18-21` |
| Kullanıcılar        | misafir                                                                                                                                                                                         |
| Prensip             | accessibility · WCAG 2.4.7 Focus Visible                                                                                                                                                        |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                           |
| WCAG                | 2.4.7                                                                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                                                                           |
| Efor                | S                                                                                                                                                                                               |
| Kaynak denetçiler   | area:home, lens:consistency                                                                                                                                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeA)                                                                                                                                                                   |

**Kanıt:** Bugünün hücresi `${todayCell && !(isIn || isOut) ? "ring-1 ring-inset ring-[#003580]" : ""}` (223) sınıfını alıyor. globals.css:61'deki genel odak kuralı `:where(a, button, ...):focus-visible:not([class*="ring"])` sınıfında 'ring' geçen öğeleri dışarıda bırakıyor; gün düğmelerinin kendi `focus-visible:` stili de yok. Sonuçta bugün hücresi odaklandığında görünümü hiç değişmiyor.

**Etki:** Klavye kullanıcısı ve az gören kullanıcı odağın 'bugün'de olduğunu göremiyor. Seçime en sık başlanan noktada konumunu kaybediyor.

**Önerilen aksiyon:** Gün düğmelerine mevcut marka rengiyle `focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#003580]` ekleyin (PriceCalendar'daki gibi). Alternatif olarak bugün işaretini `ring` yerine `underline decoration-2` ya da `after:` noktasıyla verin ki genel odak kuralı devre dışı kalmasın. Renk veya tema değişikliği gerekmez.

**Yapılan düzeltme:** Day buttons now include the shared focusRing primitive from ui.tsx (focus-visible:ring-2 in the existing brand color). On the today cell the focus-visible ring-2 overrides the ring-1 marker, so focus is visible there too. No color/theme values changed. — dosyalar: `src/components/search/DateRangePicker.tsx`

## F261 — Ana sayfa, öne çıkanlar sorgusu hata verirse arama formuyla birlikte tümden çöküyor; error.tsx yok

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | High                          |
| Durum               | Aday                          |
| Konum               | `src/app/page.tsx:36`         |
| Diğer konumlar      | `src/lib/search.ts:811-829`   |
| Kullanıcılar        | tümü                          |
| Prensip             | robustness · recoverability   |
| Sezgisel madde      | H9 — Hata mesajları           |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | area:home                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB) |

**Kanıt:** `const popular = await getPopularProperties(6);` (36) try/catch'siz çağrılıyor. src/lib/search.ts:811-829'daki `prisma.property.findMany` hata yakalamıyor; yalnızca Redis okuma/yazma try içinde. src/app altında `error.tsx` ya da `global-error.tsx` yok (glob boş döndü). Veritabanına erişilemezse ana sayfanın tamamı, arama çubuğu dahil, Next'in varsayılan İngilizce 'Application error' ekranına düşüyor.

**Etki:** Tüm kullanıcı sınıflarının giriş noktası çöküyor. Yalnızca 'Öne çıkanlar' bölümüne ait bir hata, veri gerektirmeyen arama formunu da kullanılamaz hale getiriyor. Ne kurtarma yolu ne de Türkçe açıklama var.

**Önerilen aksiyon:** `const popular = await getPopularProperties(6).catch((e) => { logger.error(errorFields(e), 'popular'); return null; })` kullanın. `popular === null` iken bölümde `<p role="status">{t('featuredError')}</p>` ve `<Link href="/">{t('retry')}</Link>` gösterin. Ayrıca `reset()` düğmeli, yerelleştirilmiş `src/app/error.tsx` ('use client') ve `src/app/global-error.tsx` ekleyin.

**Yapılan düzeltme:** In page.tsx, getPopularProperties(6) now has .catch(), which logs with logger.error(errorFields(e)) and returns null. When it is null the featured section shows <p role=status>{home.featuredError}</p> and a 44px 'Try again' link to '/' with an inline focus ring, and the search form stays usable. error.tsx and global-error.tsx were already handled globally. — dosyalar: `src/app/page.tsx`

## F262 — Ana sayfa ilan kartlarına para birimi geçirilmiyor (varsayılan TRY) ve mülk türü ham enum olarak gösteriliyor

| Alan                | Değer                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                |
| Durum               | Aday                                                                                                                |
| Konum               | `src/app/page.tsx:86`                                                                                               |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:43`, `src/app/search/page.tsx:515-519`, `src/app/search/page.tsx:112-125` |
| Kullanıcılar        | misafir                                                                                                             |
| Prensip             | learnability · consistency (aynı bileşen iki ekranda farklı beslenmiş)                                              |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                         |
| Renk/tema           | Hayır                                                                                                               |
| Efor                | S                                                                                                                   |
| Kaynak denetçiler   | lens:consistency                                                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                                                                       |

**Kanıt:** src/app/page.tsx:86-99 `<PropertyCard … priceMinor={property.basePriceMinor} … propertyType={property.propertyType} />` çağrısında `currency` prop'u yok, oysa getPopularProperties `currency: p.currency` döndürüyor (src/lib/search.ts:836). PropertyCard.tsx:43 `currency = "TRY"` varsayılanına düşüyor. Aynı kart search/page.tsx:515-519'da `currency={property.currency}` ve `propertyType={typeLabel(property.propertyType)}` ile doğru besleniyor. Ana sayfada etiket "BED_AND_BREAKFAST" ya da "HOTEL" olarak çıkıyor.

**Etki:** EUR, USD veya GBP fiyatlı bir ilan ana sayfada '₺' ile ve yanlış büyüklükte görünür. Para birimi şeması (CURRENCIES = TRY/USD/EUR/GBP) bunu destekliyor, bu yüzden risk gerçek. Her iki dilde de büyük harfli İngilizce enum metni gösterilir.

**Önerilen aksiyon:** page.tsx'te `currency={property.currency}` geçirin ve mülk türü etiketini search sayfasındaki TYPE_KEYS eşlemesini ortak bir yardımcıya (`propertyTypeLabel(t, type)`) taşıyarak kullanın. PropertyCard'da `currency` prop'unu zorunlu yapın (varsayılan değeri kaldırın) ki aynı hata derleme zamanında yakalansın.

**Yapılan düzeltme:** page.tsx now passes currency, and the property type is shown as a translated label. A local TYPE_KEYS map plus getTranslations('search') types.* keys give the same mapping as the search page, so raw enum text no longer appears. Moving this into a shared helper and making currency required in PropertyCard are listed in crossOwner. — dosyalar: `src/app/page.tsx`

## F263 — Öne çıkan kartlara para birimi geçirilmiyor; TRY dışındaki ilanlar ₺ ile gösteriliyor

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | High                                                                         |
| Durum               | Aday                                                                         |
| Konum               | `src/app/page.tsx:95`                                                        |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:47`, `src/app/search/page.tsx:516` |
| Kullanıcılar        | misafir                                                                      |
| Prensip             | robustness · task conformance (doğru fiyat)                                  |
| Sezgisel madde      | H5 — Hata önleme                                                             |
| Renk/tema           | Hayır                                                                        |
| Efor                | S                                                                            |
| Kaynak denetçiler   | area:home                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                                |

**Kanıt:** page.tsx:86-99'da PropertyCard'a `priceMinor={property.basePriceMinor}` veriliyor ama `currency` verilmiyor. Bu yüzden PropertyCard.tsx:47'deki `currency = "TRY"` varsayılanı devreye giriyor ve tutar `f.money(priceMinor, currency)` (194) ile biçimleniyor. `getPopularProperties` `currency` alanını döndürüyor (src/lib/search.ts:821, 836) ve ilan oluşturma `currency: z.enum(CURRENCIES)` kabul ediyor (src/app/api/properties/route.ts:38). Arama sayfası doğru değeri geçiriyor: `currency={property.currency}` (search/page.tsx:516).

**Etki:** EUR ya da USD fiyatlı bir ilan ana sayfada aynı minor tutarla '₺' olarak görünüyor (ör. 120,00 € yerine ₺120,00). Misafir yanlış fiyata bakarak karar veriyor, detay sayfasında farklı tutarı görünce güveni sarsılıyor. Para hatasına tolerans çok düşük.

**Önerilen aksiyon:** page.tsx'teki PropertyCard çağrısına `currency={property.currency}` ekleyin. PropertyCard'da `currency` prop'unu zorunlu yapın (varsayılanı kaldırın) ki eksik geçiş derleme hatası versin.

**Yapılan düzeltme:** Same fix as F38: currency={property.currency} added in page.tsx. — dosyalar: `src/app/page.tsx`

## F264 — Önceki ayın günleri mevcut ayın ızgarasında ayırt edilmeden tıklanabilir duruyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | High                                           |
| Durum               | Aday                                           |
| Konum               | `src/components/search/DateRangePicker.tsx:38` |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · predictability                  |
| Sezgisel madde      | H5 — Hata önleme                               |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:widget                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeA)                  |

**Kanıt:** DateRangePicker.tsx:36-38 `const lead = (first.getDay() + 6) % 7; for (let i = 0; i < lead; i++) days.push(new Date(year, month, -lead + i + 1));` önceki ayın gerçek tarihlerini ekliyor. :215-222 bu günler de mevcut ayın günleriyle aynı stille (`text-gray-800 hover:bg-blue-50`) etkin `<button>` olarak çiziliyor. Görsel ayrım yok, `disabled` değiller. İki aylık görünümde aynı tarih iki kez görünüyor (birinci ayın sonunda, ikinci ayın başında).

**Etki:** "Kasım 2026" başlığı altındaki ilk satırda 26-31 görünüyor. Misafir 30'a tıklayınca 30 Kasım değil 30 Ekim seçiliyor. Aralık vurgusu da iki kopyada birden görünüyor ve hangi ayın seçildiği belirsizleşiyor. Sonuç yanlış aya rezervasyon.

**Önerilen aksiyon:** monthMatrix'teki öncü günleri buton olarak çizme. Bunun yerine `null` döndür ve `<div aria-hidden="true" className="h-9" />` boş hücre çiz. Gösterilecekse `disabled`, `tabIndex={-1}` ve `text-gray-400` ile ayrıştır.

**Yapılan düzeltme:** Duplicate of F115: leading days are null cells rendered as an aria-hidden empty div. — dosyalar: `src/components/search/DateRangePicker.tsx`

## F265 — Tarih seçici gün düğmeleri yalnız gün numarasıyla adlandırılmış; giriş/çıkış ve aralık programatik değil, Escape/dış tıklama yok

| Alan                | Değer                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                   |
| Durum               | Aday                                                                                                   |
| Konum               | `src/components/search/DateRangePicker.tsx:209`                                                        |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:27-28,83-115`, `src/components/booking/BookingWidget.tsx:141-160` |
| Kullanıcılar        | misafir                                                                                                |
| Prensip             | accessibility · WCAG 4.1.2 Name, Role, Value / 2.1.1 Keyboard                                          |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                  |
| WCAG                | 4.1.2                                                                                                  |
| Renk/tema           | Hayır                                                                                                  |
| Efor                | L                                                                                                      |
| Kaynak denetçiler   | lens:forms                                                                                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: homeA)                                                                   |

**Kanıt:** src/components/search/DateRangePicker.tsx:209-226 `<button aria-pressed={isIn || isOut}>{d.getDate()}</button>` — erişilebilir ad yalnız "12"; iki ay yan yana olduğu için hangi aya ait olduğu, giriş mi çıkış mı olduğu ve aralık içi (yalnız `bg-blue-100` rengiyle :220-221) duyurulmuyor. ~60 düğme tek tek Tab durağı, ok tuşu ızgara gezinmesi yok. Açılır pencere: src/components/search/SearchBar.tsx:27-28 `dateRef/guestsRef` tanımlı ama dış tıklama/Escape işleyicisi yok; src/components/booking/BookingWidget.tsx:142 `<label>` hiçbir kontrole bağlı değil (htmlFor yok). Azami konaklama (src/lib/time/nights.ts:99 `Konaklama N geceyi aşamaz`) seçici tarafından önceden sınırlanmıyor. Aynı projedeki src/components/property/PriceCalendar.tsx:289-294 tam tarih aria-label'ı ile doğru örnek.

**Etki:** Ekran okuyucu ve klavye kullanan misafir giriş/çıkış tarihini güvenle seçemez — birincil 'ara → rezervasyon' görevi tarih adımında tıkanır; açık kalan takvim mobilde içeriği örter.

**Önerilen aksiyon:** Her gün düğmesine `aria-label={f.date(d,"full") + (isIn ? ", giriş" : isOut ? ", çıkış" : range ? ", seçili aralıkta" : "")}` ver; aylar için role="grid" + ok/Home/End/PageUp gezinmesi ve tek Tab durağı (roving tabindex). Açılır kabı role="dialog" aria-label="Tarih seçin" yap, açılınca seçili/ilk uygun güne odakla, Escape ve dış tıklamada kapat ve odağı tetikleyiciye döndür. BookingWidget/SearchBar tetikleyicisine `aria-labelledby` ile 'Giriş - Çıkış' etiketini bağla. `maxNights` prop'u ile sınır dışı günleri disabled + açıklama yap.

**Yapılan düzeltme:** Day aria-labels with full date and check-in/check-out/range state, roving tabindex with Arrow/Home/End/PageUp/PageDown, role=dialog with aria-label, initial focus into the grid, and Escape through the onClose prop are done in DateRangePicker. Still open: outside-click close, focus return to the trigger, and the aria-labelledby trigger link in SearchBar/BookingWidget, which belong to other owners (crossOwner). maxNights limiting was skipped because it needs a product decision and a prop from callers. — dosyalar: `src/components/search/DateRangePicker.tsx`

## F266 — Takvim günlerinin erişilebilir adı yalnızca gün numarası: ay/yıl, giriş/çıkış, aralık ve bugün bilgisi yok

| Alan                | Değer                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                      |
| Durum               | Aday                                                                                                                                                      |
| Konum               | `src/components/search/DateRangePicker.tsx:225`                                                                                                           |
| Diğer konumlar      | `src/components/search/DateRangePicker.tsx:214`, `src/components/search/DateRangePicker.tsx:191-197`, `src/components/search/DateRangePicker.tsx:163-169` |
| Kullanıcılar        | misafir                                                                                                                                                   |
| Prensip             | accessibility · WCAG 1.3.1 Info and Relationships / 4.1.2                                                                                                 |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                     |
| WCAG                | 1.3.1                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                     |
| Efor                | M                                                                                                                                                         |
| Kaynak denetçiler   | area:home                                                                                                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeA)                                                                                                                             |

**Kanıt:** Gün düğmesinin tek içeriği `{d.getDate()}` (225); `aria-label` olmadığı için adı yalnızca '12'. Giriş ve çıkış ayırt edilmiyor, ikisi de `aria-pressed={isIn || isOut}` (214). Aralık içi günler ve bugün hiç bildirilmiyor. Hafta günü başlıkları düz `<div>` (191-197), ızgara grid/tablo semantiği taşımıyor. Ay başlıkları (163-169) canlı bölge değil, ay değişince duyurulmuyor. Projedeki PriceCalendar.tsx:237-246 ise `<table>` + `<caption className="sr-only">` + `<th scope="col">` kullanıyor ve 252'de `f.date(day.date, "long")` ile tam tarih etiketi veriyor.

**Etki:** Ekran okuyucu kullanan misafir iki aylık görünümde '12, basılı değil' duyuyor. Hangi ayda olduğunu, giriş mi çıkış mı seçildiğini ve aralığın nerede bittiğini bilemiyor. Tarih hatasına toleransın çok düşük olduğu birincil görev, görsel ipucu olmadan yürütülemiyor.

**Önerilen aksiyon:** Gün düğmesine `aria-label={[f.date(toISODate(d), 'long'), isIn && t('picker.checkIn'), isOut && t('picker.checkOut'), range && t('picker.inRange')].filter(Boolean).join(', ')}` ve `aria-current={todayCell ? 'date' : undefined}` ekleyin. Ay başlığı kapsayıcısına `aria-live="polite"` verin. Izgarayı PriceCalendar'daki `<table>` + `caption` + `th scope="col"` yapısına çevirin.

**Yapılan düzeltme:** Day aria-label lists the full date and then check-in/check-out/in-range state. Today gets aria-current=date. Month headers have aria-live=polite and each month grid is role=group labelled by its month heading. I used role=group with self-describing day labels and roving-tabindex keyboard navigation instead of converting to a <table>; it gives the same information. — dosyalar: `src/components/search/DateRangePicker.tsx`

## F267 — Öneri listesi Tab ile çıkınca açık kalıyor ve Escape ile kapanmıyor; mobilde tarih ve misafir düğmelerini örtüyor

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | High                                                        |
| Durum               | Aday                                                        |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:41`      |
| Diğer konumlar      | `src/components/search/DestinationAutocomplete.tsx:146-150` |
| Kullanıcılar        | misafir                                                     |
| Prensip             | accessibility · WCAG 2.4.11 Focus Not Obscured (Minimum)    |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                           |
| WCAG                | 2.4.11                                                      |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | area:home                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                               |

**Kanıt:** Liste yalnızca `document.addEventListener("mousedown", handler)` (41-50) ile kapanıyor; input'ta `onBlur`/`onKeyDown` yok (127-143). Tab ile input'tan çıkılınca `open` true kalıyor. Mobil (SearchBar flex-col) düzende `<ul ... className="absolute left-0 right-0 z-20 mt-1 max-h-72 ...">` (147-150) 288px'e kadar aşağı açılıyor ve 'Giriş - Çıkış' ile 'Misafirler' düğmelerinin üstüne biniyor.

**Etki:** Klavye veya anahtar cihazı kullanan misafir, önerileri geçip tarih düğmesine geldiğinde odaklı düğme açık listenin altında kalıyor. Escape, ARIA combobox deseninin beklediği kapatmayı yapmıyor.

**Önerilen aksiyon:** Kök div'e `onBlur={(e) => { if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false); }}` ekleyin. Input'un `onKeyDown`'ında `Escape` gelince `setOpen(false)` yapın; liste kapalıyken ikinci Escape `onChange('')` ile değeri temizlesin.

**Yapılan düzeltme:** Same change as F56: the list closes on root onBlur (relatedTarget check) and on Tab or Escape. — dosyalar: `src/components/search/DestinationAutocomplete.tsx`

## F268 — Şehir veya çıkış tarihi seçildikten sonra klavye odağı kayboluyor (body'ye düşüyor)

| Alan                | Değer                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                             |
| Durum               | Aday                                                                                             |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:99`                                           |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:32-36`, `src/components/search/DateRangePicker.tsx:209-213` |
| Kullanıcılar        | misafir                                                                                          |
| Prensip             | accessibility · WCAG 2.4.3 Focus Order                                                           |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                            |
| WCAG                | 2.4.3                                                                                            |
| Renk/tema           | Hayır                                                                                            |
| Efor                | S                                                                                                |
| Kaynak denetçiler   | area:home                                                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                                                    |

**Kanıt:** `const selectOption = (opt: LocationOption) => { onChange(opt.city); setOpen(false); };` (99-102). Odak, Enter'lanan `<button role="option">` üzerindeyken liste unmount ediliyor ve odak document.body'ye düşüyor. Aynısı SearchBar.tsx:35'te var: `if (v.checkOut) setDateOpen(false);`. Çıkış gününe Enter basılınca odaktaki gün düğmesi DOM'dan kalkıyor. Üç bileşende de hiç `focus()` çağrısı yok.

**Etki:** Yalnız klavye veya ekran okuyucu kullanan misafir, şehir ya da çıkış tarihi seçtikten sonra formdaki yerini kaybediyor. Sonraki Tab sayfanın başından (atlama bağlantısı, başlık menüsü) başlıyor ve aramayı bitirmek için formu yeniden dolaşmak gerekiyor. Ekran okuyucu yeni odağı duyurmuyor.

**Önerilen aksiyon:** DestinationAutocomplete'e `inputRef` ekleyin. `selectOption` içinde `setOpen(false)` sonrasında `inputRef.current?.focus()` çağırın; onFocus listeyi yeniden açmasın diye `suppressOpenRef` bayrağıyla bir kez yutun. İsterseniz `onSelected` callback'iyle odağı SearchBar'daki tarih düğmesine taşıyın. SearchBar'da `dateButtonRef` tanımlayın ve `handleDateChange` içinde `if (v.checkOut) { setDateOpen(false); dateButtonRef.current?.focus(); }` yapın (ya da odağı misafir düğmesine ilerletin).

**Yapılan düzeltme:** Destination: focus stays in the input after a selection, because the option is not a focusable element and mousedown is prevented. SearchBar: once the date range is complete, handleDateChange closes the picker and calls dateButtonRef.current.focus(). — dosyalar: `src/components/search/DestinationAutocomplete.tsx`, `src/components/search/SearchBar.tsx`

## F269 — Combobox ok tuşu sözleşmesi uygulanmamış: aria-activedescendant yok, her öneri ayrı Tab durağı

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | High                                                                |
| Durum               | Aday                                                                |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:130`             |
| Diğer konumlar      | `src/components/search/DestinationAutocomplete.tsx:162-195`         |
| Kullanıcılar        | misafir                                                             |
| Prensip             | accessibility · WCAG 4.1.2 Name, Role, Value (ARIA combobox deseni) |
| Sezgisel madde      | H7 — Esneklik/verim                                                 |
| WCAG                | 4.1.2                                                               |
| Renk/tema           | Hayır                                                               |
| Efor                | M                                                                   |
| Kaynak denetçiler   | area:home                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                                       |

**Kanıt:** `role="combobox" aria-expanded={open} aria-controls={...} aria-autocomplete="list"` (130-133) bildiriliyor ama `onKeyDown` ve `aria-activedescendant` yok. Seçenekler `<button type="button" role="option" aria-selected={false}>` (164-168): ok tuşları hiçbir şey yapmıyor, 8 öneri 8 ek Tab durağı oluşturuyor ve etkin öneri programatik olarak belirlenemiyor.

**Etki:** Ekran okuyucu kullanan misafir 'combobox' duyup Aşağı ok tuşuna basıyor ve hiçbir şey olmuyor (bazı okuyucularda sanal imleç sayfada kayıyor). Klavye kullanıcısı tarih alanına ulaşmak için 8 öneriyi Tab ile geçmek zorunda.

**Önerilen aksiyon:** `const [active, setActive] = useState(-1)` ekleyin. Input `onKeyDown`'ında ArrowDown/ArrowUp `setActive`'i sarmal olarak değiştirsin, Home/End desteklensin; Enter'da `active >= 0` ise `e.preventDefault(); selectOption(options[active])`. Input'a `aria-activedescendant={active >= 0 ? `destination-opt-${active}` : undefined}` verin. Seçenekleri buton yerine `<li id={`destination-opt-${idx}`} role="option" aria-selected={idx === active} onMouseDown={(e) => e.preventDefault()} onClick={...}>` yapın (Tab durağı olmasınlar). Etkin seçenek `bg-blue-50` ve `scrollIntoView({ block: 'nearest' })` alsın; sorgu değişince `setActive(-1)`.

**Yapılan düzeltme:** Same change as F56: activedescendant, arrow-key contract and no extra Tab stops. Home/End were left with their default caret movement in the text field. — dosyalar: `src/components/search/DestinationAutocomplete.tsx`

## F270 — Arama alanında yükleniyor, öneri sayısı ve sonuç yok durumları ekran okuyucuya duyurulmuyor

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | High                                                       |
| Durum               | Aday                                                       |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:153`    |
| Kullanıcılar        | misafir                                                    |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages / observability |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                             |
| WCAG                | 4.1.3                                                      |
| Renk/tema           | Hayır                                                      |
| Efor                | S                                                          |
| Kaynak denetçiler   | area:home                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: homeB)                              |

**Kanıt:** Yükleniyor, sonuç ve boş durumları yalnızca görsel `<li>` metni: `loading ? t("autocomplete.searching") : t("autocomplete.suggestions")` (153-157) ve `t("autocomplete.noResults")` (160). Hiçbir yerde `aria-live` ya da `role="status"` yok; öneri sayısı hiç duyurulmuyor.

**Etki:** Ekran okuyucu kullanan misafir yazarken arama yapıldığını, kaç öneri geldiğini ya da hiç sonuç olmadığını öğrenemiyor.

**Önerilen aksiyon:** Listbox dışına kalıcı `<p role="status" className="sr-only">` ekleyin. İçeriği: yüklenirken `t('autocomplete.searching')`; sonuç varsa `t('autocomplete.count', { count: options.length })` (yeni anahtar: TR '{count} öneri', EN '{count, plural, one {# suggestion} other {# suggestions}}'); boşsa `t('autocomplete.noResults')`.

**Yapılan düzeltme:** A persistent sr-only p role=status sits outside the listbox. It reads searching, autocomplete.count (TR '{count} öneri', EN plural) or noResults. — dosyalar: `src/components/search/DestinationAutocomplete.tsx`

## F271 — Arama ölçütleri korunmuyor: SearchBar URL'den dolmuyor, sonuç sayfasında aramayı düzenleme yolu yok

| Alan                | Değer                                                    |
| ------------------- | -------------------------------------------------------- |
| Severity            | High                                                     |
| Durum               | Aday                                                     |
| Konum               | `src/components/search/SearchBar.tsx:19`                 |
| Diğer konumlar      | `src/app/search/page.tsx:283-291`, `src/app/page.tsx:48` |
| Kullanıcılar        | misafir                                                  |
| Prensip             | flexibility · task migratability / recoverability        |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                        |
| Renk/tema           | Hayır                                                    |
| Efor                | M                                                        |
| Kaynak denetçiler   | area:home                                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: homeB)                     |

**Kanıt:** Durum her zaman sabit başlangıçla açılıyor: `useState("")` (19, 22, 23), `useState(2)` (24), `useState(0)` (25), `useState(1)` (26). Bileşen ne prop ne de `useSearchParams` alıyor. SearchBar yalnızca ana sayfada (page.tsx:48) kullanılıyor; search/page.tsx:283-291 sadece başlığı ve '{tarih} · {n} misafir' metnini gösteriyor, ölçütleri düzenleyecek bir form yok.

**Etki:** Sonuçları gördükten sonra tarihi ya da şehri değiştirmek isteyen misafir (karşılaştırma görevinin en sık adımı) ana sayfaya dönüp tüm alanları yeniden doldurmak zorunda. Geri tuşuyla dönüldüğünde de seçimler sıfırlanmış oluyor.

**Önerilen aksiyon:** SearchBar'a `initial?: { destination; checkIn; checkOut; adults; children; rooms }` prop'u ekleyip state'i bununla başlatın. search/page.tsx'teki başlık kartına `<SearchBar initial={{ destination, checkIn, checkOut, adults: guests }} />` (kompakt varyant) yerleştirin. Ana sayfada son aramayı try/catch'e sarılmış sessionStorage'dan önceden doldurun.

**Yapılan düzeltme:** SearchBar now takes an optional initial?: SearchBarInitial prop (destination, checkIn, checkOut, adults, children, rooms), validates and clamps it, and starts its state from it. Placing <SearchBar initial=…> in the search/page.tsx header belongs to another owner (crossOwner). The sessionStorage pre-fill on the home page was not done. — dosyalar: `src/components/search/SearchBar.tsx`

## F272 — Oda sayısı seçtiriliyor ama aramaya hiç aktarılmıyor (sessiz veri kaybı)

| Alan                | Değer                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                  |
| Durum               | Aday                                                                                                                                                                  |
| Konum               | `src/components/search/SearchBar.tsx:46`                                                                                                                              |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:26`, `src/components/search/SearchBar.tsx:141`, `src/components/search/SearchBar.tsx:196-215`, `src/app/search/page.tsx:127-131` |
| Kullanıcılar        | misafir                                                                                                                                                               |
| Prensip             | robustness · task conformance                                                                                                                                         |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                 |
| Efor                | M                                                                                                                                                                     |
| Kaynak denetçiler   | area:home                                                                                                                                                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: homeB)                                                                                                                                  |

**Kanıt:** `const [roomsCount, setRoomsCount] = useState(1);` (26) var, 196-215 arasında oda sayacı var ve özet `t("bar.guestsSummary", { guests: totalGuests, rooms: roomsCount })` (141) oda sayısını gösteriyor. Ancak `handleSubmit` yalnızca `params.set("guests", String(totalGuests))` (46) yazıyor; `rooms` URL'ye eklenmiyor. search/page.tsx:127-131 de `rooms` okumuyor. Oda sayısının yetişkin sayısını aşmasına da bir kısıt yok (1 yetişkin + 30 oda seçilebiliyor; 200, 209).

**Etki:** Ailesi ya da grubu için birden çok oda isteyen misafir 3 oda seçiyor, sonuçlar tek oda varsayımıyla geliyor ve seçimi sessizce kayboluyor. Kontrol, sistemin karşılamadığı bir şeyi vaat ediyor (yanlış feedforward).

**Önerilen aksiyon:** `params.set('rooms', String(roomsCount))` ekleyin; search/page.tsx ile `SearchParamsSchema`'ya `rooms` (1-30) ekleyip sonuçları buna göre süzün. Arama oda sayısını desteklemeyecekse Odalar satırını (196-215) ve özetteki '· {rooms} oda' parçasını kaldırın. Oda artırma düğmesini `disabled={roomsCount >= adults}` ile sınırlayın.

**Yapılan düzeltme:** Same change as F122: rooms is now in the URL and capped by the number of adults. Making search/page.tsx and SearchParamsSchema read rooms and filter on it needs another owner and a backend change. — dosyalar: `src/components/search/SearchBar.tsx`

## F375 — Yalnız giriş tarihi seçiliyken arama tarihi sessizce düşürüyor; tarih temizleme yolu yok

| Alan                | Değer                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                       |
| Durum               | Doğrulandı (3 kaynak birleşti)                                                               |
| Konum               | `src/components/search/SearchBar.tsx:42`                                                     |
| Diğer konumlar      | `src/components/search/DateRangePicker.tsx:121`, `src/components/search/SearchBar.tsx:60-66` |
| Kullanıcılar        | misafir                                                                                      |
| Prensip             | robustness · observability / recoverability                                                  |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                               |
| WCAG                | 3.3.1                                                                                        |
| Renk/tema           | Hayır                                                                                        |
| Efor                | S                                                                                            |
| Kaynak denetçiler   | lens:forms, lens:status, runtime:home, area:home                                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p115)                                                              |

**Kanıt:** SearchBar.tsx:42-45 `if (checkIn && checkOut) { params.set(...) }` — yalnız giriş seçiliyse arama tarihsiz yapılıyor; :64 özet `'{date} - çıkış?'` ipucu gösteriyor ama gönderimde uyarı/odak yönlendirmesi yok. Seçili tarihleri temizleyecek bir düğme yok (DateRangePicker.tsx:121 aynı güne tıklama hiçbir şey yapmıyor).

**Etki:** Çıkışı seçmeyi unutan misafir tarihli toplam fiyat beklerken tarihsiz 'gecelik başlangıç' fiyatlarıyla karşılaşır; hata önlenmez ve bildirilmez.

**Önerilen aksiyon:** handleSubmit'te `if (checkIn && !checkOut) { setDateError(true); toggleOpen("date", true); return; }`; tarih tetikleyicisine (:85) `aria-invalid={dateError}` + `aria-describedby="date-error"`, altına `<p id="date-error" role="alert">{t("bar.checkOutRequired")}</p>` ('Çıkış tarihini seçin'); messages/tr|en/search.json'a anahtar ekleyin. DateRangePicker'a `checkIn` varken görünen 'Tarihleri temizle' (`onChange({checkIn:"",checkOut:""})`) metin düğmesi ekleyin.

**Yapılan düzeltme:** handleSubmit now stops when only check-in is set. It sets dateError, closes the guests panel and opens the date panel; focus goes to the selected check-in day, or is moved there if the panel was already open. The date trigger gets aria-invalid and aria-describedby pointing to a role="alert" error under it (bar.checkOutRequired), with the same icon and errorPrefix markup as Field. When check-in is set, a 'Tarihleri temizle' (x) button appears at the right of the date field. It clears both dates and the error and puts focus back on the trigger. The error also clears when a check-out date is picked.

## F383 — Yer ve ülke adları kodda/veride sabit Türkçe; EN arayüzde 'BAE', 'İtalya', 'Kapadokya' görünüyor

| Alan                | Değer                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                       |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                               |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:17`                                       |
| Diğer konumlar      | `src/app/page.tsx:12`, `prisma/seed.ts:55`, `src/app/page.tsx:12-33`, `prisma/seed.ts:55-63` |
| Kullanıcılar        | misafir                                                                                      |
| Prensip             | learnability · familiarity (i18n) / consistency                                              |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                  |
| WCAG                | 3.1.2                                                                                        |
| Renk/tema           | Hayır                                                                                        |
| Efor                | M                                                                                            |
| Kaynak denetçiler   | lens:copy, area:home                                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p114)                                                              |

**Kanıt:** DestinationAutocomplete.tsx:17-26 POPULAR_FALLBACK `{ city: "Roma", country: "İtalya" }`, `{ city: "Dubai", country: "BAE" }`, `{ city: "Barselona", country: "İspanya" }`; app/page.tsx:12-33 popularDestinations 'Kapadokya', 'Türkiye' sabit; prisma/seed.ts:55-60 ülke verisi 'Fransa', 'İtalya', 'BAE' — PropertyCard konum satırı (page.tsx:90) bunları birleştiriyor. Arayüz etiketleri next-intl ile çevrilirken yer adları çevrilmiyor.

**Etki:** EN misafir öneri listesinde ve ana sayfada 'BAE', 'İtalya', 'Hollanda' gibi tanımadığı adlar görür; 'Rome' yazdığında 'Roma' eşleşmesi yerel fallback'te bulunmaz; dil karışık görünür.

**Önerilen aksiyon:** Ülkeleri ISO-3166 koduyla tutup `new Intl.DisplayNames([f.locale], { type: "region" }).of(code)` ile gösterin; popüler şehir adlarını messages/tr|en/home.json (ör. `destinations.cappadocia`) altına taşıyın; POPULAR_FALLBACK filtresinde her iki dildeki adı eşleyin; URL'deki destination değeri kanonik (DB) adı kalsın.

**Yapılan düzeltme:** Suggestions now show translated names. The city comes from home.places.<key> through placeCityKey and the country from localizeCountryName (Intl.DisplayNames), so the EN list shows Rome / Italy and United Arab Emirates instead of Roma / İtalya / BAE. The value sent with the search is still the database name. Local matching checks the database name, the translated city and the translated country, so typing 'Rome' finds Roma.

## F384 — Öneri listesi grup başlığı/durum metni düşük kontrastlı (text-gray-400, ≈2,5:1)

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Doğrulandı (2 kaynak birleşti)                          |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:152` |
| Kullanıcılar        | misafir                                                 |
| Prensip             | accessibility · WCAG 1.4.3 Contrast (Minimum)           |
| Sezgisel madde      | H14 — Erişilebilirlik                                   |
| WCAG                | 1.4.3                                                   |
| Renk/tema           | Evet — kapsam dışı                                      |
| Efor                | S                                                       |
| Kaynak denetçiler   | lens:a11y, area:home                                    |
| **Düzeltme durumu** | **Kapsam dışı (renk/tema)**                             |

**Kanıt:** DestinationAutocomplete.tsx:152 `text-xs font-semibold uppercase tracking-wide text-gray-400` beyaz zemin üzerinde (Tailwind 3 gray-400 #9ca3af ≈2,54:1, 12 px metin için 4,5:1 gerekli); bu li 'Popüler destinasyonlar' / 'Aranıyor...' / 'Öneriler' durumunu taşıyan tek görsel metin.

**Etki:** Az gören misafir listenin popüler öneri mi arama sonucu mu olduğunu ve aramanın sürdüğünü okuyamaz.

**Önerilen aksiyon:** Metin rengini gray-600/gray-500'e çekmek gerekir (renk sınıfı değişikliği). Renk dışı kısmi iyileştirme: `text-xs` → `text-sm` ve durumu ayrıca combobox bulgusundaki sr-only `role="status"` ile iletmek; ancak 1.4.3 ancak ton değişikliğiyle tam karşılanır, kullanıcı onayı gerekir.

## F385 — Tarih ve misafir panelleri Escape, dış tıklama veya dışarı odakla kapanmıyor; mobilde alttaki kontrolleri örtüyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                  |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                                                          |
| Konum               | `src/components/search/SearchBar.tsx:27`                                                                                                                                                                                                                                                                                |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:107`, `src/components/search/SearchBar.tsx:143`, `src/components/booking/BookingWidget.tsx:143`, `src/components/layout/Header.tsx:144`, `src/components/search/SearchBar.tsx:50-58`, `src/components/search/SearchBar.tsx:107-115`, `src/components/search/SearchBar.tsx:143-218` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                 |
| Prensip             | flexibility · dialog initiative / WCAG 2.4.11 Focus Not Obscured                                                                                                                                                                                                                                                        |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                                                                                                                                                                       |
| WCAG                | 2.4.11                                                                                                                                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:a11y, lens:forms, area:home                                                                                                                                                                                                                                                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p115)                                                                                                                                                                                                                                                                                         |

**Kanıt:** SearchBar.tsx:27-28 `dateRef`, `guestsRef` tanımlı ve :83/:119'da bağlı ama hiçbir effect/handler'da kullanılmıyor; bileşende `keydown`/`mousedown`/`focusout` dinleyicisi yok. :107-115 tarih paneli ve :143-218 misafir paneli yalnız tetikleyiciyle ya da (tarihte) çıkış seçilince kapanıyor. Misafir paneli `absolute right-0 z-30 w-72` mobil flex-col düzende (:73) 'Ara' düğmesinin (:222) üstüne düşüyor. BookingWidget.tsx:143-159 takvimde de Escape/dış tıklama kapanması yok. Header.tsx:144 `aria-controls="mobile-menu"` kapalıyken DOM'da olmayan id'ye işaret ediyor (:173-175 koşullu render).

**Etki:** Klavye kullanan misafir paneli kapatmak için tetikleyiciye geri dönmek zorunda; fare kullanıcısı bile dışarı tıklayarak kapatamıyor; açık panel Tab ile odaklanan 'Ara' düğmesini gizliyor.

**Önerilen aksiyon:** SearchBar.tsx'te tek bir effect: `keydown` Escape → `setDateOpen(false); setGuestsOpen(false)` ve odağı ilgili tetikleyiciye döndür (tetikleyicilere ref ekleyin); `mousedown` dış tıklamada `dateRef/guestsRef.current?.contains(target)` değilse kapat; panel kapsayıcılarına `onBlur={(e)=>{ if(!e.currentTarget.contains(e.relatedTarget as Node)) close(); }}`. Aynı mantığı ortak `usePopover(ref, onClose)` kancası olarak çıkarıp BookingWidget.tsx:143'te de kullanın. Header'da mobil menüyü her zaman render edip `hidden={!isMenuOpen}` ile gizleyin.

**Yapılan düzeltme:** Escape to close with focus return, and closing on outside pointerdown (mouse and touch), were already in the current code, and the panels already sit in the page flow on mobile so they don't cover 'Ara'. Added the missing part: both panel containers close when focus moves out (onBlur with relatedTarget outside the container; a null relatedTarget is ignored so clicks are left to pointerdown). Header mobile-menu part handed off in crossOwner.

## F407 — Tarih seçici önceki ayın günlerini ayırt edilmeden, seçilebilir kopyalar olarak çiziyor

| Alan                | Değer                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                          |
| Durum               | Doğrulandı                                                                                      |
| Konum               | `src/components/search/DateRangePicker.tsx:38`                                                  |
| Diğer konumlar      | `src/components/search/DateRangePicker.tsx:200`, `src/components/property/PriceCalendar.tsx:69` |
| Kullanıcılar        | misafir                                                                                         |
| Prensip             | learnability · predictability                                                                   |
| Sezgisel madde      | H5 — Hata önleme                                                                                |
| WCAG                | 1.3.1                                                                                           |
| Renk/tema           | Hayır                                                                                           |
| Efor                | S                                                                                               |
| Kaynak denetçiler   | lens:forms, lens:a11y, lens:mobile                                                              |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p113)                                                                |

**Kanıt:** DateRangePicker.tsx:33-42 `for (let i = 0; i < lead; i++) days.push(new Date(year, month, -lead + i + 1));` ayın başındaki boşlukları önceki ayın gerçek tarihleriyle dolduruyor; :200 yalnız `d < today` pasif, :215-225 bu günler aynı `text-gray-800` stiliyle düğme. İki aylık görünümde 2. ayın ilk satırında 1. ayın son günleri tekrar çıkıyor, ileri gidildiğinde (monthsOffset>0) 1. ayın dolgu günleri de etkin; :201-202 `isSameDay` seçili günü iki kopyada birden boyuyor. Karşılaştırma: PriceCalendar.tsx dolguyu `null` ile yapıyor.

**Etki:** Aralık ızgarasının ilk satırındaki '30'a dokunan misafir aslında önceki ayın 30'unu seçiyor; seçili gün iki yerde vurgulanıyor; ekran okuyucu aynı günü iki kez bağlamsız duyuyor.

**Önerilen aksiyon:** monthMatrix'in dönüş tipini `(Date | null)[]` yapıp lead için `null` push edin; render'da (:199) `d === null` ise `<span aria-hidden="true" className="h-9 w-9" />` çizin (PriceCalendar weeksOf deseni). Bu, renk değişikliği gerektirmez.

**Yapılan düzeltme:** The current code already fills leading cells with null. monthMatrix returns (Date \| null)[] and the render draws `<div aria-hidden="true" />` when d is null, so previous-month days are not drawn, cannot be selected and are not highlighted twice. I kept this when rewriting the matrix for locale week start.

## F408 — Arama çubuğu oda sayısını tamamen, çocuk sayısını ayrıştırmadan aramaya aktarıyor (yanıltıcı feedforward)

| Alan                | Değer                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                  |
| Durum               | Doğrulandı                                                                                                                                                                              |
| Konum               | `src/components/search/SearchBar.tsx:46`                                                                                                                                                |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:26`, `src/components/search/SearchBar.tsx:141`, `src/components/cart/AddToCartButton.tsx:50`, `messages/tr/search.json`, `messages/en/search.json` |
| Kullanıcılar        | misafir                                                                                                                                                                                 |
| Prensip             | learnability · predictability / task conformance                                                                                                                                        |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:status, lens:mobile, lens:nav                                                                                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p115)                                                                                                                                                         |

**Kanıt:** SearchBar.tsx:26 `roomsCount` state'i, :195-216 1-30 arası sayaç ve :141 özet `'{guests} misafir · {rooms} oda'` gösteriliyor; ancak :38-48 handleSubmit yalnız destination, checkIn/checkOut ve `params.set("guests", String(totalGuests))` yazıyor — oda sayısı atılıyor, çocuklar :30'da yetişkinle toplanıyor. search/page.tsx:127-143 `rooms` okumuyor; AddToCartButton.tsx:50-51 `children: 0` gönderiyor.

**Etki:** Grup/aile misafiri '3 oda' seçip sonuçların ve fiyatların tek oda için olduğunu fark etmez; sistem girilen bilgiyi sessizce yok sayar, uyuşmazlık ancak ilan/checkout adımında ortaya çıkar.

**Önerilen aksiyon:** Kısa vadede: arama oda sayısını desteklemediği için :195-216 oda satırını kaldırın ve :141 özetinden '· {rooms} oda' kısmını çıkarın (messages/tr|en/search.json `bar.guestsSummary` → '{guests} misafir'). Uzun vadede: `params.set("rooms", …)` ve `params.set("children", …)` yazıp search/page.tsx, BookingWidget ve sepete taşıyın, sonuç başlığında geri gösterin.

**Yapılan düzeltme:** Short-term fix: nothing in src reads the rooms URL param (search/page.tsx and the rest only use guests). So I removed the rooms counter row, the roomsCount state, MAX_ROOMS and the rooms clamp in changeAdults, and stopped writing rooms= to the URL. The guests summary now reuses the existing key search.guestCount ('{count} misafir'). SearchBarInitial.rooms is kept but ignored, so the type is not broken. Carrying rooms and children through search, booking and cart is still open (feature work in other files).

## F444 — Tarih seçicide ok tuşu gezinmesi yok; iki ay için 57 ayrı Tab durağı var

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Medium                                                    |
| Durum               | Gözlemlendi (2 kaynak birleşti)                           |
| Konum               | `src/components/search/DateRangePicker.tsx:199`           |
| Kullanıcılar        | misafir                                                   |
| Prensip             | flexibility · Flexibility / substitutivity; Accessibility |
| Sezgisel madde      | H7 — Esneklik/verim                                       |
| WCAG                | 2.1.1 Keyboard (verimlilik), APG date grid                |
| Renk/tema           | Hayır                                                     |
| Efor                | M                                                         |
| Kaynak denetçiler   | runtime:home, area:widget                                 |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p113)                          |

**Kanıt:** RUNTIME probes/home/datepicker.mjs: açıkken ArrowDown/ArrowRight durumu değiştirmedi (odak tetikleyicide kaldı). 'TAB STOPS through picker: 59' ('Sonraki ay', '11', '12', … '30', ardından misafir düğmesi). days.tabbable=57. Kod: 199-227 her gün ayrı <button> (roving tabindex yok), onKeyDown yok.

**Etki:** Klavye kullanıcısı Kasım sonundaki bir güne ulaşmak için 50'den fazla Tab basıyor. Motor engelli ve uzman kullanıcı için ciddi verim kaybı.

**Önerilen aksiyon:** Roving tabindex uygula (yalnız seçili/bugün/ilk etkin gün tabIndex=0). Ok tuşları gün/hafta, Home/End hafta başı/sonu, PageUp/PageDown ay değiştirsin. Ay sınırında otomatik sayfa çevirsin (APG Date Picker Dialog kalıbı).

**Yapılan düzeltme:** Roving tabindex was already in place: one tabIndex=0 day, with Arrow keys, Home/End and PageUp/PageDown in handleDayKeyDown, plus automatic month paging in moveFocusTo. I also changed Home/End to follow the locale's week start and made focus stop at the booking horizon.

## F518 — EN arayüzde yer adları Türkçe kalıyor: 'Türkiye', 'Kapadokya', 'ABD', 'Hollanda', 'Fransa', 'İtalya', 'İspanya', 'BAE'

| Alan                | Değer                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Severity            | Medium                                                                  |
| Durum               | Gözlemlendi                                                             |
| Konum               | `src/app/page.tsx:12`                                                   |
| Diğer konumlar      | `src/components/search/DestinationAutocomplete.tsx`, `src/app/page.tsx` |
| Kullanıcılar        | misafir                                                                 |
| Prensip             | learnability · Learnability / familiarity, consistency                  |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                             |
| Renk/tema           | Hayır                                                                   |
| Efor                | M                                                                       |
| Kaynak denetçiler   | runtime:home                                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p026)                                         |

**Kanıt:** RUNTIME tarama 116/117 (EN): başlıklar 'H3: Kapadokya', kartlarda 'Türkiye', 'New York, ABD', 'Amsterdam, Hollanda'. combobox2.mjs en: 'Popular destinations | İstanbulTürkiye | … | ParisFransa | Romaİtalya | Barselonaİspanya | DubaiBAE'. Kod: page.tsx:12-33 sabit TR dizisi, 90 location string'i olduğu gibi. DestinationAutocomplete.tsx:17-26 POPULAR_FALLBACK sabit TR.

**Etki:** EN kullanıcı 'ABD', 'BAE', 'Hollanda' ifadelerini tanımıyor. Dil seçimi tutarsız uygulanmış görünüyor ve İngilizce yer adıyla yazınca (bkz. Cappadocia) eşleşme de bulamıyor.

**Önerilen aksiyon:** Ülke adlarını Intl.DisplayNames(locale, {type:'region'}) ile ISO koddan üret (location.countryCode). Şehir adları için messages içinde {tr, en} eşlemesi kullan veya Location tablosuna nameEn ekle. Popüler destinasyonları ve fallback'i çeviri anahtarlarından besle.

**Yapılan düzeltme:** On the home page, place names are now localized. City names come from the new home.places.<key> messages (20 seeded cities, TR and EN). Country names come from Intl.DisplayNames using an ISO region code mapped from the Turkish DB name, so EN shows e.g. 'United States' and 'Netherlands'; in TR the DB name is kept. Both popular-destination cards and featured-card location strings use this. Search links still use the DB city name, so ?destination=Kapadokya keeps matching. DestinationAutocomplete belongs to its owner (see crossOwner).

## F519 — Görseller içerikle uyuşmuyor: Antalya'da futbol topu, Bodrum'da ormanda kütük ev (aynı foto Amsterdam Canal House'ta da), 'Cave' otellerde palmiyeli tatil köyü / oturma odası

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Gözlemlendi                               |
| Konum               | `src/app/page.tsx:21`                     |
| Diğer konumlar      | `prisma/seed.ts`                          |
| Kullanıcılar        | misafir                                   |
| Prensip             | learnability · Learnability / familiarity |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi               |
| Renk/tema           | Hayır                                     |
| Efor                | M                                         |
| Kaynak denetçiler   | runtime:home                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p026)    |

**Kanıt:** RUNTIME ekran görüntüleri: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/crops/home/000-anon-tr-desktop-_-0.png (Antalya kartında file içinde futbol topu, Bodrum kartında orman kulübesi) ve -1.png (Amsterdam Canal House'ta aynı orman kulübesi). links.mjs IMAGES: Bodrum destinasyonu ve Amsterdam Canal House aynı 'photo-1587061949409-02df41d5e562'. probes/home/after-deal.png: 'Kapadokya Sultan Cave Hotel' palmiyeli Akdeniz oteli gösteriyor. Kod: page.tsx:21 (Antalya), 31 (Bodrum). prisma/seed.ts:8-23 IMAGE_POOL ve 1120-1123 (mülke bakılmadan döngüyle atanıyor).

**Etki:** Görsel ipuçları yanıltıcı (deniz kenarı Bodrum için orman, 'mağara otel' için palmiye). Kullanıcı fotoğraflara güvenmiyor ve karar verme zorlaşıyor.

**Önerilen aksiyon:** Popüler destinasyonlar için şehri temsil eden yerel görseller kullan. Seed'de görselleri mülk türü ve şehirle eşleşen etiketli bir havuzdan seç ve aynı görselin farklı şehirlerde tekrarını engelle. Demo olduğu belirtilse bile alakasız görsel kullanma.

**Yapılan düzeltme:** The mismatched Antalya (football) and Bodrum (forest cabin) photos are removed. Those cards now show a neutral map-pin placeholder rather than a misleading picture. Featured cards no longer fall back to an unrelated stock hotel photo; they pass null, so PropertyCard shows its own 'no photo' placeholder. Not done: real verified local photos (Unsplash and Wikimedia are blocked from this sandbox, so I could not source or check any) and the seed IMAGE_POOL assignment, which is in prisma/seed.ts (see crossOwner).

## F520 — Popüler destinasyon 'Kapadokya' görseli kırık (404): alt metni ve gri degrade görünüyor

| Alan                | Değer                                   |
| ------------------- | --------------------------------------- |
| Severity            | Medium                                  |
| Durum               | Gözlemlendi                             |
| Konum               | `src/app/page.tsx:26`                   |
| Kullanıcılar        | misafir                                 |
| Prensip             | robustness · Robustness / observability |
| Sezgisel madde      | H8 — Estetik/minimal tasarım            |
| Renk/tema           | Hayır                                   |
| Efor                | S                                       |
| Kaynak denetçiler   | runtime:home                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p026)         |

**Kanıt:** RUNTIME probes/home/links.mjs: '404 /_next/image?url=https%3A%2F%2Fimages.unsplash.com%2Fphoto-1539776185620-1c12f6a4090f…'. IMAGES listesinde {alt:'Kapadokya', ok:false}. Taramada her ana sayfa ziyaretinde konsolda 'Failed to load resource … 404'. Ekran görüntüleri: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/crops/home/000-anon-tr-desktop-_-0.png (kırık resim simgesi + 'Kapadokya' alt metni) ve 001-anon-tr-mobile-_-1.png.

**Etki:** Ana sayfanın görünen ilk ekranında kırık görsel, ürünün bakımsız görünmesine yol açıyor. Kapadokya kartı diğerleriyle tutarsız.

**Önerilen aksiyon:** Çalışan bir Kapadokya görseli kullan, tercihen /public altında yerel bir dosya (dış CDN bağımlılığını kaldırır). Next Image için onError'da nötr bir yer tutucu göster. CI'da popüler destinasyon görsellerinin 200 döndüğünü doğrulayan bir smoke test ekle.

**Yapılan düzeltme:** The broken Kapadokya Unsplash URL (404) is removed, and the card now shows the neutral placeholder. Destination images render through the new client component DestinationCardImage. It swaps to the same placeholder in next/image onError, so any future failed image never shows a broken-image icon or alt text. A verified photo can be added later by setting imageUrl. A CI smoke test for image URLs was not added, since tests are out of scope.

## F521 — Widget tarih seçicisi seçili ay yerine bugünden açılıyor; yarım seçimde teklif sessizce kayboluyor

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Medium                                              |
| Durum               | Gözlemlendi                                         |
| Konum               | `src/components/search/DateRangePicker.tsx:66`      |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx`          |
| Kullanıcılar        | misafir                                             |
| Prensip             | learnability · Observability / Responsiveness (Dix) |
| Sezgisel madde      | H12 — Feedback                                      |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | runtime:pdp                                         |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p113)              |

**Kanıt:** RUNTIME p9-sync.mjs: seçili konaklama Ocak 2027 iken widget seçicisi Ekim 2026 + Kasım 2026 açılıyor (monthsOffset=0, satır 66/80-84). p2-widget.mjs: yalnız giriş günü seçilip seçici kapatılınca özet 'Tarih seçin', fiyat alanı boş, submit disabled=true; neden/ne yapılacağı yazmıyor (BookingWidget.tsx:129-132, useQuote key=null).

**Etki:** Kullanıcı kendi tarihini görmek için ay ileri tıklamak zorunda; yarım seçimde fiyatın neden kaybolduğunu ve CTA'nın neden pasif olduğunu anlamıyor.

**Önerilen aksiyon:** monthsOffset başlangıcını value.checkIn'in ayından hesaplayın. Yarım seçimde özet 'Giriş 20 Eki — çıkış tarihi seçin' göstersin, fiyat alanında 'Çıkış tarihini seçin' ipucu ve CTA altında neden pasif olduğu yazılsın; seçici kapatılırsa önceki tam aralığa geri dönün.

**Yapılan düzeltme:** The picker now opens at the month of value.checkIn instead of today: monthsOffset is initialised from checkIn and capped at the horizon. The widget-side parts (half-selection summary, price/CTA reason, going back to the previous full range on close) are in BookingWidget, which p060/F1006 owns; see crossOwner.

## F522 — Tarih alanı etiketi ('Giriş - Çıkış') düğmeye programatik olarak bağlı değil: erişilebilir ad 'Tarih seçin', seçimden sonra yalnız tarih aralığı

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Gözlemlendi                                       |
| Konum               | `src/components/search/SearchBar.tsx:84`          |
| Kullanıcılar        | misafir                                           |
| Prensip             | accessibility · Accessibility                     |
| Sezgisel madde      | H14 — Erişilebilirlik                             |
| WCAG                | 1.3.1 Info and Relationships, 2.5.3 Label in Name |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | runtime:home                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p115)                   |

**Kanıt:** RUNTIME probes/home/guests.mjs ariaSnapshot: 'text: Giriş - Çıkış' ve ayrı 'button "Tarih seçin"', 'text: Misafirler' ve ayrı 'button "2 misafir · 1 oda"'. datepicker.mjs: seçimden sonra düğme adı '14 Eki 2026 - 17 Eki 2026'. Kod: 84 ve 120 <span> etiketleri, 85-90 ve 121-126 düğmelerde aria-labelledby yok.

**Etki:** Ses komutu kullanıcısı 'Giriş Çıkış'a tıkla dediğinde hedef bulunamıyor. Ekran okuyucu tarih alanının ne için olduğunu yalnız düğme metninden tahmin ediyor.

**Önerilen aksiyon:** Span'lere id ver, düğmelere aria-labelledby='dates-label dates-value' ver (değer span'ine de id). Böylece ad 'Giriş - Çıkış 14 Eki 2026 - 17 Eki 2026' olur. Misafirler için de aynısını yap.

**Yapılan düzeltme:** The label and value spans now get useId ids. The date trigger uses aria-labelledby="<label> <value>" (name: 'Giriş - Çıkış Tarih seçin' / 'Giriş - Çıkış 14 Eki 2026 - 17 Eki 2026'), and the guests trigger does the same ('Misafirler 2 misafir'), so the visible label is part of the accessible name (2.5.3).

## F803 — Öne çıkanlar sorgusu Suspense dışında; veri gelene kadar hero ve arama formu da gönderilmiyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/app/page.tsx:10`                            |
| Diğer konumlar      | `src/app/page.tsx:36`, `src/app/page.tsx:81-107` |
| Kullanıcılar        | misafir                                          |
| Prensip             | robustness · responsiveness                      |
| Sezgisel madde      | H15 — Performans                                 |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:home                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p026)                  |

**Kanıt:** `export const dynamic = "force-dynamic";` (10) ve `const popular = await getPopularProperties(6);` (36) sayfa bileşeninin en başında bekleniyor. Ne `<Suspense>` ne de `loading.tsx` var. Redis önbelleği boşken Prisma sorgusu bitene kadar hero, h1 ve SearchBar dahil hiçbir şey gönderilmiyor.

**Etki:** Yavaş ağda ya da soğuk önbellekte misafir boş sayfa veya önceki sayfayı görüyor. Veri gerektirmeyen arama formu bile gecikiyor (algılanan hız düşüyor).

**Önerilen aksiyon:** Öne çıkanlar bölümünü `async function FeaturedSection()` alt bileşenine taşıyıp `<Suspense fallback={<FeaturedSkeleton />}>` ile sarın. İskelet 6 kart göstersin, `aria-busy="true"` taşısın ve sr-only bir `role="status"` ile 'Yükleniyor' desin. Hero ve SearchBar böylece akışla hemen gönderilir.

**Yapılan düzeltme:** Confirmed: the page awaited getPopularProperties before rendering anything. The featured section moved into an async FeaturedProperties component wrapped in <Suspense>. Its fallback, FeaturedSkeleton, shows 6 card placeholders with aria-busy="true" and an sr-only role="status" reading home.featuredLoading (new key), and the pulse runs only under motion-safe. The hero, h1, SearchBar, destinations and the featured h2 now stream immediately. The error and empty states are unchanged.

## F804 — Destinasyon kartında şehir ve ülke metni açık renkli görsellerde yetersiz kontrastta

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/app/page.tsx:74`                         |
| Diğer konumlar      | `src/app/page.tsx:71-73`                      |
| Kullanıcılar        | misafir                                       |
| Prensip             | accessibility · WCAG 1.4.3 Contrast (Minimum) |
| Sezgisel madde      | H14 — Erişilebilirlik                         |
| WCAG                | 1.4.3                                         |
| Renk/tema           | Evet — kapsam dışı                            |
| Efor                | S                                             |
| Kaynak denetçiler   | area:home                                     |
| **Düzeltme durumu** | **Kapsam dışı (renk/tema)**                   |

**Kanıt:** `<div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />` (71) katmanının üzerinde `<h3 className="text-lg font-semibold">` (73; 18px yarı kalın, 'büyük metin' sayılmaz) ve `<p className="text-sm text-white/80">` (74) var. Metin alt kenardan ~20-40px yukarıda; gradyan burada ≈%45-54 opak. Açık renkli görselde zemin ≈#757575-#8c8c8c oluyor; ülke metni ≈3.6:1 ve altına, şehir adı ≈3.3-4:1'e düşüyor (AA eşiği 4.5:1). Sorun görsele bağlı, koşullu.

**Etki:** Açık renkli fotoğraflarda (gökyüzü, deniz) az gören misafir şehir ve ülke adını okuyamıyor.

**Önerilen aksiyon:** Gradyanı `from-black/80 via-black/40` yapın ya da metin bloğuna `bg-black/60 rounded px-2` arka planı verin; `text-white/80` yerine `text-white` kullanın. Bunlar renk ve opaklık değişikliği gerektiriyor. Renk dışı ek önlem olarak `[text-shadow:0_1px_2px_rgb(0_0_0/0.8)]` okunabilirliği artırır ama oranı garanti etmez.

## F805 — Ana sayfa kartlarında favori durumu yüklenmiyor; kayıtlı ilan boş kalple görünüyor

| Alan                | Değer                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Severity            | Medium                                                                           |
| Durum               | Aday                                                                             |
| Konum               | `src/app/page.tsx:86`                                                            |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:45`, `src/app/search/page.tsx:507-533` |
| Kullanıcılar        | misafir                                                                          |
| Prensip             | robustness · observability                                                       |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                   |
| Renk/tema           | Hayır                                                                            |
| Efor                | S                                                                                |
| Kaynak denetçiler   | area:home                                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p026)                                                  |

**Kanıt:** PropertyCard çağrısında `initialFavorite` yok (86-99); bu yüzden PropertyCard.tsx:45'teki `initialFavorite = false` ve `useState(initialFavorite)` (63) devreye giriyor. Oturum açmış kullanıcının favorilediği ilanlar ana sayfada boş kalp ve `aria-pressed="false"` ile görünüyor. Arama sayfası da bu değeri geçirmiyor (search/page.tsx:507-533).

**Etki:** Misafir daha önce kaydettiği ilanı kaydedilmemiş sanıp yeniden basıyor; bir sonraki basışta ilanı favorilerden çıkarıyor. Sistem durumu yanlış yansıtılıyor.

**Önerilen aksiyon:** page.tsx'te oturum varsa favori ilan id'lerini `prisma.favorite.findMany({ where: { userId }, select: { propertyId: true } })` ile bir kümeye alın ve `initialFavorite={favIds.has(property.id)}` geçirin; oturum yoksa false kalsın.

**Yapılan düzeltme:** Partly real: PropertyCard already uses useFavoriteIds, but cards render as not-favorite until that client fetch finishes. The page now reads the session on the server with getAuth over headers() and cookies(), loads favorite propertyIds with prisma.favorite.findMany, and passes initialFavorite={favoriteIds.has(property.id)}. Without a session, or on any error, the set is empty (logged as a warning). The query runs in parallel with the popular-properties query.

## F806 — Öne çıkan kart rozetinde ham enum görünüyor ('BED_AND_BREAKFAST', 'HOTEL')

| Alan                | Değer                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                |
| Durum               | Aday                                                                                  |
| Konum               | `src/app/page.tsx:98`                                                                 |
| Diğer konumlar      | `src/app/search/page.tsx:112-125`, `src/components/property/PropertyCard.tsx:117-119` |
| Kullanıcılar        | misafir                                                                               |
| Prensip             | learnability · familiarity / consistency                                              |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                           |
| Renk/tema           | Hayır                                                                                 |
| Efor                | S                                                                                     |
| Kaynak denetçiler   | area:home                                                                             |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p026)                                                      |

**Kanıt:** `propertyType={property.propertyType}` (98) ham Prisma enum'unu geçiriyor ve PropertyCard.tsx:117-119 bunu rozet olarak gösteriyor. docs/img/home.png'deki kartlarda 'BED_AND_BREAKFAST' ve 'HOTEL' görünüyor. Arama sayfası aynı alanı `typeLabel()` ile çeviriyor (search/page.tsx:112-125, 519): TR 'Pansiyon', EN 'Guesthouse'.

**Etki:** Misafir alt çizgili, büyük harfli yazılımcı jargonuyla karşılaşıyor; TR kullanıcı 'BED_AND_BREAKFAST'ın 'Pansiyon' olduğunu çıkaramayabilir. Ana sayfa ile arama sayfası aynı ilanı farklı adla gösteriyor.

**Önerilen aksiyon:** `TYPE_KEYS` eşlemesini `src/lib/property-type.ts`'e taşıyıp export edin. page.tsx'te `const ts = await getTranslations("search")` ile `propertyType={TYPE_KEYS[property.propertyType] ? ts(`types.${TYPE_KEYS[property.propertyType]}`) : property.propertyType}` kullanın; search/page.tsx de aynı yardımcıyı kullansın.

**Yapılan düzeltme:** The issue no longer exists in the current code. page.tsx already passed typeLabel(property.propertyType), translated through search.types.*, and PropertyCard now translates raw enums itself. I removed the duplicated TYPE_KEYS map and used the shared propertyTypeKey helper from src/lib/i18n/property-type.ts.

## F807 — Ay ızgarasının başına önceki ayın gerçek günleri, aynı stil ve tıklanabilirlikle konuyor

| Alan                | Değer                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                 |
| Durum               | Aday                                                                                                   |
| Konum               | `src/components/search/DateRangePicker.tsx:38`                                                         |
| Diğer konumlar      | `src/components/search/DateRangePicker.tsx:199-226`, `src/components/property/PriceCalendar.tsx:64-70` |
| Kullanıcılar        | misafir                                                                                                |
| Prensip             | learnability · predictability / consistency                                                            |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                            |
| Renk/tema           | Hayır                                                                                                  |
| Efor                | S                                                                                                      |
| Kaynak denetçiler   | area:home                                                                                              |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p113)                                                                       |

**Kanıt:** `for (let i = 0; i < lead; i++) days.push(new Date(year, month, -lead + i + 1));` (38) baştaki boşlukları önceki ayın gerçek tarihleriyle dolduruyor. 199-226 bu hücreleri ay kontrolü yapmadan aynı stil ve tıklanabilirlikle çiziyor. İki aylık görünümde ör. 26-31 Ekim hem Ekim ızgarasının sonunda hem Kasım ızgarasının ilk satırında görünüyor ve aralık vurgusu iki yerde birden çıkıyor. PriceCalendar.tsx:64-70 aynı durumda `null` boş hücre kullanıyor.

**Etki:** Misafir Kasım ızgarasının ilk satırındaki '30'a dokununca 30 Ekim'i seçiyor. Aynı tarihin iki kez görünmesi ve aralığın iki ayda birden boyanması, giriş ve çıkış tarihlerini doğrulamayı zorlaştırıyor.

**Önerilen aksiyon:** `monthMatrix`'in dönüş tipini `(Date | null)[]` yapın, baştaki hücreleri `null` ile doldurun ve `<div aria-hidden="true" />` olarak çizin (PriceCalendar.weeksOf ile tutarlı).

**Yapılan düzeltme:** Same fix as F407, already in place: null leading cells drawn as an aria-hidden div, matching PriceCalendar.weeksOf. Adjacent months no longer show duplicate dates.

## F808 — Seçilen tarihleri temizlemenin yolu yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/search/DateRangePicker.tsx:121` |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:60-66`     |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · recoverability                     |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü               |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:home                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p113)                 |

**Kanıt:** Koddaki yorum: `// (day == checkIn ise hiçbir şey değişmez → kullanıcı girişi "silme" amacıyla tıklamış olabilir)` (121). Silme isteği tanınıyor ama karşılanmıyor. Ne bileşende ne SearchBar'da (60-66, 85-106) tarihleri temizleyen bir düğme var. Tarih bir kez seçildikten sonra tarihsiz aramaya dönmenin tek yolu sayfayı yenilemek.

**Etki:** Tarihi esnek olan ve önce fiyatlara bakmak isteyen misafir seçtiği tarihi kaldıramıyor; sonraki her aramada fiyatlar o tarihlere bağlı geliyor.

**Önerilen aksiyon:** Takvimin altına yalnızca tarih seçiliyken görünen `<button type="button" onClick={() => onChange({ checkIn: '', checkOut: '' })}>{t('picker.clear')}</button>` ekleyin (TR 'Tarihleri temizle', EN 'Clear dates'). SearchBar özetinde de tarih seçiliyken × düğmesi olsun (`aria-label={t('picker.clear')}`).

**Yapılan düzeltme:** Added a 'Tarihleri temizle' / 'Clear dates' text button (picker.clearDates) under the calendar, shown only while a check-in is set. It calls onChange({checkIn:'',checkOut:''}) and moves focus back into the day grid so focus is not lost. SearchBar's own × clear button already exists (p115).

## F809 — Takvim hangi adımda olunduğunu, gece sayısını ve aralık önizlemesini göstermiyor

| Alan                | Değer                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                           |
| Durum               | Aday                                                                                             |
| Konum               | `src/components/search/DateRangePicker.tsx:140`                                                  |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:60-66`, `src/components/search/DateRangePicker.tsx:103-106` |
| Kullanıcılar        | misafir                                                                                          |
| Prensip             | learnability · predictability (feedforward)                                                      |
| Sezgisel madde      | H13 — Feedforward                                                                                |
| Renk/tema           | Hayır                                                                                            |
| Efor                | S                                                                                                |
| Kaynak denetçiler   | area:home                                                                                        |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p113)                                                           |

**Kanıt:** Takvim başlığı (140-186) yalnızca ay adlarından ve ok düğmelerinden oluşuyor. 'Giriş seçin' / 'Çıkış seçin' gibi adım metni, seçilen gece sayısı ve fare ya da odakla aralık önizlemesi yok; `inRange` yalnızca kesinleşmiş checkOut ile çalışıyor (103-106). SearchBar özeti '12 Eki 2026 - 15 Eki 2026' (62) gece sayısını göstermiyor.

**Etki:** Düşük bilgisayar okuryazarlığına sahip misafir ikinci tıklamanın çıkış tarihi olacağını önceden bilemiyor ve kaç gece seçtiğini kendisi hesaplamak zorunda kalıyor. Bir gün fazla ya da eksik seçme riski artıyor.

**Önerilen aksiyon:** Takvim başlığının altına `<p aria-live="polite">` ekleyin: checkIn yoksa `t('picker.selectCheckIn')`, checkIn var ama checkOut yoksa `t('picker.selectCheckOut')`, ikisi de varsa `t('picker.nights', { count })` (EN ICU plural). `hovered` state'i ile `onMouseEnter`/`onFocus`'ta checkIn'den hovered'a kadar olan aralığı mevcut `bg-blue-100` sınıfıyla önizleyin. SearchBar özetine `· {n} gece` ekleyin.

**Yapılan düzeltme:** Added a visible step line under the month header: 'Giriş tarihini seçin', then 'Çıkış tarihini seçin · N gece' while previewing, then 'N gece · Değiştirmek için…'. While choosing check-out, hover or focus previews the range with the existing bg-blue-100 class. The sr-only live hint now includes the night count (picker.hintDone gained {nights}). The SearchBar summary night count goes to its owner (crossOwner).

## F810 — Takvim dolu ve kısıtlı günleri göstermiyor; min. konaklama veya satış kapalı bilgisi ancak seçimden sonra hata olarak geliyor

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | Medium                                                                         |
| Durum               | Aday                                                                           |
| Konum               | `src/components/search/DateRangePicker.tsx:200`                                |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:153`, `src/lib/pricing/quote.ts:367` |
| Kullanıcılar        | misafir                                                                        |
| Prensip             | robustness · task conformance                                                  |
| Sezgisel madde      | H5 — Hata önleme                                                               |
| Renk/tema           | Hayır                                                                          |
| Efor                | L                                                                              |
| Kaynak denetçiler   | area:widget                                                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p113)                                         |

**Kanıt:** DateRangePicker.tsx:200 `const disabled = d < today;`: yalnızca geçmiş günler devre dışı. Seçiciye müsaitlik verisi geçirilmiyor (BookingWidget.tsx:153-157). Hatalar sonradan geliyor: quote.ts:347 ve :369 `SoldOutError`, :367 `RestrictionError(describeViolation(...))`, restrictions.ts:58 `Bu tarihte en az ${v.minStay} gece konaklama gerekir`.

**Etki:** Misafir dolu veya kısıtlı tarihi seçip hata görüyor, sonra deneme yanılmayla başka tarih arıyor. Her deneme ek bir teklif turu ve bekleme demek.

**Önerilen aksiyon:** DateRangePicker'a `isDateDisabled?: (iso: string) => boolean` ve `dayNote?: (iso) => string` prop'ları ekle. BookingWidget, PriceCalendar'ın kullandığı müsaitlik uç noktasından seçili oda için günleri alıp dolu günleri `disabled` yapsın ve aria-label'a ", dolu" eklesin. Min. konaklama varsa pencere üstünde "Bu tarihlerde en az {n} gece" ipucu gösterilsin.

**Yapılan düzeltme:** Added the picker side: new optional props isDateDisabled(iso, phase: 'checkIn'\|'checkOut') and dayNote(iso). Unavailable days use aria-disabled so they stay focusable and keyboard navigation does not lose its Tab stop; they are drawn line-through and clicks are ignored. dayNote text is appended to the day's aria-label. The availability fetch and wiring in BookingWidget belong to its owner (crossOwner).

## F811 — Takvimde ok tuşu gezinmesi yok; iki ay ~60 Tab durağı demek

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Medium                                                      |
| Durum               | Aday                                                        |
| Konum               | `src/components/search/DateRangePicker.tsx:209`             |
| Kullanıcılar        | misafir                                                     |
| Prensip             | flexibility · substitutivity (alternatif girdi yolu, verim) |
| Sezgisel madde      | H7 — Esneklik/verim                                         |
| Renk/tema           | Hayır                                                       |
| Efor                | M                                                           |
| Kaynak denetçiler   | area:home                                                   |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p113)                            |

**Kanıt:** Her gün ayrı bir `<button>` (209-226); `tabIndex` yönetimi ve `onKeyDown` yok. İki ayda ~55-62 etkin gün ve önceki ay dolguları Tab sırasına giriyor. Ok tuşları, PageUp/PageDown ve Home/End desteklenmiyor.

**Etki:** Yalnız klavye kullanan misafir 30 gün sonrasını seçmek için onlarca kez Tab'a basıyor. Çıkış gününe ulaşmak yorucu ve hataya açık; atlanırsa Shift+Tab ile geri dönmek gerekiyor.

**Önerilen aksiyon:** Roving tabindex uygulayın: yalnızca tek gün `tabIndex={isFocusDay ? 0 : -1}` alsın (varsayılan seçili giriş günü ya da bugün). `onKeyDown`'da ←/→ ±1 gün, ↑/↓ ±7 gün, Home/End hafta başı/sonu, PageUp/PageDown ±1 ay (gerekirse `setMonthsOffset`), Enter/Space seçim. Odak değişince ilgili ref'e `focus()` verin.

**Yapılan düzeltme:** Same as F444: the day grid is already a single Tab stop with Arrow keys (±1 day / ±7 days), Home/End, PageUp/PageDown and native Enter/Space selection. Focus moves to the target day's ref via pendingFocus.

## F812 — API hatasında eski öneriler kalıyor ya da yanıltıcı 'Sonuç bulunamadı' gösteriliyor

| Alan                | Değer                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                            |
| Durum               | Aday                                                                                              |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:73`                                            |
| Diğer konumlar      | `src/components/search/DestinationAutocomplete.tsx:84-86`, `src/app/api/locations/route.ts:27-30` |
| Kullanıcılar        | misafir                                                                                           |
| Prensip             | robustness · observability                                                                        |
| Sezgisel madde      | H9 — Hata mesajları                                                                               |
| Renk/tema           | Hayır                                                                                             |
| Efor                | S                                                                                                 |
| Kaynak denetçiler   | area:home                                                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p114)                                                                   |

**Kanıt:** `if (cancelled || !res.ok) return;` (73): 500 yanıtında `options` güncellenmiyor ve önceki sorgunun önerileri 'Öneriler' başlığı altında kalıyor. Ağ hatasında ise `setOptions([])` (86) çalışıyor ve kullanıcı 'Sonuç bulunamadı' (160) görüyor; hata ile boş sonuç ayrılmıyor. route.ts:29 hata durumunda 500 ve `{ error: "Internal server error" }` döndürüyor.

**Etki:** Yavaş ya da kopuk ağda misafir aradığı şehrin sistemde olmadığını sanıyor ya da önceki sorgudan kalan ilgisiz bir şehri seçiyor. Serbest metinle yine de arama yapabileceğini bilmiyor.

**Önerilen aksiyon:** `const [failed, setFailed] = useState(false)` ekleyin. `!res.ok` ve `catch` dallarında `setOptions([]); setFailed(true)` yapın. `failed` iken listede `t('autocomplete.error')` gösterin (TR 'Öneriler yüklenemedi. Yazdığınızla yine de arayabilirsiniz.', EN karşılığı). `noResults` yalnızca başarılı ama boş yanıtta görünsün.

**Yapılan düzeltme:** API results are now stored together with the query they belong to; items: null means the request failed. A non-OK response, a non-array body or a network error shows the new autocomplete.error text ('Öneriler yüklenemedi. Yazdığınızla yine de arayabilirsiniz.') in both the visible list and the role=status region. noResults appears only after a successful response with nothing in it. A '“{q}” için ara' option is offered in both cases.

## F813 — Konum araması aksana ve Türkçe İ/ı'ya duyarlı: 'Cesme', 'Kusadasi', 'Mugla' bulunamıyor

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Medium                                                 |
| Durum               | Aday                                                   |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:80` |
| Diğer konumlar      | `src/app/api/locations/route.ts:16-17`                 |
| Kullanıcılar        | misafir                                                |
| Prensip             | flexibility · substitutivity                           |
| Sezgisel madde      | H5 — Hata önleme                                       |
| Renk/tema           | Hayır                                                  |
| Efor                | M                                                      |
| Kaynak denetçiler   | area:home                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p114)                 |

**Kanıt:** Sunucu tarafında route.ts:16-17 `city: { contains: q, mode: "insensitive" }` yalnızca büyük/küçük harfe duyarsız, aksana duyarsız değil. Seed şehirleri 'Çeşme', 'Kuşadası', 'Muğla', 'İzmir' (prisma/seed.ts:47-54); 'Cesme', 'Kusadasi', 'Mugla' sorguları eşleşmiyor. İstemcideki yedek eşleştirme `p.city.toLowerCase().includes(query.toLowerCase())` (80-81) de sorunlu: JS'de `"İstanbul".toLowerCase()` sonucu 'i̇stanbul' (U+0307 birleşik nokta) olduğu için 'istanbul' sorgusu eşleşmiyor.

**Etki:** Türkçe klavyesi olmayan misafir (EN dil kullanıcıları, yabancı telefon klavyeleri) ya da hızlı yazan TR kullanıcısı popüler destinasyonları bulamıyor ve 'Sonuç bulunamadı' görüyor.

**Önerilen aksiyon:** Ortak bir yardımcı yazın: `normalizePlace = (s) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ı/g, 'i')`. İstemci yedeğinde iki tarafı da bununla normalize edin. Sunucuda Location tablosuna normalize edilmiş bir `searchKey` sütunu ekleyin (seed ve yazımda doldurulsun) ve `searchKey: { contains: normalizePlace(q) }` ile arayın; ya da Postgres `unaccent` uzantısıyla raw sorgu kullanın.

**Yapılan düzeltme:** I added a shared helper, normalizePlace, in src/lib/search/normalize-place.ts (tr lowercase, NFD, combining marks stripped, ı→i). The client compares both sides with it, so 'Cesme', 'Kusadasi', 'Mugla' and 'istanbul' match popular entries. Matches for popular places are also added to the API results. Making the server search accent-insensitive in route.ts is assigned to its owner (see crossOwner).

## F814 — Arama, otel ya da bölge yazılabileceğini söylüyor ama API yalnızca şehir ve ülkede arıyor

| Alan                | Değer                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                             |
| Durum               | Aday                                                                                               |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:141`                                            |
| Diğer konumlar      | `src/app/api/locations/route.ts:13-20`, `messages/tr/search.json:67`, `messages/en/search.json:67` |
| Kullanıcılar        | misafir                                                                                            |
| Prensip             | learnability · predictability (feedforward)                                                        |
| Sezgisel madde      | H13 — Feedforward                                                                                  |
| Renk/tema           | Hayır                                                                                              |
| Efor                | M                                                                                                  |
| Kaynak denetçiler   | area:home                                                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p114)                                                                    |

**Kanıt:** `placeholder={t("autocomplete.placeholder")}` (141) TR'de 'Şehir, otel veya bölge' (messages/tr/search.json:67), EN'de 'City, hotel or region' (messages/en/search.json:67). Oysa src/app/api/locations/route.ts:13-20 yalnızca `city` ve `country` alanlarında `contains` ile arıyor. Bir otel adı ya da semt (ör. 'Galata', 'Sultanahmet') yazıldığında liste 'Sonuç bulunamadı' diyor.

**Etki:** Misafir otel adını yazıyor, 'Sonuç bulunamadı' görüp aramadan vazgeçiyor. Oysa formu gönderse arama motoru ilan başlığında eşleşme bulabilir. Yönlendirme metni sistemin gerçekte yapabildiğiyle çelişiyor.

**Önerilen aksiyon:** İki yoldan biri: (a) route'a `prisma.property.findMany({ where: { title: { contains: q, mode: 'insensitive' } }, take: 3 })` ekleyip sonuçları ayrı bir 'Konaklamalar' grubu olarak gösterin (seçilince `/property/{id}`). (b) Placeholder'ı 'Şehir veya ülke' / 'City or country' olarak düzeltin. Her iki durumda da boş sonuçta 'Sonuç bulunamadı' yerine `“{q}” için ara` seçeneği sunun (Enter formu göndersin).

**Yapılan düzeltme:** I kept the placeholder 'Şehir, otel veya bölge' because it is accurate: the destination is passed as the free-text query (src/lib/search/params.ts:107), which matches title, description, city and country (src/lib/search.ts:219-225). When there are no suggestions or loading fails, the listbox now shows a '“{q}” için ara' option (autocomplete.searchFor). Choosing it by click or Enter submits the form with requestSubmit. The empty text is now 'Eşleşen öneri yok' instead of the misleading 'Sonuç bulunamadı'.

## F815 — Form alanı kenarlıkları gray-300, sınır kontrastı ≈1.5:1

| Alan                | Değer                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                         |
| Durum               | Aday                                                                                                                           |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:142`                                                                        |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:89`, `src/components/search/SearchBar.tsx:125`, `src/components/search/SearchBar.tsx:155` |
| Kullanıcılar        | misafir                                                                                                                        |
| Prensip             | accessibility · WCAG 1.4.11 Non-text Contrast                                                                                  |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                          |
| WCAG                | 1.4.11                                                                                                                         |
| Renk/tema           | Evet — kapsam dışı                                                                                                             |
| Efor                | S                                                                                                                              |
| Kaynak denetçiler   | area:home                                                                                                                      |
| **Düzeltme durumu** | **Kapsam dışı (renk/tema)**                                                                                                    |

**Kanıt:** Alan sınırlarında `border border-gray-300` (#d1d5db, beyaz zeminde ≈1.5:1) kullanılıyor: 'Nereye?' input'u (142), tarih düğmesi (SearchBar.tsx:89), misafir düğmesi (125) ve stepper daireleri (155, 164, 180, 189, 202, 211). WCAG 1.4.11 bileşen sınırı için 3:1 istiyor. Placeholder ve ikon alanı kısmen tanımlasa da sınırın kendisi algılanmıyor.

**Etki:** Az gören ya da parlak ortamda telefon kullanan misafir giriş alanlarının ve '−/+' dairelerinin sınırlarını seçemiyor.

**Önerilen aksiyon:** Sınırları `border-gray-500` (≈4.8:1) ya da marka rengi yapın. Bu bir renk değişikliği gerektiriyor; kalınlığı artırmak (`border-2`) kontrast oranını değiştirmediği için tek başına yetmez.

## F816 — Öneri listesinin yapısı geçersiz: listbox içinde option olmayan li'ler var, aria-selected hep false

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Medium                                                      |
| Durum               | Aday                                                        |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:152`     |
| Diğer konumlar      | `src/components/search/DestinationAutocomplete.tsx:159-168` |
| Kullanıcılar        | misafir                                                     |
| Prensip             | accessibility · WCAG 1.3.1 / 4.1.2                          |
| Sezgisel madde      | H14 — Erişilebilirlik                                       |
| WCAG                | 1.3.1                                                       |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | area:home                                                   |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p114)                            |

**Kanıt:** `<ul role="listbox">` içinde option olmayan çocuklar var: başlık `<li className="... uppercase ...">` (152-158) ve `<li>{t("autocomplete.noResults")}</li>` (159-161). Seçenekler `<li><button role="option">` biçiminde (163-166); ul'nin rolü değiştiği için li'ler geçersiz listitem oluyor ve option ile listbox arasına aracı bir öğe giriyor. `aria-selected={false}` (167) sabit.

**Etki:** Ekran okuyucular öneri sayısını yanlış bildiriyor ('9 öğeden 1') ya da başlığı seçilebilir bir öğe gibi okuyor. axe 'aria-required-children' ve 'listitem' ihlalleri veriyor.

**Önerilen aksiyon:** Başlığı listbox dışına `<div id="destination-listbox-label">` olarak taşıyıp `<ul role="listbox" aria-labelledby="destination-listbox-label">` kullanın. 'Sonuç bulunamadı' satırını listbox dışında bir `role="status"` paragrafına çevirin. Listbox'ın doğrudan çocukları yalnızca `<li role="option">` olsun.

**Yapılan düzeltme:** Already fixed in the code before my changes. The heading was a <p id=destination-listbox-heading> outside the listbox, and the <ul role=listbox aria-labelledby> contained only <li role=option>. aria-selected was tied to activeIndex, and the 'no results' text was an aria-hidden <p> outside the listbox, announced through a separate role=status. My rewrite keeps this structure; the new search option is also an <li role=option>.

## F817 — Açılır panellerin kapanma davranışı tutarsız: diyaloglar Escape ile kapanıyor, tarih ve misafir panelleri ile mobil menü kapanmıyor

| Alan                | Değer                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                  |
| Durum               | Aday                                                                                                                                                                                                    |
| Konum               | `src/components/search/SearchBar.tsx:27`                                                                                                                                                                |
| Diğer konumlar      | `src/components/booking/BookingWidget.tsx:151-159`, `src/components/layout/Header.tsx:138-145`, `src/components/search/DestinationAutocomplete.tsx:42`, `src/components/account/ReauthDialog.tsx:44-48` |
| Kullanıcılar        | misafir                                                                                                                                                                                                 |
| Prensip             | robustness · consistency / user control                                                                                                                                                                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                                                       |
| WCAG                | 2.1.1                                                                                                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p115)                                                                                                                                                                         |

**Kanıt:** SearchBar.tsx:27-28 `const dateRef = useRef…; const guestsRef = useRef…` tanımlanmış ama hiçbir dış tıklama ya da Escape dinleyicisine bağlanmamış; paneller (:107-115, :143-218) yalnızca tetikleyiciyle kapanıyor. BookingWidget.tsx:151-159 takvim paneli ve Header.tsx:138-145 ile :173 mobil menü de aynı durumda. DestinationAutocomplete.tsx:42 dış tıklamada kapanıyor ama Escape'te kapanmıyor. ReauthDialog.tsx:44-48 ve StepUpDialog.tsx Escape ile kapanıyor.

**Etki:** Mobilde tarih panelini açan misafir arka plana dokunarak kapatamaz. Panel misafir sayacının üstünde açık kalır. Klavye kullanıcısı Escape'in bazı yerlerde çalışıp bazılarında çalışmadığını öğrenir.

**Önerilen aksiyon:** `usePopover(ref, open, setOpen)` adlı ortak bir kanca yazın: dış tıklama (mousedown ve touchstart), Escape ile kapatma ve kapanınca odağı tetikleyiciye geri verme. SearchBar'ın iki paneline, BookingWidget takvimine, Header mobil menüsüne ve DestinationAutocomplete'e uygulayın. Tetikleyicilere `aria-controls` ekleyin.

**Yapılan düzeltme:** Partly confirmed. In SearchBar, Escape, outside pointerdown (covers touch), focus return and aria-controls were already in place. DestinationAutocomplete already closes on Escape, and BookingWidget already closes on outside mousedown/focusin. I added focus-out closing to both SearchBar panels. The remaining inconsistency is the Header mobile menu (no Escape, no outside close), handed off in crossOwner.

## F818 — 'Ara'ya basınca bekleme geri bildirimi yok, loading.tsx da yok

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/search/SearchBar.tsx:47`      |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:222-227` |
| Kullanıcılar        | misafir                                       |
| Prensip             | robustness · responsiveness                   |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:home                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p115)               |

**Kanıt:** `router.push(`/search?${params.toString()}`);` (47) bekleme durumu tutulmadan çağrılıyor. Gönder düğmesinde (222-227) `disabled`, `aria-busy` ya da metin değişimi yok. src/app altında hiçbir `loading.tsx` bulunmuyor.

**Etki:** Yavaş mobil ağda misafir 'Ara'ya basıyor ve sayfa birkaç saniye değişmiyor. İşlemin başladığını göremiyor; tekrar basıyor ya da vazgeçiyor.

**Önerilen aksiyon:** `const [isPending, startTransition] = useTransition(); startTransition(() => router.push(...))` kullanın. Düğmeye `disabled={isPending} aria-busy={isPending}` verin ve metni `isPending ? t('bar.searching') : t('bar.submit')` yapın (TR 'Aranıyor…'). Ayrıca `src/app/search/loading.tsx` içinde kart iskeleti ekleyin.

**Yapılan düzeltme:** Confirmed. router.push now runs inside useTransition. While pending, the submit button gets aria-busy and aria-disabled (cursor-wait), its text changes to bar.searching ('Aranıyor…'), and a polite sr-only role=status announces it; handleSubmit returns early when isPending, which blocks a second submit, including Enter in the destination field. No color classes changed. A src/app/search/loading.tsx skeleton is optional and handed off in crossOwner (new route file outside my ownership).

## F819 — 'Giriş - Çıkış' ve 'Misafirler' etiketleri düğmelere bağlı değil; aria-haspopup ve aria-controls yok

| Alan                | Değer                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                      |
| Durum               | Aday                                                                                                                                        |
| Konum               | `src/components/search/SearchBar.tsx:84`                                                                                                    |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:120-125`, `src/components/search/SearchBar.tsx:107-108`, `src/components/search/SearchBar.tsx:143-144` |
| Kullanıcılar        | misafir                                                                                                                                     |
| Prensip             | accessibility · WCAG 1.3.1 Info and Relationships                                                                                           |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                       |
| WCAG                | 1.3.1                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                       |
| Efor                | S                                                                                                                                           |
| Kaynak denetçiler   | area:home                                                                                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p115)                                                                                                             |

**Kanıt:** `<span className="mb-1 block text-xs font-bold text-gray-600">{t("bar.dates")}</span>` (84) ve `<span ...>{t("bar.guests")}</span>` (120) görsel etiket ama düğmelere bağlı değil. Düğmelerin adı yalnızca içerikleri: 'Tarih seçin', '12 Eki 2026 - 15 Eki 2026' ya da '2 misafir · 1 oda'. Düğmelerde `aria-haspopup` ve `aria-controls` yok; açılan panellerin (108, 144) id'si, rolü ve etiketi yok.

**Etki:** Ekran okuyucu kullanan misafir tarih düğmesinde 'Giriş - Çıkış' bağlamını duymuyor ve hangi tarihin giriş hangisinin çıkış olduğunu kendisi çıkarmak zorunda kalıyor. Sesli komutla 'Giriş Çıkış'a tıkla' denemesi düğmeyi bulamıyor. Açılan panelin türü bildirilmiyor.

**Önerilen aksiyon:** Span'lara `id="search-dates-label"` ve `id="search-guests-label"`, özet span'larına `id="search-dates-value"` verin. Düğmelere `aria-labelledby="search-dates-label search-dates-value"`, `aria-haspopup="dialog"` ve `aria-controls="search-dates-panel"` ekleyin. Panel kapsayıcılarına `id="search-dates-panel" role="dialog" aria-labelledby="search-dates-label"` verin; misafir paneline de aynısını uygulayın.

**Yapılan düzeltme:** Confirmed for the guests part (the date trigger already had aria-haspopup and aria-controls). Both triggers now use aria-labelledby with label and value. The guests trigger got aria-haspopup="dialog". The guests panel got role="dialog" and aria-labelledby pointing to the 'Misafirler' label, and focus now moves to its first control when it opens (matching the date dialog). Escape and 'Tamam' still return focus to the trigger.

## F820 — Toplam misafir 40'a kadar seçilebiliyor ama arama API'si en fazla 30 kabul ediyor (400 hatası)

| Alan                | Değer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Severity            | Medium                                                                   |
| Durum               | Aday                                                                     |
| Konum               | `src/components/search/SearchBar.tsx:162`                                |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:187`, `src/lib/search/params.ts:37` |
| Kullanıcılar        | misafir                                                                  |
| Prensip             | robustness · task conformance (hata önleme)                              |
| Sezgisel madde      | H5 — Hata önleme                                                         |
| Renk/tema           | Hayır                                                                    |
| Efor                | S                                                                        |
| Kaynak denetçiler   | area:home                                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p116)                                          |

**Kanıt:** `setAdults(Math.min(30, adults + 1))` (162) ve `setChildren(Math.min(10, children + 1))` (187) birlikte `totalGuests`'i 40'a kadar çıkarabiliyor; değer `params.set("guests", String(totalGuests))` (46) ile gönderiliyor. Sunucu şeması `guests: optionalNumber(z.coerce.number().int().min(1).max(30))` (src/lib/search/params.ts:37), dolayısıyla /api/search 400 döndürüyor ve sonuç sayfası hata gösteriyor.

**Etki:** 30 kişiden kalabalık bir grup için arama yapan misafir, formun izin verdiği seçimle hata sayfasına düşüyor. Hatanın nedeni (üst sınır) hiçbir yerde söylenmiyor.

**Önerilen aksiyon:** Paylaşılan bir `MAX_GUESTS = 30` sabiti tanımlayın (params.ts'den export). Artır düğmelerine `disabled={adults + children >= MAX_GUESTS}` verin. Sınıra gelinince panelde `<p role="status">{t('bar.maxGuests', { max: 30 })}</p>` gösterin (TR 'En fazla 30 misafir seçebilirsiniz').

**Yapılan düzeltme:** Confirmed: 30 adults and 10 children could add up to 40 guests, but the search API accepts at most 30. I added a new shared constant MAX_SEARCH_GUESTS = 30. Each + button now stops at the combined limit (adults max = 30 - children, children max = min(10, 30 - adults)), and the initial children count is clamped the same way. At the limit, a visible role="status" note (bar.maxGuests, 'En fazla 30 misafir seçebilirsiniz.') appears in the panel, and the + buttons point to it with aria-describedby. params.ts still has a literal max(30); a crossOwner request asks its owner to use the constant.

## F1029 — Destinasyon kartı bağlantısında görsel alt metni başlığı tekrarlıyor ('İstanbul İstanbul Türkiye')

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Doğrulandı (2 kaynak birleşti)                |
| Konum               | `src/app/page.tsx:65`                         |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:97` |
| Kullanıcılar        | misafir                                       |
| Prensip             | accessibility · WCAG 1.1.1 Non-text Content   |
| Sezgisel madde      | H14 — Erişilebilirlik                         |
| WCAG                | 1.1.1                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | lens:a11y, area:home                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p026)               |

**Kanıt:** page.tsx:57-76 `<Link>` içinde `<Image alt={dest.city}>` + `<h3>{dest.city}</h3>` + `<p>{dest.country}</p>` → bağlantının erişilebilir adı 'İstanbul İstanbul Türkiye'. PropertyCard.tsx:97 `alt={title}` de hemen alttaki başlığı tekrarlıyor (görsel bağlantı değil, daha hafif).

**Etki:** Ekran okuyucu kullanan misafir her destinasyonu iki kez duyar; liste gezinmesi uzar.

**Önerilen aksiyon:** page.tsx:65'te `alt=""` verin (görsel bağlantı içinde dekoratif, ad h3/p'den geliyor). PropertyCard.tsx:97'de de başlık zaten metin olarak bulunduğundan `alt=""` ya da fotoğrafı anlatan kısa metin.

**Yapılan düzeltme:** The destination card image is now decorative (alt="" in DestinationCardImage), and the placeholder is aria-hidden. The link's accessible name comes only from the h3 and p, e.g. 'Istanbul Türkiye', with no repeated city name. The PropertyCard alt part belongs to its owner (see crossOwner).

## F1030 — Ana sayfa kartlarında ham konaklama türü enum'u ('BED_AND_BREAKFAST') gösteriliyor

| Alan                | Değer                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Severity            | Low                                                                                                          |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                               |
| Konum               | `src/app/page.tsx:98`                                                                                        |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:126`, `src/app/search/page.tsx:125`, `src/app/search/page.tsx:112` |
| Kullanıcılar        | misafir                                                                                                      |
| Prensip             | learnability · consistency / familiarity                                                                     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                  |
| Renk/tema           | Hayır                                                                                                        |
| Efor                | S                                                                                                            |
| Kaynak denetçiler   | lens:a11y, lens:copy, area:cards                                                                             |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p026)                                                                             |

**Kanıt:** page.tsx:98 `propertyType={property.propertyType}` ham değer; PropertyCard.tsx:125-127 rozet metni doğrudan basıyor. Arama sayfası search/page.tsx:125/519 `typeLabel(property.propertyType)` ile messages search.types.* üzerinden çeviriyor ('Otel', 'Pansiyon').

**Etki:** Misafir ana sayfada 'HOTEL', 'BED_AND_BREAKFAST' görür, aynı ilan arama sayfasında 'Otel' görünür; ekran okuyucu alt çizgili enum'u harf harf okuyabilir.

**Önerilen aksiyon:** search/page.tsx:125'teki TYPE_KEYS + typeLabel eşlemesini ortak bir yardımcıya (ör. src/lib/property-type.ts) taşıyın; page.tsx'te `getTranslations("search")` ile `propertyType={typeLabel(property.propertyType)}` geçin ya da çeviriyi PropertyCard içine alın.

**Yapılan düzeltme:** Same as F806: the home page already translated the property type through search.types.*, and PropertyCard also translates raw enums. The page now uses the shared propertyTypeKey helper instead of a local TYPE_KEYS copy.

## F1059 — Destinasyon alanında mobil klavye ipuçları eksik (type=search/enterKeyHint/autoCorrect)

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | Low                                                                                  |
| Durum               | Doğrulandı                                                                           |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:129`                              |
| Diğer konumlar      | `src/components/booking/CouponField.tsx:53`, `src/components/search/SmartFilter.tsx` |
| Kullanıcılar        | misafir                                                                              |
| Prensip             | learnability · predictability                                                        |
| Sezgisel madde      | H5 — Hata önleme                                                                     |
| Renk/tema           | Hayır                                                                                |
| Efor                | S                                                                                    |
| Kaynak denetçiler   | lens:mobile                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p114)                                               |

**Kanıt:** DestinationAutocomplete.tsx:127-134 `type="text" … autoComplete="off"`; `enterKeyHint`, `autoCorrect`, `spellCheck` yok. CouponField.tsx:53 büyük harf yalnız CSS `uppercase` ile; dosyada autoCapitalize/autoCorrect/spellCheck yok. SmartFilter.tsx'te enterKeyHint yok.

**Etki:** iOS otomatik düzeltmesi şehir adını ('Kapadokya') ya da kupon kodunu değiştirebilir; klavye eylem tuşu 'Ara' yerine 'Return' görünür.

**Önerilen aksiyon:** DestinationAutocomplete.tsx:127 input'a `enterKeyHint="search" autoCorrect="off" spellCheck={false} autoCapitalize="words"` ekleyin (type="text" kalabilir; combobox rolüyle type=search'ün temizleme düğmesi çakışabilir). CouponField.tsx input'a `autoCapitalize="characters" autoCorrect="off" spellCheck={false}`; SmartFilter girişine `enterKeyHint="search"`.

**Yapılan düzeltme:** The destination input now has enterKeyHint="search", autoCorrect="off", autoCapitalize="words" and spellCheck={false}, and keeps type=text. The CouponField and SmartFilter parts are files I don't own and are listed in crossOwner.

## F1120 — Mobilde 4 destinasyon kartı tek sütun 192px yükseklikle yaklaşık 800px kaydırma istiyor; EN mobilde 'See deal' iki satıra kırılıyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Low                                                          |
| Durum               | Gözlemlendi                                                  |
| Konum               | `src/app/page.tsx:55`                                        |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx`                   |
| Kullanıcılar        | misafir                                                      |
| Prensip             | flexibility · Flexibility / customizability; minimal tasarım |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                 |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | runtime:home                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p027)                       |

**Kanıt:** RUNTIME ekran görüntüleri: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/crops/home/001-anon-tr-mobile-_-1.png (İstanbul→Bodrum dört tam genişlik kart alt alta, ardından 'Öne çıkan'). 117-anon-en-mobile-_-2.png ('See / deal' iki satır). Kod: page.tsx:55 'grid-cols-1 sm:grid-cols-2'. PropertyCard.tsx:190-193 CTA'da whitespace-nowrap yok.

**Etki:** Mobil misafir öne çıkan konaklamalara ulaşmak için uzun kaydırma yapıyor. Kırılan CTA özensiz görünüyor.

**Önerilen aksiyon:** Mobilde grid-cols-2 ve h-32, ya da yatay kaydırmalı (snap-x) şerit kullan. CTA'ya whitespace-nowrap ekle ve fiyat bloğuna min-w-0 ver.

**Yapılan düzeltme:** The page.tsx part is done. Popular destinations are now 2 columns on mobile (grid-cols-2 gap-4 lg:grid-cols-4), and the image box is h-32, rising to sm:h-48, with matching `sizes`. The four cards now take two short rows instead of about 800px of scrolling. The 'See deal' CTA wrapping lives in PropertyCard.tsx, which I don't own and which no PropertyCard package covers; see crossOwner.

## F1121 — Popüler destinasyon bağlantılarının adı yinelemeli: 'İstanbul İstanbul Türkiye'

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | Low                             |
| Durum               | Gözlemlendi                     |
| Konum               | `src/app/page.tsx:65`           |
| Kullanıcılar        | misafir                         |
| Prensip             | accessibility · Accessibility   |
| Sezgisel madde      | H8 — Estetik/minimal tasarım    |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | runtime:home                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p027) |

**Kanıt:** RUNTIME probes/home/links.mjs ariaSnapshot: 'link "İstanbul İstanbul Türkiye"', 'link "Antalya Antalya Türkiye"', 'link "Kapadokya Kapadokya Türkiye"', 'link "Bodrum Bodrum Türkiye"' (img alt + h3 + p). Kod: 63-66 <Image alt={dest.city}> ve 73 <h3>{dest.city}</h3>.

**Etki:** Ekran okuyucu her kartta şehir adını iki kez okuyor ve bağlantının ne yaptığı ('… için konaklama ara') belirtilmiyor.

**Önerilen aksiyon:** Dekoratif görselde alt='' kullan. Bağlantıya aria-label='{city}, {country} — konaklamaları gör' ver ya da görünmez açıklama ekle.

**Yapılan düzeltme:** Destination images are decorative now: DestinationCardImage renders alt="" and an aria-hidden placeholder. The link's name comes from aria-label=t("home.destinationLinkLabel", {city, country}), e.g. 'İstanbul, Türkiye — konaklamaları gör' / 'Istanbul, Türkiye — see stays'. The city is no longer read twice, and the name says what the link does. The new key is in the p027 patch.

## F1122 — Tarih seçici yönlendirme vermiyor: gece sayısı yok, 'tarihleri temizle' yok, aynı güne ikinci tıklama sessizce yok sayılıyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Low                                                     |
| Durum               | Gözlemlendi                                             |
| Konum               | `src/components/search/DateRangePicker.tsx:121`         |
| Diğer konumlar      | `src/components/search/SearchBar.tsx`                   |
| Kullanıcılar        | misafir                                                 |
| Prensip             | robustness · Robustness / observability, recoverability |
| Sezgisel madde      | H12 — Feedback                                          |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | runtime:home                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p113)                         |

**Kanıt:** RUNTIME probes/home/datepicker.mjs: giriş seçilince yalnız düğme metni '14 Eki 2026 - çıkış?' oluyor. Panelde 'Çıkış tarihini seçin' ipucu yok. Aynı güne tekrar tıklayınca durum değişmiyor ve geri bildirim gelmiyor ('after same-day click' aynı). Tamamlanınca '14 Eki 2026 - 17 Eki 2026' gösteriliyor, '3 gece' bilgisi yok. 'clear dates button count: 0'. Kod: DateRangePicker.tsx:121 yorum ('hiçbir şey değişmez'). SearchBar.tsx:60-66 dateSummary'de gece sayısı yok.

**Etki:** Kullanıcı seçimin hangi aşamasında olduğunu ve kaç gece seçtiğini panelin içinde göremiyor. Seçimi geri almanın açık yolu yok.

**Önerilen aksiyon:** Panelin üstüne durum satırı ekle ('Giriş tarihini seçin' → 'Çıkış tarihini seçin' → '3 gece'), role=status ile. 'Tarihleri temizle' düğmesi koy. Aynı güne tıklamada 'En az 1 gece seçin' ipucunu göster.

**Yapılan düzeltme:** The picker now shows a visible status line (step, then night count), announced through the existing polite live region, and a 'Clear dates' button. Clicking the check-in day again while choosing check-out now shows and announces picker.minOneNight ('En az 1 gece seçin…') instead of doing nothing silently.

## F1123 — Yazarken eski öneriler 'Öneriler' başlığıyla duruyor; 1 karakterde filtresiz alfabetik liste geliyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Low                                                     |
| Durum               | Gözlemlendi                                             |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:62`  |
| Diğer konumlar      | `src/app/api/locations/route.ts`                        |
| Kullanıcılar        | misafir                                                 |
| Prensip             | robustness · Robustness / observability, responsiveness |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                          |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | runtime:home                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p114)                         |

**Kanıt:** RUNTIME probes/home/combobox2.mjs: 'Zzzyxq' yazıldıktan hemen sonra (yaklaşık 160ms) liste 'Öneriler | İstanbulTürkiye | AntalyaTürkiye | … | DubaiBAE' gösterdi, ilgisiz popüler şehirler öneri gibi sunuldu. API yanıtından sonra 'Sonuç bulunamadı' geldi. 'I' tek harfinde API tüm konumları döndü ve liste 'Alanya, Amsterdam, Ankara, Antalya, Barselona…' oldu (I ile ilgisiz). Kod: setLoading(true) yalnız 250ms debounce dolunca (69) çağrılıyor, options temizlenmiyor. Başlık seçimi 153-157. route.ts:13 'q.length >= 2' değilse filtre yok.

**Etki:** Kullanıcı kısa bir an yanlış öneriye dokunabiliyor. Liste, durum ile içerik arasında tutarsız sinyal veriyor.

**Önerilen aksiyon:** Değer değişir değişmez loading=true yap ve options'ı temizle (ya da soluk göster). Başlığı 'Aranıyor…' olarak göster. q.length<2 iken API çağırma, popüler listeyi 'Popüler destinasyonlar' başlığıyla göster.

**Yapılan düzeltme:** Old results are never shown for a new query. If the stored result belongs to a different query, the list is empty and the heading reads 'Aranıyor…' (autocomplete.searching) until the matching response arrives. This is derived during render, so there is no setState inside an effect. Queries shorter than 2 characters no longer call the API and show prefix-filtered popular places under 'Popüler destinasyonlar'.

## F1282 — Destinasyon kartları SearchBar'da seçilen tarih ve kişi sayısını taşımıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/app/page.tsx:59`                            |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:56-64` |
| Kullanıcılar        | misafir                                          |
| Prensip             | flexibility · task migratability                 |
| Sezgisel madde      | H7 — Esneklik/verim                              |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:home                                        |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p027)           |

**Kanıt:** `href={`/search?destination=${encodeURIComponent(dest.city)}`}` (59) sunucuda sabit üretiliyor; üstteki SearchBar'da seçilmiş tarih ve misafir sayısı (istemci state'i) bu bağlantıya eklenmiyor. Öne çıkan kartlar da `/property/${id}`'ye tarihsiz gidiyor (PropertyCard.tsx:56-64, `stay` verilmiyor).

**Etki:** Önce tarih ve kişi sayısını seçip ardından 'Antalya' kartına tıklayan misafirin seçimleri kayboluyor; sonuçlar tarihsiz ve gecelik fiyatla açılıyor.

**Önerilen aksiyon:** Seçili arama ölçütlerini bir `SearchContext` (ya da sessionStorage) ile paylaşın. Destinasyon kartlarını küçük bir istemci bileşenine çevirip `href`'e `checkIn`, `checkOut`, `guests` ekleyin. Alternatif: karta tıklanınca SearchBar'ın 'Nereye?' alanını doldurup tarih düğmesine odaklanın.

**Yapılan düzeltme:** Confirmed: links were built on the server with only the destination. page.tsx now renders client wrappers that read a shared store (src/components/search/useSearchDraft.ts). HomeDestinationLink adds checkIn, checkOut, guests, adults and children to /search, and HomeFeaturedCard passes the same values as PropertyCard searchContext. This has no effect yet: nothing calls publishSearchDraft, because SearchBar.tsx (not mine) never publishes its state. See crossOwner.

## F1283 — Destinasyon görselleri yüklenemezse yer tutucu ya da yedek görsel yok

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Low                                    |
| Durum               | Aday                                   |
| Konum               | `src/app/page.tsx:63`                  |
| Diğer konumlar      | `src/app/page.tsx:16-31`               |
| Kullanıcılar        | misafir                                |
| Prensip             | robustness · observability             |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü         |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | area:home                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p027) |

**Kanıt:** Destinasyon görselleri dış kaynaktan (`https://images.unsplash.com/...`, 16-31) yükleniyor; `<Image ... fill>` (63-69) için `placeholder`, `onError` yedeği ya da kapsayıcı arka planı yok. docs/img/home.png'de dört kartın da görseli yüklenmemiş; yalnızca gradyan ve metin içeren gri-beyaz boş kutular görünüyor. PWA çevrimdışı modunda da durum aynı.

**Etki:** Misafir destinasyonları görselden tanıyamıyor; kartlar bozuk ya da eksik görünüyor.

**Önerilen aksiyon:** Görselleri `public/images/destinations/{slug}.jpg` altına alıp yerelden sunun (CSP ve çevrimdışı modla uyumlu). `placeholder="blur"` ve `blurDataURL` verin; bir istemci sarmalayıcıda `onError` ile yerel yedeğe geçin.

**Yapılan düzeltme:** Confirmed. Destination images render through DestinationCardImage, which switches to a neutral map-pin placeholder when there is no src or next/image fires onError (offline or broken URL). The image box in page.tsx now has bg-gray-100, the shade the placeholder already uses, so it is no longer an empty white box while loading. Not done: verified local photos under public/ plus blurDataURL, because no verified destination photos could be sourced. Antalya, Kapadokya and Bodrum use the placeholder (imageUrl null).

## F1284 — 'Öne çıkan' listenin neye göre seçildiği açıklanmıyor

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | Low                             |
| Durum               | Aday                            |
| Konum               | `src/app/page.tsx:82`           |
| Diğer konumlar      | `src/lib/search.ts:813`         |
| Kullanıcılar        | misafir                         |
| Prensip             | learnability · synthesizability |
| Sezgisel madde      | H10 — Yardım/dokümantasyon      |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | area:home                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p027) |

**Kanıt:** 'Öne çıkan konaklama yerleri' başlığının (`<h2>{t("featured")}</h2>`, 82) altında seçim ölçütü belirtilmiyor. Gerçekte liste `orderBy: [{ ratingAvg: "desc" }, { ratingCount: "desc" }, ...]` (src/lib/search.ts:813) ile salt puana göre sıralanıyor. Projede bir sıralama şeffaflığı sayfası var (src/app/ranking/page.tsx) ama ana sayfadan ona bağlantı yok.

**Etki:** Misafir 'öne çıkan' ifadesini ücretli tanıtım sanabiliyor ve sıralamanın nasıl yapıldığını öğrenemiyor (güven kaybı).

**Önerilen aksiyon:** Başlığın altına `<p className="text-sm text-gray-600">{t('featuredHint')}</p>` (TR 'Misafir puanına göre sıralanmıştır', EN 'Sorted by guest rating') ve `<Link href="/ranking">{t('howRanking')}</Link>` ekleyin.

**Yapılan düzeltme:** Confirmed: getPopularProperties sorts only by ratingAvg/ratingCount (src/lib/search.ts:821). A line under the 'Öne çıkan' heading now reads t("home.featuredHint"): 'En yüksek misafir puanına göre sıralanır; ücretli yerleşim bu listeyi etkilemez.' The 'no paid placement' part matches what the /ranking page already says. It is followed by a /ranking link using the existing footer.ranking label ('Sıralama nasıl çalışır?').

## F1285 — Boş durum ('Henüz konaklama ilanı yok') bir sonraki adımı göstermiyor

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | Low                             |
| Durum               | Aday                            |
| Konum               | `src/app/page.tsx:104`          |
| Kullanıcılar        | misafir, ev sahibi              |
| Prensip             | flexibility · dialog initiative |
| Sezgisel madde      | H13 — Feedforward               |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | area:home                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p027) |

**Kanıt:** `<p className="text-gray-500">{t("empty")}</p>` (104) 'Henüz konaklama ilanı yok.' diyor; kutuda (103-105) ne bağlantı ne eylem var.

**Etki:** İlan yokken misafir ne yapacağını bilemiyor; ev sahibi ilan oluşturma yoluna yönlendirilmiyor.

**Önerilen aksiyon:** Boş durum kutusuna `<Link href="/search">{t('browseAll')}</Link>` ve `<Link href="/host">{t('becomeHost')}</Link>` ekleyin.

**Yapılan düzeltme:** Confirmed. The empty state now has a 44px link to /search (home.emptySearch, 'Konaklama ara'). HOST and ADMIN viewers also get a /host link (home.emptyCreateListing, 'İlan oluştur'), using the role read on the server. Guests don't get the host link because the app has no self-service way to become a host. I corrected the comment, which wrongly mentioned price alerts.

## F1286 — EN (en-US) için de hafta Pazartesi'den başlıyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Low                                                                           |
| Durum               | Aday                                                                          |
| Konum               | `src/components/search/DateRangePicker.tsx:36`                                |
| Diğer konumlar      | `src/components/search/DateRangePicker.tsx:73-77`, `src/lib/i18n/format.ts:8` |
| Kullanıcılar        | misafir                                                                       |
| Prensip             | learnability · familiarity                                                    |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                   |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | area:home                                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p113)                                               |

**Kanıt:** `const lead = (first.getDay() + 6) % 7; // Pazartesi=0` (36) ve hafta günü adları `new Date(2024, 0, 1 + i)` ile Pazartesi'den başlatılıyor (73-77). EN dili `en-US`'e eşleniyor (src/lib/i18n/format.ts `INTL_LOCALE = { tr: "tr-TR", en: "en-US" }`); ABD takvim alışkanlığı ise Pazar başlangıçlı.

**Etki:** EN kullanan, ABD alışkanlıklı misafir haftanın gününü yanlış sütunda arıyor; hafta sonu tarihlerini seçerken bir gün kayma riski oluşuyor.

**Önerilen aksiyon:** Haftanın ilk gününü dile göre belirleyin: `const firstDay = (new Intl.Locale(f.locale) as any).getWeekInfo?.().firstDay ?? (f.locale === 'en-US' ? 7 : 1)`; `monthMatrix` ve `weekdays` hesaplarına `firstDay` parametresi verin. Pazartesi bilinçli bir seçimse EN'i `en-GB`'ye eşleyip bunu belgeleyin.

**Yapılan düzeltme:** Added a new helper, src/lib/i18n/week-start.ts firstDayOfWeek(locale). It uses Intl.Locale getWeekInfo/weekInfo and falls back to Sunday for en-US and Monday otherwise. monthMatrix leading cells, the weekday header and Home/End now use this week start, so EN (en-US) weeks start on Sunday and TR weeks stay on Monday. PriceCalendar consistency is a crossOwner item.

## F1287 — Takvim, gezinmede rezervasyon ufkunu (365 gün) aşıyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/search/DateRangePicker.tsx:128` |
| Diğer konumlar      | `src/lib/booking/availability-rollover.ts:16`   |
| Kullanıcılar        | misafir                                         |
| Prensip             | robustness · task conformance (hata önleme)     |
| Sezgisel madde      | H5 — Hata önleme                                |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:home                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p113)                 |

**Kanıt:** `const goNext = () => { setMonthsOffset(monthsOffset + 1); };` (128-130) üst sınırsız; `disabled` yalnızca geçmiş günlere uygulanıyor (200). Envanter ufku `horizonDays = 365` (src/lib/booking/availability-rollover.ts:16).

**Etki:** Misafir 1-2 yıl sonrasına tarih seçip arıyor; sonuç boş ya da müsait değil çıkıyor ve 'Filtreleri değiştirmeyi deneyin' mesajı nedeni açıklamıyor.

**Önerilen aksiyon:** DateRangePicker'a varsayılanı bugün+365 olan bir `maxDate` prop'u ekleyin. Son görünür ay `maxDate`'in ayına ulaşınca `goNext` düğmesini `disabled` yapın. `d > maxDate` olan günleri devre dışı bırakıp `aria-label`'larına `t('picker.notBookable')` ekleyin.

**Yapılan düzeltme:** Added an optional maxDate prop, defaulting to today + 365 (the inventory horizon). The offset is capped so the last visible month is the horizon month, and 'Sonraki ay' is aria-disabled there. 'Önceki ay' was changed to aria-disabled as well, so focus is not lost at either end. Days after maxDate are disabled, get ', henüz rezervasyona açık değil' (picker.notBookable) in their aria-label, and keyboard focus stops at maxDate.

## F1288 — İki farklı 'Popüler destinasyonlar' listesi farklı içerik ve sırayla gösteriliyor

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Low                                                    |
| Durum               | Aday                                                   |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:17` |
| Diğer konumlar      | `src/app/page.tsx:12-33`                               |
| Kullanıcılar        | misafir                                                |
| Prensip             | learnability · consistency                             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                            |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:home                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p114)                 |

**Kanıt:** Ana sayfa kartları 4 şehir gösteriyor (page.tsx:12-33: İstanbul, Antalya, Kapadokya, Bodrum). Öneri listesi ise 8 şehir gösteriyor (DestinationAutocomplete.tsx:17-26: Kapadokya 4. sırada, ayrıca Paris, Roma, Barselona, Dubai). Aynı başlık (`home.popularDestinations` ve `search.autocomplete.popular`) farklı içerik ve sırayla kullanılıyor.

**Etki:** Misafir aynı başlık altında iki farklı liste görüyor. Veri güncellemesinin iki yerde yapılması gerektiği için tutarsızlık riski de var.

**Önerilen aksiyon:** Tek bir kaynak oluşturun: `src/lib/popular-destinations.ts` (slug, ISO ülke kodu, görsel yolu, sıra). page.tsx ilk 4'ünü, DestinationAutocomplete tamamını buradan okusun; mümkünse liste ilan sayısına göre sunucudan gelsin.

**Yapılan düzeltme:** I created one shared source, src/lib/popular-destinations.ts, with POPULAR_DESTINATIONS (city, country, imageUrl; home page order first: İstanbul, Antalya, Kapadokya, Bodrum, then Paris, Roma, Barselona, Dubai) and HOME_POPULAR_COUNT = 4. The autocomplete now reads the full list from it. Moving page.tsx onto it is a crossOwner item.

## F1289 — 1 karakterlik sorguda filtresiz 20 konum 'Öneriler' başlığıyla geliyor

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Low                                                    |
| Durum               | Aday                                                   |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:70` |
| Diğer konumlar      | `src/app/api/locations/route.ts:13-20`                 |
| Kullanıcılar        | misafir                                                |
| Prensip             | learnability · predictability                          |
| Sezgisel madde      | H12 — Feedback                                         |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:home                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p114)                        |

**Kanıt:** İstemci 1 karakterde de istek atıyor; `query.length === 0` dışında bir sınır yok (64-72). route.ts:13-20'deki `q.length >= 2 ? { OR: [...] } : undefined` 1 karakterde filtre uygulamıyor ve alfabetik ilk 20 konumu döndürüyor; istemci `data.slice(0, 8)` ile bunları 'Öneriler' başlığı altında gösteriyor. Ör. 'z' yazılınca Alanya, Amsterdam, Ankara, Antalya... listeleniyor.

**Etki:** Misafir yazdığı harfle ilgisi olmayan öneriler görüyor ve sistemin yazdığını dikkate almadığını düşünüyor.

**Önerilen aksiyon:** İstemcide `query.length < 2` iken API'yi çağırmayın; `POPULAR_FALLBACK`'i normalize edilmiş önek eşleşmesiyle (`startsWith`) süzün. Alternatif: route'ta `q.length === 1` için `city: { startsWith: q, mode: 'insensitive' }` kullanın.

**Yapılan düzeltme:** The client calls /api/locations only when the query has at least 2 characters (MIN_REMOTE_QUERY). For a single character it filters POPULAR_DESTINATIONS with a normalized startsWith on the database name, the translated city and the translated country, so typing 'z' no longer lists Alanya, Amsterdam and so on.

## F1290 — Nereye? alanında mobil klavye ipuçları ve temizle düğmesi eksik

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Low                                                     |
| Durum               | Aday                                                    |
| Konum               | `src/components/search/DestinationAutocomplete.tsx:129` |
| Kullanıcılar        | misafir                                                 |
| Prensip             | robustness · task conformance (mobil giriş)             |
| Sezgisel madde      | H7 — Esneklik/verim                                     |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:home                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p114)                         |

**Kanıt:** Input yalnızca `type="text"` ve `autoComplete="off"` taşıyor (129, 134). `enterKeyHint`, `spellCheck`, `autoCorrect` ve `autoCapitalize` yok; yazılmış değeri temizleyen bir düğme de yok.

**Etki:** Mobil misafirin klavyesinde Enter tuşu 'Ara' yerine 'Git/↵' olarak görünüyor. iOS otomatik düzeltmesi 'Kapadokya', 'Kuşadası' gibi adları değiştirebiliyor. Değeri silmek için uzun basmak gerekiyor.

**Önerilen aksiyon:** `enterKeyHint="search" spellCheck={false} autoCorrect="off" autoCapitalize="words"` ekleyin. Değer doluyken input'un sağına `<button type="button" aria-label={t('autocomplete.clear')} onClick={() => { onChange(''); inputRef.current?.focus(); }}>×</button>` koyun.

**Yapılan düzeltme:** Added the mobile keyboard hints (enterKeyHint=search, spellCheck=false, autoCorrect=off, autoCapitalize=words). Added a 32x32 clear button (aria-label autocomplete.clear 'Varış yerini temizle', with focusRing) that appears when the field has a value. It clears the value, keeps focus in the input and reopens the popular list. Input right padding went from pr-3 to pr-10 to make room for it.

## F1291 — Çocuklar yetişkinlerle toplanıyor; çocuk sayısı özette ve URL'de kayboluyor, yaş sorulmuyor

| Alan                | Değer                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Severity            | Low                                                                     |
| Durum               | Aday                                                                    |
| Konum               | `src/components/search/SearchBar.tsx:30`                                |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:141`, `messages/tr/search.json:56` |
| Kullanıcılar        | misafir                                                                 |
| Prensip             | robustness · task conformance                                           |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                             |
| Renk/tema           | Hayır                                                                   |
| Efor                | M                                                                       |
| Kaynak denetçiler   | area:home                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p116)                                         |

**Kanıt:** `const totalGuests = adults + children;` (30): çocuklar yetişkinlerle toplanıp tek bir `guests` parametresine gidiyor (46). Özet yalnızca '{guests} misafir' (141) diyor. Çocuk yaşı sorulmuyor (172-193); oysa '0-12 yaş' ipucu (messages/tr/search.json:56) yaşın fiyatı etkileyebileceğini ima ediyor.

**Etki:** Çocuklu aile, çocuk sayısı ve yaşlarının sonuçlara ve fiyata yansıdığını varsayıyor. Sonuçlar yetişkin varsayımıyla hesaplanıyor ve özet çocuk bilgisini gizliyor.

**Önerilen aksiyon:** Özeti '{adults} yetişkin · {children} çocuk · {rooms} oda' biçimine çevirin (yeni ICU anahtarı). `children > 0` iken her çocuk için `<select aria-label="{n}. çocuğun yaşı">` (0-17) gösterin ve URL'ye `adults`, `children`, `childAges` ekleyin. Arama motoru bunu desteklemeyecekse ipucunu 'Çocuklar (fiyat yetişkinle aynı hesaplanır)' gibi netleştirin.

**Yapılan düzeltme:** The guest button now shows adults and children separately: '2 yetişkin · 1 çocuk' ('2 adults · 1 child'), using bar.guestsSummary rewritten with {adults}/{children} ICU plurals. That key was unused and still mentioned rooms. The URL already carried adults and children. The search engine only uses the guest total as a maxOccupancy filter and has no child pricing in the schema, so I did not add child-age selects. Instead the children row hint now says age does not affect the price (new key bar.childrenHintPricing).

## F1292 — Arama formu landmark olarak işaretli değil (role="search" yok)

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/components/search/SearchBar.tsx:69`     |
| Kullanıcılar        | misafir                                      |
| Prensip             | accessibility · WCAG 1.3.1 (ARIA11 landmark) |
| Sezgisel madde      | H14 — Erişilebilirlik                        |
| WCAG                | 1.3.1                                        |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:home                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p116)              |

**Kanıt:** `<form onSubmit={handleSubmit} className="w-full rounded-xl bg-white p-3 shadow-xl ring-1 ring-black/5">` (69-72) `role="search"` ya da `aria-label` taşımıyor; ana sayfanın birincil görev formu landmark olarak gezilemiyor.

**Etki:** Ekran okuyucu kullanan misafir landmark listesinde arama bölgesini bulamıyor; başlıklar arasında gezinerek aramak zorunda kalıyor.

**Önerilen aksiyon:** `<form role="search" aria-label={t('bar.formLabel')} ...>` kullanın (TR 'Konaklama ara', EN 'Search stays').

**Yapılan düzeltme:** Confirmed the form had no landmark. It now has role="search" and aria-label={t("bar.formLabel")} ('Konaklama ara' / 'Search stays').

## F1293 — Sayaçlar sınırda pasifleşmiyor; tıklama sessizce etkisiz kalıyor

| Alan                | Değer                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                                                  |
| Konum               | `src/components/search/SearchBar.tsx:153`                                                                                                                                                                             |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:162`, `src/components/search/SearchBar.tsx:178`, `src/components/search/SearchBar.tsx:187`, `src/components/search/SearchBar.tsx:200`, `src/components/search/SearchBar.tsx:209` |
| Kullanıcılar        | misafir                                                                                                                                                                                                               |
| Prensip             | learnability · predictability (affordance)                                                                                                                                                                            |
| Sezgisel madde      | H11 — Affordance                                                                                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                                                                                 |
| Efor                | S                                                                                                                                                                                                                     |
| Kaynak denetçiler   | area:home                                                                                                                                                                                                             |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p116)                                                                                                                                                                                      |

**Kanıt:** `onClick={() => setAdults(Math.max(1, adults - 1))}` (153), `Math.max(0, children - 1)` (178), `Math.max(1, roomsCount - 1)` (200) ve üst sınırlarda `Math.min(30/10/30, ...)` (162, 187, 209). Sınırda tıklama hiçbir şey yapmıyor; düğmelerde `disabled` yok ve görünümleri değişmiyor.

**Etki:** Misafir 1 yetişkindeyken 'Azalt'a basıyor, hiçbir şey olmuyor ve düğmenin neden çalışmadığını anlamıyor.

**Önerilen aksiyon:** Alt sınırlar için `disabled={adults <= 1}`, `disabled={children <= 0}`, `disabled={roomsCount <= 1}`, üst sınırlar için `disabled={value >= max}` ekleyin. Sınıflara mevcut paletle `disabled:cursor-not-allowed disabled:opacity-40` verin.

**Yapılan düzeltme:** Already fixed in the current code. CounterRow sets aria-disabled on the - and + buttons when the value reaches min or max and ignores the click. counterButtonClass styles that state with 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50'. aria-disabled is used on purpose instead of disabled so focus stays on the button. The new combined limit uses the same mechanism.
