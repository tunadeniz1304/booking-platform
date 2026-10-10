# Arama sonuçları ve filtreler — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 74 bulgu · Severity: Critical 1, High 28, Medium 30, Low 15

## F8 — Tür ve fiyat filtresi yalnız ilk 24 sonuç üzerinde istemcide çalışıyor, bu yüzden var olan ilanlar için yanlışlıkla "Sonuç bulunamadı" çıkıyor

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | Critical                                                                       |
| Durum               | Gözlemlendi                                                                    |
| Konum               | `src/app/search/page.tsx:249`                                                  |
| Diğer konumlar      | `src/app/search/page.tsx:199`                                                  |
| Kullanıcılar        | misafir                                                                        |
| Prensip             | robustness · Görev uyumu ve gözlemlenebilirlik: sistem yanlış durum bildiriyor |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                 |
| Renk/tema           | Hayır                                                                          |
| Efor                | M                                                                              |
| Kaynak denetçiler   | runtime:results                                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: results)                                                |

**Kanıt:** RUNTIME p11-page.mjs (anon, desktop 1280x800, TR): /search ekranı "24 sonuç gösteriliyor (39 bulundu)" diyor. "Villa" kutusu işaretlenince ekran "0 sonuç gösteriliyor (39 bulundu)" ve "Sonuç bulunamadı" gösteriyor. Aynı anda /api/search?propertyType=VILLA total=3 dönüyor. Bu 3 villanın 3'ü de 2. sayfada, 1. sayfada hiç villa yok. KOD: page.tsx:249-255'teki visibleResults, sunucudan gelen 24 sonucu tarayıcıda süzüyor (fiyat ve tür). İstek ise sabit page=1 ve pageSize=24 ile gidiyor (page.tsx:199-200).

**Etki:** Villa, hostel ya da bir fiyat aralığı arayan misafire, aslında var olan ilanlar için "yok" deniyor. Birincil görev olan konaklama bulma engelleniyor ve kullanıcı hiçbir uyarı almıyor.

**Önerilen aksiyon:** selectedTypes değerini propertyType (virgüllü), priceRange değerini minPrice/maxPrice olarak /api/search parametresine ekleyin (smartToParams bu parametreleri zaten destekliyor). Ardından visibleResults içindeki istemci filtresini kaldırın, filtre değişince sayfayı 1'e alın ve sayımı sunucunun total değerinden gösterin.

**Yapılan düzeltme:** The type and price filters now run on the server. propertyType, minPrice and maxPrice are added to the /api/search request (requestKey useMemo), and the client-side visibleResults filter is gone. A filter change rebuilds the request and loads page 1 again. The count comes from the server total (resultCount: shown = results.length). — dosyalar: `src/app/search/page.tsx`

## F66 — Tür, fiyat, sıralama, görünüm ve akıllı filtre URL'de tutulmuyor: ilandan geri dönünce ya da sayfa yenilenince sıfırlanıyor (yalnız erişilebilirlik filtresi korunuyor)

| Alan                | Değer                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                     |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                                          |
| Konum               | `src/app/search/page.tsx:159`                                                                                            |
| Diğer konumlar      | `src/app/search/page.tsx:137`, `src/components/search/RankingWhy.tsx:39`, `src/components/property/PropertyCard.tsx:190` |
| Kullanıcılar        | misafir                                                                                                                  |
| Prensip             | robustness · Kurtarılabilirlik ve tutarlılık                                                                             |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                        |
| Renk/tema           | Hayır                                                                                                                    |
| Efor                | M                                                                                                                        |
| Kaynak denetçiler   | runtime:results, area:results                                                                                            |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results)                                                                                   |

**Kanıt:** RUNTIME p7-misc.mjs (desktop TR): Apart, "Fiyat (önce en düşük)" ve max 5000 seçildikten sonra tek sonuç kalıyor (Galata). Karta tıklayıp tarayıcıda geri dönünce 4 sonuç geliyor, Apart işaretsiz, sıralama "recommended", max 20000 ve scrollY=0. p1-filters.mjs: sayfa yenilenince sort=recommended ve Apart=false oluyor. Buna karşılık erişilebilirlik filtresi URL'ye yazılıyor (&accessibility=STEP_FREE_ENTRANCE). KOD: priceRange, selectedTypes ve sortBy page.tsx:159-161'de useState içinde tutuluyor; setAccessibility (137-142) ise router.replace kullanıyor.

**Etki:** İlanları tek tek açıp karşılaştıran misafir her dönüşte filtrelerini yeniden kurmak zorunda kalıyor. Bağlantı paylaşıldığında filtreler gitmiyor ve filtreler arasında tutarsız davranış var.

**Önerilen aksiyon:** types, minPrice, maxPrice, sort, view ve akıllı filtre alanlarını setAccessibility ile aynı biçimde router.replace(?…, {scroll:false}) kullanarak URL'ye yazın ve başlangıç durumunu searchParams'tan okuyun. Geri dönüşte kaydırma konumunu koruyun.

**Yapılan düzeltme:** propertyType, minPrice, maxPrice, sort, view and flexDays are now read from searchParams and written back with router.replace(..., {scroll:false}) through a single updateParams helper. The smart filter itself is still not written to the URL, because the parsed filter object can't be serialised as a parameter without adding a new one. Scroll position on back navigation is not managed separately; it is left to the browser. — dosyalar: `src/app/search/page.tsx`

## F67 — Akıllı filtre URL'deki tarih ve misafir sayısını sessizce düşürüyor; başlık ise eski aramayı göstermeye devam ediyor

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | High                                                                           |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                |
| Konum               | `src/app/search/page.tsx:179`                                                  |
| Diğer konumlar      | `src/app/search/page.tsx:94`, `src/app/search/page.tsx:284`                    |
| Kullanıcılar        | misafir                                                                        |
| Prensip             | robustness · Gözlemlenebilirlik: sistem durumu ile gösterilen bağlam çelişiyor |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                 |
| Renk/tema           | Hayır                                                                          |
| Efor                | M                                                                              |
| Kaynak denetçiler   | runtime:results, area:results                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: results)                                                |

**Kanıt:** RUNTIME p7-misc.mjs (URL: İstanbul, 27-29.01.2027, guests=2): akıllı filtreye "İstanbul'da otel" yazılınca kart "gecelik başlangıç ₺2.450,00 / tarih seçince vergi ve ücretler eklenir" gösteriyor ve kart href'i /property/<id> oluyor (parametre yok). Alt başlık ise hâlâ "27.01.2027 - 29.01.2027 · 2 misafir". p6-smart.mjs: "Antalya'da havuzlu villa…" sorgusu GET /api/search?destination=Antalya&guests=4… şeklinde, checkIn/checkOut olmadan gidiyor; H1 hâlâ "İstanbul için konaklama", sonuç 0. KOD: page.tsx:179-182'de smartFilters varken params tamamen smartToParams'tan kuruluyor ve URL'deki checkIn, checkOut ve guests atılıyor.

**Etki:** Kullanıcı seçtiği tarihlerin hâlâ geçerli olduğunu sanıyor ama toplam fiyat kayboluyor, ilan sayfasına tarihsiz gidiyor ve başlık yanlış şehir ile misafir sayısını gösteriyor.

**Önerilen aksiyon:** Akıllı filtre çıktısını URL'deki temel parametrelerin üzerine birleştirin: yalnızca çıkarılan alanları üzerine yazın, checkIn, checkOut ve guests korunsun. H1 ve alt başlığı geçerli parametrelerden üretin. Akıllı filtreyi URL'ye yazın.

**Yapılan düzeltme:** The smart filter is now merged on top of the base URL search. destination, checkIn/checkOut and guests come from the URL, and the smart filter only overrides the fields it extracted. The H1 and subtitle are built from the effective request parameters (effDestination, effCheckIn/Out, effGuests). Writing the smart filter to the URL is the part covered under F66. — dosyalar: `src/app/search/page.tsx`

## F68 — Fiyat filtresi gecelik taban fiyata göre süzüyor, kart ise 2 gecelik toplamı gösteriyor; birim ve para birimi de belirtilmemiş

| Alan                | Değer                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                 |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                                      |
| Konum               | `src/app/search/page.tsx:251`                                                                                        |
| Diğer konumlar      | `src/app/search/page.tsx:328`, `src/app/search/page.tsx:328-355`, `src/components/property/PropertyCard.tsx:173-189` |
| Kullanıcılar        | misafir                                                                                                              |
| Prensip             | learnability · Öngörülebilirlik ve gerçek dünya eşleşmesi                                                            |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                          |
| Renk/tema           | Hayır                                                                                                                |
| Efor                | M                                                                                                                    |
| Kaynak denetçiler   | runtime:results, lens:consistency                                                                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results)                                                                               |

**Kanıt:** RUNTIME p1-filters.mjs (desktop TR, 27-29.01.2027, 2 misafir): En yüksek fiyat 3000 yapıldıktan sonra 3 kart kalıyor. Kartlarda "2 gece toplam ₺4.647,33", "₺3.372,22" ve "₺4.426,04" yazıyor, yani iki kart girilen 3000 sınırının üstünde. KOD: page.tsx:251 toMajorNumber(p.basePriceMinor) ile gecelik taban fiyatı karşılaştırıyor. Lejant yalnızca "Fiyat Aralığı" diyor ve ₺, gecelik ya da vergi bilgisi içermiyor (page.tsx:328-354).

**Etki:** Kullanıcı bütçesinin üstündeki ilanları "filtreye uyuyor" sanıyor ya da filtrenin bozuk olduğunu düşünüyor. Bu, para ile ilgili yanlış bir algı yaratıyor.

**Önerilen aksiyon:** Tarih seçiliyse filtre quote.total üzerinden çalışsın ve lejant "Toplam fiyat (₺, vergiler dahil)" olsun. Tarih yoksa lejant "Gecelik fiyat (₺)" olsun. Alanlara ₺ öneki ve "/gece" ya da "toplam" soneki ekleyin. Süzmeyi sunucuya taşıyın (bkz. Critical bulgu).

**Yapılan düzeltme:** Price filtering now happens on the server, which compares against the tax-inclusive total when dates are set and the nightly price otherwise. The legend changes with dates ('Toplam fiyat' / 'Gecelik fiyat'), the min/max labels ('En az' / 'En çok') are now visible, and a hint under the fields says which amount is used and gives a format example. The fields use type=text, inputMode=decimal and parseAmountToMinor, with aria-invalid and an error for min>max. The currency code is shown in the legend only when every result uses the same currency; no ₺ prefix was added inside the fields. — dosyalar: `src/app/search/page.tsx`

## F140 — Sayfalama ya da "daha fazla yükle" yok: 39 ilanın 15'ine ulaşılamıyor

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | High                                                                |
| Durum               | Gözlemlendi                                                         |
| Konum               | `src/app/search/page.tsx:199`                                       |
| Diğer konumlar      | `src/app/search/page.tsx:426`                                       |
| Kullanıcılar        | misafir                                                             |
| Prensip             | robustness · Görev uyumu: sonuç kümesinin tamamı erişilebilir değil |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                      |
| Renk/tema           | Hayır                                                               |
| Efor                | M                                                                   |
| Kaynak denetçiler   | runtime:results                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: results)                                     |

**Kanıt:** RUNTIME p2-links.mjs ve p11-page.mjs (desktop TR): /search sayfasında "24 sonuç gösteriliyor (39 bulundu)" yazıyor ve main içinde 24 adet H3 var. API totalPages=2 dönüyor, 2. sayfada 15 sonuç var. main içinde "daha/sonraki/sayfa/load/next" metinli hiçbir düğme ya da bağlantı yok. Ekran görüntüsü: scratchpad/runtime/crops/search/all-stays-bottom.png (son satırdan sonra doğrudan footer geliyor). KOD: page.tsx:199-200'de page="1" ve pageSize="24" sabit yazılmış.

**Etki:** Kullanıcı ilanların %38'ini hiç göremiyor. "(39 bulundu)" ibaresi geri kalan 15 ilana nasıl ulaşılacağını söylemiyor.

**Önerilen aksiyon:** Listenin sonuna "Daha fazla göster (15 ilan kaldı)" düğmesi ekleyip page=2 sonuçlarını mevcut listeye ekleyin, yeni sayıyı aria-live ile duyurun ve odağı ilk yeni karta taşıyın. Alternatif olarak aria-label="Sayfalar" olan bir nav ile numaralı sayfalama kullanın. Sayfa numarası URL'de tutulsun.

**Yapılan düzeltme:** A 'Daha fazla göster ({remaining} konaklama kaldı)' button now sits under the grid. It shows when page < totalPages, uses Button busy to block double submits, and its loadMore fetches page+1 and appends to the list. Focus moves to the first new card wrapper (id=result-<id>, tabIndex=-1), and the count is announced through the existing aria-live paragraph. The page number is not written to the URL (appended list), so this is a partial match to the suggestion. — dosyalar: `src/app/search/page.tsx`

## F141 — Sonuç sayfasında destinasyon, tarih ve misafir değiştirilemiyor; "Tarih esnekliği" ipucu sayfada bulunmayan bir eylemi istiyor

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | High                                                 |
| Durum               | Gözlemlendi                                          |
| Konum               | `src/app/search/page.tsx:283`                        |
| Diğer konumlar      | `src/app/search/page.tsx:414`, `src/app/page.tsx:48` |
| Kullanıcılar        | misafir                                              |
| Prensip             | flexibility · Diyalog inisiyatifi ve görev geçişi    |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                    |
| Renk/tema           | Hayır                                                |
| Efor                | M                                                    |
| Kaynak denetçiler   | runtime:results                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: results)                      |

**Kanıt:** RUNTIME p2-links.mjs: /search?destination=Zzzyxq sayfasının main bölümünde yalnızca "Filtrele", "Liste" ve "Harita" düğmeleri var; tarih girişi ya da destinasyon alanı yok. #flex-days devre dışı ve "Esnek tarih için önce giriş ve çıkış tarihi seçin." diyor (ekran görüntüsü: crops/search/005-1.png). SearchBar yalnızca src/app/page.tsx:48'de kullanılıyor. Başlık kartı (page.tsx:283-291) yalnızca metin olarak "27.01.2027 - 29.01.2027 · 2 misafir" gösteriyor.

**Etki:** Tarihi ya da şehri düzeltmek isteyen misafir ana sayfaya dönüp her şeyi yeniden girmek zorunda kalıyor. İpucu kullanıcıyı bir çıkmaza yönlendiriyor.

**Önerilen aksiyon:** Başlık kartına önceden doldurulmuş kompakt bir SearchBar ya da "Aramayı düzenle" düğmesi ekleyin (mobilde açılır bir alt sayfa olabilir). flex.needsDates ipucunu bu denetime bağlayın ("Tarih seç" bağlantısı).

**Yapılan düzeltme:** An 'Aramayı düzenle' <details> form (EditSearch) was added to the header card. It holds destination, check-in/check-out (type=date, checkOut min) and guest-count fields, prefilled from the URL. Validation covers both dates together, check-out after check-in and 1-30 guests; on error it focuses the field and sets aria-invalid and aria-describedby. Submitting keeps the other URL parameters, clears the smart filter and calls router.push. The flex.needsDates hint now includes a 'Tarih seç' button that opens the form and focuses check-in. — dosyalar: `src/app/search/page.tsx`

## F142 — Mobilde ilk sonuç 1538px'te başlıyor: katlanamayan filtre paneli sonuçları yaklaşık 1,8 ekran aşağı itiyor

| Alan                | Değer                                                         |
| ------------------- | ------------------------------------------------------------- |
| Severity            | High                                                          |
| Durum               | Gözlemlendi                                                   |
| Konum               | `src/app/search/page.tsx:324`                                 |
| Diğer konumlar      | `src/components/search/AccessibilityFilter.tsx`               |
| Kullanıcılar        | misafir                                                       |
| Prensip             | flexibility · Uyarlanabilirlik: mobil bağlama uygun düzen yok |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                  |
| Renk/tema           | Hayır                                                         |
| Efor                | M                                                             |
| Kaynak denetçiler   | runtime:results                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results)                        |

**Kanıt:** RUNTIME p2-links.mjs (anon, mobile 390x844, TR, İstanbul 27-29.01.2027): ilk kart başlığının (h3) sayfa üstüne uzaklığı 1538px, sonuç sayacı 1288px'te. Sonuçlardan önce 21 onay kutusu ve 2 select var. Masaüstünde ilk kart 614px'te. Ekran görüntüleri: scratchpad/runtime/crops/search/003-0.png ve 003-1.png (ilk kart ancak ikinci dilimin ortasında görünüyor). Harita görünümünde harita 1329px'te başlıyor (p3).

**Etki:** Çoğunluğu mobil olan misafir, her aramada sonuçları görmek için iki ekran filtre kaydırmak zorunda. Sıralama da filtre listesinin en altında kalıyor.

**Önerilen aksiyon:** lg altı genişlikte aside yerine "Filtreler (n)" ve "Sırala" düğmelerini gösterin. Filtreler bir alt sayfa veya <details> içinde açılsın. Sonuç sayacı ve sıralama, sonuçların hemen üstünde yapışkan bir çubukta dursun. Erişilebilirlik filtresi varsayılan olarak katlı gelsin ve seçili öğe sayısını göstersin.

**Yapılan düzeltme:** Below lg, the filter panel is now closed by default. A 'Filtre ve sıralama (n etkin)' button (lg:hidden, aria-expanded, aria-controls) opens it, and a 'Sonuçlara geç' skip link to #results was added. Panel controls are at least 44px tall on mobile. A sticky toolbar was not added, and the accessibility filter's default <details> collapse belongs to another owner (crossOwner). — dosyalar: `src/app/search/page.tsx`

## F143 — Koyu temada Liste/Harita düğmesinin seçili durumu yalnızca dolgu rengiyle ve yaklaşık 1,5:1 farkla belli oluyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | High                                                  |
| Durum               | Gözlemlendi                                           |
| Konum               | `src/app/search/page.tsx:448`                         |
| Diğer konumlar      | `src/styles/globals.css`                              |
| Kullanıcılar        | misafir                                               |
| Prensip             | accessibility · Durum göstergesinin algılanabilirliği |
| Sezgisel madde      | H14 — Erişilebilirlik                                 |
| WCAG                | 1.4.11 Non-text Contrast (AA)                         |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | runtime:results                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: results)                       |

**Kanıt:** RUNTIME p10b.mjs (colorScheme dark, desktop): basılı "Liste" bg rgb(0,53,128), basılı olmayan "Harita" bg rgb(17,24,39); iki dolgu arasındaki kontrast yaklaşık 1,5:1. Metin renkleri beyaz ve neredeyse beyaz, yani ikisi de aynı. Açık temada fark 11:1 ve sorun yok. Ekran görüntüsü: scratchpad/runtime/crops/search/dark-desktop.png.

**Etki:** Koyu tema kullanan ya da az gören kullanıcı hangi görünümün etkin olduğunu ayırt edemiyor.

**Önerilen aksiyon:** Renk dışı bir çözüm: basılı segmente bir ✓ simgesi (aria-hidden) ve font-semibold ile alt çizgi (border-b-2) ekleyin. Böylece palete dokunmadan durum şekil ile de görünür olur.

**Yapılan düzeltme:** The pressed view button now shows an aria-hidden ✓ plus font-semibold and an underline (underline-offset-4), so its state no longer depends on color alone. No colors were changed, and the accessible name is unchanged. — dosyalar: `src/app/search/page.tsx`

## F144 — Sıfır sonuç ekranı yanlış yönlendiriyor ("Filtreleri değiştirmeyi deneyin") ve hiçbir çıkış yolu sunmuyor

| Alan                | Değer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Severity            | High                                                                     |
| Durum               | Gözlemlendi                                                              |
| Konum               | `src/app/search/page.tsx:478`                                            |
| Diğer konumlar      | `messages/tr/search.json:44`, `messages/en/search.json:44`               |
| Kullanıcılar        | misafir                                                                  |
| Prensip             | robustness · Kurtarılabilirlik: hata mesajı nedeni ve çözümü göstermiyor |
| Sezgisel madde      | H9 — Hata mesajları                                                      |
| Renk/tema           | Hayır                                                                    |
| Efor                | S                                                                        |
| Kaynak denetçiler   | runtime:results                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: results)                                          |

**Kanıt:** RUNTIME 004/005 taraması ve p2-links.mjs: /search?destination=Zzzyxq (desktop ve mobile) ekranında "Sonuç bulunamadı / Filtreleri değiştirmeyi deneyin." yazıyor. Oysa aktif filtre yok, sorun bilinmeyen destinasyon. Blok içindeki bağlantı ya da düğme sayısı 0. Ekran görüntüleri: scratchpad/runtime/crops/search/004-0.png ve 005-1.png. Akıllı filtre 0 sonuç verdiğinde de aynı genel metin çıkıyor (p6).

**Etki:** Yazım hatası yapan ya da desteklenmeyen bir şehir arayan kullanıcı neyi değiştireceğini bilmiyor ve sayfada çıkmaza giriyor.

**Önerilen aksiyon:** Durumu ayırt edin. Destinasyon eşleşmediyse "“Zzzyxq” için konaklama bulunamadı. Yazımı kontrol edin" deyin ve "Aramayı düzenle", "Tüm konaklama yerleri" ve popüler şehir bağlantıları verin. Filtre aktifse etkin filtreleri listeleyip "Tüm filtreleri temizle" düğmesi koyun. Mesajı role="status" içine yerleştirin.

**Yapılan düzeltme:** The empty state now tells the cases apart. With active filters it says the filters match nothing and offers 'Tüm filtreleri temizle'. For an unknown destination it says '“X” için konaklama bulunamadı', asks the user to check the spelling and offers 'Aramayı düzenle'. Otherwise it shows a general hint. When a destination is set, an 'Tüm konaklama yerlerini gör' (/search) link is also shown. The message text sits inside role=status. Suggesting popular cities was not added. — dosyalar: `src/app/search/page.tsx`

## F145 — Akıllı filtre çipi kaldırılınca ya da "Akıllı filtreyi temizle" kullanılınca odak body'ye düşüyor

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | High                                                       |
| Durum               | Gözlemlendi                                                |
| Konum               | `src/components/search/SmartFilter.tsx:139`                |
| Diğer konumlar      | `src/components/search/SmartFilter.tsx:150`                |
| Kullanıcılar        | misafir                                                    |
| Prensip             | accessibility · Klavye ile işletilebilirlik ve odak sırası |
| Sezgisel madde      | H14 — Erişilebilirlik                                      |
| WCAG                | 2.4.3 Focus Order (A)                                      |
| Renk/tema           | Hayır                                                      |
| Efor                | S                                                          |
| Kaynak denetçiler   | runtime:results                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: resultsB)                           |

**Kanıt:** RUNTIME p6-smart.mjs (desktop TR, yalnızca klavye): "Şehir: Antalya filtresini kaldır" çipinde Enter'a basınca odak "body" oluyor. "Akıllı filtreyi temizle" tıklanınca da odak "body" oluyor (her iki düğme de DOM'dan kalkıyor).

**Etki:** Klavye ve ekran okuyucu kullanıcısı sayfanın başına atılıyor ve filtre alanına dönmek için onlarca kez Tab'a basması gerekiyor.

**Önerilen aksiyon:** Çip kaldırılınca odağı bir sonraki çipe, son çipse #smart-filter alanına taşıyın. Temizle'den sonra odak #smart-filter'a gitsin. Bunu ref ve useEffect ile ya da onChange sonrası focus() çağrısıyla yapabilirsiniz.

**Yapılan düzeltme:** In SmartFilter.tsx I added inputRef, chipListRef and pendingFocusIndex. When a chip is removed, removeAt stores that chip's index, and a useEffect on [filters] moves focus to the chip now in that position (or the last chip if there is none). When no chips are left, focus goes to the #smart-filter input. The clear button now calls inputRef.current?.focus() after onClear(). Visible text, accessible names and the label are unchanged. — dosyalar: `src/components/search/SmartFilter.tsx`

## F336 — 'Sıralama nasıl çalışır?' sayfası, arama metni içeren aramalarda kullanılan ağırlıkları göstermiyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | High                                                    |
| Durum               | Aday                                                    |
| Konum               | `src/app/ranking/page.tsx:30`                           |
| Diğer konumlar      | `src/lib/search.ts:657`, `src/lib/search/ranking.ts:25` |
| Kullanıcılar        | misafir                                                 |
| Prensip             | learnability · predictability                           |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                              |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:results                                            |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: resultsB)                 |

**Kanıt:** ranking/page.tsx:5 ve 30-38 yalnızca RANKING_WEIGHTS'i listeliyor (fiyat %30, puan %35, semantik %15). Oysa src/lib/search.ts:657 `const weights = pool ? RANKING_WEIGHTS_WITH_QUERY : RANKING_WEIGHTS;`: varış ya da metin girildiğinde (search/page.tsx:183-187'de destination + semantic=1) semantik %60, puan %15, fiyat %10 kullanılıyor (src/lib/search/ranking.ts:25-31). LTR deneyi (src/app/api/search/route.ts:27-29) de sayfada anılmıyor.

**Etki:** Varış girilen hemen her aramada misafir, sayfada okuduğundan farklı bir sıralama mantığına tabi oluyor. DSA md. 27 kapsamındaki şeffaflık beyanı gerçeği yansıtmıyor ve bu güveni zedeliyor.

**Önerilen aksiyon:** Tabloya iki ağırlık sütunu koyun: 'Ağırlık (arama metni yokken)' ve RANKING_WEIGHTS_WITH_QUERY'den gelen 'Ağırlık (arama metni varken)'. Altına 'Bazı kullanıcılarda deneysel, öğrenen bir sıralama modeli kullanılabilir; bileşenler aynıdır' cümlesini ekleyin. RankingWhy'da hangi ağırlık setinin kullanıldığını gösterin (API yanıtına weightsSet alanı ekleyerek).

**Yapılan düzeltme:** In ranking/page.tsx the table now has two weight columns: 'without search text' (RANKING_WEIGHTS) and 'with search text or a destination' (RANKING_WEIGHTS_WITH_QUERY). I added an sr-only caption, th scope=col/row, and wrapped the table in an overflow region (role=region, aria-label, tabIndex=0, focusRing). Below the table are a sentence explaining when the with-query weights apply (withQueryNote) and a note about the experimental learning model (experimentNote). Not done: showing in RankingWhy which weight set was used, because that needs a weightsSet field in the API response (needs backend/API change). RankingWhy.tsx is unchanged. — dosyalar: `src/app/ranking/page.tsx`

## F337 — Arama sonuç sayfasının belge başlığı (title) aramayı yansıtmıyor

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | High                                     |
| Durum               | Aday                                     |
| Konum               | `src/app/search/page.tsx:1`              |
| Diğer konumlar      | `src/app/layout.tsx:16`                  |
| Kullanıcılar        | misafir                                  |
| Prensip             | accessibility · WCAG 2.4.2 Sayfa başlığı |
| Sezgisel madde      | H14 — Erişilebilirlik                    |
| WCAG                | 2.4.2                                    |
| Renk/tema           | Hayır                                    |
| Efor                | S                                        |
| Kaynak denetçiler   | area:results                             |
| **Düzeltme durumu** | **Zaten uygun** (paket: results)         |

**Kanıt:** page.tsx:1 `'use client'`: sayfa metadata ya da generateMetadata dışa aktaramıyor ve src/app/search altında layout.tsx yok. Başlık kök layout'tan geliyor (src/app/layout.tsx:16 `title: t('meta.title')` → 'booking-platform — konaklama arama ve rezervasyon (demo)'). document.title hiçbir yerde güncellenmiyor. Karşılaştırma için: ranking/page.tsx:7-10 generateMetadata ile kendi başlığını veriyor.

**Etki:** Ekran okuyucu kullanıcısı sekmeler ya da geçmiş arasında 'İstanbul, 29 Eki-1 Kas' aramasını diğer sayfalardan ayıramıyor. Birden çok sekmede şehirleri karşılaştıran misafir sekmeleri birbirinden ayırt edemiyor.

**Önerilen aksiyon:** src/app/search/layout.tsx ekleyin ya da page'i bir sunucu bileşeni sarmalayıcısına bölün ve generateMetadata({ searchParams }) ile '{destination} konaklama · 29 Eki-1 Kas · booking-platform' biçiminde bir başlık üretin. Sonuç sayısı değiştiğinde istemcide document.title'ı güncelleyin.

**Yapılan düzeltme:** Page titles were handled globally in wave 1: src/app/search/layout.tsx already gives the route a title with generateMetadata(titles.search). The task said not to add titles or metadata, so a dynamic title per search was not added.

## F338 — Akıllı filtrenin 'Metin' çipi görünüyor ama şehir de çıkarıldığında aramaya hiç gönderilmiyor

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | High                            |
| Durum               | Aday                            |
| Konum               | `src/app/search/page.tsx:96`    |
| Kullanıcılar        | misafir                         |
| Prensip             | robustness · observability      |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü  |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | area:results                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: results) |

**Kanıt:** page.tsx:96-97 `const destination = f.city ?? f.query; if (destination) params.set('destination', destination);`: city varsa query atılıyor. SmartFilter.tsx:48-49 iki çipi de üretiyor ('Şehir: {value}' ve 'Metin: {value}'). src/lib/ai/smart-filter-parser.ts:5 belge örneği tam bu durum: `{ city: 'İstanbul', query: 'Kadıköy', ... }`. Sunucu city ile destination'ı ayrı okuyor (src/lib/search/params.ts:107-108).

**Etki:** Misafir 'Kadıköy'de deniz manzaralı' yazdığında 'Metin: Kadıköy' çipini etkin bir filtre sanıyor; oysa sonuçlar tüm İstanbul'u kapsıyor. Çip ile sonuçlar birbirini tutmuyor ve kullanıcının bunu fark etmesi mümkün değil.

**Önerilen aksiyon:** smartToParams'ta iki alanı ayrı gönderin: `if (f.city) params.set('city', f.city); if (f.query) params.set('destination', f.query);`. Ya da isteğe gönderilmeyen alanlar için çip üretmeyin.

**Yapılan düzeltme:** When the smart filter extracts both city and query, the request now sends city=<city> and destination=<query> separately. When only one exists, it goes in destination as before. — dosyalar: `src/app/search/page.tsx`

## F339 — Form alanı kenarlıkları beyaz zeminde 3:1 kontrastı sağlamıyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | High                                                         |
| Durum               | Aday                                                         |
| Konum               | `src/app/search/page.tsx:120`                                |
| Diğer konumlar      | `src/components/ui/ui.tsx:21`, `src/app/search/page.tsx:437` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | accessibility · WCAG 1.4.11 Metin dışı kontrast              |
| Sezgisel madde      | H14 — Erişilebilirlik                                        |
| WCAG                | 1.4.11                                                       |
| Renk/tema           | Evet — onaylandı, sonraki oturumda uygulanacak               |
| Efor                | S                                                            |
| Kaynak denetçiler   | area:results                                                 |
| **Düzeltme durumu** | **Onaylandı — sonraki oturumda uygulanacak (renk)**          |

**Kanıt:** page.tsx:120 `smallInput = 'w-full rounded-sm border border-gray-400 ...'` fiyat alanlarında ve sıralama/esneklik select'lerinde kullanılıyor; akıllı filtre girişi ui.tsx:21'deki inputClass ile aynı border-gray-400'ü kullanıyor. gray-400 = #9ca3af; beyaz kart zemininde kontrast ≈2.5:1. Alanların arka planı da beyaz olduğu için alanın sınırını belirten tek görsel ipucu bu kenarlık. Görünüm anahtarının kenarlığı (437) da aynı renkte.

**Etki:** Az gören misafir fiyat ve arama alanlarının sınırlarını seçemiyor; mobilde güneş altında alanlar kayboluyor.

**Önerilen aksiyon:** Bu düzeltme renk değişikliği gerektiriyor; kullanıcı renk ve temayı kapsam dışı bıraktığı için onayına sunulmalı. Kenarlığı gray-500 (#6b7280, ≈4.8:1) ya da daha koyu bir tona çekmek 3:1 eşiğini karşılar. Renk değiştirmeden tam bir çözüm yok: kenarlığı kalınlaştırmak kontrast oranını değiştirmez.

## F340 — Akıllı filtre etkinken yan paneldeki Sıralama ve Tarih esnekliği çalışmıyor; tür ve fiyat çipleri panelle eşzamanlı değil

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | High                            |
| Durum               | Aday                            |
| Konum               | `src/app/search/page.tsx:192`   |
| Kullanıcılar        | misafir                         |
| Prensip             | learnability · consistency      |
| Sezgisel madde      | H4 — Tutarlılık/standartlar     |
| Renk/tema           | Hayır                           |
| Efor                | M                               |
| Kaynak denetçiler   | area:results                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: results) |

**Kanıt:** page.tsx:179-193: sortBy yalnızca else dalında gönderiliyor (192 `if (sortBy && sortBy !== 'recommended') params.set('sort', sortBy)`). Akıllı filtre etkinken select değişikliği (386) yeniden yüklemeyi tetikliyor (219'daki bağımlılık) ama sıralama değişmiyor. Esneklik select'inin disabled koşulu URL tarihine bakıyor (404 `disabled={!checkIn || !checkOut}`); oysa 196 akıllı filtre tarihleriyle flexDays'i uygulayabiliyor. Akıllı filtrenin 'Villa' çipi (SmartFilter.tsx:55-58) tür onay kutularını (364 `checked={selectedTypes.includes(type)}`) işaretlemiyor. Fiyat çipi 'En çok 5000' iken yan panel 0-20000 göstermeye devam ediyor (159).

**Etki:** Misafir 'Fiyat (önce en düşük)' seçiyor, liste yeniden yükleniyor ama sıra değişmiyor; kontrol bozuk görünüyor. İki ayrı filtre sistemi aynı ölçütü farklı değerlerle gösteriyor ve hangi değerin uygulandığını kestirmek mümkün değil.

**Önerilen aksiyon:** Tek bir filtre durumu kullanın. Akıllı filtre sonucu geldiğinde panel kontrollerine yazılsın: sortBy=f.sort, selectedTypes=[f.propertyType], fiyat alanları=f.minPrice/f.maxPrice. Panelde yapılan değişiklik de smartFilters nesnesini güncellesin (ör. `setSmartFilters({ ...smartFilters, sort: value })`). Esneklik select'inin disabled koşulunu etkin parametrelerden hesaplayın.

**Yapılan düzeltme:** There is now one filter state. effSort, effType, effMin and effMax take the smart filter field when it exists and the URL/panel value otherwise, and the panel shows that value. A panel change updates both the URL and the matching smart field, so the chips stay in sync. Removing a chip (onSmartChange) also deletes that parameter from the URL. The flexibility select's disabled state now follows the effective dates (hasDates). — dosyalar: `src/app/search/page.tsx`

## F341 — Yalnızca ilk 24 sonuç yükleniyor; sayfalama yok ve fiyat/tür filtreleri istemcide yalnızca bu 24 sonuç üzerinde çalışıyor

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | High                            |
| Durum               | Aday                            |
| Konum               | `src/app/search/page.tsx:199`   |
| Kullanıcılar        | misafir                         |
| Prensip             | robustness · task conformance   |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü  |
| Renk/tema           | Hayır                           |
| Efor                | M                               |
| Kaynak denetçiler   | area:results                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: results) |

**Kanıt:** page.tsx:199-200 `params.set('page', '1'); params.set('pageSize', '24');`: başka bir sayfa isteyen kontrol yok (yanıttaki totalPages, satır 82, hiç kullanılmıyor). Fiyat ve tür filtresi istemcide yalnızca yüklenmiş dizi üzerinde çalışıyor: 249-255 `results.filter(...)`. Sayım metni 426 `t('resultCount', { shown: visibleResults.length, total })` '24 sonuç gösteriliyor (120 bulundu)' dediğinde kalan 96 ilana ulaşmanın yolu yok. 'Villa' seçmek yalnızca ilk 24 içindeki villaları gösteriyor.

**Etki:** Popüler şehirlerde misafir sonuçların çoğunu hiç göremiyor. Tür ve fiyat filtresi tüm havuzu değil bir dilimi süzdüğü için 'Sonuç bulunamadı' yanlış negatif verebiliyor.

**Önerilen aksiyon:** propertyType ile minPrice/maxPrice'ı sunucuya parametre olarak gönderin (SearchParamsSchema bunları zaten destekliyor: src/lib/search/params.ts:38-40) ve istemci filtresini kaldırın. Izgaranın altına totalPages'e göre 'Daha fazla göster (N kaldı)' düğmesi ya da numaralı sayfalama ekleyin. Yeni yüklenen ilk karta odak taşıyın ve sayımı aria-live ile duyurun.

**Yapılan düzeltme:** Same change as F8 (filters on the server), plus the 'Daha fazla göster' pagination from F140. — dosyalar: `src/app/search/page.tsx`

## F342 — Arama ilk 24 sonuçla sınırlı, devamına ulaşılamıyor ve istemci filtresi yanıltıyor

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                        |
| Durum               | Aday                                                                                        |
| Konum               | `src/app/search/page.tsx:200`                                                               |
| Diğer konumlar      | `src/app/search/page.tsx:249`, `src/app/search/page.tsx:426`, `src/app/search/page.tsx:478` |
| Kullanıcılar        | misafir                                                                                     |
| Prensip             | robustness · observability                                                                  |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                              |
| Renk/tema           | Hayır                                                                                       |
| Efor                | M                                                                                           |
| Kaynak denetçiler   | lens:mobile                                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: results)                                                             |

**Kanıt:** search/page.tsx:199-200'de `params.set("page", "1"); params.set("pageSize", "24");` sabit. SearchResponse'taki `totalPages` hiç kullanılmıyor. :426 `t("resultCount", { shown: visibleResults.length, total })` şunu gösteriyor: '24 sonuç gösteriliyor (87 bulundu)'. Daha fazla göster düğmesi ya da sayfa numarası yok. Fiyat ve tür süzgeci (:249-255) yalnız yüklenen 24 kayıt üzerinde istemcide çalışıyor, bu yüzden :478'deki 'Sonuç bulunamadı' sunucuda eşleşen ilan varken de görünebiliyor.

**Etki:** Misafir 87 ilanın 63'üne hiç ulaşamıyor. Fiyat filtresi 'sonuç yok' derken uygun ilanlar aslında var, bu da yanlış karar ya da terkle sonuçlanıyor.

**Önerilen aksiyon:** Izgaranın altına 'Daha fazla göster (24/87)' düğmesi ekle: page+1 iste, sonuçları listeye ekle, odağı yeni gelen ilk karta taşı ve durumu aria-live ile duyur. `page` değerini URL'de tut. Fiyat ve tür süzgeçlerini sunucu parametrelerine taşı (`minPrice`, `maxPrice`, `propertyType` smartToParams'ta zaten var). Sayaç metnini 'Toplam N ilandan M tanesi gösteriliyor' biçiminde netleştir.

**Yapılan düzeltme:** Same change as F8 and F140. The count text was also reworded to '{total} konaklamadan {shown} tanesi gösteriliyor' (patch). — dosyalar: `src/app/search/page.tsx`

## F343 — Arama sonuçları 24 ile sınırlı; '24 sonuç gösteriliyor (120 bulundu)' denip devamına ulaşma yolu yok

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | High                                                        |
| Durum               | Aday                                                        |
| Konum               | `src/app/search/page.tsx:200`                               |
| Diğer konumlar      | `src/app/search/page.tsx:426`, `messages/tr/search.json:36` |
| Kullanıcılar        | misafir                                                     |
| Prensip             | robustness · task conformance                               |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                              |
| Renk/tema           | Hayır                                                       |
| Efor                | M                                                           |
| Kaynak denetçiler   | lens:copy                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: results)                             |

**Kanıt:** search/page.tsx:199-200 `params.set("page", "1"); params.set("pageSize", "24");` sabit; yanıtta totalPages var (83) ama hiçbir sayfalama/‘Daha fazla göster’ denetimi render edilmez. 426 `t("resultCount", { shown: visibleResults.length, total })` → search.json:36 '{shown} sonuç gösteriliyor ({total} bulundu)'.

**Etki:** Misafir bulunan ilanların çoğunu hiç göremez; mesaj eksikliği gösterir ama eylem sunmaz (gözlemlenebilirlik var, kurtarma yok).

**Önerilen aksiyon:** Listenin altına 'Daha fazla göster (24/120)' düğmesi veya numaralı sayfalama ekleyin, page parametresini URL'de tutun; sayaç metnini 'İlk 24 sonuç gösteriliyor — toplam 120' gibi netleştirin.

**Yapılan düzeltme:** Same change as F140, with the count text clarified. The page number is not kept in the URL, because the button appends results. — dosyalar: `src/app/search/page.tsx`

## F344 — Fiyat bağlamı tutarsız: filtre birimsiz ve gecelik taban fiyata göre, harita pini etiketsiz taban fiyat, kart ise toplam

| Alan                | Değer                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                      |
| Durum               | Aday                                                                                                                                                                      |
| Konum               | `src/app/search/page.tsx:249`                                                                                                                                             |
| Diğer konumlar      | `src/app/search/page.tsx:159`, `src/app/search/page.tsx:266`, `src/app/search/page.tsx:328-354`, `src/components/search/ResultsMap.tsx:221`, `messages/tr/search.json:12` |
| Kullanıcılar        | misafir                                                                                                                                                                   |
| Prensip             | learnability · predictability                                                                                                                                             |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                     |
| Efor                | M                                                                                                                                                                         |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results)                                                                                                                                    |

**Kanıt:** search/page.tsx:159 `useState<[number, number]>([0, 20000])` önceden dolu; 328-354 legend 'Fiyat Aralığı' para birimi ve 'gecelik/toplam' bilgisi içermez, alanlar yalnız 'Min/Max' placeholder'lı (sr-only label). 249-255 süzgeç `toMajorNumber(p.basePriceMinor, p.currency)` (gecelik taban, para birimi karışık) ile ve yalnız istemcide çalışır. 266 harita etiketi `priceLabel: f.money(p.basePriceMinor, ...)` — '/gece' yok; aynı ilan listede PropertyCard.tsx:176-181 'X gece toplam' tutarıyla görünür.

**Etki:** Misafir '5000 altı' filtrelediğinde toplamı 15.000 olan ilanı görür; haritada ₺1.600 görüp kartta ₺6.357 ile karşılaşır; EUR ilanlar TL eşiğiyle karşılaştırılır.

**Önerilen aksiyon:** Filtre başlığını 'Gecelik fiyat (₺)' yapın, varsayılanları boş bırakıp görünür etiketler 'En az'/'En çok' kullanın; tarih seçiliyse filtreyi ve harita pinini toplam fiyata göre çalıştırıp pin metnine '/gece' veya 'toplam' son ekini yazın; süzgeci sunucuya (minPrice/maxPrice) taşıyın.

**Yapılan düzeltme:** Covered by the F68 changes, and the price fields now start empty instead of 0-20000. The map pin and side list now say '{price} toplam' when dates are set and '{price} / gece' otherwise. The popup link inside ResultsMap is another owner's file (see crossOwner). — dosyalar: `src/app/search/page.tsx`

## F345 — Fiyat aralığı filtresi kartta görünen fiyatı değil, karışık para birimlerindeki gecelik taban fiyatı süzüyor; birim etiketi de yok

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | High                                   |
| Durum               | Aday                                   |
| Konum               | `src/app/search/page.tsx:250`          |
| Kullanıcılar        | misafir                                |
| Prensip             | learnability · predictability          |
| Sezgisel madde      | H4 — Tutarlılık/standartlar            |
| Renk/tema           | Hayır                                  |
| Efor                | M                                      |
| Kaynak denetçiler   | area:results                           |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results) |

**Kanıt:** page.tsx:250-252 `const price = toMajorNumber(p.basePriceMinor, p.currency); if (price < priceRange[0] || price > priceRange[1]) return false;`: tarih seçiliyken kart vergi dahil toplamı gösteriyor (PropertyCard.tsx:173-181), filtre ise gecelik tabanı karşılaştırıyor. İlanlar farklı para birimlerindeyse (p.currency) 100 EUR ile 100 TRY aynı sayı sayılıyor. Lejantta yalnızca 'Fiyat Aralığı' yazıyor (329; tr/search.json:21); birim, para birimi ya da gecelik/toplam bilgisi yok. Akıllı filtre ise fiyatı sunucuda, görüntüleme para birimindeki toplam üzerinden süzüyor (src/lib/search/params.ts:11-12; src/lib/search.ts:592-597).

**Etki:** Misafir 3 gecelik aramada 'en çok 5000' giriyor; gecelik tabanı 2500 olan ve kartta ₺7.500 toplam görünen ilan listede kalmaya devam ediyor. Tersine, bütçeye uyan bir ilan da gizlenebiliyor. Para kararı yanlış bilgiyle veriliyor.

**Önerilen aksiyon:** Fiyat filtresini sunucuya minPrice/maxPrice olarak gönderin; sunucu görüntüleme para biriminde ve tarih varsa toplam üzerinden süzer. Lejantı dinamik yapın: tarih varsa 'Toplam fiyat (3 gece, ₺)', yoksa 'Gecelik fiyat (₺)'. Alanların önüne para birimini görünür metin olarak ekleyin.

**Yapılan düzeltme:** Price filtering moved to the server (minPrice/maxPrice), and the legend now says whether it is the total or the nightly price. The page does not send a display currency, so a server without one still compares each listing in its own currency. Mixed-currency results are therefore not fully solved, and only a uniform currency code is shown in the legend. — dosyalar: `src/app/search/page.tsx`

## F346 — Harita görünümü tarih bağlamını kaybediyor: işaretçideki fiyat etiketsiz gecelik taban, açılır penceredeki bağlantı tarihsiz

| Alan                | Değer                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Severity            | High                                                                                   |
| Durum               | Aday                                                                                   |
| Konum               | `src/app/search/page.tsx:266`                                                          |
| Diğer konumlar      | `src/components/search/ResultsMap.tsx:239`, `src/components/search/ResultsMap.tsx:223` |
| Kullanıcılar        | misafir                                                                                |
| Prensip             | learnability · consistency                                                             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                            |
| Renk/tema           | Hayır                                                                                  |
| Efor                | S                                                                                      |
| Kaynak denetçiler   | area:results                                                                           |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results)                                                 |

**Kanıt:** page.tsx:266 `priceLabel: f.money(p.basePriceMinor, p.currency)`: tarih seçiliyken liste kartı vergi dahil toplamı gösteriyor (PropertyCard.tsx:173-181); harita işaretçisi (ResultsMap.tsx:223) ve yan liste (page.tsx:607) ise 'gecelik' ibaresi olmadan taban fiyatı gösteriyor. ResultsMap.tsx:238-240'taki açılır pencere bağlantısı `href={'/property/' + selected.id}` checkIn/checkOut/guests/roomId/ratePlanId taşımıyor; kart bağlantısından farklı.

**Etki:** Misafir listede ₺7.500 (3 gece toplam) olarak gördüğü ilanı haritada ₺2.100 olarak görüyor ve hangisinin gerçek fiyat olduğunu bilemiyor. Haritadan ilana geçtiğinde tarihleri yeniden seçmek zorunda kalıyor.

**Önerilen aksiyon:** MapPoint'e stay bilgisini ekleyin. Quote varsa `priceLabel = f.money(quote.total, quote.currency)` olsun ve aria-label'a '3 gece toplam' eklensin; yoksa fiyat 'gecelik ₺X' etiketiyle gösterilsin. Açılır penceredeki bağlantıyı PropertyCard ile aynı href üreticisiyle (checkIn, checkOut, guests, roomId, ratePlanId) oluşturun.

**Yapılan düzeltme:** The map priceLabel now shows the quote total ('toplam') when dates are set and the '/ gece' label otherwise. The popup link that carries no dates is in ResultsMap.tsx, which is another owner's file (see crossOwner). — dosyalar: `src/app/search/page.tsx`

## F347 — Arama sonuç sayfasında aramayı (yer, tarih, kişi) düzenleme yok; ana sayfadaki arama çubuğu da önceki aramayla dolmuyor

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | High                                     |
| Durum               | Aday                                     |
| Konum               | `src/app/search/page.tsx:283`            |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:19` |
| Kullanıcılar        | misafir                                  |
| Prensip             | flexibility · dialog initiative          |
| Sezgisel madde      | H7 — Esneklik/verim                      |
| Renk/tema           | Hayır                                    |
| Efor                | M                                        |
| Kaynak denetçiler   | lens:nav                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results)   |

**Kanıt:** search/page.tsx SearchBar ve DateRangePicker import etmiyor. 283-291'deki başlık bloğu destination, tarih ve kişi sayısını yalnız metin olarak gösteriyor (`{f.date(checkIn)} - {f.date(checkOut)} · {t("guestCount"…)}`). SearchBar.tsx:19-26 başlangıç durumu boş (`useState("")`, adults 2) ve URL'den doldurulmuyor. Boş sonuçta "Filtreleri değiştirmeyi deneyin." deniyor ama ana kriterler bu sayfada değiştirilemiyor.

**Etki:** Tarihi bir gün kaydırmak veya kişi eklemek isteyen misafir ana sayfaya dönüp yeri yeniden yazmak, tarihleri yeniden seçmek ve kişileri yeniden ayarlamak zorunda. Bu, mobilde fazladan adım ve tarih hatası riski demek; misafirin tarih hatası toleransı çok düşük.

**Önerilen aksiyon:** SearchBar'a `initial` prop'u ekleyin (destination, checkIn, checkOut, adults/children). search/page.tsx başlığında kompakt sürümünü URL'den doldurarak render edin. Gönderimde accessibility, flexDays gibi mevcut parametreleri koruyun. Ana sayfadaki SearchBar da son aramayı (sessionStorage) önersin.

**Yapılan düzeltme:** Editing the search on the results page now works (see F141). The home-page SearchBar is still not prefilled with the previous search, because SearchBar.tsx is another owner's file (crossOwner). — dosyalar: `src/app/search/page.tsx`

## F348 — Sonuç sayfasında varış, tarih ve misafir sayısı değiştirilemiyor (arama çubuğu yok)

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | High                                     |
| Durum               | Aday                                     |
| Konum               | `src/app/search/page.tsx:284`            |
| Diğer konumlar      | `src/components/search/SearchBar.tsx:47` |
| Kullanıcılar        | misafir                                  |
| Prensip             | robustness · task conformance            |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü        |
| Renk/tema           | Hayır                                    |
| Efor                | M                                        |
| Kaynak denetçiler   | area:results                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: results)          |

**Kanıt:** page.tsx:283-291'deki üst kutu yalnızca metin gösteriyor: `<h1>{t('heading.destination', { destination })}</h1><p>{f.date(checkIn)} - {f.date(checkOut)} · {guestCount}</p>`; düzenleme kontrolü yok. SearchBar yalnızca src/app/page.tsx'te kullanılıyor (grep ile doğrulandı). URL'de guests yoksa 130 `Number(searchParams.get('guests')) || 2` sessizce 2 varsayıyor ve başlıkta bunu kullanıcının seçimiymiş gibi gösteriyor.

**Etki:** Tarihleri bir gün kaydırmak ya da misafir sayısını değiştirmek isteyen misafir ana sayfaya dönüp aramayı baştan girmek zorunda. Bu sırada yan paneldeki filtreler de kayboluyor (bkz. URL bulgusu). Karşılaştırma görevinin en sık adımı kesintiye uğruyor.

**Önerilen aksiyon:** Başlık kutusuna mevcut değerlerle önceden doldurulmuş SearchBar'ı ekleyin; mobilde 'Aramayı düzenle' düğmesiyle açılan kompakt bir form da olabilir. Misafir sayısı varsayılan değerden geliyorsa alt satırda '2 misafir (varsayılan) · Değiştir' yazın.

**Yapılan düzeltme:** Same change as F141. When guests is missing from the URL, the subtitle now says '{count} misafir (varsayılan)' (guestCountDefault). — dosyalar: `src/app/search/page.tsx`

## F349 — Mobil aramada filtre paneli sonuçlardan önce ve daraltılamaz (≈20 denetim)

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | High                                                                                     |
| Durum               | Aday                                                                                     |
| Konum               | `src/app/search/page.tsx:323`                                                            |
| Diğer konumlar      | `src/components/search/AccessibilityFilter.tsx:75-85`, `src/app/search/page.tsx:505-551` |
| Kullanıcılar        | misafir                                                                                  |
| Prensip             | learnability · Bilişsel yük — Hick yasası / ilerici açıklama                             |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                                             |
| Renk/tema           | Hayır                                                                                    |
| Efor                | M                                                                                        |
| Kaynak denetçiler   | lens:copy                                                                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results)                                                   |

**Kanıt:** search/page.tsx:323-324 `grid grid-cols-1 ... lg:grid-cols-4` içinde <aside> ilk çocuk; mobilde akıllı filtre (309-321) + fiyat (2 alan) + 5 tür + AccessibilityFilter'ın 11 onay kutusu (AccessibilityFilter.tsx:75-85) + sıralama + esneklik seçimi sonuç kartlarından önce gelir. Her kart ayrıca favori, 'Fırsatı Gör', 'Bu sıralama neden?', 'Karşılaştırmaya ekle', 'Benzerlerini göster', esnek tarih önerisi ile 5-6 eylem taşır (505-551).

**Etki:** Mobil ağırlıklı misafir ilk sonucu görmek için uzun bir form kaydırır; seçenek bolluğu karar süresini uzatır ve görevi terk ettirir.

**Önerilen aksiyon:** lg altı ekranlarda filtreleri 'Filtreler (n etkin)' düğmesiyle açılan bir sayfa/çekmeceye taşıyın (aria-expanded); erişilebilirlik grubunu <details> ile varsayılan kapalı yapın; kart başına ikincil eylemleri (karşılaştır, neden, benzer) bir 'Daha fazla' menüsünde toplayın.

**Yapılan düzeltme:** The mobile filter collapse is the same as in F142. Grouping the card's secondary actions into a menu needs product and component-owner decisions (PropertyCard, RankingWhy, CompareToggle) and was not done. — dosyalar: `src/app/search/page.tsx`

## F350 — Mobilde (360px) akıllı filtre ve ~22 kontrollü filtre paneli sonuçlardan önce geliyor ve katlanamıyor; klavyeyle sonuçlara ulaşmak ~22 sekme sürüyor

| Alan                | Değer                                                           |
| ------------------- | --------------------------------------------------------------- |
| Severity            | High                                                            |
| Durum               | Aday                                                            |
| Konum               | `src/app/search/page.tsx:324`                                   |
| Diğer konumlar      | `src/components/search/AccessibilityFilter.tsx:31`              |
| Kullanıcılar        | misafir                                                         |
| Prensip             | flexibility · customizability (ekran boyutuna uyarlanabilirlik) |
| Sezgisel madde      | H7 — Esneklik/verim                                             |
| Renk/tema           | Hayır                                                           |
| Efor                | L                                                               |
| Kaynak denetçiler   | area:results                                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results)                          |

**Kanıt:** page.tsx:323-324 `grid grid-cols-1 ... lg:grid-cols-4` ve `<aside className='lg:col-span-1'>`: lg kırılımının altında panel tam genişlikte ve sonuçların üstünde. Panelde 2 fiyat alanı (334-353), 5 tür onay kutusu (360-370), 11 erişilebilirlik onay kutusu (AccessibilityFilter.tsx:31-41), sıralama ve esneklik select'leri (383, 400) var; üstte ayrıca akıllı filtre (310-320). İlk sonuç kartından önce ~22 odaklanabilir kontrol geçiliyor ve 'Sonuçlara geç' bağlantısı yok. Filtre değişikliğinin etkisi (sayım 425, ızgara 504) ekran dışında kalıyor.

**Etki:** Çoğunlukla mobilden gelen misafir ilk ilanı görmek için birkaç ekran kaydırmak zorunda; bir filtreyi değiştirdiğinde sonuçların değiştiğini görmüyor. Yalnızca klavye kullanan kullanıcı her yüklemede panelin tamamından geçiyor.

**Önerilen aksiyon:** lg altında paneli 'Filtreler (seçili sayı)' düğmesiyle açılan bir alt sayfaya ya da dialog'a taşıyın (aria-expanded, odak tuzağı ve 'N sonucu göster' kapatma düğmesiyle). Erişilebilirlik listesini varsayılan olarak kapalı bir `<details>` içine alın ve özette seçili sayısını gösterin. Ana içeriğin başına 'Sonuçlara geç' (href='#results') bağlantısı ekleyin. Mobilde sıralama select'ini sonuç sayımı satırına taşıyın.

**Yapılan düzeltme:** Same as F142: the panel is collapsible on mobile and the 'Sonuçlara geç' link was added. Collapsing the AccessibilityFilter list is crossOwner. — dosyalar: `src/app/search/page.tsx`

## F351 — Arama sonuçları mobilde uzun ve kapatılamayan filtre panelinin altında kalıyor

| Alan                | Değer                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Severity            | High                                                                              |
| Durum               | Aday                                                                              |
| Konum               | `src/app/search/page.tsx:324`                                                     |
| Diğer konumlar      | `src/components/search/AccessibilityFilter.tsx:37`, `src/app/search/page.tsx:504` |
| Kullanıcılar        | misafir                                                                           |
| Prensip             | robustness · task conformance                                                     |
| Sezgisel madde      | H7 — Esneklik/verim                                                               |
| Renk/tema           | Hayır                                                                             |
| Efor                | M                                                                                 |
| Kaynak denetçiler   | lens:mobile                                                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results)                                            |

**Kanıt:** search/page.tsx:323 `grid grid-cols-1 gap-8 lg:grid-cols-4`, :324 `<aside className="lg:col-span-1">` her genişlikte açık. İçinde fiyat (2 input), 5 mülk türü onay kutusu, AccessibilityFilter (accessibility-codes.ts:5-17'den 11 onay kutusu ve ipucu), sıralama ve esneklik select'leri var. Sonuç ızgarası (:504) DOM'da bunların ardından geliyor ve üstte bir de SmartFilter kartı var. Panel için daraltma, çekmece ya da 'Filtrele' düğmesi yok. 'Sırala' panelin en altında.

**Etki:** Mobil misafir arama yaptıktan sonra sonuç yerine bir form duvarı görüyor. 360×740 ekranda ilk ilan kartı ≈1,5 ekran aşağıda. Sonuç sayısı (:426) bile kaydırmadan görünmüyor, sık kullanılan sıralamaya erişim uzun.

**Önerilen aksiyon:** lg altında aside'ı `hidden lg:block` yap. Sonuç başlığının yanına yapışkan bir araç çubuğu koy: 'Filtrele (aktif filtre sayısı)' düğmesi tam ekran `role="dialog"` alt sayfayı açsın (aynı fieldset'ler, 'N sonucu göster' ve 'Temizle' ile), 'Sırala' select'i doğrudan çubukta dursun. Erişilebilirlik filtresini varsayılan olarak kapalı `<details>` içine al.

**Yapılan düzeltme:** Same as F142. 'Tüm filtreleri temizle' was added at the bottom of the panel. — dosyalar: `src/app/search/page.tsx`

## F352 — Kart toplam fiyatı ve 'Fırsatı Gör' bağlantısı farklı tarih aralıklarına ait olabiliyor

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | High                            |
| Durum               | Aday                            |
| Konum               | `src/app/search/page.tsx:520`   |
| Kullanıcılar        | misafir                         |
| Prensip             | robustness · task conformance   |
| Sezgisel madde      | H5 — Hata önleme                |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | area:results                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: results) |

**Kanıt:** page.tsx:520-531 `stay={property.quote && checkIn && checkOut ? { total: property.quote.total, nights: property.quote.nights, checkIn, checkOut, guests, ... } : undefined}`: akıllı filtre etkinken quote, smartToParams'ın gönderdiği f.checkIn/f.checkOut için (103-104) hesaplanıyor. checkIn/checkOut/guests ise URL'den geliyor (128-130). PropertyCard.tsx:50-57 bu URL tarihlerini roomId/ratePlanId ile birlikte ilan bağlantısına yazıyor. Akıllı filtrede tarih olup URL'de olmadığında stay undefined kalıyor ve kart (PropertyCard.tsx:184-187) 'gecelik başlangıç... tarih seçince vergi ve ücretler eklenir' diyor. CompareBar (558) da URL tarihlerini taşıyor.

**Etki:** Misafir kartta 'X gece toplam ₺Y' görüyor; tıkladığında ilan sayfası başka bir tarih aralığı ve misafir sayısıyla açılıyor, fiyat değişiyor. Para ve tarih hatasına toleransın en düşük olduğu adımda yanlış toplam gösteriliyor. Tarih seçilmiş olmasına rağmen kart 'tarih seçin' diyor.

**Önerilen aksiyon:** load() içinde isteğe gönderilen checkIn/checkOut/guests değerlerini state'e kaydedin (`setActiveStay({ checkIn: params.get('checkIn'), checkOut: params.get('checkOut'), guests: params.get('guests') })`). PropertyCard `stay`, FlexSuggestionNote ve CompareBar bu değerleri kullanmalı. Alternatif: API quote nesnesine checkIn/checkOut/guests ekleyin ve kart bunları okusun.

**Yapılan düzeltme:** The checkIn, checkOut and guests actually sent with a successful request are now kept in stay state. PropertyCard's stay, FlexSuggestionNote's guests and CompareBar all use those values, so the price and the link always refer to the same dates. — dosyalar: `src/app/search/page.tsx`

## F353 — Sabit karşılaştırma çubuğu sayfanın altını ve odaktaki öğeleri örtüyor

| Alan                | Değer                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Severity            | High                                                                    |
| Durum               | Aday                                                                    |
| Konum               | `src/app/search/page.tsx:558`                                           |
| Diğer konumlar      | `src/components/compare/CompareBar.tsx:31`, `src/styles/globals.css:65` |
| Kullanıcılar        | misafir                                                                 |
| Prensip             | accessibility · WCAG 2.4.11 Odak gizlenmemeli (minimum)                 |
| Sezgisel madde      | H14 — Erişilebilirlik                                                   |
| WCAG                | 2.4.11                                                                  |
| Renk/tema           | Hayır                                                                   |
| Efor                | S                                                                       |
| Kaynak denetçiler   | area:results                                                            |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: results)                                  |

**Kanıt:** CompareBar.tsx:31 `fixed inset-x-0 bottom-0 z-40 ... py-3`: çubuk en az bir ilan seçilince görünüyor. page.tsx:282 `<main ... py-8>` buna karşılık alt boşluk eklemiyor. src/styles/globals.css:65-66 yalnızca `scroll-padding-top: 5rem` tanımlıyor, scroll-padding-bottom yok. Son satırdaki kartın 'Karşılaştırmaya ekle' ve 'Benzerlerini göster' bağlantıları ile Footer bağlantıları Tab ile odaklandığında tarayıcı onları görünüme kaydırıyor ama çubuğun altında kalabiliyorlar.

**Etki:** Klavye kullanıcısı odaktaki öğeyi göremiyor; mobilde son ilanın 'Fırsatı Gör' düğmesi çubuğun altında kalıyor.

**Önerilen aksiyon:** CompareBar görünürken `document.documentElement.style.scrollPaddingBottom` değerini çubuğun yüksekliğine ayarlayın (yüksekliği ResizeObserver ile ölçün). main'e de aynı yükseklikte alt dolgu ekleyin (ör. ids.length > 0 iken `pb-24`).

**Yapılan düzeltme:** While compare items are selected (useCompareSelection ids.length > 0), an h-24 spacer now sits at the end of main, so the last row is not covered by the fixed bar. scroll-padding-bottom is set in CompareBar or globals.css, which belong to other owners (crossOwner). — dosyalar: `src/app/search/page.tsx`

## F354 — Çip kaldırıldığında ya da 'Akıllı filtreyi temizle'ye basıldığında klavye odağı kayboluyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | High                                        |
| Durum               | Aday                                        |
| Konum               | `src/components/search/SmartFilter.tsx:139` |
| Kullanıcılar        | misafir                                     |
| Prensip             | accessibility · WCAG 2.4.3 Odak sırası      |
| Sezgisel madde      | H14 — Erişilebilirlik                       |
| WCAG                | 2.4.3                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:results                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: resultsB)            |

**Kanıt:** SmartFilter.tsx:139 `onClick={() => onChange(removeChip(filters, chip))}`: tıklanan düğme DOM'dan kalkıyor ama odak için yeni bir hedef belirlenmiyor, odak body'ye düşüyor. 150-153'teki temizle düğmesi `setText(''); onClear();` çağırdıktan sonra çip bloğunun tamamı (128 `filters &&`) kaldırılıyor; odak yine body'ye düşüyor.

**Etki:** Klavye ve ekran okuyucu kullanıcısı her çip kaldırışında sayfanın başına dönüyor; birden çok çipi kaldırmak için her seferinde 5'ten fazla sekmeyle geri gelmesi gerekiyor.

**Önerilen aksiyon:** Bir çip kaldırıldığında odağı sonraki çipe, yoksa öncekine, hiç çip kalmadıysa akıllı filtre girişine taşıyın (useRef ile `inputRef.current?.focus()`). Temizle düğmesinden sonra da odağı girişe taşıyın.

**Yapılan düzeltme:** Duplicate of F145, fixed by the same change: focus moves to the next chip, or the previous one, or the input, and Clear sends focus back to the input. — dosyalar: `src/components/search/SmartFilter.tsx`

## F448 — Akıllı filtre aktifken kenar çubuğundaki sıralama sessizce yok sayılıyor

| Alan                | Değer                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Severity            | Medium                                                               |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                      |
| Konum               | `src/app/search/page.tsx:181`                                        |
| Diğer konumlar      | `src/app/search/page.tsx:284-286`, `src/app/search/page.tsx:383-393` |
| Kullanıcılar        | misafir                                                              |
| Prensip             | robustness · Geri bildirim ve tutarlılık                             |
| Sezgisel madde      | H12 — Feedback                                                       |
| Renk/tema           | Hayır                                                                |
| Efor                | S                                                                    |
| Kaynak denetçiler   | runtime:results, lens:copy                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                         |

**Kanıt:** RUNTIME p6-smart.mjs: akıllı filtre aktifken #sort-by "rating" seçiliyor. Giden istek değişmiyor: GET /api/search?destination=Antalya&guests=4&maxPrice=9000&propertyType=VILLA&amenities=Havuz&page=1&pageSize=24, yani sort parametresi yok. Select ise "Puan (önce en yüksek)" göstermeye devam ediyor. KOD: page.tsx:179-182, smartToParams sortBy değerini kullanmıyor.

**Etki:** Kullanıcı sıralamanın uygulandığını sanıyor ama sonuç sırası değişmiyor ve görünen durum gerçekle çelişiyor.

**Önerilen aksiyon:** smartToParams sonrasında sortBy != "recommended" ise params.set("sort", sortBy) çağırın; ya da sıralamayı akıllı filtre çipiyle eşleyin. İkisi de yapılmayacaksa select'i bir açıklamayla devre dışı bırakın.

## F549 — Harita ve harita listesi gecelik taban fiyatı birim etiketi olmadan gösteriyor, kartlar ise toplam fiyat gösteriyor

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Medium                        |
| Durum               | Gözlemlendi                   |
| Konum               | `src/app/search/page.tsx:266` |
| Kullanıcılar        | misafir                       |
| Prensip             | learnability · Tutarlılık     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar   |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | runtime:results               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** RUNTIME p3-map.mjs (desktop TR, 27-29.01.2027): harita listesinde "Grand Deluxe Hotel İstanbul · ₺2.450,00" ve işaretçide "₺2.450,00" var. Liste görünümündeki kart aynı ilan için "2 gece toplam ₺4.647,33" diyor. Ekran görüntüsü: crops/search/map-desktop.png.

**Etki:** Görünüm değişince aynı ilanın fiyatı değişmiş gibi algılanıyor ve kullanıcı haritada yanlış fiyata göre karar veriyor.

**Önerilen aksiyon:** priceLabel, quote varsa f.money(quote.total) ve "2 gece toplam" ile, yoksa "gecelik ₺…" ile gösterilsin. İşaretçinin aria-label'ı da aynı birimi içersin.

## F550 — Fiyat alanları temizlenemiyor ("0", "05000"), her tuş vuruşunda süzme yapılıyor ve canlı bölge ara sonuçları duyuruyor

| Alan                | Değer                                   |
| ------------------- | --------------------------------------- |
| Severity            | Medium                                  |
| Durum               | Gözlemlendi                             |
| Konum               | `src/app/search/page.tsx:338`           |
| Diğer konumlar      | `src/app/search/page.tsx:350`           |
| Kullanıcılar        | misafir                                 |
| Prensip             | robustness · Hata önleme ve yanıt verme |
| Sezgisel madde      | H5 — Hata önleme                        |
| Renk/tema           | Hayır                                   |
| Efor                | S                                       |
| Kaynak denetçiler   | runtime:results                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**            |

**Kanıt:** RUNTIME p2-links.mjs: #price-max alanına fill('') yapınca değer "0" oluyor. Ardından 5000 yazınca değer "05000" oluyor. p1-filters.mjs: "3000" tuş tuş yazılırken canlı bölge önce "0 sonuç gösteriliyor (4 bulundu)", sonra "3 sonuç gösteriliyor" diyor; arada "Sonuç bulunamadı" kutusu yanıp sönüyor. Max alanı silindiğinde tüm sonuçlar kayboluyor. Min değerin max'tan büyük olması doğrulanmıyor. placeholder ("Min"/"Max") hiçbir zaman görünmüyor, çünkü alanın değeri her zaman dolu.

**Etki:** Kullanıcı sınırı kaldıramıyor ve 0'a düşen max değeri tüm sonuçları gizliyor. Ekran okuyucu kullanıcısı her tuşta yanıltıcı bir "0 sonuç" duyuyor.

**Önerilen aksiyon:** Durumu string olarak tutun; boş alan sınır yok anlamına gelsin. Uygulamayı 400 ms debounce ile ya da blur/Enter anında yapın. Min değer max'tan büyükse aria-describedby ile satır içi hata gösterin. inputMode="numeric" ekleyin. Varsayılan değer 0/20000 yerine boş olsun ki placeholder görünsün.

## F551 — Sonuç bölümünün başlığı yok: kart H3'leri "Filtreler" H2'sinin altında görünüyor; sonuçlara atlama yolu yok (24 Tab)

| Alan                | Değer                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Severity            | Medium                                                               |
| Durum               | Gözlemlendi                                                          |
| Konum               | `src/app/search/page.tsx:423`                                        |
| Diğer konumlar      | `src/app/search/page.tsx:504`                                        |
| Kullanıcılar        | misafir                                                              |
| Prensip             | accessibility · Yapı ve ilişkiler, gezinme verimliliği               |
| Sezgisel madde      | H14 — Erişilebilirlik                                                |
| WCAG                | 1.3.1 Info and Relationships (A, best practice); 2.4.1 Bypass Blocks |
| Renk/tema           | Hayır                                                                |
| Efor                | S                                                                    |
| Kaynak denetçiler   | runtime:results                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                         |

**Kanıt:** RUNTIME p8-tab.mjs başlık dökümü: H1 "İstanbul için konaklama" → H2 "Filtreler" → H3 Grand Deluxe Hotel … H3 Luxury Bosphorus Suite → H2 Destek. p7-misc.mjs: #smart-filter'dan ilk sonuç denetimine ulaşmak 24 Tab basışı gerektiriyor. Sonuç ızgarası bir div; liste semantiği yok, dolayısıyla "liste, 4 öğe" duyurulmuyor.

**Etki:** Ekran okuyucu kullanıcısı başlık gezintisinde sonuçları filtrelerin alt bölümü sanıyor. Klavye kullanıcısı her aramada 24 Tab basıyor.

**Önerilen aksiyon:** Sonuç sütununu <section aria-labelledby="results-h"> ile sarıp içine <h2 id="results-h">Sonuçlar</h2> koyun (görsel ya da sr-only). Izgarayı <ul role="list"> ve <li> ile kurun. Akıllı filtreden sonra "Sonuçlara geç" bağlantısı ekleyin.

## F552 — Harita için liste alternatifi zayıf: öğeler yalnızca seçim düğmesi, ilana doğrudan bağlantı, puan ya da toplam fiyat yok; harita görünümünde kartlar tümüyle gizleniyor

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Gözlemlendi                                       |
| Konum               | `src/app/search/page.tsx:595`                     |
| Diğer konumlar      | `src/app/search/page.tsx:503`                     |
| Kullanıcılar        | misafir                                           |
| Prensip             | flexibility · İkame edilebilirlik: eşdeğer temsil |
| Sezgisel madde      | H7 — Esneklik/verim                               |
| Renk/tema           | Hayır                                             |
| Efor                | M                                                 |
| Kaynak denetçiler   | runtime:results                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                      |

**Kanıt:** RUNTIME p3-map.mjs: harita görünümünde cardsVisible=0. Yan listede aria-pressed düğmeleri var: "Grand Deluxe Hotel İstanbul · ₺2.450,00". Enter'a basınca odak harita içindeki popup bağlantısına sıçrıyor; Tab sırası "Close popup" ve ardından listeye dönüyor. İlana gitmenin tek yolu popup içindeki parametresiz bağlantı. Mobilde liste 480px yüksekliğindeki haritanın altında kalıyor (crops/search/mapm-2.png).

**Etki:** Haritayı kullanamayan (ekran okuyucu, düşük görme) ya da harita görünümündeki kullanıcı puanı ve toplam fiyatı göremiyor ve ilana gitmek için fazladan adım atıyor.

**Önerilen aksiyon:** Liste öğesine puan ve toplam fiyatı ekleyin. Öğe içinde ayrı bir "İlanı gör" bağlantısı (tam arama parametreleriyle) bulunsun ve seçim düğmesi ayrı kalsın. Seçimde odak listede kalsın; popup odağı için focusAfterOpen={false} kullanın.

## F553 — Dokunma hedefleri: 29 adet <24px hedefin dökümü (16 onay kutusu, 4 "Bu sıralama neden?", 4 "Sıralama nasıl çalışır?", 1 atlama bağlantısı, 4 footer bağlantısı)

| Alan                | Değer                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                    |
| Durum               | Gözlemlendi                                                                                                               |
| Konum               | `src/components/search/AccessibilityFilter.tsx:196`                                                                       |
| Diğer konumlar      | `src/app/search/page.tsx:361`, `src/components/search/RankingWhy.tsx:231`, `src/components/property/PropertyCard.tsx:134` |
| Kullanıcılar        | misafir                                                                                                                   |
| Prensip             | accessibility · Hedef boyutu (motor erişilebilirlik)                                                                      |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                     |
| WCAG                | 2.5.8 Target Size (Minimum) AA: boşluk istisnası sağlanıyor; 2.5.5 (AAA) karşılanmıyor                                    |
| Renk/tema           | Hayır                                                                                                                     |
| Efor                | S                                                                                                                         |
| Kaynak denetçiler   | runtime:results                                                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                              |

**Kanıt:** RUNTIME taraması (002 desktop) targetsLt24Count=29 ve p2-links.mjs ölçümleri. (a) "İçeriğe geç" 1x1: sr-only olduğu için yanlış pozitif. (b) 16 input.h-4.w-4 16x16 (5 "Konaklama Türü" ve 11 "Erişilebilirlik (doğrulanmış)"); saran label satırı 248x20 (mobilde 326x20), satırlar arası 8px boşluk ve merkezler arası 28px olduğu için 2.5.8 boşluk istisnası sağlanıyor. (c) 4 adet summary "Bu sıralama neden?" 259x16 (mobilde 332x16): details py-2 dolgusu tıklanabilir alana dahil değil. (d) 4 adet "Sıralama nasıl çalışır?" 110x16: details kapalıyken checkVisibility()=false, yani yalnızca açıldığında gerçek bir hedef. (e) 4 footer bağlantısı (Gizlilik Bildirimi, Güven merkezi, Verilerim, Çerez Bildirimi; bilinen genel bulgu). Ek olarak mobilde kart başlık bağlantıları 143-190x21px ve "Karşılaştırmaya ekle" tam 125x24px.

**Etki:** Mobil ağırlıklı misafirler, özellikle de erişilebilirlik filtresini kullanacak motor engelli kullanıcılar, 20px'lik satırlarda yanlış seçeneğe dokunuyor.

**Önerilen aksiyon:** Filtre label'larına min-h-11 py-2 (44px satır) ve checkbox'a h-5 w-5 verin. RankingWhy'da dolguyu details'tan summary'ye taşıyın (summary block py-2). "Sıralama nasıl çalışır?" bağlantısına inline-block py-1 ekleyin. CompareToggle'a py-2 ekleyin.

## F600 — Arama filtreleri (fiyat, tür, sıralama, esneklik) URL'de tutulmuyor; geri dönüşte kayboluyor

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | Medium                           |
| Durum               | Aday (2 kaynak birleşti)         |
| Konum               | `src/app/search/page.tsx:159`    |
| Diğer konumlar      | `src/app/search/page.tsx:403`    |
| Kullanıcılar        | misafir                          |
| Prensip             | flexibility · task migratability |
| Sezgisel madde      | H7 — Esneklik/verim              |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | lens:forms, lens:nav             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**     |

**Kanıt:** src/app/search/page.tsx:159-164 `priceRange`, `selectedTypes`, `sortBy`, `flexDays` yerel state; `flexDays` URL'den okunuyor (:143) ama yazılmıyor. Aynı sayfada erişilebilirlik filtresi URL'ye yazılıyor (:137-142 `router.replace(…accessibility…)`) — tutarsız. Akıllı filtre çipleri de (:166) URL'de değil.

**Etki:** İlan detayına gidip geri dönen misafir tüm filtrelerini yeniden kurmak zorunda; mobil/masaüstü arasında aramayı paylaşamıyor.

**Önerilen aksiyon:** Tüm filtreleri setAccessibility kalıbıyla URLSearchParams'a yaz (`minPrice`, `maxPrice`, `types`, `sort`, `flexDays`) ve ilk değerleri URL'den oku.

## F958 — Arama filtreleri tutarsız biçimde saklanıyor: erişilebilirlik filtresi URL'de, fiyat/tür/sıralama yerel durumda; akıllı filtre kenar çubuğu sıralamasını sessizce geçersiz kılıyor

| Alan                | Değer                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                  |
| Durum               | Aday                                                                                                    |
| Konum               | `src/app/search/page.tsx:159`                                                                           |
| Diğer konumlar      | `src/app/search/page.tsx:133-142`, `src/app/search/page.tsx:179-193`, `src/app/search/page.tsx:383-393` |
| Kullanıcılar        | misafir                                                                                                 |
| Prensip             | learnability · predictability / consistency                                                             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                             |
| Renk/tema           | Hayır                                                                                                   |
| Efor                | M                                                                                                       |
| Kaynak denetçiler   | lens:consistency                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                            |

**Kanıt:** search/page.tsx:133-142 erişilebilirlik filtresi `router.replace(`/search?${next}`)` ile URL'ye yazılıyor. :159-169 `priceRange`, `selectedTypes`, `sortBy`, `flexDays` ve `view` yalnızca useState'te tutuluyor; flexDays URL'den okunuyor ama geri yazılmıyor. :179-182 `if (smartFilters) { params = smartToParams(smartFilters); }` dalında kenar çubuğundaki sortBy hiç kullanılmıyor, sıralama select'i (:383-393) yine etkileşimli kalıyor.

**Etki:** İlan sayfasından geri dönen misafir fiyat, tür ve sıralama seçimlerini kaybeder ama erişilebilirlik filtresi korunur. Bu yarım hafıza kullanıcıyı şaşırtır. Akıllı filtre etkinken sıralamayı değiştiren kullanıcı sonuçların değişmediğini görür ve geri bildirim almaz.

**Önerilen aksiyon:** Tüm kenar çubuğu filtrelerini (minPrice, maxPrice, types, sort, flexDays, view) erişilebilirlik filtresi gibi URL'ye yazın ve oradan okuyun. Akıllı filtre etkinken kenar çubuğu sıralamasını akıllı filtrenin sort çipine bağlayın ya da select'i `disabled` yapıp `aria-describedby` ile "Akıllı filtre etkin; sıralamayı çipten değiştirin" ipucu gösterin.

## F959 — Filtreler art arda değiştirildiğinde geç dönen eski yanıt yeni sonuçların üzerine yazabiliyor

| Alan                | Değer                          |
| ------------------- | ------------------------------ |
| Severity            | Medium                         |
| Durum               | Aday                           |
| Konum               | `src/app/search/page.tsx:202`  |
| Kullanıcılar        | misafir                        |
| Prensip             | robustness · responsiveness    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü |
| Renk/tema           | Hayır                          |
| Efor                | S                              |
| Kaynak denetçiler   | area:results                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**   |

**Kanıt:** page.tsx:227-230'daki effect yalnızca zamanlayıcıyı iptal ediyor: `return () => clearTimeout(timer);`. Devam eden fetch (202) iptal edilmiyor ve yanıtların sırası denetlenmiyor; 205-208 `setResults(data.results)` yanıtın hangi isteğe ait olduğuna bakmadan yazıyor. Sıralama 'Fiyat (önce en düşük)' → 'Puan' diye hızlı değiştirildiğinde ya da çipler art arda kaldırıldığında geç dönen eski yanıt son durumu eziyor.

**Etki:** Misafir seçtiği sıralama ya da filtreyle uyuşmayan bir liste görüyor (ör. select 'Puan' derken fiyata göre sıralı liste). Yavaş mobil ağda bu olasılık artıyor.

**Önerilen aksiyon:** load'a AbortController ekleyin: effect cleanup'ında `controller.abort()` çağırın ve apiFetch'e signal geçirin. Ya da artan bir istek kimliği tutup yalnızca son isteğin yanıtını uygulayın.

## F960 — Arama hatası ham sunucu/tarayıcı metniyle ve arayüz dilinden bağımsız gösteriliyor; 'Tekrar dene' yok

| Alan                | Değer                                                    |
| ------------------- | -------------------------------------------------------- |
| Severity            | Medium                                                   |
| Durum               | Aday                                                     |
| Konum               | `src/app/search/page.tsx:210`                            |
| Diğer konumlar      | `src/lib/api-client.ts:40`, `src/lib/http/errors.ts:154` |
| Kullanıcılar        | misafir                                                  |
| Prensip             | robustness · recoverability                              |
| Sezgisel madde      | H9 — Hata mesajları                                      |
| Renk/tema           | Hayır                                                    |
| Efor                | S                                                        |
| Kaynak denetçiler   | area:results                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                             |

**Kanıt:** page.tsx:209-211 `setError(err instanceof Error ? err.message : t('errors.load'))`: fetch her zaman Error fırlattığı için çevrilmiş t('errors.load') pratikte hiç kullanılmıyor. Gösterilen metinler şunlar: geçersiz URL'de (ör. checkOut <= checkIn ya da guests=40) sunucunun 'Doğrulama hatası' metni (src/lib/http/errors.ts:154); JSON olmayan yanıtta 'İstek başarısız (500)' (src/lib/api-client.ts:40); ağ kesintisinde tarayıcının İngilizce 'Failed to fetch' metni. Sonuç olarak EN arayüzde Türkçe, TR arayüzde İngilizce metin çıkıyor. 470-476'daki hata kutusunda yeniden deneme düğmesi ya da düzeltme bağlantısı yok.

**Etki:** Yavaş ya da kesintili mobil ağdaki misafir 'Failed to fetch' görüyor ve ne yapacağını bilmiyor. Bozuk bir paylaşım bağlantısıyla gelen kullanıcı hangi parametrenin hatalı olduğunu öğrenemiyor.

**Önerilen aksiyon:** ApiError.status ve code değerlerini çevrilmiş mesajlarla eşleyin: VALIDATION_ERROR → t('errors.invalidParams') ve details içindeki alanın adı; ağ hatası → t('errors.offline'). Hata kutusuna `<Button onClick={load}>{t('retry')}</Button>`, VALIDATION_ERROR için de 'Aramayı düzenle' bağlantısı ekleyin.

## F961 — Akıllı filtre: başarısız LLM çağrısı mevcut sonuçları gizliyor; etkin filtreler başlık ve sıralama kutusuyla çelişiyor

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                      |
| Durum               | Aday                                                                                        |
| Konum               | `src/app/search/page.tsx:243`                                                               |
| Diğer konumlar      | `src/app/search/page.tsx:503`, `src/app/search/page.tsx:284`, `src/app/search/page.tsx:383` |
| Kullanıcılar        | misafir                                                                                     |
| Prensip             | robustness · observability                                                                  |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                              |
| Renk/tema           | Hayır                                                                                       |
| Efor                | S                                                                                           |
| Kaynak denetçiler   | lens:status                                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                |

**Kanıt:** search/page.tsx:243 akıllı filtre hatası arama hatasıyla aynı `error` state'ine yazılıyor → 470-476 hata kutusu, 503 `{!error && !showMap && (` sonuç ızgarası gizleniyor. 179-181 smartFilters varken URL destination/sort yok sayılıyor ama 284-290 başlık hâlâ URL'deki destination/tarihleri gösteriyor; 383-393 'Sıralama' select'i smart modda etkisiz.

**Etki:** Misafir geçerli sonuç listesini, yalnız isteğe bağlı AI yorumlaması başarısız olduğu için kaybediyor; başlık 'İstanbul için konaklama' derken sonuçlar başka şehir olabiliyor; sıralama değişikliği sessizce yok sayılıyor.

**Önerilen aksiyon:** Ayrı `smartError` state'i; SmartFilter altında role=alert 'Metin yorumlanamadı, mevcut sonuçlar korunuyor' + 'Tekrar dene'. smartFilters aktifken başlığı çiplerden üret ('Antalya · 2 misafir') ve sidebar sıralama değişikliğini smartFilters.sort'a yaz ya da select'i disable edip 'Akıllı filtre sıralaması etkin' ipucu göster.

## F962 — Arama fiyat filtresi: birim/para birimi yok, sınır yok, boşaltılınca tüm sonuçlar gizleniyor

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Medium                                       |
| Durum               | Aday                                         |
| Konum               | `src/app/search/page.tsx:334`                |
| Kullanıcılar        | misafir                                      |
| Prensip             | learnability · familiarity, error prevention |
| Sezgisel madde      | H5 — Hata önleme                             |
| WCAG                | 3.3.2                                        |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | lens:forms                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** src/app/search/page.tsx:159 `useState<[number, number]>([0, 20000])`; :334-353 `type="number"` alanlarda min/max/step ve para birimi yok, etiketler `sr-only` (görsel olarak yalnız '0 - 20000'), placeholder değer dolu olduğu için hiç görünmüyor. :338,350 `Number(e.target.value)` — maks alanı silinince 0 olur ve :252 `price > priceRange[1]` tüm sonuçları eler; min>max kontrolü yok. Filtre farklı para birimli ilanları aynı sayıyla karşılaştırıyor (:251 `toMajorNumber(p.basePriceMinor, p.currency)`).

**Etki:** Misafir maks fiyatı yeniden yazmak için silince 'Sonuç bulunamadı' görür ve nedenini anlayamaz; '20000'in TL mi EUR mu olduğu belli değil.

**Önerilen aksiyon:** Görünür etiketler ('En düşük (TRY)', 'En yüksek (TRY)'), `min={0} step={100} inputMode="numeric"`; boş alanı 'sınırsız' (undefined) olarak yorumla; min>max ise Field `error`. Sonuç yoksa 'Fiyat filtresi tüm sonuçları gizliyor — sıfırla' eylemi göster.

## F963 — Fiyat alanları hatayı önlemiyor: 20000 tavanı ilanları sessizce gizliyor, alan silinince değer 0 olup tüm sonuçlar kayboluyor, en düşük > en yüksek denetlenmiyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/app/search/page.tsx:338`             |
| Kullanıcılar        | misafir                                   |
| Prensip             | robustness · recoverability (hata önleme) |
| Sezgisel madde      | H5 — Hata önleme                          |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:results                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** page.tsx:159 `useState<[number, number]>([0, 20000])`: gecelik tabanı 20000'i aşan ilanlar, kullanıcı hiçbir şey seçmeden gizleniyor; tek ipucu 'X sonuç gösteriliyor (Y bulundu)' farkı. 338/350 `onChange={(e) => setPriceRange([Number(e.target.value), ...])}`: üst alan temizlenince Number('') = 0 oluyor, tüm sonuçlar kayboluyor ve alanda '0' beliriyor. En düşük > en yüksek için doğrulama ya da aria-invalid yok. min özniteliği olmadığından negatif değer engellenmiyor; inputMode ve step de yok. Değer hep dolu olduğu için 'Min'/'Max' placeholder'ları (340, 352) hiç görünmüyor.

**Etki:** Misafir üst sınırı değiştirmek için alanı sildiğinde liste anında boşalıyor ve 'Sonuç bulunamadı' görüyor. Lüks villa arayan kullanıcı pahalı ilanların gizlendiğini bilmiyor.

**Önerilen aksiyon:** State'i `[number | null, number | null]` yapın; boş değer sınırsız anlamına gelsin. Başlangıç değerlerini boş bırakın ki placeholder görünsün. Inputlara `min='0' inputMode='numeric' step='1'` ekleyin. En düşük > en yüksek olduğunda iki alana da aria-invalid verin, aria-describedby ile bağlı 'En düşük fiyat en yüksek fiyattan büyük olamaz' metnini gösterin ve filtreyi uygulamayın. Değişiklikleri 300 ms gecikmeyle uygulayın.

## F964 — Tarih esnekliği seçeneği ne yapacağını önceden söylemiyor; öneri bulunamadığında da geri bildirim vermiyor

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Medium                        |
| Durum               | Aday                          |
| Konum               | `src/app/search/page.tsx:397` |
| Kullanıcılar        | misafir                       |
| Prensip             | learnability · predictability |
| Sezgisel madde      | H13 — Feedforward             |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | area:results                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** page.tsx:397-413'te etiket 'Tarih esnekliği', seçenekler 'Tam tarihler / ±1 gün...'. Sonuç listesinin değişmeyeceği, yalnızca karta 'daha ucuz tarih' notunun (534-540) ekleneceği açıklanmıyor. Hiçbir ilan için öneri yoksa ekranda hiçbir şey değişmiyor ve mesaj da çıkmıyor. 404'teki disabled select odak sırasından çıkıyor; ipucu (414-418) yalnızca tarih seçilmemişken görünüyor.

**Etki:** Misafir '±3 gün' seçince aramanın ±3 günlük aralıkta yapılacağını bekliyor; bir değişiklik görmeyince özelliğin çalışmadığını düşünüyor.

**Önerilen aksiyon:** Select'e her zaman görünen bir ipucu bağlayın: 'Aynı gece sayısıyla ±N gün içinde daha ucuz tarih varsa ilan kartında gösterilir'. Yükleme bitince öneri sayısını sayım satırındaki aria-live alanında duyurun ('3 ilanda daha ucuz tarih bulundu' ya da 'Daha ucuz tarih bulunamadı'). disabled yerine aria-disabled='true' kullanarak select'i odaklanabilir bırakın.

## F965 — Sonuçlar bölümünün başlığı yok; kart başlıkları (h3) 'Filtreler' h2'sinin altına düşüyor; akıllı filtre formu landmark değil

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                      |
| Durum               | Aday                                                                                        |
| Konum               | `src/app/search/page.tsx:423`                                                               |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:133`, `src/components/search/SmartFilter.tsx:108` |
| Kullanıcılar        | misafir                                                                                     |
| Prensip             | accessibility · WCAG 1.3.1 Bilgi ve ilişkiler / 2.4.6 Başlıklar ve etiketler                |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                       |
| WCAG                | 1.3.1                                                                                       |
| Renk/tema           | Hayır                                                                                       |
| Efor                | S                                                                                           |
| Kaynak denetçiler   | area:results                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                |

**Kanıt:** page.tsx:326 `<h2>{t('filters.title')}</h2>` sayfadaki tek h2. Sonuç sütununun (423 `<div className='lg:col-span-3'>`) başlığı yok ve bir bölge olarak işaretlenmemiş. PropertyCard.tsx:133'teki `<h3>` başlıkları belgenin ana hattında 'Filtreler'in altında görünüyor. Akıllı filtre formu (SmartFilter.tsx:108) role='search' taşımıyor ve başlığı yok. `<aside>` (324) etiketsiz; içeriği tamamlayıcı değil, birincil filtre kontrolleri.

**Etki:** Ekran okuyucu kullanıcısı başlık ya da landmark listesinden 'Sonuçlar'a atlayamıyor; ilanlar 'Filtreler'in alt öğeleriymiş gibi duyuruluyor.

**Önerilen aksiyon:** Sonuç sütununu `<section id='results' aria-labelledby='results-heading'>` yapın ve içine `<h2 id='results-heading'>{t('resultsTitle')}</h2>` ekleyin (görünür ya da sr-only). aside'ı `<section aria-labelledby='filters-heading'>` yapın. SmartFilter formuna `role='search' aria-label={t('smart.label')}` ekleyin.

## F966 — Yükleniyor durumu zayıf: ilk yüklemede sonuç alanı boş kalıyor, yeniden yüklemede eski kartlar işaretsiz ve tıklanabilir

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Medium                        |
| Durum               | Aday                          |
| Konum               | `src/app/search/page.tsx:426` |
| Kullanıcılar        | misafir                       |
| Prensip             | robustness · observability    |
| Sezgisel madde      | H15 — Performans              |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | area:results                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** Tek gösterge 426'daki `{loading ? t('loading') : t('resultCount', ...)}` küçük gri metni. İlk yüklemede results=[] ve 478'deki boş durum `!loading` koşuluyla gizli, dolayısıyla ızgara alanı tamamen boş. Yeniden yüklemede (sıralama, erişilebilirlik ya da akıllı filtre değişince) 503-553'teki eski kartlar soluklaştırılmadan kalıyor; sonuç kapsayıcısında aria-busy yok. Suspense fallback'i (619) Header'sız boş gri bir div.

**Etki:** Mobilde sayım satırı filtre panelinin altında, ekran dışında kaldığı için misafir yüklemenin sürdüğünü görmüyor. Yeniden yükleme sırasında eski bir karta tıklayıp yanlış sıralama ya da fiyat varsayımıyla ilerleyebiliyor.

**Önerilen aksiyon:** İlk yüklemede 6 iskelet kart gösterin. Yeniden yüklemede ızgaraya `aria-busy={loading}` ve `opacity-60 pointer-events-none` uygulayın. Suspense fallback'ine Header ile iskelet kartları koyun.

## F967 — Geliştiriciye yönelik teknik metinler misafire gösteriliyor (önbellek, vektör DB, VAPID, deterministik LLM, ham skorlar)

| Alan                | Değer                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                                                                                                                                                             |
| Durum               | Aday                                                                                                                                                                                                                                                                                                               |
| Konum               | `src/app/search/page.tsx:429`                                                                                                                                                                                                                                                                                      |
| Diğer konumlar      | `src/app/search/page.tsx:297`, `messages/tr/search.json:121-124`, `messages/tr/pwa.json:34`, `src/components/ui/ui.tsx:138`, `messages/tr/common.json:19-21`, `src/components/search/RankingWhy.tsx:27`, `src/components/search/RankingWhy.tsx:33-34`, `messages/tr/compare.json:3`, `messages/tr/booking.json:27` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                            |
| Prensip             | learnability · familiarity (gerçek dünya eşleşmesi)                                                                                                                                                                                                                                                                |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                              |
| Efor                | M                                                                                                                                                                                                                                                                                                                  |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                       |

**Kanıt:** search/page.tsx:429-433 yeşil 'Önbellekten' rozeti (search.json:37); 297 visual.reasons → search.json:121 'Görsel model çalışma zamanı kurulu değil.', 124 'Görsel arama için vektör veritabanı yok.'; pwa.json:34 '(VAPID anahtarları yok)'; ui.tsx:123-141 LlmBadge her AI çıktısında 'Demo (deterministik)', 'Canlı LLM', 'Yedek (LLM başarısız)' (common.json:19-21); RankingWhy.tsx:27 'Toplam skor: 0.734', 33-34 bilinmeyen faktör anahtarı ham ve 3 ondalıklı değerler; compare.json:3 'teklif motorundan'; booking.json:27 '(%90 güven)'.

**Etki:** Düşük-orta okuryazarlıklı misafir anlamadığı terimlerle karşılaşır, bilgi gürültüsü artar; 'LLM başarısız' gibi ifadeler güveni zedeler.

**Önerilen aksiyon:** 'Önbellekten' rozetini ve teknik görsel arama nedenlerini yalnız yöneticiye gösterin, misafire 'Benzer fotoğraf araması şu an kullanılamıyor' deyin; LlmBadge'de misafir için yalnız 'Yapay zekâ ile oluşturuldu' gösterip mod ayrıntısını title/yönetici paneline bırakın; RankingWhy'da sayıları yüzde katkı çubuklarına çevirin ('Puan: %40'); 'güven aralığı' yerine 'Bu tarihlerde benzer odalar genellikle ₺X–₺Y' yazın.

## F968 — Boş durum nedeni ayırt etmiyor ve tek tıkla kurtulma yolu sunmuyor; panelde 'Tüm filtreleri temizle' yok

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Medium                        |
| Durum               | Aday                          |
| Konum               | `src/app/search/page.tsx:478` |
| Kullanıcılar        | misafir                       |
| Prensip             | robustness · recoverability   |
| Sezgisel madde      | H9 — Hata mesajları           |
| Renk/tema           | Hayır                         |
| Efor                | M                             |
| Kaynak denetçiler   | area:results                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** page.tsx:478-483'te yalnızca 'Sonuç bulunamadı' ve 'Filtreleri değiştirmeyi deneyin.' (tr/search.json:44) metni var, düğme yok. Sunucunun 0 sonuç döndürmesi ile istemci filtrelerinin (fiyat/tür, 249-255) total>0 olan sonuçları tamamen gizlemesi aynı mesajı veriyor. Erişilebilirlik filtresi (AND kuralı, aynı oda) sonucu sıfırladığında hangi özelliğin elediği söylenmiyor. Yan panelde (325-420) toplu sıfırlama kontrolü yok.

**Etki:** Erişilebilirlik ihtiyacı olan misafir 4-5 özellik seçip sıfır sonuç aldığında hangi seçimi gevşeteceğini bilmiyor ve onay kutularını tek tek kaldırmak zorunda kalıyor.

**Önerilen aksiyon:** total>0 ve visibleResults.length===0 ise '{total} sonuç fiyat/tür filtrelerinizle gizlendi' mesajını ve 'Fiyat ve tür filtrelerini temizle' düğmesini gösterin. Erişilebilirlik özellikleri seçiliyse bunları kaldırılabilir çipler olarak listeleyin. Panel başlığının yanına fiyat, tür, sıralama, esneklik ve erişilebilirlik seçimlerini birlikte sıfırlayan 'Tümünü temizle' düğmesi ekleyin.

## F969 — Boş sonuç ve hata durumlarında kurtarma eylemi yok

| Alan                | Değer                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                                                             |
| Durum               | Aday                                                                                                                                                                                                               |
| Konum               | `src/app/search/page.tsx:478`                                                                                                                                                                                      |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:104-113`, `src/app/checkout/page.tsx:148-163`, `src/app/compare/page.tsx:83-89`, `src/app/account/page.tsx:191-205`, `messages/tr/compliance.json:24`, `messages/tr/search.json:44` |
| Kullanıcılar        | misafir                                                                                                                                                                                                            |
| Prensip             | robustness · recoverability                                                                                                                                                                                        |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                                                                                              |
| Efor                | M                                                                                                                                                                                                                  |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                       |

**Kanıt:** search/page.tsx:478-483 'Sonuç bulunamadı' + 'Filtreleri değiştirmeyi deneyin.' — 'Filtreleri temizle' düğmesi yok (fiyat/tür süzgeci istemcide sessizce kalır). booking/[id]/page.tsx:104-113 başlık 'Hata' + sunucu metni + yalnız 'Ana sayfaya dön' (yeniden dene yok); checkout/page.tsx:148-163 loadError'da 'Rezervasyon bilgileri eksik' başlığı yanlış teşhis; compare/page.tsx:83-89 yalnız hata metni; account/page.tsx:191-205 tek bir favori hatası tüm sayfayı başlıksız hata ekranıyla değiştirir; compliance.json:24 'Lütfen tüm zorunlu alanları doğru doldurun.' hangi alan olduğunu söylemez (NoticeForm).

**Etki:** Misafir çıkmaz sokakta kalır; favori eklerken oluşan geçici hata bütün hesap sayfasını kaybettirir.

**Önerilen aksiyon:** Boş sonuçta 'Filtreleri temizle' ve 'Tarihleri esnet (±2 gün)' düğmeleri ekleyin; hata kartlarına 'Tekrar dene' (reload) eylemi ve anlamlı başlık ('Rezervasyon yüklenemedi') koyun; account'ta favori/iptal hatalarını sayfayı değiştirmeden satır içi Status ile gösterin; NoticeForm'da details.fieldErrors'u ilgili Field'lara bağlayın.

## F970 — Arama boş sonuç durumunda filtreleri sıfırlama veya tarihleri esnetme eylemi yok

| Alan                | Değer                             |
| ------------------- | --------------------------------- |
| Severity            | Medium                            |
| Durum               | Aday                              |
| Konum               | `src/app/search/page.tsx:478`     |
| Kullanıcılar        | misafir                           |
| Prensip             | robustness · recoverability       |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü |
| Renk/tema           | Hayır                             |
| Efor                | S                                 |
| Kaynak denetçiler   | lens:nav                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**      |

**Kanıt:** 478-483 yalnız metin: "Sonuç bulunamadı" / "Filtreleri değiştirmeyi deneyin." priceRange ve selectedTypes için sıfırlama yok. smartFilters'ın onClear'ı (316-319) burada sunulmuyor. Sonuçları hangi filtrenin gizlediği gösterilmiyor; resultCount yalnız "{shown} sonuç ({total} bulundu)".

**Etki:** Fiyat aralığını daraltıp sıfır sonuç alan misafir hangi filtrenin sebep olduğunu bilmiyor ve tek tek geri almak zorunda kalıyor.

**Önerilen aksiyon:** Boş durumda "Tüm filtreleri temizle" (priceRange [0, 20000], selectedTypes [], accessibility parametresi, smartFilters null) ve tarih varsa "Tarihleri ±3 gün esnet" (flexDays=3) düğmeleri ekleyin. `total > shown` ise "Filtreler {n} sonucu gizledi" metnini gösterin.

## F971 — Akıllı filtre hatası tüm sonuç listesini gizliyor ve mesaj giriş alanından uzakta gösteriliyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/app/search/page.tsx:503`               |
| Diğer konumlar      | `src/components/search/SmartFilter.tsx:113` |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · recoverability                 |
| Sezgisel madde      | H9 — Hata mesajları                         |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:results                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** runSmart ile load aynı error state'ini kullanıyor (243 `setError(... t('errors.smart'))`). Izgara 503'teki `{!error && !showMap && (...)}` koşuluna bağlı; bu yüzden ekranda geçerli sonuçlar varken bile akıllı filtre başarısız olursa liste kayboluyor. Mesaj sonuç sütununda (470-476) çıkıyor; SmartFilter girişi (SmartFilter.tsx:113-121) aria-invalid ya da aria-describedby almıyor ve odak taşınmıyor.

**Etki:** LLM ya da ağ hatasında misafir az önce gördüğü sonuçları kaybediyor. Mobilde hata mesajı filtre panelinin altında, ekran dışında kalıyor; kullanıcı listenin neden boşaldığını anlamıyor.

**Önerilen aksiyon:** Akıllı filtre için ayrı bir smartError state'i tutun. SmartFilter'a error prop'u geçirin ve mesajı girişin altında `<p id='smart-filter-error' role='alert'>` olarak gösterin. Girişe `aria-invalid` ve `aria-describedby='smart-filter-error'` ekleyin. Sonuç ızgarasını yalnızca load hatasında gizleyin.

## F972 — Kart altındaki kontroller ilan adını taşımıyor ve sonuçlar liste semantiğinde değil

| Alan                | Değer                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                   |
| Durum               | Aday                                                                                                                                     |
| Konum               | `src/app/search/page.tsx:504`                                                                                                            |
| Diğer konumlar      | `src/components/search/RankingWhy.tsx:23`, `src/components/compare/CompareToggle.tsx:25`, `src/components/property/PropertyCard.tsx:190` |
| Kullanıcılar        | misafir                                                                                                                                  |
| Prensip             | accessibility · WCAG 2.4.4 Bağlamda bağlantı amacı                                                                                       |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                    |
| WCAG                | 2.4.4                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                    |
| Efor                | M                                                                                                                                        |
| Kaynak denetçiler   | area:results                                                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                             |

**Kanıt:** page.tsx:504-506 `<div className='grid ...'>{visibleResults.map((property) => (<div key={property.id}>`: ul/li ya da article yok. Her öğede aynı adla tekrarlanan kontroller var: RankingWhy.tsx:23-25'teki summary 'Bu sıralama neden?', CompareToggle.tsx:25 'Karşılaştırmaya ekle', page.tsx:548 'Benzerlerini göster', page.tsx:657 'Bu tarihleri gör', PropertyCard.tsx:190-195 'Fırsatı Gör'. Bu kontrollerin çoğu PropertyCard'ın dışında, kardeş öğe olarak duruyor; h3 başlığıyla programatik ilişkileri zayıf.

**Etki:** Ekran okuyucunun bağlantı ve düğme listesinde 24 adet 'Karşılaştırmaya ekle' ve 'Fırsatı Gör' çıkıyor; misafir hangisinin hangi ilana ait olduğunu anlamak için geri dolaşmak zorunda. Sonuç sayısı ve konum ('24 öğeden 3.') duyurulmuyor.

**Önerilen aksiyon:** Izgarayı `<ul role='list'>` yapın; her sonucu `<li><article aria-labelledby={'title-' + id}>` içine alın ve PropertyCard'daki h3'e bu id'yi verin. Tekrarlanan kontrollere görünmez bağlam ekleyin: `<span className='sr-only'>: {title}</span>` (ör. 'Karşılaştırmaya ekle: Grand Deluxe Hotel'). summary'ye `aria-describedby={'title-' + id}` verin.

## F973 — Fotoğrafı olmayan ilanda stok bir otel fotoğrafı, alt metni ilan adı olacak şekilde ilanın kendi fotoğrafıymış gibi gösteriliyor

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Medium                                              |
| Durum               | Aday                                                |
| Konum               | `src/app/search/page.tsx:512`                       |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:97`       |
| Kullanıcılar        | misafir                                             |
| Prensip             | learnability · familiarity (gerçek dünya eşleşmesi) |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                         |
| WCAG                | 1.1.1                                               |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | area:results                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** page.tsx:511-514 `imageUrl={property.images?.[0] ?? 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop'}`; PropertyCard.tsx:95-98 `<Image src={imageUrl} alt={title} .../>`. Böylece aynı stok fotoğraf ilan adıyla etiketleniyor. Ayrıca gerçek fotoğraflarda da alt=title, hemen altındaki h3 bağlantısının (133-136) metnini tekrarlıyor.

**Etki:** Misafir gerçek olmayan bir görsele bakarak ilan seçebiliyor ve bu güveni zedeliyor. Ekran okuyucu ilan adını iki kez okuyor.

**Önerilen aksiyon:** Fotoğraf yoksa nötr bir yer tutucu (ikon ve görünür 'Fotoğraf yok' metni) gösterin ve alt={t('card.noPhoto')} kullanın. Gerçek fotoğrafta alt metni ya '' yapın (başlık zaten bağlantıda) ya da fotoğrafın içeriğini tarif eden bir metin kullanın.

## F974 — Harita yan listesinde ilana bağlantı yok; ilana gitmenin tek yolu harita içindeki açılır pencere

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Medium                                     |
| Durum               | Aday                                       |
| Konum               | `src/app/search/page.tsx:595`              |
| Diğer konumlar      | `src/components/search/ResultsMap.tsx:238` |
| Kullanıcılar        | misafir                                    |
| Prensip             | flexibility · substitutivity               |
| Sezgisel madde      | H7 — Esneklik/verim                        |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | area:results                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**               |

**Kanıt:** page.tsx:595-609'da her liste öğesi yalnızca bir seçim düğmesi: `<button aria-pressed={active} onClick={() => onSelect(active ? null : p.id)}>`. İlana gitmek için ResultsMap.tsx:229-248'deki Popup içinde bulunan Link'e ulaşmak gerekiyor; bu bağlantı harita tuvalinin içinde ve odak sırasında işaretçilerden sonra geliyor.

**Etki:** Klavye ya da ekran okuyucu kullanıcısı harita görünümünde listeden ilana doğrudan geçemiyor; mobilde küçük açılır pencereye dokunmak gerekiyor.

**Önerilen aksiyon:** Her li'ye, seçim düğmesinin yanına `<Link href={stayHref}>İlanı gör<span className='sr-only'>: {p.title}</span></Link>` ekleyin. Seçim düğmesinin erişilebilir adını 'Haritada göster: {title}' yapın.

## F975 — Harita görünümünün liste alternatifi ilana gitmeyi sağlamıyor; seçili öğe yalnız renkle belli

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Medium                                     |
| Durum               | Aday                                       |
| Konum               | `src/app/search/page.tsx:595`              |
| Diğer konumlar      | `src/components/search/ResultsMap.tsx:238` |
| Kullanıcılar        | misafir                                    |
| Prensip             | accessibility · Keyboard / Use of Color    |
| Sezgisel madde      | H14 — Erişilebilirlik                      |
| WCAG                | 1.4.1                                      |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | lens:a11y                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**               |

**Kanıt:** MapResultList 595-609 her öğe yalnız seçim yapan `<button aria-pressed={active} onClick={() => onSelect(active ? null : p.id)}>`; ilana bağlantı yalnız harita Popup'ında (ResultsMap.tsx:229-248) ve liste DOM'da haritadan SONRA. Harita görünümünde (485-501) PropertyCard ızgarası gizli. Aktif öğe 599-602 `border-[#003580] bg-amber-100` ile, yalnız renkle ayrışıyor.

**Etki:** Klavye/ekran okuyucu misafir harita görünümünde listeden ilana gidemiyor; Shift+Tab ile harita içindeki açılır pencereye geri dönmek zorunda; renk körü kullanıcı seçili öğeyi ayırt edemiyor.

**Önerilen aksiyon:** Her liste öğesine `<Link href={`/property/${p.id}`}>` ekleyin (seçim düğmesi ayrı kalsın); seçili öğeye ✓ ikonu veya 'Seçili' metni ekleyin.

## F976 — Algılanan performans: iskelet yok, loading.tsx yok, Header'sız yedekler düzeni kaydırıyor

| Alan                | Değer                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                              |
| Durum               | Aday                                                                                                |
| Konum               | `src/app/search/page.tsx:619`                                                                       |
| Diğer konumlar      | `src/app/search/page.tsx:426`, `src/app/account/page.tsx:186`, `src/app/property/[id]/page.tsx:116` |
| Kullanıcılar        | tümü                                                                                                |
| Prensip             | robustness · responsiveness                                                                         |
| Sezgisel madde      | H15 — Performans                                                                                    |
| Renk/tema           | Hayır                                                                                               |
| Efor                | M                                                                                                   |
| Kaynak denetçiler   | lens:mobile                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                        |

**Kanıt:** `find src/app -name loading.tsx` hiçbir sonuç döndürmüyor. property/[id]/page.tsx:116 dinamik Prisma sorgusu yapıyor; karta dokununca sunucu yanıtına kadar hiçbir geri bildirim yok. search/page.tsx:619 `<Suspense fallback={<div className="min-h-screen bg-gray-50" />}>` Header'sız boş bir zemin gösteriyor, ardından Header ve :426 'Yükleniyor...' metni, en son kartlar geliyor: üç aşamalı sıçrama. account/page.tsx:183-188 yüklenirken Header'sız tam ekran spinner gösteriyor (metin ya da `role=status` yok), sonra Header ekleniyor. messages/tr altında 30 'Yükleniyor' metni var; kod tabanında hiç iskelet (`animate-pulse`) kullanılmıyor. 'Yükleniyor...' ve 'Yükleniyor…' yazımları da karışık.

**Etki:** Mobil ağda misafir karta dokunduğunda ekran donmuş gibi görünüyor ve tekrar dokunuyor. Arama sayfası açılırken başlık ve içerik zıplıyor (CLS). Ekran okuyucu kullanıcısı hesap sayfası yüklenirken hiçbir şey duymuyor.

**Önerilen aksiyon:** `src/app/property/[id]/loading.tsx` ekle: galeri için `aspect-[16/9]` gri kutu, başlık çubukları ve sağda widget iskeleti. `src/app/search/loading.tsx` ekle. Arama sayfasındaki Suspense yedeğini ve `loading` dalını 6 kart iskeletiyle değiştir (h-48 görsel ve 3 metin çubuğu, `animate-pulse`; reduced-motion zaten globals.css:6-15'te ele alınıyor) ve Header'ı Suspense dışına al. Hesap sayfasında spinner yerine Header'lı iskelet ve `<p role="status" className="sr-only">Yükleniyor…</p>` kullan. Yazımı tek biçime indir.

## F977 — Erişilebilirlik onay kutuları URL güncellemesi tamamlanana kadar tepki vermiyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Medium                                             |
| Durum               | Aday                                               |
| Konum               | `src/components/search/AccessibilityFilter.tsx:35` |
| Diğer konumlar      | `src/app/search/page.tsx:141`                      |
| Kullanıcılar        | misafir                                            |
| Prensip             | robustness · responsiveness                        |
| Sezgisel madde      | H12 — Feedback                                     |
| Renk/tema           | Hayır                                              |
| Efor                | S                                                  |
| Kaynak denetçiler   | area:results                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** AccessibilityFilter.tsx:35-36 `checked={selected.includes(code)} onChange={() => toggle(code)}`: selected tamamen URL'den türetiliyor (page.tsx:134-136 ve 375 `parseAccessibilityParam(accessibilityParam).codes`). Değişiklik page.tsx:141'de `router.replace(...)` ile yapılıyor; bu bir navigasyon geçişi. Kök layout headers() çağırdığı için sayfa dinamik; yeni URL işlenene kadar onay kutusu eski durumunda görünüyor. Yerel ya da iyimser durum yok.

**Etki:** Yavaş mobil ağda misafir kutuyu işaretliyor ama görünüm değişmiyor; tekrar tıklıyor ve seçimi geri almış oluyor. Ekran okuyucu bu sırada 'işaretli değil' okumaya devam ediyor.

**Önerilen aksiyon:** Seçimi useOptimistic ya da yerel state ile anında yansıtın. URL'yi `window.history.replaceState(null, '', '?' + next)` ile güncelleyin; Next 16'da bu yöntem useSearchParams ile senkron çalışır ve sunucuya istek atmaz.

## F978 — 'Bu sıralama neden?' ham ondalık skorlar gösteriyor; yerel biçim, ölçek ve deneysel sıralama bilgisi yok

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/search/RankingWhy.tsx:27` |
| Diğer konumlar      | `src/lib/search/ltr.ts:137`               |
| Kullanıcılar        | misafir                                   |
| Prensip             | learnability · synthesizability           |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi               |
| Renk/tema           | Hayır                                     |
| Efor                | M                                         |
| Kaynak denetçiler   | area:results                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** RankingWhy.tsx:27 `t('totalScore', { score: score.toFixed(3) })` 'Toplam skor: 0.734' üretiyor; TR'de ondalık ayırıcı virgül olmalı, useFormat kullanılmıyor. 34 `{v.toFixed(3)}`: bileşen katkıları birimsiz ve en fazla kaç olabilecekleri belirtilmiyor. 33 bilinmeyen anahtarları ham haliyle gösteriyor (`: k`). LTR deneyinde (src/lib/search/ltr.ts:137-141) score model çıktısı, explain ise ağırlıklı bileşenler; gösterilen toplam bileşenlerin toplamına eşit olmuyor. Oysa ranking.json intro'su skorun 'ağırlıklı toplam' olduğunu söylüyor.

**Etki:** Misafir '0.350' gibi bir sayıdan neyin iyi neyin kötü olduğunu çıkaramıyor ve şeffaflık amacı gerçekleşmiyor. Deney grubundaki kullanıcı toplamın tutmadığını görüyor.

**Önerilen aksiyon:** Her bileşeni ağırlığına oranla gösterin (ör. 'Misafir puanı: 35 puandan 35', yanında küçük bir çubuk) ve sayıları f.number ile biçimlendirin. Toplamı '100 üzerinden 73' biçiminde verin. ranking=ltr ise 'Bu sonuç deneysel bir sıralama modeliyle sıralandı; aşağıdaki katkılar yaklaşıktır' notunu ekleyin. Bilinmeyen anahtarları göstermeyin.

## F979 — Çip etiketleri ham değer gösteriyor: ISO tarih, para birimsiz tutar, öneksiz ve çevrilmemiş olanak adı

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | Medium                                                     |
| Durum               | Aday                                                       |
| Konum               | `src/components/search/SmartFilter.tsx:59`                 |
| Diğer konumlar      | `messages/tr/search.json:92`, `messages/tr/search.json:94` |
| Kullanıcılar        | misafir                                                    |
| Prensip             | learnability · familiarity                                 |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                |
| Renk/tema           | Hayır                                                      |
| Efor                | S                                                          |
| Kaynak denetçiler   | area:results                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                               |

**Kanıt:** SmartFilter.tsx:59-62 `t('smart.chips.checkIn', { value: f.checkIn })` 'Giriş: 2026-10-29' üretiyor; f.date kullanılmıyor, oysa başlık (page.tsx:289) f.date kullanıyor. 52-54 `t('smart.chips.maxPrice', { value: f.maxPrice })` 'En çok 5000' üretiyor, para birimi yok (docs/img/search-smart-filter.png'de görülüyor). 68 `chips.push({ key: 'amenities', value: a, label: a })`: 'Olanak:' öneki yok ve değer DB'deki Türkçe metin ('Ücretsiz WiFi', 'Deniz Manzarası'); EN arayüzde de Türkçe görünüyor.

**Etki:** Misafir 5000'in TL mi olduğunu, gecelik mi toplam mı olduğunu bilemiyor. ISO tarih biçimi okuryazarlığı düşük kullanıcıyı şaşırtıyor. EN kullanıcı Türkçe olanak adları görüyor.

**Önerilen aksiyon:** filtersToChips'e useFormat çıktısını geçirin: tarih için `f.date(value)`, tutar için para birimi ve 'gecelik/toplam' ibaresiyle biçimlenmiş metin kullanın. Olanak çipi için `t('smart.chips.amenity', { value })` ('Olanak: {value}') anahtarını kullanın ve olanak sözlüğünü çevirin.

## F980 — Akıllı filtre durum mesajları yanıltıcı ya da eksik: çipler kullanıcı tarafından kaldırılınca 'Metinden filtre çıkarılamadı' çıkıyor, yorumlama süreci duyurulmuyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/search/SmartFilter.tsx:131` |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · observability                  |
| Sezgisel madde      | H12 — Feedback                              |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:results                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** SmartFilter.tsx:131-133 `chips.length === 0 && <span>{t('smart.noFilters')}</span>`: kullanıcı çipleri kendisi kaldırdığında da 'Metinden filtre çıkarılamadı.' (tr/search.json:84) görünüyor; bu durumda page.tsx:179-181 boş filtreyle tüm konaklamaları getiriyor. Yorumlama sırasında yalnızca düğme metni değişiyor (124 `busy ? t('smart.interpreting')`). Odak girişte kaldığından ekran okuyucu bunu duyurmuyor ve aria-live bölgesi (127) busy sırasında boş.

**Etki:** Misafir çipleri kaldırdıktan sonra sistemin metni anlamadığını sanıyor. Ekran okuyucu kullanıcısı Enter'a bastıktan sonra birkaç saniye hiçbir geri bildirim almıyor.

**Önerilen aksiyon:** Çipleri kullanıcı sıfırladıysa noFilters yerine 'Tüm akıllı filtreler kaldırıldı · aramanız: {destination}' gösterin; ya da son çip kaldırılınca onClear çağırın. busy iken aria-live bölgesine t('smart.interpreting') yazın ve forma aria-busy ekleyin.

## F1138 — Sıralama sayfası çıkmaz ve ortak sayfa iskeletinden farklı

| Alan                | Değer                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Severity            | Low                                                                |
| Durum               | Gözlemlendi                                                        |
| Konum               | `src/app/ranking/page.tsx:16`                                      |
| Diğer konumlar      | `src/components/search/RankingWhy.tsx`, `src/components/ui/ui.tsx` |
| Kullanıcılar        | misafir                                                            |
| Prensip             | learnability · Consistency                                         |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                        |
| Renk/tema           | Hayır                                                              |
| Efor                | S                                                                  |
| Kaynak denetçiler   | runtime:compliance                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                       |

**Kanıt:** p6: main içindeki bağlantılar = []. Giriş metni 'Sonuç kartındaki "Bu sıralama neden?" bağlantısı'ndan söz ediyor ama bu öğe RankingWhy.tsx'te bir <details> açılır bölümü ve sayfadan arama sonuçlarına dönüş yolu yok. Sayfa PageShell kullanmıyor: arka plan bg-white (diğerlerinde gray-50), genişlik max-w-3xl (H1 x=272; trust ve report'ta max-w-5xl, H1 x=144), H1 text-3xl (diğerlerinde 2xl). 026 ile 024 ekran görüntüleri karşılaştırılabilir. Koyu temada da arka plan diğer sayfalardan farklı (p7-ranking-dark.png).

**Etki:** Sonuç kartından gelen misafir aramasına dönmek için tarayıcının geri tuşuna muhtaç kalıyor. Görsel tutarsızlık sayfanın aynı ürüne ait olmadığı izlenimini veriyor.

**Önerilen aksiyon:** PageShell kullanın. 'Arama sonuçlarına dön' bağlantısı (history.back ya da /search) ve 'Güven merkezi' bağlantısı ekleyin. Metni 'Bu sıralama neden? açılır bölümü' olarak düzeltin.

## F1139 — Sıralama tablosunda hücrelerin yatay boşluğu yok; mobilde 'Ağırlık' ve 'Açıklama' başlıkları bitişik

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Gözlemlendi                                 |
| Konum               | `src/app/ranking/page.tsx:24`               |
| Kullanıcılar        | misafir                                     |
| Prensip             | learnability · Okunabilirlik / sade tasarım |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | runtime:compliance                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** p6: th ve td için padding-left/right 1px. Masaüstünde 'Ağırlık' sütunu x=432-480 (48px), 'Açıklama' 480'de başlıyor. Mobil 390'da 'Ağırlık' metni 168'de bitiyor, 'Açıklama' 170'te başlıyor (2px aralık); görselde 'AğırlıkAçıklama' gibi okunuyor (RT/crops/compliance/p6-ranking-table-mobile.png).

**Etki:** Şeffaflık tablosu dar ekranda tek kelime gibi okunuyor ve sütunlar ayırt edilemiyor.

**Önerilen aksiyon:** th ve td'ye px-3 verin (ilk sütunda pl-0). Ağırlık sütununu sağa hizalayıp tabular-nums kullanın. Mobilde tabloyu tanım listesi ya da kart düzenine çevirin.

## F1140 — Misafir puanı filtresi yok, yalnızca puana göre sıralama var

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Gözlemlendi                                  |
| Konum               | `src/app/search/page.tsx:379`                |
| Kullanıcılar        | misafir                                      |
| Prensip             | flexibility · Özelleştirilebilirlik ve verim |
| Sezgisel madde      | H7 — Esneklik/verim                          |
| Renk/tema           | Hayır                                        |
| Efor                | M                                            |
| Kaynak denetçiler   | runtime:results                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** RUNTIME 002 ve 118 gövde metni: filtre panelinde yalnızca Fiyat Aralığı, Konaklama Türü, Erişilebilirlik, Sıralama ve Tarih esnekliği var. Puan için tek seçenek "Puan (önce en yüksek)" sıralaması.

**Etki:** "8+ puanlı yerler" gibi yaygın bir OTA görevi ancak listeyi tek tek tarayarak yapılabiliyor.

**Önerilen aksiyon:** "Misafir puanı" adında bir radyo grubu ekleyin (9+, 8+, 7+, Tümü); değer minRating sunucu parametresiyle gitsin ve URL'de tutulsun.

## F1141 — Boş akıllı filtre gönderimi hiçbir geri bildirim vermiyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Gözlemlendi                                 |
| Konum               | `src/components/search/SmartFilter.tsx:101` |
| Kullanıcılar        | misafir                                     |
| Prensip             | learnability · Geri bildirim                |
| Sezgisel madde      | H12 — Feedback                              |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | runtime:results                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** RUNTIME p6-smart.mjs: boş #smart-filter alanında Enter'a basınca hiç POST isteği gitmiyor, validationMessage boş kalıyor ve canlı bölgede değişiklik olmuyor. 2 karakterde yalnızca tarayıcının yerel balonu çıkıyor. KOD: submit() içindeki text.trim().length >= 3 koşulu sağlanmazsa fonksiyon sessizce çıkıyor.

**Etki:** Kullanıcı düğmenin çalışmadığını sanıyor.

**Önerilen aksiyon:** required ve minLength ekleyin, ayrıca aria-describedby ile kalıcı bir "En az 3 karakter yazın" ipucu gösterin. Koşul sağlanmazsa role="status" içinde mesaj verin.

## F1358 — Bilgi ve politika sayfaları üç farklı kabukla kurulmuş (gizlilik, sıralama, güven merkezi)

| Alan                | Değer                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                             |
| Durum               | Aday                                                                                            |
| Konum               | `src/app/ranking/page.tsx:16`                                                                   |
| Diğer konumlar      | `src/app/privacy/page.tsx:22-29`, `src/app/trust/page.tsx:64`, `src/app/ranking/page.tsx:23-27` |
| Kullanıcılar        | misafir                                                                                         |
| Prensip             | learnability · consistency                                                                      |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                     |
| WCAG                | 1.3.1                                                                                           |
| Renk/tema           | Hayır                                                                                           |
| Efor                | S                                                                                               |
| Kaynak denetçiler   | lens:consistency                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                    |

**Kanıt:** ranking/page.tsx:16-19 Header ve ham `<main className="mx-auto max-w-3xl px-4 py-10">` kullanıyor, beyaz zemin, h1 `text-3xl`, tablo başlıklarında `scope` yok (:23-27). privacy/page.tsx:22-29 Header, gri zemin ve `<article>` kart, h1 `text-2xl`, yerel `link` sabiti (:14-15). trust/page.tsx:64 PageShell ve Card, h1 `text-2xl`. Üçü aynı türde (kamuya açık politika) içerik.

**Etki:** Kullanıcı politika sayfaları arasında geçerken farklı genişlik, zemin ve başlık ölçeği görür. Sıralama tablosu ekran okuyucuda başlık-hücre ilişkisini zayıf aktarır.

**Önerilen aksiyon:** ranking ve privacy sayfalarını PageShell'e taşıyın, bölümleri Card'a çevirin. Sıralama tablosunda `th scope="col"` ve satır başlığında `scope="row"` kullanın. Yerel `link` sabitini ortak linkClass ile değiştirin.

## F1359 — Sıralama sayfasındaki tabloda caption ve sütun kapsamı yok; aramaya dönüş bağlantısı da yok

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | Low                                                            |
| Durum               | Aday                                                           |
| Konum               | `src/app/ranking/page.tsx:21`                                  |
| Kullanıcılar        | misafir                                                        |
| Prensip             | accessibility · WCAG 1.3.1 (öneri düzeyi) / kullanıcı kontrolü |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                              |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | area:results                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                   |

**Kanıt:** ranking/page.tsx:21-27 `<table ...><thead><tr><th className='py-2'>...`: `<caption>` ve scope='col' yok; bileşen adı hücresi td (32). Sayfa RankingWhy.tsx:39'daki bağlantıyla aynı sekmede açılıyor. Sayfada aramaya dönüş bağlantısı yok (yalnızca Header ve Footer var). Filtreler URL'de tutulmadığı için tarayıcının geri tuşu da seçimleri geri getirmiyor.

**Etki:** Ekran okuyucu kullanıcısı tablonun neyi listelediğini önceden duyamıyor. Açıklamayı okuyan misafir sonuçlara dönmek için tarayıcının geri tuşuna mecbur kalıyor ve filtre seçimlerini kaybediyor.

**Önerilen aksiyon:** `<caption className='sr-only'>{t('table.caption')}</caption>` ekleyin; th'lere scope='col' verin; bileşen hücresini `<th scope='row'>` yapın. h1'in üstüne router.back() çağıran bir 'Arama sonuçlarına dön' düğmesi koyun.

## F1360 — Bazı tablolarda th scope ve caption eksik

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Low                                                                           |
| Durum               | Aday                                                                          |
| Konum               | `src/app/ranking/page.tsx:24`                                                 |
| Diğer konumlar      | `src/components/admin/AdminDashboard.tsx:457`, `src/app/compare/page.tsx:107` |
| Kullanıcılar        | tümü, admin                                                                   |
| Prensip             | accessibility · Info and Relationships                                        |
| Sezgisel madde      | H14 — Erişilebilirlik                                                         |
| WCAG                | 1.3.1                                                                         |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | lens:a11y                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                  |

**Kanıt:** ranking/page.tsx:21-28 `<table>` caption yok, `<th className="py-2">` scope yok; AdminDashboard.tsx:454-463 deney tablosu caption/scope yok (birden çok tablo arka arkaya, yalnız üstteki `<p>` ile ayrılıyor); compare/page.tsx:107 karşılaştırma tablosunun caption'ı yok.

**Etki:** Ekran okuyucu tablolar arasında gezinirken hangi deneye/konuya ait olduğunu duymuyor.

**Önerilen aksiyon:** `<caption className="sr-only">` (deneyde flagKey) ve `<th scope="col">` ekleyin.

## F1361 — Akıllı filtre sonuçları iki kez hesaplanıyor: POST yanıtındaki sonuçlar atılıyor ve ikinci bir GET bekleniyor

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Low                                    |
| Durum               | Aday                                   |
| Konum               | `src/app/search/page.tsx:240`          |
| Diğer konumlar      | `src/app/api/search/smart/route.ts:21` |
| Kullanıcılar        | misafir                                |
| Prensip             | robustness · responsiveness            |
| Sezgisel madde      | H15 — Performans                       |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | area:results                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** src/app/api/search/smart/route.ts:21-44 yanıtına `...results` koyuyor. page.tsx:240-241 yalnızca setLlmMode ve setSmartFilters çağırıyor, sonuçları kullanmıyor. smartFilters değişimi load()'u tetikliyor (174, 227-230) ve ikinci bir /api/search isteği atılıyor.

**Etki:** LLM gecikmesinin üstüne bir arama turu daha ekleniyor; mobil ağda akıllı filtrenin sonucu daha geç görünüyor.

**Önerilen aksiyon:** runSmart'ta `setResults(data.results); setTotal(data.total)` uygulayın ve bu filtre nesnesi için bir sonraki load'u atlayın (ör. skipNextLoadRef ile). Ya da POST yanıtından sonuçları kaldırıp yalnızca filtreyi döndürün.

## F1362 — Görsel benzerlik aramasında referans fotoğraf gösterilmiyor

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Low                           |
| Durum               | Aday                          |
| Konum               | `src/app/search/page.tsx:292` |
| Kullanıcılar        | misafir                       |
| Prensip             | robustness · observability    |
| Sezgisel madde      | H6 — Tanıma > hatırlama       |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | area:results                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** page.tsx:292-306'da yalnızca 'Bu fotoğrafa benzeyen ilanlar' metni (visual.similarHeading) var; similarToPhotoId'nin hangi ilanın hangi fotoğrafı olduğu (küçük resim ya da ilan adı) gösterilmiyor. 543-549'daki 'Benzerlerini göster' bağlantısı da hangi fotoğrafı (kapak fotoğrafı) kullanacağını belirtmiyor.

**Etki:** Misafir sonuçların hangi görsele benzetildiğini hatırlamak zorunda; paylaşılan bağlantıyla gelen kullanıcı referansı hiç bilmiyor.

**Önerilen aksiyon:** Başlığın yanında referans fotoğrafın küçük resmini (alt='Referans: {ilan adı} kapak fotoğrafı') ve ilan adını gösterin. Bağlantı metnini 'Bu kapak fotoğrafına benzeyenleri göster' yapın.

## F1363 — 'Önbellekten' rozeti ve görsel arama hata gerekçeleri misafire geliştirici jargonu gösteriyor

| Alan                | Değer                         |
| ------------------- | ----------------------------- |
| Severity            | Low                           |
| Durum               | Aday                          |
| Konum               | `src/app/search/page.tsx:429` |
| Diğer konumlar      | `messages/tr/search.json:120` |
| Kullanıcılar        | misafir                       |
| Prensip             | learnability · familiarity    |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi   |
| Renk/tema           | Hayır                         |
| Efor                | S                             |
| Kaynak denetçiler   | area:results                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**  |

**Kanıt:** page.tsx:429-433 `{cached && <span>{t('cached')}</span>}` 'Önbellekten' rozetini gösteriyor (tr/search.json:37); misafir için eylem gerektirmeyen teknik bir bilgi. 297 `t('visual.reasons.' + (visual.reason ?? 'LOAD_FAILED'))` 'Görsel model çalışma zamanı kurulu değil.' ve 'Görsel arama için vektör veritabanı yok.' gibi metinler üretiyor (tr/search.json:120-124).

**Etki:** Misafir anlamadığı teknik ifadelerle karşılaşıyor ve bir şeylerin bozuk olduğunu düşünebiliyor.

**Önerilen aksiyon:** Önbellek rozetini kaldırın ya da yalnızca geliştirici modunda gösterin. Görsel arama gerekçelerini tek bir kullanıcı metninde birleştirin: 'Benzer fotoğraf araması şu anda kullanılamıyor; normal sonuçlar gösteriliyor.' Neden kodunu yalnızca loglara yazın.

## F1364 — Harita yüklenemediğinde ya da konum bilgisi yokken 'Harita' düğmesi basılı kalıyor, oysa gösterilen içerik liste

| Alan                | Değer                          |
| ------------------- | ------------------------------ |
| Severity            | Low                            |
| Durum               | Aday                           |
| Konum               | `src/app/search/page.tsx:443`  |
| Kullanıcılar        | misafir                        |
| Prensip             | robustness · observability     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü |
| Renk/tema           | Hayır                          |
| Efor                | S                              |
| Kaynak denetçiler   | area:results                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**   |

**Kanıt:** page.tsx:271 `showMap = view === 'map' && !mapError && mapPoints.length > 0`; ama 443 `aria-pressed={view === v}` ve 448-450'deki stil view state'ine bakıyor. mapFailed ('...liste görünümü gösteriliyor', tr/search.json) ve noLocation durumlarında liste görünüyor ama 'Harita' düğmesi seçili görünüyor ve öyle duyuruluyor.

**Etki:** Misafir görünümün hangisi olduğunu anlamıyor; ekran okuyucu 'Harita, basılı' derken içerik liste.

**Önerilen aksiyon:** aria-pressed ve stil için `const effectiveView = showMap ? 'map' : 'list'` kullanın. Ya da onFail'de setView('list') çağırın; 'Harita' düğmesini aria-disabled yapıp nedenini aria-describedby ile bağlayın.

## F1365 — Arama boş durumunda filtre temizleme eylemi yok; varsayılan istemci fiyat üst sınırı sonuçları sessizce gizleyebiliyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Low                                                          |
| Durum               | Aday                                                         |
| Konum               | `src/app/search/page.tsx:478`                                |
| Diğer konumlar      | `src/app/search/page.tsx:159`, `src/app/search/page.tsx:426` |
| Kullanıcılar        | misafir                                                      |
| Prensip             | robustness · observability                                   |
| Sezgisel madde      | H13 — Feedforward                                            |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | lens:status                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** search/page.tsx:478-483 boş durum yalnız 'Filtreleri değiştirmeyi deneyin.' metni; 159 `useState<[number, number]>([0, 20000])` istemci tarafı varsayılan üst sınır, 249-255 sonuçları gizliyor; tek ipucu 426 '{shown} sonuç gösteriliyor ({total} bulundu)'.

**Etki:** Misafir hangi filtrenin sonuçları sakladığını bulmak için tek tek denemek zorunda; yüksek fiyatlı ilanlar habersiz gizleniyor.

**Önerilen aksiyon:** Boş durumda 'Filtreleri temizle' butonu (fiyat, tür, erişilebilirlik, akıllı filtre sıfırla) ve shown<total iken 'X sonuç filtreleriniz nedeniyle gizlendi — Göster' bağlantısı; varsayılan üst sınırı boş bırak.

## F1366 — Arama sonuçları bölümünde başlık/liste semantiği ve aria-busy yok

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/app/search/page.tsx:504`                  |
| Diğer konumlar      | `src/components/property/PropertyCard.tsx:133` |
| Kullanıcılar        | misafir                                        |
| Prensip             | accessibility · Info and Relationships         |
| Sezgisel madde      | H14 — Erişilebilirlik                          |
| WCAG                | 1.3.1                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | lens:a11y                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** 326 `<h2 ...>{t("filters.title")}</h2>` aside'da; sonuç ızgarası 503-554 `<div className="grid ...">` ve kart başlıkları PropertyCard.tsx:133 `<h3>` — sonuçlar için h2 yok, başlık gezinmesinde kartlar 'Filtreler'in altında görünüyor; liste değil (sayı bilgisi yok); yükleme sırasında (174-212) eski sonuçlar `aria-busy` olmadan kalıyor.

**Etki:** Ekran okuyucu başlık/liste gezinmesiyle sonuçlara atlayamıyor ve kaç sonuç olduğunu listeden öğrenemiyor; yükleme sırasında eski sonuçları güncel sanabiliyor.

**Önerilen aksiyon:** Sonuç sütununa `<h2 className="sr-only">{t("resultsHeading")}</h2>`, ızgarayı `<ul role="list">/<li>` yapın; kapsayıcıya `aria-busy={loading}` verin.

## F1367 — Harita yan listesinde seçili öğe yalnızca renk farkıyla belirtiliyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/app/search/page.tsx:599`               |
| Kullanıcılar        | misafir                                     |
| Prensip             | accessibility · WCAG 1.4.1 Rengin kullanımı |
| Sezgisel madde      | H14 — Erişilebilirlik                       |
| WCAG                | 1.4.1                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:results                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** page.tsx:599-603: seçili öğe `border-[#003580] bg-amber-100`, seçili olmayan `border-gray-200 bg-white`. Fark yalnızca kenarlık ve arka plan renginde; metin ya da simge değişmiyor. aria-pressed yalnızca yardımcı teknolojilere ulaşıyor.

**Etki:** Renk algısı zayıf misafir, haritada seçtiği ilanın listede hangisi olduğunu ayırt etmekte zorlanıyor.

**Önerilen aksiyon:** Seçili öğeye görünür bir '✓ Seçili' metni ya da check simgesi ekleyin ve kenarlığı border-2 ile kalınlaştırın. Bu, renge ek bir ipucudur ve renk değişikliği gerektirmez.

## F1368 — Akıllı filtre girişi kısıtlarını ve anlayabildiği ifadeleri önceden bildirmiyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/search/SmartFilter.tsx:113` |
| Kullanıcılar        | misafir                                     |
| Prensip             | learnability · predictability               |
| Sezgisel madde      | H13 — Feedforward                           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:results                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** SmartFilter.tsx:113-121 `<input id='smart-filter' ... minLength={3} maxLength={300} .../>`: type='search', enterKeyHint='search' ve autoComplete='off' yok. 3 karakterlik alt sınır yalnızca tarayıcının kendi dilindeki yerel doğrulama balonuyla bildiriliyor. 103 `if (text.trim().length >= 3)` boşluklarla uzatılmış kısa metinde sessizce hiçbir şey yapmıyor. Hangi ifadelerin anlaşıldığı (şehir, tarih, kişi sayısı, bütçe, olanak) için yardım metni yok; tek örnek yazmaya başlayınca kaybolan placeholder.

**Etki:** Misafir sistemin neleri anlayabildiğini bilmeden deneme yanılmayla yazıyor; kısa bir metin gönderdiğinde neden bir şey olmadığını anlamıyor.

**Önerilen aksiyon:** Girişe `type='search' enterKeyHint='search' autoComplete='off'` ekleyin. Altına aria-describedby ile bağlı kalıcı bir ipucu koyun: 'Şehir, tarih, kişi sayısı, bütçe ve olanakları yazabilirsiniz (en az 3 karakter)'. 3 karakterden kısa gönderimde görünür bir hata metni gösterin.
