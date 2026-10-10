# Talep/uyuşmazlık çözümü — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 50 bulgu · Severity: Critical 3, High 12, Medium 19, Low 16

## F7 — Türkçe binlik ayırıcı ile girilen tutar 1000 kat küçük kaydediliyor ("1.250" → ₺1,25). Misafir talep formunda da admin kısmi kararında da aynı

| Alan                | Değer                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                  |
| Durum               | Gözlemlendi                                                                                                                                               |
| Konum               | `src/components/resolution/shared.tsx:143`                                                                                                                |
| Diğer konumlar      | `src/components/resolution/OpenClaimForm.tsx`, `src/components/admin/ClaimAdmin.tsx`, `src/components/host/DepositSettings.tsx`, `src/lib/money/money.ts` |
| Kullanıcılar        | misafir, admin, ev sahibi                                                                                                                                 |
| Prensip             | robustness · Hata önleme / tutarlılık (Dix: robustness – recoverability, learnability – consistency)                                                      |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                          |
| WCAG                | 3.3.4 Error Prevention (Legal, Financial, Data) – AA                                                                                                      |
| Renk/tema           | Hayır                                                                                                                                                     |
| Efor                | M                                                                                                                                                         |
| Kaynak denetçiler   | runtime:resolution                                                                                                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: resolution)                                                                                                                        |

**Kanıt:** RUNTIME p1-panel (guest, desktop, TR, /booking/cmv2uyf700o3c92w2ti427b8v): Tutar alanına "1.250" yazıldı. Ağa giden POST /api/claims gövdesi {"amountMinor":125}, yani ₺1,25. pattern `\d+([.,]\d{1,3})?` bu girdiyi kabul ediyor, parseMajorInput "." karakterini ondalık sayıyor, toMinor da 3. basamaktaki 0'ı sessizce atıyor (money.ts:156). Ekranda yazılan değer "1.250" kalıyor; ekran görüntüsü: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/resolution/shots/panel-after-error-desktop-tr-427b8v.png. RUNTIME p6-admin (/admin/claims, sahte veriyle seçili talep): "Kısmi onay" + "1.250" gönderilince POST gövdesi {"decision":"PARTIAL","amountMinor":125} oldu. Aynı ekranda ipucu "Talep edilen tutardan (₺1.250,00) küçük olmalı." diyor. Yani uygulama tutarları noktayı binlik ayırıcı olarak gösteriyor (liste ve detay: "Talep edilen: ₺1.250,00"), girişte ise aynı yazımı ondalık diye okuyor. Formda gönderim öncesi bir özet ya da onay adımı yok. Kod: shared.tsx:143-150 (value.replace(",", ".")), OpenClaimForm.tsx:75 ve ClaimAdmin.tsx:214 (pattern). DepositSettings.tsx:8 de aynı parseMajorInput'u kullanıyor (yalnız kodda görüldü).

**Etki:** Misafir ₺1.250 isterken ₺1,25'lik talep açabiliyor. Admin ₺1.250 kısmi iade onaylamak isterken ₺1,25 onaylayabiliyor ve karar geri alınamıyor. İki durumda da doğrudan para kaybı oluyor ve kullanıcı hatayı fark etmiyor.

**Önerilen aksiyon:** parseMajorInput'u yerele duyarlı ve katı yapın. TR'de "." yalnızca binlik ayırıcı olarak kabul edilsin ("1.250" → 1250, "1.250,50" → 1250,50). Belirsiz yazımı ("." ile birlikte 3 hane, "," yok) ya doğru yorumlayın ya da "Binlik ayırıcı kullanmadan yazın, örn. 1250,50" diyerek reddedin. pattern para biriminin ondalık basamak sayısına göre üretilsin (TRY için `^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$`). Alanın altına canlı bir onay satırı ekleyin: "Talep edilecek tutar: ₺1.250,00" (f.money ile). Admin kararında gönderimden önce tutarı yeniden gösteren bir onay adımı olsun.

**Yapılan düzeltme:** shared.tsx parseMajorInput now uses parseAmountToMinor with the currency's ISO decimal places (currencyExponent), so "1.250" gives 125000 and "1.250,50" gives 125050. It returns null when the value is invalid or not positive. OpenClaimForm: the narrow pattern was removed and the input has inputMode=decimal and autoComplete=off. A live preview line (aria-live=polite) shows "Talep edilecek tutar: ₺1.250,00", and the hint shows example formats. The success message now includes the amount. ClaimAdmin and DepositSettings belong to other owners; see crossOwner. — dosyalar: `src/components/resolution/shared.tsx`, `src/components/resolution/OpenClaimForm.tsx`

## F16 — Tutar alanları Türkçe binlik ayırıcıyı ondalık sanıyor: "1.250" sessizce 1,25 TL oluyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Konum               | `src/components/resolution/shared.tsx:145`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Diğer konumlar      | `src/components/resolution/OpenClaimForm.tsx:75`, `src/components/host/DepositSettings.tsx:116-143`, `src/components/admin/ClaimAdmin.tsx:144-214`, `src/lib/money/money.ts:153-159`, `src/components/resolution/OpenClaimForm.tsx:73-80`, `src/components/host/DepositSettings.tsx:91`, `src/components/host/DepositSettings.tsx:143`, `src/components/admin/ClaimAdmin.tsx:144`, `src/components/admin/ClaimAdmin.tsx:214`, `src/components/cart/SplitPayPanel.tsx:100`, `src/components/cart/SplitPayPanel.tsx:262`, `src/components/transfers/TransferMarket.tsx:122`, `messages/tr/resolution.json:89` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Prensip             | robustness · task conformance, error prevention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| WCAG                | 3.3.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Kaynak denetçiler   | lens:forms, lens:copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Düzeltme durumu** | **Düzeltildi** (paket: resolution)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Kanıt:** src/components/resolution/shared.tsx:143-150 `toMinor(value.trim().replace(",", "."), currency)`; src/lib/money/money.ts:156-159 fazla kesir basamağı sıfırsa hata atmıyor: `if (frac.length > exp && /[1-9]/.test(frac.slice(exp)))` → "1.250" için frac="250", minor=125 (1,25 TL). Alanlardaki desen bunu kabul ediyor: src/components/resolution/OpenClaimForm.tsx:75 `pattern="\d+([.,]\d{1,3})?"`, src/components/host/DepositSettings.tsx:143 aynı desen, src/components/admin/ClaimAdmin.tsx:214 aynı desen. Önizleme/biçimlendirilmiş geri bildirim yok.

**Etki:** TR kullanıcı alışkanlığıyla 1.250 (bin iki yüz elli) yazan misafir 1,25 TL iade talep eder; ev sahibi 1.500 TL depozito yerine 1,50 TL tanımlar; yönetici 1.000 TL kısmi iade yerine 1 TL karar verir. Hata sunucuda da yakalanmaz, para kaybına yol açar.

**Önerilen aksiyon:** parseMajorInput'u yerel ayara duyarlı yap: TR'de '.' binlik, ',' ondalık kabul et ("1.250,50" → 1250.50); belirsiz "1.250" girdisini ya binlik olarak yorumla ya da Field `error` ile "Ondalık için virgül kullanın (ör. 1250,00)" diye reddet. Desen kesir hanesini para biriminin basamağıyla sınırla (TRY için {1,2}). Alanın altına canlı önizleme ekle: `<p id=…-preview aria-live="polite">= {f.money(minor)}</p>` ve aria-describedby ile bağla.

**Yapılan düzeltme:** Duplicate of F7. Fixed with the same parser and live preview. — dosyalar: `src/components/resolution/shared.tsx`, `src/components/resolution/OpenClaimForm.tsx`

## F29 — Binlik ayırıcıyla girilen tutar sessizce 1000 kat küçük talep ediliyor ("1.250" -> 1,25 TL)

| Alan                | Değer                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Critical                                                                                                                                                                           |
| Durum               | Aday                                                                                                                                                                               |
| Konum               | `src/components/resolution/OpenClaimForm.tsx:75`                                                                                                                                   |
| Diğer konumlar      | `src/components/resolution/shared.tsx:143-150`, `src/lib/money/money.ts:153-159`, `src/components/admin/ClaimAdmin.tsx:144,214`, `src/components/host/DepositSettings.tsx:116,143` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                 |
| Prensip             | robustness · hata önleme / recoverability (ileri yönlü hata önleme)                                                                                                                |
| Sezgisel madde      | H5 — Hata önleme                                                                                                                                                                   |
| WCAG                | 3.3.4                                                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                              |
| Efor                | M                                                                                                                                                                                  |
| Kaynak denetçiler   | area:resolution                                                                                                                                                                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: resolution)                                                                                                                                                 |

**Kanıt:** OpenClaimForm.tsx:75 `pattern="\d+([.,]\d{1,3})?"`, iki ondalıklı TRY için de 3 haneli kesire izin veriyor. Bu yüzden "1.250" desene uyuyor. shared.tsx:145 `toMinor(value.trim().replace(",", "."), currency)` -> money.ts:156-159: frac="250", exp=2, fazladan basamak "0" olduğu için hata atılmıyor ve `minor = 1*100 + 25 = 125` çıkıyor, yani 1,25 TL. Türkçede "." binlik ayırıcıdır, kullanıcı 1.250 TL demek istiyor. İpucu (tr resolution.json:89) "örneğin 250,00" diyor ama binlik ayırıcı uyarısı yok. Gönderimden önce ayrıştırılmış tutar hiçbir yerde gösterilmiyor. Başarı mesajı yalnızca "Talebiniz açıldı." (json:94).

**Etki:** Türkçe yazan misafir, iade talebinde 1.250 TL yerine 1,25 TL istiyor. Ev sahibinin "10.000" diye girdiği hasar talebi 10 TL olarak açılıyor. Hata ancak listede "Talep edilen: ₺1,25" fark edilirse yakalanıyor. Fark edilmezse yönetici yanlış tutarı onaylıyor ve para kaybı oluşuyor. Aynı ayrıştırıcıyı kullanan yöneticinin kısmi karar tutarı ve ev sahibinin depozito ayarı da aynı riski taşıyor.

**Önerilen aksiyon:** 1) parseMajorInput'a `locale` parametresi eklenmeli. Girdide "." ile ayrılmış tam 3 haneli grup varsa (`/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/`) bu grup binlik kabul edilip noktalar silinmeli, ya da açık bir hata verilmeli: "Binlik ayırıcı kullanmayın (ör. 1250,50)". 2) Desen para biriminin basamak sayısıyla sınırlanmalı (TRY için `\d+([.,]\d{1,2})?`). 3) Alanın altına `aria-live="polite"` bir önizleme satırı eklenmeli: "Talep edilecek tutar: {f.money(parsed)}". 4) Başarı mesajına tutar yazılmalı: "₺1.250,00 tutarında talebiniz açıldı".

**Yapılan düzeltme:** Duplicate of F7/F16. Includes the parser, pattern removal, aria-live preview and a success message with the amount. — dosyalar: `src/components/resolution/shared.tsx`, `src/components/resolution/OpenClaimForm.tsx`

## F65 — Çözüm merkezinin boş durumu yeni talebin nasıl açılacağını söylemiyor, sayfada hiç bağlantı yok

| Alan                | Değer                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                         |
| Durum               | Gözlemlendi (2 kaynak birleşti)                                                                                              |
| Konum               | `src/app/resolution/page.tsx:31`                                                                                             |
| Diğer konumlar      | `messages/tr/resolution.json`, `src/components/layout/Footer.tsx`, `src/components/resolution/BookingResolutionPanel.tsx:78` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                           |
| Prensip             | learnability · Yardım / ileri bildirim, tanıma > hatırlama (Dix: learnability – guessability)                                |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                                                                                   |
| Renk/tema           | Hayır                                                                                                                        |
| Efor                | S                                                                                                                            |
| Kaynak denetçiler   | runtime:resolution, lens:nav                                                                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: resolution)                                                                                    |

**Kanıt:** Tarama 074/075 (guest, /resolution, desktop 1280 ve mobil 390): içerik yalnızca "Taleplerim ¦ Henüz bir talebiniz yok." Ekran görüntüleri C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/crops/resolution/074-guest-tr-desktop-_resolution-0.png ve 075-…-0.png. Giriş metni "izleyin, yanıtlayın ve kanıt ekleyin" diyor, talep "açmaktan" söz etmiyor. RUNTIME p12-footer (mobil): `main a` sayısı 0. Aynı sayfanın footer'ındaki "Para iadesi" bağlantısı "/" adresine gidiyor (Footer.tsx:34; tüm sütun bağlantıları href="/"). Gerçek yol Hesabım → rezervasyon → sayfa sonundaki panel. RUNTIME p8-mobile: 390px'te panelin başlangıcı y=1162px (yaklaşık 1,4 ekran aşağıda), "Mesajlar" bölümünün altında.

**Etki:** Sorun yaşayan ve doğrudan Çözüm merkezine gelen misafir (çoğu mobilde) talep açma yolunu bulamıyor. Host için zaten yol yok. Bu, alanın birincil görevinin öğrenilmesini engelliyor.

**Önerilen aksiyon:** Boş duruma şunları ekleyin: kısa bir açıklama ("İade talebi, ilgili rezervasyonun sayfasından açılır. Girişten itibaren çıkıştan sonraki 14 güne kadar açabilirsiniz."), birincil CTA "Rezervasyonlarıma git" (/account ya da /trips) ve uygun rezervasyon varsa doğrudan "Bu rezervasyon için talep aç" kısayolu. Giriş metnine "açın" fiilini ekleyin. Footer'daki "Para iadesi" ve "İade politikası" bağlantılarını /resolution ve politika sayfasına bağlayın.

**Yapılan düzeltme:** resolution/page.tsx: the empty state now explains how to open a claim (from the booking page, within the guest window) and adds a "Rezervasyonlarıma git" link to /trips with a 44px mobile target. The page.intro text now says claims are opened from the booking page. Not done: a per-booking shortcut (needs eligibility data) and the Footer links (other owner). — dosyalar: `src/app/resolution/page.tsx`

## F135 — Talep formu, talep açılamayacak rezervasyonlarda da etkin görünüyor; tarih penceresi önceden söylenmiyor

| Alan                | Değer                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                         |
| Durum               | Gözlemlendi                                                                                                  |
| Konum               | `src/components/resolution/BookingResolutionPanel.tsx:78`                                                    |
| Diğer konumlar      | `src/components/resolution/OpenClaimForm.tsx`, `messages/tr/resolution.json`, `src/lib/resolution/claims.ts` |
| Kullanıcılar        | misafir                                                                                                      |
| Prensip             | robustness · Hata önleme + ileri bildirim (Dix: learnability – predictability/operation visibility)          |
| Sezgisel madde      | H13 — Feedforward                                                                                            |
| Renk/tema           | Hayır                                                                                                        |
| Efor                | M                                                                                                            |
| Kaynak denetçiler   | runtime:resolution                                                                                           |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: resolution)                                                                    |

**Kanıt:** RUNTIME p1-panel: girişi 24.10.2026 olan CONFIRMED rezervasyon /booking/cmv2uyf700o3c92w2ti427b8v (desktop, TR). Form tamamen etkin. Geçerli tutar ve açıklama ile gönderilince 409 CLAIM_TOO_EARLY döndü ve şu mesaj çıktı: "Bu talep türü henüz açılamaz (konaklama başlamadan / bitmeden önce)." Mesajda "/" ile iki durum birlikte yazılmış, tarih yok. RUNTIME p2-completed: çıkışı 19.09.2026 olan COMPLETED rezervasyon /booking/cmv2uyfrb0o7092w2y7ksd4qq. CLAIM_GUEST_WINDOW_DAYS=14 olduğu için pencere 03.10'da kapanmış, form yine de etkin. Gönderim sonrası "Talep açma süresi doldu." çıktı (masaüstü TR ve mobil EN'de aynı; panel-desktop-tr-ksd4qq.png, panel-mobile-en-ksd4qq.png). Mevcut seed'de misafirin dokuz rezervasyonunun hiçbirinde talep açılamıyor ama hepsinde form görünüyor. Panelde ne açılış tarihi ne son tarih yazıyor.

**Etki:** Misafir sorununu yazmaya emek veriyor ve ancak gönderdikten sonra talep açamayacağını öğreniyor. Süresi geçmiş durumda ne yapabileceği de söylenmiyor. Bu hayal kırıklığı yaratıyor ve destek yükünü artırıyor.

**Önerilen aksiyon:** /api/bookings/[id]/deposit (ya da ayrı bir eligibility uç noktası) şunu döndürsün: {eligible, opensAt, closesAt, reason}. Panel bu bilgiye göre konuşsun. Pencere açılmadıysa: "İade talebini 24 Ekim 2026 (giriş) ile 10 Kasım 2026 arasında açabilirsiniz" yazsın, form gizli ya da devre dışı olsun. Pencere kapandıysa: "Talep süresi 3 Ekim'de doldu. Destek ekibine yazın" ve /support bağlantısı. Pencere açıkken formun üstünde "Son gün: …" gösterilsin. CLAIM_TOO_EARLY metnini türe göre ayırın ve tarih ekleyin.

**Yapılan düzeltme:** BookingResolutionPanel: if the user already has an active claim they opened on this booking, the form is hidden and a message plus a "Açık talebi görüntüle" link appear instead. The guest form text states the window ({days}=14, the CLAIM_GUEST_WINDOW_DAYS default). Not done: opensAt, closesAt and reason per booking need an eligibility endpoint (needs backend/API change). — dosyalar: `src/components/resolution/BookingResolutionPanel.tsx`, `src/components/resolution/OpenClaimForm.tsx`

## F136 — Kanıt yükleme kısıtları gizli; aşımda teknik ve sınırı söylemeyen 'İstek gövdesi çok büyük' hatası çıkıyor

| Alan                | Değer                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                          |
| Durum               | Gözlemlendi                                                                                                                   |
| Konum               | `src/components/resolution/ClaimEvidence.tsx:107`                                                                             |
| Diğer konumlar      | `src/lib/config/app-config.ts`, `src/lib/resolution/evidence.ts`, `src/lib/http/body-limit.ts`, `messages/tr/resolution.json` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                            |
| Prensip             | robustness · Kısıtların görünürlüğü / hata önleme (Dix: learnability – predictability)                                        |
| Sezgisel madde      | H5 — Hata önleme                                                                                                              |
| WCAG                | 3.3.3 Error Suggestion (AA)                                                                                                   |
| Renk/tema           | Hayır                                                                                                                         |
| Efor                | M                                                                                                                             |
| Kaynak denetçiler   | runtime:resolution                                                                                                            |
| **Düzeltme durumu** | **Düzeltildi** (paket: resolution)                                                                                            |

**Kanıt:** RUNTIME p4-mock (talep detayı ağ katmanında sahte veriyle, render gerçek): yükleme alanında yalnızca "Kanıt yükle (fotoğraf veya PDF)" etiketi ve EXIF/GPS gizlilik notu var (aria-describedby yalnız bu nota bağlı). Boyut sınırı, dosya sayısı sınırı ve kalan hak gösterilmiyor. Kodda tanımlı sınırlar: görsel 8 MB, PDF 5 MB, talep başına 10 dosya (app-config.ts:238-242). accept listesi AVIF/GIF'i de kabul ediyor ama etikette sadece "fotoğraf" yazıyor. multiple=false. RUNTIME p5-upload: 9 MB PNG seçildi, GERÇEK sunucu 83-96 ms içinde 413 {"error":"İstek gövdesi çok büyük","code":"PAYLOAD_TOO_LARGE"} döndü. UI bu metni olduğu gibi gösterdi; EN arayüzde de Türkçe kaldı (C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/resolution/shots/upload-413-tr.png, upload-413-en.png). evidence.ts:66-99 de sınırı belirtmeyen mesajlar üretiyor ("PDF çok büyük", "Görsel çok büyük").

**Etki:** Mobilde yüksek çözünürlüklü fotoğraf yükleyen misafir anlaşılmaz bir hata alıyor ve dosyayı ne kadar küçültmesi gerektiğini bilmiyor. 10 dosya sınırı da ancak aşıldığında öğreniliyor. Kanıt eksik kalınca talep zayıflıyor.

**Önerilen aksiyon:** Input'a ikinci bir aria-describedby ipucu ekleyin: "JPEG, PNG, WebP, AVIF, GIF (en fazla 8 MB) veya PDF (en fazla 5 MB) · Talep başına 10 dosya · 3/10 kullanıldı". Sınırları istemciye config üzerinden geçirip seçim anında file.size kontrolü yapın ve yerel dilde "Dosya 9,1 MB; en fazla 8 MB yükleyebilirsiniz" deyin. PAYLOAD_TOO_LARGE, VALIDATION_ERROR (tür/boyut) ve CLAIM_EVIDENCE_LIMIT kodlarını i18n mesajlarına eşleyin. Gerekirse multiple desteği ekleyin.

**Yapılan düzeltme:** ClaimEvidence: a new limits hint is linked through aria-describedby and lists accepted types, 8 MB for images, 5 MB for PDF, 10 files per claim and how many are used. Type and size are checked when a file is selected, with a localized message ("Dosya 9,1 MB; ... en fazla 8 MB"). PAYLOAD_TOO_LARGE / 413 maps to a localized message in useClaimErrorText. The limits are client-side constants that match the server defaults. — dosyalar: `src/components/resolution/ClaimEvidence.tsx`, `src/components/resolution/shared.tsx`

## F137 — Doğrulama hataları alana bağlanmıyor: aria-invalid yok, sunucu alan hataları kullanılmıyor, boşluklu açıklama 'Geçersiz talep' döndürüyor

| Alan                | Değer                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                             |
| Durum               | Gözlemlendi                                                                                      |
| Konum               | `src/components/resolution/OpenClaimForm.tsx:39`                                                 |
| Diğer konumlar      | `src/components/ui/ui.tsx`, `src/components/admin/ClaimAdmin.tsx`                                |
| Kullanıcılar        | misafir, admin                                                                                   |
| Prensip             | accessibility · Hata mesajları – tanımla, konumlandır, düzelt (Dix: robustness – recoverability) |
| Sezgisel madde      | H9 — Hata mesajları                                                                              |
| WCAG                | 3.3.1 Error Identification (A), 3.3.3 Error Suggestion (AA)                                      |
| Renk/tema           | Hayır                                                                                            |
| Efor                | M                                                                                                |
| Kaynak denetçiler   | runtime:resolution                                                                               |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: resolution)                                                        |

**Kanıt:** RUNTIME p1-panel (desktop TR): tutar "0" girilince "Geçerli, sıfırdan büyük bir tutar girin." mesajı formun en altındaki Status'ta çıktı. Tutar alanında aria-invalid=null, odak butonda kaldı. Açıklama 12 boşlukla gönderildi: tarayıcının minLength kontrolü geçti, istemci trim() yaptı. Sunucu 400 döndü: {"error":"Geçersiz talep","details":{"fieldErrors":{"description":["String must contain at least 10 character(s)"]}}}. Ekrana yalnızca "Geçersiz talep" yazıldı, hangi alanın hatalı olduğu söylenmedi, odak body'ye düştü. Boş, "abc" ve kısa açıklama gönderimlerinde yalnızca tarayıcının geçici baloncukları çıktı (validationMessage, "match the requested format"). Kalıcı satır içi hata yok. RUNTIME p6-admin: kısmi tutar 1500 (> talep edilen 1250) için mesaj altta göründü, aria-invalid=null, odak "Kararı kaydet" butonundaydı. Field bileşeni `error` prop'unu destekliyor (ui.tsx:47-85) ama bu formlarda hiç geçilmiyor.

**Etki:** Düşük okuryazarlıktaki ve ekran okuyucu kullanan misafirler neyin yanlış olduğunu ve nereyi düzelteceklerini anlamıyor. Baloncuklar kaybolunca ipucu da kayboluyor. 'Geçersiz talep' ifadesi düzeltme önerisi sunmuyor.

**Önerilen aksiyon:** Forma noValidate ekleyip istemci doğrulamasını kendiniz yapın. Alan bazında error state tutup Field `error` prop'una verin; aria-invalid ve aria-describedby otomatik bağlansın. Hata olunca ilk hatalı alana odaklanın. Açıklamayı trim sonrası ≥10 karakter diye istemcide doğrulayın ve bir karakter sayacı gösterin ("12/4000"). VALIDATION_ERROR yanıtındaki details.fieldErrors'u ilgili alanlara eşleyin. Desen hatası için örnekli mesaj verin: "Tutarı 250 veya 250,50 biçiminde yazın".

**Yapılan düzeltme:** OpenClaimForm now has noValidate and per-field errors through the Field error prop (aria-invalid and aria-describedby are added automatically). The description is checked for at least 10 characters after trimming, with a character counter. Focus moves to the first invalid field. The CLAIM_AMOUNT_EXCEEDS_REFUNDABLE error is attached to the amount field. The submit button is disabled and aria-busy while sending. Not done: mapping VALIDATION_ERROR details.fieldErrors, because the details shape is unknown; a localized general message is shown instead. — dosyalar: `src/components/resolution/OpenClaimForm.tsx`

## F138 — Üst sınır aşımında azami tutar hiç gösterilmiyor (details.refundableMinor string geliyor) ve iade sınırı formda önceden yazmıyor

| Alan                | Değer                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                         |
| Durum               | Gözlemlendi                                                                                                  |
| Konum               | `src/components/resolution/shared.tsx:130`                                                                   |
| Diğer konumlar      | `src/lib/resolution/claims.ts`, `src/components/resolution/OpenClaimForm.tsx`, `messages/tr/resolution.json` |
| Kullanıcılar        | misafir                                                                                                      |
| Prensip             | robustness · Yapıcı hata mesajı / ileri bildirim                                                             |
| Sezgisel madde      | H9 — Hata mesajları                                                                                          |
| WCAG                | 3.3.3 Error Suggestion (AA)                                                                                  |
| Renk/tema           | Hayır                                                                                                        |
| Efor                | S                                                                                                            |
| Kaynak denetçiler   | runtime:resolution                                                                                           |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: resolution)                                                                    |

**Kanıt:** Kod: sunucu claims.ts:270'te `details: { refundableMinor: refundable.toString() }` (string) gönderiyor. İstemci shared.tsx:130-131'de `typeof max !== "number"` olduğu için err.message'a düşüyor. Böylece "Tutar iade edilebilir üst sınırı aşıyor (en fazla {amount})" çevirisi hiç kullanılmıyor. RUNTIME p10-exceeds: POST yanıtı sunucunun ürettiği şekliyle birebir taklit edildi (422, details.refundableMinor:"450000"). TR'de ekranda "Talep, iade edilebilir tutarı aşıyor" çıktı. EN'de de aynı Türkçe metin çıktı. Azami tutar iki dilde de görünmüyor. Ayrıca p1/p2 panel metninde iade edilebilir en fazla tutar yok. Bu bilgi yalnız talep detayında ("İade edilebilir en fazla: ₺4.500,00", ClaimDetail.tsx:150-153) gösteriliyor.

**Etki:** Misafir tutarı tahminle düşürüp tekrar tekrar deniyor. Sınır bilgisi sistemde olduğu halde kullanıcıya verilmiyor.

**Önerilen aksiyon:** İstemcide `const max = Number(details?.refundableMinor)` ile parse edip Number.isFinite kontrolü yapın, ya da sunucu sayı göndersin (claims.ts:270 ve :821). Daha iyisi: panelin deposit/eligibility yanıtına refundableMinor ekleyip tutar alanının ipucunda "En fazla ₺4.500,00 talep edebilirsiniz" yazın ve istemcide de kontrol edin.

**Yapılan düzeltme:** useClaimErrorText now accepts refundableMinor as a string or a number and checks it with Number.isSafeInteger. If it is invalid, a new localized key is shown (CLAIM_AMOUNT_EXCEEDS_REFUNDABLE_NOAMOUNT) instead of the raw server text. Not done: showing the limit in the form before submission needs refundableMinor in the deposit response (needs backend/API change). — dosyalar: `src/components/resolution/shared.tsx`

## F139 — Sunucunun Türkçe ham hata metinleri İngilizce arayüze sızıyor (Talep bulunamadı, İstek gövdesi çok büyük, Geçersiz talep)

| Alan                | Değer                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                    |
| Durum               | Gözlemlendi                                                                                             |
| Konum               | `src/components/resolution/shared.tsx:136`                                                              |
| Diğer konumlar      | `src/components/ui/ui.tsx`, `src/components/resolution/ClaimDetail.tsx`, `src/lib/resolution/claims.ts` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                               |
| Prensip             | accessibility · Tutarlılık / dil (Dix: learnability – consistency)                                      |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                             |
| WCAG                | 3.1.2 Language of Parts (AA)                                                                            |
| Renk/tema           | Hayır                                                                                                   |
| Efor                | S                                                                                                       |
| Kaynak denetçiler   | runtime:resolution                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: resolution)                                                                      |

**Kanıt:** RUNTIME p3-pages (guest, EN, /resolution/missing): main = "Claim details ¦ Back to all claims ¦ Talep bulunamadı". Sayfa lang=en, metin Türkçe ve lang işareti yok. RUNTIME p5-upload EN: "İstek gövdesi çok büyük". RUNTIME p10-exceeds EN: "Talep, iade edilebilir tutarı aşıyor". Kod: useClaimErrorText yalnız KNOWN_ERROR_CODES içindeki kodları çeviriyor (shared.tsx:103-119), NOT_FOUND, VALIDATION_ERROR ve PAYLOAD_TOO_LARGE ise errorMessage(err) ile ham sunucu mesajına düşüyor (shared.tsx:136). ClaimDetail.tsx:38 de useLoader hatasını (ui.tsx:255) doğrudan gösteriyor.

**Etki:** İngilizce kullanan misafir hatayı okuyamıyor. Ekran okuyucu Türkçe metni İngilizce telaffuzla okuyor.

**Önerilen aksiyon:** Hata kodu → i18n eşlemesini NOT_FOUND ("This claim could not be found"), VALIDATION_ERROR, PAYLOAD_TOO_LARGE, UNAUTHORIZED ve EMAIL_NOT_VERIFIED için genişletin. Bilinmeyen kodda sunucu metni yerine yerel genel mesaj gösterin; sunucu mesajı yalnızca loglansın.

**Yapılan düzeltme:** useClaimErrorText now handles errors in this order: NOT_FOUND / 404, VALIDATION_ERROR, PAYLOAD_TOO_LARGE / 413 and known claim codes use resolution.errors. Network errors, 5xx, missing codes and the general codes use the shared useErrorText (common.errors.*). An unknown 4xx code shows the localized resolution.errors.unknown and never the raw server text. — dosyalar: `src/components/resolution/shared.tsx`

## F330 — Çözüm merkezi sayfalarının belge başlığı (title) genel site başlığıyla aynı

| Alan                | Değer                                                         |
| ------------------- | ------------------------------------------------------------- |
| Severity            | High                                                          |
| Durum               | Aday                                                          |
| Konum               | `src/app/resolution/page.tsx:1`                               |
| Diğer konumlar      | `src/app/resolution/[id]/page.tsx:1`, `src/app/layout.tsx:16` |
| Kullanıcılar        | tümü                                                          |
| Prensip             | accessibility · WCAG 2.4.2 Page Titled                        |
| Sezgisel madde      | H14 — Erişilebilirlik                                         |
| WCAG                | 2.4.2                                                         |
| Renk/tema           | Hayır                                                         |
| Efor                | S                                                             |
| Kaynak denetçiler   | area:resolution                                               |
| **Düzeltme durumu** | **Zaten uygun** (paket: resolution)                           |

**Kanıt:** resolution/page.tsx:1 ve [id]/page.tsx:1 `"use client"`: metadata dışa aktarılamıyor ve src/app/resolution altında layout.tsx yok (glob yalnız iki page.tsx buldu). Bu yüzden layout.tsx:16 `title: t("meta.title")` = "booking-platform — konaklama arama ve rezervasyon (demo)" tüm talep sayfalarında aynen kalıyor. Kodda document.title ataması da yok.

**Etki:** Ekran okuyucu kullanıcısı sekmeler ya da geçmiş arasında "Çözüm merkezi" ile "Talep ayrıntısı" sayfasını ayırt edemiyor. Birden çok talep sekmesi açan yönetici ve ev sahibi hangi sekmenin hangi talep olduğunu göremiyor. Level A ihlali.

**Önerilen aksiyon:** `src/app/resolution/layout.tsx` (sunucu bileşeni) içinde i18n'li `generateMetadata` ile "Çözüm merkezi | booking-platform" verilmeli. [id] için ayrı bir layout'ta "Talep ayrıntısı | Çözüm merkezi" verilmeli. Veri yüklenince ClaimDetail'de `useEffect` ile `document.title = `${t(`type.${claim.type}`)} – ${t(`status.${claim.status}`)} | …`` atanmalı. (Next 16 metadata API'si node_modules/next/dist/docs'tan doğrulanmalı.)

**Yapılan düzeltme:** Page titles were handled globally in wave 1, as instructed. I added no metadata.

## F331 — Talep açma formu uygun olmayan durumlarda da gösteriliyor (giriş öncesi, süre dolmuş, açık talep var)

| Alan                | Değer                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                  |
| Durum               | Aday                                                                                                                                  |
| Konum               | `src/components/resolution/BookingResolutionPanel.tsx:78`                                                                             |
| Diğer konumlar      | `src/components/resolution/OpenClaimForm.tsx:62-105`, `src/app/booking/[id]/page.tsx:178-180`, `src/lib/resolution/claims.ts:230-283` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                    |
| Prensip             | learnability · predictability / feedforward                                                                                           |
| Sezgisel madde      | H13 — Feedforward                                                                                                                     |
| Renk/tema           | Hayır                                                                                                                                 |
| Efor                | M                                                                                                                                     |
| Kaynak denetçiler   | area:resolution                                                                                                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: resolution)                                                                                             |

**Kanıt:** BookingResolutionPanel.tsx:78-88 `deposit && (deposit.role === "ADMIN" ? ... : <OpenClaimForm .../>)`: form, CONFIRMED veya COMPLETED her rezervasyonda (booking/[id]/page.tsx:178-180) koşulsuz gösteriliyor. Sunucu ise claims.ts:234-235'te girişten önce CLAIM_TOO_EARLY, :240-243 ve :277-281'de süre dolunca CLAIM_WINDOW_CLOSED, :315-320'de açık talep varken CLAIM_ALREADY_OPEN döndürüyor. Panel `claimsRes`'te açık talebi zaten biliyor (satır 60-67) ama formu gizlemiyor. Başarılı gönderimden sonra da form yeniden boş olarak duruyor (OpenClaimForm.tsx:51-53).

**Etki:** Gelecekteki rezervasyonu olan misafir "İade talebi aç" formunu iptal yolu sanıyor. Açıklama yazıp gönderiyor ve ancak sonra "henüz açılamaz" hatası alıyor. Talep açtıktan sonra form tekrar göründüğü için ikinci bir talep deniyor ve hata alıyor. Süresi geçmiş rezervasyonda da boşuna emek harcanıyor.

**Önerilen aksiyon:** Deposit yanıtına (ya da yeni `GET /api/bookings/:id/claim-eligibility` ucuna) `canOpen`, `opensAt`, `closesAt`, `reason` alanları eklenmeli. Durumlara göre şunlar gösterilmeli: giriş öncesi "İade talebini {opensAt} tarihinden sonra açabilirsiniz. Rezervasyonu iptal etmek için yukarıdaki ‘Rezervasyonu iptal et’ düğmesini kullanın."; açık talep varsa form yerine "Bu rezervasyon için açık talebiniz var" + Link `/resolution/{id}`; süre dolmuşsa nedeni. Form görünürken üstüne "Son başvuru: {closesAt}" yazılmalı.

**Yapılan düzeltme:** Same change as F135: the open-claim case is resolved on the client, and the date window still needs the backend. — dosyalar: `src/components/resolution/BookingResolutionPanel.tsx`

## F332 — Kanıt, dosya seçilir seçilmez onaysız yükleniyor; geri alınamıyor ve silinemiyor

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | High                                                                                 |
| Durum               | Aday                                                                                 |
| Konum               | `src/components/resolution/ClaimEvidence.tsx:119`                                    |
| Diğer konumlar      | `src/app/api/claims/[id]/evidence/route.ts:12-25`, `messages/tr/resolution.json:142` |
| Kullanıcılar        | misafir, ev sahibi                                                                   |
| Prensip             | robustness · recoverability / kullanıcı kontrolü                                     |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                    |
| WCAG                | 3.3.4                                                                                |
| Renk/tema           | Hayır                                                                                |
| Efor                | M                                                                                    |
| Kaynak denetçiler   | area:resolution                                                                      |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: resolution)                                            |

**Kanıt:** ClaimEvidence.tsx:119-123 `onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); ...}}`: seçim anında POST yapılıyor. Önizleme, dosya adı ya da "Yükle / Vazgeç" adımı yok. API'de kanıt silme ucu yok (yalnız evidence/route.ts POST ve [evidenceId] GET var). Dosyayı karşı taraf ve yönetici hemen görüyor. Kullanıcıya "yüklenen kanıt karşı tarafa görünür" bilgisi de verilmiyor (json:142 yalnız metadata silindiğini söylüyor).

**Etki:** Mobilde galeriden yanlış fotoğraf seçen misafir (örneğin kişisel bir fotoğraf) bunu geri alamıyor. Dosya ev sahibine ve yöneticiye açılıyor ve 10 dosyalık kotadan (CLAIM_EVIDENCE_MAX_FILES) bir hak tüketiyor. Gizlilik ve veri kaybı riski var.

**Önerilen aksiyon:** İki adımlı akış kurulmalı: seçim yalnız state'e alınmalı, küçük önizleme (URL.createObjectURL), dosya adı ve boyut gösterilmeli, ardından "Kanıtı yükle" ve "Vazgeç" düğmeleri sunulmalı. Girdinin altına "Yüklediğiniz dosyalar karşı taraf ve yönetici tarafından görülür" metni eklenmeli. Talep açıkken yükleyenin kendi kanıtını silebileceği `DELETE /api/claims/:id/evidence/:evidenceId` ucu ve her karta "Kaldır" düğmesi (onaylı) eklenmeli.

**Yapılan düzeltme:** ClaimEvidence now uploads in two steps: selecting a file only stores it in state and shows the file name and size, then the user picks "Kanıtı yükle" or "Vazgeç" (busy and aria-busy prevent a double upload). A visibility notice was added: the other party and the admin can see the file, and it cannot be removed. Not done: deleting evidence needs a DELETE endpoint (needs backend/API change). — dosyalar: `src/components/resolution/ClaimEvidence.tsx`

## F333 — Yanıtlayan taraf ne yapacağını, süreyi ve süre dolunca ne olacağını göremiyor

| Alan                | Değer                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | High                                                                                                                                             |
| Durum               | Aday                                                                                                                                             |
| Konum               | `src/components/resolution/ClaimList.tsx:50`                                                                                                     |
| Diğer konumlar      | `src/components/resolution/ClaimDetail.tsx:122-124`, `src/components/resolution/ClaimMessages.tsx:106-108`, `messages/tr/resolution.json:49,101` |
| Kullanıcılar        | ev sahibi, misafir                                                                                                                               |
| Prensip             | learnability · predictability / gerçek dünya eşleşmesi                                                                                           |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                            |
| Efor                | M                                                                                                                                                |
| Kaynak denetçiler   | area:resolution                                                                                                                                  |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: resolution)                                                                                                        |

**Kanıt:** ClaimList.tsx:50-54 ve ClaimDetail.tsx:122-124, rol fark etmeksizin aynı metni gösteriyor: "Yanıt için son tarih: {date}" (json:49,101). RESPONDENT için "yanıt vermeniz gerekiyor" çağrısı, yanıt vermenin mesaj göndermek olduğu bilgisi ve süre dolunca talebin onun görüşü alınmadan yöneticiye gideceği (claims.ts:601-606) söylenmiyor. Tarih yalnız mutlak (`f.dateTime`, format.ts:68-75), saat dilimi ve kalan süre yok. Yanıt düğmesi genel "Mesajı gönder" (json:130).

**Etki:** Misafirin iade talebini yanıtlaması gereken ev sahibi (ya da hasar talebini yanıtlaması gereken misafir) 72 saatlik süreyi kaçırıyor. Talep onun açıklaması olmadan yöneticiye aktarılıyor ve aleyhine para kararı çıkabiliyor.

**Önerilen aksiyon:** `c.role === "RESPONDENT" && status === "AWAITING_RESPONSE"` durumunda liste kartında ve detayın en üstünde vurgulu bir çağrı gösterilmeli: "Yanıtınız bekleniyor: {kalan süre} içinde ({date}, saat dilimiyle) yanıt verin. Süre dolarsa talep yanıtınız olmadan yöneticiye aktarılır." Yanında `#claim-msg-{id}` alanına giden "Şimdi yanıtla" bağlantısı olmalı. Kalan süre Intl.RelativeTimeFormat ile hesaplanmalı, `timeZoneName: "short"` eklenmeli. Açan tarafa "Karşı tarafın {date} tarihine kadar yanıtı bekleniyor" yazılmalı. Respondent'ın ilk mesajında düğme metni "Yanıtımı gönder" olmalı.

**Yapılan düzeltme:** ClaimList and ClaimDetail: for a respondent with AWAITING_RESPONSE status, a call to action shows the deadline and what happens when it passes, with a "Şimdi yanıtla" link to #claim-msg-{id}. The opener sees "Karşı tarafın {date} tarihine kadar yanıtı bekleniyor". Links are 44px on mobile. Not done: relative remaining time with a time zone, and the respondent-specific button text in ClaimMessages, because I did not change ClaimMessages. — dosyalar: `src/components/resolution/ClaimList.tsx`, `src/components/resolution/ClaimDetail.tsx`

## F334 — İade üst sınırı hatasında izin verilen azami tutar hiç gösterilmiyor (tip uyuşmazlığı)

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | High                                                                                      |
| Durum               | Aday                                                                                      |
| Konum               | `src/components/resolution/shared.tsx:131`                                                |
| Diğer konumlar      | `src/lib/resolution/claims.ts:265-272,816-823`, `src/components/admin/ClaimAdmin.tsx:169` |
| Kullanıcılar        | misafir, admin                                                                            |
| Prensip             | robustness · recoverability / hata mesajları                                              |
| Sezgisel madde      | H9 — Hata mesajları                                                                       |
| WCAG                | 3.3.3                                                                                     |
| Renk/tema           | Hayır                                                                                     |
| Efor                | S                                                                                         |
| Kaynak denetçiler   | area:resolution                                                                           |
| **Düzeltme durumu** | **Düzeltildi** (paket: resolution)                                                        |

**Kanıt:** Sunucu (claims.ts:269-271) `{ refundableMinor: refundable.toString() }` ile STRING gönderiyor. İstemci shared.tsx:130-131'de `if (typeof max !== "number" || !currency) return err.message;` kontrolü yapıyor. Bu koşul her zaman doğru çıktığı için çevrilmiş "Tutar iade edilebilir üst sınırı aşıyor (en fazla {amount})" metni hiç görünmüyor. Yerine sunucunun Türkçe metni "Talep, iade edilebilir tutarı aşıyor" geliyor: tutar yok, EN arayüzde de Türkçe.

**Etki:** Misafir izin verilen azami tutarı öğrenemiyor ve tahminle tekrar tekrar deniyor. Yöneticinin karar formunda (ClaimAdmin.tsx:169) da aynı hata var. EN kullanıcı Türkçe metin görüyor.

**Önerilen aksiyon:** shared.tsx:130-131 şöyle değişmeli: `const raw = details?.refundableMinor; const max = typeof raw === "string" ? Number(raw) : raw; if (!Number.isSafeInteger(max) || !currency) return t("CLAIM_AMOUNT_EXCEEDS_REFUNDABLE_NOAMOUNT")`. Tutarsız durum için çevrilmiş ayrı bir anahtar eklenmeli, ya da sunucu `Number(refundable)` göndermeli. Hata tutar alanına `Field error` olarak da bağlanmalı.

**Yapılan düzeltme:** Duplicate of F138 (type mismatch). Fixed with the same parsing and fallback key, and the error is shown on the amount field. — dosyalar: `src/components/resolution/shared.tsx`, `src/components/resolution/OpenClaimForm.tsx`

## F335 — Ham teknik ve yanlış dilde hata metinleri ("Failed to fetch", Türkçe sunucu mesajları EN arayüzde)

| Alan                | Değer                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                          |
| Durum               | Aday                                                                                                                                                                                          |
| Konum               | `src/components/resolution/shared.tsx:136`                                                                                                                                                    |
| Diğer konumlar      | `src/components/ui/ui.tsx:255,266-268`, `src/lib/api-client.ts:40`, `src/lib/resolution/evidence.ts:63-111`, `src/app/api/claims/route.ts:22`, `src/app/api/claims/[id]/messages/route.ts:11` |
| Kullanıcılar        | tümü                                                                                                                                                                                          |
| Prensip             | robustness · hata mesajları / recoverability                                                                                                                                                  |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                           |
| WCAG                | 3.1.2                                                                                                                                                                                         |
| Renk/tema           | Hayır                                                                                                                                                                                         |
| Efor                | M                                                                                                                                                                                             |
| Kaynak denetçiler   | area:resolution                                                                                                                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: resolution)                                                                                                                                                            |

**Kanıt:** shared.tsx:136 `return errorMessage(err, tc("unexpectedError"))` ve ui.tsx:266-267 `error instanceof Error ? error.message : fallback`: her Error'un ham mesajı gösteriliyor. Ağ kesintisinde fetch'in TypeError'ı ("Failed to fetch" / Safari "Load failed") Türkçe kullanıcıya çıkıyor. Bilinmeyen kodlarda sunucu metni gösteriliyor: evidence.ts:63-111 "Desteklenmeyen dosya türü (JPEG/PNG/WebP/AVIF/GIF veya PDF)", "Görsel çok büyük", "PDF çok büyük"; body-limit "Dosya çok büyük"; route "Geçersiz talep" / "Geçersiz mesaj"; NotFoundError "Talep bulunamadı"; api-client.ts:40 `İstek başarısız (${res.status})`. Bu metinler EN sayfada `lang` işaretlemesi olmadan basılıyor. useLoader (ui.tsx:255) da aynı yolu kullanıyor.

**Etki:** EN misafir/ev sahibi kanıt yüklerken veya talep yüklenemediğinde Türkçe metin görüyor. Ekran okuyucu metni İngilizce sesle okuyor (WCAG 3.1.2). Mobilde zayıf ağdaki TR misafir anlamsız "Failed to fetch" görüyor ve ne yapacağını bilemiyor.

**Önerilen aksiyon:** useClaimErrorText genişletilmeli. `err instanceof TypeError` ise bağlantı hatası için çevrilmiş metin gösterilmeli: "Bağlantı kurulamadı; internetinizi kontrol edip tekrar deneyin". `ApiError.status === 413` ise "Dosya çok büyük (en fazla 8 MB)", `404` ise "Talep bulunamadı ya da erişiminiz yok" gösterilmeli. Sunucuda kanıt doğrulama hatalarına ayrı kodlar verilip (EVIDENCE_TYPE, EVIDENCE_TOO_LARGE, EVIDENCE_UNREADABLE) messages/*/resolution.json `errors` altına çevirileri eklenmeli. Ham `err.message` yalnızca son çare olarak ve `<span lang="tr">` ile sarılarak gösterilmeli.

**Yapılan düzeltme:** Same change as F139: TypeError and network errors go to common.errors.network through useErrorText, and 413 and 404 have separate localized messages. Not done: separate server codes (EVIDENCE_TYPE and similar) need a backend change. The client-side type and size checks cover most of these cases. — dosyalar: `src/components/resolution/shared.tsx`, `src/components/resolution/ClaimEvidence.tsx`

## F547 — /resolution/[id] bulunamadı durumu: başlık 'Talep ayrıntısı' kalıyor; sebep ve sonraki adım yok

| Alan                | Değer                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Severity            | Medium                                                                      |
| Durum               | Gözlemlendi                                                                 |
| Konum               | `src/components/resolution/ClaimDetail.tsx:38`                              |
| Diğer konumlar      | `src/app/resolution/[id]/page.tsx`                                          |
| Kullanıcılar        | misafir, ev sahibi                                                          |
| Prensip             | robustness · Hata mesajı – sebep + çözüm (Dix: robustness – recoverability) |
| Sezgisel madde      | H9 — Hata mesajları                                                         |
| Renk/tema           | Hayır                                                                       |
| Efor                | S                                                                           |
| Kaynak denetçiler   | runtime:resolution                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                |

**Kanıt:** Tarama 076/077 + RUNTIME p3-pages (guest TR, /resolution/missing): HTTP 200, H1 "Talep ayrıntısı", içerik yalnızca "Tüm taleplere dön" ve kırmızı role=alert "Talep bulunamadı". Konsolda 2 adet 404 hatası var (API isteği iki kez gidiyor). Ekran görüntüleri: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/crops/resolution/076-guest-tr-desktop-_resolution_missing-0.png ve 077-…-0.png (390px). Sunucu taraf olmayan kullanıcıya da kasıtlı olarak aynı 404'ü veriyor (claims.ts:332). Bu yüzden kullanıcı 'yanlış hesaptayım' ihtimalini düşünemiyor.

**Etki:** E-postadaki bağlantıyla gelen ya da başka hesapla oturum açmış kullanıcı neden talebi göremediğini anlamıyor. Başlık var olmayan bir içerik vaat ediyor.

**Önerilen aksiyon:** Hata durumunda ayrı bir boş durum gösterin. H1/başlık "Talep bulunamadı" olsun. Açıklama: "Bağlantı hatalı olabilir, talep başka bir hesaba ait olabilir veya kaldırılmış olabilir." Seçenekler: "Taleplerime dön", "Farklı hesapla giriş yap", "Destek". Oturumdaki e-postayı gösterin ("ayse@… olarak giriş yaptınız"). document.title'ı da güncelleyin.

## F548 — Talep açıldıktan sonra aynı rezervasyonda boş form yine etkin kalıyor; başarı bildirimi ve kanıt adımı formun altında

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Medium                                                 |
| Durum               | Gözlemlendi                                            |
| Konum               | `src/components/resolution/OpenClaimForm.tsx:95`       |
| Diğer konumlar      | `src/components/resolution/BookingResolutionPanel.tsx` |
| Kullanıcılar        | misafir, ev sahibi                                     |
| Prensip             | robustness · Hata önleme + durum görünürlüğü           |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                         |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | runtime:resolution                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                           |

**Kanıt:** RUNTIME p9-success (POST /api/claims ağda sahte 201, sunucuda kayıt oluşmadı; desktop TR /booking/cmv2uyf700o3c92w2ti427b8v): gönderimden sonra listede yeni "Misafir iade talebi · Yanıt bekleniyor" satırı görünüyor. Altında "İade talebi aç" formu boşaltılmış halde tamamen etkin kalıyor (form count=1, alanlar boş). "Talebiniz açıldı." ve "Talebi görüntüle ve kanıt ekle" bağlantısı formun en altında, odak body'de. Tekrar gönderim ancak sunucunun CLAIM_ALREADY_OPEN hatasıyla engelleniyor. Ekran görüntüsü: C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/resolution/shots/panel-after-success-mock.png

**Etki:** Misafir talebin gönderildiğinden emin olamayıp yeniden göndermeye çalışabiliyor. Asıl sonraki adım olan kanıt ekleme görünür değil.

**Önerilen aksiyon:** Rezervasyonda kullanıcının açtığı ACTIVE_STATUSES durumunda bir talep varsa formu gizleyip bir özet kartı gösterin: "Açık talebiniz var · Yanıt için son tarih … · [Kanıt ekle] [Talebi görüntüle]". Başarıdan sonra odağı bu karttaki 'Kanıt ekle' bağlantısına taşıyın.

## F598 — Kanıt yükleme: tek dosya, sınırlar (boyut/adet/tür) önceden söylenmiyor, HEIC kabul listesinde yok

| Alan                | Değer                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                                                 |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                               |
| Konum               | `src/components/resolution/ClaimEvidence.tsx:112`                                                                                                                                                      |
| Diğer konumlar      | `src/lib/config/app-config.ts:238-242`, `src/lib/resolution/evidence.ts:19,50`, `messages/tr/resolution.json:139`, `src/components/host/HostDashboard.tsx:636-650`, `src/lib/http/body-limit.ts:10,64` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                                     |
| Prensip             | flexibility · feedforward / esneklik-verim                                                                                                                                                             |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                                                                      |
| WCAG                | 3.3.2                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                  |
| Efor                | M                                                                                                                                                                                                      |
| Kaynak denetçiler   | area:resolution, lens:forms                                                                                                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                           |

**Kanıt:** ClaimEvidence.tsx:112-118 girdide `multiple` yok, her seferinde tek dosya seçilebiliyor. Sınırlar UI'da yok: app-config.ts:238-242 görsel 8 MB, PDF 5 MB, 40 MP, en fazla 10 dosya. Etiket yalnızca "Kanıt yükle (fotoğraf veya PDF)" (json:139). Kalan hak gösterilmiyor ve sınıra gelinince girdi yine görünüyor (CLAIM_EVIDENCE_LIMIT ancak yüklemeden sonra çıkıyor). :12 ACCEPT HEIC içermiyor, oysa sunucu heic/heif'i tanıyor (evidence.ts:19,50).

**Etki:** Mobilde 5 hasar fotoğrafı yükleyecek ev sahibi işlemi 5 kez tekrarlıyor. 12 MB'lık fotoğrafı seçen misafir, yükleme bitince Türkçe "Dosya çok büyük" hatası alıyor. Masaüstünde HEIC dosyaları seçicide gri görünüyor.

**Önerilen aksiyon:** `multiple` eklenmeli ve dosyalar sırayla yüklenip her biri için durum gösterilmeli ("2/5 yüklendi"). İpucu metni: "JPEG, PNG, WebP, HEIC veya PDF; fotoğraf en fazla 8 MB, PDF en fazla 5 MB. Kalan hakkınız: {10 − evidence.length}." Yüklemeden önce istemci tarafında boyut ve tür kontrolü yapılıp çevrilmiş hata verilmeli. ACCEPT'e `image/heic,image/heif` eklenmeli. Sınıra ulaşınca girdi gizlenip açıklama gösterilmeli.

## F599 — Tutar alanında üst sınır yok: misafire iade edilebilir tutar, ev sahibine depozito tutarı söylenmiyor

| Alan                | Değer                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                          |
| Durum               | Aday (2 kaynak birleşti)                                                                                                                                                                                                        |
| Konum               | `src/components/resolution/OpenClaimForm.tsx:68`                                                                                                                                                                                |
| Diğer konumlar      | `src/components/resolution/BookingResolutionPanel.tsx:82-87`, `src/components/resolution/ClaimDetail.tsx:150-153`, `src/components/resolution/shared.tsx:129-133`, `src/components/resolution/BookingResolutionPanel.tsx:24-33` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                                                                                              |
| Prensip             | learnability · predictability / feedforward                                                                                                                                                                                     |
| Sezgisel madde      | H13 — Feedforward                                                                                                                                                                                                               |
| WCAG                | 3.3.2                                                                                                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                                                                                                           |
| Efor                | M                                                                                                                                                                                                                               |
| Kaynak denetçiler   | area:resolution, lens:forms                                                                                                                                                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                    |

**Kanıt:** OpenClaimForm.tsx:68 `<Field label={t("amount", { currency })} ... hint={t("amountHint")}>`: ipucu yalnız biçim örneği veriyor ("örneğin 250,00"). Panelde depozito verisi var (BookingResolutionPanel.tsx:53-57 `deposit.deposit`, `expectedMinor`) ama forma geçirilmiyor (satır 82-87 yalnız bookingId/role/currency). Misafirin iade üst sınırı (refundableMinor) yalnız talep açıldıktan sonra ClaimDetail.tsx:150-153'te görünüyor. Depozitosuz rezervasyonda ev sahibine "onaylanan tutar tahsil edilemez" uyarısı yok, infoHost (json:86) genel bir cümle.

**Etki:** Misafir, ödediğinden fazlasını isteyip sunucu hatası alıyor. Ev sahibi depozitoyu (ya da depozito hiç yokken herhangi bir tutarı) aşan talep açıyor, aşan kısmın "tahsil edilemeyen" olarak kalacağını ancak karardan sonra öğreniyor.

**Önerilen aksiyon:** OpenClaimForm'a `maxMinor` ve `depositMinor` prop'ları eklenmeli. Deposit yanıtı misafir için `refundableMinor` da döndürmeli. İpucu şöyle olmalı: misafire "En fazla {f.money(max)} talep edebilirsiniz", ev sahibine "Depozito: {f.money(deposit)}; bu tutarı aşan kısım tahsil edilemez, yalnızca kayda geçer". Depozito yoksa formun üstünde uyarı paragrafı gösterilmeli. İstemci tarafında `amountMinor > maxMinor` için alan hatası verilmeli.

## F943 — Çözüm merkezinde talep açma yolu yok; boş durum sonraki adımı göstermiyor

| Alan                | Değer                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Severity            | Medium                                                                 |
| Durum               | Aday                                                                   |
| Konum               | `src/app/resolution/page.tsx:32`                                       |
| Diğer konumlar      | `messages/tr/resolution.json:8,46`, `messages/en/resolution.json:8,46` |
| Kullanıcılar        | misafir, ev sahibi                                                     |
| Prensip             | learnability · synthesizability / feedforward                          |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                             |
| Renk/tema           | Hayır                                                                  |
| Efor                | S                                                                      |
| Kaynak denetçiler   | area:resolution                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                           |

**Kanıt:** resolution/page.tsx:31-32 `<p>{t("list.empty")}</p>`, yani yalnızca "Henüz bir talebiniz yok." (json:46). Sayfada "Talep aç" düğmesi, rezervasyonlara bağlantı ya da "talep, rezervasyon sayfasından açılır" bilgisi yok. Talep formu yalnızca booking/[id] sayfasının en altında (booking/[id]/page.tsx:178-180). Giriş metni (json:8) yalnız "izleyin, yanıtlayın ve kanıt ekleyin" diyor.

**Etki:** Sorun yaşayıp Hesabım'dan "Çözüm merkezi"ne gelen misafir, talebin nereden açılacağını bulamıyor ve görevi terk ediyor ya da destek kanalına yöneliyor.

**Önerilen aksiyon:** Boş duruma ve giriş metnine şu eklenmeli: "Talep açmak için Rezervasyonlarım'dan ilgili rezervasyonu açın ve ‘İade talebi aç’ bölümünü kullanın." Yanına `/account` (ya da `/trips`) Link'i konmalı. İsteğe bağlı olarak uygun rezervasyonları listeleyen bir "Yeni talep aç" düğmesi eklenebilir.

## F944 — Talep listesinde filtre ve sıralama yok; işlem bekleyen talepler öne çıkmıyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/app/resolution/page.tsx:34`               |
| Diğer konumlar      | `src/components/resolution/ClaimList.tsx:29`   |
| Kullanıcılar        | ev sahibi, misafir                             |
| Prensip             | flexibility · customizability / esneklik-verim |
| Sezgisel madde      | H7 — Esneklik/verim                            |
| Renk/tema           | Hayır                                          |
| Efor                | M                                              |
| Kaynak denetçiler   | area:resolution                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** resolution/page.tsx:21 tüm talepleri tek istekte alıyor (sunucu en fazla 200, claims.ts:510-514, createdAt desc) ve :34 `<ClaimList claims={data.claims} />` filtre, sekme ya da sayaç olmadan gösteriyor. ClaimList.tsx:29 sırayı aynen koruyor. Yanıt bekleyen (RESPONDENT+AWAITING_RESPONSE) talepler yalnız küçük amber metinle ayrışıyor (satır 50-54).

**Etki:** Çok ilanı olan ev sahibi, SLA'sı yaklaşan yanıt bekleyen talebi onlarca sonuçlanmış talebin arasında arıyor ve süreyi kaçırma riski artıyor.

**Önerilen aksiyon:** İstemci tarafında üç sekmeli bir filtre (`role="tablist"`, ya da radio grubu) eklenmeli: "İşlem bekleyen (n)" / "Devam eden" / "Sonuçlanan". İşlem bekleyenler slaDueAt'e göre artan sırada en üstte olmalı. Kart başlığında toplam sayı gösterilmeli ("Taleplerim (12)").

## F945 — Yükleme hatasında "Tekrar dene" yok; yeniden yükleme hatası tüm ayrıntıyı siliyor, panelde tek hata her şeyi gizliyor

| Alan                | Değer                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                   |
| Durum               | Aday                                                                                                                                     |
| Konum               | `src/components/resolution/ClaimDetail.tsx:38`                                                                                           |
| Diğer konumlar      | `src/components/resolution/BookingResolutionPanel.tsx:24-34,44`, `src/app/resolution/page.tsx:21-24`, `src/components/ui/ui.tsx:241-263` |
| Kullanıcılar        | tümü                                                                                                                                     |
| Prensip             | robustness · recoverability                                                                                                              |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                    |
| Efor                | S                                                                                                                                        |
| Kaynak denetçiler   | area:resolution                                                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                             |

**Kanıt:** ClaimDetail.tsx:38 `if (error) return <Status error={error} />;`: useLoader (ui.tsx:248-256) reload sırasında hata alırsa veri dursa bile tüm detay (mesajlar, kanıtlar, az önce gösterilen başarı mesajı) kayboluyor. Hiçbir hata durumunda `reload` düğmesi yok (resolution/page.tsx:24, BookingResolutionPanel.tsx:44). BookingResolutionPanel.tsx:26-31 `Promise.all`: talep listesi isteği başarısız olursa depozito ve talep açma formu da gösterilmiyor.

**Etki:** Mobil ağda mesaj gönderen misafir, gönderim sonrası yenileme başarısız olursa tüm yazışmayı kaybediyor ve tek yolu sayfayı yenilemek. Liste ucu geçici olarak hata verince talep açma görevi tamamen engelleniyor.

**Önerilen aksiyon:** ClaimDetail'de koşul `if (error && !data)` yapılmalı. Veri varsa hata üstte satır içi uyarı olarak gösterilmeli. Status'un yanına `<Button variant="secondary" onClick={reload}>Tekrar dene</Button>` eklenmeli (sayfa, panel ve detay). Panelde `Promise.allSettled` kullanılıp depozito, liste ve form bağımsız gösterilmeli.

## F946 — Yönetici talep taraflarına mesaj yazamıyor ve ek kanıt isteyemiyor

| Alan                | Değer                                          |
| ------------------- | ---------------------------------------------- |
| Severity            | Medium                                         |
| Durum               | Aday                                           |
| Konum               | `src/components/resolution/ClaimDetail.tsx:48` |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:85`       |
| Kullanıcılar        | admin                                          |
| Prensip             | robustness · task conformance                  |
| Sezgisel madde      | H7 — Esneklik/verim                            |
| Renk/tema           | Hayır                                          |
| Efor                | L                                              |
| Kaynak denetçiler   | area:admin                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                   |

**Kanıt:** ClaimDetail.tsx:48 `const isParty = !readOnly && claim.role !== "ADMIN";` ve 50 `canReply = isParty && ...` yönetici görünümünde (ClaimAdmin.tsx:85 `readOnly`) yazışmayı salt okunur yapıyor. Yöneticinin taraflara ulaşabildiği tek kanal geri alınamaz karar notu (ClaimAdmin.tsx:219).

**Etki:** Kanıt eksik olduğunda yönetici açıklama ya da ek fotoğraf isteyemiyor ve eksik bilgiyle karar vermek zorunda kalıyor. Bu, hatalı iade veya ret riskini artırıyor.

**Önerilen aksiyon:** ESCALATED durumunda yöneticiye 'Taraflara mesaj' alanı açın (rol ADMIN, iki tarafa görünür). Hazır şablon olarak 'Ek kanıt iste' ekleyin; bu, kanıt yüklemeyi ve SLA'yı yeniden başlatsın. ClaimDetail'e `canAdminMessage` prop'u ekleyin.

## F947 — Yönetici, talep ayrıntısında taraflara mesaj yazamıyor (sunucu izin verdiği halde)

| Alan                | Değer                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| Severity            | Medium                                                                              |
| Durum               | Aday                                                                                |
| Konum               | `src/components/resolution/ClaimDetail.tsx:48`                                      |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:82-95`, `src/lib/resolution/claims.ts:344-375` |
| Kullanıcılar        | admin                                                                               |
| Prensip             | robustness · task conformance                                                       |
| Sezgisel madde      | H7 — Esneklik/verim                                                                 |
| Renk/tema           | Hayır                                                                               |
| Efor                | S                                                                                   |
| Kaynak denetçiler   | area:resolution                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                        |

**Kanıt:** ClaimDetail.tsx:48 `const isParty = !readOnly && claim.role !== "ADMIN"` ve :50 canReply buna bağlı. ClaimAdmin.tsx:85 `readOnly` geçiyor. Sunucu ise claims.ts:331 ve :352-357'de ADMIN rolünün mesaj yazmasına izin veriyor (`role ... : "ADMIN"`).

**Etki:** Karar öncesi taraflardan ek bilgi ya da kanıt istemesi gereken yönetici bunu arayüzden yapamıyor. Karar ya eksik bilgiyle veriliyor ya da kanal dışı iletişime gidiliyor.

**Önerilen aksiyon:** `readOnly` ayrı yeteneklere bölünmeli (`canWithdraw`, `canUpload`, `canReply`). Yönetici görünümünde aktif ve CHARGEBACK olmayan taleplerde canReply=true olmalı. Alan etiketi "Taraflara mesaj (yönetici)" olmalı ve yanında "Bu mesaj her iki tarafa da görünür" ipucu bulunmalı.

## F948 — Yanıt ve kanıt alanlarının neden gizli olduğu açıklanmıyor (sonuçlanmış talep, ters ibraz)

| Alan                | Değer                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                              |
| Durum               | Aday                                                                                                |
| Konum               | `src/components/resolution/ClaimDetail.tsx:50`                                                      |
| Diğer konumlar      | `src/components/resolution/ClaimMessages.tsx:93`, `src/components/resolution/ClaimEvidence.tsx:107` |
| Kullanıcılar        | misafir, ev sahibi                                                                                  |
| Prensip             | robustness · observability / feedforward                                                            |
| Sezgisel madde      | H13 — Feedforward                                                                                   |
| Renk/tema           | Hayır                                                                                               |
| Efor                | S                                                                                                   |
| Kaynak denetçiler   | area:resolution                                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                        |

**Kanıt:** ClaimDetail.tsx:50 `const canReply = isParty && active && claim.type !== "CHARGEBACK"` ve :78 `canUpload={isParty && active}`. ClaimMessages.tsx:93 `{canReply && (<form…)}` ve ClaimEvidence.tsx:107 `{canUpload && (…)}` false olduğunda hiçbir şey göstermiyor. Ters ibrazda yazışmanın ödeme sağlayıcısında yürüdüğü bilgisi yalnız koddaki yorumda (satır 49), kullanıcıya iletilmiyor.

**Etki:** Ters ibraz talebindeki misafir neden yanıt yazamadığını anlamıyor ve hata sanıyor. Sonuçlanmış talebe kanıt eklemek isteyen kullanıcı yükleme alanını bulamayınca arayüzde dolaşıyor.

**Önerilen aksiyon:** `!canReply` durumunda ClaimMessages'a bir `readOnlyReason` prop'u verilip şu metinler gösterilmeli: kapalı talepte "Talep sonuçlandığı için yeni mesaj gönderilemez.", CHARGEBACK'te "Ters ibrazda yazışma kart sağlayıcınız üzerinden yürür; buraya yalnızca kanıt ekleyebilirsiniz." ClaimEvidence'da kapalı talep için "Sonuçlanmış talebe kanıt eklenemez." yazılmalı.

## F949 — Eşzamansız işlemlerden sonra klavye odağı kayboluyor

| Alan                | Değer                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                 |
| Durum               | Aday                                                                                                                                                   |
| Konum               | `src/components/resolution/ClaimDetail.tsx:168`                                                                                                        |
| Diğer konumlar      | `src/components/resolution/ClaimEvidence.tsx:116`, `src/components/resolution/ClaimMessages.tsx:106`, `src/components/resolution/OpenClaimForm.tsx:91` |
| Kullanıcılar        | tümü                                                                                                                                                   |
| Prensip             | accessibility · WCAG 2.4.3 Focus Order                                                                                                                 |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                  |
| WCAG                | 2.4.3                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                  |
| Efor                | S                                                                                                                                                      |
| Kaynak denetçiler   | area:resolution                                                                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                           |

**Kanıt:** ClaimDetail.tsx:168-174: geri çekme başarılı olunca `onChanged()` -> reload -> `canWithdraw` false olduğu için odaktaki düğme DOM'dan kalkıyor. ClaimEvidence.tsx:116 `disabled={busy}` odaktaki dosya girdisini devre dışı bırakıyor. ClaimMessages.tsx:106 `disabled={busy || !body.trim()}` gönderim sırasında ve sonrasında odaktaki düğmeyi devre dışı bırakıyor (gövde temizlendiği için kapalı kalıyor). OpenClaimForm.tsx:91 `disabled={busy}` aynı durumda. Her durumda odak `body`'ye düşüyor.

**Etki:** Yalnız klavye ya da ekran okuyucu kullanan kullanıcı, mesaj gönderdikten, kanıt yükledikten ya da talebi geri çektikten sonra sayfanın en başına atılıyor ve yerini yeniden bulmak zorunda kalıyor.

**Önerilen aksiyon:** Meşgul durumda odaktaki denetimlerde `disabled` yerine `aria-disabled="true"` kullanılıp tıklama işleyicisinde `if (busy) return` ile korunmalı. Başarıdan sonra odak bilinçli yere taşınmalı: mesaj sonrası textarea'ya (`ref.focus()`), yükleme sonrası dosya girdisine, geri çekme sonrası `tabIndex={-1}` verilmiş durum/rozet başlığına.

## F950 — Karar sonucu etiketleri belirsiz ve kimin bakış açısından yazıldığı belli değil

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | Medium                                                                       |
| Durum               | Aday                                                                         |
| Konum               | `src/components/resolution/ClaimDetail.tsx:185`                              |
| Diğer konumlar      | `messages/tr/resolution.json:116-124`, `messages/en/resolution.json:116-124` |
| Kullanıcılar        | misafir, ev sahibi                                                           |
| Prensip             | learnability · gerçek dünya eşleşmesi                                        |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                  |
| Renk/tema           | Hayır                                                                        |
| Efor                | M                                                                            |
| Kaynak denetçiler   | area:resolution                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                 |

**Kanıt:** ClaimDetail.tsx:185-190 tüm rollerde aynı etiketleri kullanıyor: json:120-122 "Ödenen / tahsil edilen", "Tahsil edilemeyen", "Platformun karşıladığı". İade talebinde "settled" misafire iade edilen tutar, hasar talebinde misafirin kartından alınan tutar. Etiket ikisini "/" ile birleştiriyor. "Tahsil edilemeyen" misafire gösterildiğinde borç gibi okunuyor (sunucu claims.ts:913-914'e göre alacak kaydı YOK). "Platformun karşıladığı" taraflar için iç muhasebe bilgisi.

**Etki:** Karar sonrası misafir kendisine ne iade edileceğini ya da kartından ne alındığını net okuyamıyor. "Tahsil edilemeyen ₺X" satırını ödemesi gereken bir borç sanıyor.

**Önerilen aksiyon:** Tür ve role göre etiketler kullanılmalı: GUEST_REFUND'da misafire "Size iade edilen" + "Kartınıza 5–10 iş günü içinde yansır", ev sahibine "Kazancınızdan düşülen"; HOST_DAMAGE'da misafire "Kartınızdan tahsil edilen", ev sahibine "Size ödenecek". Misafire "uncollected" ya hiç gösterilmemeli ya da "Depozitoyu aşan kısım sizden tahsil edilmez" açıklamasıyla gösterilmeli. platformCovered yalnız yöneticiye gösterilmeli.

## F951 — Geri çekilen talep "Karar" kartında "Karar notu: withdrawn" olarak görünüyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Medium                                                |
| Durum               | Aday                                                  |
| Konum               | `src/components/resolution/ClaimDetail.tsx:193`       |
| Diğer konumlar      | `src/lib/resolution/claims.ts:386-389`                |
| Kullanıcılar        | misafir, ev sahibi                                    |
| Prensip             | learnability · gerçek dünya eşleşmesi / observability |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                           |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   | area:resolution                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                          |

**Kanıt:** Sunucu geri çekmede claims.ts:388 `data: { status: "CLOSED", decidedAt: now, decisionNote: "withdrawn" }` yazıyor. ClaimDetail.tsx:59 `{!active && <ClaimOutcome .../>}` ve :193 koşulu decidedAt dolu olduğu için kartı render ediyor. Sonuçta "Karar", "Karar tarihi: …" ve :211-214 "Karar notu" altında ham İngilizce "withdrawn" çıkıyor. Rozet de yalnız "Kapandı" diyor.

**Etki:** Talebini geri çeken misafir, yönetici karar vermiş gibi bir "Karar" kartı ve anlamsız İngilizce bir not görüyor. Karşı taraf da talebin neden kapandığını anlamıyor.

**Önerilen aksiyon:** Sunucu görünümüne `closeReason: "WITHDRAWN"` (ya da `withdrawnAt`) eklenmeli. ClaimOutcome'da bu durumda karar kartı yerine şu metin gösterilmeli: "Bu talep {date} tarihinde {kim tarafından} geri çekildi." ClaimStatusBadge'e "Geri çekildi" etiketi eklenmeli. Geçici çözüm olarak istemci `decisionNote === "withdrawn"` kontrolüyle aynı metni gösterebilir.

## F952 — Yönetici seçiminde aria-pressed yanlış semantik; seçim sonrası odak/kaydırma yok; seçim yalnız renkle belirtiliyor

| Alan                | Değer                                              |
| ------------------- | -------------------------------------------------- |
| Severity            | Medium                                             |
| Durum               | Aday                                               |
| Konum               | `src/components/resolution/ClaimList.tsx:60`       |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:72-84`        |
| Kullanıcılar        | admin                                              |
| Prensip             | accessibility · WCAG 4.1.2 / 1.4.1 / observability |
| Sezgisel madde      | H12 — Feedback                                     |
| WCAG                | 1.4.1                                              |
| Renk/tema           | Hayır                                              |
| Efor                | M                                                  |
| Kaynak denetçiler   | area:resolution                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                       |

**Kanıt:** ClaimList.tsx:57-63 `<button aria-pressed={selectedId === c.id} onClick={() => onSelect(c.id)}>`: basılı düğmeye tekrar basmak seçimi kaldırmıyor, yani toggle semantiği yanlış. Seçili kart yalnızca :33 `border-[#003580] bg-blue-50` ile, renk farkıyla belirtiliyor. Metin ya da ikon yok. ClaimAdmin.tsx:72-84 detayı listenin ALTINA render ediyor, odak ve kaydırma taşınmıyor. docs/img/v4-resolution.png her satırda aynı "Ayrıntıyı göster" metnini gösteriyor.

**Etki:** Yönetici uzun kuyrukta "Ayrıntıyı göster"e basınca ekranda değişiklik görmüyor (detay en altta). Ekran okuyucu "basılı düğme" diyor ve yanlış model kuruyor. Renk algısı zayıf yönetici hangi talebin seçili olduğunu ayırt edemiyor.

**Önerilen aksiyon:** `aria-pressed` kaldırılıp seçili öğeye `aria-current="true"` verilmeli ve görünür bir "Seçili" metin rozeti (ikonlu) eklenmeli. Renk paleti değişmiyor. Seçimden sonra `document.getElementById("claim-admin-selected")` öğesi `tabIndex={-1}` ile focus alıp `scrollIntoView` yapmalı. Masaüstünde iki sütunlu ana-detay yerleşimi (liste solda, detay sağda sticky) değerlendirilmeli. Düğme metnine görünmez bağlam eklenmeli: `<span className="sr-only">: {tür} – {mülk}</span>`.

## F953 — Ödeme sağlayıcısı durumları ham kod olarak gösteriliyor ("needs_response", "fraudulent")

| Alan                | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                    |
| Durum               | Aday                                                                                      |
| Konum               | `src/components/resolution/ClaimMessages.tsx:18`                                          |
| Diğer konumlar      | `src/components/resolution/ClaimDetail.tsx:161-164`, `src/lib/resolution/disputes.ts:247` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                 |
| Prensip             | learnability · gerçek dünya eşleşmesi                                                     |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                               |
| WCAG                | 3.1.2                                                                                     |
| Renk/tema           | Hayır                                                                                     |
| Efor                | S                                                                                         |
| Kaynak denetçiler   | area:resolution                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                              |

**Kanıt:** ClaimMessages.tsx:18-21 `const [, status] = m.body.split(":"); return t("psp", { status: status ?? m.body });`. disputes.ts:247 gövdeyi `PSP_DISPUTE_CREATED:${disputeStatus ?? ""}` olarak yazıyor. Sonuç: "Ödeme sağlayıcısı güncellemesi: needs_response". disputeStatus boşsa split "" döndürüyor, `??` devreye girmiyor ve metin "…güncellemesi: " ile bitiyor. Olay türü (açıldı/kapandı) atılıyor. ClaimDetail.tsx:161-164 da `externalStatus` ve `externalReason`'ı ham basıyor.

**Etki:** Ters ibraz yaşayan misafir ve ev sahibi İngilizce makine kodlarıyla karşılaşıyor ve sürecin ne durumda olduğunu anlamıyor.

**Önerilen aksiyon:** i18n'e `externalStatus.{needs_response, under_review, won, lost, warning_closed…}` ve `externalReason.{fraudulent, product_not_received, duplicate…}` eşlemeleri eklenmeli (bilinmeyende "Diğer"). PSP gövdesindeki olay türü de çevrilmeli (DISPUTE_CREATED → "Kart itirazı açıldı"). status boşsa iki noktadan sonraki kısım gösterilmemeli.

## F954 — Talep yazışması canlı güncellenmiyor; rezervasyon mesajlarıyla tutarsız

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Medium                                              |
| Durum               | Aday                                                |
| Konum               | `src/components/resolution/ClaimMessages.tsx:73`    |
| Diğer konumlar      | `src/components/booking/BookingMessages.tsx:59,132` |
| Kullanıcılar        | misafir, ev sahibi, admin                           |
| Prensip             | robustness · observability / consistency            |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                      |
| Renk/tema           | Hayır                                               |
| Efor                | M                                                   |
| Kaynak denetçiler   | area:resolution                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** ClaimMessages.tsx:73-91 mesajları yalnız sayfa yüklemesinde ve kullanıcının kendi gönderiminden sonra (onSent -> reload) gösteriyor. Yoklama (polling), SSE ya da "Yenile" düğmesi yok. Aynı uygulamada BookingMessages.tsx:59 `new EventSource(.../messages/stream)` ve :132 `<ol aria-live="polite">` ile canlı güncelleniyor.

**Etki:** Karşı tarafın yanıtı ya da SLA/ödeme sağlayıcısı sistem mesajı, sayfa elle yenilenene kadar görünmüyor. Kullanıcı karşı tarafın yanıt vermediğini sanıyor. Rezervasyon mesajlarına alışmış kullanıcının beklentisi (canlı akış) karşılanmıyor.

**Önerilen aksiyon:** Talep aktifken ve sekme görünürken (`document.visibilityState`) 30 sn'de bir `reload()` çağrılmalı ya da BookingMessages'taki SSE deseni uygulanmalı. Başlığın yanına "Yenile" düğmesi ve "Son güncelleme: {saat}" eklenmeli. Yeni mesaj geldiğinde `aria-live="polite"` alana "1 yeni mesaj" yazılmalı.

## F955 — Uzun URL ya da kelimeler 360px ekranda yatay taşma yapıyor (yalnızca whitespace-pre-wrap kullanılmış)

| Alan                | Değer                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                            |
| Durum               | Aday                                                                                              |
| Konum               | `src/components/resolution/ClaimMessages.tsx:88`                                                  |
| Diğer konumlar      | `src/components/resolution/ClaimDetail.tsx:167,214`, `src/components/resolution/ClaimList.tsx:41` |
| Kullanıcılar        | misafir, ev sahibi                                                                                |
| Prensip             | accessibility · WCAG 1.4.10 Reflow                                                                |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                             |
| WCAG                | 1.4.10                                                                                            |
| Renk/tema           | Hayır                                                                                             |
| Efor                | S                                                                                                 |
| Kaynak denetçiler   | area:resolution                                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                      |

**Kanıt:** ClaimMessages.tsx:88 `<p className="mt-1 whitespace-pre-wrap">{text(m)}</p>`, ClaimDetail.tsx:167 açıklama ve :214 karar notu aynı sınıfı kullanıyor. Hiçbirinde `break-words` (overflow-wrap) yok. pre-wrap yalnız boşlukta satır kırıyor. Kullanıcı girdisindeki uzun bir bağlantı (ör. bulut fotoğraf linki) ya da boşluksuz dizi kartı aşıyor. Mesaj balonları ayrıca ml-6/mr-6 ile daralıyor.

**Etki:** Mobilde (360px) misafir yazışmayı okumak için sayfayı yatay kaydırmak zorunda kalıyor ve kartlar taşıyor.

**Önerilen aksiyon:** Bu üç `<p>` öğesine `break-words` (gerekirse `[overflow-wrap:anywhere]`) eklenmeli. Liste öğelerine `min-w-0` verilmeli. ClaimList.tsx:41'deki rezervasyon kimliği de aynı sınıfla korunmalı.

## F956 — Form hataları alana bağlanmıyor; yerel doğrulama baloncukları tarayıcı dilinde çıkıyor

| Alan                | Değer                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                              |
| Durum               | Aday                                                                                                |
| Konum               | `src/components/resolution/OpenClaimForm.tsx:41`                                                    |
| Diğer konumlar      | `src/components/resolution/ClaimMessages.tsx:94-105`, `src/components/admin/ClaimAdmin.tsx:145-147` |
| Kullanıcılar        | misafir, ev sahibi                                                                                  |
| Prensip             | accessibility · WCAG 3.3.1 Error Identification / 1.3.1                                             |
| Sezgisel madde      | H9 — Hata mesajları                                                                                 |
| WCAG                | 3.3.1                                                                                               |
| Renk/tema           | Hayır                                                                                               |
| Efor                | M                                                                                                   |
| Kaynak denetçiler   | area:resolution                                                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                        |

**Kanıt:** OpenClaimForm.tsx:40-42 `setFeedback({ error: t("invalidAmount") })`: hata, gönder düğmesinin ALTINDAKİ genel Status'a (satır 94) yazılıyor. `Field` bileşeninin `error` prop'u (ui.tsx:51,67 aria-invalid + aria-describedby sağlıyor) kullanılmıyor ve odak hatalı alana taşınmıyor. Formda `noValidate` yok, bu yüzden `required` (73,87), `pattern` (75) ve `minLength={10}` (85) için tarayıcının kendi baloncukları çıkıyor: dil tarayıcıya ait ("Lütfen istenen biçimle eşleştirin"), kalıcı değil ve neyin yanlış olduğunu söylemiyor. Sunucudan dönen tutar hatası da alana bağlanmıyor.

**Etki:** Ekran okuyucu kullanıcısı hatayı duyuyor ama hangi alanın geçersiz olduğu (aria-invalid) bildirilmiyor. Odak düğmede kaldığı için geri dönüp alanı aramak zorunda. Mobil misafir kısa süre görünüp kaybolan baloncuğu kaçırıyor. Desen hatasında neyin yanlış olduğu yazmıyor.

**Önerilen aksiyon:** `<form noValidate>` yapılmalı. Alan bazlı `amountError` ve `descError` state'leri tutulup `<Field error={amountError}>` ile geçilmeli. Gönderimde ilk hatalı alana `ref.current.focus()` yapılmalı. Boş, desen ve minLength durumları için i18n metinleri eklenmeli (ör. "Açıklama en az 10 karakter olmalı (şu an {n})"). CLAIM_AMOUNT_EXCEEDS_REFUNDABLE hatası tutar alanına bağlanmalı.

## F957 — Depozito metinleri role göre ayrılmıyor ve kesinleşmiş durumlarla çelişiyor

| Alan                | Değer                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                               |
| Durum               | Aday                                                                                                                                                 |
| Konum               | `src/components/resolution/shared.tsx:224`                                                                                                           |
| Diğer konumlar      | `messages/tr/resolution.json:58,65`, `src/components/resolution/BookingResolutionPanel.tsx:53-57`, `src/components/resolution/ClaimDetail.tsx:61-65` |
| Kullanıcılar        | ev sahibi, misafir, admin                                                                                                                            |
| Prensip             | learnability · gerçek dünya eşleşmesi / consistency                                                                                                  |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                                |
| Efor                | S                                                                                                                                                    |
| Kaynak denetçiler   | area:resolution                                                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                         |

**Kanıt:** shared.tsx:224 `<p>{t("note")}</p>` her rol ve her durumda aynı: json:65 "Depozito kartınızdan çekilmez; yalnızca provizyon alınır…". json:58 "…kartınızda provizyon olarak bloke edilir" ev sahibine de gösteriliyor (BookingResolutionPanel.tsx:53-57, rol prop'u yok). Durum CAPTURED olsa bile "çekilmez" yazıyor. shared.tsx:208-213, VOIDED/EXPIRED/CAPTURED gibi kesinleşmiş durumlarda bile gelecek zamanlı "Serbest bırakılma" satırını, FAILED durumunda "Provizyon zamanı" satırını gösteriyor.

**Etki:** Ev sahibi "kartınızdan" ifadesini kendine yönelik sanıyor. Hasar tahsil edilmiş misafir aynı kartta hem "Tahsil edildi" hem "Depozito kartınızdan çekilmez" okuyor ve iki bilgi birbirini yalanlıyor. Para ile ilgili güven zedeleniyor.

**Önerilen aksiyon:** DepositSummary'ye `viewerRole` prop'u eklenmeli ve `note.guest` / `note.host` anahtarları ayrılmalı (ev sahibine: "Provizyon misafirin kartında tutulur…"). CAPTURED veya CAPTURED_PARTIAL'da not yerine "Onaylanan hasar için {captured} tahsil edildi" yazılmalı. VOIDED/EXPIRED'da voidAfter satırı "Serbest bırakıldı: {date}" olmalı. FAILED'da "Provizyon alınamadı; hasar tutarı tahsil edilemeyebilir" açıklaması eklenmeli.

## F1135 — Panel başlığının altında boş Status alanı yaklaşık 40px gereksiz boşluk bırakıyor

| Alan                | Değer                                                     |
| ------------------- | --------------------------------------------------------- |
| Severity            | Low                                                       |
| Durum               | Gözlemlendi                                               |
| Konum               | `src/components/resolution/BookingResolutionPanel.tsx:44` |
| Kullanıcılar        | misafir                                                   |
| Prensip             | learnability · Minimal tasarım / görsel hiyerarşi         |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                              |
| Renk/tema           | Hayır                                                     |
| Efor                | S                                                         |
| Kaynak denetçiler   | runtime:resolution                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                              |

**Kanıt:** RUNTIME p1-panel ve p8-mobile ekran görüntülerinde "Hasar depozitosu ve çözüm merkezi" H2'si ile ilk H3 "Hasar depozitosu" arasında belirgin bir boşluk var. Hata yokken de min-h-[1.25rem] Status div'i render ediliyor ve space-y-5 ile iki kez aralık ekleniyor. C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/probes/resolution/shots/panel-mobile-tr.png

**Etki:** Başlık ile içerik arasındaki ilişki zayıflıyor ve mobilde panel daha uzun görünüyor.

**Önerilen aksiyon:** Status'ı yalnızca error varken render edin (`{error && <Status error={error} />}`). Canlı bölge gerekiyorsa sr-only ve sıfır yükseklikli bir kapsayıcı kullanın.

## F1136 — 'Yanıt için son tarih' kimin yanıt vereceğini belirtmiyor (talebi açan ile yanıtlayan aynı metni görüyor)

| Alan                | Değer                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Severity            | Low                                                                        |
| Durum               | Gözlemlendi                                                                |
| Konum               | `src/components/resolution/ClaimList.tsx:50`                               |
| Diğer konumlar      | `src/components/resolution/ClaimDetail.tsx`, `messages/tr/resolution.json` |
| Kullanıcılar        | misafir, ev sahibi                                                         |
| Prensip             | learnability · Durum görünürlüğü / açık dil                                |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                             |
| Renk/tema           | Hayır                                                                      |
| Efor                | S                                                                          |
| Kaynak denetçiler   | runtime:resolution                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                               |

**Kanıt:** RUNTIME p4-mock (sahte liste/detay, desktop TR): role=OPENER olan talepte "Yanıt için son tarih: 13.10.2026 00:57" yazıyor, detay kartında da "Yanıt için son tarih". Aynı metin role=RESPONDENT için de kullanılıyor (ClaimList.tsx:50-53, ClaimDetail.tsx:122-123). C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime/crops/resolution/mock-detail-0.png

**Etki:** Talebi açan misafir kendisinin bir şey yapması gerektiğini sanabiliyor. Yanıtlayan taraf ise kendisine verilen sürenin aciliyetini kaçırabiliyor.

**Önerilen aksiyon:** Role göre metin kullanın: OPENER için "Ev sahibinin yanıt vermesi için son tarih: …", RESPONDENT için "Yanıt vermeniz gereken son tarih: … (yanıt vermezseniz talep yöneticiye aktarılır)". Kalan süreyi de gösterin ("2 gün kaldı").

## F1137 — Talep listesinde her satırda aynı 'Ayrıntıyı aç' bağlantısı var ve hedefi 19px yüksekliğinde

| Alan                | Değer                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Low                                                                                                                            |
| Durum               | Gözlemlendi                                                                                                                    |
| Konum               | `src/components/resolution/ClaimList.tsx:66`                                                                                   |
| Kullanıcılar        | misafir, ev sahibi                                                                                                             |
| Prensip             | accessibility · Bağlantı amacı / dokunma hedefi                                                                                |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                          |
| WCAG                | 2.4.4 Link Purpose (In Context) – AA (bağlam içinde geçiyor; yalnız bağlantı listesinde belirsiz), 2.5.8 Target Size (Minimum) |
| Renk/tema           | Hayır                                                                                                                          |
| Efor                | S                                                                                                                              |
| Kaynak denetçiler   | runtime:resolution                                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                   |

**Kanıt:** RUNTIME p4-mock (desktop TR, sahte 3 talep): row links = ['Ayrıntıyı aç -> /resolution/mock-1 19px', 'Ayrıntıyı aç -> /resolution/mock-2 19px', 'Ayrıntıyı aç -> /resolution/mock-3 19px']. Ekran okuyucunun bağlantı listesinde üçü birbirinden ayırt edilemiyor. Mobilde dokunma hedefi 19px yüksekliğinde (komşu hedef olmadığı için 2.5.8 boşluk istisnasıyla geçiyor).

**Etki:** Mobil ağırlıklı misafir küçük bağlantıyı kaçırabiliyor. Ekran okuyucu kullanıcısı bağlantı listesinden hangi talebe gideceğini seçemiyor.

**Önerilen aksiyon:** Bağlantıya talebin türünü ve mülkünü içeren görünmez bir ek ad verin (aria-describedby ile satır başlığı ya da sr-only "– Misafir iade talebi, İzmir Alsancak"). Ya da kartın tamamını min-h-11 tıklanabilir bir bağlantı yapın.

## F1345 — Talep ayrıntısında rezervasyona bağlantı ve talep numarası yok; h1 ve geri bağlantı genel

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Low                                                     |
| Durum               | Aday                                                    |
| Konum               | `src/app/resolution/[id]/page.tsx:15`                   |
| Diğer konumlar      | `src/components/resolution/ClaimDetail.tsx:125-133,139` |
| Kullanıcılar        | misafir, ev sahibi                                      |
| Prensip             | learnability · synthesizability / navigasyon            |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                 |
| WCAG                | 2.4.6                                                   |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:resolution                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** [id]/page.tsx:15 h1 her talepte "Talep ayrıntısı". :17-19 geri bağlantı yalnız /resolution'a gidiyor (kullanıcı rezervasyon sayfasından gelmiş olsa bile). ClaimDetail.tsx:125-133 rezervasyon satırı yalnız tarih metni, `/booking/{id}` bağlantısı yok. claim.id hiçbir yerde gösterilmiyor (destekle yazışırken referans verilemiyor). :139 propertyTitle düz `<span>`.

**Etki:** Misafir talepten rezervasyon detayına dönmek için menülerde arama yapıyor. Destekle iletişimde talebi tanımlayamıyor.

**Önerilen aksiyon:** Rezervasyon satırının değeri `<Link href={`/booking/${booking.id}`}>` yapılmalı. Özete "Talep no: {claim.id.slice(-8).toUpperCase()}" satırı eklenmeli. h1 "Talep ayrıntısı: {tür}" olmalı.

## F1346 — Panel başlığı misafirin "sorun bildir / iade iste" görevini gizliyor

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | Low                                                                       |
| Durum               | Aday                                                                      |
| Konum               | `src/components/resolution/BookingResolutionPanel.tsx:41`                 |
| Diğer konumlar      | `messages/tr/resolution.json:77`, `src/app/booking/[id]/page.tsx:174-180` |
| Kullanıcılar        | misafir                                                                   |
| Prensip             | learnability · familiarity / tanıma > hatırlama                           |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                   |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | area:resolution                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                              |

**Kanıt:** BookingResolutionPanel.tsx:41-43 başlık her rol için aynı: "Hasar depozitosu ve çözüm merkezi" (json:77). Misafir için asıl eylem olan "İade talebi aç" bu başlığın altında ve sayfanın en sonunda, mesajlardan sonra (booking/[id]/page.tsx:174-180). Sayfanın üst kısmında bu bölüme giden bir bağlantı yok.

**Etki:** Konaklamada sorun yaşayan misafir "hasar depozitosu" başlığını kendisiyle ilgisiz sanıp bölümü atlıyor ve iade talebi açma yolunu kaçırıyor.

**Önerilen aksiyon:** Başlık role göre değişmeli: misafire "Sorun mu yaşadınız? İade talebi ve depozito", ev sahibine "Hasar talebi ve depozito". Rezervasyon özetinin yanına `#resolution-panel-title` bağlantısı "Sorun bildir" eklenmeli.

## F1347 — Yükleniyor durumları içerikle birlikte eklenen live region'a yazılıyor; iskelet yok

| Alan                | Değer                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                    |
| Durum               | Aday                                                                                   |
| Konum               | `src/components/resolution/BookingResolutionPanel.tsx:46`                              |
| Diğer konumlar      | `src/components/resolution/ClaimDetail.tsx:39-44`, `src/app/resolution/page.tsx:25-29` |
| Kullanıcılar        | tümü                                                                                   |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages / algılanan hız                             |
| Sezgisel madde      | H15 — Performans                                                                       |
| WCAG                | 4.1.3                                                                                  |
| Renk/tema           | Hayır                                                                                  |
| Efor                | S                                                                                      |
| Kaynak denetçiler   | area:resolution                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                           |

**Kanıt:** BookingResolutionPanel.tsx:45-49 `{!data && !error && (<p aria-live="polite">…)}`: live region metinle aynı anda DOM'a giriyor, bu yüzden birçok ekran okuyucu duyurmuyor. Aynı desen ClaimDetail.tsx:39-44 ve resolution/page.tsx:25-29'da da var. Yükleme yalnız düz "Yükleniyor…" metni. Veri gelince kartlar birden belirip yerleşimi kaydırıyor.

**Etki:** Ekran okuyucu kullanıcısı içeriğin yüklendiğini ya da beklemesi gerektiğini duymuyor. Mobilde rezervasyon sayfasının altındaki panel geç gelince sayfa zıplıyor.

**Önerilen aksiyon:** Yükleme metni, her zaman DOM'da duran `role="status"` bir kapsayıcının içine yazılmalı (Status bileşenindeki gibi). Depozito ve liste için sabit yükseklikli iskelet blokları (`aria-hidden`) eklenmeli.

## F1348 — Yönetici bilgilendirmesi yönetim paneline bağlantı vermiyor

| Alan                | Değer                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Severity            | Low                                                                  |
| Durum               | Aday                                                                 |
| Konum               | `src/components/resolution/BookingResolutionPanel.tsx:80`            |
| Diğer konumlar      | `messages/tr/resolution.json:87`, `src/app/admin/claims/page.tsx:12` |
| Kullanıcılar        | admin                                                                |
| Prensip             | flexibility · esneklik-verim / dialog initiative                     |
| Sezgisel madde      | H7 — Esneklik/verim                                                  |
| Renk/tema           | Hayır                                                                |
| Efor                | S                                                                    |
| Kaynak denetçiler   | area:resolution                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                         |

**Kanıt:** BookingResolutionPanel.tsx:79-80 `<p>{t("open.adminInfo")}</p>` = "…talepleri yönetim panelinden inceleyebilirsiniz." (json:87). Bağlantı yok, oysa yönetim ekranı /admin/claims (src/app/admin/claims/page.tsx).

**Etki:** Rezervasyon sayfasındaki yönetici talep kuyruğuna gitmek için menüde ekstra gezinmek zorunda kalıyor.

**Önerilen aksiyon:** Metin `t.rich` ile kurulup "yönetim paneli" ifadesi `<Link href="/admin/claims">` yapılmalı.

## F1349 — Başlık hiyerarşisi bozuk: Yazışmalar/Kanıtlar h3 ama başlıksız kartta; liste öğelerinde başlık yok

| Alan                | Değer                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Low                                                                                                                                              |
| Durum               | Aday                                                                                                                                             |
| Konum               | `src/components/resolution/ClaimDetail.tsx:66`                                                                                                   |
| Diğer konumlar      | `src/components/resolution/ClaimMessages.tsx:69`, `src/components/resolution/ClaimEvidence.tsx:56`, `src/components/resolution/ClaimList.tsx:37` |
| Kullanıcılar        | tümü                                                                                                                                             |
| Prensip             | accessibility · WCAG 1.3.1 Info and Relationships / 2.4.6                                                                                        |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                            |
| WCAG                | 1.3.1                                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                                            |
| Efor                | S                                                                                                                                                |
| Kaynak denetçiler   | area:resolution                                                                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                     |

**Kanıt:** ClaimDetail.tsx:66-81 `<Card>` başlıksız (ui.tsx:106 h2 render etmiyor). İçeride ClaimMessages.tsx:69 ve ClaimEvidence.tsx:56 `<h3>` var. Sıra h1 → h2 (tür) → h3 Açıklama → h2 Hasar depozitosu → h3 Yazışmalar → h3 Kanıtlar olduğu için yazışma ve kanıtlar ana hatta depozitonun alt bölümü gibi görünüyor. ClaimList.tsx:37 tür adı `<span>`, bu yüzden talepler arasında başlıkla gezinilemiyor.

**Etki:** Ekran okuyucu kullanıcısı başlık listesiyle (H tuşu) gezinirken yazışmaları depozitonun altında sanıyor ve talepler arasında hızlıca atlayamıyor.

**Önerilen aksiyon:** ClaimDetail'de `<Card title={t("messages.title")} id="claim-messages">` ve `<Card title={t("evidence.title")} id="claim-evidence">` kullanılmalı. Alt bileşenlere `headingLevel` prop'u ya da `hideTitle` verilip iç h3 kaldırılmalı. ClaimList'te tür adı `<h3>` (panel ve liste bağlamında) yapılmalı.

## F1350 — Geri çekme onayı sonuçları anlatmıyor; işlem sürerken düğme metni değişmiyor

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/resolution/ClaimDetail.tsx:103` |
| Diğer konumlar      | `messages/tr/resolution.json:113`               |
| Kullanıcılar        | misafir, ev sahibi                              |
| Prensip             | robustness · recoverability / feedback          |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü               |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:resolution                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** ClaimDetail.tsx:103 `window.confirm(t("detail.withdrawConfirm"))`: metin (json:113) yalnız "geri alınamaz" diyor. HOST_DAMAGE geri çekilince depozitonun serbest bırakıldığı (claims.ts:392) ve yeniden talep süresinin dolmuş olabileceği söylenmiyor. Native confirm'ün başlığı tarayıcı dilinde ve stili uygulamadan kopuk. :170-172 düğme busy iken yalnız devre dışı kalıyor, "Geri çekiliyor…" metni yok.

**Etki:** Ev sahibi, hasar talebini geri çekerse depozito güvencesinin de kalkacağını bilmeden işlemi onaylıyor.

**Önerilen aksiyon:** Tür ve role göre onay metni yazılmalı. HOST_DAMAGE: "Geri çekerseniz misafirin depozito provizyonu serbest bırakılır ve bu hasar için yeniden tahsilat yapılamayabilir." busy iken düğme metni `t("detail.withdrawing")` = "Geri çekiliyor…" olmalı. İsteğe bağlı olarak window.confirm yerine "Talebi geri çek" / "Vazgeç" düğmeli, sayfa içi `role="alertdialog"` kullanılabilir.

## F1351 — Yönetici görünümünde gereksiz 'Rolünüz: Yönetici' satırı var; talebi açan ve yanıtlayan bilgisi yok

| Alan                | Değer                                           |
| ------------------- | ----------------------------------------------- |
| Severity            | Low                                             |
| Durum               | Aday                                            |
| Konum               | `src/components/resolution/ClaimDetail.tsx:120` |
| Kullanıcılar        | admin                                           |
| Prensip             | learnability · synthesizability                 |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                    |
| Renk/tema           | Hayır                                           |
| Efor                | S                                               |
| Kaynak denetçiler   | area:admin                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                    |

**Kanıt:** ClaimDetail.tsx:120 `[t("detail.yourRole"), t(`role.${claim.role}`)]` readOnly yönetici görünümünde de render ediliyor ve 'Rolünüz: Yönetici' bilgi taşımıyor. Talebi açanın ve yanıtlayanın kim olduğu (misafir ya da ev sahibi adı) gösterilmiyor.

**Etki:** Yönetici özet alanında işe yaramayan bir satır görüyor. Asıl karar bilgisi olan tarafların kim olduğu eksik.

**Önerilen aksiyon:** readOnly olduğunda bu satır yerine 'Talebi açan: {displayName} (Misafir)' ve 'Yanıtlayan: {displayName} (Ev sahibi)' satırlarını gösterin; API ayrıntı yanıtına parties alanı eklensin.

## F1352 — Fotoğraf/kanıt yüklemede ilerleme yüzdesi ve gönderim öncesi boyut/tür kontrolü yok

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                      |
| Durum               | Aday                                                                                     |
| Konum               | `src/components/resolution/ClaimEvidence.tsx:35`                                         |
| Diğer konumlar      | `src/components/host/HostDashboard.tsx:600`, `src/components/host/HostDashboard.tsx:652` |
| Kullanıcılar        | misafir, ev sahibi                                                                       |
| Prensip             | robustness · responsiveness                                                              |
| Sezgisel madde      | H15 — Performans                                                                         |
| Renk/tema           | Hayır                                                                                    |
| Efor                | M                                                                                        |
| Kaynak denetçiler   | lens:status                                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                             |

**Kanıt:** ClaimEvidence.tsx:35-52 `apiFetch(…/evidence, { method: "POST", body })` ilerlemesiz; 131 yalnız 'Yükleniyor' metni. HostDashboard.tsx:600-619 PhotoUpload ve 652 aynı. Boyut sınırı aşımı ancak sunucu hatasıyla öğreniliyor.

**Etki:** Mobil veride büyük fotoğraf yükleyen kullanıcı ne kadar süreceğini bilmiyor; sınır aşımını yükleme bittikten sonra öğreniyor.

**Önerilen aksiyon:** XMLHttpRequest `upload.onprogress` ile `<progress>` + yüzde metni (aria-valuenow); seçimde dosya boyutu/tür ön kontrolü ve sınırın ipucu olarak gösterilmesi.

## F1353 — PDF kanıt bağlantısı boş sekme açıp indiriyor; adlar ayırt edilemiyor, küçük dosyalar "0 KB" görünüyor

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Low                                                         |
| Durum               | Aday                                                        |
| Konum               | `src/components/resolution/ClaimEvidence.tsx:69`            |
| Diğer konumlar      | `src/app/api/claims/[id]/evidence/[evidenceId]/route.ts:24` |
| Kullanıcılar        | misafir, ev sahibi, admin                                   |
| Prensip             | learnability · predictability / feedforward                 |
| Sezgisel madde      | H13 — Feedforward                                           |
| WCAG                | 2.4.4                                                       |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | area:resolution                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                |

**Kanıt:** ClaimEvidence.tsx:69-77 `<a href=… target="_blank">{t("evidence.pdf", { size })}</a>`. Sunucu PDF'i `content-disposition: attachment` ile veriyor (evidence/[evidenceId]/route.ts:24), yani yeni sekme açılıp hemen indirme başlıyor. Metinde indirme ya da yeni sekme bilgisi yok. Tüm PDF'ler "PDF belgesi (N KB)" diye adlandırılıyor. :76 `byteSize / 1024` ve `maximumFractionDigits: 0` yüzünden 400 B'lık dosya "0 KB" görünüyor. Görsel bağlantıları da (80-84) yeni sekmede açılıyor ama bunu bildirmiyor.

**Etki:** Mobil misafir boş bir sekmeye düşüyor ve dosyanın nereye indiğini anlamıyor. Yönetici birden çok PDF'i adından ayırt edemiyor.

**Önerilen aksiyon:** PDF bağlantısından `target="_blank"` kaldırılıp `download` özniteliği eklenmeli. Metin: "PDF kanıtını indir ({i}. dosya, {size})". Boyut 1024 B altındaysa bayt, üstündeyse en az 1 KB gösterilmeli (`Intl.NumberFormat` `style:"unit"`). Görsel bağlantılarına `<span className="sr-only">(yeni sekmede açılır)</span>` eklenmeli.

## F1354 — Kanıt görseli alt metinleri ayırt edici değil ve hemen altındaki açıklamayı tekrarlıyor

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Aday                                             |
| Konum               | `src/components/resolution/ClaimEvidence.tsx:90` |
| Diğer konumlar      | `messages/tr/resolution.json:143-145`            |
| Kullanıcılar        | tümü                                             |
| Prensip             | accessibility · WCAG 1.1.1 Non-text Content      |
| Sezgisel madde      | H14 — Erişilebilirlik                            |
| WCAG                | 1.1.1                                            |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | area:resolution                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** ClaimEvidence.tsx:90-93 alt="Kanıt fotoğrafı: {role}, {date}" ve :101 `<p>{by}</p>`, by="{role} · {date}" (satır 62-65). Ekran okuyucu aynı bilgiyi iki kez okuyor. Aynı kişinin aynı dakikada yüklediği fotoğrafların alt metinleri birebir aynı.

**Etki:** Ekran okuyucu kullanıcısı galeride hangi fotoğrafta olduğunu ayırt edemiyor ve gereksiz tekrar dinliyor.

**Önerilen aksiyon:** alt metnine sıra numarası eklenmeli: "Kanıt fotoğrafı {i}/{n}, {party}, {date}". Alttaki açıklama `aria-hidden="true"` yapılmalı, ya da alt yalnız "Kanıt fotoğrafı {i}/{n}" olup açıklama `aria-describedby` ile bağlanmalı.

## F1355 — Seçili talep satırı ağırlıkla renkle belirtiliyor; aria-pressed toggle olmayan bir düğmede kullanılıyor

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Low                                                  |
| Durum               | Aday                                                 |
| Konum               | `src/components/resolution/ClaimList.tsx:60`         |
| Diğer konumlar      | `src/components/resolution/ClaimList.tsx:33`         |
| Kullanıcılar        | admin                                                |
| Prensip             | accessibility · WCAG 4.1.2 Name, Role, Value / 1.4.1 |
| Sezgisel madde      | H11 — Affordance                                     |
| WCAG                | 4.1.2                                                |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | area:admin                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                         |

**Kanıt:** ClaimList.tsx:33 `selectedId === c.id ? "border-[#003580] bg-blue-50" : ...`: seçim görsel olarak çerçeve ve zemin rengiyle gösteriliyor, düğme metni değişmiyor. 60 `aria-pressed={selectedId === c.id}` var ama tekrar basınca seçim kalkmıyor (onSelect aynı id'yi atıyor), yani bu bir toggle değil.

**Etki:** Ekran okuyucu 'basılı' diye duyuruyor ama düğme açılıp kapanmıyor. Renk algısı zayıf kullanıcı hangi talebin seçili olduğunu metinden anlayamıyor.

**Önerilen aksiyon:** Seçiliyken düğme metnini 'Seçili, ayrıntı aşağıda' yapın ve li'ye `aria-current="true"` verin. aria-pressed'i kaldırın ya da ikinci basışta seçimi kaldıran gerçek bir toggle'a dönüştürün. Renk değişikliği gerekmez.

## F1356 — Listede tekrar eden belirsiz bağlantı metni ve ham rezervasyon kimliği

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Aday                                         |
| Konum               | `src/components/resolution/ClaimList.tsx:67` |
| Diğer konumlar      | `messages/tr/resolution.json:52-53`          |
| Kullanıcılar        | misafir, ev sahibi                           |
| Prensip             | accessibility · WCAG 2.4.4 Link Purpose      |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                  |
| WCAG                | 2.4.4                                        |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | area:resolution                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** ClaimList.tsx:66-68 her öğede aynı metin var: "Ayrıntıyı aç" (json:53). Ekran okuyucunun bağlantı listesinde N tane özdeş "Ayrıntıyı aç" çıkıyor. :41 propertyTitle yoksa `t("list.bookingRef", { id: c.bookingId })`, yani "Rezervasyon cmx…" gibi ham bir kimlik gösteriliyor. Dokunma hedefi yalnız kısa bir metin bağlantısı, kartın kendisi tıklanmıyor.

**Etki:** Ekran okuyucu kullanıcısı bağlantı listesinden doğru talebi seçemiyor. Mobil misafir küçük metin bağlantısını hedeflemek zorunda kalıyor.

**Önerilen aksiyon:** Bağlantıya görünmez bağlam eklenmeli: `<span className="sr-only">: {t(`type.${c.type}`)} – {c.propertyTitle}</span>`. İsterseniz kartın tamamı "stretched link" deseniyle tıklanabilir yapılabilir. bookingRef'te kimlik yerine giriş tarihi gösterilmeli ("{checkIn} tarihli rezervasyon").

## F1357 — Mesaj ve açıklama alanlarında karakter sayacı yok; 4000 sınırı yapıştırılan metni sessizce kırpıyor

| Alan                | Değer                                               |
| ------------------- | --------------------------------------------------- |
| Severity            | Low                                                 |
| Durum               | Aday                                                |
| Konum               | `src/components/resolution/ClaimMessages.tsx:101`   |
| Diğer konumlar      | `src/components/resolution/OpenClaimForm.tsx:80-90` |
| Kullanıcılar        | misafir, ev sahibi                                  |
| Prensip             | robustness · feedback / observability               |
| Sezgisel madde      | H12 — Feedback                                      |
| Renk/tema           | Hayır                                               |
| Efor                | S                                                   |
| Kaynak denetçiler   | area:resolution                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                        |

**Kanıt:** ClaimMessages.tsx:101 `maxLength={4000}` ve OpenClaimForm.tsx:85-86 `minLength={10} maxLength={4000}`: sayaç yok. Tarayıcı fazlasını uyarı vermeden kesiyor. Mesaj düğmesi (ClaimMessages.tsx:106) boşken neden pasif olduğunu söylemiyor. Açıklamada boşluklar minLength'i geçiyor ama sunucu trim sonrası "Geçersiz talep" döndürüyor (claims.ts:86, route.ts:22).

**Etki:** Uzun hasar açıklamasını yapıştıran ev sahibi metnin sonunun kesildiğini fark etmiyor. Kısa açıklama yazan misafir genel bir "Geçersiz talep" hatası alıyor.

**Önerilen aksiyon:** Alan ipucuna sayaç eklenmeli: `{body.length}/4000`. 3600'ü geçince `aria-live="polite"` ile duyurulmalı. Açıklama için "En az 10 karakter (şu an {n})" gösterilmeli. İstemci tarafında `description.trim().length < 10` kontrolü alan hatası olarak verilmeli.
