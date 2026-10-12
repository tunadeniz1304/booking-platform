# Ev sahibi paneli — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 153 bulgu · Severity: Critical 4, High 36, Medium 82, Low 31

## F14 — Satır içi kanıt seçici değişince anında kaydediyor; klavye ok tuşuyla gezinmek doğrulamayı düşürüyor

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Critical                                             |
| Durum               | Aday (2 kaynak birleşti)                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:221`     |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx:125-133` |
| Kullanıcılar        | ev sahibi                                            |
| Prensip             | accessibility · On Input / predictability            |
| Sezgisel madde      | H5 — Hata önleme                                     |
| WCAG                | 3.2.2                                                |
| Renk/tema           | Hayır                                                |
| Efor                | M                                                    |
| Kaynak denetçiler   | area:host2, lens:forms                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)                        |

**Kanıt:** AccessibilityPanel.tsx:218-221 `<select id={`a11y-evidence-${feature.id}`} value={feature.evidencePhotoId ?? ""} onChange={(e) => void setEvidence(feature, e.target.value)}>` her değişimde PATCH atıyor. prisma/migrations/20260927900000_accessibility_features/migration.sql:55-60 tetiği evidencePhotoId değişince `NEW."verifiedAt" := NULL` yapıyor. Uyarı metni ('Kanıt değiştirilirse doğrulama yeniden yapılır', host.evidenceHint) yalnız ekleme formundaki alanda (301), satır içi seçicide yok.

**Etki:** Windows'ta kapalı bir select üzerinde ↑/↓ tuşu değeri değiştirip change olayını hemen tetikler; yalnız klavye kullanan ev sahibi seçenekleri gözden geçirirken her adımda PATCH gönderir, doğrulanmış özelliğin rozeti uyarı ve onay olmadan düşer ve geri getirilemez.

**Önerilen aksiyon:** Satır içi seçiciyi yerel state'e bağlayın (onChange yalnız state'i güncellesin), yanına yalnız değer değiştiğinde etkin olan 'Kanıtı kaydet' düğmesi koyun. feature.verified ise seçicinin altına aria-describedby ile bağlı 'Kaydederseniz doğrulama kaldırılır ve yeniden inceleme gerekir' uyarısı ekleyin; kaydetmeden önce onay isteyin.

**Yapılan düzeltme:** AccessibilityPanel: the inline evidence select no longer saves when it changes. The choice stays in a local `drafts` state, and a new 'Kanıtı kaydet' button (enabled only when the value has changed, busy while saving) sends the PATCH. If the feature is verified, a useConfirm danger dialog asks before saving. A hint below the select, linked with aria-describedby, reads evidenceVerifiedWarning on verified features and evidenceHint on the rest. — dosyalar: `src/components/host/AccessibilityPanel.tsx`

## F15 — Yeni ev sahibi arayüzden mülk oluşturamıyor; boş durum çıkmaz sokak

| Alan                | Değer                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                |
| Durum               | Aday (2 kaynak birleşti)                                                                                |
| Konum               | `src/components/host/HostDashboard.tsx:117`                                                             |
| Diğer konumlar      | `src/app/api/properties/route.ts:76`, `messages/tr/host.json:12`, `src/components/layout/Footer.tsx:14` |
| Kullanıcılar        | ev sahibi                                                                                               |
| Prensip             | robustness · task conformance                                                                           |
| Sezgisel madde      | H13 — Feedforward                                                                                       |
| Renk/tema           | Hayır                                                                                                   |
| Efor                | L                                                                                                       |
| Kaynak denetçiler   | area:host, lens:nav                                                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostA)                                                                           |

**Kanıt:** HostDashboard.tsx:117-119 '{properties?.length === 0 && (<p className="text-sm text-gray-700">{t("dashboard.noProperties")}</p>)}' → 'Henüz bir mülkünüz yok.' — eylem/bağlantı yok. POST /api/properties (src/app/api/properties/route.ts:76) var ama src altında bu ucu çağıran hiçbir istemci bileşeni yok (grep: yalnız openapi.ts/public-routes.ts/rate-limit.ts). Sayfa intro'su da yalnız 'düzenleyin, oda ekleyin' diyor (host.json page.intro).

**Etki:** İlk kez gelen host'un birincil görevi (ilan oluşturma) hiç başlatılamaz; panel tek paragrafla biter, kullanıcı ne yapacağını bilemez.

**Önerilen aksiyon:** 'Yeni ilan oluştur' akışı ekle (başlık, tür, şehir/ülke, taban fiyat, para birimi, ilk oda → POST /api/properties); boş durumda birincil <Button> 'İlk ilanınızı oluşturun' ile bu akışa bağla; KYC zorunluysa (assertIdentityRequirement) önce kimlik doğrulama sayfasına bağlantı ve gerekçe metni göster.

**Yapılan düzeltme:** HostDashboard.tsx: added a new CreatePropertyForm with title, type, description, city, country, base price (text input with inputMode decimal, parsed by parseAmountToMinor), currency, licence number and a first room (name, capacity, bed type). It posts to POST /api/properties. The empty state now shows a description and a primary 'İlk ilanınızı oluşturun' button, and the list header has a 'Yeni ilan oluştur' button. On an IDENTITY_VERIFICATION_REQUIRED error the form explains the reason and links to /account for identity verification. It also has a busy state, aria-busy and per-field errors. — dosyalar: `src/components/host/HostDashboard.tsx`

## F26 — Erişilebilirlik özelliği silme onaysız ve geri alınamaz; doğrulanmış rozet kalıcı kayboluyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Critical                                         |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:242` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · recoverability                      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                |
| WCAG                | 3.3.4                                            |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)                    |

**Kanıt:** AccessibilityPanel.tsx:242-248 `<Button variant="danger" onClick={() => void remove(feature)} ...>{t("host.delete")}</Button>` doğrudan DELETE atıyor (135-142). Sunucu tarafı src/lib/compliance/accessibility.ts:197 `prisma.accessibilityFeature.deleteMany(...)` ile kalıcı siliyor; yeniden eklenen kayıt verifiedAt=null ile doğar ve admin kuyruğuna geri düşer. Onay diyaloğu, soft-delete ya da 'Geri al' yok.

**Etki:** Ev sahibi (partial okuryazarlık, masaüstü) yanlışlıkla 'Sil'e bastığında platform ekibinin kanıtla doğruladığı özellik ilandan ve erişilebilirlik aramasından anında kalkar; tekrar görünmesi için yeniden admin doğrulaması beklenir. Engelli misafirlerin arama sonuçları da etkilenir.

**Önerilen aksiyon:** Sil düğmesi önce <dialog role="alertdialog" aria-labelledby aria-describedby> açsın: başlık 'Basamaksız giriş (Tüm tesis) silinsin mi?', gövde feature.verified ise 'Doğrulanmış rozet kalkacak; yeniden eklerseniz platform incelemesi gerekir.' Onay düğmesi 'Kalıcı olarak sil', iptal varsayılan odakta. Alternatif: silmeyi 10 sn ertelenen soft-delete yapıp öğe yerinde 'Silindi — Geri al' düğmesi göstermek.

**Yapılan düzeltme:** Delete now asks first with a useConfirm danger dialog: title '{name} ({scope}) silinsin mi?', default focus on Cancel, confirm button 'Kalıcı olarak sil'. On verified features the body warns that the verified badge will be removed and the platform team must review again. Delete and save buttons get busy and min-h-[44px]. — dosyalar: `src/components/host/AccessibilityPanel.tsx`

## F27 — Depozitoda '1.500' yazımı sessizce ₺1,50 olarak kaydediliyor

| Alan                | Değer                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                |
| Durum               | Aday                                                                                                                    |
| Konum               | `src/components/host/DepositSettings.tsx:143`                                                                           |
| Diğer konumlar      | `src/components/resolution/shared.tsx:145`, `src/lib/money/money.ts:156`, `src/components/host/DepositSettings.tsx:105` |
| Kullanıcılar        | ev sahibi                                                                                                               |
| Prensip             | robustness · task conformance / hata önleme                                                                             |
| Sezgisel madde      | H5 — Hata önleme                                                                                                        |
| WCAG                | 3.3.4                                                                                                                   |
| Renk/tema           | Hayır                                                                                                                   |
| Efor                | S                                                                                                                       |
| Kaynak denetçiler   | area:host                                                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)                                                                                           |

**Kanıt:** DepositSettings.tsx:143 pattern='\d+([.,]\d{1,3})?' TRY için 3 ondalığa izin veriyor; DepositSettings.tsx:116 parseMajorInput(value, currency) → resolution/shared.tsx:145 'toMinor(value.trim().replace(",", "."), currency)'; money.ts:156 'if (frac.length > exp && /[1-9]/.test(frac.slice(exp)))' yalnız sıfır olmayan fazla basamakta hata atar. Sonuç: '1.500' → int=1, frac='500' → 100+50 = 150 minor = ₺1,50; '1,500' (EN binlik) de aynı. maxMinor kontrolü (L121) geçilir, mesaj yalnız 'Depozito kaydedildi.' (L105) — tutar yankılanmaz.

**Etki:** Türkçede binlik ayırıcı olarak nokta kullanan ev sahibi 1.000 / 1.500 / 5.000 gibi yuvarlak tutarlarda bin kat düşük depozito tanımlar ve bunu fark etmez; hasarda provizyondan tahsil edilecek tutar ~0 olur (doğrudan para kaybı). EN kullanıcısı '1,500' yazınca aynı hata.

**Önerilen aksiyon:** (1) pattern'i para biriminin basamak sayısından üret (TRY: '\d+([.,]\d{1,2})?'), 3 basamaklı kesri olan girişi 'Binlik ayırıcı kullanmayın; ör. 1500 veya 1500,50' hatasıyla reddet; ya da TR yerelinde '.' binlik ayırıcı olarak ayrıştır. (2) Field hint'ine aria-live canlı önizleme ekle: '= ₺1.500,00'. (3) Başarı mesajını 'Depozito {amount} olarak kaydedildi.' yap.

**Yapılan düzeltme:** DepositSettings: parseMajorInput is replaced by parseAmountToMinor(value, fractionDigits from Intl for the currency), so '1.500' parses as 150000 (₺1.500,00). The restrictive pattern is removed and autoComplete=off added. The hint now includes 'Örnek: 1500 veya 1.500,50'. An aria-live preview shows 'Kaydedilecek tutar: ₺1.500,00'. An invalid or too-high amount is shown as a Field error (aria-invalid) and focus moves to the input. The success message includes the amount ('{scope} depozitosu {amount} olarak kaydedildi.'). The loading text sits in an always-mounted role=status. — dosyalar: `src/components/host/DepositSettings.tsx`

## F126 — Kanıt fotoğrafları yalnızca 'Fotoğraf 1/2/3' diye listeleniyor; ilanın fotoğrafları panelde hiç gösterilmiyor

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | High                                                                         |
| Durum               | Gözlemlendi                                                                  |
| Konum               | `src/components/host/AccessibilityPanel.tsx:84`                              |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx`                                      |
| Kullanıcılar        | ev sahibi                                                                    |
| Prensip             | learnability · Learnability: tanıma > hatırlama (familiarity, observability) |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                      |
| Renk/tema           | Hayır                                                                        |
| Efor                | M                                                                            |
| Kaynak denetçiler   | runtime:host                                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostB)                                         |

**Kanıt:** Probe p4 (mock, 3 fotoğraf): #a11y-evidence seçenekleri ['Kanıt yok','Fotoğraf 1','Fotoğraf 2','Fotoğraf 3']. Erişilebilirlik kartında 0 img var. Mülk kartında da mevcut fotoğraflar listelenmiyor (#prop-… içinde 0 img). PhotoUpload yalnızca bir dosya girişi ve son yükleme sonucunu gösteriyor (HostDashboard.tsx:634-682). Gerçek ekran görüntüsünde (crops/host/d-host-b2.png) 'Kanıt fotoğrafı: Kanıt yok' seçicisinin yanında önizleme yok. 'Kanıtı görüntüle' bağlantısı yalnızca kanıt bağlandıktan sonra çıkıyor ve yeni sekmede açılıyor.

**Etki:** Ev sahibi 'Fotoğraf 2'nin hangi kare olduğunu bilemiyor. Kanıtı tahminle bağlıyor, yanlış bağlanan kanıt admin incelemesinde reddediliyor. Bu da doğrulanmış erişilebilirlik özelliklerinin yayınlanmasını geciktiriyor.

**Önerilen aksiyon:** Kanıt seçimini küçük resimli bir radyo ızgarasına çevirin (img alt='Fotoğraf N: <yükleme tarihi>'). Mülk kartına mevcut fotoğrafların galerisini ekleyin (sırala/sil/önizle). Seçili kanıtın küçük resmini satırda gösterin.

**Yapılan düzeltme:** A thumbnail of the selected photo (img with alt 'Seçili kanıt: Fotoğraf N') now shows next to the inline select and below the add-form select. The add-form select is controlled so the preview updates. Not done: a thumbnail radio grid, and a photo gallery on the property card (that lives in HostDashboard, owned by someone else). Photo has no upload date, so the 'Fotoğraf N' labels stay as they are. — dosyalar: `src/components/host/AccessibilityPanel.tsx`

## F127 — Erişilebilirlik kanıtı seçicisi ok tuşunda anında kaydediyor ve doğrulanmış özelliğin onayını düşürüyor

| Alan                | Değer                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Severity            | High                                                                                  |
| Durum               | Gözlemlendi                                                                           |
| Konum               | `src/components/host/AccessibilityPanel.tsx:221`                                      |
| Kullanıcılar        | ev sahibi                                                                             |
| Prensip             | robustness · Robustness: kurtarılabilirlik / hata önleme                              |
| Sezgisel madde      | H5 — Hata önleme                                                                      |
| WCAG                | 3.2.2 On Input (A) ruhuna aykırı (bağlam değişikliği değil, beklenmedik kalıcı işlem) |
| Renk/tema           | Hayır                                                                                 |
| Efor                | S                                                                                     |
| Kaynak denetçiler   | runtime:host                                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)                                                         |

**Kanıt:** Probe p11 (/host, masaüstü, mock API, verified:true + evidencePhotoId=ph1 olan bir özellik): rozet 'Doğrulanmış' iken kapalı #a11y-evidence-f1 select'ine odaklanıp iki kez ArrowDown basıldı. Her basış hemen PATCH …/accessibility/f1 {"evidencePhotoId":"ph2"} gönderdi. Onay penceresi açılmadı, ardından 'Kanıt güncellendi; özellik yeniden incelenecek.' mesajı çıktı. Kod: onChange={(e)=>void setEvidence(...)} (AccessibilityPanel.tsx:221). Bileşen yorumuna göre kanıt değişince DB tetiği doğrulamayı düşürüyor (AccessibilityPanel.tsx:25-26). 'Kanıt değiştirilirse doğrulama yeniden yapılır' uyarısı bu satır içi select'te yok, yalnızca ekleme formunda gösteriliyor (satır 301). Görüntü: runtime/crops/host/probe-a11y-panel.png.

**Etki:** Klavyeyle formda gezinen ya da seçenekleri incelemek isteyen bir ev sahibi, admin onayından geçmiş bir erişilebilirlik özelliğini farkında olmadan 'doğrulanmamış' durumuna düşürebilir. Özellik ilandan ve aramadan kalkar, yeniden inceleme kuyruğuna girer. Geri alma yolu yok.

**Önerilen aksiyon:** Satır içi select'i yalnızca bir seçim alanı yapın ve yanına 'Kanıtı kaydet' düğmesi koyun. Doğrulanmış bir özellikte kaydetmeden önce 'Bu değişiklik doğrulamayı kaldırır' onayı isteyin. evidenceHint metnini bu select'e de aria-describedby ile bağlayın.

**Yapılan düzeltme:** Same fix as F14 (draft state, save button, confirm on verified features, hint linked with aria-describedby). — dosyalar: `src/components/host/AccessibilityPanel.tsx`

## F128 — Tüm mülkler tek sayfada tamamen açık: yaklaşık 66 bin px sayfa, Promosyonlar'a ulaşmak için 1119'dan fazla Tab

| Alan                | Değer                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                    |
| Durum               | Gözlemlendi                                                                                             |
| Konum               | `src/components/host/HostDashboard.tsx:120`                                                             |
| Diğer konumlar      | `src/components/host/DepositSettings.tsx`, `src/app/host/page.tsx`                                      |
| Kullanıcılar        | ev sahibi                                                                                               |
| Prensip             | flexibility · Flexibility: özelleştirilebilirlik ve görev verimliliği (kullanıcı görünümü daraltamıyor) |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                                                            |
| WCAG                | 2.4.1 Bypass Blocks (A) ile ilgili; başlıklar var ama sayfa içi atlama yok                              |
| Renk/tema           | Hayır                                                                                                   |
| Efor                | L                                                                                                       |
| Kaynak denetçiler   | runtime:host                                                                                            |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostA)                                                                    |

**Kanıt:** Tarama 094 (masaüstü): interactiveCount=1068, targetsLt44Count=996, loadMs=26700. Tam sayfa görüntü 1280x66745 px, mobil 095 ise 571x98619 px. Probe p1 (gerçek host oturumu, depozitolar yüklenmeden önce): scrollHeight=52026, main'de 44 section, 122 form, 790 odaklanabilir öğe ve 286 aria-live bölgesi vardı. Sayfanın tepesinden 'Promosyonlar' Ad alanına 1119 Tab basışında ulaşıldı. main içinde nav, sayfa içi bağlantı ya da details yok. Probe p6c: tek bir mülk kartı 27 Tab durağı (tarih alanları başına 4 segment). Her kart kendi depozito isteğini atıyor (HostDashboard.tsx:324): 40 mülk için 40 paralel GET.

**Etki:** Ev sahibinin sık yaptığı işler (bir ilanın takvimini kapatmak, promosyon eklemek, rezervasyonlara bakmak) uzun kaydırma ya da yüzlerce Tab gerektiriyor. Klavye ve ekran okuyucu kullanıcıları, aynı adlı 40 'Kaydet' ve 80 form landmark'ı arasında kayboluyor. Sayfa yükü ve bellek de büyüyor.

**Önerilen aksiyon:** Paneli bir liste/detay düzenine çevirin: üstte mülk özet tablosu (ad, durum, belge, doluluk) ve her mülk için /host/properties/[id] sayfası. Ya da her PropertyPanel'i başlangıçta kapalı <details>/akordeon yapın ve DepositSettings ile takvimi yalnızca açılınca yükleyin. Sayfanın başına sayfa içi bir nav ekleyin (Mülkler · Promosyonlar · Erişilebilirlik · Rezervasyonlar). Mülk sayısı fazlaysa arama veya filtre sunun. Gelir sayfasındaki 'Mülk' seçicisi kalıbı burada da kullanılabilir.

**Yapılan düzeltme:** Added an in-page nav (nav aria-label) with links to Rezervasyonlar, İlanlarım, Promosyonlar and Erişilebilirlik. Each PropertyPanel's management content is now inside a <details> that only the first card opens by default. Closed cards don't render their forms or send requests (DepositSettings, the photo list), so 40 cards no longer fire 40 parallel deposit requests. Above 5 listings a title search filter appears. Separate /host/properties/[id] routes were not created (route/product decision). — dosyalar: `src/components/host/HostDashboard.tsx`

## F129 — Mobilde host'a özgü ek yatay taşmanın kaynağı: kaydırma kapsayıcısından kaçan sr-only span'ler

| Alan                | Değer                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Severity            | High                                                                                |
| Durum               | Gözlemlendi                                                                         |
| Konum               | `src/components/host/HostDashboard.tsx:132`                                         |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx`, `src/components/host/PartyRiskPanel.tsx` |
| Kullanıcılar        | ev sahibi                                                                           |
| Prensip             | accessibility · Robustness: duyarlı yerleşim (reflow)                               |
| Sezgisel madde      | H14 — Erişilebilirlik                                                               |
| WCAG                | 1.4.10 Reflow (AA)                                                                  |
| Renk/tema           | Hayır                                                                               |
| Efor                | S                                                                                   |
| Kaynak denetçiler   | runtime:host                                                                        |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostA)                                                |

**Kanıt:** Tarama: 095-host-tr-mobile-_host overflowPx=142. Aynı persona /host/payouts ve /host/revenue'da yalnızca 66 px, yani başlıktan gelen bilinen kısım. Tam sayfa görüntü 571 px genişliğinde (full/shots/095-host-tr-mobile-_host.png). Probe p5c (390x844, mock API): taşan öğeler span.sr-only (position:absolute, right=557). Bunlar 'Sil: <promosyon adı>' (PromotionsPanel.tsx:213) ile sr-only th 'İşlemler/Mesajlar' (PromotionsPanel.tsx:179, HostDashboard.tsx:156). .overflow-x-auto sarmalayıcıları konumlandırılmadığı için absolute span'ler kırpılmıyor. Probe p5d: sarmalayıcılara position:relative enjekte edilince taşma 167'den 66 px'e indi. Başlık da kırpılınca 0 oldu.

**Etki:** Ev sahibi telefonda paneli iki eksende kaydırmak zorunda kalıyor. Sayfa her dokunuşta yana kayıyor ve formlar ekrandan çıkıyor. Bu, başlık sorununun üstüne binen ayrı bir 76 px'lik reflow ihlali.

**Önerilen aksiyon:** Bu üç kapsayıcıya `relative` ekleyin: HostDashboard.tsx:132, PromotionsPanel.tsx:155, PartyRiskPanel.tsx:36 (`className="relative overflow-x-auto"`). İsterseniz projedeki tüm `overflow-x-auto` tablo sarmalayıcılarını tek bir <TableScroll> bileşenine taşıyın (relative + tabIndex=0 + role=region + aria-label). Başlıktan gelen 66 px'lik kısım genel bulguda ayrıca düzeltilmeli.

**Yapılan düzeltme:** In HostDashboard the bookings table wrapper is now 'relative hidden overflow-x-auto md:block' with role=region, tabIndex=0 and aria-label, so the absolute sr-only spans no longer escape it. On mobile the table is replaced by a card list. The PromotionsPanel.tsx and PartyRiskPanel.tsx wrappers belong to other owners (see crossOwner). — dosyalar: `src/components/host/HostDashboard.tsx`

## F130 — Her mülk kartındaki 'Başlık' alanının erişilebilir adı yok: yinelenen id yüzünden etiket h2 başlığa bağlanıyor

| Alan                | Değer                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                            |
| Durum               | Gözlemlendi                                                                                     |
| Konum               | `src/components/host/HostDashboard.tsx:238`                                                     |
| Diğer konumlar      | `src/components/ui/ui.tsx`                                                                      |
| Kullanıcılar        | ev sahibi                                                                                       |
| Prensip             | accessibility · Robustness: algılanabilirlik / yardımcı teknolojiyle uyumluluk                  |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                           |
| WCAG                | 1.3.1 Info and Relationships (A), 4.1.2 Name, Role, Value (A), 3.3.2 Labels or Instructions (A) |
| Renk/tema           | Hayır                                                                                           |
| Efor                | S                                                                                               |
| Kaynak denetçiler   | runtime:host                                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostA)                                                                   |

**Kanıt:** Kod: Card id={pid} (HostDashboard.tsx:229) başlığa `${pid}-title` id'sini veriyor (ui.tsx:99), aynı kartta Field/input da id=`${pid}-title` kullanıyor (HostDashboard.tsx:238-240). Gerçek veri: tarama tabOrder'ında input#prop-cmv2uyf580nsy92w2pkyccvi6-title var, yani 40 kartın hepsinde aynı çakışma oluşuyor. Probe p6c (/host, masaüstü, mock API): 6 kartta 'prop-…-title x2' yinelenen id bulundu. label[for].control=null ve input.labels.length=0 çıktı. ARIA anlık görüntüsünde alan adsız 'textbox: Londra Hyde Park Guesthouse' olarak görünüyor. getByRole('textbox',{name:'Başlık'}) 0 sonuç döndürdü. 'Başlık' etiketine tıklanınca odak body'ye düşüyor. axe bu durumu yakalamadı, taramanın 'unlabeled' kontrolü de etiketi var saydığı için atladı.

**Etki:** Ekran okuyucu kullanıcısı ilanın en önemli metin alanını adı olmadan duyuyor ve yalnızca mevcut değeri işitiyor. Etikete tıklayınca alan odaklanmıyor. Sesli komutla 'Başlık'a tıkla' denemesi de çalışmıyor. Sorun 40 ilanın hepsinde var.

**Önerilen aksiyon:** Alanın id'sini değiştirin: `${pid}-field-title` gibi bir değer verin ya da Card başlık id'sini `${id}-heading` yapın (ui.tsx:99, aria-labelledby ile birlikte). Kalıcı olarak, Card'ın başlık id'sini React useId() ile üretin. Kod tabanına duplicate-id için bir lint/axe kuralı ekleyin.

**Yapılan düzeltme:** The title field id is now `${pid}-name` (Field id and input id), so it no longer clashes with the Card h2 id `${pid}-title`. The label is correctly linked to the input again. — dosyalar: `src/components/host/HostDashboard.tsx`

## F131 — Gelir paneli Pickup grafiğinin veri tablosu yok; günlük değerler yalnızca fareyle üzerine gelinince görünüyor

| Alan                | Değer                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Severity            | High                                                                                  |
| Durum               | Gözlemlendi                                                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:75`                                         |
| Kullanıcılar        | ev sahibi                                                                             |
| Prensip             | accessibility · Robustness: algılanabilirlik (eşdeğer metin alternatifi)              |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                 |
| WCAG                | 1.1.1 Non-text Content (A), 2.1.1 Keyboard (A), 1.4.13 Content on Hover or Focus (AA) |
| Renk/tema           | Hayır                                                                                 |
| Efor                | M                                                                                     |
| Kaynak denetçiler   | runtime:host                                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)                                                         |

**Kanıt:** Probe p7 (/host/revenue, mock, 30 günlük pickup): svg role=img, aria-labelledby='pickup-title pickup-desc'. desc yalnızca 'Son 30 günde … son değer 10.' diyor. Kartta table=0, details=0. Günlük değerler sadece <rect><title> içinde (RevenueDashboard.tsx:103) ve odaklanabilir çubuk sayısı 0. ARIA anlık görüntüsü: img 'Pickup grafiği Son 30 günde…' ve etiketler '10 11.09.2026 10.10.2026'. Gerçek veride (tarama 098) grafik boş bir çizgi ve tek '1' etiketi gösteriyor (crops/host/d-revenue-0.png).

**Etki:** Ekran okuyucu, klavye ve dokunmatik kullanıcılar hangi gün kaç oda-gece girildiğini öğrenemiyor. Fiyat kararının dayandığı veri bu kullanıcılara kapalı.

**Önerilen aksiyon:** <figure> altına <details><summary>Veriyi tablo olarak göster</summary> ekleyin. İçine Tarih / O gün girilen / Penceredeki toplam sütunlu, caption'lı ve th scope'lu bir tablo koyun. desc'e eğilimi de yazın (min/maks, artış). Çubuk ipuçlarını focusable yapmayın, tabloyla karşılayın.

**Yapılan düzeltme:** RevenueDashboard PickupChart: added a <details> section ('Veriyi tablo olarak göster') with a table. It has a caption, th scope=col headers, the date as th scope=row, and columns for room-nights booked that day and total room-nights on the books. It sits in a scrollable region with tabIndex=0, role=region and aria-label. The trend (first value, last value, highest single day) was added to the figcaption and linked to the svg with aria-describedby. — dosyalar: `src/components/host/RevenueDashboard.tsx`

## F172 — Ev sahibi ve yönetici formlarında çift gönderim koruması ve gönderim sırasında düğme durumu yok

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Konum               | `src/components/host/HostDashboard.tsx:410`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:431-456,523`, `src/components/host/PromotionsPanel.tsx:85-114,347`, `src/components/host/AccessibilityPanel.tsx:97-123,317`, `src/components/transfers/TransferMarket.tsx:116-134,183`, `src/components/compliance/ComplianceDashboard.tsx:52-68,128,199`, `src/components/compliance/AppealQueue.tsx:46-65,151`, `src/components/admin/AdminDashboard.tsx:134-143,217-226,314-326,389-401,492-504`, `src/components/compliance/AccessibilityReviewQueue.tsx:37-48`, `src/components/property/ReviewsSection.tsx:34-52`, `src/components/host/HostDashboard.tsx:523`, `src/components/host/PromotionsPanel.tsx:347`, `src/components/host/AccessibilityPanel.tsx:316`, `src/components/compliance/ComplianceDashboard.tsx:128`, `src/components/admin/AdminDashboard.tsx:531`, `src/components/admin/AdminDashboard.tsx:175`, `src/components/transfers/TransferMarket.tsx:182`, `src/components/property/ReviewsSection.tsx:73` |
| Kullanıcılar        | ev sahibi, admin, misafir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Prensip             | robustness · responsiveness, task conformance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Sezgisel madde      | H12 — Feedback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:forms, lens:status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostA)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Kanıt:** src/components/host/HostDashboard.tsx:340-359 AddRoomForm `submit` busy state'i yok, :410 `<Button type="submit" variant="secondary">` hiç pasifleşmiyor (çift tık → iki oda POST). Aynı durum: CalendarForm :431-456/:523; src/components/host/PromotionsPanel.tsx:85-114/:347 (çift promosyon); src/components/host/AccessibilityPanel.tsx:97-123/:317 (`disabled={!propertyId}` yalnız); src/components/transfers/TransferMarket.tsx:116-134/:183 'Devret'; src/components/compliance/ComplianceDashboard.tsx:52-68/:128 'Talebi kaydet ve ilanı kaldır' (form başarıdan sonra reset de edilmiyor); src/components/compliance/AppealQueue.tsx:46-65/:151; src/components/admin/AdminDashboard.tsx:492-504/:531 RoleCard; src/components/property/ReviewsSection.tsx:34-52/:73-79 şikâyet gönder. Ödeme akışlarında ise Idempotency-Key + busy var (checkout/page.tsx:22-40, BookingActions.tsx:64).

**Etki:** Masaüstündeki ev sahibi yavaş yanıtta tekrar tıklayınca mükerrer oda/promosyon oluşur (fiyatlamayı bozar); yönetici aynı ilan için iki kaldırma talebi kaydeder. Gönderim sürerken geri bildirim olmadığından kullanıcı işlemin başladığını bilemez.

**Önerilen aksiyon:** Her submit'e `busy` state ekle: `<Button type="submit" disabled={busy} aria-busy={busy}>{busy ? t("saving") : t("save")}</Button>`; POST'larda checkout'taki gibi form açılışında üretilen Idempotency-Key gönder. ComplianceDashboard'da başarıdan sonra `e.currentTarget.reset()`. Ortak `useSubmit()` kancası ile tekrar kullan.

**Yapılan düzeltme:** In HostDashboard, the AddRoomForm, CalendarForm, PropertyPanel save, CreatePropertyForm, room open/close and photo remove actions now have a busy state, disabled, aria-busy and an early return when busy (double-submit protection), with labels such as 'Ekleniyor…'. No Idempotency-Key header was added because server support is unclear (needs backend). The other files listed (PromotionsPanel, AccessibilityPanel, TransferMarket, ComplianceDashboard, AppealQueue, AdminDashboard, ReviewsSection) belong to other owners. — dosyalar: `src/components/host/HostDashboard.tsx`

## F173 — Biçim/uzunluk kısıtları görünür talimat olmadan yalnız tarayıcı balonuyla

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                         |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                     |
| Konum               | `src/components/host/PromotionsPanel.tsx:288`                                                                                                                                                                                                                                                                                                                                                |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:268`, `src/components/host/HostDashboard.tsx:243`, `src/components/host/HostDashboard.tsx:382`, `src/components/host/PromotionsPanel.tsx:272`, `src/components/host/DepositSettings.tsx:143`, `src/components/host/DepositSettings.tsx:131-145`, `src/components/transfers/TransferMarket.tsx:167-180`, `src/components/admin/ClaimAdmin.tsx:201-217` |
| Kullanıcılar        | ev sahibi                                                                                                                                                                                                                                                                                                                                                                                    |
| Prensip             | learnability · predictability (feedforward)                                                                                                                                                                                                                                                                                                                                                  |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                                                                                                                                                                                                                                                            |
| WCAG                | 3.3.2                                                                                                                                                                                                                                                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                        |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                            |
| Kaynak denetçiler   | area:host, lens:forms                                                                                                                                                                                                                                                                                                                                                                        |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostB)                                                                                                                                                                                                                                                                                                                                                         |

**Kanıt:** PromotionsPanel.tsx:288 kupon kodu 'pattern="[A-Za-z0-9_\-]{4,40}"' — hint yok; HostDashboard.tsx:268-269 açıklama 'minLength={10} maxLength={5000}' sayaç/ipucu yok; :243 başlık 'minLength={2}'; :382 kapasite 'max={20}'; PromotionsPanel.tsx:272 koşul 'max={730}', :327-328 öncelik '-1000..1000'; DepositSettings.tsx:143 pattern için biçim ipucu yok. Yalnız lisans alanında hint var (HostDashboard.tsx:278).

**Etki:** Host formu gönderince tarayıcının (sayfa dilinden bağımsız) genel 'İstenen biçimle eşleşin' balonunu görür; kuralı tahmin eder; balon kısa süreli olduğu için ekran okuyucu ve düşük okuryazar kullanıcı kuralı kaçırır.

**Önerilen aksiyon:** Field hint ekle: kupon 'Kupon kodu 4–40 karakter; harf, rakam, - ve _'; açıklama için aria-describedby'lı canlı sayaç '{n}/5000 (en az 10)'; kapasite '1–20 kişi'; koşul '0–730 gün'; depozito 'Örn. 1500 veya 1500,50'. Kupon input'una autoCapitalize='characters' spellCheck={false} autoComplete='off'.

**Yapılan düzeltme:** PromotionsPanel: Field hints added for name (2–80 characters), discount (0,01–100), condition ({min}–730) and coupon code (4–40 characters; letters, digits, - and _). The coupon input gets autoCapitalize=characters, autoComplete=off and spellCheck={false}. DepositSettings got its format hint under F27. The HostDashboard, TransferMarket and ClaimAdmin fields are owned by others (written to crossOwner). — dosyalar: `src/components/host/PromotionsPanel.tsx`, `src/components/host/DepositSettings.tsx`

## F273 — Host sayfalarının belge başlığı (title) sayfayı tanımlamıyor

| Alan                | Değer                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                          |
| Durum               | Aday                                                                                          |
| Konum               | `src/app/host/page.tsx:1`                                                                     |
| Diğer konumlar      | `src/app/host/revenue/page.tsx:1`, `src/app/host/payouts/page.tsx:1`, `src/app/layout.tsx:16` |
| Kullanıcılar        | ev sahibi, admin                                                                              |
| Prensip             | accessibility · Page Titled                                                                   |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                         |
| WCAG                | 2.4.2                                                                                         |
| Renk/tema           | Hayır                                                                                         |
| Efor                | S                                                                                             |
| Kaynak denetçiler   | area:host                                                                                     |
| **Düzeltme durumu** | **Zaten uygun** (paket: hostA)                                                                |

**Kanıt:** src/app/host/page.tsx:1 '"use client";' — metadata/generateMetadata yok; yalnız PageShell h1 (L12). Kök layout (src/app/layout.tsx:16) 'title: t("meta.title")' → tüm host sayfalarında 'booking-platform — konaklama arama ve rezervasyon (demo)'. Gelir ve Ödemeler sayfaları da aynı ("use client").

**Etki:** Sekmeler arasında gezinen host (panel + gelir + ödemeler açık) sekmeleri ayırt edemez; ekran okuyucu sayfa açılışında host panelini duyurmaz; geçmiş/yer imleri aynı adı taşır.

**Önerilen aksiyon:** page.tsx'i sunucu sarmalayıcı + istemci içerik olarak böl: 'export async function generateMetadata() { const t = await getTranslations("host"); return { title: `${t("page.title")} · booking-platform` }; }'; /host/revenue ve /host/payouts için aynısı.

**Yapılan düzeltme:** Page titles are handled globally (src/app/host/layout.tsx and titles.json from wave 1). Per instructions, no metadata was added.

## F274 — Gelir ve Ödemeler sayfalarının belge başlığı (<title>) sayfaya özgü değil

| Alan                | Değer                             |
| ------------------- | --------------------------------- |
| Severity            | High                              |
| Durum               | Aday                              |
| Konum               | `src/app/host/revenue/page.tsx:1` |
| Diğer konumlar      | `src/app/host/payouts/page.tsx:1` |
| Kullanıcılar        | ev sahibi, admin                  |
| Prensip             | accessibility · Page Titled       |
| Sezgisel madde      | H14 — Erişilebilirlik             |
| WCAG                | 2.4.2                             |
| Renk/tema           | Hayır                             |
| Efor                | S                                 |
| Kaynak denetçiler   | area:host2                        |
| **Düzeltme durumu** | **Zaten uygun** (paket: hostB)    |

**Kanıt:** revenue/page.tsx:1 ve payouts/page.tsx:1 `"use client"`; metadata/generateMetadata yok. Başlık kök layout'tan geliyor: src/app/layout.tsx:13-16 `title: t("meta.title")` = 'booking-platform — konaklama arama ve rezervasyon (demo)'. Diğer sayfalar (src/app/privacy/page.tsx:7, src/app/ranking/page.tsx:7, src/app/report/page.tsx:6) generateMetadata kullanıyor.

**Etki:** Ekran okuyucu kullanıcıları sayfa açıldığında hangi ekranda olduklarını duymaz; birden çok sekme açan ev sahibi (gelir + ödemeler + panel) sekmeleri ayırt edemez; tarayıcı geçmişi/yer imleri aynı adı taşır.

**Önerilen aksiyon:** src/app/host/revenue/layout.tsx ve src/app/host/payouts/layout.tsx ekleyin: `export async function generateMetadata() { const t = await getTranslations("revenue"); return { title: `${t("page.title")} — booking-platform` }; }` (payouts için payouts.page.title).

**Yapılan düzeltme:** src/app/host/revenue/layout.tsx and src/app/host/payouts/layout.tsx were added in wave 1 with generateMetadata (titles namespace). Page titles were handled globally.

## F275 — Kanıt fotoğrafı seçenekleri 'Fotoğraf 1, 2…' — önizleme yok, numaralar kararsız

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | High                                                    |
| Durum               | Aday                                                    |
| Konum               | `src/components/host/AccessibilityPanel.tsx:83`         |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx:304`        |
| Kullanıcılar        | ev sahibi                                               |
| Prensip             | learnability · predictability (recognition over recall) |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                 |
| Renk/tema           | Hayır                                                   |
| Efor                | M                                                       |
| Kaynak denetçiler   | area:host2                                              |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostB)                    |

**Kanıt:** AccessibilityPanel.tsx:83-84 `photoLabel = (id) => t("host.photoOption", { index: String(photoOptions.findIndex(...) + 1) })`; seçenekler 225-229 ve 304-308 yalnız bu metni gösteriyor; küçük resim yok. 'Kanıtı görüntüle' (232-241) yalnız kanıt bağlandıktan sonra çıkıyor. Fotoğraf silinince indeksler kayar.

**Etki:** Ev sahibi hangi fotoğrafın rampa veya duşu gösterdiğini hatırlamak zorunda; yanlış kanıt bağlanır, admin reddeder ve doğrulama gecikir. Bu alanın birincil görevi (kanıt bağlamak) tahmine dönüşür.

**Önerilen aksiyon:** Select yerine `<fieldset><legend>Kanıt fotoğrafı</legend>` içinde küçük resimli radyo grubu kullanın (`<img src={p.url} alt="Fotoğraf 3" />` + yükleme tarihi); en azından seçilen fotoğrafın küçük önizlemesini select yanında gösterin ve kararlı etiket (yükleme tarihi/sıra) kullanın.

**Yapılan düzeltme:** Same as F126: the selected photo's thumbnail is shown in both selects. Stable labels (such as upload date) and a radio grid need an API/data field, so they were not done. — dosyalar: `src/components/host/AccessibilityPanel.tsx`

## F276 — Select değişimi anında sunucuya yazıyor; Windows'ta ok tuşuyla gezinmek doğrulamayı düşürüyor / sepet adedini değiştiriyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | High                                             |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:221` |
| Diğer konumlar      | `src/app/cart/page.tsx:174`                      |
| Kullanıcılar        | ev sahibi, misafir                               |
| Prensip             | robustness · predictability (hata önleme)        |
| Sezgisel madde      | H5 — Hata önleme                                 |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | lens:a11y                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)                    |

**Kanıt:** AccessibilityPanel.tsx:218-221 `<select id={`a11y-evidence-${feature.id}`} value={feature.evidencePhotoId ?? ""} onChange={(e) => void setEvidence(feature, e.target.value)}` her değişimde `PATCH .../accessibility/{id}` (125-133); dosya başı 25-26: 'Kanıt ya da kod değişince doğrulama DB tetiğiyle düşer'. Windows tarayıcılarında kapalı select üzerinde her Ok tuşu `change` tetikler. cart/page.tsx:170-174 `onChange={(e) => void patch(item, { quantity: Number(e.target.value) })}` aynı şekilde ilk ok basışında yeniden fiyatlayıp select'i `disabled` ediyor.

**Etki:** Ev sahibi (masaüstü, klavye): doğrulanmış bir erişilebilirlik özelliğinin kanıt listesini ok tuşuyla gezerken kanıt değişir, 'Doğrulanmış' rozeti yayından düşer ve özellik admin kuyruğuna geri döner. Misafir: grup sepetinde oda adedi istemeden değişir, toplam değişir ve odak kaybolur.

**Önerilen aksiyon:** Değeri yerel state'te tutup satıra 'Kanıtı kaydet' düğmesi ekleyin; doğrulanmış özellikte değişiklik öncesi 'Doğrulama düşecek' uyarısı gösterin. Sepette adedi ayrı 'Güncelle' düğmesiyle ya da onBlur'da (değer değiştiyse) gönderin.

**Yapılan düzeltme:** The host side is fixed the same way as F14. The cart quantity select in cart/page.tsx is outside this package and is written to crossOwner. — dosyalar: `src/components/host/AccessibilityPanel.tsx`

## F277 — Depozito 'Kaldır' onaysız; önceki tutar da siliniyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | High                                          |
| Durum               | Aday                                          |
| Konum               | `src/components/host/DepositSettings.tsx:152` |
| Kullanıcılar        | ev sahibi                                     |
| Prensip             | robustness · recoverability                   |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü             |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:host                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)                 |

**Kanıt:** DepositSettings.tsx:152-154 '<Button variant="secondary" disabled={busy} onClick={() => void put(null)}>{t("remove")}</Button>'; L104 'if (amountMinor === null) setValue("")' alanı da temizler; mesaj yalnız 'Depozito kaldırıldı.' (L105), geri al yok.

**Etki:** Yanlış tıklayan host sonraki rezervasyonları hasar güvencesiz bırakır; önceki tutar ekranda kalmadığından geri yazmak için hatırlaması gerekir.

**Önerilen aksiyon:** Onay metni: '{scope} depozitosu (₺1.000,00) kaldırılacak; yeni rezervasyonlarda provizyon alınmaz.' veya Status içinde önceki amountMinor ile PUT yapan 'Geri al' düğmesi; düğme adı 'Depozitoyu kaldır' + sr-only scope.

**Yapılan düzeltme:** Removing a deposit now asks first with a danger dialog that shows the scope and the current amount and explains that future bookings will not hold an amount on the card. The button gets aria-label 'X depozitosunu kaldır'. The message after removal also shows the old amount ('… ({amount}) kaldırıldı.') so the host can enter it again. Save and remove buttons use busy (no double submit) and min-h-[44px]. — dosyalar: `src/components/host/DepositSettings.tsx`

## F278 — Ev sahibi paneli tek, çok uzun sayfa; sık kullanılan rezervasyonlar en altta

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | High                                                                           |
| Durum               | Aday                                                                           |
| Konum               | `src/components/host/HostDashboard.tsx:120`                                    |
| Diğer konumlar      | `src/app/host/page.tsx:16-17`, `src/components/host/HostDashboard.tsx:308-325` |
| Kullanıcılar        | ev sahibi                                                                      |
| Prensip             | robustness · task conformance — Hick yasası                                    |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                                   |
| Renk/tema           | Hayır                                                                          |
| Efor                | L                                                                              |
| Kaynak denetçiler   | lens:copy                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostA)                                                  |

**Kanıt:** host/page.tsx:16-17 önce PartyRiskPanel, sonra HostDashboard. HostDashboard.tsx:120-124 her mülk için PropertyPanel (308-325: düzenleme formu + odalar + oda ekleme formu + toplu takvim formu + fotoğraf + AI metin + depozito), ardından tüm mülkler için PromotionsPanel ve AccessibilityPanel; misafir mesajlarına giden 'Rezervasyonlar' tablosu en sonda (126-185). Sekme, bölüm menüsü veya mülk seçici yok; gelir/ödeme/çözüm merkezi yalnız üstte metin bağlantıları (89-110).

**Etki:** Birden çok ilanı olan ev sahibi rezervasyon ve mesajlara ulaşmak için onlarca form geçer; yanlış mülkün formunu düzenleme riski artar.

**Önerilen aksiyon:** Paneli sekmelere bölün: 'Rezervasyonlar ve mesajlar' (varsayılan), 'İlanlar' (mülk seçici + tek mülk formu), 'Takvim ve fiyat', 'Promosyonlar', 'Erişilebilirlik', 'Ödemeler'; her mülk kartında alt bölümleri <details> ile daraltın.

**Yapılan düzeltme:** The Bookings card moved to the top of the dashboard, and an in-page section nav was added. Property cards are collapsible with <details> (only the first is open) and can be filtered by title. — dosyalar: `src/components/host/HostDashboard.tsx`

## F279 — Tek uç hatası tüm paneli kilitliyor; Rezervasyonlar sonsuz 'Yükleniyor…'; yeniden dene yok

| Alan                | Değer                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                     |
| Durum               | Aday                                                                                                                                     |
| Konum               | `src/components/host/HostDashboard.tsx:127`                                                                                              |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx:149`, `src/components/host/DepositSettings.tsx:41`, `src/components/host/PartyRiskPanel.tsx:32` |
| Kullanıcılar        | ev sahibi, admin                                                                                                                         |
| Prensip             | robustness · recoverability                                                                                                              |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                    |
| Efor                | S                                                                                                                                        |
| Kaynak denetçiler   | area:host                                                                                                                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostA)                                                                                                     |

**Kanıt:** HostDashboard.tsx:75-80 'Promise.all([apiFetch("/api/host/properties"), apiFetch("/api/host/bookings")])' — biri hata verirse ikisi de null; L127-128 'bookings === null ? <p>{t("bookings.loading")}</p>' hata durumunda da 'Yükleniyor…' gösterir (üstte L111 hata metniyle çelişir). L83 'const load = reload' arayüze bağlı değil; PromotionsPanel.tsx:149, DepositSettings.tsx:41, PartyRiskPanel.tsx:32 de yalnız hata metni gösterir.

**Etki:** Rezervasyon servisi geçici olarak düştüğünde host hiçbir mülkü düzenleyemez; ekranda aynı anda hata ve 'Yükleniyor…' görür; tek çıkış tarayıcıyı yenilemektir.

**Önerilen aksiyon:** İki ayrı useLoader veya Promise.allSettled; bookings kartında hata varsa 'Rezervasyonlar yüklenemedi.' + '<Button onClick={reload}>Yeniden dene</Button>'; tüm panellerde Status yanına aynı yeniden dene düğmesi.

**Yapılan düzeltme:** Properties and bookings now load with two separate useLoader calls, so one endpoint failing no longer blocks the other. The bookings card shows 'Rezervasyonlar yüklenemedi.' plus a 'Yeniden dene' button instead of an endless 'Yükleniyor…'. The properties error and the photo list error also have a retry button. PromotionsPanel, DepositSettings and PartyRiskPanel belong to other owners. — dosyalar: `src/components/host/HostDashboard.tsx`

## F280 — Ev sahibinin mobil mesaj görevi: rezervasyon tablosu en altta, 'Mesajlar' bağlantısı yatay kaydırmanın arkasında

| Alan                | Değer                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                           |
| Durum               | Aday                                                                                                           |
| Konum               | `src/components/host/HostDashboard.tsx:175`                                                                    |
| Diğer konumlar      | `src/app/host/page.tsx:15`, `src/components/host/HostDashboard.tsx:132`, `src/components/layout/Header.tsx:19` |
| Kullanıcılar        | ev sahibi                                                                                                      |
| Prensip             | robustness · task conformance                                                                                  |
| Sezgisel madde      | H7 — Esneklik/verim                                                                                            |
| Renk/tema           | Hayır                                                                                                          |
| Efor                | M                                                                                                              |
| Kaynak denetçiler   | lens:mobile                                                                                                    |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostA)                                                                           |

**Kanıt:** host/page.tsx:15-18 önce PartyRiskPanel'i, sonra HostDashboard'u gösteriyor. HostDashboard.tsx:120-124 her mülk için bir PropertyPanel (düzenleme formu, oda ekleme, toplu takvim, fotoğraf, ilan metni, depozito), ardından PromotionsPanel ve AccessibilityPanel render ediyor. Rezervasyonlar kartı (:126) en sonda. Tablo :132-133 `overflow-x-auto` ve `min-w-full` ile 7 sütunlu, 'Mesajlar' bağlantısı (:169-177) son sütunda. Header nav'ında (Header.tsx:19-30) mesaj ya da gelen kutusu girişi yok.

**Etki:** Kullanıcı modeline göre ev sahibi misafir mesajlarını telefondan yanıtlıyor. 360px'te tüm mülk formlarını geçip tabloya inmesi, sonra tabloyu sağa kaydırıp 'Mesajlar'ı bulması gerekiyor. Yeni mesaj geldiğine dair bir gösterge de yok.

**Önerilen aksiyon:** md altında rezervasyonları kart listesi olarak göster: mülk, tarih, durum rozeti ve tam genişlik 'Mesajlar' düğmesi (≥44px). 'Rezervasyonlar' kartını panelin en üstüne ya da ayrı bir sekmeye veya rotaya (`/host/bookings`) taşı. Okunmamış mesaj sayısı rozeti ekle ve HOST rolü için Header'a 'Mesajlar' girişi koy.

**Yapılan düzeltme:** Bookings are now at the top of the page. Below md they render as a card list with a full-width, 44px 'Mesajlar' link (sr-only property name). Unread-message badges and a 'Mesajlar' entry in the Header were not done: they need a backend unread count, and Header.tsx belongs to another owner. — dosyalar: `src/components/host/HostDashboard.tsx`

## F281 — Doğrulama hataları alana bağlanmıyor; yalnız genel 'Doğrulama hatası' görünüyor

| Alan                | Değer                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                              |
| Durum               | Aday                                                                                                                                                                                                                                                              |
| Konum               | `src/components/host/HostDashboard.tsx:222`                                                                                                                                                                                                                       |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:357`, `src/components/host/HostDashboard.tsx:438`, `src/components/host/HostDashboard.tsx:454`, `src/components/host/PromotionsPanel.tsx:112`, `src/components/host/DepositSettings.tsx:118`, `src/lib/http/errors.ts:152` |
| Kullanıcılar        | ev sahibi, admin                                                                                                                                                                                                                                                  |
| Prensip             | robustness · recoverability                                                                                                                                                                                                                                       |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                               |
| WCAG                | 3.3.1                                                                                                                                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                             |
| Efor                | M                                                                                                                                                                                                                                                                 |
| Kaynak denetçiler   | area:host                                                                                                                                                                                                                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostA)                                                                                                                                                                                                                                     |

**Kanıt:** HostDashboard.tsx:222 'setStatus({ error: errorMessage(err) })' (aynısı L357, L454; PromotionsPanel.tsx:112). ZodError yanıtı src/lib/http/errors.ts:152-156 '{ error: "Doğrulama hatası", code: "VALIDATION_ERROR", details: error.flatten() }'; ApiError.details (api-client.ts:44-51) hiçbir host bileşeninde okunmuyor. ui.tsx:47-69 Field 'error' prop'u (aria-invalid + aria-describedby) bu alanın hiçbir dosyasında kullanılmıyor; istemci hataları da (DepositSettings.tsx:118 invalidAmount, :122 tooHigh; HostDashboard.tsx:438 noChange) yalnız alt Status'ta.

**Etki:** Host 'Doğrulama hatası' görür ama hangi alanın (ör. açıklama 10 karakterden kısa, oda adı boşluk) hatalı olduğunu bilemez; partial okuryazar kullanıcı deneme-yanılmaya düşer; ekran okuyucu kullanıcısı hatalı alanı bulamaz, odak taşınmaz.

**Önerilen aksiyon:** ApiError.details.fieldErrors'ı alan adlarına eşleyip ilgili <Field error={...}>'a ver (aria-invalid ve aria-describedby otomatik bağlanır); ilk hatalı alana focus(); Status'ta '2 alanda hata var' özeti. İstemci tarafı invalidAmount/tooHigh/noChange da Field error ile ilgili input'a bağlansın.

**Yapılan düzeltme:** ApiError.details.fieldErrors is mapped to the matching <Field error> in PropertyPanel, AddRoomForm and CreatePropertyForm, which gives aria-invalid and aria-describedby. Focus moves to the first invalid field, and Status shows a summary such as 'N alanda sorun var'. The client-side invalid-amount check and calendar noChange are now Field errors on the price field (with focus). The field error text is a localized generic message ('Bu alanı kontrol edin.') because the server's zod messages are in English. DepositSettings belongs to another owner. — dosyalar: `src/components/host/HostDashboard.tsx`

## F282 — 'Yayında' etiketi aramada görünmeyen ilan için gösteriliyor; sonraki adım söylenmiyor

| Alan                | Değer                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                       |
| Durum               | Aday                                                                                       |
| Konum               | `src/components/host/HostDashboard.tsx:233`                                                |
| Diğer konumlar      | `src/lib/compliance/listing.ts:14`, `messages/tr/host.json:46`, `messages/tr/host.json:55` |
| Kullanıcılar        | ev sahibi                                                                                  |
| Prensip             | robustness · observability                                                                 |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                             |
| Renk/tema           | Hayır                                                                                      |
| Efor                | M                                                                                          |
| Kaynak denetçiler   | area:host                                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostA)                                                              |

**Kanıt:** HostDashboard.tsx:233-235 '{p.isActive ? t("property.published") : t("property.unpublished")} · {t("property.license")} <span>{t(`licenseStatus.${p.licenseStatus}`)}</span>'. Aramada görünürlük 'p.isActive && p.licenseStatus === "VERIFIED"' (src/lib/compliance/listing.ts:14-15; search/hybrid.ts:105). docs/img/host-extranet.png: 'Yayında · Belge: Doğrulama bekliyor' ve izin belgesi alanı boş, 'İlan yayında' işaretli. REJECTED → 'Kayıtta bulunamadı' (host.json licenseStatus) ne yapılacağını söylemiyor; onay kutusu etiketi 'İlan yayında' (L296-298) kaydedilmemiş seçimi de durum gibi gösteriyor.

**Etki:** Host ilanının satışta olduğunu sanır, oysa ilan aramada çıkmaz; rezervasyon ve gelir kaybı fark edilmeden sürer; çözümün belge numarası girmek olduğunu öğrenemez.

**Önerilen aksiyon:** Tek, türetilmiş görünürlük durumu göster: isActive+VERIFIED → 'Aramada görünüyor'; isActive+PENDING → 'Yayına işaretli; belge doğrulanana kadar aramada görünmüyor'; REJECTED → 'Belge kayıtta bulunamadı — numarayı düzeltip Kaydet'e basın' + '#prop-…-license' alanına bağlantı. Onay kutusu etiketini 'Kaydettiğimde yayına al' yap; yayından kaldırırken yaklaşan rezervasyon varsa uyarı metni göster.

**Yapılan düzeltme:** The card shows a single derived visibility sentence: live / pending / rejected (correct the number, then Save) / off. The checkbox label became 'Kaydettiğimde yayına al'. The data-testid=license-status span is kept. No warning about upcoming bookings when unpublishing (needs product decision). — dosyalar: `src/components/host/HostDashboard.tsx`

## F283 — Mülk 'Başlık' alanı yinelenen id yüzünden etiketsiz kalıyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | High                                        |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:240` |
| Diğer konumlar      | `src/components/ui/ui.tsx:99`               |
| Kullanıcılar        | ev sahibi, admin                            |
| Prensip             | accessibility · Name, Role, Value           |
| Sezgisel madde      | H14 — Erişilebilirlik                       |
| WCAG                | 4.1.2                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostA)               |

**Kanıt:** HostDashboard.tsx:229 '<Card title={p.title} id={pid}>' → ui.tsx:99 'const headingId = id ? `${id}-title`' ve ui.tsx:107 '<h2 id={headingId}>' = 'prop-<id>-title'. HostDashboard.tsx:238-240 '<Field ... id={`${pid}-title`}><input id={`${pid}-title`}' aynı id. Ağaç sırasında ilk eşleşen öğe h2 olduğundan <label for> etiketlenebilir bir kontrol bulamaz.

**Etki:** Ekran okuyucu kullanıcısı başlık alanında yalnız 'düzenlenebilir metin' duyar; 'Başlık' etiketine tıklamak alanı odaklamaz; sesli kontrol ('Başlık'a tıkla') çalışmaz. Section aria-labelledby de belirsiz hale gelir.

**Önerilen aksiyon:** Input id'sini benzersiz yap: id={`${pid}-name`} (Field id ile birlikte). Kalıcı çözüm: Card'da heading id'sini `${id}-heading` olarak değiştir, böylece hiçbir alan '-title' sonekiyle çakışmaz.

**Yapılan düzeltme:** Duplicate of F130: the input id was changed to `${pid}-name`. — dosyalar: `src/components/host/HostDashboard.tsx`

## F284 — Fiyat alanları type=number: ondalık/binlik belirsizliği, önizleme ve değişim onayı yok

| Alan                | Değer                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                   |
| Konum               | `src/components/host/HostDashboard.tsx:252`                                                                                                                                            |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:499`, `src/components/host/HostDashboard.tsx:399`, `src/components/host/PromotionsPanel.tsx:254`, `src/components/host/DepositSettings.tsx:140` |
| Kullanıcılar        | ev sahibi                                                                                                                                                                              |
| Prensip             | robustness · task conformance / hata önleme                                                                                                                                            |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                       |
| WCAG                | 3.3.4                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                  |
| Efor                | M                                                                                                                                                                                      |
| Kaynak denetçiler   | area:host                                                                                                                                                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostA)                                                                                                                                                          |

**Kanıt:** HostDashboard.tsx:250-258 taban fiyat '<input type="number" min={1} step="0.01"' + L214 'basePrice: Number(form.basePrice)'; takvim fiyatı L499-507 + L435 'body.price = Number(price)'; oda fiyat farkı L399-407. Aynı alanda DepositSettings.tsx:140 'inputMode="decimal"' metin girişi kullanıyor (tutarsız). Kaydetmeden önce eski/yeni fiyat ya da biçimli tutar önizlemesi yok; başarı 'Kaydedildi.' (L219) tutarı yankılamaz.

**Etki:** İngilizce yerelli tarayıcıda '1.500' 1,5 olarak kabul edilir (min=1 engellemez) → gecelik fiyat bin kat düşük yayınlanır; odaklı sayı alanı üzerinde fare tekerleği değeri sessizce değiştirir; host hatayı ancak özet satırını okursa görür, misafir yanlış fiyattan rezervasyon yapabilir.

**Önerilen aksiyon:** Tüm para alanlarını type='text' inputMode='decimal' + ortak, yerel-duyarlı parser'a geçir (belirsiz '1.500'ü reddet); alan altına aria-live önizleme 'Gecelik: ₺1.500,00 (önceki: ₺1.800,00)'; %50'den büyük değişimde onay ('Taban fiyat ₺1.800 → ₺18 olacak. Onaylıyor musunuz?').

**Yapılan düzeltme:** The base price, calendar price, room price modifier and new-listing price fields are now type=text with inputMode=decimal and are parsed by parseAmountToMinor, using the currency's decimal places. Hints show example formats. Below the base price an aria-live preview reads 'Yeni gecelik fiyat: X (şu anki: Y)'. If the price changes by more than ±50%, useConfirm asks for confirmation before saving. — dosyalar: `src/components/host/HostDashboard.tsx`

## F285 — Odalar düzenlenemiyor, silinemiyor ya da satışa kapatılamıyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | High                                            |
| Durum               | Aday                                            |
| Konum               | `src/components/host/HostDashboard.tsx:311`     |
| Diğer konumlar      | `src/app/api/properties/[id]/rooms/route.ts:37` |
| Kullanıcılar        | ev sahibi                                       |
| Prensip             | robustness · recoverability                     |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü               |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:host                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostA)            |

**Kanıt:** HostDashboard.tsx:311-316 '<li key={r.id}>{r.name} · {t("rooms.capacity", { count: r.capacity })} {r.available ? "" : t("rooms.closed")}</li>' — salt metin. PATCH /api/properties/[id]/rooms (src/app/api/properties/[id]/rooms/route.ts:37-49, updateRoom) mevcut ama arayüzde çağrılmıyor.

**Etki:** Yanlış ad/kapasite/fiyat farkıyla eklenen oda düzeltilemez; misafire hatalı kapasite gösterilir (aşırı doluluk riski); çift gönderimle oluşan kopya kalır.

**Önerilen aksiyon:** Her <li> için 'Düzenle' (satır içi form: ad, kapasite, yatak tipi, fiyat farkı → PATCH) ve 'Satışa kapat/aç' düğmeleri; düğmelere sr-only oda adı ('Düzenle: Deluxe').

**Yapılan düzeltme:** Added a RoomList component. Each room has a 'Satışa kapat/aç' button (sr-only room name, per-row pending state, Status) that calls PATCH /api/properties/[id]/rooms with {roomId, available}. A room edit form (name, capacity, bed type) was not added. — dosyalar: `src/components/host/HostDashboard.tsx`

## F286 — Oda ekleme, promosyon ekleme ve satır eylemleri çift gönderime açık

| Alan                | Değer                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                      |
| Durum               | Aday                                                                                                                                      |
| Konum               | `src/components/host/HostDashboard.tsx:410`                                                                                               |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx:347`, `src/components/host/PromotionsPanel.tsx:200`, `src/components/host/HostDashboard.tsx:523` |
| Kullanıcılar        | ev sahibi                                                                                                                                 |
| Prensip             | robustness · responsiveness / hata önleme                                                                                                 |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                     |
| Efor                | S                                                                                                                                         |
| Kaynak denetçiler   | area:host                                                                                                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostA)                                                                                                      |

**Kanıt:** AddRoomForm submit (HostDashboard.tsx:340-359) busy state'i yok; L410 '<Button type="submit" variant="secondary" className="w-full">' hiç devre dışı kalmaz. PromotionsPanel.tsx:85-114 submit ve L347 düğme aynı; toggle/remove (L116-140) da korumasız — ikinci DELETE 404 'Kayıt bulunamadı' ile başarı mesajını ezer. CalendarForm L523 aynı. Karşılaştırma: mülk Kaydet (L301-303) 'disabled={busy}' kullanıyor.

**Etki:** Yavaş mobil ağda iki kez dokunan host aynı odayı iki kez oluşturur; UI'da oda silme/düzenleme olmadığından kopya kalıcıdır ve misafire iki oda görünür; promosyonda iki kopya oluşur.

**Önerilen aksiyon:** Her forma 'const [busy, setBusy] = useState(false)'; 'disabled={busy}' + 'Ekleniyor…' etiketi; POST isteklerine 'Idempotency-Key: newIdempotencyKey()' (src/lib/ui/format.ts:33) başlığı; toggle/remove için satır başına pending id.

**Yapılan düzeltme:** Duplicate of F172: busy/disabled was added to AddRoomForm (L~1040) and CalendarForm. PromotionsPanel belongs to another owner (crossOwner). — dosyalar: `src/components/host/HostDashboard.tsx`

## F287 — Toplu takvim yalnız yazıyor; mevcut fiyat/müsaitlik görünmüyor

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | High                                                 |
| Durum               | Aday                                                 |
| Konum               | `src/components/host/HostDashboard.tsx:441`          |
| Diğer konumlar      | `src/app/api/rooms/[roomId]/availability/route.ts:7` |
| Kullanıcılar        | ev sahibi                                            |
| Prensip             | robustness · observability                           |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                       |
| Renk/tema           | Hayır                                                |
| Efor                | L                                                    |
| Kaynak denetçiler   | area:host                                            |
| **Düzeltme durumu** | **Atlandı** (paket: hostA)                           |

**Kanıt:** CalendarForm yalnız 'PUT /api/rooms/${roomId}/availability' gönderir (L441-445); oda için gecelik fiyat/açık-kapalı durumu hiçbir yerde okunmaz (availability route yalnız PUT: src/app/api/rooms/[roomId]/availability/route.ts:7). Geri bildirim yalnız sayılardan ibaret (L446-452).

**Etki:** Host hangi gecelerin satışa kapalı olduğunu ve hangi fiyattan satıldığını göremeden toplu değişiklik yapar; yanlış fiyatı/kapalı tarihi fark edemez, gelir kaybı yaşar.

**Önerilen aksiyon:** Seçili oda için 30/60 günlük takvim tablosu (her gün: fiyat, açık/kapalı, rezervasyonlu; <table> + th scope); formdaki from–to aralığını tabloda vurgula; güne tıklayınca from/to dolsun. Gerekirse host'a özel GET ucu ekle.

**Yapılan düzeltme:** needs backend/API change: there is no GET for room availability (the route only has PUT).

## F288 — AI ilan taslağında Türkçe paragrafın dili işaretlenmemiş

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | High                                        |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:572` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | accessibility · Language of Parts           |
| Sezgisel madde      | H14 — Erişilebilirlik                       |
| WCAG                | 3.1.2                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostA)               |

**Kanıt:** HostDashboard.tsx:572-574 '<p><span className="font-semibold">TR:</span> {draft.tr}</p>' lang yok; L575 '<p lang="en">' yalnız EN için var. <html lang={locale}> (src/app/layout.tsx:42) EN olduğunda Türkçe metin İngilizce sesle okunur. 'TR:'/'EN:' kısaltmaları açıklanmamış.

**Etki:** EN arayüzlü ekran okuyucu kullanıcısı Türkçe taslağı anlaşılmaz telaffuzla dinler.

**Önerilen aksiyon:** '<p lang="tr">' ekle; 'TR:'/'EN:' yerine 'Türkçe:'/'English:' metni veya '<abbr title="Türkçe">TR</abbr>'.

**Yapılan düzeltme:** In the AI draft, the text is wrapped in lang="tr" / lang="en" spans. The 'TR:'/'EN:' prefixes became localized 'Türkçe:'/'İngilizce:' labels. — dosyalar: `src/components/host/HostDashboard.tsx`

## F289 — Mevcut fotoğraflar listelenmiyor; kaldırma/sıralama/kapak seçimi yok

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | High                                                  |
| Durum               | Aday                                                  |
| Konum               | `src/components/host/HostDashboard.tsx:634`           |
| Diğer konumlar      | `src/app/api/host/properties/[id]/photos/route.ts:10` |
| Kullanıcılar        | ev sahibi                                             |
| Prensip             | robustness · observability                            |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                        |
| Renk/tema           | Hayır                                                 |
| Efor                | L                                                     |
| Kaynak denetçiler   | area:host                                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostA)                  |

**Kanıt:** PhotoUpload yalnız son yüklemenin sonucunu tutar: L595 'const [result, setResult] = useState<PhotoUploadResult | null>(null)'; 'Fotoğrafı kaldır' yalnız duplikat uyarısında (L663-673). GET /api/host/properties/[id]/photos → listPropertyPhotos (src/app/api/host/properties/[id]/photos/route.ts:10-21) var ama çağrılmıyor. Limit VISION_MAX_PHOTOS_PER_PROPERTY=40 (app-config.ts:474) gösterilmiyor.

**Etki:** Host ilanında hangi fotoğrafların yayında olduğunu göremez, eski/düşük kaliteli fotoğrafı kaldıramaz, kapak fotoğrafını seçemez; 40 limitine habersiz ulaşır.

**Önerilen aksiyon:** Bölümde GET ile küçük resim ızgarası (<ul> + <img alt>), her öğede kalite skoru, onaylı 'Kaldır', 'Kapak yap' ve sıra düğmeleri; '{n}/40 fotoğraf' sayacı.

**Yapılan düzeltme:** PhotoUpload now fetches existing photos with GET /api/host/properties/[id]/photos and shows a thumbnail grid (ul, img alt, quality score) with a photo count. Each photo has a 'Fotoğrafı kaldır' button behind a danger confirmation, and the duplicate-warning remove button also asks for confirmation. Cover-photo selection and reordering need backend support; the limit (40) is a server config value and is not shown. — dosyalar: `src/components/host/HostDashboard.tsx`

## F290 — 'Fotoğraflar' görsel başlık ama başlık değil; İlan metni bölümünün başlığı yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | High                                        |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:636` |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:557` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | accessibility · Info and Relationships      |
| Sezgisel madde      | H14 — Erişilebilirlik                       |
| WCAG                | 1.3.1                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostA)               |

**Kanıt:** HostDashboard.tsx:636-638 '<label htmlFor={inputId} className="text-base font-semibold text-gray-900">{t("photos.title")}</label>' — kardeş bölümler h3 kullanıyor (L309 'Odalar', L460 takvim, DepositSettings.tsx:39). ListingCopy (L557-560) başlıksız, yalnız düğme.

**Etki:** Ekran okuyucu kullanıcısı başlıklarla gezinirken Fotoğraflar ve İlan metni bölümlerini atlar; mülk kartının yapısı eksik algılanır.

**Önerilen aksiyon:** '<h3 className="text-base font-semibold">Fotoğraflar</h3>' + input için ayrı görünür etiket 'Fotoğraf yükle'; ListingCopy için '<h3>İlan metni önerisi (AI)</h3>'.

**Yapılan düzeltme:** Photos is now a <section aria-labelledby> with an h3, and the file input got its own visible label 'Fotoğraf yükle'. ListingCopy got an h3 'İlan metni önerisi'. — dosyalar: `src/components/host/HostDashboard.tsx`

## F291 — Ödeme engeli (kimlik doğrulaması gerekli, KYC reddedildi) için çözüm yolu ve bağlantı yok

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | High                                      |
| Durum               | Aday                                      |
| Konum               | `src/components/host/PayoutPanel.tsx:115` |
| Kullanıcılar        | ev sahibi                                 |
| Prensip             | robustness · recoverability               |
| Sezgisel madde      | H9 — Hata mesajları                       |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:host2                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)             |

**Kanıt:** PayoutPanel.tsx:115 `{acc.blockedReason ? t(`blocked.${acc.blockedReason}`) : t("account.active")}` → 'Kimlik doğrulaması gerekli'; 106 KYC 'Reddedildi' gerekçesiz; 151 `t("identityRequired")` text-xs dipnot olarak ekleniyor. Kimlik doğrulama bölümü var ama bağlantı verilmiyor: src/app/account/page.tsx:251 `<IdentityVerification .../>`, src/components/account/IdentityVerification.tsx:94 `<h2 id="kyc-title">`.

**Etki:** Ödemesi duran ev sahibi neden ödeme alamadığını görse de nerede/nasıl düzelteceğini bulamaz; birincil görev (ödeme almak) destek talebine dönüşür.

**Önerilen aksiyon:** blockedReason === "IDENTITY_UNVERIFIED" veya kycStatus NOT_STARTED/REJECTED iken kartın en üstünde role="status" kutusu: metin + `<Link href="/account#kyc-title">Kimliğinizi doğrulayın</Link>`; PAUSED için `/support` bağlantısı; PROVIDER_DISABLED için 'Durumu yenile' yönlendirmesi. identityRequired dipnotu bu kutuya taşınsın.

**Yapılan düzeltme:** PayoutPanel: a role=status box at the top of the account card. When identity is not verified, or KYC is NOT_STARTED or REJECTED, it explains why and links to '/account#kyc-title' ('Kimliğinizi doğrulayın'). For PAUSED it links to '/support'. For PROVIDER_DISABLED it points to the 'Durumu yenile / kaydet' button. When the box is shown, the identityRequired footnote is hidden. No color classes were changed. — dosyalar: `src/components/host/PayoutPanel.tsx`

## F292 — Hesap yokken politika metni rezerv oranını %0 gösteriyor (gerçek varsayılan %5)

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | High                                      |
| Durum               | Aday                                      |
| Konum               | `src/components/host/PayoutPanel.tsx:148` |
| Kullanıcılar        | ev sahibi                                 |
| Prensip             | learnability · predictability             |
| Sezgisel madde      | H13 — Feedforward                         |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:host2                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostB)      |

**Kanıt:** PayoutPanel.tsx:148 `reserve: pct(acc?.reservePercentBps ?? 0)`. Sunucu varsayılanı farklı: src/lib/payout/overview.ts:124 `account.reservePercentBps ?? cfg.PAYOUT_RESERVE_BPS`, src/lib/config/app-config.ts:186 `PAYOUT_RESERVE_BPS: int(500, …)`; tahsilat src/lib/payout/escrow.ts:184 de bu varsayılanı kullanıyor. policy nesnesinde rezerv oranı yok.

**Etki:** Ödeme hesabını henüz bağlamamış ev sahibi bağlanma kararını verirken 'payınızın %0'i rezervde tutulur' okur; bağladıktan sonra her ödemeden %5 kesildiğini görür. Para bilgisi yanlış feedforward.

**Önerilen aksiyon:** overview.ts policy nesnesine `reserveBps: cfg.PAYOUT_RESERVE_BPS` ekleyin; PayoutPanel'de `pct(acc?.reservePercentBps ?? data.policy.reserveBps)` kullanın.

**Yapılan düzeltme:** With no account, %0 is no longer shown. The reserve rate is acc.reservePercentBps ?? data.policy.reserveBps (an optional type field). If neither exists, a new policyNoReserve text without a rate is used. For the server to return policy.reserveBps (cfg.PAYOUT_RESERVE_BPS), overview.ts must change (written to crossOwner). Once that lands, the real rate shows automatically. — dosyalar: `src/components/host/PayoutPanel.tsx`

## F293 — Hata sonrası odak yönetimi yok; sonuç mesajları tetikleyen formdan uzakta

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                |
| Durum               | Aday                                                                                                                                                                                                                                                                                                                                                |
| Konum               | `src/components/host/PromotionsPanel.tsx:149`                                                                                                                                                                                                                                                                                                       |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:107`, `src/components/privacy/PrivacyCenter.tsx:58`, `src/components/booking/BookingActions.tsx:363-370`, `src/components/host/AccessibilityPanel.tsx:322`, `src/components/compliance/AppealForm.tsx:27-30`, `src/components/account/AgentMandates.tsx:60-63`, `src/components/ui/ui.tsx:81-85` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                |
| Prensip             | robustness · observability, responsiveness                                                                                                                                                                                                                                                                                                          |
| Sezgisel madde      | H12 — Feedback                                                                                                                                                                                                                                                                                                                                      |
| WCAG                | 3.3.1                                                                                                                                                                                                                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                               |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                   |
| Kaynak denetçiler   | lens:forms                                                                                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostB)                                                                                                                                                                                                                                                                                                                |

**Kanıt:** Kod tabanında `.focus()` yalnız diyaloglarda: src/components/account/ReauthDialog.tsx:43, src/components/booking/StepUpDialog.tsx:29; hiçbir form gönderim hatasında ilk hatalı alana odak taşınmıyor. Mesaj yerleşimi: src/components/host/PromotionsPanel.tsx:149 `<Status …/>` kartın en üstünde, form ise :223-351'de en altta; src/components/compliance/ComplianceDashboard.tsx:107 sayfa başında, formlar :110-201; src/components/privacy/PrivacyCenter.tsx:58 üstte; src/components/booking/BookingActions.tsx:363-370 ödeme hatası 'İptal et' düğmesinin de altında. Field hatası canlı bölge değil (ui.tsx:81-85 rolsüz <p>), bu yüzden AppealForm.tsx:28 ve AgentMandates.tsx:61 hataları ekran okuyucuya hiç duyurulmuyor.

**Etki:** Sayfanın altındaki promosyon formunu gönderen ev sahibi hatayı ekranın görünmeyen üst kısmında kaçırır ve 'kaydedildi' sanar; ekran okuyucu kullanıcısı AppealForm/AgentMandates'te gönder'e bastığında hiçbir şey olmamış gibi algılar.

**Önerilen aksiyon:** Ortak `useFormErrors()` yardımcı: submit hatasında ilk `[aria-invalid=true]` alana `focus()`, genel hata için form içinde, gönder düğmesinin hemen üstünde role="alert" özet ("2 alan düzeltilmeli" + alan bağlantıları). PromotionsPanel ve ComplianceDashboard'da her form için ayrı Status'ı ilgili <form> içine taşı; liste eylemlerinin mesajını satırın yanına koy.

**Yapılan düzeltme:** PromotionsPanel: the form result has its own Status (formStatus), now inside the form below the submit button. The top Status only shows list-action results. The submit button gets busy so it cannot be sent twice. The AccessibilityPanel Status was already next to the form. The shared useFormErrors helper and the other files (ComplianceDashboard, PrivacyCenter, BookingActions, AppealForm, AgentMandates, ui.tsx Field) are outside this package. — dosyalar: `src/components/host/PromotionsPanel.tsx`

## F294 — Promosyonda %100'e kadar indirim için koruma ve fiyat önizlemesi yok

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                        |
| Durum               | Aday                                                                                        |
| Konum               | `src/components/host/PromotionsPanel.tsx:258`                                               |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx:95`, `src/components/host/PromotionsPanel.tsx:334` |
| Kullanıcılar        | ev sahibi                                                                                   |
| Prensip             | robustness · task conformance / hata önleme                                                 |
| Sezgisel madde      | H5 — Hata önleme                                                                            |
| WCAG                | 3.3.4                                                                                       |
| Renk/tema           | Hayır                                                                                       |
| Efor                | M                                                                                           |
| Kaynak denetçiler   | area:host                                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)                                                               |

**Kanıt:** PromotionsPanel.tsx:257-258 'min={0.01} max={100}'; L95 'discountBps: Math.round(Number(form.percent) * 100)'; onay ya da örnek fiyat yok; L334-345 'stackable' ile indirimler birleşebilir ama toplam etki gösterilmez.

**Etki:** '10' yerine '100' yazan host ücretsiz konaklama yayınlar; birleşebilir promosyonlar toplam indirimi beklenmedik ölçüde artırır → doğrudan gelir kaybı.

**Önerilen aksiyon:** İndirim alanı altında aria-live önizleme: 'Örnek: ₺1.800/gece → ₺1.620' (seçili kapsamın taban fiyatıyla); %50 üzeri girişte uyarı metni ve gönderimde onay; stackable işaretliyse 'Diğer birleşebilir promosyonlarla toplam indirim %X'e çıkabilir' metni.

**Yapılan düzeltme:** An aria-live block under the discount field shows a preview: 'Örnek: gecelik 1.000 olan fiyat %X indirimle Y olur'. Above 50% a warning appears, and submitting asks for confirmation with a danger dialog. When 'stackable' is ticked, a note says the total discount can be higher. There is no base price for the chosen scope in the panel data, so the preview uses a sample price of 1,000 with no currency. — dosyalar: `src/components/host/PromotionsPanel.tsx`

## F295 — Pickup grafiğinin günlük değerleri ekran okuyucu ve klavye kullanıcısına kapalı

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | High                                          |
| Durum               | Aday                                          |
| Konum               | `src/components/host/RevenueDashboard.tsx:76` |
| Kullanıcılar        | ev sahibi, admin                              |
| Prensip             | accessibility · Non-text Content              |
| Sezgisel madde      | H14 — Erişilebilirlik                         |
| WCAG                | 1.1.1                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:host2                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)                 |

**Kanıt:** RevenueDashboard.tsx:76-85 `<svg role="img" aria-labelledby="pickup-title pickup-desc">` + desc yalnız `{count}` ve `{last}` veriyor. Günlük değerler yalnız 103 `<title>{`${f.date(p.date, "short")}: +${p.pickup}`}</title>` fare tooltip'inde; role="img" alt öğeleri sunumsal sayıldığından ve odaklanamadığından SR/klavye bu değerlere erişemez. Veri tablosu alternatifi yok.

**Etki:** Ekran okuyucu veya yalnız klavye kullanan ev sahibi hangi gün kaç oda-gece rezervasyon girdiğini öğrenemez; grafik yalnız fareyle üzerine gelen gören kullanıcıya bilgi verir.

**Önerilen aksiyon:** Grafiğin altına `<details><summary>{t("pickup.tableToggle")}</summary><table><caption>…</caption><thead>Tarih / O gün girilen / Toplam oda-gece</thead>…</table></details>` ekleyin (ya da sr-only tablo) ve svg'ye aria-describedby ile bağlayın.

**Yapılan düzeltme:** Same as F131. — dosyalar: `src/components/host/RevenueDashboard.tsx`

## F296 — Pickup çubukları ve eksen çizgisi beyaz zeminde 3:1 grafik kontrastını sağlamıyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | High                                           |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:101` |
| Kullanıcılar        | ev sahibi, admin                               |
| Prensip             | accessibility · Non-text Contrast              |
| Sezgisel madde      | H14 — Erişilebilirlik                          |
| WCAG                | 1.4.11                                         |
| Renk/tema           | Evet — onaylandı ve uygulandı                  |
| Efor                | S                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Düzeltildi (onaylı renk düzeltmesi)**        |

**Kanıt:** RevenueDashboard.tsx:101 `fill="#93c5fd"` beyaz kart üzerinde ≈1.9:1; 91 `stroke="#9ca3af"` eksen ≈2.5:1. Çubuklar veri taşıyor (günlük pickup).

**Etki:** Az gören ya da parlak ortamda (mobil) panele bakan ev sahibi günlük rezervasyon çubuklarını seçemez.

**Önerilen aksiyon:** Renk değişikliği gerektirir (kullanıcı kapsam dışı istedi): çubuk için mevcut paletten ≥3:1 bir ton kullanmak. Renk dışı tamamlayıcı: çubuklara 1px koyu kontur (stroke="#003580") ve yukarıdaki veri tablosu alternatifi.

## F297 — SVG grafik renkleri sabit hex; karanlık temada çizgi ve etiketler görünmez

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | High                                                   |
| Durum               | Aday                                                   |
| Konum               | `src/components/host/RevenueDashboard.tsx:107`         |
| Kullanıcılar        | ev sahibi, admin                                       |
| Prensip             | accessibility · Non-text Contrast / Contrast (Minimum) |
| Sezgisel madde      | H14 — Erişilebilirlik                                  |
| WCAG                | 1.4.11                                                 |
| Renk/tema           | Evet — onaylandı ve uygulandı                          |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:host2                                             |
| **Düzeltme durumu** | **Düzeltildi (onaylı renk düzeltmesi)**                |

**Kanıt:** RevenueDashboard.tsx:107 `stroke="#003580"`, 108/111/118 `fill="#374151"`. Karanlık temada kart zemini gray-900 olur (tailwind.config.ts:130 `"--bg-white": gray[900]`); src/styles/globals.css:22-53 yalnız `.text-[#003580]` gibi sınıfları yeniden eşliyor, SVG özniteliklerini değil. #003580 / #111827 ≈1.4:1, #374151 / #111827 ≈1.6:1.

**Etki:** Sistem teması koyu olan ev sahibi grafikte toplam oda-gece çizgisini ve tarih/maksimum etiketlerini göremez; grafik boş görünür.

**Önerilen aksiyon:** Renk/tema dokunuşu gerektirir: sabit hex yerine mevcut tema sınıfları (`className="stroke-brand"`, `className="fill-gray-700"`) veya `currentColor` kullanılarak var olan karanlık tema eşlemesine bağlanmalı; palet değişmez ama grafik renkleri tema token'larına taşınır.

## F298 — Öneri açıklaması ve katkı 'Ayrıntı' metinleri yalnız Türkçe; EN arayüzde dil işaretlenmemiş

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | High                                            |
| Durum               | Aday                                            |
| Konum               | `src/components/host/RevenueDashboard.tsx:204`  |
| Kullanıcılar        | ev sahibi, admin                                |
| Prensip             | accessibility · Language of Parts / consistency |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                     |
| WCAG                | 3.1.2                                           |
| Renk/tema           | Hayır                                           |
| Efor                | M                                               |
| Kaynak denetçiler   | area:host2                                      |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostB)            |

**Kanıt:** RevenueDashboard.tsx:194 `<td ...>{c.label}</td>` ve 204-205 `<p className="text-sm text-gray-800">{s.explanation} <LlmBadge .../></p>`. Etiketler sunucuda sabit TR: src/lib/pricing/revenue-engine.ts:95 `Doluluk %${...}`, 100 `Varışa ${leadDays} gün`, 105 `"Resmî tatil yok"`, 136-140 `"Tavan sınırı"/"Sınır içinde"`. LLM istemi src/lib/pricing/revenue.ts:333 'TEK Türkçe cümleyle açıkla'. Hiçbir öğede lang="tr" yok; açıklama ISO tarih (2026-10-12) içeriyor.

**Etki:** EN ikinci dil kullanan ev sahibi öneri gerekçesini okuyamaz; ekran okuyucu Türkçe metni İngilizce sesle okur ve anlaşılmaz hale getirir. Kararın (kabul/ret) dayandığı bilgi erişilemez.

**Önerilen aksiyon:** Motor `label` yerine yapılandırılmış alanlar döndürsün (occupancyPercent, leadDays, lastMinute, holidayName, events); istemci `t("factor.detail.occupancy", {percent})` gibi anahtarlarla çevirsin. Açıklama isteğin diliyle üretilsin (Accept-Language/locale parametresi) ya da en azından açıklama <p> ve detay <td> öğelerine locale !== "tr" iken lang="tr" eklensin; tarihi f.date ile biçimleyin.

**Yapılan düzeltme:** When the locale is not tr, the contribution detail td and the explanation span get lang="tr" (WCAG 3.1.2). Translating the text itself needs the engine to return structured fields and the LLM to write in the request's language (backend), so that was not done. — dosyalar: `src/components/host/RevenueDashboard.tsx`

## F299 — Fiyat önerisi kabulü canlı fiyatı tek tıkla değiştirip sabitliyor; onay ve geri al yok

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | High                                           |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:208` |
| Kullanıcılar        | ev sahibi, admin                               |
| Prensip             | robustness · recoverability                    |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü              |
| WCAG                | 3.3.4                                          |
| Renk/tema           | Hayır                                          |
| Efor                | M                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: hostB)           |

**Kanıt:** RevenueDashboard.tsx:208-210 `<Button onClick={() => decide("accept")} disabled={busy}>` doğrudan POST /accept. src/lib/pricing/revenue.ts:482-495 `priceMinor: price, priceOverride: true` yazıyor ve önceki fiyatı yalnız `priceExplanation.previous` içinde saklıyor; arayüzde geri alma uç noktası/düğmesi yok. 'Kabul et' ve 'Reddet' bitişik (207-214).

**Etki:** Ev sahibi yanlışlıkla 'Kabul et'e bastığında misafirlerin gördüğü gece fiyatı hemen değişir ve motor bu geceyi bir daha güncellemez; eski fiyata dönmek için takvimden elle fiyat girmesi gerekir (ve eski fiyatı hatırlaması).

**Önerilen aksiyon:** Kabulden sonra satır yerine 'Deluxe · 12.10.2026 fiyatı ₺1.200 → ₺1.350 olarak ayarlandı ve sabitlendi' mesajı ve 'Geri al' düğmesi gösterin; Geri al, saklanan `previous` değerini geri yazıp priceOverride'ı false yapan yeni bir POST /suggestions/{id}/revert uç noktasını çağırsın. En azından kabul düğmesinin yanına aria-describedby ile bağlı 'Kabul edilen fiyat sabitlenir' notu koyun.

**Yapılan düzeltme:** 'Kabul et' now opens a confirm dialog ('{room} · {date} fiyatı {from} → {to} olarak ayarlansın mı?'). A note saying the accepted price is locked sits below the buttons and is linked with aria-describedby. After a decision, the card's Status shows 'fiyatı {from} → {to} olarak ayarlandı ve sabitlendi. Önceki fiyat: {from}.' The buttons use busy and min-h-[44px]. 'Geri al' needs a new revert endpoint (backend), so it was not added. — dosyalar: `src/components/host/RevenueDashboard.tsx`

## F300 — Yükleniyor durumları ekran okuyucuya duyurulmuyor

| Alan                | Değer                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                       |
| Durum               | Aday                                                                                                                                       |
| Konum               | `src/components/host/RevenueDashboard.tsx:233`                                                                                             |
| Diğer konumlar      | `src/components/host/RevenueDashboard.tsx:322`, `src/components/host/PayoutPanel.tsx:71`, `src/components/host/AccessibilityPanel.tsx:167` |
| Kullanıcılar        | ev sahibi, admin                                                                                                                           |
| Prensip             | accessibility · Status Messages                                                                                                            |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                             |
| WCAG                | 4.1.3                                                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                      |
| Efor                | S                                                                                                                                          |
| Kaynak denetçiler   | area:host2                                                                                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: hostB)                                                                                                              |

**Kanıt:** RevenueDashboard.tsx:233 `if (!data) return <p className="text-sm text-gray-600">{t("loading")}</p>;` ve 322 aynı; PayoutPanel.tsx:71 aynı. Mülk seçimi `key={selected}` (341) ile PropertyRevenue'yu yeniden bağlıyor, değişim sessiz. AccessibilityPanel.tsx:167-171'de aria-live koşullu olarak içerikle birlikte mount ediliyor; bu durumda duyuru güvenilir değil.

**Etki:** Ekran okuyucu kullanan ev sahibi mülk seçimini değiştirince hiçbir şey duymaz; verinin yüklenip yüklenmediğini, yeni KPI'ların geldiğini anlamaz.

**Önerilen aksiyon:** Her panelde sürekli mount edilen `<div role="status" aria-live="polite" className="sr-only">` tutun; yüklemede 'Yükleniyor…', bitince '{mülk} verileri yüklendi' yazın. Yüklenen Card section'a `aria-busy={!data}` ekleyin.

**Yapılan düzeltme:** RevenueDashboard: an always-mounted sr-only role=status live region in the parent. It announces 'Yükleniyor…' when the property changes and '{title} verileri yüklendi.' once data arrives (through an onAnnounce callback). Loading paragraphs get aria-busy. PayoutPanel's loading text is in role=status with aria-busy. AccessibilityPanel's aria-live area is now an always-mounted role=status div. DepositSettings got the same. — dosyalar: `src/components/host/RevenueDashboard.tsx`, `src/components/host/PayoutPanel.tsx`, `src/components/host/AccessibilityPanel.tsx`, `src/components/host/DepositSettings.tsx`

## F445 — Fotoğraf yükleme kısıtları (biçim, 10 MB, ilan başı üst sınır) önceden söylenmiyor; bölüm başlık hiyerarşisinin dışında

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Medium                                                      |
| Durum               | Gözlemlendi (2 kaynak birleşti)                             |
| Konum               | `src/components/host/HostDashboard.tsx:636`                 |
| Diğer konumlar      | `src/lib/vision/quality.ts`, `src/lib/config/app-config.ts` |
| Kullanıcılar        | ev sahibi                                                   |
| Prensip             | learnability · Learnability: öngörülebilirlik (feedforward) |
| Sezgisel madde      | H13 — Feedforward                                           |
| WCAG                | 3.3.2 Labels or Instructions (A), 1.3.1 (A)                 |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | runtime:host, area:host                                     |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p079)                      |

**Kanıt:** Probe p4 (mock): fotoğraf bloğunun metni yalnızca 'Fotoğraflar'. input için accept='image/jpeg,image/png,image/webp,image/avif' ve aria-describedby=null. Boyut ve adet sınırı hiçbir yerde yazmıyor. Sunucu 10 MB sınırı (app-config.ts:472, 'Fotoğraf çok büyük'/'Dosya çok büyük') ve VISION_MAX_PHOTOS_PER_PROPERTY ('Bu ilan için fotoğraf sınırına ulaşıldı', photo-service.ts:112) uyguluyor. .txt yüklemesi 'Görsel okunamadı' mesajını gösterdi. Dosya adı yankılanmıyor ve input temizleniyor. 'Fotoğraflar' bir <label> (h3 değil), bu yüzden Odalar, Toplu takvim ve Hasar depozitosu h3'leri arasında başlık listesinde görünmüyor (tarama headings listesinde yok).

**Etki:** Ev sahibi büyük bir telefon fotoğrafını yükleyip ancak sonra reddedildiğini öğreniyor. Hangi dosyanın reddedildiğini bilmiyor. Başlıklarla gezinen kullanıcı fotoğraf bölümünü bulamıyor.

**Önerilen aksiyon:** Input'a hint bağlayın: 'JPEG, PNG, WebP veya AVIF; en fazla 10 MB; ilan başına en fazla N fotoğraf (şu an X/N)'. Hata mesajında dosya adını ve sınırı belirtin. Bölümü h3 'Fotoğraflar' altına alın, dosya düğmesini ayrı bir label ile adlandırın.

**Yapılan düzeltme:** The 'Fotoğraflar' h3 was already in place. The upload input now sits in a Field with its own label and a hint saying 'JPEG, PNG, WebP veya AVIF; en fazla {size} MB', and once the API returns limits the hint also shows the photo count against the per-listing maximum. Wrong file types and files over the limit are now rejected in the browser before uploading, success and error messages name the file, and the input is disabled when the limit is reached. The count part only appears after the photos route returns `limits` (crossOwner).

## F446 — Promosyon ve erişilebilirlik özelliği 'Sil' işlemi onaysız ve geri alınamaz

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                      |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                             |
| Konum               | `src/components/host/PromotionsPanel.tsx:209`                                               |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx`, `src/components/host/PromotionsPanel.tsx:129` |
| Kullanıcılar        | ev sahibi                                                                                   |
| Prensip             | robustness · Robustness: kurtarılabilirlik (geri alma)                                      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                           |
| Renk/tema           | Hayır                                                                                       |
| Efor                | S                                                                                           |
| Kaynak denetçiler   | runtime:host, area:host                                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p086)                                                             |

**Kanıt:** Probe p3 (mock): ilk promosyon satırındaki 'Sil' tıklanınca hemen DELETE /api/host/promotions/cpromo1 gitti, dialog=false. 'Durdur' (45x24) ile 'Sil' (24x24) arasında yalnızca 12 px boşluk var (space-x-3). AccessibilityPanel.tsx:242-248'deki kırmızı 'Sil' de remove()'u doğrudan çağırıyor (görüntü runtime/crops/host/probe-a11y-panel.png). Sonrasında yalnızca 'Promosyon silindi.' veya 'Özellik silindi.' metni çıkıyor, geri alma yok.

**Etki:** Yanlışlıkla 'Durdur' yerine 'Sil'e basılırsa promosyon kalıcı olarak gidiyor. Silinen erişilebilirlik özelliğinin doğrulanmış durumu kayboluyor ve yeniden beyan ile admin incelemesi gerekiyor.

**Önerilen aksiyon:** Silmeden önce onay isteyin ('"Hoş geldin kuponu" silinsin mi? Kullanılmışsa durdurulur.'), tercihen satır içi onay olarak. Ya da 5 saniyelik 'Geri al' toast'u gösterin. Durdur ve Sil'i görsel olarak ayırın, Sil'i bir ⋯ menüsüne alın.

**Yapılan düzeltme:** Clicking 'Sil' now opens the shared ConfirmDialog (useConfirm, danger tone, so Cancel has focus). The dialog title names the promotion: '«{name}» silinsin mi?' with the confirm button 'Promosyonu sil'. 'Sil' now sits 32px away from the other row actions (flex gap-x-4 plus ml-4), and every row action includes the promotion name as sr-only text. I did not add an undo toast or a '⋯' menu because the confirmation covers the risk.

## F523 — Depozito tutarı: sayfadaki Türkçe biçim ('1.500,50') reddediliyor; hata mesajı alana bağlı değil

| Alan                | Değer                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Severity            | Medium                                                                 |
| Durum               | Gözlemlendi                                                            |
| Konum               | `src/components/host/DepositSettings.tsx:143`                          |
| Kullanıcılar        | ev sahibi                                                              |
| Prensip             | robustness · Robustness: hata önleme ve anlaşılır hata mesajı          |
| Sezgisel madde      | H9 — Hata mesajları                                                    |
| WCAG                | 3.3.1 Error Identification (A), 3.3.3 Error Suggestion (AA), 1.3.1 (A) |
| Renk/tema           | Hayır                                                                  |
| Efor                | S                                                                      |
| Kaynak denetçiler   | runtime:host                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p083)                                        |

**Kanıt:** Probe p4 (mock): '1.500,50' ve 'abc' girişlerinde validity=false oldu ve yalnızca tarayıcının genel 'istenen biçimle eşleşin' baloncuğu çıktı, aria-invalid=null. Oysa aynı kart tutarları '₺50.000,00' biçiminde gösteriyor. '0' için 'Geçerli, sıfırdan büyük bir tutar girin.', '60000' için 'Tutar üst sınırı aşıyor (en fazla ₺50.000,00).' metni alanın altındaki Status'ta göründü. Bu metin input'a aria-describedby ile bağlı değil (describedby yalnızca …-hint), aria-invalid=null ve odak 'Kaydet'te kaldı. Boş alanda Kaydet disabled (opacity .6) ve nedeni açıklanmıyor.

**Etki:** Ev sahibi tutarı ekranda gördüğü biçimde yazınca neden reddedildiğini anlamıyor. Ekran okuyucu kullanıcısı hata metnini alanla ilişkilendiremiyor.

**Önerilen aksiyon:** pattern'ı kaldırın. parseMajorInput nokta binlik ayracını ve virgül ondalığını kabul etsin ('1.500,50' → 150050). Hataları Field error prop'u ile gösterin (aria-invalid + describedby) ve odağı input'a döndürün. Hint'e 'ör. 1500 veya 1.500,50' örneği ekleyin.

**Yapılan düzeltme:** Most of this was already in the code: the pattern is gone, parseAmountToMinor accepts '1.500,50', errors go through Field error (aria-invalid plus describedby), focus returns to the input, and the hint shows the example. What was left was the disabled Save button on an empty field. Save is no longer disabled, and pressing it with an empty field now shows the existing invalidAmount error on the field and moves focus to the input.

## F524 — Mobilde rezervasyon, promosyon ve parti riski tablolarının kritik sütunları işaretsiz yatay kaydırmanın arkasında

| Alan                | Değer                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Severity            | Medium                                                                              |
| Durum               | Gözlemlendi                                                                         |
| Konum               | `src/components/host/HostDashboard.tsx:132`                                         |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx`, `src/components/host/PartyRiskPanel.tsx` |
| Kullanıcılar        | ev sahibi                                                                           |
| Prensip             | robustness · Robustness: gözlemlenebilirlik (observability / browsability)          |
| Sezgisel madde      | H11 — Affordance                                                                    |
| WCAG                | 1.4.10 Reflow (AA) istisnası tablolar için geçerli; sorun burada keşfedilebilirlik  |
| Renk/tema           | Hayır                                                                               |
| Efor                | M                                                                                   |
| Kaynak denetçiler   | runtime:host                                                                        |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p079)                                                    |

**Kanıt:** Probe p5 (390x844, mock): Rezervasyonlar tablosunda clientW=316, scrollW=550. 'Tutar', 'Durum', 'Mesajlar' sütunları görünür alanın dışında. Promosyonlar: scrollW=526, 'Durum' ve 'İşlemler' (Durdur/Sil) dışarıda. Parti riski: 'Skor' ve 'Gerekçeler' dışarıda. Gerçek mobil görüntüde (crops/host/m-host-b2.png, m-host-b3.png) tablo 'Misafir' sütununda kesiliyor. Kaydırma göstergesi, gölge ya da ipucu yok. Sarmalayıcıda tabindex/role/aria-label yok (scrollers[].tabindex=null).

**Etki:** Telefondaki ev sahibi rezervasyonun durumunu ve mesaj bağlantısını, promosyonu durdurma/silme düğmelerini ve parti riski skorunu görmüyor. Tablonun kaydırılabildiğini fark etmeyebilir.

**Önerilen aksiyon:** sm altında satırları kartlara dönüştürün (dl ile 'Durum: Onaylandı' gibi). Ya da ilk sütunu sticky yapın, sağ kenara kaydırma gölgesi ve 'Kaydır →' ipucu ekleyin. Sarmalayıcıya tabIndex=0, role='region' ve aria-label=caption verin. Eylem sütununu (Mesajlar, Durdur/Sil) ikinci sıraya alın.

**Yapılan düzeltme:** In HostDashboard the bookings table already turns into a card list on mobile (`md:hidden`), and the table wrapper already has role=region, aria-label and tabIndex=0, so no column is hidden on a phone. The promotions and party-risk tables are in other files; their fixes are passed on as crossOwner.

## F525 — Belge doğrulaması bekleyen ilan 'Yayında' görünüyor ama aramada çıkmıyor; puansız ilanda 'Puan 0.0'

| Alan                | Değer                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Severity            | Medium                                                                          |
| Durum               | Gözlemlendi                                                                     |
| Konum               | `src/components/host/HostDashboard.tsx:233`                                     |
| Diğer konumlar      | `src/lib/search/hybrid.ts`                                                      |
| Kullanıcılar        | ev sahibi                                                                       |
| Prensip             | learnability · Learnability: gözlemlenebilirlik (sistem durumunun doğru sunumu) |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                  |
| Renk/tema           | Hayır                                                                           |
| Efor                | S                                                                               |
| Kaynak denetçiler   | runtime:host                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p079)                                                 |

**Kanıt:** Gerçek görüntü crops/host/d-host-top.png (tarama 094): 'Kadıköy Moda Sahil Dairesi (belge bekliyor)' kartında 'Taban fiyat: ₺1.800,00 · Puan 0.0 · Yayında · Belge: Doğrulama bekliyor' yazıyor ve 'İlan yayında' kutusu işaretli. Arama yalnızca isActive=true AND licenseStatus='VERIFIED' ilanları getiriyor (hybrid.ts:105). Kod yorumu da aynı şeyi söylüyor (HostDashboard.tsx:234). Durum metni yalnızca isActive bayrağını yansıtıyor.

**Etki:** Ev sahibi ilanının satışta olduğunu sanıyor, oysa misafirler onu bulamıyor. Rezervasyon gelmemesinin nedenini anlamıyor.

**Önerilen aksiyon:** Etkin görünürlüğü hesaplayıp gösterin: isActive && VERIFIED ise 'Yayında', isActive && PENDING ise 'Belge onayı bekleniyor, aramada görünmüyor' uyarı rozeti ve gerekli adım. ratingAvg=0 ya da yorum yoksa 'Henüz puan yok' yazın.

**Yapılan düzeltme:** The visibility line built from isActive and licenseStatus was already there, saying a pending listing does not appear in search. I added 'Henüz puan yok' (property.noRating), shown instead of 'Puan 0.0' when ratingAvg is 0 or less.

## F526 — Oda kapasitesi gösterilmiyor: TR'de 'Daire · kişi', EN'de 'NaN guests'

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | Medium                                                                       |
| Durum               | Gözlemlendi                                                                  |
| Konum               | `src/components/host/HostDashboard.tsx:313`                                  |
| Diğer konumlar      | `src/lib/host/host-service.ts`                                               |
| Kullanıcılar        | ev sahibi                                                                    |
| Prensip             | robustness · Robustness: sistem durumunun doğru yansıtılması (observability) |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                               |
| Renk/tema           | Hayır                                                                        |
| Efor                | S                                                                            |
| Kaynak denetçiler   | runtime:host                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p079)                                              |

**Kanıt:** Gerçek ekran görüntüsü crops/host/d-host-b1.png (tarama 094): 'Standart Oda · kişi', 'Deluxe Boğaz Manzaralı · kişi', 'Süit · kişi'. crops/host/d-host-top.png: 'Daire · kişi'. Probe p4 TR: 'Standart Oda · kişi … Süit · kişi (kapalı)'. Probe p8 EN: 'Standart Oda · NaN guests'. Neden: UI r.capacity okuyor (HostDashboard.tsx:28, 313), API ise maxOccupancy döndürüyor (host-service.ts:401).

**Etki:** Ev sahibi odalarının kaç kişilik olduğunu panelde göremiyor. EN arayüzde 'NaN' görünmesi ürüne güveni düşürüyor. Kapasite hatası fark edilmeden kalabiliyor.

**Önerilen aksiyon:** HostRoom arayüzünü API sözleşmesine uydurun: maxOccupancy ve units. Satırda t('rooms.capacity',{count:r.maxOccupancy}) ve birim sayısını gösterin. Bu sözleşme için tip paylaşımı ya da bir zod şeması ekleyin ki kayma derlemede yakalansın.

**Yapılan düzeltme:** HostRoom now matches the API: `maxOccupancy` and `units` replace `capacity`. Each room row shows the capacity from maxOccupancy and the room count from the new rooms.units key, so the 'NaN guests' and empty 'kişi' text are gone. I did not add a shared type or zod schema, because that would mean editing host-service.

## F527 — Aynı adlı 80 form landmark'ı: her mülkte 'Oda ekle' ve 'Toplu takvim güncellemesi'

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | Medium                                                                |
| Durum               | Gözlemlendi                                                           |
| Konum               | `src/components/host/HostDashboard.tsx:365`                           |
| Kullanıcılar        | ev sahibi                                                             |
| Prensip             | accessibility · Robustness: gezinilebilirlik (browsability)           |
| Sezgisel madde      | H14 — Erişilebilirlik                                                 |
| WCAG                | 1.3.1 Info and Relationships (A) (axe landmark-unique, best practice) |
| Renk/tema           | Hayır                                                                 |
| Efor                | S                                                                     |
| Kaynak denetçiler   | runtime:host                                                          |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p079)                                       |

**Kanıt:** Tarama 094/095 axe landmark-unique: form[aria-label='Oda ekle'] ve form[aria-labelledby='cal-…-title']. Probe p1 (gerçek host verisi): formNames = {'Oda ekle':40, 'Toplu takvim güncellemesi':40, 'Yeni promosyon':1}. Probe p6 ARIA anlık görüntüsü (mock, 6 mülk): 'form "Oda ekle"' x6 ve 'form "Toplu takvim güncellemesi"' x6. Bölgeler mülk adıyla benzersiz, formlar değil. Kaynak: aria-label (HostDashboard.tsx:365) ve aria-labelledby (459).

**Etki:** Ekran okuyucu landmark listesinde yaklaşık 125 giriş var ve 80'i birbirinin aynısı. Hangi 'Oda ekle' formunun hangi ilana ait olduğu anlaşılmıyor, landmark gezintisi işe yaramaz hale geliyor.

**Önerilen aksiyon:** Form adlarına mülk adını ekleyin: aria-label={`${t('rooms.add.ariaLabel')} — ${p.title}`}. Ya da formlardan aria-label/aria-labelledby kaldırıp (adsız form landmark sayılmaz) alanları <fieldset><legend> ile gruplayın. Takvim formunda h3 id'sini mülk adını da içeren gizli bir metne bağlayın.

**Yapılan düzeltme:** The 'Oda ekle' form, the 'Toplu takvim güncellemesi' form and the photos section now take their names from aria-labelledby, which points at their own label or heading plus the property card's h2. Each landmark now carries the property title. The 'Oda ekle' label text lives in a `hidden` span, so it is not read twice.

## F528 — Toplu takvimde ters tarih aralığı ve geçmiş tarih engellenmiyor; 'Satışa kapat' önizleme ve onay olmadan uygulanıyor

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | Medium                                                           |
| Durum               | Gözlemlendi                                                      |
| Konum               | `src/components/host/HostDashboard.tsx:488`                      |
| Diğer konumlar      | `src/lib/host/host-service.ts`                                   |
| Kullanıcılar        | ev sahibi                                                        |
| Prensip             | robustness · Robustness: hata önleme / kurtarılabilirlik         |
| Sezgisel madde      | H5 — Hata önleme                                                 |
| WCAG                | 3.3.1 Error Identification (A), 3.3.4 Error Prevention (AA) ruhu |
| Renk/tema           | Hayır                                                            |
| Efor                | S                                                                |
| Kaynak denetçiler   | runtime:host                                                     |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p079)                           |

**Kanıt:** Probe p4 (mock): #cal-…-to için min=null, #cal-…-from için min=null. Başlangıç 2026-10-20, Bitiş 2026-10-10, Müsaitlik 'Satışa kapat' seçilip gönderildi ve istemci engellemedi: PUT /api/rooms/croom0a/availability {from:'2026-10-20',to:'2026-10-10',isAvailable:false}. Sunucunun gerçek mesajı 'Tarih aralığı 1–365 gece olmalı' (host-service.ts:310) Status'ta göründü, ama 'Bitiş başlangıçtan önce' demiyor ve #cal-…-to aria-invalid=null. 2025-01-01 gibi geçmiş başlangıç tarihi geçerli sayıldı. 365 gecelik stop-sell için onay ya da etkilenecek gece sayısının önizlemesi yok (kod 431-456).

**Etki:** Ev sahibi hatayı ancak gönderdikten sonra, sebebini anlamadan görüyor. Daha kritik olarak, yanlış oda veya tarih seçimiyle aylarca satışı tek tıkla kapatabilir ve fark edene kadar rezervasyon kaybeder.

**Önerilen aksiyon:** to alanına min={from}, from alanına min={bugün} verin. onChange'te bitiş başlangıçtan önceyse Field error ('Bitiş tarihi başlangıçtan sonra olmalı') gösterin. 'Satışa kapat' seçiliyse 'X oda için N gece satışa kapatılacak, rezervasyonlu geceler atlanır' onayı isteyin ve sonuç mesajına 'Geri al' ekleyin.

**Yapılan düzeltme:** In the calendar form the start date now has min=today and the end date has min=from. Inline errors (fromPast, toBeforeFrom, tooLong over 365 nights) set aria-invalid and block submit by moving focus to the field. The end date shows the selected night count as a hint. 'Satışa kapat' now asks for confirmation through useConfirm, naming the room, the date range and the night count. I did not add a 'Geri al' (undo) button, because the API does not return the previous state to restore.

## F529 — Parti riski uyarıları: ISO tarih, ölçeksiz skor, eylem bağlantısı yok

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | Medium                                                                    |
| Durum               | Gözlemlendi                                                               |
| Konum               | `src/components/host/PartyRiskPanel.tsx:63`                               |
| Kullanıcılar        | ev sahibi                                                                 |
| Prensip             | learnability · Learnability: tutarlılık ve görev uyumu (task conformance) |
| Sezgisel madde      | H7 — Esneklik/verim                                                       |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | runtime:host                                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p090)                                           |

**Kanıt:** Gerçek seed'de uyarı yok ('Yaklaşan rezervasyonlarınızda parti riski uyarısı yok.', tarama 094). Probe p6 (mock, API'nin gerçek biçimi: checkIn toISOString().slice(0,10), party-risk-service.ts:158): satır 'Londra Hyde Park Guesthouse | 2026-10-24 → 2026-10-25 | 8 | 72 | Tek gece, Kalabalık grup, Hafta sonu'. Diğer tablolar '24.10.2026' biçimini kullanıyor. Skor için ölçek ya da eşik verilmiyor ('72' neye göre?), değer kırmızı metin rgb(153,27,27). Kartta bağlantı/düğme sayısı 0, oysa giriş metni 'misafirle ev kurallarını teyit edin' diyor.

**Etki:** Ev sahibi riskin ne kadar ciddi olduğunu anlayamıyor ve önerilen eylemi (misafire mesaj) yapmak için rezervasyonu tablolarda elle arıyor.

**Önerilen aksiyon:** Tarihleri f.date(…,'short') ile biçimleyin. Skoru '72/100 (eşik 60)' olarak ya da 'Yüksek/Orta' etiketiyle gösterin. Her satıra 'Misafire mesaj gönder' (/host/messages/[bookingId]) bağlantısı ekleyin.

**Yapılan düzeltme:** Dates now go through f.date(...,'short') with an i18n range key ('{from} – {to}'), matching the booking table on the same page. The score shows as '{score}/100 · Yüksek' and the intro states the 0–100 scale. CONFIRMED rows get a 'Misafire mesaj gönder' link to /host/messages/{bookingId}; HELD rows say messaging opens once the booking is confirmed, because message-service only allows CONFIRMED/COMPLETED.

## F530 — Ödeme hesabı: alıcı banka/IBAN bilgisi yok, KYC veya kimlik gerektiğinde eylem yolu yok, 'Durumu yenile / kaydet' belirsiz

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | Medium                                                              |
| Durum               | Gözlemlendi                                                         |
| Konum               | `src/components/host/PayoutPanel.tsx:96`                            |
| Kullanıcılar        | ev sahibi                                                           |
| Prensip             | learnability · Learnability: gözlemlenebilirlik ve öngörülebilirlik |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                      |
| Renk/tema           | Hayır                                                               |
| Efor                | M                                                                   |
| Kaynak denetçiler   | runtime:host                                                        |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p084)                              |

**Kanıt:** Tarama 096/097 (gerçek): Ödeme hesabı kartında Sağlayıcı, Hesap doğrulaması, Ödeme takvimi ve Durum var. Paranın gideceği hesap (maskeli IBAN, son 4 hane) yok. Tek kontrol 'Ödeme takvimi: Değiştirme' select'i ve 'Durumu yenile / kaydet' düğmesi (crops/host/d-payouts-0.png). Probe p7 (mock, hesap yok): kartta 0 input var. 'Ödeme hesabını bağla' tıklanınca body {} ile POST gitti ve 'Ödeme hesabı güncellendi.' mesajı çıktı. Banka bilgisi istenmedi, odak body'ye düştü. Metinde 'payınızın %0'i 30 gün rezervde' yazıyor (hesap yokken reservePercentBps ?? 0, satır 148). 'Ödeme için kimlik doğrulaması gereklidir.' (identityRequired) ve blocked.IDENTITY_UNVERIFIED metinleri bir bağlantı ya da eylem içermiyor. Stripe sağlayıcısında onboarding bağlantısını işleyecek bir UI yok (host-account.ts:47-75).

**Etki:** Ev sahibi parasının hangi hesaba gideceğini doğrulayamıyor. Kimlik doğrulaması gerektiğinde ne yapacağını bilmiyor. Takvimi değiştirmek için 'yenile/kaydet' gibi iki anlamlı bir düğme kullanmak zorunda kalıyor. Talep edilen 'IBAN maskesi/hata metni' formu hiç yok.

**Önerilen aksiyon:** Bağlı hesabı 'TR** **** **** **** **12 34 (Ziraat)' gibi maskeli gösterin ve 'Banka hesabını değiştir' akışı ekleyin (IBAN alanı: inputmode=text, otomatik 4'lü gruplama, TR + 24 hane ve mod-97 kontrolü, alan bazında hata metni, autocomplete=off). Stripe için onboarding linkine yönlendirin. KYC veya kimlik eksikse doğrudan /account/verify gibi sayfaya bağlantı verin. 'Takvimi kaydet' ile 'Durumu yenile'yi ayrı düğmeler yapın. Hesap yokken rezerv oranını göstermeyin.

**Yapılan düzeltme:** Added a 'payout destination' row to the account card. It shows a masked account ('<bank> · son 4 hane 1234') when the server sends account.destination. Otherwise it shows a provider-specific fallback: the demo-account text for mock, 'managed in Stripe' for Stripe, or 'Ödeme hesabı yok' when not connected. A Stripe onboarding/manage link appears when an https account.onboardingUrl is present; both are new optional Overview fields. Refresh and save are now separate buttons. The connect button keeps its React slot, so focus stays on a button after connecting instead of falling to body. KYC links and the hidden reserve rate when no account were already in place. Not done in this file: an IBAN entry/change form (TR+24 digits, mod-97 check) needs a backend API and storage it can't get here (see crossOwner).

## F531 — Promosyon sunucu hatası genel 'Doğrulama hatası' olarak formun yüzlerce px üstünde gösteriliyor; istemci ve sunucu sınırları uyuşmuyor

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | Medium                                                           |
| Durum               | Gözlemlendi                                                      |
| Konum               | `src/components/host/PromotionsPanel.tsx:149`                    |
| Diğer konumlar      | `src/lib/http/errors.ts`, `src/lib/pricing/promotion-service.ts` |
| Kullanıcılar        | ev sahibi                                                        |
| Prensip             | robustness · Robustness: yanıt verirlik / hata kurtarma          |
| Sezgisel madde      | H9 — Hata mesajları                                              |
| WCAG                | 3.3.1 Error Identification (A), 3.3.3 Error Suggestion (AA)      |
| Renk/tema           | Hayır                                                            |
| Efor                | M                                                                |
| Kaynak denetçiler   | runtime:host                                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p086)                                  |

**Kanıt:** Probe p3 (/host, masaüstü, mock): Tür 'Uzun konaklama' ve 'En az gece'=400 girildi. İstemci geçerli saydı, çünkü max=730 (PromotionsPanel.tsx:272) ama sunucu minNights için max 365 uyguluyor (promotion-service.ts:38). POST gitti. Mock, sunucunun gerçek Zod yanıtını döndürdü ({error:'Doğrulama hatası'}, errors.ts:152-155). UI yalnızca 'Doğrulama hatası' gösterdi. Mesaj kartın en üstünde, tablonun üzerinde (alertTop=124) ve 'Promosyon ekle' düğmesinin 297 px yukarısında (2 satırlık listeyle). #promo-form-cond'da aria-invalid=null, odak düğmede kaldı. Görüntü: runtime/crops/host/probe-promo-servererr.png. Gerçek listede 4 satır olduğu için mesaj daha da uzakta kalıyor.

**Etki:** Ev sahibi hangi alanın neden reddedildiğini bilemiyor, mesajı çoğu zaman görmüyor bile. Promosyon oluşturulamıyor ve deneme-yanılma başlıyor.

**Önerilen aksiyon:** Status'u formun içine, submit düğmesinin yanına taşıyın. ApiError.details.fieldErrors'ı alanlara eşleyip Field error prop'u ile gösterin (aria-invalid + aria-describedby) ve ilk hatalı alana odaklanın. İstemci sınırlarını sunucuyla eşitleyin: minNights için max=365. Sunucuda Zod mesajlarını alan bazında Türkçe/EN yerelleştirin.

**Yapılan düzeltme:** Client limits now match the server: minNights max is 365 and usageLimit max is 1,000,000. ApiError VALIDATION_ERROR details.fieldErrors are mapped to form fields and shown through Field error, which sets aria-invalid and aria-describedby. Each error is a localized hint of the form 'Bu değer kabul edilmedi. 1 ile 365 arasında…'. A summary appears in the form Status next to the submit button and focusFirstInvalid moves focus to the first bad field. COUPON_CODE_TAKEN is mapped to the coupon field, and other errors go through useErrorText instead of err.message.

## F532 — Promosyon formunda geçerlilik tarih aralığı ve sabit tutarlı indirim yok (API ikisini de destekliyor)

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Medium                                                    |
| Durum               | Gözlemlendi                                               |
| Konum               | `src/components/host/PromotionsPanel.tsx:223`             |
| Diğer konumlar      | `src/lib/pricing/promotion-service.ts`                    |
| Kullanıcılar        | ev sahibi                                                 |
| Prensip             | flexibility · Flexibility: görev kapsamı / substitutivity |
| Sezgisel madde      | H7 — Esneklik/verim                                       |
| Renk/tema           | Hayır                                                     |
| Efor                | M                                                         |
| Kaynak denetçiler   | runtime:host                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p086)                           |

**Kanıt:** Probe p3: promo formundaki kontroller name, type, pct, cond, scope, prio, stack ve submit. Formda type=date alan sayısı 0. API şeması startsAt/endsAt ile 'endsAt > startsAt' kuralını içeriyor (promotion-service.ts:47-48, 66) ve discountMinor+currency de kabul ediyor (29-35). Liste sabit tutarlı bir kupon gösterirken ('Hoş geldin kuponu (150 TL)', İndirim ₺150,00, crops/host/d-host-b1.png), form kupon türünde bile yalnızca 'İndirim (%)' sunuyor (p3 e).

**Etki:** Ev sahibi 'yaz kampanyası 1 Haziran–31 Ağustos' gibi süreli bir promosyon tanımlayamıyor, promosyonu elle durdurmayı hatırlamak zorunda. Unutulan promosyon gelir kaybına yol açar. Sabit TL kupon da oluşturulamıyor.

**Önerilen aksiyon:** Forma 'Başlangıç' ve 'Bitiş' tarih alanları ekleyin (bitiş için min=başlangıç, hata Field error ile). Tabloya 'Geçerlilik' sütunu ekleyin. İndirim türü için yüzde/sabit tutar radyosu koyun, sabitte para birimi mülkten gelsin.

**Yapılan düzeltme:** Added optional start and end date fields. The end field has min set to the start date, the end day is inclusive (sent as the next local midnight), and the client checks the range and shows a Field error. The table has a new 'Geçerlilik' column (range, from, until or no end date). A 'Yüzde / Sabit tutar' radio group switches between the percent field and an amount field parsed with parseAmountToMinor. The currency comes from the selected listing, or from the shared currency when all listings use one; otherwise the scope field shows an error. The properties prop gained an optional `currency`, which HostDashboard already passes.

## F533 — Pickup grafiğinin eksen metni mobilde yaklaşık 5 px; y ekseninde birim yok

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Gözlemlendi                                       |
| Konum               | `src/components/host/RevenueDashboard.tsx:108`    |
| Kullanıcılar        | ev sahibi                                         |
| Prensip             | accessibility · Robustness: algılanabilirlik      |
| Sezgisel madde      | H14 — Erişilebilirlik                             |
| WCAG                | 1.4.4 Resize Text (AA) ile ilişkili okunabilirlik |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | runtime:host                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)                   |

**Kanıt:** Tarama 098/099 tinyText: 11px text '1', '11.09.2026', '10.10.2026'. Probe p5 (390x844): svg genişliği 316 px, fontSize=11 viewBox 640 içinde ölçeklenince efektif yazı 5.4 px ve metin kutusu 7 px yüksekliğinde (runtime/crops/host/probe-pickup-mobile.png, crops/host/m-revenue-0.png). Y ekseninde yalnızca maksimum sayı var ('1' / '10'), birim etiketi yok.

**Etki:** Mobilde tarih ve ölçek okunamıyor. Grafik yalnızca bir şekil olarak kalıyor.

**Önerilen aksiyon:** Eksen metinlerini SVG dışına HTML olarak koyun ya da vectorEffect ile sabit px boyut verin (ör. width'e göre viewBox ayarlayan responsive grafik). En az 12 px kullanın. Y eksenine 'oda-gece' birimini yazın.

**Yapılan düzeltme:** Moved all axis text out of the SVG into HTML text-xs (12px) rows. The chart now uses preserveAspectRatio="none" with fixed CSS heights and non-scaling strokes, so text no longer shrinks to about 5px on mobile. Each band has a unit label ('Dönemdeki toplam oda-gece (çizgi)', 'O gün girilen oda-gece (çubuk)') and a scale ('Ölçek 0–{max}').

## F534 — Fiyat önerisini kabul etmek onaysız ve geri bildirimsiz; odak kayboluyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Gözlemlendi                                                                   |
| Konum               | `src/components/host/RevenueDashboard.tsx:208`                                |
| Kullanıcılar        | ev sahibi                                                                     |
| Prensip             | robustness · Robustness: yanıt verirlik (responsiveness) ve kurtarılabilirlik |
| Sezgisel madde      | H12 — Feedback                                                                |
| WCAG                | 2.4.3 Focus Order (A), 4.1.3 Status Messages (AA)                             |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | runtime:host                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)                                               |

**Kanıt:** Probe p7 (mock): 'Kabul et' tıklanınca hemen POST /api/host/revenue/suggestions/csug1/accept gitti, onay penceresi açılmadı. Ardından kartın canlı bölgeleri boş kaldı (['','']) ve odak body'ye düştü. Kod: decide() başarılı olunca yalnızca onDecided()/reload çağırıyor ve mesaj yok (RevenueDashboard.tsx:143-154). Giriş metni 'Kabul ettiğiniz fiyat sabitlenir' diyor (görüntü runtime/crops/host/probe-suggestions.png).

**Etki:** Ev sahibi bir tarih için fiyatı kalıcı olarak değiştirdiğinden emin olamıyor. Öneri listeden kaybolunca neyin değiştiğini görmüyor ve geri alamıyor. Klavye ve ekran okuyucu kullanıcısı konumunu yitiriyor.

**Önerilen aksiyon:** Kabul sonrası Status'a '24.10.2026 Daire: ₺1.800 → ₺2.070 olarak sabitlendi. [Geri al]' yazın. Odağı bir sonraki önerinin başlığına ya da listeye taşıyın. Düğmeye bağlam ekleyin: aria-label='24.10.2026 Daire önerisini kabul et'.

**Yapılan düzeltme:** The confirm dialog and the Status message after a decision were already in place. Added: focus now moves to the next (or previous) suggestion's h3 title, or to the empty-state text, once the row disappears after reload. Both buttons now have sr-only room and date context in their accessible names. The accept and confirm texts no longer use '→' and now say how to undo (enter the old price in the calendar). A one-click 'Geri al' was not added because the server has no undo API.

## F535 — Gelir paneli jargonu açıklanmıyor (Pickup, ADR, RevPAR) ve pencereler birbirinden farklı

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Gözlemlendi                                                                   |
| Konum               | `src/components/host/RevenueDashboard.tsx:262`                                |
| Diğer konumlar      | `messages/tr/revenue.json`                                                    |
| Kullanıcılar        | ev sahibi                                                                     |
| Prensip             | learnability · Learnability: aşinalık (familiarity) ve gerçek dünya eşleşmesi |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                   |
| Renk/tema           | Hayır                                                                         |
| Efor                | S                                                                             |
| Kaynak denetçiler   | runtime:host                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)                                               |

**Kanıt:** Tarama 098/099: KPI başlıkları 'Doluluk %0.0 · ADR · RevPAR · Gelir', kart başlığı 'Pickup'. Tooltip, abbr ya da yardım yok (probe p7: #revenue-kpis içinde abbr/[title] sayısı 0). TR kataloğunda bile 'Pickup' çevrilmemiş (revenue.json pickup.title). KPI penceresi gelecek 30 gün (10.10.2026 – 09.11.2026), pickup penceresi geçmiş 30 gün (11.09.2026 – 10.10.2026), aradaki fark açıklanmıyor (crops/host/d-revenue-0.png). Yüzde '%23.3' nokta ondalıklı (toFixed), para birimleri ise virgüllü (₺1.800,00).

**Etki:** Küçük işletme ev sahipleri gelir yönetimi kısaltmalarını bilmeden metriği yorumlayamıyor. İki farklı tarih penceresi yanlış karşılaştırmaya yol açabiliyor.

**Önerilen aksiyon:** KPI etiketlerini açık yazın: 'Ortalama gecelik fiyat (ADR)', 'Müsait oda başına gelir (RevPAR)', 'Rezervasyon birikimi (pickup)'. Kısa açıklamayı dt altında ya da <details> ile verin. Grafik başlığına pencereyi ve ne gösterdiğini yazın. Yüzdeyi f.number ile yerelleştirin (%23,3).

**Yapılan düzeltme:** KPI labels are now spelled out ('Ort. gecelik fiyat (ADR)', 'Müsait oda başına gelir (RevPAR)') and each KPI has a one-sentence definition. The pickup card is retitled 'Rezervasyon birikimi (pickup)' and gets a paragraph explaining its window (bookings made in the last N days for nights between from and to; x axis is booking day). Occupancy is now localized with f.number style percent (%23,3). page.intro and the pickup caption/trend now say 'dönem' instead of 'pencere'.

## F594 — Veri tabloları yatay kaydırma kabı olmadan; 360px'te sayfa yatay taşıyor

| Alan                | Değer                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                              |
| Durum               | Aday (2 kaynak birleşti)                                                                                                            |
| Konum               | `src/components/host/PayoutPanel.tsx:159`                                                                                           |
| Diğer konumlar      | `src/components/host/PayoutPanel.tsx:196`, `src/components/host/RevenueDashboard.tsx:172`, `src/components/host/PayoutPanel.tsx:58` |
| Kullanıcılar        | ev sahibi                                                                                                                           |
| Prensip             | accessibility · Reflow                                                                                                              |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                               |
| WCAG                | 1.4.10                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                               |
| Efor                | S                                                                                                                                   |
| Kaynak denetçiler   | area:host2, lens:mobile                                                                                                             |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p084)                                                                                                    |

**Kanıt:** PayoutPanel.tsx:159 `<table className="w-full text-left text-sm">` (5 para sütunu, boşluksuz '₺48.954,55' değerleri) sarmalanmamış; 196 geçmiş tablosu ve RevenueDashboard.tsx:172 `min-w-full` aynı. Aynı ürün HostDashboard.tsx:132 tabloyu `overflow-x-auto` içine alıyor.

**Etki:** Mobilde ödeme durumuna bakan ev sahibi tüm sayfayı yatay kaydırmak zorunda kalır; kart sınırı taşar, başlıklar ve tutarlar hizasını kaybeder.

**Önerilen aksiyon:** Her tabloyu `<div className="overflow-x-auto" role="region" aria-labelledby="payout-balances-title" tabIndex={0}>` içine alın; dar ekranda bakiye için para birimi başına <dl> kart düzeni değerlendirin.

**Yapılan düzeltme:** Confirmed already fixed: both PayoutPanel tables already sit in <div className="overflow-x-auto" role="region" tabIndex={0} aria-label=…>, and RevenueDashboard.tsx:186-191 is wrapped too. Small polish: the focusable regions now get the shared focusRing, and cells get pe-4 spacing, with whitespace-nowrap/tabular-nums on money and date cells so columns don't touch at 360px.

## F595 — Teknik kodlar ve UTC zaman damgaları kullanıcıya ham gösteriliyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                            |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                          |
| Konum               | `src/components/host/PayoutPanel.tsx:222`                                                                                                                                                                                                                                                                                                                                                                         |
| Diğer konumlar      | `src/components/ui/ui.tsx:230`, `src/components/admin/AdminDashboard.tsx:153`, `src/components/admin/AdminDashboard.tsx:341`, `src/components/compliance/ComplianceDashboard.tsx:137`, `src/components/host/PartyRiskPanel.tsx:63`, `src/components/account/IdentityVerification.tsx:123-125`, `src/components/compliance/ComplianceDashboard.tsx:137,156`, `src/components/admin/AdminDashboard.tsx:341,525-527` |
| Kullanıcılar        | ev sahibi, admin, misafir                                                                                                                                                                                                                                                                                                                                                                                         |
| Prensip             | learnability · familiarity                                                                                                                                                                                                                                                                                                                                                                                        |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                                                                                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                             |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Kaynak denetçiler   | lens:status, lens:forms                                                                                                                                                                                                                                                                                                                                                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p084)                                                                                                                                                                                                                                                                                                                                                                                   |

**Kanıt:** PayoutPanel.tsx:222 `{p.failureCode ? \` (${p.failureCode})\` : ""}`; ui.tsx:230 RoleGate `t("forbidden", { roles: roles.join(" / ") })`→ '(HOST / ADMIN rolü gerekir)'; AdminDashboard.tsx:153 outbox durum anahtarları ve 341`{f.decision}`çevrilmeden; ComplianceDashboard.tsx:137`td.slaDueAt.slice(0, 16).replace("T", " ")`(UTC, saat dilimi etiketi yok); PartyRiskPanel.tsx:63`{i.checkIn} → {i.checkOut}` ISO tarih.

**Etki:** Ev sahibi başarısız ödemenin nedenini anlayamıyor; rolü yetmeyen kullanıcı ne yapacağını bilmiyor; yönetici yasal SLA saatini yerel saat sanıp gecikebiliyor.

**Önerilen aksiyon:** failureCode → payouts.history.failureReasons.<code> çevirisi; RoleGate rol adlarını account.role.* ile çevir ve 'Ev sahibi olmak için…' yönlendirmesi ekle; SLA'yı `f.dateTime(td.slaDueAt)` ile yerel saatte ve kalan süreyle ('3 sa 12 dk kaldı') göster; ISO tarihleri `f.date` ile biçimlendir.

**Yapılan düzeltme:** The raw ` (${failureCode})` in the history status cell is gone. A FAILED row now shows a translated reason under the status via payouts.history.failureReasons.<code>. Known codes are INSUFFICIENT_BALANCE, no_destination and invalid_amount; anything else uses a generic 'other' text that points to support. Dates already used f.date. RoleGate and PartyRiskPanel are described in crossOwner; AdminDashboard (now uses label('decisions', …)) and ComplianceDashboard (uses fmt.dateTime) are already fixed.

## F596 — Yıkıcı eylemlerin görünümü ve onay mekanizması ekranlar arasında tutarsız; host/admin silme ve geri alma işlemleri onaysız

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Konum               | `src/components/host/PromotionsPanel.tsx:127`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx:135-141`, `src/components/host/HostDashboard.tsx:621-632`, `src/components/account/AgentMandates.tsx:93-104`, `src/components/admin/AdminDashboard.tsx:274`, `src/components/admin/AdminDashboard.tsx:360`, `src/components/admin/AdminDashboard.tsx:429`, `src/components/admin/PayoutAdmin.tsx:84-91`, `src/components/privacy/PrivacyCenter.tsx:66-104`, `src/components/account/SessionManager.tsx:152-160`, `src/components/host/AccessibilityPanel.tsx:135`, `src/components/host/RevenueDashboard.tsx:143`, `src/components/host/HostDashboard.tsx:431`, `src/app/cart/page.tsx:39`, `src/app/account/page.tsx:397` |
| Kullanıcılar        | ev sahibi, admin, misafir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Prensip             | robustness · recoverability / consistency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| WCAG                | 3.3.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Kaynak denetçiler   | lens:consistency, lens:status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p086)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Kanıt:** Onay mekanizması dört farklı biçimde: window.confirm (cart/page.tsx:45, PasskeyManager.tsx:87, SessionManager.tsx:71, ClaimDetail.tsx:103, BookingActions.tsx:208), checkbox'lı satır içi iki adım (PrivacyCenter.tsx:66-104), özel modal (ReauthDialog) ve hiç onay yok: PromotionsPanel.tsx:127-140 (promosyon silme), AccessibilityPanel.tsx:135-141, HostDashboard.tsx:621-632 (fotoğraf silme), AgentMandates.tsx:93-104 (yetki iptali), AdminDashboard.tsx:274 (rollback), :360 (fraud), :429 (yorum kaldırma), PayoutAdmin.tsx:84-91 (ödeme durdurma). Görünüm üç farklı: Button danger dolu kırmızı (AccessibilityPanel.tsx:242), kırmızı çerçeveli ham buton (SessionManager.tsx:152, PasskeyManager.tsx:139) ve kırmızı metin bağlantı (PromotionsPanel.tsx:207-214, HostDashboard.tsx:666-672).

**Etki:** Ev sahibi kuponu, fotoğrafı ya da erişilebilirlik beyanını tek tıkla geri dönüşsüz siler. Yönetici ödeme durdurma, rollback ve fraud kararını onay almadan verir. Kullanıcı aynı türdeki eylemin bir ekranda onay istediğini, diğerinde istemediğini öğrenir ve onaya güvenmemeye başlar.

**Önerilen aksiyon:** Ortak bir `ConfirmDialog` bileşeni yazın (role="alertdialog", odak tuzağı, Escape, birincil eylem metni eylemi adlandırsın: 'Promosyonu sil'). Geri alınamayan tüm eylemlerde bu diyaloğu kullanın, window.confirm çağrılarını da buna taşıyın. Yıkıcı eylemler için tek görünüm belirleyin: Button `variant="danger"` (dolu) yalnızca onay diyaloğunda, listelerde Button `variant="dangerOutline"`. Mümkün olan yerde (promosyon, fotoğraf) silme yerine 5 saniyelik 'Geri al' bildirimi de değerlendirilebilir.

**Yapılan düzeltme:** In this file, promotion deletion now goes through the shared ConfirmDialog, and the confirm button names the action ('Promosyonu sil' or 'Promosyonu durdur'). Unifying the destructive-button look with a dangerOutline Button variant is skipped because color/theme is out of scope. The other files listed belong to other packages, and AccessibilityPanel and HostDashboard already use useConfirm.

## F597 — ADR, RevPAR ve Pickup kısaltmaları açıklamasız, TR'de çevrilmemiş

| Alan                | Değer                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Severity            | Medium                                                                           |
| Durum               | Aday (2 kaynak birleşti)                                                         |
| Konum               | `src/components/host/RevenueDashboard.tsx:266`                                   |
| Diğer konumlar      | `messages/tr/revenue.json:21-27`, `src/components/host/RevenueDashboard.tsx:275` |
| Kullanıcılar        | ev sahibi                                                                        |
| Prensip             | learnability · familiarity                                                       |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                      |
| Renk/tema           | Hayır                                                                            |
| Efor                | S                                                                                |
| Kaynak denetçiler   | area:host2, lens:copy                                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)                                                  |

**Kanıt:** RevenueDashboard.tsx:266-267 `<Kpi label={t("kpis.adr")} …/>`, `<Kpi label={t("kpis.revpar")} …/>`; messages/tr/revenue.json:21-22 "adr": "ADR", "revpar": "RevPAR"; :27 pickup.title "Pickup". Kpi bileşeninde (129-136) açıklama alanı, <abbr> ya da yardım yok.

**Etki:** Gelir yönetimi jargonu bilmeyen (partial okuryazarlık) ev sahibi KPI'ları yorumlayamaz, fiyat önerilerinin dayandığı metrikleri anlamadan kabul/ret kararı verir.

**Önerilen aksiyon:** Etiketleri 'Ort. gecelik fiyat (ADR)', 'Müsait oda başına gelir (RevPAR)', 'Rezervasyon birikimi (pickup)' yapın; Kpi'ye `hint` prop'u ekleyip dd altında text-xs tek cümlelik tanım (ör. 'Satılan oda-gece başına ortalama gelir') gösterin.

**Yapılan düzeltme:** Confirmed: labels were bare ADR/RevPAR/Pickup with no explanation. Kpi got an optional hint prop that renders a text-xs dd definition under the value, used for all four KPIs. Labels and the pickup title are translated and expanded via the message patch.

## F821 — Ev sahibi, yönetim ve hesap alt sayfalarında ikincil gezinme veya geri bağlantı yok (bazı alt sayfalarda var: tutarsız)

| Alan                | Değer                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                          |
| Durum               | Aday                                                                                                                                                                                                                            |
| Konum               | `src/app/host/revenue/page.tsx:11`                                                                                                                                                                                              |
| Diğer konumlar      | `src/app/host/payouts/page.tsx:11`, `src/app/admin/claims/page.tsx:11`, `src/app/admin/support/page.tsx:11`, `src/app/admin/payouts/page.tsx:11`, `src/app/account/sessions/page.tsx:11`, `src/app/account/privacy/page.tsx:11` |
| Kullanıcılar        | ev sahibi, admin                                                                                                                                                                                                                |
| Prensip             | learnability · consistency                                                                                                                                                                                                      |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                                                                                                           |
| Efor                | M                                                                                                                                                                                                                               |
| Kaynak denetçiler   | lens:nav                                                                                                                                                                                                                        |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p025)                                                                                                                                                                                          |

**Kanıt:** host/revenue, host/payouts, admin/claims, admin/payouts, admin/support, admin/compliance, account/sessions ve account/privacy yalnız `<PageShell title intro>` kullanıyor; ne geri bağlantı ne kardeş gezinme var. Alt bağlantılar yalnız üst sayfalarda: HostDashboard.tsx:89-110, admin/page.tsx:98-114, account/page.tsx:257-269. Buna karşılık host/messages/[bookingId]/page.tsx:71-73 ve resolution/[id]/page.tsx:54-58'de geri bağlantı var.

**Etki:** Gelirden ödemelere geçen ev sahibi her seferinde uzun /host sayfasına dönüyor. Kuyruklar arasında (talepler → destek → ödemeler) geçen yönetici her seferinde /admin'den geçiyor; masaüstü verimliliği düşüyor.

**Önerilen aksiyon:** PageShell'e `subnav` prop'u ekleyin ve `<nav aria-label="Ev sahibi menüsü">` sekmeleri render edin (Panel, Gelir, Ödemeler, Talepler; aria-current ile). Yönetim için Panel, Uyum, Ödemeler, Talepler, Destek; hesap için Profil, Rezervasyonlarım, Oturumlar, Verilerim, Talepler.

**Yapılan düzeltme:** Added a shared secondary-nav component, src/components/layout/SectionPagesNav.tsx: <nav aria-label> with links, aria-current=page via usePathname, a 44px mobile target and a thicker underline as the non-color cue. Also added src/components/host/HostPagesNav.tsx with Panel, Gelir paneli and Ödemeler, and render it under the intro on the revenue page. PageShell (ui.tsx) is not mine, so the nav goes through the intro ReactNode. Payouts, admin and account pages are listed in crossOwner.

## F822 — İlan değiştirince önceki ilanın özellikleri ve fotoğrafları yükleme göstergesi olmadan görünmeye devam ediyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/host/AccessibilityPanel.tsx:60` |
| Kullanıcılar        | ev sahibi                                       |
| Prensip             | robustness · observability                      |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:host2                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p076)                 |

**Kanıt:** useLoader deps değişince data'yı sıfırlamıyor (src/components/ui/ui.tsx:241-262); 'Yükleniyor' yalnız `features.data === null` iken (AccessibilityPanel.tsx:167). Kapsam seçicisi ise yeni ilanın odalarını hemen gösteriyor (276). Eski ilanın fotoğrafıyla ekleme sunucuda 'Kanıt fotoğrafı bu ilana ait değil' hatası veriyor (src/lib/compliance/accessibility.ts:102).

**Etki:** Çok ilanlı ev sahibi ilan seçtikten sonra bir süre yanlış ilanın listesini görür; bu arada eklerse anlaşılmaz Türkçe hata alır.

**Önerilen aksiyon:** useLoader'a deps değişiminde `setData(null)` ekleyin (ya da yüklenen anahtar ile istek anahtarını karşılaştırın); yükleme sürerken liste yerine 'Özellikler yükleniyor…' gösterin ve ekleme düğmesini devre dışı bırakın.

**Yapılan düzeltme:** Confirmed the bug: useLoader keeps old data while the new request runs. The features and photos loaders now return their data tagged with the propertyId it was fetched for. The list, the photo options and the duplicate check only use data whose tag matches the selected listing, so 'Özellikler yükleniyor…' shows while the new listing loads. The Add button is disabled during loading. Changing the listing resets scope, evidence, drafts, the edit form and status. Errors now go through useErrorText instead of errorMessage.

## F823 — Yeni yüklenen fotoğraf kanıt listesine sayfa yenilenene kadar düşmüyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Medium                                          |
| Durum               | Aday                                            |
| Konum               | `src/components/host/AccessibilityPanel.tsx:69` |
| Kullanıcılar        | ev sahibi                                       |
| Prensip             | robustness · observability                      |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                  |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:host2                                      |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p076)          |

**Kanıt:** AccessibilityPanel.tsx:69-77 photos useLoader bağımlılığı yalnız `[propertyId]`. HostDashboard.tsx:613 yükleme sonrası `onChanged()` yalnız HostDashboard verisini yeniliyor (75-83); AccessibilityPanel'e aynı properties dizisi gidiyor, fotoğraf listesi yeniden çekilmiyor.

**Etki:** Ev sahibi kanıt için fotoğraf yükleyip hemen bu panele indiğinde fotoğrafı seçeneklerde bulamaz; yüklemenin başarısız olduğunu sanıp tekrar yükler (duplikat uyarısı alır).

**Önerilen aksiyon:** HostDashboard'dan `photosVersion` sayacı geçirip photos loader deps'ine ekleyin (PhotoUpload başarıda artırsın) ya da AccessibilityPanel'e reload fonksiyonu verin.

**Yapılan düzeltme:** Added a new module, src/components/host/host-photos-changed.ts, with the HOST_PHOTOS_CHANGED_EVENT constant and notifyHostPhotosChanged(propertyId). The panel listens for this window event and bumps photosVersion, which is in the deps of both the photos and features loaders. A deleted photo also clears evidence on the server, which is why features reload too. The panel only refreshes once HostDashboard's PhotoUpload dispatches the event (see crossOwner).

## F824 — Erişilebilirlik panelinin kanıt fotoğrafı listesi aynı sayfadaki fotoğraf yüklemeyle senkron değil; kanıt seçimi istek sürerken eski değere dönüyor

| Alan                | Değer                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                        |
| Durum               | Aday                                                                                          |
| Konum               | `src/components/host/AccessibilityPanel.tsx:69`                                               |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:613`, `src/components/host/AccessibilityPanel.tsx:221` |
| Kullanıcılar        | ev sahibi                                                                                     |
| Prensip             | learnability · consistency                                                                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                |
| Renk/tema           | Hayır                                                                                         |
| Efor                | S                                                                                             |
| Kaynak denetçiler   | lens:status                                                                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p076)                                                        |

**Kanıt:** AccessibilityPanel.tsx:69-77 `photos` useLoader yalnız propertyId'ye bağlı; HostDashboard.tsx:613 PhotoUpload başarıda `onChanged()` → yalnız ana mülk listesini yeniliyor, bu loader'ı değil. 216-222 kontrollü select `value={feature.evidencePhotoId ?? ""}` + `onChange={(e) => void setEvidence(...)}` → istek sürerken seçim eski değere dönüyor, busy göstergesi yok; sonuç 322'de kart dibinde.

**Etki:** Ev sahibi yeni yüklediği kanıt fotoğrafını listede bulamıyor, sayfayı yenilemek zorunda; seçimin kaydedilip kaydedilmediğini göremiyor.

**Önerilen aksiyon:** Fotoğraf yükleme/silmede ortak sinyal (ör. `photosVersion` context veya `window.dispatchEvent(new Event('host-photos-changed'))`) ile photos.reload(); select için iyimser yerel değer + satır içi 'Kaydediliyor…', hatada eski değere dönüp satırda hata göster.

**Yapılan düzeltme:** Photo-list sync works the same way as F823 (event plus photosVersion; HostDashboard must dispatch it). Picking evidence was already a local draft saved with an explicit 'Kanıtı kaydet' button with busy state, so it no longer reverts mid-request. The result of saving evidence, editing, or a failed delete now shows inside that row: a role=status region that is always present for success, and role=alert for errors. Other results stay at the bottom of the card.

## F825 — Ekle/sil/kanıt işlemlerinde meşguliyet durumu yok; çift tıklama ikinci isteği 409/404 hatasına çeviriyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:86`  |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx:242` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · responsiveness                      |
| Sezgisel madde      | H5 — Hata önleme                                 |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p076)                 |

**Kanıt:** AccessibilityPanel.tsx:86-95 run() busy tutmuyor; 317 `<Button type="submit" disabled={!propertyId}>`, 242 sil düğmesinde disabled yok. İkinci POST benzersiz indekse takılıp 'Bu özellik zaten eklenmiş' (accessibility.ts:155), ikinci DELETE 'Erişilebilirlik özelliği bulunamadı' (accessibility.ts:200) döner ve başarı mesajının üzerine yazar. RevenueDashboard.tsx:208-211 ve PayoutPanel.tsx:139 busy ile kilitliyor.

**Etki:** Yavaş ağda iki kez tıklayan ev sahibi işlem başarılı olduğu halde hata mesajı görür ve tekrar dener.

**Önerilen aksiyon:** `const [busy, setBusy] = useState(false)` ekleyip run() içinde set edin; ekle ve sil düğmelerine `disabled={busy}` ve 'Ekleniyor…'/'Siliniyor…' metni, ilgili bölgeye `aria-busy` verin.

**Yapılan düzeltme:** Already fixed in the current code. run() keeps busy state with a re-entry guard (`if (busy) return false`). The Add, Delete and Save Evidence buttons pass busy={busy === key}, so Button sets aria-busy and blocks the click. That also blocks implicit Enter submission, because it goes through the submit button's click. The new Edit save button uses the same guard, and Add is also disabled while the list is loading.

## F826 — Aynı kavram için 'Mülk', 'İlan' ve 'Tesis' karışık kullanılıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:150` |
| Diğer konumlar      | `src/components/host/RevenueDashboard.tsx:328`   |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | learnability · consistency                       |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                      |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p076)           |

**Kanıt:** messages/tr/compliance.json:101 host.property 'İlan', :78 wholeProperty 'Tüm tesis'; messages/tr/revenue.json:9 propertyLabel 'Mülk', :8 'Henüz bir mülkünüz yok.' EN'de de 'Listing' / 'Property' karışık.

**Etki:** Partial okuryazarlıktaki ev sahibi 'ilan', 'mülk' ve 'tesis'in aynı şey mi olduğunu sorgular; özellikle 'Tüm tesis' kapsamının ilanın tamamı mı yoksa bina mı olduğu belirsizleşir.

**Önerilen aksiyon:** Tek terim seçin (ör. TR 'Tesis', EN 'Property') ve compliance.accessibility.host.property, revenue.propertyLabel, revenue.noProperties, wholeProperty anahtarlarını hizalayın.

**Yapılan düzeltme:** The host dashboard mostly says 'İlan'/'Listing', so the panel now uses that. host.intro now reads 'İlanınızın…' / "your listing's…" instead of 'Tesisinizin'. The scope option, list rows and delete-confirm scope use the new key host.wholeListing ('İlanın tamamı' / 'Entire listing') instead of 'Tüm tesis'. wholeProperty is unchanged because guest pages and the admin queue use it. The revenue keys belong to the RevenueDashboard owner (see crossOwner).

## F827 — Not listede gösterilmiyor; genişlik ve not düzenlenemiyor (sil-yeniden ekle doğrulamayı kaybettiriyor)

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:178` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · task conformance                    |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p076)                  |

**Kanıt:** Feature.note (35) liste öğesinde (178-209) render edilmiyor. Sunucu PATCH widthCm ve note kabul ediyor (src/lib/compliance/accessibility.ts:45-51) ama arayüz yalnız evidencePhotoId gönderiyor (AccessibilityPanel.tsx:130).

**Etki:** Ev sahibi girdiği notu göremez; yanlış genişliği düzeltmek için silip yeniden eklemek zorunda kalır ve doğrulanmış rozeti kaybeder.

**Önerilen aksiyon:** Notu öğede gösterin; 'Düzenle' ile satır içi genişlik/not formu açın; not değişiminin doğrulamayı etkilemediğini, genişlik değişiminin sıfırladığını (migration tetiği) yanında belirtin.

**Yapılan düzeltme:** Each row now shows its note ('Not: {note}'). A new 'Düzenle' toggle (aria-expanded/aria-controls) opens an inline noValidate form: width appears only for the WIDTH_CODE feature, with range validation and focus on error; the note is always there. It sends PATCH {note, widthCm?}. Hints say a note change keeps verification and a width change removes it, and a confirm dialog appears when the width of a verified feature changes. Save and Cancel return focus to the Edit button.

## F828 — Zaten beyan edilmiş özellik/kapsam yeniden seçilebiliyor; hata ancak gönderimden sonra geliyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:266` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · error prevention                    |
| Sezgisel madde      | H5 — Hata önleme                                 |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p076)                  |

**Kanıt:** AccessibilityPanel.tsx:266-270 tüm `ACCESSIBILITY_CODES` seçenek olarak listeleniyor; benzersizlik indeksleri migration.sql:40-42 (propertyId, roomTypeId, code); sunucu 409 'Bu özellik zaten eklenmiş' (src/lib/compliance/accessibility.ts:155).

**Etki:** Ev sahibi formu doldurup gönderdikten sonra hata alır ve girdiği notu/genişliği boşa harcar.

**Önerilen aksiyon:** features.data ve seçili kapsamdan beyan edilmiş kod kümesini hesaplayın; o seçenekleri '(zaten eklendi)' ekiyle `disabled` yapın veya kapsam/kod seçildiğinde form içinde aria-describedby ile bağlı uyarı gösterin.

**Yapılan düzeltme:** Scope is now a controlled field. Codes already declared for the selected listing and scope are disabled options labelled '(zaten eklendi)'. When nothing is picked, the default is the first code not yet added for that scope; this also applies after a successful add. If the host picks a duplicate (for example by changing scope afterwards), the code Field shows an error wired with aria-invalid/aria-describedby, and submitting focuses the code select instead of posting.

## F829 — Genişlik alanında tarayıcı yerel doğrulaması özel hata mesajını devre dışı bırakıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:290` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · recoverability                      |
| Sezgisel madde      | H9 — Hata mesajları                              |
| WCAG                | 3.3.1                                            |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p076)                  |

**Kanıt:** AccessibilityPanel.tsx:290-298 `<input type="number" min={MIN_WIDTH_CM} max={MAX_WIDTH_CM}>`, form (255) noValidate değil → aralık dışı veya ondalık değerde tarayıcı submit'i add() çalışmadan durdurur; 101-106 özel `widthError` yolu bu değerler için hiç çalışmaz. Yerel balon tarayıcı dilinde, geçici ve aria-invalid ile bağlı değil. widthError kod değişince temizlenmiyor; hatada odak alana taşınmıyor.

**Etki:** Ev sahibi bir an görünüp kaybolan, uygulama dilinden farklı bir hata balonu görür; ekran okuyucu kullanıcısı Field'in sağladığı kalıcı hata metnine ulaşamaz.

**Önerilen aksiyon:** Forma `noValidate` ekleyin, özel doğrulamayı koruyun (Number.isInteger + aralık), hata durumunda `document.getElementById("a11y-width")?.focus()` yapın, code değiştiğinde `setWidthError(null)` çağırın.

**Yapılan düzeltme:** The add form (and the new edit form) are noValidate. Width is checked by a shared parseWidth(): validity.badInput, Number.isInteger and the MIN/MAX range. On error it sets the Field error and focuses the width input. widthError is cleared when the code changes.

## F830 — Hiç fotoğraf yokken kanıt seçimi boş kalıyor; fotoğraf yükleme yönlendirmesi yok

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:301` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | learnability · predictability                    |
| Sezgisel madde      | H13 — Feedforward                                |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p076)                  |

**Kanıt:** AccessibilityPanel.tsx:301-309 photoOptions boşken yalnız `<option value="">{t("host.noEvidence")}</option>`; hint yalnız 'Kanıt değiştirilirse doğrulama yeniden yapılır.' Fotoğraf yükleme alanı HostDashboard.tsx:322 `<PhotoUpload …/>` her mülk kartının içinde, bu panelin çok yukarısında.

**Etki:** Yeni ev sahibi neden seçenek olmadığını ve kanıtın ilan fotoğraflarından seçildiğini anlamaz; özellik 'Kanıt fotoğrafı gerekli' durumunda kalır.

**Önerilen aksiyon:** photoOptions.length === 0 iken alan altında 'Önce ilan fotoğrafı yükleyin' metni ve `<a href={`#photo-${propertyId}`}>Fotoğraf yükle</a>` bağlantısı gösterin.

**Yapılan düzeltme:** When the listing's photos have loaded and there are none, the evidence hints (the add form and each row) switch to host.noPhotosHint. A link 'İlana fotoğraf yükle' appears under the add form's evidence field, pointing to #prop-{id}. Clicking it opens that listing card's <details>, waits for the PhotoUpload input #photo-{id} to render, then scrolls to it and focuses it. If the card is missing, the link falls back to normal anchor navigation.

## F831 — Sonuç mesajı kartın en altında; listedeki işlemin sonucu görüş alanı dışında kalıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:322` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · observability                       |
| Sezgisel madde      | H12 — Feedback                                   |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p077)                  |

**Kanıt:** AccessibilityPanel.tsx:322 tek `<Status error={status.error} message={status.message} />` formun altında; kanıt değişimi (221) ve silme (244) listede, formun üstünde. RevenueDashboard.tsx:215 ise her satıra kendi Status'ünü koyuyor.

**Etki:** Uzun listede kanıt değiştiren gören ev sahibi 'Kanıt güncellendi; özellik yeniden incelenecek' mesajını veya hata metnini göremez.

**Önerilen aksiyon:** Satır içi işlemler için Status'ü ilgili <li> içine taşıyın (feature.id başına durum), ekleme sonucu formun altında kalsın; hata varsa ilgili öğeye scrollIntoView yapın.

**Yapılan düzeltme:** Confirmed partly real. Package p076 had already moved evidence, edit and delete errors and evidence/edit success messages into each row's <li>. Delete success was the remaining gap: the row disappears, so its message still landed in the Status at the bottom of the card. I added an inList status flag and a role=status region right after the list, so 'Özellik silindi.' now appears where the row was. Add results stay under the form, and the bottom Status skips messages for rows and the list.

## F832 — Oda satırında 'Geçerli: Tanımlı değil' yanıltıcı; ilan geneli tutar uygulanıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/host/DepositSettings.tsx:134` |
| Diğer konumlar      | `messages/tr/resolution.json:191`             |
| Kullanıcılar        | ev sahibi                                     |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:host                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p083)               |

**Kanıt:** DepositSettings.tsx:134-136 'hint={t("current", { amount: row.amountMinor === null ? t("none") : f.money(row.amountMinor, currency) })}'; resolution.json host.intro: 'Oda tipi için boş bırakılırsa ilan geneli tutar geçerli olur.'

**Etki:** Host odada depozito alınmadığını sanıp gereksiz tutar girer ya da ilan geneli tutarın odaya uygulandığını bilmez.

**Önerilen aksiyon:** Oda satırında amountMinor null ve ilan geneli tanımlıysa hint: 'Geçerli: İlan geneli (₺1.000,00) uygulanıyor'; ikisi de null ise 'Bu odada depozito alınmıyor'.

**Yapılan düzeltme:** Confirmed real: lib/resolution/deposit.ts falls back to the listing-wide row when a room has no amount, but the UI said 'Geçerli: Tanımlı değil'. The parent now passes listingMinor to each row. A room row with no amount says 'Geçerli: İlan geneli tutar (X) uygulanıyor.' when a listing-wide amount exists, and 'Bu odada depozito alınmıyor.' when neither is set. The listing row and rows with their own amount get their own texts. The remove confirmation for a room row now says the listing-wide amount will apply after removal, instead of saying no deposit will be held.

## F833 — Sayfa içi gezinme yok; Rezervasyonlar tüm formların altında

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Medium                                                    |
| Durum               | Aday                                                      |
| Konum               | `src/components/host/HostDashboard.tsx:126`               |
| Diğer konumlar      | `src/app/host/page.tsx:16`, `messages/tr/host.json:4`     |
| Kullanıcılar        | ev sahibi, admin                                          |
| Prensip             | flexibility · multithreading (görevler arası hızlı geçiş) |
| Sezgisel madde      | H7 — Esneklik/verim                                       |
| Renk/tema           | Hayır                                                     |
| Efor                | M                                                         |
| Kaynak denetçiler   | area:host                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p079)                           |

**Kanıt:** Sıra: PartyRiskPanel (page.tsx:16) → linkler → her mülk için ~7 alt bölüm (HostDashboard.tsx:120-122, 321-324) → Promosyonlar (L123) → Erişilebilirlik (L124) → Rezervasyonlar (L126). Card id'leri ('host-bookings', 'host-promotions', 'host-party-risk') var ama bunlara bağlantı yok; intro (host.json page.intro) promosyon/fotoğraf/depozitodan söz etmiyor.

**Etki:** Host en sık görevi (rezervasyonu kontrol et, misafire yaz) için birden çok mülk kartını kaydırarak geçer; mobilde onlarca alan; ekran okuyucuda çok sayıda h2/h3 atlanır.

**Önerilen aksiyon:** h1 altına '<nav aria-label="Panel bölümleri">' ile #host-bookings, #host-promotions, #host-party-risk ve her '#prop-{id}' bağlantıları; Rezervasyonlar kartını üste taşı veya sekmeler (Rezervasyonlar / İlanlar / Promosyonlar); mülk kartlarını <details> ile katlanır yap; intro'yu bu bölümleri sayacak şekilde güncelle.

**Yapılan düzeltme:** Already in place: a section nav (bookings, properties, promotions, accessibility), the bookings card first, and property cards that collapse with <details>. I added a #host-party-risk link to the nav and, in the patch, updated host.page.intro to mention photos, deposits, promotions and party-risk warnings. That key is used only in src/app/host/page.tsx.

## F834 — Rezervasyon tablosunda misafir, rezervasyon no ve filtre yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:161` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | robustness · task conformance               |
| Sezgisel madde      | H7 — Esneklik/verim                         |
| Renk/tema           | Hayır                                       |
| Efor                | M                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p079)      |

**Kanıt:** Sütunlar: mülk, giriş, çıkış, misafir sayısı, tutar, durum (L137-157); HostBooking (L45-55) misafir adı/ref içermiyor; sıralama, durum/mülk filtresi veya sayfalama yok (L161-180).

**Etki:** Host aynı tarihli iki rezervasyonu ayırt edemez; parti riski veya çözüm merkezi kaydını burada eşleyemez; çok rezervasyonda tüm listeyi taramak zorundadır.

**Önerilen aksiyon:** 'Rezervasyon no' (kısaltılmış id) ve misafir adı sütunları; durum ve mülk için <select> filtreleri; tarih başlığında sıralama düğmesi + aria-sort.

**Yapılan düzeltme:** Added a 'Rezervasyon no' column (last 8 characters of the id) to the table and the mobile cards. Above 5 bookings, filters for status and property (the property filter only when there is more than one) appear, with a live 'shown/total' count and a message when nothing matches. The check-in header has aria-sort=ascending, matching the API's checkIn asc order. A guest-name column shows once the API returns guestName (crossOwner on host-service). I did not add a sort toggle.

## F835 — Ev sahibi rezervasyon tablosunda her satırda aynı 'Mesajlar' bağlantı metni

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Aday                                                 |
| Konum               | `src/components/host/HostDashboard.tsx:170`          |
| Kullanıcılar        | ev sahibi                                            |
| Prensip             | accessibility · WCAG 2.4.4 Link Purpose (In Context) |
| Sezgisel madde      | H14 — Erişilebilirlik                                |
| WCAG                | 2.4.4                                                |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | area:trips                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p079)                      |

**Kanıt:** `<Link href={'/host/messages/' + b.id} …>{t('bookings.messagesLink')}</Link>` her satırda 'Mesajlar'. Sütun başlığı da sr-only 'Mesajlar' (153-155). İlk hücre `<th scope='row'>` değil `<td>`, dolayısıyla satır bağlamı programatik olarak bağlantıya iliştirilmiyor.

**Etki:** Ekran okuyucunun bağlantı listesinde 'Mesajlar, Mesajlar, Mesajlar…' çıkıyor ve hangi rezervasyon olduğu anlaşılmıyor. Tablo gezintisi bilen kullanıcı satırda geri giderek çıkarabilir; bu yüzden etki orta.

**Önerilen aksiyon:** `aria-label={`${titleOf(b.propertyId)}, ${f.date(b.checkIn, 'short')} – mesajlar`}` ekle ya da ilan hücresini `<th scope='row'>` yap.

**Yapılan düzeltme:** The property cell in each table row is now `<th scope="row">`. The 'Mesajlar' link's sr-only text now includes the property title and the check-in date, in both the table and the mobile cards.

## F836 — Satır içi eylemler ve tekrarlanan düğmeler bağlam taşımıyor

| Alan                | Değer                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                     |
| Konum               | `src/components/host/HostDashboard.tsx:175`                                                                                                                                              |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx:205`, `src/components/host/HostDashboard.tsx:302`, `src/components/host/DepositSettings.tsx:149`, `src/components/host/DepositSettings.tsx:153` |
| Kullanıcılar        | ev sahibi, admin                                                                                                                                                                         |
| Prensip             | accessibility · Headings and Labels / Link Purpose                                                                                                                                       |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                    |
| WCAG                | 2.4.6                                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                                    |
| Efor                | S                                                                                                                                                                                        |
| Kaynak denetçiler   | area:host                                                                                                                                                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p079)                                                                                                                                                          |

**Kanıt:** HostDashboard.tsx:171-176 her satırda aynı 'Mesajlar' linki; PromotionsPanel.tsx:200-206 'Durdur/Etkinleştir' sr-only ad içermiyor (oysa L213 Sil'de '<span className="sr-only">: {p.name}</span>' var); sayfada her mülk için 'Kaydet' (HostDashboard.tsx:302) ve her depozito satırında 'Kaydet'/'Kaldır' (DepositSettings.tsx:149, :153).

**Etki:** Ekran okuyucu bağlantı/düğme listesinde 'Mesajlar, Mesajlar…', 'Kaydet, Kaydet…' duyulur; hangi rezervasyon/mülk/oda olduğu anlaşılmaz, yanlış öğe üzerinde işlem riski.

**Önerilen aksiyon:** Mesajlar linkine '<span className="sr-only">: {titleOf(b.propertyId)}, {f.date(b.checkIn)}</span>'; toggle'a '<span className="sr-only">: {p.name}</span>'; mülk Kaydet'e sr-only ' – {p.title}'; depozito düğmelerine sr-only '{scope}'.

**Yapılan düzeltme:** In this file, the property 'Kaydet' button now has sr-only ': {p.title}', and the Mesajlar link carries the title and date (see F835). The room open/close and photo remove buttons already had context. The PromotionsPanel toggle and the DepositSettings Kaydet/Kaldır buttons are passed on as crossOwner.

## F837 — Form her kayıtta isActive gönderiyor; ilgisiz düzenlemeler belge hatasıyla reddediliyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:215` |
| Diğer konumlar      | `src/lib/host/host-service.ts:96`           |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | robustness · task conformance               |
| Sezgisel madde      | H5 — Hata önleme                            |
| Renk/tema           | Hayır                                       |
| Efor                | M                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p079)             |

**Kanıt:** HostDashboard.tsx:211-216 body her zaman 'isActive: form.isActive' içerir; sunucu 'if (patch.isActive && !license) throw … "Belge numarası olmadan ilan yayınlanamaz"' ve 'licenseStatus !== "VERIFIED"' (host-service.ts:96-115). docs/img/host-extranet.png'de 'İlan yayında' işaretli + belge boş → yalnız başlığı düzeltmek bile reddedilir. L195-202 useState başlangıç değeri reload sonrası prop'larla senkronlanmaz.

**Etki:** Host yalnız açıklamayı düzeltirken anlamadığı bir belge hatası alır; lisans numarasını değiştirmek için önce yayından kaldırması gerektiğini kendi keşfetmek zorunda kalır.

**Önerilen aksiyon:** Yalnız değişen alanları PATCH et (başlangıç değeriyle diff); isActive değişmediyse gönderme; yayındaki ilanda lisans değişirse 'Belge doğrulanana kadar ilan yayından kaldırılacak' uyarısı; reload sonrası formu yeni prop'larla eşitle (key={p.id + p.updatedAt} veya effect).

**Yapılan düzeltme:** The PATCH now sends only the fields that differ from the server values: title, description, basePrice by minor-unit comparison, licenseNumber, and isActive only when it changed. An unrelated edit is no longer rejected by the license rule. With no changes it shows property.noChanges. On reload the form updates the fields the user has not edited and keeps the edited ones. A live note (licenseChangeNote) warns that a changed license number is re-verified.

## F838 — Ev sahibi formlarında kaydedilmemiş değişiklik göstergesi ve ayrılma uyarısı yok; 'Kaydedildi' mesajı sonraki düzenlemelerde kalıyor

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                   |
| Durum               | Aday                                                                                     |
| Konum               | `src/components/host/HostDashboard.tsx:219`                                              |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:431`, `src/components/host/HostDashboard.tsx:340` |
| Kullanıcılar        | ev sahibi                                                                                |
| Prensip             | robustness · observability                                                               |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                           |
| Renk/tema           | Hayır                                                                                    |
| Efor                | S                                                                                        |
| Kaynak denetçiler   | lens:status                                                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p080)                                                          |

**Kanıt:** HostDashboard.tsx:219 `setStatus({ message: t("property.saved") })` sonraki değişikliklerde temizlenmiyor (246, 258, 271 onChange'ler status'a dokunmuyor); kod tabanında `beforeunload` yok (grep 0). CalendarForm (431-456) ve AddRoomForm (340-359) aynı.

**Etki:** Ev sahibi kaydettikten sonra fiyatı yeniden değiştirip ekranda 'Kaydedildi' görerek sayfadan ayrılabiliyor; değişiklik kayboluyor, yanlış fiyat yayında kalıyor.

**Önerilen aksiyon:** Formun `dirty` durumunu izle: değişiklikte Status'u temizle ve 'Kaydedilmemiş değişiklikler' etiketi göster; dirty iken `beforeunload` uyarısı; dirty değilken 'Kaydet'i devre dışı bırak.

**Yapılan düzeltme:** The property form now tracks a dirty state by comparing the form with the server values; a successful save is snapshotted so it doesn't count as dirty while reloading. Editing clears the old 'Kaydedildi.' message and shows a live 'Kaydedilmemiş değişiklikler var.' label next to Save. A new useHostUnsavedChanges hook adds a beforeunload warning for the property, add-room (room name typed), calendar (price or availability entered but not applied) and new-listing forms. Save is deliberately left enabled when nothing changed: it still answers with the existing property.noChanges message, which is easier to discover than a disabled button.

## F839 — Kaydedilmemiş değişiklik göstergesi ve ayrılma uyarısı yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:237` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | robustness · recoverability                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü           |
| Renk/tema           | Hayır                                       |
| Efor                | M                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p080)             |

**Kanıt:** Mülk formu (L237-306), oda ekle (L362), takvim (L459), depozito satırları ayrı <form>'lar; dirty state ve beforeunload yok; üstteki Gelir/Ödemeler linkleri (L90-109) gezinmede düzenlemeyi siler; 'Kaydedildi.' (L219) sonraki düzenlemelerde de ekranda kalır.

**Etki:** Host açıklamayı düzenleyip 'Oda ekle'ye basınca her şeyin kaydedildiğini sanar; sayfadan ayrılınca değişiklik sessizce kaybolur; eski 'Kaydedildi.' mesajı yanlış güven verir.

**Önerilen aksiyon:** Form başlangıç değerinden farklıysa Kaydet yanında 'Kaydedilmemiş değişiklikler' metni; dirty iken beforeunload uyarısı; onChange'de status.message temizlensin.

**Yapılan düzeltme:** This shares the F838 dirty indicator, status clearing and beforeunload warning. In-app navigation does not fire beforeunload, so the dashboard's Revenue, Payouts and Resolution links and both booking-message links now use Next Link onNavigate with a useConfirm dialog ('Kaydetmeden ayrıl' / 'Sayfada kal') whenever any host form is dirty. The site-wide header links are outside this file and are covered only by beforeunload on full page loads.

## F840 — Odası olmayan mülkte takvim bölümü sessizce gizleniyor; oda listesinin boş durumu yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:321` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | learnability · predictability               |
| Sezgisel madde      | H13 — Feedforward                           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p080)             |

**Kanıt:** HostDashboard.tsx:321 '{p.rooms.length > 0 && <CalendarForm …/>}'; L310-317 '<ul>' oda yokken boş render edilir, açıklama yok.

**Etki:** Host takvim ve fiyat yönetiminin neden görünmediğini anlamaz; önce oda eklemesi gerektiğini tahmin etmek zorunda kalır.

**Önerilen aksiyon:** Oda yoksa '<p>Henüz oda yok. Takvim ve fiyatları yönetmek için önce aşağıdan oda ekleyin.</p>'; CalendarForm yerine aynı açıklama.

**Yapılan düzeltme:** RoomList now shows an empty state ('Henüz oda yok. Takvim ve fiyatları yönetmek için önce aşağıdan oda ekleyin.') instead of an empty <ul>. When the property has no rooms, the calendar section still appears with its heading and explains that the calendar is managed per room and a room must be added first.

## F841 — 'Fiyat farkı' alanının birimi ve anlamı belirsiz

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:398` |
| Diğer konumlar      | `messages/tr/host.json:71`                  |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | learnability · familiarity                  |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                 |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p080)             |

**Kanıt:** HostDashboard.tsx:398-407 'label={t("rooms.add.priceModifier")}' = 'Fiyat farkı' (host.json:71), 'min={0}', para birimi ve hint yok; sunucu mülk para biriminde 'priceModifierMinor' olarak saklıyor (host-service.ts:215).

**Etki:** Host yüzde mi tutar mı, gecelik mi toplam mı olduğunu bilemez; '10' yazıp %10 sanabilir; daha ucuz oda (negatif fark) tanımlanamadığını öğrenemez.

**Önerilen aksiyon:** Etiket 'Gecelik ek ücret ({currency})', hint 'Taban gecelik fiyata eklenir; ör. 200 → ₺1.800 + ₺200 = ₺2.000' (aria-describedby).

**Yapılan düzeltme:** The room price field label changed from 'Fiyat farkı' to the new key rooms.add.priceModifierLabel, 'Gecelik ek ücret ({currency})'. The existing hint stays linked through Field's aria-describedby. A live example below the field shows 'Bu odanın gecelik fiyatı: {total} (taban {base} + {modifier})'; AddRoomForm got a new optional basePriceMinor prop for it.

## F842 — Oda 'Fiyat farkı' ve toplu takvim fiyatının birimi belirsiz; toplu güncelleme önizlemesiz

| Alan                | Değer                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                           |
| Durum               | Aday                                                                                             |
| Konum               | `src/components/host/HostDashboard.tsx:398`                                                      |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:431-456`, `src/components/host/HostDashboard.tsx:498-508` |
| Kullanıcılar        | ev sahibi                                                                                        |
| Prensip             | robustness · recoverability (hata önleme)                                                        |
| Sezgisel madde      | H5 — Hata önleme                                                                                 |
| Renk/tema           | Hayır                                                                                            |
| Efor                | S                                                                                                |
| Kaynak denetçiler   | lens:copy                                                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p080)                                                                  |

**Kanıt:** HostDashboard.tsx:398-407 'Fiyat farkı' (host.json rooms.add.priceModifier) — para birimi mi, yüzde mi, gecelik mi belirtilmez, min=0 (indirim girilemez). 498-508 'Gecelik fiyat (boş = değişmez)' para birimi yok; 431-456 gönderimde etkilenecek gece sayısı/aralık özeti gösterilmeden uygulanır.

**Etki:** Ev sahibi yüzde sanıp '10' girerek gecelik ₺10 fark ekler; yanlış aralıkla tüm ayın fiyatını değiştirir (para kaybı).

**Önerilen aksiyon:** Etiketleri 'Taban fiyata eklenecek tutar (₺/gece)' ve 'Gecelik fiyat (₺) — boş bırakılırsa değişmez' yapın; gönder düğmesini '{n} gecenin fiyatını ₺X yap' şeklinde dinamik yazın veya özet onayı gösterin.

**Yapılan düzeltme:** The room surcharge label now includes the currency (see F841). The calendar price label is the new calendar.priceLabel, 'Gecelik fiyat ({currency}) — boş bırakılırsa değişmez'. A live summary under the form, linked to the submit button with aria-describedby, reads 'Uygulanacak: {room}, {from} – {to} (n gece) — gecelik fiyat X olacak, satışa kapatılacak'. Ranges longer than 31 nights now ask for confirmation before submitting.

## F843 — Takvim tarih alanlarında min/aralık önleme yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:479` |
| Diğer konumlar      | `src/lib/host/host-service.ts:310`          |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | robustness · task conformance / hata önleme |
| Sezgisel madde      | H5 — Hata önleme                            |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p080)             |

**Kanıt:** HostDashboard.tsx:479-486 '<input type="date" … value={from}>' ve L489-496 'to' — min/max yok; bitiş<başlangıç veya >365 gece yalnız sunucuda ('Tarih aralığı 1–365 gece olmalı', host-service.ts:310) ve genel hatayla döner.

**Etki:** Host geçmiş tarih ya da ters aralık seçip gönderdikten sonra hata alır; aralığın kaç gece olduğunu göremez.

**Önerilen aksiyon:** from için 'min={isoDay(0)}', to için 'min={from}' ve 'max' = from+364; seçilen aralığı aria-live ile '7 gece seçildi' olarak göster.

**Yapılan düzeltme:** The start date already had min=today and the end date had min=from (checked in the code); the end date now also gets max=from+364 days through a new addIsoDays helper. The selected night count ('N gece seçili') moved out of the non-live field hint into an aria-live paragraph, which shows the full change summary once a change is entered.

## F844 — Ev sahibi toplu takvim formunda tarih kısıtı yok ve satışa kapatma onaysız

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:479` |
| Diğer konumlar      | `src/lib/host/host-service.ts:310`          |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | robustness · error prevention               |
| Sezgisel madde      | H5 — Hata önleme                            |
| WCAG                | 3.3.4                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | lens:forms                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p080)             |

**Kanıt:** src/components/host/HostDashboard.tsx:478-497 `type="date"` alanlarda `min` yok (geçmiş seçilebilir), bitiş için `min={from}` yok; sunucu src/lib/host/host-service.ts:310 `"Tarih aralığı 1–365 gece olmalı"` ile sonradan reddediyor. :509-519 'Satışa kapat' bir aralığın tamamını kapatıyor, :441-452 gönderim öncesi kaç gecenin etkileneceği söylenmiyor.

**Etki:** Ev sahibi tarihleri ters seçip teknik hata alır ya da yanlış aralığı satışa kapatıp rezervasyon kaçırır.

**Önerilen aksiyon:** `min={isoDay(0)}` ve bitişte `min={from}` + `max={from+364}`; değişimde 'Etkilenecek: {n} gece' canlı özet; 'Satışa kapat' seçiliyse gönderimden önce onay ('{oda} için {başlangıç}–{bitiş} arası {n} gece satışa kapatılacak').

**Yapılan düzeltme:** Most of this was already in place: min dates, client-side checks for range errors, and a confirm dialog for 'Satışa kapat'. Added the max end date and the live 'N gece' / change summary. The close-for-sale confirmation now also says when the nightly price will change at the same time (calendar.closeConfirmPrice).

## F845 — Toplu takvim değişikliği öncesi özet/onay ve geri alma yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:523` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | robustness · recoverability                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü           |
| Renk/tema           | Hayır                                       |
| Efor                | M                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p080)      |

**Kanıt:** CalendarForm submit (L431-445) doğrudan PUT; 'Satışa kapat' ve fiyat 365 geceye kadar tek tıkla uygulanır; sonuç yalnız 'Güncellenen gece: {updated}, eklenen: {created}, … atlanan: {skipped}' (L447-451).

**Etki:** Yanlış odayı ya da aralığı seçen host aylarca satışı kapatır veya fiyatı değiştirir; hata ancak rezervasyon gelmeyince fark edilir.

**Önerilen aksiyon:** Gönderim öncesi onay: '{room} için {from}–{to} ({n} gece): fiyat ₺X, satışa kapat. Onaylıyor musunuz?'; sonuç mesajında önceki değerlerle PUT yapan 'Geri al' düğmesi.

**Yapılan düzeltme:** Added the live summary of what will be applied (room, range, night count, price, open/close), linked to the submit button. Ranges over 31 nights now need confirmation (calendar.bulkConfirm), and closing for sale was already confirmed. The 'Geri al' (undo) button was not done: the PUT availability API does not return previous per-night prices or availability, so a correct undo would need a new server contract.

## F846 — AI taslağı açıklamaya aktarılamıyor; 'düzenleyip onaylayın' vaadi karşılıksız

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:567` |
| Diğer konumlar      | `messages/tr/host.json:93`                  |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | learnability · predictability               |
| Sezgisel madde      | H13 — Feedforward                           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p080)             |

**Kanıt:** HostDashboard.tsx:567-578 taslak salt metin; host.json:93 'Taslak (otomatik yayınlanmaz, düzenleyip onaylayın)' — onay/aktar düğmesi yok; ListingCopy PropertyPanel form state'ine erişmiyor (L323 '<ListingCopy propertyId={p.id} />').

**Etki:** Host uzun metni elle kopyalayıp açıklama alanına yapıştırmak zorunda (mobilde zor); 'onaylayın' talimatının nasıl yapılacağını bulamaz.

**Önerilen aksiyon:** 'Açıklamaya aktar (TR)' düğmesi → onApply(draft.tr) ile setForm({...form, description}) ve açıklama alanına odak; taslak etiketini 'Taslağı açıklamaya aktarıp düzenleyin, sonra Kaydet'e basın' yap.

**Yapılan düzeltme:** ListingCopy got a new optional onApply prop. PropertyPanel passes applyDraft, which puts the draft into the description field (it does not save), clears any stale saved message and moves focus to the description textarea; the dirty indicator then shows. Each language draft has its own 'Türkçe/İngilizce metni açıklamaya aktar' button, and a status message confirms the transfer. The draft label text now explains to transfer the draft, edit it, then press Save.

## F847 — AI ilan metni taslağı 'düzenleyip onaylayın' diyor ama uygulama/kopyalama eylemi yok

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:570` |
| Diğer konumlar      | `messages/tr/host.json:93`                  |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | learnability · predictability (feedforward) |
| Sezgisel madde      | H13 — Feedforward                           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | lens:copy                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p080)             |

**Kanıt:** HostDashboard.tsx:567-578 taslak yalnız <p> olarak 'TR: … / EN: …' basılır; host.json:93 'Taslak (otomatik yayınlanmaz, düzenleyip onaylayın)'. Taslağı açıklama alanına aktaran, düzenlenebilir kılan veya kopyalayan bir denetim yok.

**Etki:** Ev sahibi 'onayla' düğmesini arar; metni elle seçip kopyalamak zorunda kalır, EN metnin nereye gireceğini bilemez.

**Önerilen aksiyon:** Taslağın yanına 'Açıklamaya aktar' (formu doldurur, kaydetmez) ve 'Kopyala' düğmeleri ekleyin; metni 'Taslak — Açıklamaya aktarıp düzenledikten sonra Kaydet'e basın' olarak güncelleyin.

**Yapılan düzeltme:** Besides the 'Açıklamaya aktar' buttons from F846, each draft (TR and EN) has a 'metni kopyala' button using navigator.clipboard, with success and failure feedback in a Status region. The listingCopy.draft text changed to 'Taslak — otomatik yayınlanmaz. Açıklamaya aktarıp düzenleyin, sonra Kaydet düğmesine basın.'; the key is used only in this file.

## F848 — Fotoğraf için alternatif metin girilemiyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/host/HostDashboard.tsx:605`      |
| Diğer konumlar      | `src/components/property/PropertyGallery.tsx:31` |
| Kullanıcılar        | ev sahibi, misafir                               |
| Prensip             | accessibility · Non-text Content                 |
| Sezgisel madde      | H14 — Erişilebilirlik                            |
| WCAG                | 1.1.1                                            |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:host                                        |
| **Düzeltme durumu** | **Atlandı** (paket: ml-p080)                     |

**Kanıt:** HostDashboard.tsx:605-606 yalnız 'body.append("file", file)'; PropertyPhoto modelinde alt/açıklama alanı yok (prisma/schema.prisma:1061-1091); misafir galerisi genel metin kullanıyor: 'alt={t("gallery.imageAlt", { title, index: activeIndex + 1 })}' (src/components/property/PropertyGallery.tsx:31).

**Etki:** Misafir tarafında ekran okuyucu kullanıcısı yalnız 'İlan adı, görsel 3' duyar; odanın/banyonun ne gösterdiği aktarılmaz.

**Önerilen aksiyon:** Yükleme sonrası ve listede 'Fotoğraf açıklaması (ekran okuyucular için)' metin alanı; modele altText alanı; galeri alt'ı bunu kullansın, boşsa mevcut genel metne düşsün.

**Yapılan düzeltme:** Confirmed real: PropertyPhoto has no alt or description column (prisma/schema.prisma:1061), and the upload only sends 'file'. Fixing it needs a Prisma schema change plus migration, changes to the photo upload and PATCH API routes, and gallery changes, all outside this package. Adding an input to HostDashboard now would not persist anything and would mislead hosts. The backend parts are listed in crossOwner; the HostDashboard part (an alt-text field per photo in PhotoUpload that sends altText on upload or PATCH) should follow once the API accepts it.

## F849 — Kaydırılabilir tablo kapsayıcıları klavyeyle odaklanamıyor

| Alan                | Değer                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                     |
| Durum               | Aday                                                                                       |
| Konum               | `src/components/host/PartyRiskPanel.tsx:36`                                                |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:132`, `src/components/host/PromotionsPanel.tsx:155` |
| Kullanıcılar        | ev sahibi                                                                                  |
| Prensip             | accessibility · Keyboard                                                                   |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                      |
| WCAG                | 2.1.1                                                                                      |
| Renk/tema           | Hayır                                                                                      |
| Efor                | S                                                                                          |
| Kaynak denetçiler   | area:host                                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p090)                                                            |

**Kanıt:** PartyRiskPanel.tsx:36 '<div className="overflow-x-auto">' içinde odaklanabilir öğe yok; 360px'te 5 sütun + 'whitespace-nowrap' tarih (L62) taşar. HostDashboard.tsx:132 ve PromotionsPanel.tsx:155 aynı kalıp (bunlarda yalnız satır içi link/düğmeye odaklanınca kayar).

**Etki:** Yalnız klavye kullanan (Safari, eski Chrome) host taşan sütunları (skor, gerekçe) göremez.

**Önerilen aksiyon:** Kapsayıcıya 'tabIndex={0} role="region" aria-labelledby={captionId}' + focusRing; caption'a id ver.

**Yapılan düzeltme:** Confirmed: the scroll wrapper had no focusable content. It is now `relative max-w-full overflow-x-auto` plus focusRing, with role="region", tabIndex={0} and aria-labelledby pointing at the caption, which now has a useId id. HostDashboard (L334) and PromotionsPanel (L527) already use this pattern.

## F850 — Parti riski satırları eyleme bağlanmıyor; rezervasyon tanımlanamıyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/PartyRiskPanel.tsx:60` |
| Diğer konumlar      | `messages/tr/trust.json:54`                 |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | robustness · task conformance               |
| Sezgisel madde      | H7 — Esneklik/verim                         |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p090)             |

**Kanıt:** PartyRiskPanel.tsx:60-68 satır: ilan, tarih, misafir, skor, gerekçe; 'bookingId' (L8) mevcut ama bağlantı/sütun yok. trust.json:54 intro 'misafirle ev kurallarını teyit edin' diyor.

**Etki:** Host önerilen eylemi (misafire yazmak) yapmak için rezervasyonu alttaki tabloda tarih eşleştirerek bulmak zorunda kalır.

**Önerilen aksiyon:** Satıra 'Misafire yaz' linki '/host/messages/{bookingId}' (sr-only: ilan ve tarih) ve 'Rezervasyon no' sütunu.

**Yapılan düzeltme:** Confirmed. Added a 'Rezervasyon no' column showing the same short reference as HostDashboard (last 8 characters, monospace) and a 'Contact' column. CONFIRMED rows get a 'Misafire mesaj gönder' link whose sr-only text names the listing and check-in date; HELD rows show a 'messaging opens once confirmed' note. The property cell is now a row header (th scope=row).

## F851 — Parti riski tarihleri ham ISO; '→' sembolü sesli okunuyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/PartyRiskPanel.tsx:63` |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:164` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | learnability · consistency                  |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                 |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p090)             |

**Kanıt:** PartyRiskPanel.tsx:63 '{i.checkIn} → {i.checkOut}' — API 'toISOString().slice(0, 10)' (party-risk-service.ts:158-159) → '2026-10-15 → 2026-10-17'; aynı sayfadaki rezervasyon tablosu 'f.date(b.checkIn, "short")' (HostDashboard.tsx:164) kullanıyor.

**Etki:** TR kullanıcı alışık olmadığı yıl-ay-gün biçimini çözmek zorunda; iki tablo arasında tarih eşleştirmek zorlaşır; ekran okuyucu 'sağ ok' der.

**Önerilen aksiyon:** 'const f = useFormat()' ile '{f.date(i.checkIn, "short")} – {f.date(i.checkOut, "short")}' veya i18n anahtarı '{from} – {to}'; ok kullanılırsa aria-hidden + sr-only 'ile'.

**Yapılan düzeltme:** Confirmed: raw ISO dates with '→'. Replaced with useFormat's f.date(i.checkIn/checkOut,'short') through a new trust.partyRisk.dateRange key, '{from} – {to}', so screen readers no longer announce an arrow. I used 'short' to match HostDashboard's tables on the same page.

## F852 — Risk skorunun ölçeği ve eşiği yok; seviye yalnız kırmızı renkle ima ediliyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Medium                                      |
| Durum               | Aday                                        |
| Konum               | `src/components/host/PartyRiskPanel.tsx:66` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | learnability · familiarity                  |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                 |
| WCAG                | 1.4.1                                       |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p090)             |

**Kanıt:** PartyRiskPanel.tsx:66 '<td className="py-2 pr-3 font-semibold text-red-800">{i.score}</td>'; 0–100 ölçeği ve PARTY_RISK_THRESHOLD=60 (app-config.ts:606) arayüzde yok.

**Etki:** Host '72'nin yüksek mi düşük mü olduğunu bilemez; ciddiyet yalnız renkle verildiğinden renk körü kullanıcı ayrım yapamaz.

**Önerilen aksiyon:** '{i.score}/100 · Yüksek' biçiminde metin seviyesi (renge ek, renk değiştirmeden); intro'ya '60 ve üzeri skorlar listelenir' cümlesi.

**Yapılan düzeltme:** Confirmed. The score cell now reads '{score}/100 · Yüksek', so the level is in text as well as color; the color classes are unchanged. Every listed item is at or above the threshold, so 'High' is accurate. The intro gains a scale sentence. If the API returns `threshold`, the sentence names it ('60 ve üzeri skorlar listelenir'); otherwise it says only bookings above the warning threshold are listed. Showing the number needs the route change in crossOwner.

## F853 — Parti riski tablosu ölçeksiz skor ve ham tarih gösteriyor; önerilen eyleme bağlantı yok

| Alan                | Değer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| Severity            | Medium                                                                   |
| Durum               | Aday                                                                     |
| Konum               | `src/components/host/PartyRiskPanel.tsx:66`                              |
| Diğer konumlar      | `src/components/host/PartyRiskPanel.tsx:63`, `messages/tr/trust.json:54` |
| Kullanıcılar        | ev sahibi                                                                |
| Prensip             | robustness · observability                                               |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                           |
| Renk/tema           | Hayır                                                                    |
| Efor                | S                                                                        |
| Kaynak denetçiler   | lens:copy                                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p090)                                          |

**Kanıt:** PartyRiskPanel.tsx:66 `{i.score}` kırmızı kalın, ölçek (0–100?) ve eşik yok; 63 `{i.checkIn} → {i.checkOut}` ham ISO; trust.json:54 giriş 'misafirle ev kurallarını teyit edin' derken satırda mesaj bağlantısı yok (HostDashboard'da /host/messages/{id} mevcut).

**Etki:** Ev sahibi skorun ne kadar ciddi olduğunu yorumlayamaz ve önerilen eylemi yapmak için rezervasyonu başka tabloda arar.

**Önerilen aksiyon:** Skoru 'Yüksek (78/100)' gibi düzey + ölçekle yazın; tarihleri f.date(...,'medium') ile gösterin; her satıra 'Misafire mesaj gönder' bağlantısı (/host/messages/{bookingId}) ekleyin.

**Yapılan düzeltme:** Same fix as F529, F851 and F852: score shown with its scale and level, dates formatted, and a 'Misafire mesaj gönder' link to /host/messages/{bookingId} on CONFIRMED rows. I used the 'short' date style rather than 'medium' so dates match the booking table on the same page.

## F854 — Gönderilmeyi bekleyen tutar (pendingMinor) bakiye tablosunda gösterilmiyor

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | Medium                                   |
| Durum               | Aday                                     |
| Konum               | `src/components/host/PayoutPanel.tsx:58` |
| Kullanıcılar        | ev sahibi                                |
| Prensip             | robustness · observability               |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü           |
| Renk/tema           | Hayır                                    |
| Efor                | S                                        |
| Kaynak denetçiler   | area:host2                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p084)          |

**Kanıt:** PayoutPanel.tsx:58 `const BALANCE_KEYS = ["escrowMinor", "availableMinor", "reserveMinor", "paidMinor"]`; Overview tipinde `pendingMinor` var (42). src/lib/payout/overview.ts:91 `availableMinor: payable - pending`, :12 'açılmış, gönderilmeyi bekleyen payout'lar'.

**Etki:** Ödeme açıldığı anda tutar 'Serbest'ten düşer ama 'Ödenen'e girmez; ev sahibi parasının kaybolduğunu düşünür, destek talebi açar.

**Önerilen aksiyon:** BALANCE_KEYS'e `pendingMinor` ekleyin (Emanette → Rezervde → Serbest → Gönderimde → Ödenen sırası), messages'a 'Gönderimde' / 'In transit' etiketi ve tablo altı açıklaması ekleyin.

**Yapılan düzeltme:** Added pendingMinor to BALANCE_KEYS in flow order: escrow, reserve, available, pending, paid. Added label balances.pendingMinor ('Gönderimde' / 'In transit'). Rewrote balances.hint (used only here) to explain that released money shows under 'Gönderimde' first, then 'Ödenen'.

## F855 — Durum mesajları sonraki adımı göstermiyor (kimlik doğrulama gerekli, tahsilat yeniden denenecek, insan desteğe devredildi, KYC beklemede)

| Alan                | Değer                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                        |
| Durum               | Aday                                                                                                                                          |
| Konum               | `src/components/host/PayoutPanel.tsx:115`                                                                                                     |
| Diğer konumlar      | `src/components/booking/RnplPlan.tsx:58`, `src/components/support/SupportChat.tsx:148`, `src/components/account/IdentityVerification.tsx:124` |
| Kullanıcılar        | ev sahibi, misafir                                                                                                                            |
| Prensip             | learnability · predictability                                                                                                                 |
| Sezgisel madde      | H13 — Feedforward                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                         |
| Efor                | S                                                                                                                                             |
| Kaynak denetçiler   | lens:status                                                                                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p084)                                                                                                               |

**Kanıt:** PayoutPanel.tsx:115 `t(\`blocked.${acc.blockedReason}\`)`→ 'Kimlik doğrulaması gerekli' (payouts.json) ama /account'taki IdentityVerification'a bağlantı yok. RnplPlan.tsx:58 'Tahsilat başarısız oldu… Kartınızı kontrol edin.' — kart güncelleme eylemi yok. SupportChat.tsx:148 humanPending 'bir temsilci size dönecek' — kanal/süre yok. IdentityVerification.tsx:88 PENDING'de buton gizleniyor, otomatik yenileme yok; 124`t("lastError", { code })` → 'Sağlayıcı kodu: …'.

**Etki:** Ev sahibi ödemelerinin neden durduğunu görse de nerede çözeceğini bilmiyor; misafir başarısız tahsilatta rezervasyonu kaybetme riskine karşı eyleme geçemiyor; destek bekleyen misafir nereden yanıt geleceğini bilmiyor.

**Önerilen aksiyon:** IDENTITY_UNVERIFIED satırına 'Kimliğinizi doğrulayın →' (/account#kyc-title); RETRYING kartına 'Kartı güncelle' eylemi ve son tarih; handoff mesajına kanal ve süre ('E-postayla en geç 24 saat içinde'); KYC PENDING'de 30 sn'de bir yoklama ve lastError kodlarını çevrilmiş açıklamaya eşle.

**Yapılan düzeltme:** PayoutPanel part. The IDENTITY_UNVERIFIED link to /account#kyc-title was already there. Added a KYC PENDING state ('under review, check with Durumu yenile' plus a 'Doğrulama durumunu görün' link) instead of telling the user to verify again. When identity is required and no account exists, the policy item now links to /account#kyc-title. RnplPlan, SupportChat and IdentityVerification parts belong to other packages.

## F856 — Tek düğme iki iş yapıyor ('Durumu yenile / kaydet'); 'Değiştirme' seçeneği belirsiz

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/host/PayoutPanel.tsx:139` |
| Kullanıcılar        | ev sahibi                                 |
| Prensip             | learnability · predictability             |
| Sezgisel madde      | H13 — Feedforward                         |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:host2                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p084)           |

**Kanıt:** PayoutPanel.tsx:139-141 `{acc?.connected ? t("account.refresh") : t("account.connect")}`; messages/tr/payouts.json:40 'Durumu yenile / kaydet', :38 keepSchedule 'Değiştirme' (hem 'değiştirme!' emri hem 'değiştirme işlemi' okunur). 124-138 seçici hesap yokken de 'Değiştirme' ile gösteriliyor; başarı mesajı ilk bağlantıda da 'Ödeme hesabı güncellendi.' (84).

**Etki:** Ev sahibi düğmenin takvimi mi kaydedeceğini yoksa yalnız durumu mu yenileyeceğini öngöremez; ilk bağlantıda 'mevcut takvim' olmadığı halde 'Değiştirme' seçeneğiyle karşılaşır.

**Önerilen aksiyon:** İki ayrı eylem: 'Takvimi kaydet' (yalnız schedule değişince etkin) ve 'Durumu yenile'. Seçenek metni 'Mevcut takvimi koru ({current})'; acc null iken bu seçeneği gizleyip varsayılanı açıkça seçin; ilk bağlantıda 'Ödeme hesabı bağlandı.' mesajı.

**Yapılan düzeltme:** Split the dual button. With a connected account there is a secondary 'Durumu yenile' (POST {}) and 'Ödeme takvimini kaydet' (POST {schedule}). The save button is aria-disabled and click-guarded until the schedule differs from the current one; aria-disabled is used instead of disabled so focus stays. The 'Değiştirme' option is removed: the select starts at the current schedule, or explicitly at DAILY (the server default) before connecting. A hint, wired with aria-describedby, gives the current schedule or 'connected with this schedule'. Success messages are now separate: 'Ödeme hesabı bağlandı.' / 'Ödeme takvimi kaydedildi.' / existing 'Ödeme hesabı güncellendi.' for refresh. An account that exists but isn't connected (e.g. admin-paused) still shows the connect button. Errors now go through useErrorText.

## F857 — Ödeme hesabı ekranında 'Durumu yenile / kaydet' çift anlamlı; kimlik eksikliğinde çözüm yolu yok

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                      |
| Durum               | Aday                                                                                        |
| Konum               | `src/components/host/PayoutPanel.tsx:140`                                                   |
| Diğer konumlar      | `messages/tr/payouts.json:27`, `messages/tr/payouts.json:40`, `messages/tr/payouts.json:43` |
| Kullanıcılar        | ev sahibi                                                                                   |
| Prensip             | learnability · predictability                                                               |
| Sezgisel madde      | H13 — Feedforward                                                                           |
| Renk/tema           | Hayır                                                                                       |
| Efor                | S                                                                                           |
| Kaynak denetçiler   | lens:copy                                                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p084)                                                             |

**Kanıt:** PayoutPanel.tsx:140 `acc?.connected ? t("account.refresh") : t("account.connect")` → payouts.json:40 'Durumu yenile / kaydet'; 115 blockedReason IDENTITY_UNVERIFIED → payouts.json:27 'Kimlik doğrulaması gerekli' (Hesabım'daki doğrulama bölümüne bağlantı yok); policy (payouts.json:43) dört sayıyı tek cümlede verir.

**Etki:** Ev sahibi düğmenin takvimi mi kaydedeceğini yoksa sadece durumu mu yenileyeceğini bilemez; ödemesi bloke olduğunda ne yapacağını bulamaz.

**Önerilen aksiyon:** İki ayrı düğme: 'Ödeme takvimini kaydet' ve 'Durumu yenile'; IDENTITY_UNVERIFIED metnine '/account#kyc-title' bağlantısı ekleyin ('Kimliğinizi doğrulayın →'); politika cümlesini madde listesine bölün.

**Yapılan düzeltme:** Same button split as F856. account.refresh text changed to 'Durumu yenile' / 'Refresh status', and resolve.providerDisabled was updated to match. The identity link was already present, and the PENDING case is added. The single policy sentence is now a bullet list (policyList.release / commission / reserve / reserveUnknown, plus the identityRequired item). The Turkish reserve line uses '%{reserve} kadarı' to avoid the wrong-suffix problem, and English uses ICU plurals for hours/days.

## F858 — Ödeme terimleri: TR metinde İngilizce 'payout'; 'Serbest', 'Rezervde', 'Ödenen' açıklanmamış, emanet tanımı çelişkili

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/host/PayoutPanel.tsx:189` |
| Kullanıcılar        | ev sahibi                                 |
| Prensip             | learnability · familiarity                |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi               |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:host2                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p085)           |

**Kanıt:** messages/tr/payouts.json:6 '…ve payout geçmişinizi izleyin'; :51-52 'Serbest', 'Rezervde'; PayoutPanel.tsx:189 hint yalnız emanet ve serbesti açıklıyor: 'Emanetteki tutar konaklama başlayana kadar…' — oysa politika (payouts.json:43) 'girişten {hours} saat sonra serbest bırakılır' diyor.

**Etki:** Ev sahibi rezervdeki paranın neden tutulduğunu, ne zaman açılacağını ve emanetin tam olarak ne zaman serbest kalacağını anlayamaz; çelişen iki tanım güveni azaltır.

**Önerilen aksiyon:** 'payout' yerine 'ödeme aktarımı' kullanın; tablonun altına her sütun için tek cümlelik <dl> tanım listesi ekleyin (Rezervde: 'Olası iade/itiraz için {days} gün tutulur'; Ödenen: 'Banka hesabınıza gönderildi'); emanet tanımını politikayla eşleyin ('girişten {hours} saat sonrasına kadar').

**Yapılan düzeltme:** In TR, page.intro now says 'ödeme geçmişinizi' instead of 'payout geçmişinizi', which matches the 'Ödeme geçmişi' card title. Under the balance table, the old hint paragraph is now a short lead sentence followed by a <dl> with one definition per column (balances.terms.*). The escrow definition now follows the release policy ('girişten {hours} saat sonra … serbest bırakılır'). Reserve reads 'olası iade ve itirazlara karşı {days} gün tutulur', and Paid out reads 'Banka hesabınıza gönderildi'.

## F859 — Ödeme geçmişi mutabakat için yetersiz: tarih sütunu iki anlam taşıyor, referans no yok, 50 kayıt sınırı belirtilmiyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/host/PayoutPanel.tsx:217` |
| Kullanıcılar        | ev sahibi                                 |
| Prensip             | robustness · task conformance             |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü            |
| Renk/tema           | Hayır                                     |
| Efor                | M                                         |
| Kaynak denetçiler   | area:host2                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p085)           |

**Kanıt:** PayoutPanel.tsx:217 `f.date(p.paidAt ?? p.createdAt, "short")` tek 'Tarih' sütununda; `reference` Overview'da var (51) ama render edilmiyor; src/lib/payout/overview.ts:38 `HISTORY_LIMIT = 50`, caption yalnız 'Son ödemeler'.

**Etki:** Ev sahibi banka ekstresiyle eşleştirirken bekleyen satırda oluşturma, ödenmiş satırda ödeme tarihini karşılaştırdığını bilmez; referans numarası olmadan transferi bulamaz; eski kayıtların kesildiğini fark etmez.

**Önerilen aksiyon:** 'Oluşturulma' ve 'Ödeme tarihi' (bekleyende '—') sütunlarını ayırın, 'Referans' sütunu ekleyin, caption'ı 'Son 50 ödeme' yapın; tamamı için CSV indirme bağlantısı ekleyin.

**Yapılan düzeltme:** History now has separate 'Oluşturulma' (createdAt) and 'Ödeme tarihi' (paidAt) columns. An unpaid row shows a visible '—' and the screen-reader text 'Henüz ödenmedi'. A new 'Referans' column shows the reference in monospace, or '—' with 'Referans yok'. When the list hits the 50-row server limit, a visible note says only the latest 50 are shown. A 'Tüm ödeme geçmişini indir (CSV)' link points to a new route, GET /api/host/payouts/export (HOST/ADMIN). It returns every payout as CSV, escapes cells and guards against formula injection. The sr-only caption keeps its current text, and the visible note covers the cut-off.

## F860 — Başarısız ödemede ham sağlayıcı kodu gösteriliyor; ne yapılacağı belirtilmiyor

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Medium                                    |
| Durum               | Aday                                      |
| Konum               | `src/components/host/PayoutPanel.tsx:222` |
| Kullanıcılar        | ev sahibi                                 |
| Prensip             | robustness · recoverability               |
| Sezgisel madde      | H9 — Hata mesajları                       |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:host2                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p085)           |

**Kanıt:** PayoutPanel.tsx:221-222 `{t(`history.statuses.${p.status}`)}{p.failureCode ? ` (${p.failureCode})` : ""}` → ör. 'Başarısız (account_closed)'.

**Etki:** Ev sahibi İngilizce teknik kodu yorumlayamaz; paranın yeniden deneneceğini mi yoksa hesap bilgisini mi düzeltmesi gerektiğini bilemez.

**Önerilen aksiyon:** messages'a `history.failures.<code>` eşlemesi ekleyin ('Banka hesabı kapalı — ödeme hesabınızı güncelleyin'), bilinmeyen kodlarda genel metin + `/support` bağlantısı; ham kodu yalnız sr-only olmayan küçük 'Kod:' notu olarak bırakın.

**Yapılan düzeltme:** Confirmed but partly addressed already: the raw code was no longer appended, but only 3 codes had explanations. A new PayoutFailure subcomponent maps the bank codes account_closed, account_frozen, bank_account_restricted, invalid_account_number, no_account and account_invalid to localized reasons, and unknown codes fall back to 'other'. Each failure also says what happens to the money: it stays in the released balance and goes out with the next payout. Account problems get an action link (Stripe onboardingUrl, or #payout-account); everything else links to /support. The raw code appears only in a small 'Destek için hata kodu: {code}' note.

## F861 — Tür değişince koşul değeri (30) yeni türe taşınıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/host/PromotionsPanel.tsx:65`  |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx:244` |
| Kullanıcılar        | ev sahibi                                     |
| Prensip             | learnability · predictability                 |
| Sezgisel madde      | H5 — Hata önleme                              |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:host                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p086)               |

**Kanıt:** PromotionsPanel.tsx:65 'condition: "30"' tüm türler için tek alan; L244 'setForm({ ...form, type: e.target.value })' condition'ı sıfırlamaz. 'Uzun konaklama'ya geçince alan 'En az gece: 30' olur.

**Etki:** Host fark etmeden yalnız 30+ gecelik konaklamalara uygulanan, pratikte hiç tetiklenmeyen promosyon oluşturur.

**Önerilen aksiyon:** Tür başına varsayılan (EARLY_BIRD 30, LAST_MINUTE 3, LONG_STAY 7) ve tür değişiminde condition'ı bu varsayılana sıfırla.

**Yapılan düzeltme:** Each type now has its own default condition (EARLY_BIRD 30, LAST_MINUTE 3, LONG_STAY 7). Changing the type resets the condition to that default instead of carrying the old value over.

## F862 — Durdur/Etkinleştir başarısında durum mesajı yok

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/host/PromotionsPanel.tsx:123` |
| Kullanıcılar        | ev sahibi                                     |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H12 — Feedback                                |
| WCAG                | 4.1.3                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:host                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p086)               |

**Kanıt:** PromotionsPanel.tsx:116-123 toggle başarıda yalnız 'reload();' — setStatus mesajı yok; Durum hücresi (L196-198) sessizce 'Aktif'→'Pasif' olur.

**Etki:** Ekran okuyucu kullanıcısı işlemin gerçekleştiğini duymaz; gören kullanıcı da değişikliği tablo içinde aramak zorunda kalır.

**Önerilen aksiyon:** Başarıda 'setStatus({ message: t(p.active ? "promotions.paused" : "promotions.activated", { name: p.name }) })' (yeni anahtarlar: '«{name}» durduruldu.' / 'etkinleştirildi.'); Status aria-live ile duyurulur.

**Yapılan düzeltme:** After a successful pause or activate, the panel shows '«{name}» durduruldu.' or '«{name}» etkinleştirildi.' in the list Status (role=status). Focus then returns to the same row's toggle button after the list reloads, even if the row moves.

## F863 — Promosyon silme onaysız ve sonucu öngörülemez (silinir ya da durdurulur)

| Alan                | Değer                                             |
| ------------------- | ------------------------------------------------- |
| Severity            | Medium                                            |
| Durum               | Aday                                              |
| Konum               | `src/components/host/PromotionsPanel.tsx:129`     |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx:205-213` |
| Kullanıcılar        | ev sahibi                                         |
| Prensip             | robustness · recoverability                       |
| Sezgisel madde      | H5 — Hata önleme                                  |
| Renk/tema           | Hayır                                             |
| Efor                | S                                                 |
| Kaynak denetçiler   | lens:copy                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p086)                   |

**Kanıt:** PromotionsPanel.tsx:129-140 remove() doğrudan DELETE çağırır; 135 sonuç ya 'Promosyon silindi.' ya da 'Promosyon kullanıldığı için silinmedi, durduruldu.' — kullanıcı ancak sonradan öğrenir. 205-213 'Durdur/Sil' düğmeleri yan yana; öncelik alanı (-1000..1000) yalnız 'Yüksek öncelik önce uygulanır.' ipucuyla soyut kalır.

**Etki:** Ev sahibi kupon kodunu yanlışlıkla kalıcı siler; promosyonların hangisinin uygulanacağını öngöremez.

**Önerilen aksiyon:** Silmeden önce 'Bu promosyon {n} kez kullanıldı; silinemez, durdurulacak' veya 'Kalıcı olarak silinsin mi?' onayı gösterin; öncelik alanını 'Düşük/Normal/Yüksek' seçimine indirgeyin.

**Yapılan düzeltme:** The delete confirmation now states the outcome in advance. For a used promotion it says it was used N times, cannot be deleted and will be paused instead. For an unused one it says the delete is permanent. A used promotion that is already paused gets an explanation and no API call. The numeric priority input is now a Düşük/Normal/Yüksek select (-10/0/10), and legacy values stay available as an 'Özel (n)' option.

## F864 — Silme/kaldırma ve busy sonrası klavye odağı kayboluyor

| Alan                | Değer                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                               |
| Durum               | Aday                                                                                                                                                                                 |
| Konum               | `src/components/host/PromotionsPanel.tsx:136`                                                                                                                                        |
| Diğer konumlar      | `src/components/host/DepositSettings.tsx:151`, `src/components/host/HostDashboard.tsx:625`, `src/components/host/HostDashboard.tsx:301`, `src/components/host/HostDashboard.tsx:643` |
| Kullanıcılar        | ev sahibi                                                                                                                                                                            |
| Prensip             | accessibility · Focus Order                                                                                                                                                          |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                |
| WCAG                | 2.4.3                                                                                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                                                                |
| Efor                | M                                                                                                                                                                                    |
| Kaynak denetçiler   | area:host                                                                                                                                                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p086)                                                                                                                                                      |

**Kanıt:** PromotionsPanel.tsx:136 Sil sonrası 'reload()' satırı (ve odaklı düğmeyi) DOM'dan kaldırır; DepositSettings.tsx:151 '{row.amountMinor !== null && (<Button …>Kaldır)}' kaldırma sonrası düğme kaybolur; HostDashboard.tsx:625 'setResult(null)' Fotoğrafı kaldır düğmesini kaldırır; L301, L558, L643 'disabled={busy}' odaklı öğeyi devre dışı bırakır.

**Etki:** Klavye/ekran okuyucu kullanıcısında odak <body>'ye düşer; uzun sayfada konum kaybolur, kullanıcı sayfanın başından yeniden Tab'lamak zorunda kalır.

**Önerilen aksiyon:** Silme sonrası odağı sonraki satırın eylem düğmesine ya da tabIndex={-1} kart başlığına taşı (ref + focus()); depozito kaldırma sonrası odağı tutar input'una; busy sırasında disabled yerine aria-disabled='true' + onClick guard.

**Yapılan düzeltme:** Row buttons are kept in a ref map and a pending-focus target is applied after the list reloads. After a delete, focus moves to the neighbouring row's 'Düzenle' button, or to the list container (tabIndex=-1, which holds the status and empty text) when no rows are left. After a pause/activate, a paused-instead-of-deleted result, or saving an edit, focus returns to that row's button. Busy rows use aria-disabled plus a click guard instead of disabled. The DepositSettings and HostDashboard parts belong to other packages.

## F865 — Promosyon formu geri bildirimi kartın tepesinde; yükleme hatası işlem hatasını gizliyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/host/PromotionsPanel.tsx:149` |
| Kullanıcılar        | ev sahibi                                     |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H12 — Feedback                                |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:host                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p086)               |

**Kanıt:** PromotionsPanel.tsx:149 '<Status error={error ?? status.error} message={status.message} />' tablonun üstünde; form ve 'Promosyon ekle' düğmesi kartın en altında (L346-350). 'error ?? status.error' yükleme hatası varken gönderim hatasını hiç göstermez.

**Etki:** Mobilde veya uzun tabloda başarı/hata mesajı görüş alanı dışında kalır; host oluşturma sonucunu göremeyip yeniden gönderir (kopya) ya da hatayı kaçırır.

**Önerilen aksiyon:** Formun submit düğmesi yanına ikinci bir Status (form sonuçları) koy; üstteki Status yalnız yükleme ve satır işlemleri için; yükleme ve işlem hatalarını ayrı satırlarda göster; başarıda yeni satıra scrollIntoView ve kısa vurgu.

**Yapılan düzeltme:** A load error and an action result now render in separate Status elements, so one no longer hides the other (the old code showed `error ?? status.error`). Form results stay next to the submit button. The short highlight on the new row is skipped because it would need a new color.

## F866 — Mevcut promosyon düzenlenemiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/host/PromotionsPanel.tsx:199`  |
| Diğer konumlar      | `src/app/api/host/promotions/[id]/route.ts:13` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | robustness · recoverability                    |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü              |
| Renk/tema           | Hayır                                          |
| Efor                | M                                              |
| Kaynak denetçiler   | area:host                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p086)                |

**Kanıt:** Satır eylemleri yalnız toggle ve sil (L199-215); PATCH /api/host/promotions/[id] updatePromotionSchema ile tüm alanları destekliyor (src/app/api/host/promotions/[id]/route.ts:13-23).

**Etki:** Oranı değiştirmek için sil+yeniden oluştur gerekir; kullanılmış promosyon silinemeyip durdurulduğundan listede eski kopyalar birikir.

**Önerilen aksiyon:** Satıra 'Düzenle' düğmesi (sr-only ad ile) → formu kayıtla doldur, submit PATCH; form başlığı 'Promosyonu düzenle' ve 'Vazgeç'.

**Yapılan düzeltme:** Each row has a 'Düzenle' button with the promotion name as sr-only text. It fills the form, sets the visible h3 to 'Promosyonu düzenle: {name}' (the form uses aria-labelledby) and moves focus to the name field. Submitting sends a PATCH with every field set explicitly, with null for fields that no longer apply. Edit mode shows 'Değişiklikleri kaydet' and 'Vazgeç', and Vazgeç returns focus to the row. The usage limit's min equals the current usage count.

## F867 — Ev sahibi/misafir silme eylemleri (promosyon, erişilebilirlik özelliği, depozito, sepet kalemi, ajan yetkisi, devir bağlantısı) onaysız ve geri alınamaz

| Alan                | Değer                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                                                                                                                   |
| Durum               | Aday                                                                                                                                                                                                                                                                     |
| Konum               | `src/components/host/PromotionsPanel.tsx:209`                                                                                                                                                                                                                            |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx:135-142,242-248`, `src/components/host/DepositSettings.tsx:151-155`, `src/app/cart/page.tsx:39-40,183-191`, `src/components/account/AgentMandates.tsx:93-104,213-221`, `src/components/transfers/TransferMarket.tsx:205-211` |
| Kullanıcılar        | ev sahibi, misafir                                                                                                                                                                                                                                                       |
| Prensip             | robustness · recoverability                                                                                                                                                                                                                                              |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                                                                                                                        |
| WCAG                | 3.3.4                                                                                                                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                    |
| Efor                | M                                                                                                                                                                                                                                                                        |
| Kaynak denetçiler   | lens:forms                                                                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p087)                                                                                                                                                                                                                                         |

**Kanıt:** src/components/host/PromotionsPanel.tsx:129-140, :207-214 'Sil' doğrudan DELETE; src/components/host/AccessibilityPanel.tsx:135-142, :242-248 'Sil' (danger) onaysız; src/components/host/DepositSettings.tsx:151-155 'Kaldır'; src/app/cart/page.tsx:39-40, :183-191 kalem 'Kaldır' (sepeti boşaltma ise :44-45'te onaylı — tutarsız); src/components/account/AgentMandates.tsx:93-104, :213-221 'İptal et'; src/components/transfers/TransferMarket.tsx:209 'Gizle' yalnızca bir kez gösterilen devir bağlantısını kalıcı olarak gizliyor.

**Etki:** Ev sahibi yanlış satırdaki aktif promosyonu siler (kullanım sayacı ve kuponu kaybolur); misafir tek seferlik devir bağlantısını 'Gizle' ile kaybeder ve alıcıya iletemez.

**Önerilen aksiyon:** Bu eylemler için ortak <ConfirmButton> ('Sil' → satır içi 'Silinsin mi? Evet / Vazgeç') ya da 'Geri al' süreli toast; devir bağlantısında 'Gizle' yerine 'Kopyaladım, kapat' + onay; sepet kalemi kaldırmada 'Geri al' bağlantısı (kalemi yeniden ekler).

**Yapılan düzeltme:** Already fixed in PromotionsPanel. remove() asks through useConfirm() (danger tone) before DELETE, and the dialog names the promotion. A used promotion gets its own 'cannot delete, pause instead?' title, body and confirm label, and an inactive used promotion is refused with a message. All other files listed (AccessibilityPanel, DepositSettings, cart page, AgentMandates, TransferMarket) already use confirm through their own owners.

## F868 — Promosyon 'Sil' düğmesi onaysız ve 'Devre dışı bırak'ın 12px yanında

| Alan                | Değer                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                       |
| Durum               | Aday                                                                                         |
| Konum               | `src/components/host/PromotionsPanel.tsx:209`                                                |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx:129`, `src/components/host/PromotionsPanel.tsx:199` |
| Kullanıcılar        | ev sahibi                                                                                    |
| Prensip             | robustness · recoverability                                                                  |
| Sezgisel madde      | H5 — Hata önleme                                                                             |
| Renk/tema           | Hayır                                                                                        |
| Efor                | S                                                                                            |
| Kaynak denetçiler   | lens:mobile                                                                                  |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p087)                                                             |

**Kanıt:** PromotionsPanel.tsx:199 `<td className="space-x-3 whitespace-nowrap py-2">` içinde etkinleştir/devre dışı bırak düğmesi ile :209 `onClick={() => remove(p)}` yan yana. :129-140 `remove` onay istemeden doğrudan DELETE çağırıyor. Oysa PasskeyManager.tsx:87, SessionManager.tsx:71 ve cart/page.tsx:45 silmeden önce onay istiyor. Tablo :155 `overflow-x-auto` içinde ve düğmeler son sütunda.

**Etki:** Ev sahibi mobilde yana kaydırılmış tabloda 'Devre dışı bırak' yerine 'Sil'e dokunursa kampanya ve kupon kodu kalıcı olarak siliniyor. Platform içinde de tutarsız bir davranış.

**Önerilen aksiyon:** Silmeden önce satır içi onay göster: '"{ad}" silinsin mi? Kullanım geçmişi kaybolur — Sil / Vazgeç'. İki eylemi birbirinden ayır ('Sil'i bir ⋯ menüsüne ya da ayrı satıra al). Alternatif olarak silme yerine 5 saniyelik 'Geri al' toast'ı olan, geri alınabilir bir 'Arşivle' eylemi kullan.

**Yapılan düzeltme:** Already fixed. 'Sil' opens the ConfirmDialog, whose title is «{name}» silinsin mi? and whose body warns the action can't be undone (or offers to pause a used promotion). The delete button is also kept apart from Düzenle/Durdur by gap-x-4 plus ml-4.

## F869 — Promosyon geçerlilik tarihi verilemiyor ve listede görünmüyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/host/PromotionsPanel.tsx:223` |
| Diğer konumlar      | `src/lib/pricing/promotion-service.ts:47`     |
| Kullanıcılar        | ev sahibi                                     |
| Prensip             | robustness · task conformance                 |
| Sezgisel madde      | H7 — Esneklik/verim                           |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:host                                     |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p087)              |

**Kanıt:** Şema 'startsAt', 'endsAt' alanlarını destekliyor (src/lib/pricing/promotion-service.ts:47-48); form (L223-351) ve tablo başlıkları (L159-181) bu alanları içermiyor.

**Etki:** Sezonluk/kampanya promosyonu süresiz başlar; host bitişi hatırlayıp elle durdurmak zorundadır.

**Önerilen aksiyon:** Forma opsiyonel 'Başlangıç'/'Bitiş' date alanları (boş = süresiz, bitiş min=başlangıç); tabloya 'Geçerlilik' sütunu.

**Yapılan düzeltme:** Already fixed. The form has optional start and end date inputs: an empty end means no end date, the end input's min is the start date, end-before-start shows a field error, and the start/end hints come from p086 keys. The table has a 'Geçerlilik' column (validityText), and edit pre-fills both dates.

## F870 — Promosyon türleri, öncelik ve 'Ad' alanının etkisi açıklanmıyor

| Alan                | Değer                                                    |
| ------------------- | -------------------------------------------------------- |
| Severity            | Medium                                                   |
| Durum               | Aday                                                     |
| Konum               | `src/components/host/PromotionsPanel.tsx:246`            |
| Diğer konumlar      | `messages/tr/host.json:127`, `messages/tr/host.json:157` |
| Kullanıcılar        | ev sahibi                                                |
| Prensip             | learnability · predictability                            |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                               |
| Renk/tema           | Hayır                                                    |
| Efor                | S                                                        |
| Kaynak denetçiler   | area:host                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p087)                          |

**Kanıt:** PromotionsPanel.tsx:246-250 seçenekler yalnız ad ('Mobil fiyat' nerede geçerli belirtilmez, host.json:127); L319-332 öncelik -1000..1000, hint 'Yüksek öncelik önce uygulanır.' (host.json:157); L228 'Ad' alanının misafire teklifte görünüp görünmediği belirtilmez (intro: 'İndirimler teklifte ayrı satır olarak görünür').

**Etki:** Partial okuryazar host türleri ve öncelik/birleşebilirlik etkileşimini anlayamaz; misafire görünecek adı iç not gibi yazabilir.

**Önerilen aksiyon:** Tür seçiminin altına aria-describedby ile tür açıklaması (ör. 'Mobil fiyat: yalnız mobil cihazdan yapılan rezervasyonlarda'); Ad için hint 'Misafire teklifte bu adla görünür'; öncelik ve birleşebilir alanlarını 'Gelişmiş ayarlar' <details> içine al, örnekli açıklama ekle.

**Yapılan düzeltme:** The code already had the type description hint (wired by Field through aria-describedby), the hint on the name field, the 'Gelişmiş ayarlar' <details> with a summary line, and the stackable hint. Their message keys were missing from messages/ and from every patch, so I added promotions.typeHelp.*, form.nameFieldHint ('Misafirler indirimi teklifte bu adla görür…'), form.advanced, form.advancedSummary (ICU select) and form.stackableHint in TR and EN. I also reworded form.priorityHint to explain the tie-break, with a worked example.

## F871 — Boş veri durumu ayırt edilmiyor: sıfır pickup düz çizgi, envanter yokken KPI'lar %0/₺0

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/host/RevenueDashboard.tsx:64` |
| Kullanıcılar        | ev sahibi                                     |
| Prensip             | robustness · observability                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:host2                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)               |

**Kanıt:** RevenueDashboard.tsx:64 `if (points.length === 0) return …t("pickup.noData")` hiç tetiklenmez; computePickup her zaman REVENUE_PICKUP_DAYS kadar nokta döndürür (src/lib/pricing/revenue.ts:139-144). docs/img/host-revenue.png'de grafik düz çizgi ve tepe etiketi '1'. availableRoomNights 0 iken KPI'lar '%0.0', '₺0,00' gösteriyor (261-269).

**Etki:** Yeni ev sahibi boş grafiği ve sıfırları hata ya da düşük performans sanar; envanter açmadığı için veri olmadığını ve ne yapacağını öğrenemez.

**Önerilen aksiyon:** `points.every(p => p.onBooks === 0)` ise grafik yerine 'Son 30 günde bu dönem için rezervasyon girilmedi' metni; `k.availableRoomNights === 0` ise KPI'lar yerine 'Bu dönem için müsaitlik açılmamış — takvimden açın' metni ve `/host` bağlantısı gösterin.

**Yapılan düzeltme:** Confirmed: points.length is never 0. When every point has onBooks===0, the chart is replaced by a 'no bookings yet for this period' message. When availableRoomNights===0, the KPI grid is replaced by text saying no availability is open, with a link to /host#host-properties (the calendar).

## F872 — Çubuk ve çizgi aynı y-ölçeğinde; günlük pickup çubukları görünmeyecek kadar kısa, eksen birimi yok

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Aday                                          |
| Konum               | `src/components/host/RevenueDashboard.tsx:70` |
| Kullanıcılar        | ev sahibi                                     |
| Prensip             | learnability · synthesizability               |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                  |
| Renk/tema           | Hayır                                         |
| Efor                | M                                             |
| Kaynak denetçiler   | area:host2                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)               |

**Kanıt:** RevenueDashboard.tsx:65 `const max = Math.max(1, ...points.map((p) => p.onBooks))`, 70 `y = …(v / max) * innerH` hem çizgi hem çubuk (98-100 `y(p.pickup)`) için kullanılıyor. Tek y etiketi 108-110 `{max}` birimsiz; ızgara çizgisi yok.

**Etki:** Toplam 120 oda-gece varken günlük +2'lik giriş ≈2px yüksekliğinde kalır; ev sahibi günlük rezervasyon temposunu (grafiğin asıl amacı) okuyamaz, tepedeki sayının neyi ifade ettiğini bilemez.

**Önerilen aksiyon:** Çubukları kendi maksimumuyla ayrı alt bantta çizin (ör. alt %35 alan, `maxPickup`) ya da iki küçük grafik yapın; y eksenine 'oda-gece' birimi, 0/orta/maks ızgara çizgileri ve çizginin son değerine etiket ekleyin.

**Yapılan düzeltme:** Confirmed shared y-scale. Split into two bands: the line chart (h-24) has its own max, dashed max and mid gridlines, a baseline, and a label 'Ölçek 0–{max} · son değer {last}'. The daily bars (h-12) are scaled to their own maximum with their own unit and scale label. Both bands share the x mapping, with a date row underneath.

## F873 — Grafik metinleri 360px ekranda yaklaşık 5px'e küçülüyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:108` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | accessibility · readability (mobile)           |
| Sezgisel madde      | H14 — Erişilebilirlik                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)                |

**Kanıt:** RevenueDashboard.tsx:58 `CHART = { width: 640, … }`, 80 `className="h-auto w-full"`, 108/111/117 `fontSize={11}`. 360px'te içerik genişliği ≈288px (main px-4 + Card p-5) → ölçek ≈0.45 → yazı ≈5px.

**Etki:** Mesajlar için mobil kullanan ev sahibi paneli telefonda açtığında tarih ve maksimum etiketlerini okuyamaz.

**Önerilen aksiyon:** Eksen etiketlerini SVG dışına HTML olarak taşıyın (`<div className="flex justify-between text-xs">ilk tarih / son tarih</div>`, maksimum değeri üstte HTML ile) ya da grafiği `min-w-[480px]` + `overflow-x-auto` kabına alın.

**Yapılan düzeltme:** Confirmed (fontSize 11 in a 640 viewBox scaled to about 288px). All chart text is now HTML at text-xs; the SVGs only hold shapes with non-scaling strokes, so text size does not depend on viewport width.

## F874 — Kabul/ret sonrası başarı bildirimi yok ve odaklanmış satır DOM'dan kalkıyor (odak kaybı)

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Medium                                           |
| Durum               | Aday                                             |
| Konum               | `src/components/host/RevenueDashboard.tsx:148`   |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx:244` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | robustness · observability                       |
| Sezgisel madde      | H12 — Feedback                                   |
| WCAG                | 2.4.3                                            |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)                  |

**Kanıt:** RevenueDashboard.tsx:147-148 başarıda yalnız `onDecided()` → reload; overview yalnız PENDING öneriler döndürdüğünden (src/lib/pricing/revenue.ts:204) satır kaybolur, hiçbir mesaj yazılmaz, odaklı düğme yok olur ve odak body'ye düşer. Aynı desen AccessibilityPanel.tsx:244 silme sonrası.

**Etki:** Klavye/ekran okuyucu kullanıcısı işlemin başarılı olup olmadığını duymaz ve sayfa başına atılır; gören kullanıcı da satırın neden kaybolduğunu ancak tahmin eder.

**Önerilen aksiyon:** Mesajı üst bileşene taşıyın: `onDecided(t("suggestions.accepted", {room, date, price}))` ile PropertyRevenue'daki Status'a yazın. Satır kalkınca odağı bir sonraki önerinin başlığına (tabIndex=-1) ya da liste yoksa Card başlığına `focus()` ile taşıyın.

**Yapılan düzeltme:** A success message was already set in PropertyRevenue's persistent Status. Added focus management: onDecided records the next (or previous) suggestion's title id, or the empty-state id. After reload, an effect focuses that h3 (tabIndex=-1, focus ring), with a fallback to the first title or the empty text. The AccessibilityPanel instance of the same pattern is passed to its owner as crossOwner.

## F875 — Mevcut → önerilen fiyat ilişkisi yalnız '→' simgesiyle; fark veya yüzde gösterilmiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:162` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | accessibility · Info and Relationships         |
| Sezgisel madde      | H6 — Tanıma > hatırlama                        |
| WCAG                | 1.3.1                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)                |

**Kanıt:** RevenueDashboard.tsx:162-163 `{f.money(s.currentMinor, s.currency)} →{" "}<strong>{f.money(s.suggestedMinor, s.currency)}</strong>`. Hangi tutarın mevcut, hangisinin önerilen olduğu metinle belirtilmiyor; değişim tutarı/yüzdesi yok.

**Etki:** Ekran okuyucu '1.200 lira sağ ok 1.350 lira' okur; anlam belirsiz kalır. Gören kullanıcı da artış oranını zihinden hesaplamak zorunda.

**Önerilen aksiyon:** `<span className="sr-only">{t("suggestions.current")}:</span>{mevcut} <span aria-hidden="true">→</span> <span className="sr-only">{t("suggestions.suggested")}:</span><strong>{önerilen}</strong>` ve yanına `(+%12,5)` biçiminde fark ekleyin (f.number style percent, signDisplay "exceptZero").

**Yapılan düzeltme:** The price line now has sr-only 'Mevcut fiyat:', 'Önerilen fiyat:' and 'Değişim:' labels. The arrow is aria-hidden. A localized percent change is shown with f.number (style percent, signDisplay exceptZero), e.g. (+%15).

## F876 — Her öneride aynı 'Kabul et / Reddet' etiketi; bağlam dışı düğme listesinde ayırt edilemiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:208` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | accessibility · Headings and Labels            |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                    |
| WCAG                | 2.4.6                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)                |

**Kanıt:** RevenueDashboard.tsx:208-213 düğmeler yalnız `{t("suggestions.accept")}` / `{t("suggestions.reject")}`; oda/tarih bilgisi 158-160'daki <p> içinde, düğmeyle ilişkilendirilmemiş. Aynı alandaki AccessibilityPanel.tsx:245 sil düğmesi bağlamlı aria-label kullanıyor.

**Etki:** Ekran okuyucuyla düğme listesinde gezinen ev sahibi 14+ adet aynı 'Kabul et' duyar; hangi oda ve tarihin fiyatını değiştireceğini bilemez.

**Önerilen aksiyon:** 158'deki <p>'ye `id={`sugg-${s.id}-title`}` verip iki düğmeye `aria-describedby={`sugg-${s.id}-title`}` ekleyin (görünür etiket aynı kalır, 2.5.3 korunur).

**Yapılan düzeltme:** Confirmed: every row had identical 'Kabul et / Reddet' buttons. Both buttons now carry sr-only room and date context in their accessible name (': Daire · 24.10.2026'), so the visible label stays first and 2.5.3 still holds. This works in screen-reader button lists, where aria-describedby is not read. Accept keeps its aria-describedby to the accept note. The row title is now an h3.

## F877 — Hata durumunda 'Tekrar dene' ya da 'Giriş yap' eylemi yok; panelin tamamı hata metniyle değişiyor

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                   |
| Durum               | Aday                                                                                     |
| Konum               | `src/components/host/RevenueDashboard.tsx:232`                                           |
| Diğer konumlar      | `src/components/host/RevenueDashboard.tsx:321`, `src/components/host/PayoutPanel.tsx:70` |
| Kullanıcılar        | ev sahibi, admin                                                                         |
| Prensip             | robustness · recoverability                                                              |
| Sezgisel madde      | H9 — Hata mesajları                                                                      |
| Renk/tema           | Hayır                                                                                    |
| Efor                | S                                                                                        |
| Kaynak denetçiler   | area:host2                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)                                                          |

**Kanıt:** RevenueDashboard.tsx:232 `if (error) return <Status error={error} />;`, 321 aynı; PayoutPanel.tsx:70 aynı. useLoader (src/components/ui/ui.tsx:241-262) reload'u döndürüyor ama arayüzde düğme yok; hata yalnız başarılı yüklemede temizleniyor. Oturum yenileme başarısızsa (api-client.ts:66-69) 'Oturum açmanız gerekiyor' giriş bağlantısı olmadan gösteriliyor.

**Etki:** Geçici ağ hatası ya da süresi dolmuş oturumda ev sahibi yalnız kırmızı metin görür; sayfayı yenilemeyi veya girişe gitmeyi kendisi bulmak zorundadır.

**Önerilen aksiyon:** Hata durumunda `<Status error={error} />` altına `<Button variant="secondary" onClick={reload}>{t("common.retry")}</Button>` ekleyin; ApiError.status === 401 ise `<Link href={`/login?redirect=${pathname}`}>Tekrar giriş yap</Link>` gösterin.

**Yapılan düzeltme:** Added a LoadError component (Status, a 'Tekrar dene' button using common.errorPage.retry, and a 'Tekrar giriş yap' ButtonLink to loginHref() on 401). 401 is detected with a small useRevenueLoader wrapper that inspects ApiError.status. It is used for the properties load and the overview load. If a reload fails while data is already shown, the error and retry appear inline above the panel instead of replacing it. After a successful retry, focus moves to a sensible target. The PayoutPanel instance is passed to its owner as crossOwner.

## F878 — Yeniden üretim, odanın bekleyen önerilerini uyarısız siliyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:237` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | robustness · recoverability                    |
| Sezgisel madde      | H5 — Hata önleme                               |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p088)                |

**Kanıt:** RevenueDashboard.tsx:237-245 generate() onay/uyarı olmadan POST atıyor; sunucu src/lib/pricing/revenue.ts:427-433 `tx.priceSuggestion.deleteMany({ where: { roomTypeId: roomId, status: "PENDING", … } })` ile aynı aralıktaki bekleyen önerileri siliyor.

**Etki:** İncelemenin ortasında 'Öneri üret'e tekrar basan ev sahibi gözden geçirdiği önerilerin yerini yenilerinin aldığını fark etmez; karşılaştırma bağlamı kaybolur.

**Önerilen aksiyon:** Seçili oda için `data.suggestions.filter(s => s.roomId === selectedRoom).length > 0` ise düğmenin yanında aria-describedby ile bağlı 'Bu oda için N bekleyen öneri yenileriyle değiştirilecek' notu gösterin ve üretimden önce onay isteyin.

**Yapılan düzeltme:** Confirmed: the server deletes PENDING suggestions for the room. When the selected room has N pending suggestions, a note 'Bu oda için bekleyen N öneri, yeni üretilenlerle değiştirilecek.' is shown and linked to the Generate button via aria-describedby. Generating now asks for confirmation first (useConfirm, primary tone). Generate and decide errors now use useErrorText instead of errorMessage.

## F879 — KPI başlığı ileriye dönük pencereyi 'Performans' diye sunuyor ve hariç tutulan bitiş gününü gösteriyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:258` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | learnability · predictability                  |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                    |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p089)                |

**Kanıt:** RevenueDashboard.tsx:258 `title={t("kpis.title", { from: f.date(k.from…), to: f.date(k.to…) })}` → 'Performans (29.09.2026 – 29.10.2026)' (docs/img/host-revenue.png). src/lib/pricing/revenue.ts:185-186 from=bugün, to=bugün+30; overlapNights (82-86) bitişi hariç tutuyor, yani 29.10 sayılmıyor.

**Etki:** Ev sahibi geçmiş performansını gördüğünü sanır, oysa gösterilen gelecekteki 30 gecenin rezervasyon durumudur; tarih aralığını bir gün fazla okur.

**Önerilen aksiyon:** Başlığı 'Önümüzdeki 30 gece — kesinleşmiş rezervasyonlar ({from} – {lastNight})' yapın ve `to` yerine `addDays(k.to, -1)` gösterin; kpis.title metnini TR/EN güncelleyin.

**Yapılan düzeltme:** Confirmed: kpis.to is exclusive (revenue.ts from=today, to=today+REVENUE_WINDOW_DAYS, `lt`). The period now shows the last night (to − 1, through a new local shiftIsoDate helper). The KPI title is now 'Önümüzdeki {days} gece: onaylı rezervasyonlar ({from} – {to})', with days computed from from/to. pickup.window uses the same corrected period.

## F880 — Doluluk yüzdesi ve çarpan toFixed ile biçimleniyor; TR'de ondalık nokta

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:264` |
| Diğer konumlar      | `src/components/host/RevenueDashboard.tsx:195` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | learnability · consistency                     |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                    |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p089)                |

**Kanıt:** RevenueDashboard.tsx:264 `t("percent", { value: (k.occupancy * 100).toFixed(1) })` → '%0.0' (ekran görüntüsü docs/img/host-revenue.png); 195 `×{c.multiplier.toFixed(2)}` → '×1.05'. PayoutPanel.tsx:73 aynı iş için `f.number(…)` kullanıyor.

**Etki:** TR'de '%72.5' ondalık yerine binlik ayırıcı gibi okunabilir; para tutarları virgüllü, yüzdeler noktalı görünür ve sayılar tutarsız algılanır.

**Önerilen aksiyon:** `f.number(k.occupancy, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 })` ve `f.number(c.multiplier, { minimumFractionDigits: 2, maximumFractionDigits: 2 })` kullanın; percent mesaj anahtarını kaldırın.

**Yapılan düzeltme:** Occupancy already used f.number percent. The remaining `×{c.multiplier.toFixed(2)}` now uses f.number with 2 fraction digits, so it follows the locale's decimal separator. The file no longer uses revenue.percent; I could not delete that key because message files are read-only for me.

## F881 — Öneri üretimi uzun sürebilir ama düğmede/ekranda ilerleme metni yok

| Alan                | Değer                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                      |
| Durum               | Aday                                                                                        |
| Konum               | `src/components/host/RevenueDashboard.tsx:296`                                              |
| Diğer konumlar      | `src/components/host/PayoutPanel.tsx:139`, `src/components/host/AccessibilityPanel.tsx:317` |
| Kullanıcılar        | ev sahibi, admin                                                                            |
| Prensip             | robustness · responsiveness                                                                 |
| Sezgisel madde      | H15 — Performans                                                                            |
| Renk/tema           | Hayır                                                                                       |
| Efor                | S                                                                                           |
| Kaynak denetçiler   | area:host2                                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p089)                                                             |

**Kanıt:** RevenueDashboard.tsx:296-298 `<Button onClick={generate} disabled={busy || !selectedRoom}>{t("suggestions.generate")}</Button>`; yalnız opacity düşüyor. generateSuggestions REVENUE_SUGGESTION_DAYS (14) gece için LLM açıklaması çağırıyor (src/lib/pricing/revenue.ts:371, 395-423). HostDashboard.tsx:302 ve 559 meşgulken 'Kaydediliyor…'/'Öneriliyor…' metni gösteriyor; PayoutPanel.tsx:139 ve AccessibilityPanel.tsx:317 göstermiyor.

**Etki:** Birkaç saniye süren üretimde ev sahibi düğmenin neden soluk olduğunu anlamaz, sayfayı yeniler ya da işlemi yarıda bırakır; ekran okuyucuya hiçbir şey duyurulmaz.

**Önerilen aksiyon:** `{busy ? t("suggestions.generating") : t("suggestions.generate")}` ('Öneriler üretiliyor…'), Card'a `aria-busy={busy}` ve Status'a aynı metni yazın; PayoutPanel ('Kaydediliyor…') ve AccessibilityPanel ('Ekleniyor…') için de aynı deseni uygulayın.

**Yapılan düzeltme:** While busy, the generate button reads 'Öneriler üretiliyor…'. A neutral role=status region announces progress with a time expectation, and the suggestion list gets aria-busy. The PayoutPanel and AccessibilityPanel parts are listed in crossOwner.

## F882 — Uzun süren AI/LLM işlemlerinde ilerleme ve süre beklentisi yok

| Alan                | Değer                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                  |
| Durum               | Aday                                                                                                                                                                                    |
| Konum               | `src/components/host/RevenueDashboard.tsx:297`                                                                                                                                          |
| Diğer konumlar      | `src/components/property/ReviewsSection.tsx:207`, `src/components/plan/TripPlanner.tsx:161`, `src/components/host/HostDashboard.tsx:559`, `src/components/admin/AdminDashboard.tsx:245` |
| Kullanıcılar        | ev sahibi, misafir, admin                                                                                                                                                               |
| Prensip             | robustness · responsiveness                                                                                                                                                             |
| Sezgisel madde      | H15 — Performans                                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:status                                                                                                                                                                             |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p089)                                                                                                                                                  |

**Kanıt:** RevenueDashboard.tsx:296-298 öneri üretme butonu busy iken yalnız disabled, metin `{t("suggestions.generate")}` değişmiyor; ReviewsSection.tsx:207-254 AI yorum özeti için yükleme göstergesi yok (sonradan beliriyor, içerik kayıyor); TripPlanner.tsx:161, HostDashboard.tsx:559, AdminDashboard.tsx:245, SmartFilter.tsx:124 yalnız buton metni değişiyor, süre beklentisi/iptal yok.

**Etki:** Ev sahibi tıklamanın alındığını görmüyor ve tekrar basıyor; misafir yorum özeti geç geldiğinde okuduğu yerin kaydığını yaşıyor.

**Önerilen aksiyon:** Ortak `<AiProgress>`: role=status 'Öneriler hazırlanıyor (genellikle 5–15 sn)…' + AbortController ile 'İptal'; RevenueDashboard butonu busy'de 'Üretiliyor…'; ReviewsSection özet alanı için sabit yükseklikli iskelet + 'AI özeti hazırlanıyor…'.

**Yapılan düzeltme:** The RevenueDashboard part is done: busy label, progress status with duration hint, aria-busy, and row buttons locked during generation. I did not add a Cancel/AbortController, because the server keeps generating and replaces pending suggestions even if the request is aborted, so a cancel would mislead. The shared AiProgress component and the ReviewsSection, TripPlanner, HostDashboard and AdminDashboard parts belong to other owners.

## F883 — Öneri listesi seçili odaya göre süzülmüyor, gruplanmıyor ve toplu işlem yok

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:301` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | robustness · task conformance                  |
| Sezgisel madde      | H7 — Esneklik/verim                            |
| Renk/tema           | Hayır                                          |
| Efor                | M                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p089)                |

**Kanıt:** RevenueDashboard.tsx:301-308 `data.suggestions.map(...)` tüm odaların bekleyen önerilerini (src/lib/pricing/revenue.ts:203-206) tek liste yapıyor; 284-294 'Oda' seçici yalnız üretimi etkiliyor (244). Her öğe 5 satırlık tablo + iki düğme; oda başına 14 öğe.

**Etki:** Birkaç odası olan ev sahibi onlarca kartı tek tek kaydırıp karar verir; 'Oda' seçicisinin listeyi süzdüğünü sanıp yanılır (predictability).

**Önerilen aksiyon:** Listeyi selectedRoom'a göre süzün (ya da 'Tüm odalar' seçeneği ekleyin), oda başlıklarıyla gruplayın; katkı tablosunu `<details>` içine alın; seçili oda için onaylı 'Tümünü kabul et' / 'Tümünü reddet' düğmeleri ekleyin.

**Yapılan düzeltme:** The list is now filtered by the selected room. Room options show pending counts, and a note gives the number pending in other rooms. The empty state names the room. Each contribution table sits in a <details> ('Fiyatın hesaplanışını göster'). With 2 or more suggestions, confirmed 'Tümünü kabul et/reddet ({count})' buttons appear. They decide one suggestion at a time and stop at the first error, reporting done/total. Row buttons are locked during bulk actions, and focus moves to the empty state or stays on the bulk button.

## F1124 — Host alt gezinmesi metin içi bağlantı satırı; Gelir ve Ödemeler sayfaları birbirine ya da panele bağlanmıyor

| Alan                | Değer                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Severity            | Low                                                                   |
| Durum               | Gözlemlendi                                                           |
| Konum               | `src/components/host/HostDashboard.tsx:89`                            |
| Diğer konumlar      | `src/app/host/payouts/page.tsx`, `src/app/host/revenue/page.tsx`      |
| Kullanıcılar        | ev sahibi                                                             |
| Prensip             | learnability · Learnability: gezinme öngörülebilirliği (navigability) |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                               |
| Renk/tema           | Hayır                                                                 |
| Efor                | S                                                                     |
| Kaynak denetçiler   | runtime:host                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p081)                                |

**Kanıt:** Gerçek görüntü crops/host/d-host-top.png: 'Gelir paneli: doluluk, ADR, RevPAR ve fiyat önerileri → · Ödemeler ve bakiye · Çözüm merkezi (hasar talepleri)'. Bu, parti riski kartının altında bir <p> (HostDashboard.tsx:89-110). nav landmark'ı ya da aria-current yok. /host/payouts ve /host/revenue sayfaları yalnızca PageShell kullanıyor: geri bağlantısı, breadcrumb ya da kardeş sayfa bağlantısı yok (tarama 096/098 tabOrder'ında main içinde host bağlantısı yok).

**Etki:** Ev sahibi Gelir ile Ödemeler arasında geçmek için önce başlıktaki panele dönüp bağlantı satırını bulmak zorunda.

**Önerilen aksiyon:** Tüm /host/* sayfaları için ortak bir host layout'u ve sekmeli alt nav ekleyin: <nav aria-label='Ev sahibi'> içinde Panel · Gelir · Ödemeler · Mesajlar · Çözüm merkezi, etkin sayfada aria-current='page'.

**Yapılan düzeltme:** In HostDashboard, the inline <p> row of links with '·' separators is now <nav aria-label={t("pagesNav")}> with a <ul>. The items are Ev sahibi paneli (aria-current="page" plus underline), Gelir paneli, Ödemeler and Çözüm merkezi, in the same order as HostPagesNav, and guardLeave still asks before leaving with unsaved changes. Making /host/payouts link back to the other host pages is a payouts/page.tsx change, listed in crossOwner. /host/revenue already renders HostPagesNav.

## F1125 — Tekrarlanan bağlamsız kontrol adları: 'Mesajlar', 'Kabul et/Reddet', 40 'Kaydet'

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | Low                                                                 |
| Durum               | Gözlemlendi                                                         |
| Konum               | `src/components/host/HostDashboard.tsx:171`                         |
| Diğer konumlar      | `src/components/host/RevenueDashboard.tsx`                          |
| Kullanıcılar        | ev sahibi                                                           |
| Prensip             | accessibility · Learnability: tutarlılık                            |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                         |
| WCAG                | 2.4.4 Link Purpose (In Context) (A), 2.4.6 Headings and Labels (AA) |
| Renk/tema           | Hayır                                                               |
| Efor                | S                                                                   |
| Kaynak denetçiler   | runtime:host                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p081)                                     |

**Kanıt:** Probe p6: #host-bookings içindeki bağlantı adları ['Mesajlar','Mesajlar'] ve satırlarda th scope=row yok, yani bağlantı bağlamı programatik olarak belirlenemiyor. Öneri düğmeleri ['Kabul et','Reddet'] her öneride aynı. Probe p1 (gerçek): sayfada 40 'Kaydet' düğmesi, depozito satırlarıyla birlikte daha fazla. Aynı sayfada promosyon 'Sil' düğmesi sr-only ': <ad>' ekiyle ve erişilebilirlik 'Sil' düğmesi aria-label ile bağlam veriyor, yani yaklaşım tutarsız.

**Etki:** Ekran okuyucunun bağlantı veya düğme listesinde hangi 'Mesajlar'ın hangi rezervasyona ait olduğu anlaşılmıyor.

**Önerilen aksiyon:** Mülk hücresini <th scope='row'> yapın ya da bağlantıya sr-only bağlam ekleyin ('Mesajlar: Villa Amara, 12.07.2026'). Öneri düğmelerine oda/tarih ekleyin. Kaydet düğmelerine aria-describedby ile kart başlığını bağlayın.

**Yapılan düzeltme:** The Messages links already had sr-only context and the rows already used th scope=row, and the property Save already had the sr-only title. I linked the remaining generic buttons to the property card heading with aria-describedby: Oda ekle, Takvimi güncelle (alongside its summary) and İlan metni önerisi. The RevenueDashboard Accept/Reject buttons already carry sr-only room/date context.

## F1126 — 'İlan yayında' kutusu genel düzenleme formunun içinde; yayından kaldırma onaysız

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Gözlemlendi                                 |
| Konum               | `src/components/host/HostDashboard.tsx:289` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | robustness · Robustness: hata önleme        |
| Sezgisel madde      | H5 — Hata önleme                            |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | runtime:host                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p081)             |

**Kanıt:** Probe p4 (mock): 'Luxury Bosphorus Suite' kartında kutu kaldırılıp 'Kaydet' basıldı. Hemen PATCH /api/properties/… {…"isActive":false} gitti ve onay penceresi açılmadı. Kutu başlık ve açıklama düzenlemesiyle aynı 'Kaydet' düğmesini paylaşıyor.

**Etki:** Başlık düzeltirken yanlışlıkla kutuya dokunan ev sahibi ilanını aramadan kaldırır. Geri alınabilir ama fark edilene kadar rezervasyon kaybı olur.

**Önerilen aksiyon:** Yayın durumunu ayrı bir anahtar ya da düğme yapın ('Yayından kaldır'). Kaldırırken onay isteyin, sonrasında kartın üstünde belirgin bir 'Yayında değil' rozeti gösterin.

**Yapılan düzeltme:** isActive is removed from the edit form: from its state, the F837 sync, the dirty check and the PATCH body. In its place is a separate 'Yayından kaldır' / 'Yayına al' button at the top of the card that PATCHes only {isActive}. Unpublishing first asks for confirmation through useConfirm (danger tone). When the listing is not live, a 'Yayında değil' badge shows next to the visibility line, and the result appears in a Status.

## F1127 — 46 küçük hedefin dökümü: 40 adet 16 px 'İlan yayında' onay kutusu ve stilsiz 13 px 'birleşebilir' onay kutusu

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | Low                                                            |
| Durum               | Gözlemlendi                                                    |
| Konum               | `src/components/host/HostDashboard.tsx:292`                    |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx`                      |
| Kullanıcılar        | ev sahibi                                                      |
| Prensip             | accessibility · Learnability: tutarlılık ve dokunma ergonomisi |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                    |
| WCAG                | 2.5.8 Target Size (Minimum) (AA): aralık istisnasıyla geçiyor  |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | runtime:host                                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p081)                                |

**Kanıt:** Tarama 094 targetsLt24Count=46: 40 adet input#prop-…-active 16x16 (h-4 w-4), 4 footer bağlantısı (genel, bilinen), 1 sr-only atlama bağlantısı (yanlış pozitif) ve #promo-form-stack. Mobil 095'te 43. Probe p9: #promo-form-stack 13x13 (h-4 w-4 sınıfı yok, diğer onay kutularıyla tutarsız). Merkezden en yakın başka hedefe uzaklık 'İlan yayında' için masaüstünde 24 px, mobilde 26 px; 'birleşebilir' için masaüstünde 19 px, mobilde 27 px. 12 px yarıçaplı daire başka hedefe değmediği için 2.5.8 aralık istisnası sağlanıyor. targetsLt44Count=996 (masaüstü) / 744 (mobil) değerlerinin büyük kısmı 38 px yüksekliğindeki input'lar ve 36 px düğmeler.

**Etki:** Mobilde, özellikle motor güçlüğü olan ev sahipleri ilanı yayından kaldıran kutuyu ıskalayabilir ya da yanlışlıkla değiştirebilir.

**Önerilen aksiyon:** Onay kutusunu etiketle birlikte en az 44 px yüksekliğinde tıklanabilir bir satıra alın (<label class='flex min-h-11 items-center gap-2'><input class='h-5 w-5'>…). #promo-form-stack'e de aynı sınıfları verin.

**Yapılan düzeltme:** The 16px 'İlan yayında' checkbox is gone, replaced by a full-size Button (min-h-[44px] on mobile) as part of F1126. The 13px #promo-form-stack checkbox is in PromotionsPanel.tsx, which I don't own, so it is listed in crossOwner.

## F1128 — Kaydetme sonrası odak body'ye düşüyor (meşgulken disabled olan düğmeler)

| Alan                | Değer                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                          |
| Durum               | Gözlemlendi                                                                                                                  |
| Konum               | `src/components/host/HostDashboard.tsx:301`                                                                                  |
| Diğer konumlar      | `src/components/host/PayoutPanel.tsx`, `src/components/host/RevenueDashboard.tsx`, `src/components/host/DepositSettings.tsx` |
| Kullanıcılar        | ev sahibi                                                                                                                    |
| Prensip             | accessibility · Robustness: diyalog sürekliliği                                                                              |
| Sezgisel madde      | H12 — Feedback                                                                                                               |
| WCAG                | 2.4.3 Focus Order (A)                                                                                                        |
| Renk/tema           | Hayır                                                                                                                        |
| Efor                | S                                                                                                                            |
| Kaynak denetçiler   | runtime:host                                                                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p081)                                                                                              |

**Kanıt:** Probe p10 (mock, gecikmeli PATCH): mülk kartındaki 'Kaydet'e Enter basıldı, kayıt sonrası document.activeElement=body ve Status 'Kaydedildi.' oldu. Chrome sıradaki Tab'ı oda adı alanına götürdü, ama ekran okuyucu bağlamı kayboldu. Probe p7'de 'Ödeme hesabını bağla' ve 'Kabul et' sonrasında da odak body'deydi. Neden: Button disabled={busy} (HostDashboard.tsx:301, PayoutPanel.tsx:139, RevenueDashboard.tsx:208, DepositSettings.tsx:148).

**Etki:** Klavye ve ekran okuyucu kullanıcısı her kayıttan sonra nerede olduğunu kaybediyor. Sonuç mesajının nereden geldiğini anlamakta zorlanıyor.

**Önerilen aksiyon:** Meşgulken disabled yerine aria-disabled='true' ve tıklama koruması kullanın, ya da işlem bitince odağı düğmeye veya sonuç mesajına (tabIndex=-1) geri verin.

**Yapılan düzeltme:** Every button that was disabled while busy now uses Button's busy prop or aria-disabled (create submit/cancel, property Save, room open/close, Oda ekle, calendar, listing-copy suggest, photo remove, retry buttons), so focus no longer drops to body. The photo file input now uses aria-disabled plus a click guard while uploading, and stays truly disabled only when the photo limit is reached. upload() and suggest() also gained a busy guard.

## F1129 — Yapay zekâ ilan metni taslağı ilana uygulanamıyor

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Low                                                          |
| Durum               | Gözlemlendi                                                  |
| Konum               | `src/components/host/HostDashboard.tsx:567`                  |
| Kullanıcılar        | ev sahibi                                                    |
| Prensip             | flexibility · Flexibility: görev geçişi (task migratability) |
| Sezgisel madde      | H7 — Esneklik/verim                                          |
| Renk/tema           | Hayır                                                        |
| Efor                | S                                                            |
| Kaynak denetçiler   | runtime:host                                                 |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p081)                             |

**Kanıt:** Kod HostDashboard.tsx:567-579: taslak TR ve EN paragraf olarak gösteriliyor. 'Açıklamaya uygula' ya da 'Kopyala' düğmesi yok. Etiket 'Taslak (otomatik yayınlanmaz, düzenleyip onaylayın)' bir onay eylemi ima ediyor ama böyle bir kontrol yok. Gerçek panelde her kartta 'İlan metni önerisi' düğmesi var (crops/host/d-host-top.png).

**Etki:** Ev sahibi metni elle seçip açıklama alanına kopyalamak zorunda. Mobilde bu zahmetli.

**Önerilen aksiyon:** Taslağın altına 'Açıklamaya aktar' (açıklama alanını doldurur, kaydetmez) ve 'Kopyala' düğmeleri ekleyin.

**Yapılan düzeltme:** ListingCopy already has 'Açıklamaya aktar' (onApply → applyDraft fills the description field and focuses it without saving) and 'Kopyala' buttons for each language, with Status feedback. A pending patch, p080, also rewords the draft label.

## F1130 — Ödeme geçmişinde ham hata kodu ('account_closed') ve mobilde aralıksız bakiye tablosu

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Low                                                 |
| Durum               | Gözlemlendi                                         |
| Konum               | `src/components/host/PayoutPanel.tsx:222`           |
| Kullanıcılar        | ev sahibi                                           |
| Prensip             | robustness · Robustness: anlaşılır hata ve kurtarma |
| Sezgisel madde      | H9 — Hata mesajları                                 |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | runtime:host                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p085)                     |

**Kanıt:** Probe p7 (mock, FAILED geçmiş satırı): '01.10.2026 · Konaklama geliri · ₺7.340,00 · Başarısız (account_closed)'. failureCode doğrudan ekleniyor (PayoutPanel.tsx:222) ve ne yapılması gerektiği söylenmiyor. Gerçek mobil görüntü crops/host/m-payouts-0.png ve probe p5: Bakiye tablosunda hücreler yalnızca py-2 (yatay dolgu yok), sütun genişlikleri 'Serbest:51 Rezervde:63 Ödenen:53' px. Başlıklar 'Serbest Rezervde Ödenen' olarak birbirine yapışık görünüyor.

**Etki:** Başarısız bir ödemede ev sahibi İngilizce teknik kodu anlamıyor ve banka hesabını güncellemesi gerektiğini bilmiyor. Mobilde tutarlar hangi sütuna ait, zor ayırt ediliyor.

**Önerilen aksiyon:** failureCode'u i18n'e eşleyin ('Banka hesabı kapalı; hesap bilgilerinizi güncelleyin' + bağlantı). Hücrelere pr-4 ekleyin ya da mobilde bakiyeyi dl listesi olarak gösterin.

**Yapılan düzeltme:** Raw failure codes are now mapped to localized text with an account or support link and a small code note (same change as F860). For the mobile spacing: the cells already had pe-4 padding from an earlier pass. Money headers and cells are now also end-aligned (text-end) with tabular-nums, so adjacent amounts no longer run together.

## F1131 — Kupon kodu kuralı ve öncelik aralığı önceden gösterilmiyor; formda 'Fiyat farkı' birimsiz

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Low                                                         |
| Durum               | Gözlemlendi                                                 |
| Konum               | `src/components/host/PromotionsPanel.tsx:288`               |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx`                     |
| Kullanıcılar        | ev sahibi                                                   |
| Prensip             | learnability · Learnability: öngörülebilirlik (feedforward) |
| Sezgisel madde      | H13 — Feedforward                                           |
| WCAG                | 3.3.2 Labels or Instructions (A)                            |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | runtime:host                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p087)                             |

**Kanıt:** Probe p3: kupon kodu 'ab' girildiğinde validity=false ve yalnızca genel 'istenen biçimle eşleşin' baloncuğu çıktı. #promo-form-code-hint sayısı 0. Kural (4–40 harf/rakam/-/_) yalnızca pattern içinde ve sunucu mesajında var. Öncelik hint'i 'Yüksek öncelik önce uygulanır.' diyor, -1000…1000 aralığını söylemiyor (satır 319-333). Oda ekleme formunda 'Fiyat farkı' etiketinde birim yok (TRY? %?) ve min=0 olduğu için daha ucuz oda tanımlanamıyor (HostDashboard.tsx:398-407).

**Etki:** Ev sahibi kodun neden reddedildiğini tahmin etmek zorunda kalıyor. Fiyat farkını yüzde sanıp yanlış fiyat girebilir.

**Önerilen aksiyon:** Kupon alanına hint ekleyin ('4–40 karakter: harf, rakam, - veya _') ve aria-describedby ile bağlayın. Öncelik hint'ine aralığı yazın. 'Fiyat farkı (TRY, gecelik taban fiyata eklenir)' etiketi kullanın.

**Yapılan düzeltme:** The coupon field already has a hint ('{min}–{max} karakter; yalnız harf, rakam, - ve _ kullanın'), wired as #promo-form-code-hint through Field's aria-describedby. Priority is now a Low/Normal/High select, so a -1000..1000 range no longer applies; its hint is reworded in p087.json. The HostDashboard 'Fiyat farkı' label now shows the currency ('Gecelik ek ücret ({currency})', key rooms.add.priceModifierLabel from patch p080) and has a 'Taban fiyata eklenecek gecelik tutar' hint; that work was done by its owner.

## F1294 — Gelir ve Ödemeler sayfalarında ev sahibi paneline dönüş ve kardeş sayfa bağlantısı yok

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/app/host/revenue/page.tsx:11`           |
| Diğer konumlar      | `src/app/host/payouts/page.tsx:11`           |
| Kullanıcılar        | ev sahibi                                    |
| Prensip             | flexibility · dialog initiative / navigation |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü            |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:host2                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p025)       |

**Kanıt:** revenue/page.tsx:11 ve payouts/page.tsx:11 `<PageShell title=… intro=…>` breadcrumb veya ilgili sayfa bağlantısı içermiyor; bu sayfalara yalnız HostDashboard.tsx:90-102 bağlantılarıyla ulaşılıyor.

**Etki:** Gelir panelinden ödemelere ya da ev sahibi paneline geçmek isteyen kullanıcı tarayıcı geri tuşuna veya üst menüye bağımlı kalır.

**Önerilen aksiyon:** PageShell'e isteğe bağlı `breadcrumb` prop'u ekleyin: `<nav aria-label="Breadcrumb"><ol><li><Link href="/host">Ev sahibi paneli</Link></li><li aria-current="page">Gelir paneli</li></ol></nav>`; intro altında kardeş sayfa bağlantısı verin.

**Yapılan düzeltme:** The revenue page now shows a sibling nav under the intro: Ev sahibi paneli → /host, Gelir paneli (aria-current) and Ödemeler → /host/payouts. The payouts page needs the same one-line change (crossOwner).

## F1295 — Erişilebilirlik kanıtı seçenekleri 'Fotoğraf 1/2/3' — ev sahibi hangisini seçtiğini göremiyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:83`  |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx:304` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | learnability · recognition (tanıma > hatırlama)  |
| Sezgisel madde      | H6 — Tanıma > hatırlama                          |
| Renk/tema           | Hayır                                            |
| Efor                | M                                                |
| Kaynak denetçiler   | lens:a11y                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p077)                  |

**Kanıt:** 83-84 `photoLabel = (id) => t("host.photoOption", { index: String(photoOptions.findIndex((p) => p.id === id) + 1) })`; 225-228 ve 304-308 select seçenekleri yalnız sıra numarası; fotoğrafı görmek için 232-241'de yeni sekmede açan bağlantı.

**Etki:** Ev sahibi doğru kanıt fotoğrafını hatırlamak/ayrı sekmede kontrol etmek zorunda; yanlış kanıt doğrulama reddine yol açıyor.

**Önerilen aksiyon:** Select yerine küçük resimli radyo grubu (`<fieldset>` + img alt) ya da seçeneğe yükleme tarihi/dosya adı ekleyin.

**Yapılan düzeltme:** Confirmed: options said only 'Fotoğraf N'. The photos API already returns createdAt (ordered createdAt asc). I added createdAt to the Photo type, and photoLabel now renders 'Fotoğraf {index} (yükleme: {date})' using useFormat().dateTime, falling back to the old key. This applies to both the row selects and the add-form select, and to the preview img alt. The existing thumbnail preview next to each select still shows the chosen photo.

## F1296 — Doğrulama rozetleri sonraki adımı ve süreyi söylemiyor; ekleme formu adlandırılmamış

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:203` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | learnability · predictability                    |
| Sezgisel madde      | H13 — Feedforward                                |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p077)                  |

**Kanıt:** AccessibilityPanel.tsx:203-207 'İnceleme bekliyor' / 'Kanıt fotoğrafı gerekli' rozetleri; compliance.json'daki verifiedHint host görünümünde kullanılmıyor. 255 `<form onSubmit={add} …>` h3 'Yeni özellik ekle' (256) ile aria-labelledby bağlanmamış (HostDashboard.tsx:459 CalendarForm bağlıyor).

**Etki:** Ev sahibi incelemenin ne kadar süreceğini, rozetin ilanda ne zaman görüneceğini bilmez; ekran okuyucunun form/landmark listesinde form adsız görünür.

**Önerilen aksiyon:** Rozetlerin altına kısa açıklama ('Platform ekibi kanıtı inceleyince ilanda görünür'); forma `aria-labelledby="a11y-add-title"` ve h3'e aynı id.

**Yapılan düzeltme:** Confirmed. Under each badge there is now a short next-step hint: verifiedStatusHint, pendingReviewHint ('appears on the listing and in search once the team verifies the evidence') and needsEvidenceHint. No review duration is stated because the codebase has no review SLA to cite. The add form now has aria-labelledby="a11y-add-title", and the h3 has that id.

## F1297 — Satır içi kanıt seçicilerinin etiketi her satırda aynı; sil etiketi kapsamı içermiyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:212` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | accessibility · Headings and Labels              |
| Sezgisel madde      | H14 — Erişilebilirlik                            |
| WCAG                | 2.4.6                                            |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p077)                  |

**Kanıt:** AccessibilityPanel.tsx:212-217 her satırda `<label …>{t("evidence")}</label>` ('Kanıt fotoğrafı'); 245 `t("host.deleteLabel", { name: t(`codes.${feature.code}`) })` kapsamı içermiyor — aynı kod hem 'Tüm tesis' hem bir oda için var olabiliyor (migration.sql:40-42 ayrı indeksler).

**Etki:** Form kontrolleri arasında gezinen ekran okuyucu kullanıcısı hangi özelliğin kanıtını değiştirdiğini ya da hangi 'Basamaksız giriş'i sildiğini ayırt edemez.

**Önerilen aksiyon:** Etikete sr-only ek: `{t("evidence")}<span className="sr-only">: {codeName} – {scope}</span>`; deleteLabel'a `{scope}` parametresi ekleyin ('Basamaksız giriş (Oda: Deluxe) özelliğini sil').

**Yapılan düzeltme:** Confirmed. I added scopeLabel/scopedName helpers and a new key, host.featureScoped '{name} ({scope})'. Each row's evidence label now has an sr-only ': {name} ({scope})'. The saveEvidence, edit (button and form) and delete aria-labels pass the scoped name as {name}, giving for example 'Basamaksız giriş (Oda: Deluxe) özelliğini sil'. No existing message key was changed, and visible-label-in-name still holds. The evidence and edit confirm titles also use the scoped name.

## F1298 — 'Kanıtı görüntüle' bağlantısı uyarısız yeni sekmede açılıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:235` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | accessibility · Change on Request                |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                |
| WCAG                | 3.2.5                                            |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p077)                  |

**Kanıt:** AccessibilityPanel.tsx:233-240 `<a href={feature.evidencePhotoUrl} target="_blank" rel="noreferrer">{t("host.viewEvidence")}</a>`; görünür/sr-only yeni sekme bildirimi yok.

**Etki:** Ekran okuyucu ve bilişsel yükü yüksek kullanıcı bağlam değişimini fark etmez, 'geri' tuşu çalışmaz.

**Önerilen aksiyon:** Bağlantıya `<span className="sr-only">(yeni sekmede açılır)</span>` ve aria-hidden dış bağlantı simgesi ekleyin; ya da fotoğrafı sayfa içi <dialog> ile önizleyin.

**Yapılan düzeltme:** Confirmed. The 'Kanıtı görüntüle' link now includes an sr-only ': {scoped name} (yeni sekmede açılır)' via the new key host.newTab, plus an aria-hidden ↗ icon. The scoped name also makes the repeated link text unique per row.

## F1299 — Not alanında 500 karakter sınırı görünmüyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/host/AccessibilityPanel.tsx:313` |
| Kullanıcılar        | ev sahibi                                        |
| Prensip             | learnability · predictability                    |
| Sezgisel madde      | H13 — Feedforward                                |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:host2                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p077)                  |

**Kanıt:** AccessibilityPanel.tsx:312-313 `<Field id="a11y-note" label={t("host.note")}><textarea … maxLength={500} …/></Field>` hint/sayaç yok.

**Etki:** Ayrıntılı not yazan ev sahibi 500 karakterde yazının sessizce kesildiğini fark etmez.

**Önerilen aksiyon:** Field'e `hint={t("host.noteHint", { max: 500 })}` verin ve aria-live="polite" olmayan, aria-describedby ile bağlı 'kalan karakter' sayacı ekleyin.

**Yapılan düzeltme:** Confirmed. I added a NOTE_MAX=500 constant, matching the API's zod max(500), and a noteHint key 'En fazla {max} karakter; {remaining} karakter kaldı.' The add-form note now has this hint, and the edit-form note appends it to editNoteHint. Both show a remaining-characters counter tracked with onChange state, reset after a successful add and on opening edit. The counter is linked through Field's aria-describedby and is not a live region, so it is not read on every keystroke.

## F1300 — Depozito üst sınırı alana bağlı değil; etiket dil bilgisi bozuk

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/components/host/DepositSettings.tsx:49` |
| Diğer konumlar      | `messages/tr/resolution.json:189`            |
| Kullanıcılar        | ev sahibi                                    |
| Prensip             | learnability · predictability                |
| Sezgisel madde      | H13 — Feedforward                            |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:host                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p083)              |

**Kanıt:** DepositSettings.tsx:49-51 '<p>{t("max", …)}</p>' input'larla aria-describedby ilişkisi yok; L132 'label={t("amount", { scope, currency })}' → 'Oda: Deluxe tutarı (TRY)' (resolution.json:189 + roomLabel).

**Etki:** Ekran okuyucu kullanıcısı alanda üst sınırı duymaz; etiket TR'de doğal okunmaz.

**Önerilen aksiyon:** Hint'e 'En fazla ₺5.000,00' ekle; etiket kalıbını '{room} odası için depozito ({currency})' / 'İlan geneli depozito ({currency})' yap.

**Yapılan düzeltme:** Confirmed real. The 'En fazla X.' limit text now sits in every field's hint, so it is linked to the input through aria-describedby. The separate unlinked paragraph is removed. Labels now come from the new keys amountListing ('İlan geneli depozito (TRY)') and amountRoom ('{room} için depozito (TRY)'), replacing the ungrammatical '{scope} tutarı'.

## F1301 — Araç bağlantıları satırı: nav değil, jargonlu ve '→' okunuyor

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Low                                        |
| Durum               | Aday                                       |
| Konum               | `src/components/host/HostDashboard.tsx:89` |
| Diğer konumlar      | `messages/tr/host.json:10`                 |
| Kullanıcılar        | ev sahibi                                  |
| Prensip             | learnability · familiarity                 |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | area:host                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p081)            |

**Kanıt:** HostDashboard.tsx:89-110 '<p>' içinde üç Link ve '{" · "}' ayraçları; host.json:10 'Gelir paneli: doluluk, ADR, RevPAR ve fiyat önerileri →'.

**Etki:** Partial okuryazar host ADR/RevPAR kısaltmalarını bilmez; ekran okuyucu ayraçları ve oku okur; bağlantı grubu landmark olarak bulunamaz.

**Önerilen aksiyon:** '<nav aria-label="Ev sahibi araçları"><ul className="flex flex-wrap gap-x-4">'; link metni 'Gelir paneli', altına açıklama 'Doluluk, ortalama gecelik fiyat (ADR), oda başı gelir (RevPAR)'; ok aria-hidden.

**Yapılan düzeltme:** The tools row is now a nav landmark with a list. Link text is the short 'Gelir paneli' with no '→', and a visible hint below spells out the jargon ('…ortalama gecelik fiyat (ADR), müsait oda başına gelir (RevPAR)…'), tied to the link with aria-describedby. The separators are gone.

## F1302 — Yükleme durumları tutarsız duyuruluyor

| Alan                | Değer                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                       |
| Durum               | Aday                                                                                                                      |
| Konum               | `src/components/host/HostDashboard.tsx:113`                                                                               |
| Diğer konumlar      | `src/components/host/DepositSettings.tsx:43`, `src/components/host/PartyRiskPanel.tsx:33`, `src/components/ui/ui.tsx:146` |
| Kullanıcılar        | ev sahibi                                                                                                                 |
| Prensip             | robustness · observability                                                                                                |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                            |
| WCAG                | 4.1.3                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                     |
| Efor                | S                                                                                                                         |
| Kaynak denetçiler   | area:host                                                                                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p081)                                                                                    |

**Kanıt:** HostDashboard.tsx:113 ve DepositSettings.tsx:43 koşullu render edilen '<p aria-live="polite">' içerikle birlikte DOM'a girer (çoğu ekran okuyucu duyurmaz); PartyRiskPanel.tsx:33 ve HostDashboard.tsx:128 loading'de aria-live yok; yükleme bitince duyuru yok; ui.tsx:146-148 aria-live içinde role='alert' çift duyuruya yol açabilir.

**Etki:** Ekran okuyucu kullanıcısı verinin yüklenip yüklenmediğini bilemez.

**Önerilen aksiyon:** Her bölümde sürekli var olan aria-live kapsayıcı ve section'da 'aria-busy={data === null && !error}'; Status'ta role='alert' ile aria-live'dan yalnız birini kullan.

**Yapılan düzeltme:** Confirmed: the loading text arrived in the DOM together with its live region. Bookings and properties now have status regions that are always in the DOM (the properties ones use empty:sr-only so they add no spacing), plus aria-busy while loading, and the loading text also shows during a retry after an error. The conditional filter-empty message became a persistent status, and photo loading got role=status. Retry buttons get busy. PartyRiskPanel is listed in crossOwner; the Status component in ui.tsx already separates role=alert from role=status.

## F1303 — Odak ve hedef stilleri tutarsız

| Alan                | Değer                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Severity            | Low                                                                                        |
| Durum               | Aday                                                                                       |
| Konum               | `src/components/host/HostDashboard.tsx:173`                                                |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:668`, `src/components/host/PromotionsPanel.tsx:340` |
| Kullanıcılar        | ev sahibi                                                                                  |
| Prensip             | learnability · consistency                                                                 |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                |
| WCAG                | 2.4.7                                                                                      |
| Renk/tema           | Hayır                                                                                      |
| Efor                | S                                                                                          |
| Kaynak denetçiler   | area:host                                                                                  |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p081)                                                            |

**Kanıt:** HostDashboard.tsx:173 'Mesajlar' linkinde focusRing yok (L92'deki linklerde var); L668 'Fotoğrafı kaldır' düğmesinde yok; onay kutuları: L292 'h-4 w-4', PromotionsPanel.tsx:340 boyut sınıfsız.

**Etki:** Klavye kullanıcısı bazı öğelerde marka odak halkası, bazılarında tarayıcı varsayılanı görür; küçük onay kutusu mobilde zor hedeflenir.

**Önerilen aksiyon:** Eksik öğelere mevcut focusRing sınıfını ekle; tüm checkbox'lara ortak 'h-5 w-5'; satır içi metin düğmelerine 'py-1'.

**Yapılan düzeltme:** The Messages links and the duplicate-photo 'Fotoğrafı kaldır' button already had focusRing in the current code. The h-4 checkbox was removed (F1126), and the inline duplicate-photo remove button got py-1 so it is at least 24px tall on desktop. The PromotionsPanel checkbox size is listed in crossOwner.

## F1304 — Sayılar yerel biçimde değil; değerlendirmesi olmayan ilan 'Puan 0.0'

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/components/host/HostDashboard.tsx:232`  |
| Diğer konumlar      | `src/components/host/PromotionsPanel.tsx:75` |
| Kullanıcılar        | ev sahibi                                    |
| Prensip             | learnability · consistency                   |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                  |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:host                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p081)              |

**Kanıt:** HostDashboard.tsx:232 'p.ratingAvg.toFixed(1)' TR'de '4.5' (beklenen '4,5'); docs/img/host-extranet.png 'Puan 0.0'; PromotionsPanel.tsx:75 'String(p.discountBps / 100)' → '%12.5'.

**Etki:** TR kullanıcı ondalık ayırıcı tutarsızlığı görür; '0.0' puan ilanın kötü puanlandığı izlenimi verir.

**Önerilen aksiyon:** 'f.number(p.ratingAvg, { maximumFractionDigits: 1 })'; yorum yoksa 'Henüz puan yok'; promosyonda 'f.number(p.discountBps / 100)'.

**Yapılan düzeltme:** The rating now uses f.number(p.ratingAvg, {minimumFractionDigits:1, maximumFractionDigits:1}), so Turkish shows '4,5'. A listing with no reviews already showed property.noRating ('Henüz puan yok'). The PromotionsPanel percent value is listed in crossOwner.

## F1305 — Zorunlu/isteğe bağlı alan işaretleme ekranlar arası tutarsız

| Alan                | Değer                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Low                                                                                                                                                                      |
| Durum               | Aday                                                                                                                                                                     |
| Konum               | `src/components/host/HostDashboard.tsx:275`                                                                                                                              |
| Diğer konumlar      | `src/components/host/AccessibilityPanel.tsx:312-314`, `src/components/compliance/ComplianceDashboard.tsx:121-123,195-197`, `src/components/plan/TripPlanner.tsx:150-158` |
| Kullanıcılar        | ev sahibi, admin                                                                                                                                                         |
| Prensip             | learnability · consistency                                                                                                                                               |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                              |
| WCAG                | 3.3.2                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                    |
| Efor                | S                                                                                                                                                                        |
| Kaynak denetçiler   | lens:forms                                                                                                                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p081)                                                                                                                                   |

**Kanıt:** Bazı formlar isteğe bağlıyı etiketle belirtiyor: messages/tr/compliance.json `"reporterName": "Adınız (isteğe bağlı)"`, account.json `"properties": "İlan kısıtı (isteğe bağlı)"`, cart.json `"emailLabel": "E-posta (isteğe bağlı)"`. Diğerlerinde işaret yok: src/components/host/HostDashboard.tsx:275-287 izin belgesi (opsiyonel), :398-408 fiyat farkı (opsiyonel, birimsiz 'Fiyat farkı'), src/components/host/AccessibilityPanel.tsx:312-314 not, src/components/compliance/ComplianceDashboard.tsx:121-123 evrak no, :195-197 hukuki referans, src/components/plan/TripPlanner.tsx:150-158 başlangıç tarihi.

**Etki:** Ev sahibi hangi alanları boş bırakabileceğini deneme-yanılmayla öğrenir; 'Fiyat farkı'nın gecelik mi, TL mi olduğu belirsiz.

**Önerilen aksiyon:** Tek kural benimse: zorunlu olmayan her alanın etiketine '(isteğe bağlı)' ekle (Field'a `optional` prop'u); 'Fiyat farkı' etiketini 'Gecelik fiyat farkı ({para birimi})' yap.

**Yapılan düzeltme:** In my file, the optional fields now say so in their labels, following the repo's existing '(isteğe bağlı)' pattern: licence number in the create and edit forms becomes 'İzin belgesi no (isteğe bağlı)', and the room surcharge becomes 'Gecelik ek ücret ({currency}, isteğe bağlı)'. The calendar price label already says it can be left empty. AccessibilityPanel, ComplianceDashboard and TripPlanner belong to other packages, and adding an `optional` prop to Field would be a ui.tsx change.

## F1306 — Yatak tipi serbest metin ve varsayılanı arayüz diline bağlı

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:335` |
| Kullanıcılar        | ev sahibi, misafir                          |
| Prensip             | learnability · consistency                  |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                 |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p082)             |

**Kanıt:** HostDashboard.tsx:335 'bedType: t("rooms.add.defaultBedType")' (EN'de 'Double' kaydedilir); L389-396 serbest metin input.

**Etki:** EN arayüzlü host'un odaları TR misafire İngilizce yatak tipiyle görünür; yazım farkları filtrelemeyi bozar.

**Önerilen aksiyon:** Sabit kodlu <select> (DOUBLE, TWIN, SINGLE, …) ve görüntülemede i18n etiketi.

**Yapılan düzeltme:** Confirmed: the default bed type came from t("rooms.add.defaultBedType") (an EN host saved "Double") and the field was free text. Both the create form's first room and AddRoomForm now use a <select> of fixed codes (default DOUBLE) and store the code. Labels come from common.bedTypes.<CODE> through a new shared helper, src/lib/i18n/bed-type.ts, which exports BED_TYPES, DEFAULT_BED_TYPE and bedTypeKey(); bedTypeKey returns null for legacy free text so callers can fall back. Guest-facing display needs the crossOwner changes listed.

## F1307 — Takvim fiyat etiketi para birimini göstermiyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:498` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | learnability · consistency                  |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                 |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p082)            |

**Kanıt:** HostDashboard.tsx:498 'label={t("calendar.price")}' = 'Gecelik fiyat (boş = değişmez)'; taban fiyat etiketi L249 '({currency})' içeriyor; CalendarForm currency almıyor (L421).

**Etki:** Farklı para birimli mülkleri olan host hangi para biriminde girdiğinden emin olamaz.

**Önerilen aksiyon:** CalendarForm'a currency prop'u; etiket 'Gecelik fiyat ({currency}) — boş bırakılırsa değişmez'.

**Yapılan düzeltme:** Already fixed by an earlier package: CalendarForm takes a currency prop (passed as currency={p.currency}) and the label is t("calendar.priceLabel", { currency }). The key is in msg-ml/p080.json as 'Gecelik fiyat ({currency}) — boş bırakılırsa değişmez'.

## F1308 — İlan metni düğmesi isim öbeği; yeniden üretim taslağı uyarısız siliyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:559` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | learnability · predictability               |
| Sezgisel madde      | H13 — Feedforward                           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p082)             |

**Kanıt:** HostDashboard.tsx:559 TR 'İlan metni önerisi' (EN 'Suggest listing copy' fiil); taslak varken tekrar tıklama L547 'setDraft(res.draft)' ile eskisini uyarısız değiştirir.

**Etki:** Düğmenin eylem olduğu TR'de belirsiz; host beğendiği taslağı yanlışlıkla kaybeder.

**Önerilen aksiyon:** TR etiket 'İlan metni öner'; taslak varken 'Yeni öneri üret (mevcut taslak değişir)'.

**Yapılan düzeltme:** The TR label host.listingCopy.suggest is now the verb 'İlan metni öner'. When a draft exists, the button shows a new key listingCopy.regenerate ('Yeni öneri üret (mevcut taslak değişir)' / 'Generate a new suggestion (replaces the current draft)'), so the host knows the current draft will be replaced.

## F1309 — Fotoğraf kaldırma ve kalite skoru için geri bildirim eksik

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:625` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | robustness · observability                  |
| Sezgisel madde      | H12 — Feedback                              |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p082)             |

**Kanıt:** HostDashboard.tsx:621-626 remove başarıda yalnız 'setResult(null)' — mesaj yok, önceki error temizlenmez; L661 'Kalite skoru: {score}/100' yorumsuz.

**Etki:** Host kaldırmanın gerçekleşip gerçekleşmediğini anlamaz; skorun iyi mi kötü mü olduğunu bilemez.

**Önerilen aksiyon:** Başarıda 'Fotoğraf kaldırıldı.' durum mesajı; remove başında setError(null); skora seviye metni ('İyi (≥70) / Orta / Düşük').

**Yapılan düzeltme:** The removal feedback was already in place (remove clears errors and shows 'Fotoğraf kaldırıldı.'). The quality score now includes a level word: a new key photos.qualityRated with an ICU select reads iyi (70 and up), orta, or düşük (below 35, matching the VISION_LOW_QUALITY_THRESHOLD default). The new qualityLevel() helper is used both on the thumbnails and in the per-upload results.

## F1310 — Fotoğraflar tek tek yüklenebiliyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Aday                                        |
| Konum               | `src/components/host/HostDashboard.tsx:646` |
| Kullanıcılar        | ev sahibi                                   |
| Prensip             | flexibility · multithreading                |
| Sezgisel madde      | H7 — Esneklik/verim                         |
| Renk/tema           | Hayır                                       |
| Efor                | M                                           |
| Kaynak denetçiler   | area:host                                   |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p082)             |

**Kanıt:** HostDashboard.tsx:639-650 'type="file"' multiple yok; L646 'const file = e.target.files?.[0]'.

**Etki:** 20 fotoğraflık ilan için host 20 kez dosya seçici açar.

**Önerilen aksiyon:** 'multiple' + sıralı yükleme ve aria-live ilerleme '3/12 yüklendi'.

**Yapılan düzeltme:** The photo input is now `multiple`, with a hint (photos.multipleHint). uploadAll() uploads the files one after another. Each file still gets the client type/size checks, and errors and results build up per file. The aria-live region announces progress ('Fotoğraf 3/12 yükleniyor ve analiz ediliyor…') and a summary at the end (photos.uploadedMany). Files beyond the photo limit are not sent and get one error line (photos.tooMany). Results are kept per file, labelled with the file name, and each duplicate warning has its own remove button.

## F1311 — Ödeme tablolarında hücreler arası yatay boşluk yok, tutarlar sola hizalı

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Low                                       |
| Durum               | Aday                                      |
| Konum               | `src/components/host/PayoutPanel.tsx:180` |
| Kullanıcılar        | ev sahibi                                 |
| Prensip             | learnability · consistency                |
| Sezgisel madde      | H8 — Estetik/minimal tasarım              |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:host2                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p085)           |

**Kanıt:** PayoutPanel.tsx:163-182 ve 200-223 hücreler yalnız `className="py-2"`; RevenueDashboard.tsx:176-198 `pr-4` ve tutar için `text-right` kullanıyor.

**Etki:** Dar genişlikte komşu tutarlar bitişik görünür ('₺83.150,69₺4.376,36'); basamakları karşılaştırmak zorlaşır.

**Önerilen aksiyon:** th/td'ye `pr-4`, para hücrelerine ve başlıklarına `text-right tabular-nums` ekleyin.

**Yapılan düzeltme:** Horizontal spacing already existed as pe-4, the logical form of pr-4. Added text-end to the balance amount headers and cells and to the history amount header and cell; tabular-nums was already on the amounts. RevenueDashboard uses the same pattern.

## F1312 — Yeni promosyon formunun görünür başlığı yok

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Aday                                          |
| Konum               | `src/components/host/PromotionsPanel.tsx:226` |
| Kullanıcılar        | ev sahibi                                     |
| Prensip             | learnability · consistency                    |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                  |
| WCAG                | 2.4.6                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:host                                     |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p087)              |

**Kanıt:** PromotionsPanel.tsx:223-227 '<form … aria-label={t("promotions.form.ariaLabel")}>' — görsel başlık yok, alanlar tablonun hemen altında başlar.

**Etki:** Gören host tablodaki veriyle yeni kayıt formunun sınırını ayırt etmekte zorlanır.

**Önerilen aksiyon:** '<h3 id="promo-form-title">Yeni promosyon</h3>' + form'da aria-labelledby.

**Yapılan düzeltme:** Already fixed. A visible <h3 id="promo-form-title"> sits above the form ('Yeni promosyon', or 'Promosyonu düzenle: {name}' while editing), and the form uses aria-labelledby to point to it. Card renders an h2, so the heading order is correct.

## F1313 — Pickup grafiğinin verisi yalnız fareyle görülen SVG title'larında

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:103` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | accessibility · Non-text Content               |
| Sezgisel madde      | H14 — Erişilebilirlik                          |
| WCAG                | 1.1.1                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | lens:a11y                                      |
| **Düzeltme durumu** | **Zaten uygun** (paket: ml-p089)               |

**Kanıt:** 76-85 `role="img" aria-labelledby="pickup-title pickup-desc"`; desc yalnız nokta sayısı ve son değer; 93-105 günlük değerler yalnız `<rect><title>{...}</title></rect>` tooltip'inde.

**Etki:** Klavye/ekran okuyucu kullanan ev sahibi günlük rezervasyon girişlerini okuyamıyor; fiyat önerisi kararını eksik veriyle veriyor.

**Önerilen aksiyon:** Grafiğin altına `<details><summary>Veriyi tablo olarak göster</summary><table>…</table></details>` ekleyin.

**Yapılan düzeltme:** Already present: PickupChart renders `<details><summary>{pickup.tableToggle}</summary>` with a captioned table of date, pickup and onBooks per day, using th scope=row (RevenueDashboard.tsx, PickupChart).

## F1314 — Önerideki 'mevcut fiyat' üretim anındaki anlık görüntü; kabulde güncel fiyat kontrol edilmiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:162` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | robustness · observability                     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                 |
| Renk/tema           | Hayır                                          |
| Efor                | M                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: ml-p089)         |

**Kanıt:** RevenueDashboard.tsx:162 `f.money(s.currentMinor, …)` mevcut fiyat olarak sunuluyor; değer üretimde saklanıyor (src/lib/pricing/revenue.ts:410 `const currentMinor = minorFromDb(row.priceMinor)`), kabul (482-495) güncel fiyatla karşılaştırmadan yazıyor.

**Etki:** Öneri üretildikten sonra takvimden fiyatı elle değiştiren ev sahibi eski 'mevcut' fiyatı görür ve kabulle kendi güncel fiyatını farkında olmadan ezer.

**Önerilen aksiyon:** Etiketi 'Öneri anındaki fiyat' yapın ya da kabulde sunucu güncel priceMinor ile currentMinor'u karşılaştırıp 409 PRICE_CHANGED dönsün; istemci güncel fiyatı gösterip yeniden onay istesin.

**Yapılan düzeltme:** The client part is done. The current price now has a visible label, 'Öneri anındaki fiyat:' (new key suggestions.snapshotLabel). Single and bulk accept handle an ApiError with code PRICE_CHANGED by showing suggestions.priceChanged ('…öneriyi yeniden üretin'). The server-side check in revenue.ts is requested in crossOwner.

## F1315 — Katkı tablolarının caption'ı her öneride aynı, satır başlıkları yok, öneri öğelerinde başlık yok

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:173` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | accessibility · Info and Relationships         |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                    |
| WCAG                | 1.3.1                                          |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p089)                |

**Kanıt:** RevenueDashboard.tsx:173 `<caption className="sr-only">{t("suggestions.caption")}</caption>` her tabloda 'Öneri katkı tablosu'; 193 faktör hücresi `<td>` (PayoutPanel.tsx:176 satır başlığı için `<th scope="row">` kullanıyor); 158 oda·tarih `<p className="font-medium">`, başlık değil.

**Etki:** Ekran okuyucunun tablo/başlık listesinde 14 aynı 'Öneri katkı tablosu' görünür; öneriler arasında başlıkla atlanamaz.

**Önerilen aksiyon:** Caption'ı `t("suggestions.captionFor", { room: s.roomName, date })` yapın, faktör hücresini `<th scope="row">` yapın, oda·tarih satırını `<h3>` yapın.

**Yapılan düzeltme:** The caption and the region aria-label now use suggestions.captionFor with room and date. The factor cell is now `<th scope="row">`. The room·date line was already an h3.

## F1316 — 0 öneri üretildiğinde başarı rengiyle gerekçesiz mesaj gösteriliyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Low                                            |
| Durum               | Aday                                           |
| Konum               | `src/components/host/RevenueDashboard.tsx:246` |
| Kullanıcılar        | ev sahibi                                      |
| Prensip             | robustness · observability                     |
| Sezgisel madde      | H9 — Hata mesajları                            |
| Renk/tema           | Hayır                                          |
| Efor                | S                                              |
| Kaynak denetçiler   | area:host2                                     |
| **Düzeltme durumu** | **Düzeltildi** (paket: ml-p089)                |

**Kanıt:** RevenueDashboard.tsx:246 `setMessage(t("suggestions.generated", { count: res.suggestions.length }))` → '0 öneri üretildi. Fiyatlar…' ui.tsx:152 yeşil başarı metni olarak. Sunucu envanter satırı yoksa boş liste döndürür (src/lib/pricing/revenue.ts:375-379).

**Etki:** Ev sahibi işlemin başarılı olduğunu sanır ama hiçbir öneri görmez; envanter açmadığını anlamaz.

**Önerilen aksiyon:** count === 0 iken nötr bilgi metni gösterin: 'Bu oda için önümüzdeki 14 gecede açık envanter yok; takvimden müsaitlik açın.' (yeni anahtar suggestions.noneGenerated).

**Yapılan düzeltme:** When 0 suggestions come back, no green success message is shown. Instead the neutral status region shows suggestions.noneGenerated, which explains that no availability is open and links to /host#host-properties. The note clears when the room changes.
