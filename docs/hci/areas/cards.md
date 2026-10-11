# İlan kartı, harita, karşılaştırma — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 88 bulgu · Severity: High 18, Medium 54, Low 16

## F61 — Favori (kalp) düğmesi oturum açmamış kullanıcıda sessizce başarısız oluyor

| Alan                | Değer                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                         |
| Durum               | Gözlemlendi (5 kaynak birleşti)                                                                                                                                              |
| Konum               | `src/components/property/PropertyCard.tsx:84`                                                                                                                                |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:65`, `src/components/cart/AddToCartButton.tsx:57-61`, `src/app/search/page.tsx:507`, `src/components/property/PropertyCard.tsx:70` |
| Kullanıcılar        | misafir                                                                                                                                                                      |
| Prensip             | robustness · Gözlemlenebilirlik: hata görünmüyor                                                                                                                             |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                                                        |
| Efor                | S                                                                                                                                                                            |
| Kaynak denetçiler   | runtime:results, area:cards, lens:forms, area:results, lens:nav                                                                                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: cards)                                                                                                                                                |

**Kanıt:** RUNTIME p7-misc.mjs (anon, desktop TR): "Favorilere ekle" düğmesinde Enter'a basınca POST /api/favorites 401 dönüyor. URL değişmiyor, aria-pressed="false" kalıyor ve hiçbir alert ya da status mesajı çıkmıyor. KOD: res.ok false olunca throw new Error("Favori eklenemedi") atılıyor, catch bloğu ise err.message.includes("401") kontrol ediyor. Bu koşul hiçbir zaman doğru olmadığı için /login yönlendirmesi asla çalışmıyor.

**Etki:** Misafir favori ekleyemiyor ve nedenini öğrenemiyor; düğmenin bozuk olduğunu düşünüyor.

**Önerilen aksiyon:** res.status === 401 durumunda router.push(`/login?next=${encodeURIComponent(location.pathname + location.search)}`) çağırın ya da role="status" içinde "Favorilere eklemek için giriş yapın" mesajı ve bağlantısı gösterin. Diğer hatalarda görünür bir hata mesajı verin.

**Yapılan düzeltme:** PropertyCard.tsx toggleFavorite now uses apiFetch, which also retries once after a session refresh. On ApiError.status===401 it calls router.push(loginHref()), with a redirect back to the current page. Other failures show a visible role=status message (card.favoriteAddFailed / favoriteRemoveFailed). On success an sr-only status reads favoriteAdded/Removed. The hardcoded Turkish Error strings are gone. Heart button: aria-busy, min 44x44 touch target. — dosyalar: `src/components/property/PropertyCard.tsx`

## F89 — CompareBar odaklanan öğeleri ve sayfa sonunu örtüyor; altında boşluk bırakılmamış

| Alan                | Değer                                                    |
| ------------------- | -------------------------------------------------------- |
| Severity            | High                                                     |
| Durum               | Gözlemlendi                                              |
| Konum               | `src/components/compare/CompareBar.tsx:231`              |
| Kullanıcılar        | misafir                                                  |
| Prensip             | accessibility · Odak görünürlüğü ve içeriğin örtülmemesi |
| Sezgisel madde      | H14 — Erişilebilirlik                                    |
| WCAG                | 2.4.11 Focus Not Obscured (Minimum) (AA)                 |
| Renk/tema           | Hayır                                                    |
| Efor                | S                                                        |
| Kaynak denetçiler   | runtime:results                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cards)                     |

**Kanıt:** RUNTIME p4d.mjs (desktop 1280x800, 2 ilan seçili, çubuk 61px): #sort-by'dan itibaren Tab yürüyüşünde "Tam tarihler" select'i ve 3 adet "Fırsatı Gör" bağlantısı TAMAMEN, "Luxury Bosphorus Suite" bağlantısı ise kısmen çubuğun altında kalıyor. Sayfa en alta kaydırıldığında footer'daki © satırı, Gizlilik Bildirimi, Güven merkezi, Verilerim, Kullanım Koşulları ve Çerez Bildirimi kalıcı olarak çubuğun altında. p4.mjs (mobile 390): footer'da "Yardım Merkezi" ve "COVID-19…" odakta tamamen örtülü; body padding-bottom 0px. p12: mobilde 3. "Karşılaştırmaya ekle" düğmesine Playwright tıklaması "region intercepts pointer events" hatası verdi. Mobilde bilinen 23px taşma nedeniyle (layout 413px) "Karşılaştır" düğmesi sağ kenara yapışık ve kırpılıyor. Ekran görüntüsü: scratchpad/runtime/crops/search/compare-mobile-mid.png (bg-white/95 yarı saydam olduğu için alttaki metin sızıyor).

**Etki:** Klavye kullanıcısı odağın nerede olduğunu göremiyor ve dokunmatik kullanıcı sayfa sonundaki yasal bağlantılara ulaşamıyor.

**Önerilen aksiyon:** ids.length>0 iken çubuk yüksekliği kadar bir boşluk ekleyin (ör. main sonuna h-20 aria-hidden div, ya da body için padding-bottom: var(--compare-bar-h)). html'e scroll-padding-bottom: 5rem verin. Arka planı opak bg-white yapın. Mobilde düğmeleri sığdırmak için flex-wrap'i koruyun ve min-w-0 kullanın.

**Yapılan düzeltme:** CompareBar.tsx: while the bar is visible, a ResizeObserver sets body padding-bottom and html scroll-padding-bottom to the bar height, so focused items and footer links are no longer covered; cleanup restores both. Buttons wrap (flex-wrap, min-w-0) and are min 44px on mobile. The bg-white/95 to opaque change was not made (reason: color/theme). — dosyalar: `src/components/compare/CompareBar.tsx`

## F90 — Karşılaştırma seçimi ekran okuyucuya duyurulmuyor; düğme hem etiketini hem aria-pressed değerini değiştiriyor; 4 ilan sınırının nedeni yalnızca title içinde

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                        |
| Durum               | Gözlemlendi                                                                                 |
| Konum               | `src/components/compare/CompareToggle.tsx:278`                                              |
| Diğer konumlar      | `src/components/compare/CompareBar.tsx:228`, `src/components/compare/CompareToggle.tsx:271` |
| Kullanıcılar        | misafir                                                                                     |
| Prensip             | accessibility · Durum mesajları ve ad/rol/değer                                             |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                       |
| WCAG                | 4.1.3 Status Messages (AA); 4.1.2 Name, Role, Value (A)                                     |
| Renk/tema           | Hayır                                                                                       |
| Efor                | S                                                                                           |
| Kaynak denetçiler   | runtime:results                                                                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: cards)                                                               |

**Kanıt:** RUNTIME p4.mjs (mobile TR): "Karşılaştırmaya ekle" üzerinde Enter'a basınca canlı bölge kaydı boş kalıyor (window.__live=[]). Düğme metni "Karşılaştırmadan çıkar" oluyor ve aria-pressed="true" atanıyor (ekran okuyucu "Karşılaştırmadan çıkar, basılı" der). DOM sonunda beliren "1 ilan seçildi … Karşılaştırmak için en az 2 ilan seçin." çubuğunda role=status yok. p12-cmpfull.mjs: 4 ilan seçilince 5. düğme disabled oluyor, metni değişmeden "Karşılaştırmaya ekle" kalıyor, rengi gray-400 ve tek açıklama title="En fazla 4 ilan karşılaştırılabilir" (dokunmatikte ve klavyede ulaşılamaz).

**Etki:** Ekran okuyucu kullanıcısı seçimin sayısını ve karşılaştırma düğmesinin belirdiğini öğrenemiyor. Sınır dolduğunda düğmeler neden çalışmadığını açıklamadan pasifleşiyor.

**Önerilen aksiyon:** CompareBar'a sr-only bir <p role="status">{count} ilan seçildi</p> ekleyin. Düğmede ya sabit bir etiketle ("Karşılaştır: {başlık}") aria-pressed kullanın ya da aria-pressed'i kaldırıp yalnızca etiketi değiştirin. Sınır dolunca görünür bir "4/4 seçildi, birini çıkarın" metni gösterin ve disabled yerine aria-disabled ile açıklama kullanın.

**Yapılan düzeltme:** CompareBar has an sr-only role=status that is always rendered and announces 'N ilan seçildi' plus the next step (needMore/ready/fullHint). CompareToggle drops aria-pressed and keeps the changing label. When the limit is reached it uses aria-disabled instead of disabled, stays focusable and links to a visible '4/4 seçildi, birini çıkarın' note via aria-describedby; the title attribute is gone. The bar shows the same note. The toggle is min 44px on mobile. — dosyalar: `src/components/compare/CompareBar.tsx`, `src/components/compare/CompareToggle.tsx`

## F91 — Oturumsuz kullanıcı 'Favorilere ekle'ye basınca 401 sessizce yutuluyor: ne giriş yönlendirmesi ne de mesaj var

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | High                                                    |
| Durum               | Gözlemlendi                                             |
| Konum               | `src/components/property/PropertyCard.tsx:84`           |
| Kullanıcılar        | misafir                                                 |
| Prensip             | robustness · Robustness / observability, recoverability |
| Sezgisel madde      | H9 — Hata mesajları                                     |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | runtime:home                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: cards)                           |

**Kanıt:** RUNTIME probes/home/links.mjs (/, anon, desktop): ilk kartta 'Favorilere ekle' tıklandı. Ağda '401 /api/favorites' görüldü. Tıklamadan sonra URL hâlâ 'http://localhost:3000/', aria-pressed=false, etiket değişmedi. Sayfada role=alert/status/aria-live yok ('alerts/toasts: []'). Kod: 79 satırında throw new Error('Favori eklenemedi'). 84 satırındaki err.message.includes('401') bu mesajda asla doğru olmuyor, bu yüzden router.push('/login') hiç çalışmıyor. Diğer hatalar da (ağ hatası, 5xx) sessizce yutuluyor.

**Etki:** Ana sayfadaki 6 kartın hepsinde kalp düğmesi anonim kullanıcıda 'bozuk' görünüyor. Kullanıcı neden kaydedemediğini anlamıyor ve hesap açma fırsatı kaçıyor.

**Önerilen aksiyon:** res.status === 401 kontrolünü fetch sonrasında doğrudan yap ve `/login?next=${encodeURIComponent(location.pathname)}` adresine yönlendir (ya da 'Favorilere eklemek için giriş yapın' toast'ı + giriş bağlantısı göster). Diğer hatalarda role=status ile 'Favori eklenemedi, tekrar deneyin' bildir. Anonim kullanıcıda düğmenin aria-label'ına 'giriş gerekir' bilgisini ekle.

**Yapılan düzeltme:** Same fix as F61. — dosyalar: `src/components/property/PropertyCard.tsx`

## F92 — Türkçe arayüzde harita denetimleri İngilizce ("Map", "Zoom in", "Close popup")

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | High                                       |
| Durum               | Gözlemlendi                                |
| Konum               | `src/components/search/ResultsMap.tsx:159` |
| Diğer konumlar      | `src/components/search/ResultsMap.tsx:172` |
| Kullanıcılar        | misafir                                    |
| Prensip             | accessibility · Dil tutarlılığı            |
| Sezgisel madde      | H14 — Erişilebilirlik                      |
| WCAG                | 3.1.2 Language of Parts (AA)               |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | runtime:results                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: cards)              |

**Kanıt:** RUNTIME p3-map.mjs (lang=tr, desktop ve mobile Tab yürüyüşü): canvas role=region aria-label "Map"; düğmeler "Zoom in", "Zoom out", "Drag to rotate map, click to reset north"; summary "Toggle attribution"; popup kapatma düğmesi "Close popup". Ekran görüntüsü: crops/search/map-desktop-selected.png.

**Etki:** Türkçe ekran okuyucu bu etiketleri Türkçe ses kurallarıyla okuyor ve anlaşılmaz hale getiriyor. Okuryazarlık düzeyi düşük kullanıcı da yabancı terimlerle karşılaşıyor.

**Önerilen aksiyon:** react-map-gl Map bileşenine locale={{'NavigationControl.ZoomIn': t('mapView.zoomIn'), 'NavigationControl.ZoomOut': …, 'NavigationControl.ResetBearing': …, 'Map.Title': t('mapView.title'), 'Popup.Close': …, 'AttributionControl.ToggleAttribution': …}} verin ve anahtarları messages/{tr,en}/search.json dosyalarına ekleyin.

**Yapılan düzeltme:** ResultsMap.tsx passes a locale prop to <Map> with Map.Title, NavigationControl.ZoomIn/ZoomOut/ResetBearing, Popup.Close, AttributionControl.ToggleAttribution/MapFeedback and Marker.Title from search.mapView.* keys. — dosyalar: `src/components/search/ResultsMap.tsx`

## F93 — Arama bağlamı (tarih ve misafir) harita popup'ında, tarihsiz kartta ve karşılaştırma tablosunda ilan sayfasına taşınmıyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | High                                                                          |
| Durum               | Gözlemlendi                                                                   |
| Konum               | `src/components/search/ResultsMap.tsx:239`                                    |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:50`, `src/app/compare/page.tsx:115` |
| Kullanıcılar        | misafir                                                                       |
| Prensip             | flexibility · Görev geçişi: girilen bilgi bir sonraki adıma aktarılmalı       |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                       |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | runtime:results                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cards)                                          |

**Kanıt:** RUNTIME p2-links.mjs: tarihli aramada kart href'i /property/<id>?checkIn=2027-01-27&checkOut=2027-01-29&guests=2&roomId=…&ratePlanId=… biçiminde (doğru). p3-map.mjs: aynı aramada harita popup bağlantısı yalnızca "/property/cmv2uybda001j92w2qsl5p0ww". /search?destination=İstanbul&guests=3 aramasında kart bağlantıları "/property/cmv2uydl30fot92w2i9c8a4fa" (guests=3 kayboluyor). p4e.mjs: /compare?…checkIn…guests=2 sayfasındaki ilan bağlantıları "/property/<id>".

**Etki:** Haritadan ya da karşılaştırmadan ilana geçen misafir tarihleri ve misafir sayısını yeniden girmek zorunda kalıyor; toplam fiyat da kayboluyor.

**Önerilen aksiyon:** Ortak bir propertyHref(id, {checkIn, checkOut, guests, roomId?, ratePlanId?}) yardımcısı yazın. Tarih yokken bile guests değerini ekleyin. ResultsMap'e ve compare sayfasına arama parametrelerini geçirin.

**Yapılan düzeltme:** New exported propertyHref(id, ctx) and SearchContext type in PropertyCard.tsx. guests is carried even without dates. PropertyCard takes a new optional searchContext prop, and ResultsMap takes a new searchContext prop plus an optional MapPoint.href, both used for the popup link. Compare page links now carry checkIn/checkOut/guests from data. search/page.tsx still has to pass these props (crossOwner). — dosyalar: `src/components/property/PropertyCard.tsx`, `src/components/search/ResultsMap.tsx`, `src/app/compare/page.tsx`

## F165 — Sabit karşılaştırma çubuğu odaktaki öğeleri ve sayfa sonunu örtüyor

| Alan                | Değer                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                      |
| Durum               | Aday (2 kaynak birleşti)                                                                                  |
| Konum               | `src/components/compare/CompareBar.tsx:31`                                                                |
| Diğer konumlar      | `src/app/search/page.tsx:282`, `src/styles/globals.css:65`, `src/components/privacy/CookieConsent.tsx:47` |
| Kullanıcılar        | misafir                                                                                                   |
| Prensip             | accessibility · WCAG 2.4.11 Focus Not Obscured (Minimum)                                                  |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                     |
| WCAG                | 2.4.11                                                                                                    |
| Renk/tema           | Hayır                                                                                                     |
| Efor                | S                                                                                                         |
| Kaynak denetçiler   | area:cards, lens:nav                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: cards)                                                                             |

**Kanıt:** CompareBar.tsx:31: `className='fixed inset-x-0 bottom-0 z-40 ... px-4 py-3'`. search/page.tsx:282 `<main className='... py-8 ...'>` ve Footer çubuk için alt boşluk ayırmıyor. globals.css:65-67 yalnızca `scroll-padding-top: 5rem` tanımlıyor; `scroll-padding-bottom` yok. 360px genişlikte `flex-wrap` iki satıra kırılıyor ve çubuk yaklaşık 100px yükseklik kaplıyor.

**Etki:** Klavyeyle sekmeleyen misafirin odağı son kart satırındaki 'Karşılaştırmaya ekle' ve 'Benzerlerini göster' bağlantılarında ve Footer bağlantılarında çubuğun altında kalıyor (WCAG 2.2 AA ihlali). Mobilde sayfa sonundaki içerik hiç görünür alana getirilemiyor.

**Önerilen aksiyon:** Çubuk görünürken `document.documentElement.style.setProperty('--compare-bar-h', h + 'px')` ayarlayın (ResizeObserver ile). globals.css'e `html { scroll-padding-bottom: var(--compare-bar-h, 0) }` ve body'ye `padding-bottom: var(--compare-bar-h, 0)` ekleyin. Alternatif: search sayfası sarmalayıcısına `ids.length > 0` iken `pb-28` verin.

**Yapılan düzeltme:** Same fix as F89, using the dynamic --compare-bar-h approach with inline style and no globals.css change. The h-24 spacer on the search page is now redundant (crossOwner). — dosyalar: `src/components/compare/CompareBar.tsx`

## F166 — Favori (kalp) butonu: hatalar sessizce yutuluyor, giriş yönlendirmesi hiç tetiklenmiyor, mevcut favoriler gösterilmiyor

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | High                                                 |
| Durum               | Aday (2 kaynak birleşti)                             |
| Konum               | `src/components/property/PropertyCard.tsx:84`        |
| Diğer konumlar      | `src/app/search/page.tsx:507`, `src/app/page.tsx:86` |
| Kullanıcılar        | misafir                                              |
| Prensip             | robustness · observability                           |
| Sezgisel madde      | H12 — Feedback                                       |
| WCAG                | 4.1.3                                                |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | lens:status, lens:a11y                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cards)                 |

**Kanıt:** PropertyCard.tsx:71 `throw new Error("Favori kaldırılamadı")`, 79 `throw new Error("Favori eklenemedi")` → 84 `err.message.includes("401")` asla doğru olmuyor; catch başka bir şey göstermiyor. 47 `initialFavorite = false`; search/page.tsx:507-533 ve page.tsx:86-99 bu prop'u hiç geçmiyor. Hata metinleri sabit Türkçe.

**Etki:** Giriş yapmamış misafir kalbe dokunduğunda hiçbir şey olmuyor (ne mesaj ne yönlendirme); girişliyken daha önce favorilediği ilanlar boş kalp görünüyor; hata olduğunda eklendiğini sanıyor.

**Önerilen aksiyon:** apiFetch kullan; `ApiError.status === 401` ise `router.push(loginHref())`; diğer hatalarda kart üstünde role=status kısa mesaj 'Favorilere eklenemedi, tekrar deneyin'; başarıda sr-only aria-live 'Favorilere eklendi'. Arama/ana sayfada oturum varsa GET /api/favorites ile id kümesini bir kez çekip initialFavorite olarak geç.

**Yapılan düzeltme:** The 401 redirect and the error/success status messages are done (same as F61). Showing existing favorites (initialFavorite) needs search/page.tsx and app/page.tsx to fetch GET /api/favorites and pass it in, so it went to crossOwner. — dosyalar: `src/components/property/PropertyCard.tsx`

## F167 — Puan rozeti ölçek belirtmiyor; karşılaştırma '/5' diyor, veri ise 10'luk ölçekte

| Alan                | Değer                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                      |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                  |
| Konum               | `src/components/property/PropertyCard.tsx:164`                                                                                                            |
| Diğer konumlar      | `src/app/compare/page.tsx:156`, `messages/tr/compare.json:22`, `prisma/seed.ts:311`, `src/app/property/[id]/page.tsx:145`, `src/app/account/page.tsx:380` |
| Kullanıcılar        | misafir                                                                                                                                                   |
| Prensip             | learnability · familiarity / predictability                                                                                                               |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                               |
| WCAG                | 1.3.1                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                     |
| Efor                | M                                                                                                                                                         |
| Kaynak denetçiler   | area:cards, lens:a11y                                                                                                                                     |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cards)                                                                                                                      |

**Kanıt:** PropertyCard.tsx:163-165: `<span className='... bg-[#003580] ...'>{rating.toFixed(1)}</span>`. Bu rozette ölçek de etiket de yok. compare.json:22 `{avg}/5 ({count} yorum)` diyor. Yorum API'si (api/properties/[id]/reviews/route.ts:20) `rating: z.number().int().min(1).max(5)` ile 1–5 ölçeğini zorunlu tutuyor. Buna karşın seed.ts:311/327 `ratingAvg: 8.9`, `9.4` değerlerini kullanıyor. docs/img/v4-compare.png'de '8,8/5 (260 yorum)' gibi imkânsız bir değer görünüyor.

**Etki:** Booking tarzı lacivert rozet kullanıcıda /10 beklentisi yaratıyor. 1–5 ölçeğinden gelen '4.6' (çok iyi) puanı misafir 10 üzerinden zayıf bir puan olarak okuyor. Karşılaştırma sayfasındaki '8,8/5' güveni zedeliyor. Ekran okuyucu yalnızca '8.6' duyuyor ve bunun puan olduğunu bilmiyor.

**Önerilen aksiyon:** Tek bir ölçek belirleyin (API 1–5). Rozet metnini `t('card.rating', {value, max: 5})` ile '4,6/5' yapın ya da rozete `aria-label={t('card.ratingLabel', {value, max})}` + görünür '/5' ekleyin. Seed'deki ratingAvg değerlerini 1–5 aralığına çekin. Aynı biçimi property/[id]/page.tsx:145'te de kullanın.

**Yapılan düzeltme:** PropertyCard rating badge: locale-aware f.number with one decimal (comma in TR). The visual badge is aria-hidden and gets an sr-only 'Misafir puanı: {value}' label. reviewCount=0 shows 'Henüz puan yok' instead of '0.0'. Not done: settling on a single scale (seed data is on 10, the API on 5) and adding '/5' to the badge (reason: needs product decision / data change). — dosyalar: `src/components/property/PropertyCard.tsx`

## F201 — Karşılaştırma hata durumu çıkmaz sokak: yeniden dene, geri dön ya da seçimi düzelt yolu yok

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | High                                                                |
| Durum               | Aday                                                                |
| Konum               | `src/app/compare/page.tsx:83`                                       |
| Diğer konumlar      | `src/lib/ai/listing-compare.ts:320`, `src/components/ui/ui.tsx:262` |
| Kullanıcılar        | misafir                                                             |
| Prensip             | robustness · recoverability                                         |
| Sezgisel madde      | H9 — Hata mesajları                                                 |
| Renk/tema           | Hayır                                                               |
| Efor                | M                                                                   |
| Kaynak denetçiler   | area:cards                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cards)                                |

**Kanıt:** compare/page.tsx:83-89: `if (res.error) return <p role='alert'>{res.error}</p>`. Buton ya da bağlantı yok; `useLoader` `reload` döndürüyor (ui.tsx:262) ama kullanılmıyor. listing-compare.ts:303 `isActive: true` filtresi uyguluyor, 320'de `if (rows.length !== ids.length) throw new NotFoundError('İlan bulunamadı')`. Seçim localStorage'da kalıcı (useCompareSelection.ts:7, 43).

**Etki:** Seçimdeki tek bir ilan yayından kalkarsa karşılaştırmanın tamamı 'İlan bulunamadı' ile düşüyor. Hangi ilanın sorunlu olduğu söylenmiyor. Misafir aramaya döndüğünde aynı seçim duruyor ve tekrar aynı hatayı alıyor. Geçici ağ hatasında da yeniden deneme düğmesi yok.

**Önerilen aksiyon:** Hata bloğuna `<Button onClick={res.reload}>{t('retry')}</Button>` ve `<Link href='/search'>{t('backToSearch')}</Link>` ekleyin. Sunucuda bulunamayan id'leri `details.missingIds` ile döndürün. UI'da 'Bu ilan artık yayında değil' mesajı ve 'Çıkar ve karşılaştır' düğmesi sunun; bu düğme hem `useCompareSelection().toggle(id)` çağırsın hem de URL'den id'yi silsin.

**Yapılan düzeltme:** The compare/page.tsx error state now has an explanation (errorHelp) and 'Yeniden dene' (res.reload), 'Seçimi temizle ve aramaya dön' (clear() then router.push) and 'Aramaya dön' (carries checkIn/checkOut/guests). Naming the listing that is no longer live (details.missingIds) is skipped: needs backend/API change. — dosyalar: `src/app/compare/page.tsx`

## F202 — Harita popup'ındaki ve karşılaştırma tablosundaki ilan bağlantıları tarih ve misafir bilgisini düşürüyor

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | High                                       |
| Durum               | Aday                                       |
| Konum               | `src/app/compare/page.tsx:115`             |
| Diğer konumlar      | `src/components/search/ResultsMap.tsx:239` |
| Kullanıcılar        | misafir                                    |
| Prensip             | flexibility · task migratability           |
| Sezgisel madde      | H7 — Esneklik/verim                        |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | area:cards                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cards)       |

**Kanıt:** compare/page.tsx:115: `<Link href={`/property/${l.id}`}>`. ResultsMap.tsx:239: `href={`/property/${selected.id}`}`. Buna karşın PropertyCard.tsx:50-58 `checkIn`, `checkOut`, `guests`, `roomId` ve `ratePlanId` değerlerini taşıyor. property/[id]/page.tsx:109-115 bu parametreleri okuyor. Karşılaştırma verisinde `data.checkIn`, `data.checkOut` ve `data.guests` mevcut.

**Etki:** Birincil akışta (ara, karşılaştır, rezervasyon yap) misafir karşılaştırma sonrasında ya da haritadan detaya geçtiğinde tarihleri ve misafir sayısını yeniden seçmek zorunda kalıyor. Bu sürtünme yaratıyor ve tarih hatası riskini artırıyor (yanlış tarih yeniden girilebilir).

**Önerilen aksiyon:** compare/page.tsx'te href'yi `/property/${l.id}?` + `new URLSearchParams({checkIn, checkOut, guests})` ile oluşturun (değer varsa). Her sütunun altına aynı hedefe giden 'Bu ilanı seç' CTA'sı ekleyin. MapPoint'e search/page.tsx'te PropertyCard ile aynı mantıkla üretilmiş bir `href` alanı ekleyin ve ResultsMap.tsx:239'da bunu kullanın.

**Yapılan düzeltme:** Same as F93: the compare table links use propertyHref(l.id, {checkIn, checkOut, guests}), and the ResultsMap popup uses selected.href ?? propertyHref(id, searchContext). The search page has to supply the context (crossOwner). The 'Bu ilanı seç' CTA was not added. — dosyalar: `src/app/compare/page.tsx`, `src/components/search/ResultsMap.tsx`

## F203 — Puan gösterimi tutarsız: ölçek belirtilmiyor, ondalık ayırıcı değişiyor, karşılaştırmada '8,8/5' gibi imkânsız değerler çıkıyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                        |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                        |
| Konum               | `src/app/compare/page.tsx:156`                                                                                                                                                                                                                                                                                              |
| Diğer konumlar      | `messages/tr/compare.json:22`, `src/app/property/[id]/page.tsx:145`, `src/components/property/PropertyCard.tsx:164`, `src/app/account/page.tsx:380`, `src/components/host/HostDashboard.tsx:232`, `src/components/property/ReviewsSection.tsx:166-176`, `src/components/admin/AdminDashboard.tsx:412`, `prisma/seed.ts:311` |
| Kullanıcılar        | misafir, admin                                                                                                                                                                                                                                                                                                              |
| Prensip             | learnability · consistency / real-world match                                                                                                                                                                                                                                                                               |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                       |
| Efor                | S                                                                                                                                                                                                                                                                                                                           |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                                                                                                                                            |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cards)                                                                                                                                                                                                                                                                                        |

**Kanıt:** compare/page.tsx:156 `t("ratingValue", { avg: f.number(l.rating.avg), … })` ve messages/tr/compare.json:22 `"{avg}/5 ({count} yorum)"`. docs/img/v4-compare.png'de "8,8/5" görünüyor. property/[id]/page.tsx:145, PropertyCard.tsx:164, account/page.tsx:380 ve HostDashboard.tsx:232 `ratingAvg.toFixed(1)` kullanıyor, TR'de sonuç "8.8" (nokta) ve ölçek yazmıyor (docs/img/property.png). ReviewsSection.tsx:166-176 Stars bileşeni 5 yıldız ölçeği kullanıyor (`"★".repeat(rating)`, reviews.json:8 "5 üzerinden {rating} puan"). AdminDashboard.tsx:412 `{r.rating}/5`. Tohum verisinde ratingAvg 8.9 ve 9.4 (prisma/seed.ts:311, :327), API ise 1-5 doğruluyor (api/properties/[id]/reviews/route.ts:20).

**Etki:** Misafir ilanları karşılaştırırken "8,8/5" gibi anlamsız bir değer görür. İlan sayfasında ölçeksiz "8.8", yorumlarda 5 yıldız görür. Karşılaştırma görevinin temeli olan puan güvenilmez hale gelir. TR biçiminde ondalık ayırıcı virgül olmalıyken nokta gösteriliyor.

**Önerilen aksiyon:** Tek bir `RatingBadge` bileşeni yapın: `f.number(avg, { maximumFractionDigits: 1 })` ile biçimlesin, ölçeği tek sabitten (`RATING_SCALE = 5`) alıp "4,5/5" göstersin, `aria-label={t("reviews.starsLabel")}` eklesin. Bu bileşeni property, PropertyCard, account, HostDashboard, compare ve admin moderasyonunda kullanın. Tohum verisini 1-5 ölçeğine çekin ya da ratingAvg'yi yorumlardan yeniden hesaplatın.

**Yapılan düzeltme:** Compare rating is now formatted with one decimal, and the card part is done (F167). The '{avg}/5' text against 10-point seed data, the property/account/host/admin screens and the shared RatingBadge are skipped (reason: needs product decision on a single scale plus a seed/data change; other files belong to other owners). — dosyalar: `src/app/compare/page.tsx`, `src/components/property/PropertyCard.tsx`

## F204 — Karşılaştırma (ve arama) sayfasının kendine ait belge başlığı yok

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | High                                                   |
| Durum               | Aday                                                   |
| Konum               | `src/app/compare/page.tsx:233`                         |
| Diğer konumlar      | `src/app/search/page.tsx:617`, `src/app/layout.tsx:16` |
| Kullanıcılar        | misafir                                                |
| Prensip             | accessibility · WCAG 2.4.2 Page Titled                 |
| Sezgisel madde      | H14 — Erişilebilirlik                                  |
| WCAG                | 2.4.2                                                  |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:cards                                             |
| **Düzeltme durumu** | **Zaten uygun** (paket: cards)                         |

**Kanıt:** compare/page.tsx:1 `'use client'` olduğu için metadata dışa aktaramıyor. src/app/compare altında layout.tsx yok. Tüm sayfalar layout.tsx:16'daki `title: t('meta.title')` değerini paylaşıyor. Kendi metadata'sı olan sayfalar yalnızca privacy, property/[id], ranking ve report.

**Etki:** Ekran okuyucu kullanıcısı sayfa açıldığında ya da sekmeler arasında geçişte 'İlan karşılaştırma' bağlamını duymuyor. Birden çok sekmeyle karşılaştırma yapan masaüstü misafir sekmeleri ayırt edemiyor. Tarayıcı geçmişi ve yer imleri de aynı başlığı taşıyor.

**Önerilen aksiyon:** src/app/compare/layout.tsx oluşturun ve `export async function generateMetadata() { const t = await getTranslations('compare'); return { title: t('title') } }` yazın. Aynısını src/app/search/layout.tsx için `search.heading.all` ile yapın. Hedef/tarih içeren dinamik başlık gerekiyorsa searchParams'tan üretin.

**Yapılan düzeltme:** Page titles were handled globally in wave 1; no metadata added here, as instructed.

## F205 — Arama bağlamı (tarih, kişi) ilan bağlantılarında düşüyor; ilan formu sessizce 'yarın / 2 kişi'ye dönüyor

| Alan                | Değer                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                      |
| Durum               | Aday                                                                                                                                      |
| Konum               | `src/components/property/PropertyCard.tsx:50`                                                                                             |
| Diğer konumlar      | `src/app/search/page.tsx:520`, `src/app/compare/page.tsx:115`, `src/app/cart/page.tsx:119`, `src/components/booking/BookingWidget.tsx:69` |
| Kullanıcılar        | misafir                                                                                                                                   |
| Prensip             | robustness · task conformance                                                                                                             |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                     |
| Efor                | S                                                                                                                                         |
| Kaynak denetçiler   | lens:nav                                                                                                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cards)                                                                                                      |

**Kanıt:** PropertyCard.tsx:50-58 `const href = stay ? `/property/${id}?…`:`/property/${id}``. search/page.tsx:520-531 stay'i yalnız `property.quote && checkIn && checkOut` olduğunda veriyor; teklifsiz sonuçlar (müsait oda yoksa ya da tarih seçilmemişse) tarih ve kişi sayısı olmadan açılıyor. BookingWidget.tsx:69-73 bu durumda `addDaysISO(1)`/`addDaysISO(2)` ve 2 kişiye düşüyor. compare/page.tsx:115 `/property/${l.id}` data.checkIn/checkOut/guests değerlerini; cart/page.tsx:119 `/property/${item.propertyId}` kalemin tarihlerini düşürüyor.

**Etki:** 20–25 Aralık, 4 kişi arayan misafir teklifsiz bir kartı açtığında formda yarının tarihini ve 2 kişiyi görüyor. Fark etmezse yanlış tarihe rezervasyon yapabiliyor.

**Önerilen aksiyon:** Tek bir `propertyHref(id, { checkIn, checkOut, guests, roomId?, ratePlanId? })` yardımcısı yazın. PropertyCard'a teklif olmasa da `searchContext` prop'u geçin; compare ve sepet kalemi bağlantılarında da kullanın. BookingWidget arama tarihi gelmediğinde varsayılan tarih yerine "Tarih seçin" göstersin ve teklif istemesin.

**Yapılan düzeltme:** The card, map and compare links are fixed through propertyHref and searchContext. The search page's searchContext prop, the cart link and the BookingWidget default dates belong to other owners (crossOwner). — dosyalar: `src/components/property/PropertyCard.tsx`

## F206 — Puan ölçeği hiçbir yerde belirtilmiyor ve ekranlar arası çelişiyor (kartta 8.6, karşılaştırmada '/5')

| Alan                | Değer                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                                   |
| Konum               | `src/components/property/PropertyCard.tsx:164`                                                                                                                                                         |
| Diğer konumlar      | `src/app/property/[id]/page.tsx:145`, `src/app/account/page.tsx:380`, `messages/tr/compare.json:22`, `src/lib/ai/listing-compare.ts:209`, `src/lib/reviews/review-service.ts:45`, `prisma/seed.ts:311` |
| Kullanıcılar        | misafir                                                                                                                                                                                                |
| Prensip             | learnability · consistency                                                                                                                                                                             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                                                                                                  |
| Efor                | M                                                                                                                                                                                                      |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: cards)                                                                                                                                                                   |

**Kanıt:** PropertyCard.tsx:163-165 ve property/[id]/page.tsx:144-146 yalnız `{rating.toFixed(1)}` (ör. '8.6', docs/img/search-smart-filter.png) basar, ölçek yok. compare.json:22 '{avg}/5 ({count} yorum)' ve listing-compare.ts:209 AI yorumu '(…/5…)' der; yorum yıldızları reviews.json starsLabel '5 üzerinden {rating} puan'. Seed puanları 10'luk (prisma/seed.ts:311 `ratingAvg: 8.9`), review-service.ts:45 ise yeni yorumda ortalamayı 1–5 yıldızdan yeniden hesaplar. Puansız ilan kartta '0.0' görünürken karşılaştırma 'Henüz puan yok' der.

**Etki:** Misafir karşılaştırmada '8,9/5' gibi imkânsız bir değer görür; yorum alan ilanın puanı 8.9'dan 4.5'e 'düşmüş' gibi görünür; yeni ilan 0.0 ile kötü puanlı sanılır — birincil 'karşılaştır' görevinde yanlış karar.

**Önerilen aksiyon:** Puanı tek ölçeğe (ör. 5) normalize edin ve her gösterimde ölçeği yazın: kart/PDP rozeti '4,5/5' + aria-label '5 üzerinden 4,5'; ratingCount=0 ise rozet yerine 'Henüz puan yok' gösterin; seed verisini aynı ölçeğe çekin.

**Yapılan düzeltme:** Same as F167: the card shows 'Henüz puan yok' when there are no reviews and has an accessible label. Normalizing the scale is skipped (needs product decision). — dosyalar: `src/components/property/PropertyCard.tsx`

## F207 — Harita işaretçisi taban gecelik fiyatı gösteriyor, liste kartı ise tarihli toplamı gösteriyor ve niteleyici yok

| Alan                | Değer                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                  |
| Durum               | Aday                                                                                                                  |
| Konum               | `src/components/search/ResultsMap.tsx:223`                                                                            |
| Diğer konumlar      | `src/app/search/page.tsx:266`, `src/components/search/ResultsMap.tsx:221`, `src/components/search/ResultsMap.tsx:245` |
| Kullanıcılar        | misafir                                                                                                               |
| Prensip             | learnability · consistency                                                                                            |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                           |
| Renk/tema           | Hayır                                                                                                                 |
| Efor                | M                                                                                                                     |
| Kaynak denetçiler   | area:cards                                                                                                            |
| **Düzeltme durumu** | **Zaten uygun** (paket: cards)                                                                                        |

**Kanıt:** search/page.tsx:266: `priceLabel: f.money(p.basePriceMinor, p.currency)`. ResultsMap.tsx:223'te `{item.point.priceLabel}`, 221'de aria-label `${title}, ${city}, ${priceLabel}`, 245'te popup `{selected.city} · {selected.priceLabel}`. Liste kartı tarih seçiliyken PropertyCard.tsx:178-181'de `stay.total` ve 'vergi ve ücretler dahil' gösteriyor. Haritada 'gecelik' ya da 'toplam' niteleyicisi bulunmuyor.

**Etki:** Misafir aynı ilan için listede ₺9.800 (3 gece, vergi dahil), haritada ise ₺2.100 görüyor ve hangisinin geçerli olduğunu bilemiyor. Görünümler arasında geçiş yapan misafir fiyatları karşılaştırırken yanılıyor. Ekran okuyucu da çıplak tutarı niteleyicisiz okuyor.

**Önerilen aksiyon:** search/page.tsx:257-270'te `p.quote` varsa `priceLabel` için `t('card.nightsTotal', {count})` + `f.money(p.quote.total, ...)`, yoksa `t('card.perNightShort', {price})` ('₺2.100/gece') üretin. MapPoint'e `priceKind: 'total'|'nightly'` alanı ekleyin. aria-label'a 'gecelik' ya da 'toplam, vergiler dahil' ifadesini yazın.

**Yapılan düzeltme:** search/page.tsx:486-489 (F346) already builds priceLabel as mapPrice.total or mapPrice.perNight, and ResultsMap uses that label in the marker, the aria-label and the popup, so the qualifier is present.

## F208 — Popup açılınca odak listeden haritaya kaçıyor, kapanınca odak sayfa başına düşüyor

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | High                                       |
| Durum               | Aday                                       |
| Konum               | `src/components/search/ResultsMap.tsx:229` |
| Diğer konumlar      | `src/app/search/page.tsx:595`              |
| Kullanıcılar        | misafir                                    |
| Prensip             | accessibility · WCAG 2.4.3 Focus Order     |
| Sezgisel madde      | H14 — Erişilebilirlik                      |
| WCAG                | 2.4.3                                      |
| Renk/tema           | Hayır                                      |
| Efor                | M                                          |
| Kaynak denetçiler   | area:cards                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: cards)              |

**Kanıt:** ResultsMap.tsx:229-236'da `<Popup ... onClose={() => onSelect(null)} closeOnClick={false} closeButton>` var ve `focusAfterOpen` verilmemiş. MapLibre varsayılanı `focusAfterOpen: true` (maplibre-gl-dev.mjs:29677). `_focusFirstElement()` popup'taki ilk `a[href]` öğesine odaklanıyor. Yan listedeki düğme (search/page.tsx:595-598) `onSelect` çağırdığında odak listeden haritadaki Link'e atlıyor. × ile kapatıldığında Popup unmount oluyor, odak öğesi DOM'dan kalkıyor ve odak body'ye düşüyor. Tetikleyen işaretçiye ya da liste öğesine geri dönüş yok.

**Etki:** Klavye ve ekran okuyucu kullanıcısı yan listede gezinirken her seçimde haritaya fırlatılıyor. Popup'ı kapatınca sayfanın başından yeniden sekmelemesi gerekiyor; bu, 24 sonuç ve filtreler boyunca onlarca sekme durağı demek.

**Önerilen aksiyon:** Popup'a `focusAfterOpen={false}` verin. Seçimi tetikleyen öğeyi bir `lastTriggerRef` içinde saklayın (işaretçi ya da MapResultList düğmesi). onClose'da `onSelect(null)` sonrasında `requestAnimationFrame(() => lastTriggerRef.current?.focus())` çağırın. Seçim işaretçiden geldiyse ilk odağı popup içindeki Link'e programatik olarak taşıyın.

**Yapılan düzeltme:** ResultsMap.tsx: Popup gets focusAfterOpen={false}, so selecting from the side list no longer moves focus to the map. lastTriggerRef stores the marker or list button that made the selection; on close, onSelect(null) runs and focus returns to it via requestAnimationFrame. When the selection comes from a marker, focus moves to the popup link through a ref callback. — dosyalar: `src/components/search/ResultsMap.tsx`

## F209 — Karanlık temada harita popup metni beyaz zemin üzerinde okunamıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | High                                          |
| Durum               | Aday                                          |
| Konum               | `src/components/search/ResultsMap.tsx:237`    |
| Diğer konumlar      | `src/styles/globals.css:22`                   |
| Kullanıcılar        | misafir                                       |
| Prensip             | accessibility · WCAG 1.4.3 Contrast (Minimum) |
| Sezgisel madde      | H14 — Erişilebilirlik                         |
| WCAG                | 1.4.3                                         |
| Renk/tema           | Evet — onaylandı ve uygulandı                 |
| Efor                | S                                             |
| Kaynak denetçiler   | area:cards                                    |
| **Düzeltme durumu** | **Düzeltildi (onaylı renk düzeltmesi)**       |

**Kanıt:** ResultsMap.tsx:237: `<div className='text-sm text-gray-900'>`, 240: `text-[#003580]`. maplibre-gl.css: `.maplibregl-popup-content{background:#fff}` tema token'ı değil. tailwind.config.ts DARK_SHADE_MAP `tx: {900: '50'}` ile text-gray-900'ü gray-50'ye çeviriyor. globals.css:23-26 `text-[#003580]` değerini `--brand-fg` (blue-300) yapıyor. Sonuç olarak koyu temada gri-50 metin #fff üzerinde (yaklaşık 1:1) ve blue-300 bağlantı #fff üzerinde (yaklaşık 2:1) kalıyor.

**Etki:** Koyu tema kullanan misafir haritada işaretçi seçtiğinde açılan popup'taki şehir/fiyat ve ilan bağlantısı neredeyse görünmüyor.

**Önerilen aksiyon:** Popup'a `className='results-popup'` verin. globals.css'te `.results-popup .maplibregl-popup-content { background: rgb(var(--bg-white, 255 255 255)); }` ve ok ucu (`.maplibregl-popup-tip`) için aynı token'ı tanımlayın. Böylece mevcut tema token'ları kullanılır. Bu değişiklik renk/tema katmanına dokunduğu için kullanıcı onayına bağlıdır.

## F479 — Karşılaştırma sayfası 10 üzerinden puanı "/5" olarak gösteriyor (8,9/5)

| Alan                | Değer                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                            |
| Durum               | Gözlemlendi                                                                                       |
| Konum               | `src/app/compare/page.tsx:156`                                                                    |
| Diğer konumlar      | `messages/tr/compare.json:22`, `messages/en/compare.json:22`, `src/lib/ai/listing-compare.ts:209` |
| Kullanıcılar        | misafir                                                                                           |
| Prensip             | learnability · Gerçek dünya eşleşmesi ve tutarlılık                                               |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                       |
| Renk/tema           | Hayır                                                                                             |
| Efor                | S                                                                                                 |
| Kaynak denetçiler   | runtime:results                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                      |

**Kanıt:** RUNTIME p4e.mjs: /compare tablosunda "Puan 8,9/5 (1240 yorum)" ve "8,6/5 (540 yorum)" yazıyor. AI yorumu "(8.9/5, 1240 yorum)" diyor. prisma/seed.ts:311'de ratingAvg 8.9 (10'luk ölçek). Arama kartı ise ölçeksiz olarak "8.9" gösteriyor.

**Etki:** 5 üzerinden 8,9 anlamsız bir değer ve puan ölçeği hakkında kafa karışıklığı ile güvensizlik yaratıyor.

**Önerilen aksiyon:** ratingValue değerini "{avg}/10 ({count} değerlendirme)" yapın ve listing-compare.ts:209-210'daki "/5" ifadesini "/10" ile değiştirin. Kartta da aynı ölçeği ve terimi kullanın.

## F480 — Kart görseli tıklanamıyor: kartın en büyük dokunma alanı işlevsiz

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Gözlemlendi                                   |
| Konum               | `src/components/property/PropertyCard.tsx:94` |
| Kullanıcılar        | misafir                                       |
| Prensip             | learnability · Affordance ve aşinalık         |
| Sezgisel madde      | H11 — Affordance                              |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | runtime:results                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** RUNTIME p8-tab.mjs: main içindeki img.closest('a') sonucu false. Mobilde görsel 358x192px. İlana yalnızca başlık bağlantısıyla (mobilde 143-190x21px) ve "Fırsatı Gör" düğmesiyle gidilebiliyor. hover:scale-105 efekti görselin tıklanabilir olduğu izlenimini veriyor ama tıklamada bir şey olmuyor.

**Etki:** OTA alışkanlığıyla fotoğrafa dokunan mobil misafir hiçbir tepki alamıyor.

**Önerilen aksiyon:** Görseli tabIndex={-1} ve aria-hidden olan bir Link ile sarın, ya da başlık bağlantısına after:absolute after:inset-0 ekleyerek (stretched link) kartın tamamını tıklanabilir yapın. Kalp düğmesine relative z-10 verin.

## F481 — Favori düğmelerinin hepsi 'Favorilere ekle' adını taşıyor, mülk adını içermiyor ve okuma/Tab sırasında başlıktan önce geliyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Gözlemlendi                                                  |
| Konum               | `src/components/property/PropertyCard.tsx:107`               |
| Kullanıcılar        | misafir                                                      |
| Prensip             | accessibility · Accessibility; Learnability / predictability |
| Sezgisel madde      | H14 — Erişilebilirlik                                        |
| WCAG                | 2.4.6 Headings and Labels, 1.3.2 Meaningful Sequence         |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | runtime:home                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** RUNTIME tarama 000 tabOrder: '…a "BodrumTürkiye" → button "Favorilere ekle" → a "Kapadokya Sultan Cave Hotel" → a "Fırsatı Gör" → button "Favorilere ekle" → a "Cave Suite Cappadocia"…'. links.mjs ariaSnapshot: her kartta 'img … / button "Favorilere ekle" / text: BED_AND_BREAKFAST / heading …'. Kartlar liste değil (ul/li yok). Kod: 102-108 düğme görsel kapsayıcısında ve h3'ten önce. aria-label={t('card.addFavorite')}.

**Etki:** Ekran okuyucu kullanıcısı hangi mülkü favorilediğini bilmeden 'Favorilere ekle' duyuyor. Bağlam, düğmeden sonra geliyor.

**Önerilen aksiyon:** aria-label'ı '{title} favorilere ekle' / '{title} favorilerden çıkar' yap. DOM'da h3'ü önce koyup düğmeyi CSS ile görselin üstüne konumla (order veya absolute). Kartları <ul role=list><li><article aria-labelledby> yapısına al.

## F482 — Konaklama tür rozetlerinde ham enum görünüyor: BED_AND_BREAKFAST, HOTEL, VILLA (TR ve EN)

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Gözlemlendi                                          |
| Konum               | `src/components/property/PropertyCard.tsx:126`       |
| Diğer konumlar      | `src/app/search/page.tsx`, `messages/tr/search.json` |
| Kullanıcılar        | misafir                                              |
| Prensip             | learnability · Learnability / familiarity            |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                          |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | runtime:home                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                         |

**Kanıt:** RUNTIME tarama 000/001/116/117 bodyTextSample: 'BED_AND_BREAKFAST', 'HOTEL', 'VILLA' (EN sürümde de aynı). Ekran görüntüleri C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/crops/home/000-anon-tr-desktop-_-0.png ve -1.png (kart sol üst rozetleri). Kod: PropertyCard.tsx:126 {propertyType} ham basılıyor. Çeviriler hazır: messages/tr/search.json 'types' (Otel/Apart/Villa/Hostel/Pansiyon). Eşleme search/page.tsx:109-117'de var ama kartta kullanılmıyor.

**Etki:** Teknik sabitler (alt çizgili İngilizce büyük harf) TR kullanıcıya yabancı geliyor ve güveni zedeliyor. Düşük okuryazarlıktaki misafir 'Pansiyon' bilgisini çıkaramıyor.

**Önerilen aksiyon:** Enum→anahtar eşlemesini (HOTEL→hotel, BED_AND_BREAKFAST→bedAndBreakfast …) ortak bir yardımcıya taşı ve PropertyCard'da t(`types.${key}`) ile göster. Bilinmeyen değerde rozeti gizle.

## F483 — 'Fırsatı Gör' yanıltıcı feedforward: ortada fırsat veya indirim yok, düğme başlıkla aynı sayfaya gidiyor; 6 kez aynı link metni

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Gözlemlendi                                    |
| Konum               | `src/components/property/PropertyCard.tsx:194` |
| Diğer konumlar      | `messages/tr/search.json`                      |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · Learnability / predictability   |
| Sezgisel madde      | H13 — Feedforward                              |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | runtime:home                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** RUNTIME probes/home/links.mjs: her kartta 'Kapadokya Sultan Cave Hotel -> /property/cmv2uydt…' ve 'Fırsatı Gör -> /property/cmv2uydt…' aynı href'e gidiyor. Hedef sayfada fırsat/indirim/% ifadesi yok (dealWords: []), tarihler varsayılan '12 Eki 2026 - 13 Eki 2026'. Ekran görüntüsü C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/home/after-deal.png. Tarama tabOrder: 'Fırsatı Gör' 6 kez aynı adla. Kod: 190-195 Link, messages/tr/search.json:111 'Fırsatı Gör'.

**Etki:** 'Fırsat' beklentisi boşa çıkıyor ve güven sarsılıyor (dark-pattern algısı). Ekran okuyucu link listesinde altı özdeş 'Fırsatı Gör' var. Her kart klavye kullanıcısına 3 Tab durağı ekliyor.

**Önerilen aksiyon:** Metni gerçek eyleme çevir: 'Müsaitliği gör' veya 'Odaları gör'. aria-describedby ile kart başlığına bağla ya da görünmez ek metin kullan ('… – Kapadokya Sultan Cave Hotel'). Tek tıklanabilir kart bağlantısı deseniyle başlık ve CTA'yı birleştir, favori düğmesi ayrı kalsın.

## F484 — Mobilde harita tek parmakla kaydırmayı yutuyor (kaydırma tuzağı)

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | Medium                                                         |
| Durum               | Gözlemlendi                                                    |
| Konum               | `src/components/search/ResultsMap.tsx:159`                     |
| Kullanıcılar        | misafir                                                        |
| Prensip             | flexibility · Kontrol ve özgürlük: sayfa kaydırma engelleniyor |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                              |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | runtime:results                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                   |

**Kanıt:** RUNTIME p9-maptouch.mjs (mobile 390x844, Harita görünümü): harita 358x480px (x 16-374). Harita üzerinde CDP ile yukarı kaydırma hareketi yapınca scrollY 1201'de kalıyor. Kontrol olarak p9b.mjs'te liste görünümünde aynı hareket scrollY'yi 800'den 1037'ye taşıyor. Sayfayı kaydırmak için yalnızca 16px'lik yan boşluklar kalıyor.

**Etki:** Mobil kullanıcı haritanın altındaki liste alternatifine ya da footer'a geçemiyor, harita içinde sıkışıp kalıyor.

**Önerilen aksiyon:** Map bileşenine cooperativeGestures verin (iki parmakla kaydırma ve yerelleştirilmiş ipucu). Mobilde harita yüksekliğini yaklaşık 50vh ile sınırlayın ve haritanın üstüne yapışkan bir "Listeye dön" düğmesi koyun.

## F587 — Mobilde karşılaştırma tablosu yatay kayınca satır başlıkları kayboluyor; kaydırma kabı etiketsiz

| Alan                | Değer                                                         |
| ------------------- | ------------------------------------------------------------- |
| Severity            | Medium                                                        |
| Durum               | Aday (2 kaynak birleşti)                                      |
| Konum               | `src/app/compare/page.tsx:124`                                |
| Diğer konumlar      | `src/app/compare/page.tsx:106`, `src/app/compare/page.tsx:93` |
| Kullanıcılar        | misafir                                                       |
| Prensip             | learnability · synthesizability                               |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                       |
| WCAG                | 1.3.1                                                         |
| Renk/tema           | Hayır                                                         |
| Efor                | S                                                             |
| Kaynak denetçiler   | area:cards, lens:mobile                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                  |

**Kanıt:** compare/page.tsx:106: `<div className='overflow-x-auto ...'>` etiketsiz ve `tabIndex` vermiyor. 107: `min-w-full`. 124/150/163/179/189'daki satır `<th scope='row'>` hücreleri yapışkan değil. 4 sütun ve olanak listeleriyle 360px genişlikte yatay kaydırma oluşuyor.

**Etki:** Mobil misafir 3. ve 4. ilan sütununa kaydırınca 'Toplam fiyat', 'İptal politikası' gibi satır adlarını görmüyor ve değerleri ezberlemek zorunda kalıyor. Bağlantısız sütunlarda klavyeyle kaydırma güvenilir değil.

**Önerilen aksiyon:** Satır `th` öğelerine ve köşe hücresine `sticky left-0 z-10 bg-white` verin. Kaba `role='region' aria-label={t('title')} tabIndex={0}` ekleyin. Sütunlara `min-w-[11rem]` verin.

## F588 — initialFavorite hiçbir çağıranda verilmiyor, favoriye alınmış ilanlar boş kalp ve aria-pressed=false ile görünüyor

| Alan                | Değer                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                              |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                            |
| Konum               | `src/components/property/PropertyCard.tsx:62`                                                                                                                                                                                       |
| Diğer konumlar      | `src/app/search/page.tsx:507`, `src/app/page.tsx:86`, `src/app/search/page.tsx:507-533`, `src/app/page.tsx:86-99`, `src/app/account/page.tsx:337-351`, `src/app/account/page.tsx:397-405`, `src/app/property/[id]/page.tsx:134-160` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                             |
| Prensip             | robustness · observability                                                                                                                                                                                                          |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                                                                                      |
| WCAG                | 4.1.2                                                                                                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                                                                               |
| Efor                | M                                                                                                                                                                                                                                   |
| Kaynak denetçiler   | area:cards, lens:consistency                                                                                                                                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                        |

**Kanıt:** PropertyCard.tsx:62: `useState(initialFavorite)`, 47: varsayılan `false`. search/page.tsx:507-533 ve app/page.tsx:86-99 `initialFavorite` geçmiyor. Arama ve popüler ilan yanıtlarında da favori bilgisi yok.

**Etki:** Daha önce favoriye eklediği ilanı aramada gören misafir dolu kalp yerine boş kalp görüyor. Ekran okuyucu 'basılı değil' diyor. Kaldırmak için iki kez tıklamak gerekiyor (önce yeniden ekleniyor). Durum algısı yanlış oluşuyor.

**Önerilen aksiyon:** Oturum varsa sayfa yüklenirken `GET /api/favorites` ile id kümesini bir kez çekin (ya da arama yanıtına `isFavorite` ekleyin). `initialFavorite={favIds.has(property.id)}` geçin. Oturum yoksa durum bilinmediği için `aria-pressed` kullanmayın.

## F589 — MapLibre arayüz metinleri ve erişilebilir adları Türkçe arayüzde İngilizce kalıyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Aday (2 kaynak birleşti)                                                      |
| Konum               | `src/components/search/ResultsMap.tsx:159`                                    |
| Diğer konumlar      | `src/components/search/DestinationAutocomplete.tsx:22`, `src/app/page.tsx:15` |
| Kullanıcılar        | misafir                                                                       |
| Prensip             | accessibility · WCAG 3.1.2 Language of Parts                                  |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                   |
| WCAG                | 3.1.2                                                                         |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | area:cards, lens:a11y                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                  |

**Kanıt:** ResultsMap.tsx:159-172: `<Map ref mapStyle ... ><NavigationControl position='top-right' />` ve `locale` prop'u yok. MapLibre varsayılanları (maplibre-gl-dev.mjs:24305-24310): 'Map' (tuval aria-label, role=region), 'Zoom in', 'Zoom out', 'Drag to rotate map, click to reset north', 'Close popup'.

**Etki:** TR ekran okuyucu kullanıcısı yakınlaştırma düğmelerini ve popup kapatma düğmesini Türkçe sesle bozuk telaffuzla İngilizce duyuyor. Fare kullanıcısının title ipuçları da İngilizce. Arayüz dil tutarlılığı bozuluyor.

**Önerilen aksiyon:** `<Map locale={{ 'Map.Title': t('mapView.title'), 'NavigationControl.ZoomIn': t('mapView.zoomIn'), 'NavigationControl.ZoomOut': t('mapView.zoomOut'), 'NavigationControl.ResetBearing': t('mapView.resetNorth'), 'Popup.Close': t('mapView.closePopup') }}>` ekleyin ve anahtarları messages/{tr,en}/search.json mapView altına yazın. Döndürme gereksizse `<NavigationControl showCompass={false} />` kullanın.

## F671 — Deterministik karşılaştırma tablosu yapay zekâ yorumunu bekliyor

| Alan                | Değer                               |
| ------------------- | ----------------------------------- |
| Severity            | Medium                              |
| Durum               | Aday                                |
| Konum               | `src/app/compare/page.tsx:65`       |
| Diğer konumlar      | `src/lib/ai/listing-compare.ts:361` |
| Kullanıcılar        | misafir                             |
| Prensip             | robustness · responsiveness         |
| Sezgisel madde      | H15 — Performans                    |
| Renk/tema           | Hayır                               |
| Efor                | M                                   |
| Kaynak denetçiler   | area:cards                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**        |

**Kanıt:** compare/page.tsx:65-71 tek bir `apiFetch('/api/compare')` çağrısı yapıyor ve 91'de `if (!data) return <p>{t('loading')}</p>`. listing-compare.ts:361 `const result = await client.completeJson('listing_compare', ...)` tablo verisi hazır olduğu halde LLM yanıtı bitene kadar dönmüyor.

**Etki:** Canlı LLM modunda ya da yavaş ağda misafir fiyat ve puan tablosunu birkaç saniye geç görüyor. Algılanan hız düşüyor, oysa tablo için LLM gerekmiyor.

**Önerilen aksiyon:** API'yi ikiye bölün: `/api/compare` yalnızca structured+diff döndürsün, `/api/compare/commentary` yorumu ayrı üretsin. UI tabloyu hemen göstersin, yorum bölümünde `aria-busy='true'` ile bir iskelet kullansın.

## F672 — Karşılaştırma API hata metinleri yalnızca Türkçe; EN arayüzde Türkçe hata görünüyor

| Alan                | Değer                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                 |
| Durum               | Aday                                                                                                   |
| Konum               | `src/app/compare/page.tsx:86`                                                                          |
| Diğer konumlar      | `src/lib/ai/listing-compare.ts:288`, `src/lib/ai/listing-compare.ts:320`, `src/lib/http/errors.ts:154` |
| Kullanıcılar        | misafir                                                                                                |
| Prensip             | learnability · consistency                                                                             |
| Sezgisel madde      | H9 — Hata mesajları                                                                                    |
| WCAG                | 3.1.2                                                                                                  |
| Renk/tema           | Hayır                                                                                                  |
| Efor                | S                                                                                                      |
| Kaynak denetçiler   | area:cards                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                           |

**Kanıt:** compare/page.tsx:86 `{res.error}` ile sunucu mesajını doğrudan basıyor. listing-compare.ts:288 `Karşılaştırma için 2–4 farklı ilan seçin`, 300 `Giriş ve çıkış tarihi birlikte verilmeli`, 320 `İlan bulunamadı`; errors.ts:154 `Doğrulama hatası`. Yanıtta `code` alanı var ama kullanılmıyor.

**Etki:** İngilizce arayüzü kullanan misafir anlamadığı Türkçe hata metni görüyor ve neyi düzelteceğini bilmiyor.

**Önerilen aksiyon:** `useLoader` yerine hata nesnesini koruyan bir sarmalayıcı kullanın. `ApiError.code` değerini compare.json'da `errors.{VALIDATION_ERROR|NOT_FOUND|...}` anahtarlarına eşleyin ve yalnızca bilinmeyen kodda genel `common.unexpectedError` gösterin.

## F673 — Karşılaştırma yükleme durumu duyurulmuyor; dil değişiminde eski veri göstergesiz kalıyor

| Alan                | Değer                          |
| ------------------- | ------------------------------ |
| Severity            | Medium                         |
| Durum               | Aday                           |
| Konum               | `src/app/compare/page.tsx:91`  |
| Diğer konumlar      | `src/components/ui/ui.tsx:246` |
| Kullanıcılar        | misafir                        |
| Prensip             | robustness · observability     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü |
| WCAG                | 4.1.3                          |
| Renk/tema           | Hayır                          |
| Efor                | S                              |
| Kaynak denetçiler   | area:cards                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**   |

**Kanıt:** compare/page.tsx:91: `<p className='text-sm text-gray-700'>{t('loading')}</p>` ve 237 Suspense fallback'ında `role='status'` yok. ui.tsx:246-256'da `useLoader` deps değiştiğinde `data`'yı sıfırlamıyor; 70'teki `query.toString()` locale içerdiği için dil değişince eski tablo yükleniyor göstergesi olmadan duruyor.

**Etki:** Ekran okuyucu kullanıcısı tablonun ne zaman geldiğini duymuyor. Dili değiştiren misafir bir süre eski dildeki yorum ve metinleri görüyor ve güncellenip güncellenmediğini bilmiyor.

**Önerilen aksiyon:** Yükleme paragraflarına `role='status'` ekleyin. useLoader'a `loading` bayrağı ekleyin (deps değişince true). Veri yenilenirken tablo kabına `aria-busy` ve görünür 'Güncelleniyor…' metni koyun.

## F674 — Kısa sayısal tarih biçimi EN (en-US) arayüzde gün/ay karışıklığı yaratıyor

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | Medium                                                     |
| Durum               | Aday                                                       |
| Konum               | `src/app/compare/page.tsx:99`                              |
| Diğer konumlar      | `src/app/search/page.tsx:289`, `src/lib/i18n/format.ts:17` |
| Kullanıcılar        | misafir                                                    |
| Prensip             | robustness · task conformance                              |
| Sezgisel madde      | H5 — Hata önleme                                           |
| Renk/tema           | Hayır                                                      |
| Efor                | S                                                          |
| Kaynak denetçiler   | area:cards                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                               |

**Kanıt:** compare/page.tsx:99-100: `f.date(data.checkIn)` varsayılan olarak `short` (`{day:'2-digit', month:'2-digit', year}`, format.ts:17) kullanıyor ve en, `en-US` olarak eşleniyor (format.ts:8). Sonuç '06/24/2027' ya da '10/12/2026' oluyor. search/page.tsx:289'da da aynı durum var. FlexSuggestionNote (search/page.tsx:644) ise `medium` kullanıyor.

**Etki:** EN arayüzü kullanan Türk ya da Avrupalı misafir '10/12/2026' tarihini 10 Aralık olarak okuyabiliyor. Tarih hatasına tolerans çok düşük olduğu için yanlış tarihli rezervasyon riski var.

**Önerilen aksiyon:** Karşılaştırma ve arama başlığında `f.date(x, 'medium')` ('12 Eki 2026' / 'Oct 12, 2026') kullanın; mümkünse hafta günü ekleyin (`weekday: 'short'`).

## F675 — 'Aramaya dön' ve tarih yok durumu bağlamı kaybettiriyor; karşılaştırma sayfasında tarih seçimi yok

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | Medium                                                                    |
| Durum               | Aday                                                                      |
| Konum               | `src/app/compare/page.tsx:103`                                            |
| Diğer konumlar      | `src/app/compare/page.tsx:77`, `src/components/compare/CompareBar.tsx:21` |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | flexibility · task migratability                                          |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                         |
| Renk/tema           | Hayır                                                                     |
| Efor                | M                                                                         |
| Kaynak denetçiler   | area:cards                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                              |

**Kanıt:** compare/page.tsx:77: `<Link href='/search'>` hedef, tarih ve misafir parametresi taşımıyor. 103: `t('noDates')` ('Toplam fiyat için arama sayfasında tarih seçin.') düz metin, bağlantı yok. Sayfada tarih seçici de yok. CompareBar.tsx:21-26 destination parametresini compare URL'ine eklemiyor.

**Etki:** Tarihsiz karşılaştırma yapan misafirin toplam fiyatı görmesi için aramaya dönmesi, hedefi ve tarihleri baştan girmesi, ilanları yeniden bulması ve karşılaştırmayı yeniden açması gerekiyor.

**Önerilen aksiyon:** CompareBar'ın compare URL'ine `from=` (mevcut arama sorgu dizgesi) ekleyin ve 'Aramaya dön' bu adrese gitsin. noDates mesajını bir bağlantıya çevirin ya da sayfaya giriş/çıkış seçici (SearchBar'daki takvim) koyup URL'yi `router.replace` ile güncelleyin.

## F676 — Karşılaştırma sayfasında bir ilanı çıkarma ya da değiştirme olanağı yok

| Alan                | Değer                             |
| ------------------- | --------------------------------- |
| Severity            | Medium                            |
| Durum               | Aday                              |
| Konum               | `src/app/compare/page.tsx:113`    |
| Kullanıcılar        | misafir                           |
| Prensip             | flexibility · dialog initiative   |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü |
| Renk/tema           | Hayır                             |
| Efor                | S                                 |
| Kaynak denetçiler   | area:cards                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**      |

**Kanıt:** compare/page.tsx:113-119'daki sütun başlıklarında yalnızca ilan bağlantısı var; 'Kaldır' düğmesi yok. Sayfa `useCompareSelection` kullanmıyor; id'ler yalnızca URL'den (61) okunuyor.

**Etki:** 4 ilanı karşılaştıran ve birini elemek isteyen misafir aramaya dönüp toggle'ı bulmak ve karşılaştırmayı yeniden açmak zorunda kalıyor.

**Önerilen aksiyon:** Her sütun başlığına `<button aria-label={t('removeNamed', {title})}>` ekleyin. Bu düğme `useCompareSelection().toggle(id)` çağırsın ve `router.replace` ile `ids` parametresini güncellesin. 2'nin altına düşerse needMore durumu gösterilsin.

## F677 — Karşılaştırmadan ilana ve aramaya dönüşte tarih/misafir bağlamı düşüyor; arama kartı ise bu bağlamı taşıyor

| Alan                | Değer                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                |
| Durum               | Aday                                                                                                                  |
| Konum               | `src/app/compare/page.tsx:113`                                                                                        |
| Diğer konumlar      | `src/app/compare/page.tsx:72-75`, `src/components/property/PropertyCard.tsx:50-58`, `src/app/search/page.tsx:637-643` |
| Kullanıcılar        | misafir                                                                                                               |
| Prensip             | flexibility · task migratability / consistency                                                                        |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                                                               |
| Renk/tema           | Hayır                                                                                                                 |
| Efor                | S                                                                                                                     |
| Kaynak denetçiler   | lens:consistency                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                          |

**Kanıt:** compare/page.tsx:113 `<Link href={`/property/${l.id}`}>` tarih ve misafir parametresi taşımıyor, oysa sayfa o tarihlerin toplam fiyatını gösteriyor (:128-131). :72-75 `<Link href="/search">{t("backToSearch")}</Link>` önceki aramayı tamamen sıfırlıyor. Buna karşılık PropertyCard.tsx:50-58 ve search/page.tsx:637-643 (FlexSuggestionNote) `checkIn`, `checkOut`, `guests`, `roomId` ve `ratePlanId` taşıyor. CompareBar.tsx:22-27 bu parametreleri compare'a geçiriyor.

**Etki:** Karşılaştırmada "en uygun" toplamı gördükten sonra ilana geçen misafir, widget'ta yarın-öbür gün varsayılan tarihlerini ve farklı bir fiyatı görür. Karşılaştırma ile rezervasyon arasında fiyat tutarsızlığı oluşur.

**Önerilen aksiyon:** compare/page.tsx'teki ilan bağlantısını PropertyCard'daki gibi `new URLSearchParams({ checkIn, checkOut, guests })` ile kurun (`data.checkIn` varsa). 'Aramaya dön' bağlantısı `sp` içindeki checkIn, checkOut ve guests değerlerini (ve varsa destination'ı) korusun. Bunu `propertyHref(id, stay)` adlı ortak bir yardımcıya taşıyın.

## F678 — İlan sayfasına giden bağlantılar seçili tarih/misafir bağlamını taşımıyor

| Alan                | Değer                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                    |
| Durum               | Aday                                                                                                                      |
| Konum               | `src/app/compare/page.tsx:115`                                                                                            |
| Diğer konumlar      | `src/components/search/ResultsMap.tsx:239`, `src/components/transfers/TransferMarket.tsx:64`, `src/app/cart/page.tsx:119` |
| Kullanıcılar        | misafir                                                                                                                   |
| Prensip             | flexibility · task migratability                                                                                          |
| Sezgisel madde      | H7 — Esneklik/verim                                                                                                       |
| Renk/tema           | Hayır                                                                                                                     |
| Efor                | S                                                                                                                         |
| Kaynak denetçiler   | lens:copy                                                                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                              |

**Kanıt:** compare/page.tsx:115 `href={`/property/${l.id}`}` (karşılaştırma tarih/misafir ile yapılmış olsa da); ResultsMap.tsx:239 harita açılır penceresi `/property/${selected.id}`; TransferMarket.tsx:64; cart/page.tsx:119; booking/[id]/page.tsx:183-188. Oysa PropertyCard.tsx:50-58 ve FlexSuggestionNote (search/page.tsx:637-643) checkIn/checkOut/guests'i taşır.

**Etki:** Misafir karşılaştırdığı toplam fiyatı ilan sayfasında bulamaz; widget varsayılan 'yarın + 1 gece'ye döner, tarihleri yeniden seçmek zorunda kalır.

**Önerilen aksiyon:** Ortak `propertyHref(id, {checkIn, checkOut, guests, roomId, ratePlanId})` yardımcı fonksiyonu yazıp compare, harita, devir ve sepet bağlantılarında kullanın.

## F679 — Karşılaştırma toplam fiyatında 'vergi ve ücretler dahil' ile misafir/gece bağlamı eksik

| Alan                | Değer                          |
| ------------------- | ------------------------------ |
| Severity            | Medium                         |
| Durum               | Aday                           |
| Konum               | `src/app/compare/page.tsx:131` |
| Kullanıcılar        | misafir                        |
| Prensip             | learnability · consistency     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar    |
| Renk/tema           | Hayır                          |
| Efor                | S                              |
| Kaynak denetçiler   | area:cards                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**   |

**Kanıt:** compare/page.tsx:129-138 yalnızca `f.money(total)` + `t('nights')` gösteriyor. PropertyCard.tsx:181 aynı teklif motoru toplamı için `t('card.taxesIncluded')` gösteriyor. compare.json'da vergi niteleyicisi yok.

**Etki:** Para hatasına toleransı düşük misafir karşılaştırma tablosundaki tutarın vergi dahil olup olmadığını bilemiyor ve kartta gördüğü tutarla karşılaştırırken tereddüt ediyor.

**Önerilen aksiyon:** Fiyat hücresine `<span className='block text-xs text-gray-700'>{t('taxesIncluded')}</span>` ekleyin. compare.json TR 'vergi ve ücretler dahil', EN 'taxes and fees included'.

## F680 — İptal politikası satırında açıklanmayan jargon ve göreli saat kullanılıyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/app/compare/page.tsx:168`                               |
| Diğer konumlar      | `messages/tr/compare.json:24`, `messages/tr/compare.json:27` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · familiarity                                   |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                  |
| Renk/tema           | Hayır                                                        |
| Efor                | M                                                            |
| Kaynak denetçiler   | area:cards                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** compare/page.tsx:168: `t(`policy.${kind}`)` 'Orta' ya da 'Katı' gösteriyor (compare.json:27-28); açıklama yok. 171: `t('freeCancel', {hours})` 'Girişten 120 saat öncesine kadar' (docs/img/v4-compare.png). Tarihler bilinirken mutlak son tarih gösterilmiyor.

**Etki:** Misafir 'Orta' politikanın ne demek olduğunu ve 120 saatin hangi güne denk geldiğini hesaplamak zorunda kalıyor. Para iadesi kararında hata riski yükseliyor.

**Önerilen aksiyon:** `hours >= 48` ise gün cinsinden yazın ('5 gün'). `data.checkIn` varsa mutlak tarih gösterin: '{date} tarihine kadar ücretsiz iptal' (`f.date(checkIn - hours, 'medium')`). Politika adının yanına `<details>` ile kısa açıklama ekleyin ('Orta: girişe 5 gün kalana kadar tam iade').

## F681 — Rozet mantığı yanıltıcı: iade edilemez ilana 'En esnek iptal', eşitlikte tek ilana 'en iyi'

| Alan                | Değer                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                              |
| Durum               | Aday                                                                                                |
| Konum               | `src/app/compare/page.tsx:174`                                                                      |
| Diğer konumlar      | `src/lib/ai/listing-compare.ts:127`, `src/app/compare/page.tsx:139`, `src/app/compare/page.tsx:158` |
| Kullanıcılar        | misafir                                                                                             |
| Prensip             | learnability · predictability                                                                       |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                         |
| Renk/tema           | Hayır                                                                                               |
| Efor                | S                                                                                                   |
| Kaynak denetçiler   | area:cards                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                        |

**Kanıt:** compare/page.tsx:174: `{data.diff.mostFlexibleId === l.id && <Badge>{t('badges.mostFlexible')}</Badge>}`. listing-compare.ts:127-130 `listings.length > 0 ? listings.reduce(...)` her zaman bir kazanan seçiyor; tümü NON_REFUNDABLE olsa da ilk ilan kazanıyor. 96 yorumu 'eşitlikte istek sırasındaki ilk ilan kazanır' diyor; bestRated (115-123) ve cheapest (111) için de aynı. Yalnızca bir ilan fiyatlıysa 'En uygun fiyat' ona veriliyor.

**Etki:** Misafir 'En esnek iptal' rozetini görüp iade edilemez bir ilanı seçebiliyor. Bu, para kaybı riski taşıyan bir yanlış yönlendirme. Eşit ilanlardan yalnızca birinin rozet alması da sıralama sırasına bağlı rastgele bir öne çıkarma yaratıyor.

**Önerilen aksiyon:** Diff'te: tümü NON_REFUNDABLE ise ya da en yüksek flexRank birden çok ilanda eşitse `mostFlexibleId = null` yapın (ya da eşitleri dizi olarak döndürüp hepsine rozet verin). cheapest için en az 2 fiyatlı ilan şartı koyun. bestRated eşitliğinde de aynı kuralı uygulayın.

## F682 — Olanak adları veritabanından yalnızca Türkçe geliyor; EN arayüzde karışık dil

| Alan                | Değer                                                    |
| ------------------- | -------------------------------------------------------- |
| Severity            | Medium                                                   |
| Durum               | Aday                                                     |
| Konum               | `src/app/compare/page.tsx:199`                           |
| Diğer konumlar      | `src/lib/ai/listing-compare.ts:334`, `prisma/seed.ts:67` |
| Kullanıcılar        | misafir                                                  |
| Prensip             | learnability · consistency                               |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                              |
| WCAG                | 3.1.2                                                    |
| Renk/tema           | Hayır                                                    |
| Efor                | M                                                        |
| Kaynak denetçiler   | area:cards                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                             |

**Kanıt:** compare/page.tsx:197-199: `{l.amenities.map((a) => <li key={a}>{a}...)}`. listing-compare.ts:334'te `row.amenities.map((a) => a.name)` ham DB adını kullanıyor. seed.ts:67-68'de `{ name: 'Ücretsiz WiFi', icon: 'wifi' }`, `{ name: 'Havuz', icon: 'pool' }`.

**Etki:** EN kullanan misafir tablonun en uzun satırını Türkçe görüyor. Ekran okuyucu Türkçe kelimeleri İngilizce sesle okuyor.

**Önerilen aksiyon:** Olanağın `icon` kodunu anahtar olarak döndürün (`amenities: [{code, name}]`). UI'da `t(`amenities.${code}`)` kullanın ve bilinmeyen kodda `name`'e düşün; bu durumda `<span lang='tr'>` ile sarın.

## F683 — AI bölüm başlığı 'Yorum' misafir yorumlarıyla karışıyor; AI rozeti jargon içeriyor

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                      |
| Durum               | Aday                                                                                        |
| Konum               | `src/app/compare/page.tsx:223`                                                              |
| Diğer konumlar      | `messages/tr/compare.json:43`, `messages/tr/common.json:19`, `src/components/ui/ui.tsx:135` |
| Kullanıcılar        | misafir                                                                                     |
| Prensip             | learnability · predictability                                                               |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                 |
| Renk/tema           | Hayır                                                                                       |
| Efor                | S                                                                                           |
| Kaynak denetçiler   | area:cards                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                |

**Kanıt:** compare/page.tsx:222-224: `<h2>{t('commentary')}</h2>` TR 'Yorum' (compare.json:43). Aynı sayfada puan satırı '(260 yorum)' diyor (compare.json:22). 225'teki `<LlmBadge>` 'Canlı LLM', 'Demo (deterministik)', 'Yedek (LLM başarısız)' gösteriyor (common.json:19-21). Açıklama yalnızca `title` özniteliğinde (ui.tsx:135).

**Etki:** Misafir AI üretimi metni bir misafir yorumu sanabiliyor. 'LLM' ve 'deterministik' terimleri okuryazarlığı sınırlı kullanıcı için anlamsız. Dokunmatik ve klavye kullanıcısı 'doğruluğunu kontrol edin' uyarısını hiç görmüyor.

**Önerilen aksiyon:** Başlığı 'Yapay zekâ özeti' / 'AI summary' yapın. Mod etiketlerini 'Otomatik özet' / 'Hazır şablon' / 'Yedek özet' gibi sade metinlere çevirin. `ai.hint` metnini bölüm içinde görünür `<p className='text-xs'>` olarak gösterin.

## F684 — Çerez bandı (z-50) karşılaştırma çubuğunu (z-40) tamamen örtüyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/compare/CompareBar.tsx:31`    |
| Diğer konumlar      | `src/components/privacy/CookieConsent.tsx:47` |
| Kullanıcılar        | misafir                                       |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:cards                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** CompareBar.tsx:31: `fixed inset-x-0 bottom-0 z-40`. CookieConsent.tsx:47: `fixed inset-x-0 bottom-0 z-50 ... p-4`. İkisi de aynı konumda ve çerez bandı üstte.

**Etki:** İlk ziyaretinde çerez tercihini henüz yapmamış misafir 'Karşılaştırmaya ekle'ye basıyor ama çubuk bandın altında kalıyor. Hiçbir geri bildirim görmüyor ve 'Karşılaştır' bağlantısına ulaşamıyor.

**Önerilen aksiyon:** CookieConsent görünürken yüksekliğini `--cookie-banner-h` değişkeniyle yayınlayın. CompareBar'a `style={{ bottom: 'var(--cookie-banner-h, 0px)' }}` verin ya da çubuğu bandın üstüne istifleyin.

## F685 — Karşılaştırma seçim sayısındaki değişim ekran okuyucuya duyurulmuyor

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Medium                                     |
| Durum               | Aday                                       |
| Konum               | `src/components/compare/CompareBar.tsx:34` |
| Kullanıcılar        | misafir                                    |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages |
| Sezgisel madde      | H12 — Feedback                             |
| WCAG                | 4.1.3                                      |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | area:cards                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**               |

**Kanıt:** CompareBar.tsx:20: `if (ids.length === 0) return null;`, 34: `<span className='font-medium ...'>{t('bar', {count})}</span>`. Canlı bölge yok. Çubuk DOM'da main'den sonra (search/page.tsx:558) mount/unmount oluyor.

**Etki:** Ekran okuyucu kullanıcısı ekleme yaptıktan sonra yalnızca düğme etiketinin değiştiğini duyuyor; kaç ilan seçtiğini ve 'Karşılaştır' bağlantısının sayfa sonunda belirdiğini bilmiyor.

**Önerilen aksiyon:** Her zaman mount edilen bir `<div role='status' aria-live='polite' className='sr-only'>{ids.length > 0 ? t('bar', {count}) : ''}</div>` ekleyin; bu, `return null` dışında kalmalı. 2. seçimden sonra 'Karşılaştırmaya hazır' duyurusu yapın.

## F686 — Çubuk hangi ilanların seçili olduğunu göstermiyor; seçim aramalar arasında gizlice kalıyor

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Medium                                                    |
| Durum               | Aday                                                      |
| Konum               | `src/components/compare/CompareBar.tsx:34`                |
| Diğer konumlar      | `src/components/compare/useCompareSelection.ts:43`        |
| Kullanıcılar        | misafir                                                   |
| Prensip             | learnability · synthesizability (recognition over recall) |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                   |
| Renk/tema           | Hayır                                                     |
| Efor                | M                                                         |
| Kaynak denetçiler   | area:cards                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                              |

**Kanıt:** CompareBar.tsx:34 yalnızca sayıyı (`t('bar', {count})`) gösteriyor. useCompareSelection.ts:7 ve 43 seçimi `localStorage` ('compare:ids') içinde süresiz tutuyor ve yalnızca id saklıyor. Tek tek kaldırma ancak ilgili kart görünürken mümkün.

**Etki:** Dün İstanbul araması yapmış misafir bugün Antalya'da '2 ilan seçildi' görüyor ama hangileri olduğunu bilmiyor. Karşılaştırmayı açınca beklemediği ilanlarla karşılaşıyor ve yalnızca 'Temizle' ile hepsini silebiliyor.

**Önerilen aksiyon:** Seçimde `{id, title, thumb}` saklayın. Çubukta her seçim için bir çip (küçük görsel + başlık + `<button aria-label={t('removeNamed', {title})}>×</button>`) gösterin. Mobilde çipleri açılır bir panelde sunun.

## F687 — 'Temizle' tüm seçimi onaysız ve geri alınamaz şekilde siliyor; etiket bağlamsız

| Alan                | Değer                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Severity            | Medium                                                                           |
| Durum               | Aday                                                                             |
| Konum               | `src/components/compare/CompareBar.tsx:36`                                       |
| Diğer konumlar      | `src/components/compare/useCompareSelection.ts:70`, `messages/tr/compare.json:9` |
| Kullanıcılar        | misafir                                                                          |
| Prensip             | robustness · recoverability                                                      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                |
| Renk/tema           | Hayır                                                                            |
| Efor                | S                                                                                |
| Kaynak denetçiler   | area:cards                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                     |

**Kanıt:** CompareBar.tsx:36-38: `<button type='button' onClick={clear} ...>{t('clear')}</button>`. compare.json:9 'Temizle' / 'Clear'. useCompareSelection.ts:70'te `clear = () => write([])` çalışıyor; önceki değer saklanmıyor.

**Etki:** Farklı aramalardan topladığı 4 ilanı yanlışlıkla silen misafir hepsini yeniden bulmak zorunda kalıyor. Ekran okuyucu yalnızca 'Temizle' duyuyor ve neyin temizleneceğini bilmiyor.

**Önerilen aksiyon:** clear öncesi id'leri state'te saklayın ve 8 saniye boyunca `role='status'` içinde 'Seçim temizlendi — Geri al' gösterin (Geri al, `write(prev)` çağırsın). Etiketi 'Seçimi temizle' / 'Clear selection' yapın.

## F688 — Karşılaştırmaya ekleme yalnızca arama liste görünümünde mümkün

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Aday                                                 |
| Konum               | `src/components/compare/CompareToggle.tsx:8`         |
| Diğer konumlar      | `src/app/page.tsx:86`, `src/app/search/page.tsx:542` |
| Kullanıcılar        | misafir                                              |
| Prensip             | flexibility · task migratability                     |
| Sezgisel madde      | H7 — Esneklik/verim                                  |
| Renk/tema           | Hayır                                                |
| Efor                | M                                                    |
| Kaynak denetçiler   | area:cards                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                         |

**Kanıt:** CompareToggle ve CompareBar yalnızca search/page.tsx:542 ve 558'de kullanılıyor (grep). app/page.tsx:86'daki öne çıkan PropertyCard'larda ve property/[id] detay sayfasında karşılaştırma eylemi yok. /compare'a tek giriş CompareBar.tsx:41.

**Etki:** Ana sayfada ya da ilan detayında beğendiği ilanı karşılaştırmaya eklemek isteyen misafir aramayı yeniden yapıp ilanı listede bulmak zorunda kalıyor.

**Önerilen aksiyon:** CompareToggle'ı PropertyCard içine opsiyonel bir `showCompare` prop'u ile taşıyın ve ana sayfada da açın. İlan detay sayfasına CompareToggle + CompareBar ekleyin.

## F689 — Karşılaştırma dolunca düğme disabled oluyor ve nedeni yalnızca title ipucunda

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/compare/CompareToggle.tsx:17` |
| Diğer konumlar      | `src/components/compare/CompareBar.tsx:34`    |
| Kullanıcılar        | misafir                                       |
| Prensip             | learnability · predictability (feedforward)   |
| Sezgisel madde      | H13 — Feedforward                             |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:cards                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** CompareToggle.tsx:12: `const disabled = !selected && full;`, 17: `disabled={disabled}`, 18: `title={disabled ? t('full') : undefined}`. Arama sayfasında 4 ilan sınırı önceden belirtilmiyor; intro yalnızca compare sayfasında (compare.json:3) var. CompareBar 4/4 durumunu da göstermiyor.

**Etki:** Disabled düğme sekme sırasından çıktığı için klavye kullanıcısı ve ekran okuyucu düğmeyi ve nedenini hiç bulamıyor. Dokunmatik kullanıcı title ipucunu göremiyor. Mobil misafir 'neden tıklanmıyor' diye kalıyor.

**Önerilen aksiyon:** `disabled` yerine `aria-disabled={disabled}` kullanın ve onClick'te disabled ise erken dönün. Görünür bir açıklama ekleyin (`aria-describedby` ile bağlı `<span>{t('full')}</span>`). CompareBar metnini `t('bar', {count, max: 4})` ('3/4 ilan seçildi') yapın.

## F690 — Önemli açıklamalar yalnız `title` ipucunda, dokunmatikte hiç görünmüyor

| Alan                | Değer                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                |
| Durum               | Aday                                                                                  |
| Konum               | `src/components/compare/CompareToggle.tsx:18`                                         |
| Diğer konumlar      | `src/components/ui/ui.tsx:135`, `src/components/property/AccessibilitySection.tsx:46` |
| Kullanıcılar        | misafir                                                                               |
| Prensip             | robustness · observability                                                            |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                               |
| Renk/tema           | Hayır                                                                                 |
| Efor                | S                                                                                     |
| Kaynak denetçiler   | lens:mobile                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                          |

**Kanıt:** CompareToggle.tsx:18 `title={disabled ? t("full") : undefined}`. 5. ilanda düğme devre dışı kalıyor ve nedeni ('En fazla 4 ilan karşılaştırılabilir') yalnız title'da. Devre dışı öğelerde ve dokunmatik ekranlarda bu ipucu hiç görünmez. ui.tsx:135 LlmBadge `title={t("ai.hint")}` ('Yapay zekâ çıktısı — doğruluğunu kontrol edin') tüm AI rozetlerinde yalnız hover'da. AccessibilitySection.tsx:46'da 'Doğrulandı' rozetinin anlamı ('Platform ekibi … fotoğraf kanıtıyla doğruladı') yalnız title'da.

**Etki:** Mobil misafir karşılaştırma düğmesinin neden çalışmadığını göremiyor. AI çıktısını doğrulama uyarısını ve erişilebilirlik 'Doğrulandı' rozetinin anlamını hiç görmüyor, güven kararlarını eksik bilgiyle veriyor.

**Önerilen aksiyon:** CompareToggle: düğmeyi `aria-disabled` ile etkin bırak; dokunulunca CompareBar'da `role="status"` ile 'En fazla 4 ilan; önce birini çıkarın' göster. LlmBadge: yanına ⓘ toggletip düğmesi koy (`aria-expanded`, dokunarak açılan popover) ya da kısa uyarıyı görünür metin olarak ekle. AccessibilitySection: verifiedHint'i bölüm açıklamasında (:30) bir kez görünür metin olarak yaz.

## F691 — Karşılaştırma sınırı (en fazla 4) yalnız title ipucuyla bildiriliyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/compare/CompareToggle.tsx:18` |
| Diğer konumlar      | `messages/tr/compare.json:6`                  |
| Kullanıcılar        | misafir                                       |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H12 — Feedback                                |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | lens:copy                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** CompareToggle.tsx:17-18 `disabled={disabled}` ve `title={disabled ? t("full") : undefined}` — devre dışı düğme klavyeyle odaklanamaz, dokunmatikte title görünmez; neden pasif olduğu başka hiçbir yerde yazmaz.

**Etki:** Mobil misafir beşinci ilanı eklemeye çalıştığında düğmenin neden çalışmadığını anlamaz.

**Önerilen aksiyon:** Düğmeyi pasif yapmak yerine tıklamada CompareBar'da role=status ile 'En fazla 4 ilan karşılaştırılabilir — birini çıkarın' mesajı gösterin veya pasif düğmenin yanına görünür kısa açıklama ekleyin.

## F692 — Fotoğrafı olmayan ilanda stok otel fotoğrafı ilanın kendi fotoğrafı gibi gösteriliyor

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Aday                                                 |
| Konum               | `src/components/property/PropertyCard.tsx:14`        |
| Diğer konumlar      | `src/app/search/page.tsx:513`, `src/app/page.tsx:93` |
| Kullanıcılar        | misafir                                              |
| Prensip             | learnability · predictability                        |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                          |
| WCAG                | 1.1.1                                                |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | area:cards                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                         |

**Kanıt:** PropertyCard.tsx:14'te `imageUrl: string` zorunlu. Çağıranlar boş görsel için sabit bir Unsplash fotoğrafı geçiyor: search/page.tsx:511-514 ve app/page.tsx:91-94 `?? 'https://images.unsplash.com/photo-1566073771259-...'`. PropertyCard.tsx:97 bu stok görsele de `alt={title}` veriyor.

**Etki:** Misafir, gerçekte ev sahibinin fotoğraf yüklemediği bir pansiyonu lüks otel havuzu fotoğrafıyla görüyor. Ekran okuyucu bunu ilanın fotoğrafı olarak duyuruyor. Beklenti ile gerçek arasındaki uyumsuzluk güveni zedeliyor.

**Önerilen aksiyon:** `imageUrl` alanını opsiyonel yapın. Yoksa kartta nötr bir yer tutucu (ikon + görünür 'Fotoğraf eklenmemiş' metni) gösterin ve `alt=''` verin. Stok URL'yi çağıranlardan kaldırın.

## F693 — Oturumsuz misafir favori düğmesine basınca hiçbir şey olmuyor (401 kontrolü mesaj metninde aranıyor)

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/property/PropertyCard.tsx:84` |
| Diğer konumlar      | `src/app/api/favorites/route.ts:8-9`          |
| Kullanıcılar        | misafir                                       |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H9 — Hata mesajları                           |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:home                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** `if (!res.ok) throw new Error("Favori eklenemedi");` (80) ardından catch'te `if (err instanceof Error && err.message.includes("401")) { router.push("/login"); }` (84-88). Mesaj hiçbir zaman '401' içermediği için oturumsuz kullanıcıda (api/favorites/route.ts:8-9 401 döndürür) yönlendirme çalışmıyor ve başka bir geri bildirim de yok. Ham `fetch` kullanıldığı için apiFetch'in 401'de token yenileme davranışı (api-client.ts:66-68) da devre dışı.

**Etki:** Oturumsuz misafir ana sayfada kalbe basıyor; düğme kısa süre pasifleşiyor ve hiçbir şey olmuyor. Favori özelliğinin bozuk olduğunu düşünüyor, giriş yapması gerektiğini öğrenemiyor.

**Önerilen aksiyon:** `res.ok` kontrolünden önce `if (res.status === 401) { router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`); return; }` ekleyin (ya da `apiFetch` kullanıp `ApiError.status === 401` kontrol edin). Diğer hatalarda kart içinde `role="status"` bir mesaj gösterin (`t('card.favoriteFailed')`).

## F694 — İlan kartında görsele dokunmak hiçbir şey yapmıyor

| Alan                | Değer                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                         |
| Durum               | Aday                                                                                           |
| Konum               | `src/components/property/PropertyCard.tsx:94`                                                  |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:134`, `src/components/property/PropertyCard.tsx:190` |
| Kullanıcılar        | misafir                                                                                        |
| Prensip             | learnability · familiarity                                                                     |
| Sezgisel madde      | H11 — Affordance                                                                               |
| Renk/tema           | Hayır                                                                                          |
| Efor                | S                                                                                              |
| Kaynak denetçiler   | lens:mobile                                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                   |

**Kanıt:** PropertyCard.tsx:94-101 görsel kabı (`<div className="relative h-48 overflow-hidden">`) bir bağlantı değil. İlana yalnız :134'teki başlık metniyle ve :190'daki 'Fırsatı gör' bağlantısıyla gidiliyor. Kartın en büyük alanı (192px'lik görsel) etkileşimsiz. :100 `group-hover:scale-105` etkileşim ipucunu yalnız fareyle veriyor.

**Etki:** Mobil kullanıcı alışkanlıkla fotoğrafa dokunuyor ve tepki alamıyor. Tekrar dokunurken aynı alandaki (:108) favori düğmesine yanlışlıkla basabiliyor.

**Önerilen aksiyon:** Görseli `<Link href={href} tabIndex={-1} aria-hidden="true">` ile sar (klavye ve ekran okuyucu için tek bağlantı başlık kalsın) ya da başlık bağlantısına `after:absolute after:inset-0` ile 'stretched link' uygula. Favori düğmesine `relative z-10` ver.

## F695 — Kart fotoğrafı tıklanmıyor ama hover'da büyüyerek tıklanabilir izlenimi veriyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/property/PropertyCard.tsx:100` |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · familiarity / affordance        |
| Sezgisel madde      | H11 — Affordance                               |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:cards                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** PropertyCard.tsx:94-101: `<div className='relative h-48 ...'><Image ... className='... group-hover:scale-105' />` herhangi bir Link içinde değil. Bağlantı yalnızca h3 başlıkta (134) ve 'Fırsatı Gör' düğmesinde (190) bulunuyor.

**Etki:** Mobil ağırlıklı misafir kartın en büyük alanı olan fotoğrafa (192px yükseklik) dokunuyor ve hiçbir şey olmuyor. OTA alışkanlığıyla (fotoğraf = detay) çelişiyor. Hover efekti masaüstünde yanlış affordance veriyor.

**Önerilen aksiyon:** Başlık bağlantısına `after:absolute after:inset-0 after:content-['']` (stretched link) uygulayıp kart köküne `relative` verin. Favori düğmesine `relative z-10` vererek üstte tutun. Böylece tüm kart tek sekme duraklı bir bağlantı olur. Bu yapılmazsa `group-hover:scale-105` efektini kaldırın.

## F696 — Favori isteği sırasında düğme disabled oluyor ve klavye odağı kayboluyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/property/PropertyCard.tsx:105` |
| Kullanıcılar        | misafir                                        |
| Prensip             | accessibility · WCAG 2.4.3 Focus Order         |
| Sezgisel madde      | H12 — Feedback                                 |
| WCAG                | 2.4.3                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:cards                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** PropertyCard.tsx:105: `disabled={busy}`. HTML focus fixup kuralına göre odaklı öğe disabled olunca odak viewport/body'ye düşüyor. 66'daki `if (busy) return;` çift tıklamayı zaten engelliyor, yani `disabled` gereksiz. Ayrıca `aria-busy` ya da yükleniyor göstergesi yok; yalnızca `disabled:opacity-50` var.

**Etki:** Klavyeyle Enter'a basan kullanıcı odağı kaybediyor. Sonraki Tab'ın nereden devam edeceği belirsizleşiyor ve ekran okuyucu bağlamı sıfırlanıyor.

**Önerilen aksiyon:** `disabled` yerine `aria-disabled={busy}` ve `aria-busy={busy}` kullanın; mevcut `if (busy) return` korumasını bırakın. Görsel olarak `aria-[disabled=true]:opacity-50` uygulayın.

## F697 — Aç/kapa düğmelerinde hem aria-pressed hem değişen etiket kullanılıyor, duyurular çelişkili

| Alan                | Değer                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                       |
| Durum               | Aday                                                                                         |
| Konum               | `src/components/property/PropertyCard.tsx:106`                                               |
| Diğer konumlar      | `src/components/compare/CompareToggle.tsx:16`, `src/components/compare/CompareToggle.tsx:25` |
| Kullanıcılar        | misafir                                                                                      |
| Prensip             | accessibility · WCAG 4.1.2 Name, Role, Value                                                 |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                  |
| WCAG                | 4.1.2                                                                                        |
| Renk/tema           | Hayır                                                                                        |
| Efor                | S                                                                                            |
| Kaynak denetçiler   | area:cards                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                 |

**Kanıt:** PropertyCard.tsx:106-107: `aria-pressed={isFavorite}` + `aria-label={isFavorite ? t('card.removeFavorite') : t('card.addFavorite')}`. CompareToggle.tsx:16 ve 25: `aria-pressed={selected}` + `{selected ? t('remove') : t('add')}`.

**Etki:** Ekran okuyucu 'Favorilerden çıkar, aç/kapa düğmesi, basılı' ya da 'Karşılaştırmadan çıkar, basılı' okuyor. Kullanıcı düğmeye basarsa ne olacağını ve şu anki durumu ayırt edemiyor; durum çift kodlandığı için ters anlaşılıyor.

**Önerilen aksiyon:** İki yoldan birini tutarlı uygulayın: (a) sabit etiket + aria-pressed, örneğin `aria-label={t('card.favorite', {title})}` ('Favori: {title}') ve 'Karşılaştır: {title}'; (b) aria-pressed'i kaldırıp yalnızca eylem etiketi kullanmak. Bileşenler arasında aynı deseni seçin.

## F698 — Kart eylem düğmelerinin erişilebilir adı ilan adını içermiyor; favori düğmesi başlıktan önce geliyor

| Alan                | Değer                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                        |
| Durum               | Aday                                                                                          |
| Konum               | `src/components/property/PropertyCard.tsx:107`                                                |
| Diğer konumlar      | `src/components/compare/CompareToggle.tsx:25`, `src/components/property/PropertyCard.tsx:194` |
| Kullanıcılar        | misafir                                                                                       |
| Prensip             | accessibility · WCAG 2.4.6 Headings and Labels                                                |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                         |
| WCAG                | 2.4.6                                                                                         |
| Renk/tema           | Hayır                                                                                         |
| Efor                | S                                                                                             |
| Kaynak denetçiler   | area:cards                                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                  |

**Kanıt:** PropertyCard.tsx:107 her kartta aynı 'Favorilere ekle' etiketini veriyor. CompareToggle.tsx:8 yalnızca `propertyId` alıyor, 25'te etiket her yerde 'Karşılaştırmaya ekle'. PropertyCard.tsx:190-195'teki 'Fırsatı Gör' bağlantısı 24 kez aynı metinle tekrar ediyor. Favori düğmesi (102) DOM'da h3 başlıktan (133) önce yer alıyor.

**Etki:** Ekran okuyucunun düğme/bağlantı listesinde 24 adet özdeş 'Favorilere ekle', 'Karşılaştırmaya ekle' ve 'Fırsatı Gör' görünüyor. Sekmeyle gezen kullanıcı favori düğmesine ilan adını duymadan ulaşıyor ve hangi ilanı eklediğini bilemiyor.

**Önerilen aksiyon:** Favori için `aria-label={t('card.favorite', {title})}` kullanın. CompareToggle'a `title` prop'u ekleyip `aria-label={t('addNamed', {title})}` verin. 'Fırsatı Gör' bağlantısına `<span className='sr-only'>: {title}</span>` ekleyin. Favori düğmesini DOM'da başlıktan sonraya taşıyın; görsel konum `absolute` ile korunabilir.

## F699 — Sık kullanılan dokunma hedefleri 44px önerisinin altında

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Konum               | `src/components/property/PropertyCard.tsx:108`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:155`, `src/components/search/DateRangePicker.tsx:146`, `src/components/layout/ThemeToggle.tsx:43`, `src/components/layout/LocaleSwitcher.tsx:29`, `src/app/search/page.tsx:448`, `src/components/property/PriceCalendar.tsx:206`, `src/components/search/SmartFilter.tsx:140`, `src/components/account/SessionManager.tsx:139`, `src/components/account/PasskeyManager.tsx:136`, `src/components/cart/SplitPayPanel.tsx:234`, `src/components/search/RankingWhy.tsx:23`, `src/components/property/ReviewsSection.tsx:73`, `src/components/compare/CompareToggle.tsx:20`, `src/styles/globals.css:73` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Prensip             | accessibility · WCAG 2.5.8 hedef boyutu (24px asgari karşılanıyor) / 44px önerisi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sezgisel madde      | H11 — Affordance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| WCAG                | 2.5.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Kaynak denetçiler   | lens:mobile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Kanıt:** PropertyCard.tsx:108 favori düğmesi `p-2` + 20px ikon = 36px ve görselin köşesinde. SearchBar.tsx:155/164/180/189/202/211 adımlayıcılar `h-8 w-8` (32px), aralarında 12px. DateRangePicker.tsx:146/174 ay okları `p-1.5` + 20px = 32px. ThemeToggle.tsx:43 ve LocaleSwitcher.tsx:29 `min-h-[1.75rem]` (28px). search/page.tsx:448 liste/harita geçişi `px-3 py-1 text-sm` ≈28px. PriceCalendar.tsx:206/217 ay gezinme `px-3 py-1` ≈30px. SmartFilter.tsx:140 çip kaldırma `px-3 py-1 text-xs` ≈24px. SessionManager.tsx:139 ve PasskeyManager.tsx:136 'Kapat/Sil' `px-3 py-1 text-xs` ≈26px. SplitPayPanel.tsx:234 '×' `pb-2 text-sm` (genişliği yalnız globals.css:81 min-width 24px'ten geliyor). RankingWhy.tsx:23 `<summary>` text-xs, ReviewsSection.tsx:73-95 şikâyet düğmeleri text-xs. globals.css:73-82 güvenlik ağı yalnız 24px sağlıyor ve `a`/`summary` öğelerini kapsamıyor.

**Etki:** Mobil misafir favori, misafir sayısı, ay değiştirme ve görünüm geçişi gibi sık dokunulan kontrollerde ıskalıyor. Yan yana küçük hedeflerde (−/+, Kapat/Sil) yanlış eylem riski var. Motor güçlüğü olan kullanıcı için Fitts maliyeti yüksek.

**Önerilen aksiyon:** globals.css'e şunu ekle: `@media (pointer: coarse) { button, select, summary, [role=button] { min-height: 2.75rem; min-width: 2.75rem } }`. İkon düğmelerinde (favori, adımlayıcı, ay okları) `h-11 w-11` kullan. Metin düğmelerinde AccessibilityReviewQueue.tsx:98'deki `min-h-[2.5rem]` desenini `inline-flex min-h-11 items-center px-2` olarak uygula. '×' yerine görünür 'Kaldır' metni koy. Onay kutusu ve radyo satırlarında etiketi `min-h-11` yap.

## F700 — Arama sayfasında kart başlıkları 'Filtreler' başlığının altına düşüyor; sonuçlar liste değil

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/components/property/PropertyCard.tsx:133`               |
| Diğer konumlar      | `src/app/search/page.tsx:326`, `src/app/search/page.tsx:504` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | accessibility · WCAG 1.3.1 Info and Relationships            |
| Sezgisel madde      | H14 — Erişilebilirlik                                        |
| WCAG                | 1.3.1                                                        |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | area:cards                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** PropertyCard.tsx:133 `<h3>`, kart kökü 93 `<div>`. search/page.tsx:326'da aside içinde `<h2>{t('filters.title')}</h2>` var; sonuç bölümünde h2 yok. 504-505'te ızgara `<div className='grid ...'>{visibleResults.map(... <div key>)}` şeklinde, liste semantiği yok.

**Etki:** Başlıklarla gezinen ekran okuyucu kullanıcısı tüm ilan başlıklarını 'Filtreler' bölümünün alt başlıkları olarak duyuyor. 'Liste, 24 öğe' bilgisi olmadığından sonuç sayısı ve konumu (3/24) algılanamıyor.

**Önerilen aksiyon:** search/page.tsx'te ızgaradan önce `<h2 className='sr-only'>{t('resultsHeading')}</h2>` ekleyin. Izgarayı `<ul role='list'>` ve her öğeyi `<li>` yapın. PropertyCard kökünü `<article aria-labelledby={`card-${id}-title`}>` yapıp h3'e o id'yi verin.

## F701 — Değerlendirmesi olmayan ilan '0.0' puan rozetiyle gösteriliyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/property/PropertyCard.tsx:163` |
| Diğer konumlar      | `src/app/compare/page.tsx:155`                 |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · consistency                     |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                    |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:cards                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** PropertyCard.tsx:163-168 `reviewCount` 0 olduğunda da `{rating.toFixed(1)}` ('0.0') ve '0 değerlendirme' basıyor. Karşılaştırma sayfası (compare/page.tsx:155-157) aynı durumda `t('noRating')` ('Henüz puan yok') gösteriyor.

**Etki:** Yeni ilanlar en kötü puanlı ilan gibi görünüyor ve misafir bunları yanlış yere eliyor. İki ekran aynı durumu farklı gösteriyor.

**Önerilen aksiyon:** `reviewCount === 0` ise rozeti gizleyin ve yerine `t('card.noReviews')` ('Henüz değerlendirme yok' / 'Yeni') metnini koyun. Anahtarı search.json TR/EN'ye ekleyin.

## F702 — Puan rozetinde ölçek yok ve sayı yerelleştirilmemiş; karşılaştırma sayfası aynı veriyi '/5' ile gösteriyor

| Alan                | Değer                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                        |
| Durum               | Aday                                                                                          |
| Konum               | `src/components/property/PropertyCard.tsx:164`                                                |
| Diğer konumlar      | `src/app/compare/page.tsx:156`, `messages/tr/compare.json:22`, `src/lib/search/ranking.ts:69` |
| Kullanıcılar        | misafir                                                                                       |
| Prensip             | learnability · consistency                                                                    |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                   |
| Renk/tema           | Hayır                                                                                         |
| Efor                | M                                                                                             |
| Kaynak denetçiler   | area:results                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                  |

**Kanıt:** PropertyCard.tsx:163-165 `{rating.toFixed(1)}` '8.6' üretiyor: ölçek belirtilmiyor, TR'de '8,6' olmalı, puansız ilanda '0.0' görünüyor. Seed verisi 0-10 ölçeğinde (prisma/seed.ts:311 `ratingAvg: 8.9`), ama compare/page.tsx:156 ile messages/tr/compare.json:22 '{avg}/5' kullanıyor ve '8,9/5' çıkıyor. Sıralama da puanı 5'e bölüyor (src/lib/search/ranking.ts:69 `rating: clamp01(bayesianRating(...) / 5)`); bu yüzden 5'in üstündeki her ilan 1'e kırpılıyor ve 'Bu sıralama neden?' her kartta aynı 'Misafir puanı 0.350' değerini gösteriyor.

**Etki:** Misafir 8.6'nın 10 üzerinden mi olduğunu bilemiyor; karşılaştırma sayfasında '8,9/5' gibi imkânsız bir değer görüyor. Şeffaflık panelinde puanın sıralamaya etkisi anlamsız görünüyor.

**Önerilen aksiyon:** Tek bir ölçek belirleyin (0-10). Kartta f.number(rating) ile görünür '/10' ya da sözel bir etiket ('Çok iyi') kullanın. Puansız ilanda 'Henüz puan yok' (compare.json noRating) gösterin. compare.json'daki ratingValue'yu '/10' yapın ve ranking.ts'deki böleni ölçekle eşleştirin. Rozete aria-label='Misafir puanı 8,6 / 10' verin.

## F703 — Sayılar yerel ayara göre biçimlenmiyor (toFixed ile '4.5', '%72.5', '×1.08')

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Konum               | `src/components/property/PropertyCard.tsx:164`                                                                                                                                                                                                                                                                                                                                                                                                        |
| Diğer konumlar      | `src/app/property/[id]/page.tsx:145`, `src/app/account/page.tsx:380`, `src/components/host/HostDashboard.tsx:232`, `src/components/host/RevenueDashboard.tsx:195`, `src/components/host/RevenueDashboard.tsx:264`, `src/components/admin/AdminDashboard.tsx:443`, `src/components/search/RankingWhy.tsx:34`, `src/components/admin/SupportAdmin.tsx:93`, `src/components/booking/QuoteBreakdown.tsx:20`, `src/components/host/PromotionsPanel.tsx:74` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Prensip             | learnability · consistency                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Kanıt:** PropertyCard.tsx:164 `rating.toFixed(1)`; property/[id]/page.tsx:145, account/page.tsx:380, HostDashboard.tsx:232 aynı; RevenueDashboard.tsx:264 `(k.occupancy * 100).toFixed(1)` → '%72.5', 195 `×{c.multiplier.toFixed(2)}`; AdminDashboard.tsx:443; RankingWhy.tsx:27,34; SupportAdmin.tsx:93; QuoteBreakdown.tsx:20 ve PromotionsPanel.tsx:74 `String(bps / 100)`. Karşı örnek: compare/page.tsx:156 `f.number(l.rating.avg)` doğru.

**Etki:** TR kullanıcı ondalık virgül beklerken nokta görür; aynı puan karşılaştırmada '8,6', kartta '8.6' olarak tutarsız görünür.

**Önerilen aksiyon:** Tüm toFixed/String(bps/100) çağrılarını f.number(value, { maximumFractionDigits: n }) ve yüzdeler için f.number(v, { style: 'percent' }) ile değiştirin; ESLint kuralıyla TSX'te toFixed kullanımını yasaklayın.

## F704 — Tarih seçiliyken kart 'tarih seçince vergi ve ücretler eklenir' diyor (akıllı filtre yolu)

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/components/property/PropertyCard.tsx:187`               |
| Diğer konumlar      | `src/app/search/page.tsx:181`, `src/app/search/page.tsx:521` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | robustness · observability                                   |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                               |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | area:cards                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** PropertyCard.tsx:183-187: `stay` yoksa `t('card.fromPerNight')` + `t('card.taxesOnDates')` gösteriliyor. search/page.tsx:179-182'de akıllı filtre aktifken `params = smartToParams(smartFilters)` URL'deki checkIn/checkOut'u taşımıyor; 521 ise `property.quote && checkIn && checkOut` arıyor. docs/img/search-smart-filter.png'de başlıkta '29.10.2026 - 01.11.2026' yazarken kartlarda 'tarih seçince vergi ve ücretler eklenir' görünüyor.

**Etki:** Misafir ekranın üstünde seçili tarihlerini, kartta ise 'tarih seçin' uyarısını görüyor. Kartta gördüğü fiyatın toplam mı gecelik mi olduğu belirsizleşiyor; çelişkili durum güveni zedeliyor.

**Önerilen aksiyon:** smartToParams'a, akıllı filtre tarih çıkarmadıysa URL'deki `checkIn`/`checkOut` değerlerini ekleyin. PropertyCard'a `datesSelected` prop'u verin; tarih var ama `stay` yoksa `taxesOnDates` yerine 'Bu tarihler için toplam hesaplanamadı' gibi doğru bir metin gösterin.

## F705 — Mülk kartında aynı hedefe iki bağlantı; 'Fırsatı Gör' bağlamsız ve 24 kez tekrarlanıyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Aday                                                                          |
| Konum               | `src/components/property/PropertyCard.tsx:190`                                |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:133`, `src/app/search/page.tsx:504` |
| Kullanıcılar        | misafir                                                                       |
| Prensip             | accessibility · Link Purpose (In Context)                                     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                   |
| WCAG                | 2.4.4                                                                         |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | lens:a11y                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                  |

**Kanıt:** 133-136 başlık bağlantısı `<Link href={href}>{title}</Link>` ve 190-195 `<Link href={href} ...>{t("card.seeDeal")}</Link>` aynı href; kart kapsayıcısı `<div>` (93) ve sonuç ızgarası da `<div>` (search/page.tsx:504-506) — bağlantı bağlamı programatik olarak belirlenemiyor.

**Etki:** Ekran okuyucu bağlantı listesinde 24 adet 'Fırsatı Gör' ayırt edilemiyor; klavye kullanıcısı her kartta iki gereksiz Tab durağıyla karşılaşıyor (karşılaştırma görevi yavaşlıyor).

**Önerilen aksiyon:** seeDeal bağlantısına `<span className="sr-only">: {title}</span>` ya da `aria-describedby={titleId}` ekleyin; mümkünse tek bağlantı (başlık) bırakıp kartı 'stretched link' yapın; sonuçları `<ul>/<li>` içine alın.

## F706 — 'Fırsatı Gör' CTA'sı sonucu doğru öngörmüyor ve aynı hedefe ikinci sekme durağı ekliyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/components/property/PropertyCard.tsx:194`               |
| Diğer konumlar      | `messages/tr/search.json:111`, `messages/en/search.json:111` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | learnability · predictability (feedforward)                  |
| Sezgisel madde      | H13 — Feedforward                                            |
| WCAG                | 2.4.4                                                        |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | area:cards                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** PropertyCard.tsx:190-195'teki `<Link href={href}>{t('card.seeDeal')}</Link>`, 134'teki başlık bağlantısıyla aynı `href`'e gidiyor. messages/tr/search.json:111 'Fırsatı Gör', en: 'See deal'. Kartta indirim ya da fırsat bilgisi bulunmuyor.

**Etki:** 'Fırsat' kelimesi indirim vaat ediyor ama hedef sıradan ilan detayı; bu yanıltıcı bir feedforward. Her kart 2 bağlantı + favori + karşılaştır + benzerleri olmak üzere 5 sekme durağı içeriyor; 24 kartta yaklaşık 120 durak ediyor ve klavye kullanıcısının işini yavaşlatıyor.

**Önerilen aksiyon:** Metni duruma göre değiştirin: `stay` varsa 'Odayı gör' / 'See room', yoksa 'Fiyatları gör' / 'See prices'. Stretched-link uygulanırsa CTA'ya `tabIndex={-1} aria-hidden` verin ya da başlık bağlantısını tek sekme durağı olarak bırakın.

## F707 — Harita başlatılırken ve karolar yüklenirken durum bildirimi yok, işaretçiler geç beliriyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/search/ResultsMap.tsx:124`  |
| Diğer konumlar      | `src/app/search/page.tsx:32`                |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · observability / responsiveness |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü              |
| WCAG                | 4.1.3                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:cards                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** ResultsMap.tsx:98: `useState<...>(null)`; 124: `view ? index.items(...) : []`. İşaretçiler ancak `onLoad={syncView}` (164) sonrasında çiziliyor. Bu arada yalnızca boş bir kutu var. search/page.tsx:32'deki `MapLoading` yalnızca JS paketi için gösteriliyor ve `<p>` öğesinin `role='status'` özniteliği yok.

**Etki:** Yavaş ağda misafir saniyelerce boş gri bir kutu görüyor ve haritanın bozuk olduğunu düşünüyor. Ekran okuyucu yükleme durumunu ya da tamamlandığını duymuyor.

**Önerilen aksiyon:** `const [ready, setReady] = useState(false)` ekleyin, onLoad'da `setReady(true)` yapın. Hazır olana kadar kap üzerinde `<p role='status' className='absolute inset-0 grid place-items-center'>{t('mapLoading')}</p>` gösterin. MapLoading'e `role='status'` ekleyin.

## F708 — Mobilde 480px sabit yükseklikteki harita sayfa kaydırmasını yutuyor

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Medium                                     |
| Durum               | Aday                                       |
| Konum               | `src/components/search/ResultsMap.tsx:158` |
| Kullanıcılar        | misafir                                    |
| Prensip             | robustness · task conformance (mobil)      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü          |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | area:cards                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**               |

**Kanıt:** ResultsMap.tsx:158: `<div className='h-[480px] w-full ...'>`. 159-171'de `cooperativeGestures` verilmemiş. MapLibre tek parmakla sürüklemeyi pan olarak yorumluyor. search/page.tsx:486'da mobilde `grid-cols-1` olduğu için yan liste haritanın altında kalıyor.

**Etki:** 360x640 ekranda harita görünür alanın yaklaşık %75'ini kaplıyor. Mobil misafir aşağı kaydırmak istediğinde haritayı kaydırıyor ve haritanın altındaki liste ile Footer'a ulaşamıyor (kaydırma tuzağı).

**Önerilen aksiyon:** Map'e `cooperativeGestures` prop'u verin ve mesajlarını `locale` ile yerelleştirin ('CooperativeGesturesHandler.MobileHelpText'). Kap yüksekliğini `h-[60vh] max-h-[480px] min-h-[280px]` yapın.

## F709 — Mobil harita görünümü sayfa kaydırmasını yutuyor, kontrolleri küçük

| Alan                | Değer                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                |
| Durum               | Aday                                                                                                                  |
| Konum               | `src/components/search/ResultsMap.tsx:158`                                                                            |
| Diğer konumlar      | `src/app/search/page.tsx:583`, `src/components/search/ResultsMap.tsx:172`, `src/components/search/ResultsMap.tsx:235` |
| Kullanıcılar        | misafir                                                                                                               |
| Prensip             | robustness · task conformance                                                                                         |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                     |
| Renk/tema           | Hayır                                                                                                                 |
| Efor                | M                                                                                                                     |
| Kaynak denetçiler   | lens:mobile                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                          |

**Kanıt:** ResultsMap.tsx:158 `h-[480px] w-full`. :159-170'teki `<Map …>` bileşeninde `cooperativeGestures` yok, yani tek parmakla sürükleme haritayı kaydırıyor. search/page.tsx:583'teki yan liste `max-h-[480px] overflow-y-auto` mobilde haritanın altına yığılıyor; sonuçta ≈1000px'lik iç içe kaydırma alanı oluşuyor. :172 NavigationControl ve :235 Popup `closeButton` MapLibre varsayılanları (~29px ve ~16px).

**Etki:** 360×740 telefonda harita ekranın ≈%65'ini kaplıyor. Sayfayı aşağı kaydırmak isteyen kullanıcı haritayı kaydırıyor (kaydırma tuzağı). Listenin de kendi içinde kayması 'sayfa mı liste mi kayıyor' belirsizliği yaratıyor. Popup'ı parmakla kapatmak zor.

**Önerilen aksiyon:** `<Map cooperativeGestures …>` kullan: tek parmak sayfayı, iki parmak haritayı kaydırsın. Harita yüksekliğini `h-[55dvh] lg:h-[480px]` yap. Mobilde MapResultList'i haritanın altında yatay bir `flex overflow-x-auto snap-x` kart şeridi olarak göster. NavigationControl ve Popup kapatma düğmelerine CSS ile `min-width/min-height: 44px` ver. İç kaydırma alanlarına `overscroll-contain` ekle.

## F710 — Tek bir karo hatası haritayı tamamen kapatıyor ve uyarı yeniden deneme yolunu söylemiyor

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Medium                                                      |
| Durum               | Aday                                                        |
| Konum               | `src/components/search/ResultsMap.tsx:169`                  |
| Diğer konumlar      | `src/app/search/page.tsx:460`, `messages/tr/search.json:41` |
| Kullanıcılar        | misafir                                                     |
| Prensip             | robustness · recoverability                                 |
| Sezgisel madde      | H9 — Hata mesajları                                         |
| Renk/tema           | Hayır                                                       |
| Efor                | M                                                           |
| Kaynak denetçiler   | area:cards                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                |

**Kanıt:** ResultsMap.tsx:166-170: `if (/fetch|network|tile|webgl|failed/i.test(msg)) onFail(msg);`. Tek bir karo 404/429 hatası bile `onFail` tetikliyor. search/page.tsx:460-463 haritayı unmount edip `t('mapFailed')` gösteriyor. Uyarıda 'Tekrar dene' düğmesi yok; yeniden deneme ancak 'Harita' görünüm düğmesine tekrar basınca (446) mümkün ve bu hiçbir yerde söylenmiyor.

**Etki:** Harita kullanan misafir, geçici tek bir karo hatasında haritanın kaybolduğunu ve liste görünümüne atıldığını görüyor. Haritaya nasıl döneceğini bilmiyor.

**Önerilen aksiyon:** Yalnızca WebGL başlatma hatasında ya da ilk 10 saniyede hiç karo yüklenmediyse `onFail` çağırın; tekil karo hatalarını sayıp eşik (ör. 5) aşılınca düşürün. mapFailed uyarısına `<button onClick={() => setMapError(null)}>{t('mapRetry')}</button>` ekleyin.

## F711 — Harita işaretçileri uzun ve anlamsız bir sekme dizisi oluşturuyor, atlama yolu yok

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Medium                                     |
| Durum               | Aday                                       |
| Konum               | `src/components/search/ResultsMap.tsx:173` |
| Diğer konumlar      | `src/lib/search/map-cluster.ts:80`         |
| Kullanıcılar        | misafir                                    |
| Prensip             | flexibility · substitutivity / efficiency  |
| Sezgisel madde      | H7 — Esneklik/verim                        |
| WCAG                | 2.4.3                                      |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | area:cards                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**               |

**Kanıt:** ResultsMap.tsx:173-227'de her küme ve nokta bir `<button>`. Sıralama map-cluster.ts:80-86'da 'kümeler önce (büyükten küçüğe), sonra noktalar id'ye göre' yapılıyor; bu ne coğrafi ne de yan liste sırası. Bunlara ek olarak tuval (tabindex=0) ve 3 NavigationControl düğmesi de sekme durağı. Haritadan önce 'haritayı atla' bağlantısı yok.

**Etki:** Klavye kullanıcısı aynı işlevi sunan yan listeye (search/page.tsx:581) ulaşmak için 24'e kadar işaretçi boyunca sekmeliyor. Sıra rastgele göründüğü için hangi işaretçide olduğunu takip edemiyor.

**Önerilen aksiyon:** Harita kabından önce `<a href='#map-results-list' className='sr-only focus:not-sr-only'>{t('mapView.skipToList')}</a>` ekleyin ve MapResultList `ul`'sine `id` verin. İşaretçileri yan listeyle aynı sırada render edin ya da yan liste eşdeğer olduğu için işaretçi düğmelerine `tabIndex={-1}` verin.

## F712 — Seçili ilanı içeren küme yalnızca renk değişimiyle belirtiliyor

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Medium                                     |
| Durum               | Aday                                       |
| Konum               | `src/components/search/ResultsMap.tsx:191` |
| Kullanıcılar        | misafir                                    |
| Prensip             | accessibility · WCAG 1.4.1 Use of Color    |
| Sezgisel madde      | H14 — Erişilebilirlik                      |
| WCAG                | 1.4.1                                      |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | area:cards                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**               |

**Kanıt:** ResultsMap.tsx:190-195: `selectedId && item.memberIds.includes(selectedId) ? 'border-[#003580] bg-amber-300 text-gray-900' : 'border-white bg-[#003580] text-white'` ve `aria-label={t('mapView.cluster', {count})}`. Etikette ve görsel içerikte seçim bilgisi yok.

**Etki:** Renk körü misafir ve ekran okuyucu kullanıcısı listeden seçtiği ilanın hangi kümede olduğunu anlayamıyor; ilanı haritada bulamıyor.

**Önerilen aksiyon:** Renge ek olarak seçili kümede sayının yanına bir işaret ikonu (ör. `<svg aria-hidden>` konum iğnesi) ya da `ring-4 ring-offset-2` gibi şekil farkı ekleyin. aria-label'ı `t('mapView.clusterSelected', {count})` ('{count} konaklama, seçili ilan bu kümede') yapın.

## F713 — Seçili işaretçiye tekrar basınca seçim kalkmıyor; aria-pressed aç/kapa vaadi bozuk

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Medium                                     |
| Durum               | Aday                                       |
| Konum               | `src/components/search/ResultsMap.tsx:213` |
| Diğer konumlar      | `src/app/search/page.tsx:598`              |
| Kullanıcılar        | misafir                                    |
| Prensip             | learnability · consistency                 |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                |
| WCAG                | 4.1.2                                      |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | area:cards                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**               |

**Kanıt:** ResultsMap.tsx:213: `onSelect(item.point.id);` her basışta aynı id'yi seçiyor, 215: `aria-pressed={item.point.id === selectedId}`. Yan liste (search/page.tsx:598) ise `onSelect(active ? null : p.id)` ile gerçekten aç/kapa yapıyor.

**Etki:** Ekran okuyucu 'basılı' dediği düğmeye tekrar basan kullanıcı durumun değişmesini bekliyor ama değişmiyor. Harita ile liste aynı eylemde farklı davranıyor.

**Önerilen aksiyon:** 213'ü `onSelect(item.point.id === selectedId ? null : item.point.id)` olarak değiştirin.

## F714 — Harita popup'ı Escape ile ya da haritaya tıklayarak kapanmıyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/search/ResultsMap.tsx:234`     |
| Kullanıcılar        | misafir                                        |
| Prensip             | flexibility · dialog initiative / user control |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü              |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:cards                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** ResultsMap.tsx:234: `closeOnClick={false}`. Popup içinde ya da haritada `onKeyDown` yok. MapLibre popup modülünde (maplibre-gl-dev.mjs:29660-30142) Escape işleyicisi bulunmuyor. Popup yalnızca varsayılan boyutsuz '×' düğmesiyle kapanıyor.

**Etki:** Klavye kullanıcısı popup'ı kapatmak için × düğmesini sekmeyle bulmak zorunda. Fare/dokunmatik kullanıcı haritanın boş yerine dokunarak kapatmayı (yaygın harita alışkanlığı) deniyor ve popup kapanmıyor.

**Önerilen aksiyon:** Popup içerik div'ine `onKeyDown={(e) => { if (e.key === 'Escape') { onSelect(null); lastTriggerRef.current?.focus(); } }}` ekleyin. Map'e `onClick={() => selectedId && onSelect(null)}` verin; işaretçi tıklamalarında zaten `stopPropagation` var (ResultsMap.tsx:212).

## F715 — Harita görünümünde kart eylemleri ve bilgileri yok; detaya gitmek iki adım

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Aday                                                         |
| Konum               | `src/components/search/ResultsMap.tsx:237`                   |
| Diğer konumlar      | `src/app/search/page.tsx:503`, `src/app/search/page.tsx:595` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | flexibility · substitutivity                                 |
| Sezgisel madde      | H7 — Esneklik/verim                                          |
| Renk/tema           | Hayır                                                        |
| Efor                | M                                                            |
| Kaynak denetçiler   | area:cards                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** ResultsMap.tsx:237-247'deki popup yalnızca başlık bağlantısı + `{city} · {priceLabel}` içeriyor; puan, fotoğraf, favori ve karşılaştır yok. search/page.tsx:503'te `!showMap` olduğu için kartlar (ve CompareToggle, 542) harita görünümünde render edilmiyor. Yan liste düğmesi (595-609) yalnızca seçim yapıyor, detay bağlantısı yok.

**Etki:** Harita ile karar veren misafir karşılaştırmaya ekleyemiyor, favoriye alamıyor, puanı göremiyor. Detaya gitmek için önce listeye sonra popup bağlantısına basmak gerekiyor; ya da liste görünümüne dönmek zorunda kalıyor.

**Önerilen aksiyon:** Popup'a puan (/5), 'Karşılaştırmaya ekle' (`<CompareToggle propertyId title />`) ve detay CTA'sı ekleyin. MapResultList öğelerine ikincil bir 'Detay' bağlantısı ve CompareToggle ekleyin.

## F1096 — Puan rozeti ölçek ve etiket olmadan yalnız '9.7' gösteriyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Gözlemlendi                                    |
| Konum               | `src/components/property/PropertyCard.tsx:164` |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · Learnability / synthesizability |
| Sezgisel madde      | H6 — Tanıma > hatırlama                        |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | runtime:home                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** RUNTIME links.mjs ariaSnapshot: 'text: 9.7 220 değerlendirme'. Ekranda yalnız lacivert kutuda '9.7' var ('/10' veya 'Olağanüstü' gibi sözel karşılık yok). TR'de ondalık nokta kullanılıyor ('9.7', TR normu '9,7'). Kod: 163-165 {rating.toFixed(1)}.

**Etki:** Yeni kullanıcı ölçeği (5 mi 10 mu) bilmiyor. Ekran okuyucu yalnız '9.7' okuyor. TR ondalık biçimi tutarsız.

**Önerilen aksiyon:** f.number ile yerel biçimle ('9,7'). aria-label='10 üzerinden 9,7 puan' ekle, yanına sözel derece ekle ('Olağanüstü').

## F1097 — Kart puanı ölçeksiz ve etiketsiz, ayrıca TR yerelinde biçimlendirilmemiş ("8.9", "1240")

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Low                                                 |
| Durum               | Gözlemlendi                                         |
| Konum               | `src/components/property/PropertyCard.tsx:164`      |
| Kullanıcılar        | misafir                                             |
| Prensip             | learnability · Gerçek dünya eşleşmesi ve tutarlılık |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                         |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | runtime:results                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** RUNTIME p8-tab.mjs: kart puan bloğunun metni "8.91240 değerlendirme". TR yerelinde ondalık ayıracı nokta, karşılaştırma sayfası ise "8,9" gösteriyor. "Puan" ya da "/10" ibaresi ve sözel bir niteleme yok. Ekran okuyucu "8.9 1240 değerlendirme" okuyor. Kartta "değerlendirme", karşılaştırmada "yorum" terimi kullanılıyor.

**Etki:** Düşük okuryazarlığa sahip kullanıcı rozetin puan mı yoksa fiyat ya da indirim mi olduğunu anlamakta zorlanıyor.

**Önerilen aksiyon:** f.number(rating, {maximumFractionDigits: 1}) kullanın ve aria-label="Puan 8,9/10, 1.240 değerlendirme" verin. "Çok iyi" gibi sözel bir niteleme ekleyin. Terim her yerde "değerlendirme" olsun.

## F1098 — Tekrarlayan ve yanıltıcı "Fırsatı Gör" bağlantıları; masaüstünde metin iki satıra kırılıyor

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | Low                                                              |
| Durum               | Gözlemlendi                                                      |
| Konum               | `src/components/property/PropertyCard.tsx:190`                   |
| Kullanıcılar        | misafir                                                          |
| Prensip             | learnability · Feedforward: eylem etiketi sonucu doğru anlatmalı |
| Sezgisel madde      | H13 — Feedforward                                                |
| WCAG                | 2.4.9 Link Purpose (Link Only) (AAA)                             |
| Renk/tema           | Hayır                                                            |
| Efor                | S                                                                |
| Kaynak denetçiler   | runtime:results                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                     |

**Kanıt:** RUNTIME 002 gövde metni: 4 kartta da "Fırsatı Gör" yazıyor (tüm ilanlarda 24 adet). İndirimi olmayan ilanlarda da "fırsat" deniyor. Ekran görüntüsü crops/search/all-stays-bottom.png (1280px): düğme "Fırsatı / Gör" şeklinde iki satıra kırılıyor. Ekran okuyucunun bağlantılar listesinde birbirinden ayırt edilemeyen 4-24 adet "Fırsatı Gör" var.

**Etki:** Bağlantı listesiyle gezinen kullanıcı hangi ilana gideceğini bilemiyor. "Fırsat" sözcüğü beklentiyi şişiriyor.

**Önerilen aksiyon:** Etiketi "Müsaitliği gör" ya da "İncele" yapın, sonuna sr-only olarak başlığı ekleyin (veya aria-describedby ile başlık id'sine bağlayın). Düğmeye whitespace-nowrap verin.

## F1202 — /compare doğrudan açıldığında kayıtlı seçim kullanılmıyor

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | Low                              |
| Durum               | Aday                             |
| Konum               | `src/app/compare/page.tsx:61`    |
| Kullanıcılar        | misafir                          |
| Prensip             | flexibility · task migratability |
| Sezgisel madde      | H7 — Esneklik/verim              |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | area:cards                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**     |

**Kanıt:** compare/page.tsx:61: `const ids = (sp.get('ids') ?? '').split(',')` yalnızca URL'yi okuyor. useCompareSelection (localStorage) burada kullanılmıyor; 73-81'de 'en az 2 ilan seçin' gösteriliyor.

**Etki:** Yer imi ya da geçmişten /compare açan misafir, 3 ilanı seçili olduğu halde 'en az 2 ilan seçin' mesajını görüyor.

**Önerilen aksiyon:** `ids` boşsa `useCompareSelection().ids` değerini kullanın ve `router.replace(`/compare?ids=...`)` ile URL'yi tamamlayın.

## F1203 — Karşılaştırma tablosunun adı yok; köşe hücresi sayfa başlığını sütun başlığı gibi tekrarlıyor

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Low                                               |
| Durum               | Aday                                              |
| Konum               | `src/app/compare/page.tsx:110`                    |
| Kullanıcılar        | misafir                                           |
| Prensip             | accessibility · WCAG 1.3.1 Info and Relationships |
| Sezgisel madde      | H14 — Erişilebilirlik                             |
| WCAG                | 1.3.1                                             |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | area:cards                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** compare/page.tsx:107: `<table ... data-testid='compare-table'>` içinde `<caption>` yok. 110-112: `<th scope='col' className='sr-only'>{t('title')}</th>`. Bu hücre satır başlıkları sütununun başlığı oluyor, bu yüzden her satır başlığında 'İlan karşılaştırma' duyuruluyor.

**Etki:** Ekran okuyucunun tablo listesinde tablo adsız görünüyor. İlk sütunda gezinirken gereksiz ve anlamsız bir başlık tekrar tekrar okunuyor.

**Önerilen aksiyon:** `<caption className='sr-only'>{t('tableCaption', {dates})}</caption>` ekleyin. Köşe hücresini `<td />` yapın ya da metnini 'Özellik' / 'Feature' olarak değiştirin.

## F1204 — Olanaklarda ortak olanlar her sütunda tekrar ediyor; 'yalnızca farkları göster' seçeneği yok

| Alan                | Değer                          |
| ------------------- | ------------------------------ |
| Severity            | Low                            |
| Durum               | Aday                           |
| Konum               | `src/app/compare/page.tsx:192` |
| Kullanıcılar        | misafir                        |
| Prensip             | flexibility · customizability  |
| Sezgisel madde      | H8 — Estetik/minimal tasarım   |
| Renk/tema           | Hayır                          |
| Efor                | S                              |
| Kaynak denetçiler   | area:cards                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**   |

**Kanıt:** compare/page.tsx:192-210'da her sütun tüm olanakları listeliyor. API'nin döndürdüğü `data.diff.commonAmenities` (37) arayüzde hiç kullanılmıyor. Fark yalnızca her öğenin yanındaki '(Yalnızca bu ilanda)' ile belirtiliyor.

**Etki:** 4 ilan ve uzun olanak listelerinde tablo çok uzuyor. Misafir farkları bulmak için tüm listeyi taramak zorunda kalıyor; mobilde bu yük artıyor.

**Önerilen aksiyon:** Tabloya 'Yalnızca farkları göster' onay kutusu ekleyin; açıkken `commonAmenities` öğelerini gizleyip 'Ortak: Ücretsiz WiFi, Oda Servisi' satırını tek sefer gösterin.

## F1205 — Toggle düğmelerinde aria-pressed ile değişen etiket birlikte kullanılıyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/compare/CompareToggle.tsx:16`  |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:106` |
| Kullanıcılar        | misafir                                        |
| Prensip             | accessibility · Name, Role, Value              |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                    |
| WCAG                | 4.1.2                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | lens:a11y                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** CompareToggle.tsx:16-25 `aria-pressed={selected}` + metin `{selected ? t("remove") : t("add")}` ('Karşılaştırmadan çıkar, basılı'); PropertyCard.tsx:106-107 `aria-pressed={isFavorite}` + `aria-label={isFavorite ? t("card.removeFavorite") : t("card.addFavorite")}`.

**Etki:** Ekran okuyucu 'Favorilerden çıkar, basılı' gibi çelişkili bir durum duyuruyor; düğmenin şimdi ne yapacağı belirsiz.

**Önerilen aksiyon:** Ya sabit etiket + aria-pressed ('Favorilere ekle: {title}', basılı/basılı değil) ya da aria-pressed'i kaldırıp eylem etiketini koruyun; iki deseni karıştırmayın.

## F1206 — Karşılaştırma listesi dolunca (4 ilan) düğmeler gerekçesi gösterilmeden devre dışı kalıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/compare/CompareToggle.tsx:17` |
| Kullanıcılar        | misafir                                       |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:results                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** CompareToggle.tsx:17-18 `disabled={disabled} title={disabled ? t('full') : undefined}`: gerekçe ('En fazla 4 ilan karşılaştırılabilir') yalnızca title özniteliğinde. Devre dışı düğme klavyeyle odaklanamıyor; dokunmatik ekranda title görünmüyor.

**Etki:** Mobil misafir beşinci ilanı eklemeye çalıştığında düğmenin neden tepki vermediğini anlamıyor.

**Önerilen aksiyon:** disabled yerine aria-disabled='true' kullanın ve tıklamada 'En fazla 4 ilan karşılaştırılabilir · birini çıkarın' mesajını role='status' ile gösterin. Ya da CompareBar'da '4/4 dolu' bilgisini görünür metin olarak verin.

## F1207 — Bilgi yalnız title (tooltip) özniteliğinde; klavye ve dokunmatikte erişilemiyor

| Alan                | Değer                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                   |
| Durum               | Aday                                                                                  |
| Konum               | `src/components/compare/CompareToggle.tsx:18`                                         |
| Diğer konumlar      | `src/components/ui/ui.tsx:135`, `src/components/property/AccessibilitySection.tsx:46` |
| Kullanıcılar        | misafir                                                                               |
| Prensip             | accessibility · Info and Relationships                                                |
| Sezgisel madde      | H13 — Feedforward                                                                     |
| WCAG                | 1.3.1                                                                                 |
| Renk/tema           | Hayır                                                                                 |
| Efor                | S                                                                                     |
| Kaynak denetçiler   | lens:a11y                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                          |

**Kanıt:** CompareToggle.tsx:17-18 `disabled={disabled} title={disabled ? t("full") : undefined}` — disabled düğme odak almadığı için 'En fazla 4 ilan' açıklamasına klavye/ekran okuyucu ulaşamıyor; ui.tsx:135 LlmBadge `title={t("ai.hint")}` ('doğruluğunu kontrol edin'); AccessibilitySection.tsx:46 doğrulama açıklaması `title={t("verifiedHint")}`.

**Etki:** Mobil (dokunmatik) ve klavye misafiri neden ekleyemediğini ve AI çıktısını doğrulaması gerektiğini göremiyor.

**Önerilen aksiyon:** Açıklamayı görünür metin ya da `aria-describedby` ile bağlı sr-only/görünür ipucu yapın; karşılaştırmada `aria-disabled` + açıklama, ya da CompareBar'da kalıcı 'Sınır doldu' mesajı.

## F1208 — Karşılaştırma listesi dolunca neden yalnız fareyle görülen title'da; seçim sayısı duyurulmuyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/compare/CompareToggle.tsx:18` |
| Diğer konumlar      | `src/components/compare/CompareBar.tsx:34`    |
| Kullanıcılar        | misafir                                       |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages    |
| Sezgisel madde      | H12 — Feedback                                |
| WCAG                | 4.1.3                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | lens:status                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** CompareToggle.tsx:12-18 `disabled={disabled}` + `title={disabled ? t("full") : undefined}` — disabled buton klavye odağı almıyor, dokunmatikte title görünmüyor. CompareBar.tsx:34 `{t("bar", { count: ids.length })}` canlı bölge değil.

**Etki:** Mobil misafir 5. ilanı neden ekleyemediğini anlamıyor; ekran okuyucu kullanıcı ekleme sonucunu duymuyor.

**Önerilen aksiyon:** `disabled` yerine `aria-disabled` + tıklamada satır içi 'En fazla 4 ilan karşılaştırılabilir' mesajı; CompareBar sayacına `aria-live="polite"`.

## F1209 — Karşılaştır düğmesi bağlantı gibi görünüyor ve mobil için küçük bir dokunma hedefi

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/compare/CompareToggle.tsx:20` |
| Diğer konumlar      | `src/app/search/page.tsx:546`                 |
| Kullanıcılar        | misafir                                       |
| Prensip             | learnability · affordance / consistency       |
| Sezgisel madde      | H11 — Affordance                              |
| WCAG                | 2.5.8                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:cards                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** CompareToggle.tsx:20-22: `mr-3 mt-1 inline-block text-sm font-medium underline ... text-blue-700`. Dolgu yok; yükseklik globals.css:73-80'deki min-height 1.5rem (24px) ile sınırlı. Aynı alt çizgili mavi stil search/page.tsx:546'daki 'Benzerlerini göster' bağlantısında da kullanılıyor.

**Etki:** Bağlantı ile aç/kapa düğmesi görsel olarak ayırt edilemiyor; kullanıcı yeni sayfaya gideceğini sanıyor. Mobil misafir 24px yükseklikteki metne isabetle dokunmakta zorlanıyor.

**Önerilen aksiyon:** Onay kutusu görünümlü bir düğme kullanın: önde `<svg aria-hidden>` (boş/işaretli kare), `inline-flex items-center gap-2 rounded-md border px-3 py-2 min-h-[44px]`. Alt çizgiyi kaldırın.

## F1210 — Kart görselinin alt metni başlığı tekrarlıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/property/PropertyCard.tsx:97` |
| Kullanıcılar        | misafir                                       |
| Prensip             | accessibility · WCAG 1.1.1 Non-text Content   |
| Sezgisel madde      | H14 — Erişilebilirlik                         |
| WCAG                | 1.1.1                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:cards                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** PropertyCard.tsx:97: `alt={title}`. Hemen ardından 134-136'da aynı `{title}` başlık bağlantısı geliyor.

**Etki:** Ekran okuyucu her kartta ilan adını iki kez duyuyor; 24 kartta gereksiz bir dinleme yükü oluşuyor.

**Önerilen aksiyon:** Görsel bilgi taşımıyorsa `alt=''` verin. Taşıyorsa `alt={t('card.photoOf', {title})}` ('{title} — kapak fotoğrafı') kullanın.

## F1211 — Kart görsellerinde `sizes` gerçek ızgarayla uyuşmuyor; iki farklı görsel hattı

| Alan                | Değer                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Severity            | Low                                                                                                    |
| Durum               | Aday                                                                                                   |
| Konum               | `src/components/property/PropertyCard.tsx:99`                                                          |
| Diğer konumlar      | `src/app/page.tsx:93`, `src/app/search/page.tsx:513`, `src/components/property/PropertyGallery.tsx:33` |
| Kullanıcılar        | misafir                                                                                                |
| Prensip             | robustness · responsiveness                                                                            |
| Sezgisel madde      | H15 — Performans                                                                                       |
| Renk/tema           | Hayır                                                                                                  |
| Efor                | S                                                                                                      |
| Kaynak denetçiler   | lens:mobile                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                           |

**Kanıt:** PropertyCard.tsx:99 `sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"`. Oysa ana sayfa (page.tsx:84) `lg:grid-cols-3` (≈33vw), arama sayfası (search/page.tsx:504) lg:col-span-3 içinde `sm:grid-cols-2 xl:grid-cols-3` (1024–1280 arası ≈37vw); masaüstünde düşük çözünürlüklü görsel seçiliyor. Kaynak URL'ler (page.tsx:93, search/page.tsx:513) `w=600&h=400` ile sınırlı; 360px × DPR3 = 1080px ekranda görsel büyütülüyor. Kartlar Next görsel optimizasyonunu, PropertyGallery.tsx:33 ise CDN `unsplashLoader`'ı kullanıyor.

**Etki:** Yüksek DPR'li telefonlarda kart fotoğrafları bulanık. Optimize edici üzerinden geçen ek sunucu adımı ilk kart görsellerini geciktiriyor.

**Önerilen aksiyon:** Kartlarda `loader={unsplashLoader}` kullan ve kaynak URL'den boyut parametrelerini kaldır. `sizes` değerini `(min-width:1280px) 25vw, (min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw` yap.

## F1212 — Favori düğmesinde aria-pressed ile değişen aria-label birlikte kullanılıyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/property/PropertyCard.tsx:102` |
| Kullanıcılar        | misafir                                        |
| Prensip             | accessibility · WCAG 4.1.2 Name, Role, Value   |
| Sezgisel madde      | H14 — Erişilebilirlik                          |
| WCAG                | 4.1.2                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:home                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** `aria-pressed={isFavorite}` ile birlikte `aria-label={isFavorite ? t("card.removeFavorite") : t("card.addFavorite")}` (102-103) kullanılıyor; hem ad hem durum değişiyor.

**Etki:** Ekran okuyucu 'Favorilerden çıkar, basılı' gibi çelişkili ya da çift durum okuyor; ana sayfadaki her öne çıkan kartta bu tekrarlanıyor.

**Önerilen aksiyon:** aria-pressed korunacaksa sabit bir etiket kullanın: `aria-label={t('card.favorite')}` (TR 'Favorilere kaydet'). Ya da aria-pressed'i kaldırıp değişen etiketi tutun.

## F1213 — Puan değeri toFixed ile biçimleniyor; TR'de ondalık ayırıcı tutarsız (8.6 ve 8,8)

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/property/PropertyCard.tsx:164` |
| Diğer konumlar      | `src/app/property/[id]/page.tsx:145`           |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · consistency                     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                    |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:cards                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** PropertyCard.tsx:164: `{rating.toFixed(1)}` her dilde '.' üretiyor. compare/page.tsx:156 `f.number(l.rating.avg)` TR'de ',' üretiyor. Ekran görüntülerinde kartta '8.6', karşılaştırmada '8,8' görünüyor.

**Etki:** Aynı metrik iki ekranda farklı biçimde görünüyor ve TR ekran okuyucu '8 nokta 6' diye okuyor.

**Önerilen aksiyon:** `f.number(rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })` kullanın. property/[id]/page.tsx:145'te de aynısını uygulayın.

## F1214 — Tarihli toplam fiyat kaç misafir/oda için olduğunu söylemiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/property/PropertyCard.tsx:176` |
| Kullanıcılar        | misafir                                        |
| Prensip             | learnability · predictability                  |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                    |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:cards                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** PropertyCard.tsx:175-177: `t('card.nightsTotal', {count: stay.nights})` ('3 gece toplam'). `stay.guests` mevcut ama gösterilmiyor.

**Etki:** Misafir sayısını değiştiren ya da başlıktaki özeti görmeyen misafir toplamın kaç kişi için hesaplandığından emin olamıyor.

**Önerilen aksiyon:** Mesajı `'{nights} gece, {guests} misafir · toplam'` yapın (search.json `card.nightsGuestsTotal`, EN çoğul ICU).
