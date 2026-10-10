# Uygulama kabuğu (Header, Footer, ortak bileşenler, çerez bandı) — HCI bulguları (tam ayrıntı)

> Kaynak: [HCI_REVIEW_booking-platform.md](../../../HCI_REVIEW_booking-platform.md) · 91 bulgu · Severity: High 19, Medium 43, Low 29

## F32 — 40 sayfanın 32'si genel <title>'ı taşıyor; rota değişimi ekran okuyucuya duyurulmuyor (checkout, ödeme, kimlik sayfaları dahil)

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Durum               | Doğrulandı (4 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Konum               | `src/app/layout.tsx:16`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Diğer konumlar      | `src/app/checkout/page.tsx:1`, `src/app/booking/[id]/page.tsx:1`, `src/app/login/page.tsx:1`, `src/app/register/page.tsx:1`, `src/app/forgot-password/page.tsx:1`, `src/app/reset-password/page.tsx:1`, `src/app/verify-email/page.tsx:1`, `src/app/checkout/cart/page.tsx:1`, `src/app/search/page.tsx:1`, `src/app/cart/page.tsx:1`, `src/app/account/page.tsx:1`, `src/components/ui/ui.tsx:157`, `src/app/checkout/page.tsx:150`, `src/app/search/page.tsx:281`, `src/components/ui/ui.tsx:171`, `src/app/offline/page.tsx:5`, `node_modules/next/dist/client/components/app-router-announcer.js:51` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Prensip             | accessibility · WCAG 2.4.2 Sayfa Başlığı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| WCAG                | 2.4.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Kaynak denetçiler   | area:checkout, area:auth, lens:a11y, lens:nav, area:shell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Düzeltildi** (paket: global)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Kanıt:** Kök layout.tsx:13-16 `title: t('meta.title')` tek başlık. 32 page.tsx `"use client"` (checkout, checkout/cart, booking/[id], login, register, forgot-password, reset-password, verify-email, account, host, admin, cart, search, trips, support, pay/share/[token] vb.) ve src/app altında kökten başka layout.tsx yok; metadata yalnız privacy, property/[id], ranking, report, report/appeal'da var. React içi `<title>` veya document.title kullanımı yok. Next rota duyurucusu (node_modules/next/dist/client/components/app-router-announcer.js:52-64) document.title doluysa yalnız ona bakar ve değişmezse duyurmaz.

**Etki:** Ekran okuyucu kullanıcısı Giriş→Kayıt, Arama→Ödeme gibi istemci geçişlerinde hiçbir duyuru duymaz, sayfanın değiştiğini fark etmez. Çok sekmeli kullanıcı ve tarayıcı geçmişi tüm sayfaları aynı adla gösterir; e-postadan açılan şifre sıfırlama ve ödeme sekmesi ayırt edilemez.

**Önerilen aksiyon:** Kök layout generateMetadata'da `title: { default: t('meta.title'), template: '%s · booking-platform' }` yapın. Her istemci sayfası segmentine (checkout, checkout/cart, booking/[id], login, register, forgot-password, reset-password, verify-email, search, cart, trips, account, host, admin, support, pay/share/[token]…) sunucu bileşeni `layout.tsx` ekleyip `export async function generateMetadata() { const t = await getTranslations('<ns>'); return { title: t('<page>.title') }; }` döndürün (mevcut h1 çeviri anahtarları yeniden kullanılabilir; API için node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md). Sonuç durumları (reset 'done', verify sonucu, ödeme bekleniyor) için React 19 bileşen içi `<title>` ile başlığı güncelleyin.

**Yapılan düzeltme:** Root layout generateMetadata title -> { default: t('meta.title'), template: '%s — booking-platform' }. New 'titles' namespace (messages/tr|en/titles.json, 34 keys) registered in src/i18n/messages.ts NAMESPACES. Added 34 server layout.tsx files (generateMetadata -> getTranslations('titles')) for every listed segment; no page.tsx touched. Not done: React 19 in-component <title> for result states (reset done, verify result, payment pending), because that lives in page files owned by others. — dosyalar: `src/app/layout.tsx`, `src/i18n/messages.ts`, `messages/tr/titles.json`, `messages/en/titles.json`, `src/app/account/layout.tsx`, `src/app/account/sessions/layout.tsx`, `src/app/account/privacy/layout.tsx`, `src/app/admin/layout.tsx`, `src/app/admin/claims/layout.tsx`, `src/app/admin/compliance/layout.tsx`, `src/app/admin/payouts/layout.tsx`, `src/app/admin/support/layout.tsx`, `src/app/booking/[id]/layout.tsx`, `src/app/cart/layout.tsx`, `src/app/checkout/layout.tsx`, `src/app/checkout/cart/layout.tsx`, `src/app/compare/layout.tsx`, `src/app/dev/mailbox/layout.tsx`, `src/app/forgot-password/layout.tsx`, `src/app/host/layout.tsx`, `src/app/host/messages/[bookingId]/layout.tsx`, `src/app/host/payouts/layout.tsx`, `src/app/host/revenue/layout.tsx`, `src/app/login/layout.tsx`, `src/app/offline/layout.tsx`, `src/app/pay/share/[token]/layout.tsx`, `src/app/plan/layout.tsx`, `src/app/register/layout.tsx`, `src/app/reset-password/layout.tsx`, `src/app/resolution/layout.tsx`, `src/app/resolution/[id]/layout.tsx`, `src/app/search/layout.tsx`, `src/app/support/layout.tsx`, `src/app/transfers/layout.tsx`, `src/app/transfers/claim/layout.tsx`, `src/app/trips/layout.tsx`, `src/app/trust/layout.tsx`, `src/app/verify-email/layout.tsx`

## F33 — Mobil üst çubuk 360/320px'te taşıyor; giriş/kayıt yalnız hamburger menüsünde

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                      |
| Durum               | Doğrulandı (3 kaynak birleşti)                                                                                                                                                                                                                                                                                                                            |
| Konum               | `src/components/layout/Header.tsx:99`                                                                                                                                                                                                                                                                                                                     |
| Diğer konumlar      | `src/components/layout/Header.tsx:126`, `src/components/layout/Header.tsx:132`, `src/components/layout/ThemeToggle.tsx:32`, `src/components/layout/LocaleSwitcher.tsx:15`, `src/components/layout/ThemeToggle.tsx:43`, `src/components/layout/LocaleSwitcher.tsx:29`, `src/components/layout/ThemeToggle.tsx`, `src/components/layout/LocaleSwitcher.tsx` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                      |
| Prensip             | accessibility · Reflow / familiarity                                                                                                                                                                                                                                                                                                                      |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                                                                                                                                                                                                                                                                                                   |
| WCAG                | 1.4.10                                                                                                                                                                                                                                                                                                                                                    |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                     |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                         |
| Kaynak denetçiler   | area:shell, runtime:account                                                                                                                                                                                                                                                                                                                               |
| **Düzeltme durumu** | **Düzeltildi** (paket: shell)                                                                                                                                                                                                                                                                                                                             |

**Kanıt:** Header.tsx:80 'flex h-16 ... justify-between px-4' (360px'te 328px kullanılabilir). Sol: 82-84 'text-2xl' logo 'booking.com' (kırılma noktası yok, ≈145px). Sağ grup 99-170 'gap-2': ThemeToggle select (ThemeToggle.tsx:32-50, en uzun seçenek 'Sistem teması' ≈120px), LocaleSwitcher select ('English' ≈78px), hamburger 'p-2'+24px=40px → ≈145+120+78+40+3×8 ≈ 400px > 328px; flex öğeleri min-content altına küçülmez → yatay kaydırma. Oturum açıkken avatar bağlantısı (104-113) ≈44px daha ekler. Aynı çubukta 126 ve 132 'hidden ... sm:block' ile 'Kayıt ol'/'Giriş yap' 640px altında gizli; yalnız #mobile-menu (200-211) içinde.

**Etki:** Mobil misafir her sayfada yatay kaydırma görür, hamburger düğmesi görünür alanın dışına itilebilir (menüye ve dolayısıyla girişe ulaşmak zorlaşır); 320px/400% yakınlaştırmada içerik iki eksende kaydırılmak zorunda.

**Önerilen aksiyon:** Header.tsx: ThemeToggle ve LocaleSwitcher'ı sağ gruptan 'hidden lg:flex' sarmalayıcıya alın ve #mobile-menu içinde (189 numaralı alt bölümün üstüne) tekrar render edin; logo bağlantısına 'shrink-0', sağ gruba 'min-w-0' verin. Boşalan yerde oturumsuzken 'sm:hidden' kompakt bir '/login' bağlantısı (metin 'Giriş yap', aynı mevcut stil sınıfları) gösterin. Renk sınıfı değişmez.

**Yapılan düzeltme:** Header.tsx: logo is now shrink-0 with text-xl at mobile and sm:text-2xl above. The left group got min-w-0, the right group got min-w-0 and shrink-0 with gap-1 sm:gap-2, and the hamburger is shrink-0 with p-2.5 (44px). ThemeToggle and LocaleSwitcher sit in a 'hidden sm:flex' wrapper in the bar, and a copy with visible labels and 44px height is rendered in #mobile-menu inside an 'sm:hidden' block. The 'Giriş yap' link now shows on mobile too (inline-flex min-h-[44px] px-3, same color classes). 'Kayıt ol' stays in the menu on mobile. No color changes. — dosyalar: `src/components/layout/Header.tsx`, `src/components/layout/ThemeToggle.tsx`, `src/components/layout/LocaleSwitcher.tsx`

## F34 — Sabit alt çerez bandı ve karşılaştırma çubuğu odaklanan öğeyi örtüyor; bant Tab sırasında en sonda

| Alan                | Değer                                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                    |
| Durum               | Doğrulandı (3 kaynak birleşti)                                                                                                                                                                                                                                                          |
| Konum               | `src/components/privacy/CookieConsent.tsx:47`                                                                                                                                                                                                                                           |
| Diğer konumlar      | `src/components/compare/CompareBar.tsx:31`, `src/styles/globals.css:65`, `src/app/layout.tsx:67`, `src/styles/globals.css:66`, `src/components/account/ReauthDialog.tsx:68`, `src/components/booking/StepUpDialog.tsx:50`, `src/app/checkout/page.tsx:230`, `src/app/cart/page.tsx:217` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                    |
| Prensip             | accessibility · WCAG 2.4.11 Odak Örtülmemeli (Minimum)                                                                                                                                                                                                                                  |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                                   |
| WCAG                | 2.4.11                                                                                                                                                                                                                                                                                  |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                   |
| Efor                | S                                                                                                                                                                                                                                                                                       |
| Kaynak denetçiler   | lens:a11y, lens:mobile, area:shell                                                                                                                                                                                                                                                      |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: shell)                                                                                                                                                                                                                                                    |

**Kanıt:** CookieConsent.tsx:44-48 `fixed inset-x-0 bottom-0 z-50`; layout.tsx:66-67'de `{children}`'tan sonra render ediliyor. Escape ile kapatma yok. CompareBar.tsx:28-31 `fixed inset-x-0 bottom-0 z-40`. globals.css:65-67'de yalnızca `scroll-padding-top: 5rem` tanımlı; alt kaydırma payı ya da body padding yok. CompareBar.tsx:34'teki sayaç (`t("bar", { count })`) canlı bölgede değil.

**Etki:** İlk ziyarette klavye kullanıcısı banda ulaşmak için tüm sayfayı Tab'lamak zorunda kalır. Bu sırada tarayıcı odaklanan kart bağlantılarını ve footer bağlantılarını görünüm alanının altına kaydırır ve bunlar bandın ya da çubuğun altında tamamen gizlenir. Karşılaştırma sayısındaki değişim duyurulmaz.

**Önerilen aksiyon:** CookieConsent ve CompareBar görünürken bir ResizeObserver ile yüksekliklerini ölçün; `document.documentElement.style.scrollPaddingBottom` ve `document.body.style.paddingBottom` değerlerini bu yükseklik olarak ayarlayın, kapanınca sıfırlayın. CookieConsent'i layout.tsx'te skip link'ten hemen sonra, children'dan önce render edin. CookieConsent'e Escape ile 'Yalnızca zorunlu' davranışı ekleyin. CompareBar sayaç span'ına `aria-live="polite"` ve `aria-atomic="true"` verin.

**Yapılan düzeltme:** CookieConsent.tsx: while the banner is visible, a ResizeObserver measures its height and sets documentElement.style.scrollPaddingBottom to height+16px and body.style.paddingBottom to height. Both are cleared when the banner closes. Pressing Escape inside the banner applies the 'Yalnızca zorunlu' choice. Not done here: moving the banner after the skip link in layout.tsx, and adding the CompareBar spacing and aria-live (other owners, see crossOwner). — dosyalar: `src/components/privacy/CookieConsent.tsx`

## F41 — Başlıktaki hesap bağlantısının erişilebilir adı görünür metni içermiyor

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | High                                     |
| Durum               | Doğrulandı (2 kaynak birleşti)           |
| Konum               | `src/components/layout/Header.tsx:107`   |
| Kullanıcılar        | tümü                                     |
| Prensip             | accessibility · WCAG 2.5.3 Label in Name |
| Sezgisel madde      | H14 — Erişilebilirlik                    |
| WCAG                | 2.5.3                                    |
| Renk/tema           | Hayır                                    |
| Efor                | S                                        |
| Kaynak denetçiler   | lens:a11y, lens:copy, area:shell         |
| **Düzeltme durumu** | **Düzeltildi** (paket: shell)            |

**Kanıt:** Header.tsx:104-113 görünür içerik baş harfler (:110, ör. 'AD') ve `sm`'den itibaren `{user.firstName}` (:112); `aria-label={t("account")}` (:107) erişilebilir adı 'Hesabım' yapıp görünür metni tamamen eziyor. Bağlantıda aria-current de yok.

**Etki:** Sesli komut kullanıcısı 'Ayşe'ye tıkla' ya da 'AD'ye tıkla' dediğinde bağlantı bulunmuyor; ekran okuyucuyla çalışan gören kullanıcı ekranda gördüğünden farklı ad duyuyor (2.5.3 Level A).

**Önerilen aksiyon:** Header.tsx:107'deki aria-label'ı kaldırın; :109 baş harf span'ine `aria-hidden="true"` verin; içerik `<span className="sr-only">{t("account")}: </span><span className="hidden sm:inline">{user.firstName}</span>` olsun ve mobilde ad gizliyken sr-only ad metni kalsın (ör. `<span className="sr-only sm:hidden">{user.firstName}</span>`). Bağlantıya `aria-current={pathname.startsWith("/account") ? "page" : undefined}` ekleyin.

**Yapılan düzeltme:** Header.tsx account link: removed the aria-label and set aria-hidden on the initials badge. Content is now '<span sr-only>{t("account")}: </span><span class="sr-only sm:not-sr-only">{firstName}</span>', so the first name is in the accessible name on mobile too. Added aria-current=page when the path starts with /account, and min-h-[44px] on mobile. — dosyalar: `src/components/layout/Header.tsx`

## F42 — Eylem sonrası odaktaki kontrol DOM'dan kalkıyor ya da disabled oluyor; odak <body>'ye düşüyor (Çerez bandı 'Özelleştir' ve ekranlar arası örüntü)

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                        |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                              |
| Konum               | `src/components/privacy/CookieConsent.tsx:93`                                                                                                                                                                                                                                                                                                                                                               |
| Diğer konumlar      | `src/components/privacy/CookieConsent.tsx:39`, `src/components/search/SmartFilter.tsx:139`, `src/app/cart/page.tsx:146`, `src/components/support/SupportChat.tsx:135`, `src/components/property/ReviewsSection.tsx:89`, `src/components/host/RevenueDashboard.tsx:148`, `src/components/admin/AdminDashboard.tsx:321`, `src/components/admin/SupportAdmin.tsx:51`, `src/components/admin/ClaimAdmin.tsx:78` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                                                        |
| Prensip             | accessibility · WCAG 2.4.3 Odak Sırası; recoverability                                                                                                                                                                                                                                                                                                                                                      |
| Sezgisel madde      | H7 — Esneklik/verim                                                                                                                                                                                                                                                                                                                                                                                         |
| WCAG                | 2.4.3                                                                                                                                                                                                                                                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                       |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                           |
| Kaynak denetçiler   | lens:a11y, area:shell                                                                                                                                                                                                                                                                                                                                                                                       |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: shell)                                                                                                                                                                                                                                                                                                                                                                        |

**Kanıt:** CookieConsent.tsx:93-110'da 'Özelleştir' düğmesi tıklanınca `customizing ? <Kaydet> : <Özelleştir>` ile DOM'dan kaldırılıyor. Düğmenin `aria-expanded={customizing}` değeri görünür olduğu sürece hep false; aria-controls yok. :39'daki `if (hasConsent) return null;` seçimden sonra bandı odakla birlikte kaldırıyor. Aynı örüntü: SmartFilter.tsx:137-139'da silinen çip düğmesi kayboluyor; cart/page.tsx:146,161'de `disabled={locked || busy}` alandan çıkınca başlayan PATCH sırasında yeni odaklanan alanı da disabled yapıyor; SupportChat.tsx:135'te gönderince düğme disabled oluyor; yönetici kuyruklarında karar verilen satır listeden düşüyor.

**Etki:** Klavye ve ekran okuyucu kullanıcıları her eylemden sonra konumunu kaybeder. Çerez tercihini özelleştiren kullanıcı analitik kutusuna yeniden yol bulmak zorunda kalır. Yönetici her karardan sonra kuyruğu baştan gezer. Sepette misafir sayısını değiştiren kullanıcının odaklandığı sonraki alan kilitlenir.

**Önerilen aksiyon:** CookieConsent: 'Özelleştir'e tıklanınca fieldset açıldıktan sonra `useEffect` içinde `analyticsRef.current?.focus()` çağırın; aria-expanded kalıbını kaldırın ya da düğmeyi DOM'da tutup `aria-controls="consent-categories"` verin. Bant kapanmadan önce odak bant içindeyse `document.getElementById("main")` öğesine `tabIndex=-1` verip odaklayın. Genel çözüm: ui.tsx'e `useRestoreFocus(targetRef)` yardımcısı ekleyin. Silinen öğeden sonra odağı sonraki kardeşe ya da `tabIndex={-1}` verilmiş liste başlığına taşıyın. İşlem sürerken `disabled` yerine Button'a `aria-disabled="true"` verip handler'da erken dönün (cart girdileri, SupportChat gönder).

**Yapılan düzeltme:** CookieConsent: after 'Özelleştir' is clicked, a useEffect moves focus to the analytics checkbox, and the leftover aria-expanded is removed. All choice buttons and Escape go through decide(): if focus is inside the banner, #main gets tabindex=-1 and is focused before the banner closes. ui.tsx Button got a 'busy' prop, which sets aria-disabled and aria-busy and ignores clicks and submits while focus stays on the button. Applying it to the screens (cart, SupportChat and others) is for their owners. — dosyalar: `src/components/privacy/CookieConsent.tsx`, `src/components/ui/ui.tsx`

## F43 — Ortak giriş alanı kenarlığı açık temada 3:1 bileşen kontrastını karşılamıyor

| Alan                | Değer                                                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                          |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                |
| Konum               | `src/components/ui/ui.tsx:21`                                                                                                                                                                                                                                                 |
| Diğer konumlar      | `src/app/login/page.tsx:95`, `src/app/register/page.tsx:73`, `src/components/booking/BookingWidget.tsx:170`, `src/components/search/DestinationAutocomplete.tsx:142`, `src/components/compliance/ComplianceDashboard.tsx:25`, `src/components/booking/BookingActions.tsx:235` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                          |
| Prensip             | accessibility · Non-text Contrast                                                                                                                                                                                                                                             |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                         |
| WCAG                | 1.4.11                                                                                                                                                                                                                                                                        |
| Renk/tema           | Evet — onaylandı, sonraki oturumda uygulanacak                                                                                                                                                                                                                                |
| Efor                | S                                                                                                                                                                                                                                                                             |
| Kaynak denetçiler   | area:shell, lens:a11y                                                                                                                                                                                                                                                         |
| **Düzeltme durumu** | **Onaylandı — sonraki oturumda uygulanacak (renk)**                                                                                                                                                                                                                           |

**Kanıt:** ui.tsx:21 'inputClass = ... border border-gray-400 bg-white' → açık temada değişken tanımsız olduğundan #9ca3af / #ffffff ≈2.5:1 (< 3:1). Alanın tek görsel sınırı bu kenarlık. Ortak sınıfı kullanmayan formlarda 'border-gray-300' (#d1d5db ≈1.5:1): login/page.tsx:95,110, register/page.tsx:73-120, BookingWidget.tsx:147,170,188, DestinationAutocomplete.tsx:142, ComplianceDashboard.tsx:25.

**Etki:** Az gören kullanıcı giriş, rezervasyon ve arama formlarında alan sınırlarını ayırt etmekte zorlanır; boş alanlar atlanabilir.

**Önerilen aksiyon:** Açık temada kenarlığı 'border-gray-500' yapın ve auth/booking/arama formlarında yerel sınıflar yerine ortak inputClass'ı kullanın. Kenarlık kalınlığı (border-2) kontrast oranını değiştirmediği için renk dışı eşdeğer bir çözüm yok. Renk değişikliği gerektirdiği için kullanıcının tema kısıtı nedeniyle onaya bırakılmalı.

## F44 — Giriş bağlantıları dönüş adresi taşımıyor; giriş sonrası kullanıcı ana sayfaya düşüyor; oturumsuz favori tıklaması sessizce başarısız

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Konum               | `src/components/ui/ui.tsx:219`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Diğer konumlar      | `src/components/layout/Header.tsx:131`, `src/components/layout/Header.tsx:207`, `src/components/transfers/TransferMarket.tsx:92`, `src/components/pwa/TripsView.tsx:91`, `src/app/booking/[id]/page.tsx:81`, `src/components/account/SessionManager.tsx:62`, `src/app/login/page.tsx:63`, `src/app/login/page.tsx:149`, `src/app/register/page.tsx:41`, `src/components/property/PropertyCard.tsx:84`, `src/components/account/SessionManager.tsx:78`, `src/app/account/privacy/page.tsx:12` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Prensip             | robustness · task migratability / recoverability / consistency                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Kaynak denetçiler   | area:host2, area:admin, area:compliance, area:resolution, area:misc, lens:consistency, area:account, area:account2, area:host                                                                                                                                                                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: shell)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Kanıt:** ui.tsx:219 RoleGate `<Link href="/login">` redirect parametresi içermiyor. RoleGate'i kullanan 15 sayfa var: account/privacy, account/sessions, admin/*, host, host/payouts, host/revenue, plan, resolution, resolution/[id], support, transfers/claim. Aynı durum Header.tsx:131,207, TransferMarket.tsx:92, TripsView.tsx:91, booking/[id]/page.tsx:81 ve SessionManager.tsx:62,78'de de var. Giriş sayfası parametreyi destekliyor (login/page.tsx:63 `get("redirect") ?? "/"`), ancak :63'te `startsWith("/")` doğrulaması yok; bu doğrulama yalnızca :142'de yapılıyor. register/page.tsx:41 her durumda `router.push("/")` çağırıyor. PropertyCard.tsx:79 `throw new Error("Favori eklenemedi")` fırlatıyor, ama :84 `err.message.includes("401")` hiçbir zaman doğru olmadığı için oturumsuz favori tıklaması hiçbir şey yapmıyor.

**Etki:** E-postadaki /resolution/{id} ya da /host/payouts bağlantısıyla gelen kullanıcı giriş yaptıktan sonra ana sayfaya düşer ve talebi yeniden aramak zorunda kalır. SLA'lı yanıt görevleri gecikir. Kayıt olan yeni kullanıcı başladığı akışa dönemez. Oturumsuz misafir kalbe bastığında hiçbir geri bildirim almaz.

**Önerilen aksiyon:** ui.tsx'e `export function loginHref(returnTo: string) { return `/login?redirect=${encodeURIComponent(returnTo)}`; }` ekleyin. RoleGate'te `const pathname = usePathname(); const search = useSearchParams();` ile `href={loginHref(pathname + (search.size ? `?${search}` : ""))}` kullanın. Aynı yardımcıyı Header'daki giriş/kayıt bağlantılarında, TransferMarket, TripsView, booking/[id], SessionManager ve login→register bağlantısında kullanın. login/page.tsx:63'e de :142'deki `startsWith("/") && !startsWith("//")` doğrulamasını ekleyin. register/page.tsx `redirect` parametresini aynı doğrulamayla okusun. PropertyCard'da `res.status === 401` ise `router.push(loginHref(pathname))` çağrılsın; diğer hatalarda `role="status"` ile kısa bir mesaj gösterilsin.

**Yapılan düzeltme:** ui.tsx: added 'export function loginHref(returnTo?, base="/login"|"/register")'. With no argument it uses location pathname+search+hash. It does not add a return address for '/', for '//' prefixes or for the login and register pages themselves. RoleGate now uses loginHref(). Header login and register links (bar and mobile menu) carry the redirect: pathname comes from usePathname and search+hash from useSyncExternalStore, so no Suspense is needed. Redirect validation in login/register, PropertyCard 401 handling and the other screens are other owners (crossOwner). — dosyalar: `src/components/ui/ui.tsx`, `src/components/layout/Header.tsx`

## F45 — Hata mesajları ham, tek dilli (sabit TR) ve teknik biçimde gösteriliyor; EN arayüzde Türkçe metin lang işaretsiz okunuyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Konum               | `src/components/ui/ui.tsx:266`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Diğer konumlar      | `src/lib/api-client.ts:40`, `src/lib/api-client.ts:65`, `src/lib/http/errors.ts:27`, `src/lib/http/errors.ts:155`, `src/lib/payment/card-token.ts:56`, `src/components/resolution/shared.tsx:122`, `src/components/transfers/ClaimForm.tsx:57`, `src/components/transfers/TransferMarket.tsx:132`, `src/components/support/SupportChat.tsx:66`, `src/components/plan/TripPlanner.tsx:80`, `src/components/dev/MailboxClient.tsx:31`, `src/components/booking/BookingActions.tsx:180`, `src/app/login/page.tsx:67`, `src/app/register/page.tsx:44`, `src/app/checkout/page.tsx:143`, `src/app/search/page.tsx:210`, `src/components/ui/ui.tsx:255`, `public/sw.js:123`, `src/lib/http/errors.ts:26`, `src/app/api/user/me/route.ts:27` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Prensip             | robustness · recoverability / observability; WCAG 3.1.2 Bölümlerin Dili, 3.3.3 Hata Önerisi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| WCAG                | 3.1.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Efor                | M                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Kaynak denetçiler   | area:misc, lens:consistency, lens:forms, area:shell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: shell)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Kanıt:** ui.tsx:266-267 `errorMessage(error, fallback = "Beklenmeyen bir hata oluştu")` her Error için `error.message` döndürüyor. api-client.ts:40 gövdesiz yanıtta `İstek başarısız (${res.status})`, :65 `fetch` ağ kesintisinde tarayıcının İngilizce TypeError metnini ('Failed to fetch') fırlatıyor. Sunucu metinleri sabit TR: lib/http/errors.ts:27 'Oturum açmanız gerekiyor', :155 'Doğrulama hatası', :160 'Kayıt bulunamadı'. İstemci kart doğrulaması card-token.ts:56-61 'Kart numarası geçersiz' / 'CVC geçersiz'. ui.tsx dışında 35 çağrı yerinden 32'si `errorMessage(e)` biçiminde, fallback vermeden çağırıyor. Kod-çeviri eşlemesi yalnızca resolution/shared.tsx:122-140 (useClaimErrorText), pay/share ve checkout/cart'ta var.

**Etki:** EN dilini seçen misafir ödeme, devir ve plan hatalarını Türkçe görür. Ekran okuyucu bu metni `<html lang="en">` altında İngilizce telaffuzla okur ve anlaşılmaz hale getirir. Bağlantısı kopan mobil kullanıcı 'Failed to fetch' ya da 'İstek başarısız (502)' görür ve ne yapması gerektiğini öğrenemez. Para işlemlerinde yanlış yeniden deneme ya da işlemi terk etme riski doğar.

**Önerilen aksiyon:** ui.tsx'e `useErrorText()` kancası ekleyin ve resolution/shared.tsx'teki useClaimErrorText kalıbını genelleştirin. (1) `err instanceof ApiError && err.code` olduğunda messages/<locale>/common.json içine eklenecek `errors.<CODE>` anahtarını kullansın (UNAUTHORIZED, FORBIDDEN, EMAIL_NOT_VERIFIED, VALIDATION_ERROR, NOT_FOUND, PAYMENT_DECLINED, QUOTE_EXPIRED…). (2) `err instanceof TypeError` ya da `err.name === "AbortError"` olduğunda `t("errors.network")` döndürsün ('Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.'). (3) Kodu olmayan ApiError'da ve status>=500 durumunda `t("unexpectedError")` döndürsün. useLoader içindeki errorMessage çağrısını bu kancaya bağlayın. 32 `errorMessage(e)` çağrısını kademeli olarak `errorText(e)` ile değiştirin. Bilinmeyen kodlu sunucu metni gösterilecekse `<span lang="tr">` içine sarın. card-token.ts'teki CardValidationError'a `code: 'number'|'cvc'|'expiry'` alanı ekleyip metni t() ile çevirin.

**Yapılan düzeltme:** ui.tsx: added 'export function useErrorText(): (error) => string'. For ApiError codes UNAUTHORIZED, EMAIL_NOT_VERIFIED, SERVICE_UNAVAILABLE, INTERNAL_ERROR, INVALID_JSON and TRANSACTION_CONFLICT it returns common.errors.<CODE>. A TypeError or AbortError returns common.errors.network. An ApiError with no code or status >= 500 returns common.unexpectedError. Field-specific server messages (VALIDATION_ERROR, CONFLICT and so on) are shown as they are. useLoader now uses this hook. Moving the 32 errorMessage calls to it, the lang wrapper and CardValidationError are for the screen owners. — dosyalar: `src/components/ui/ui.tsx`

## F57 — Başlık 320–414px'te taşıyor; mobil menü düğmesi ekran dışına itiliyor

| Alan                | Değer                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                |
| Durum               | Doğrulandı                                                                                                                                                                                          |
| Konum               | `src/components/layout/Header.tsx:80`                                                                                                                                                               |
| Diğer konumlar      | `src/components/layout/ThemeToggle.tsx:43`, `src/components/layout/LocaleSwitcher.tsx:29`, `src/components/layout/Header.tsx:85`, `src/components/layout/Header.tsx:138`, `playwright.config.ts:32` |
| Kullanıcılar        | tümü                                                                                                                                                                                                |
| Prensip             | accessibility · WCAG 1.4.10 Reflow                                                                                                                                                                  |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                               |
| WCAG                | 1.4.10                                                                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                                               |
| Efor                | M                                                                                                                                                                                                   |
| Kaynak denetçiler   | lens:mobile                                                                                                                                                                                         |
| **Düzeltme durumu** | **Düzeltildi** (paket: shell)                                                                                                                                                                       |

**Kanıt:** Header.tsx:80 `flex h-16 … justify-between px-4` tek satırda, sarma ya da shrink yok. :82 logo `text-2xl` 'booking.com' kırılamayan tek kelime (≈145px). Sağ grupta (:99) lg altında da görünen ThemeToggle select'i ('Sistem teması' seçeneği, ≈125px), LocaleSwitcher select'i ('English', ≈80px), oturum açıksa avatar (:104, ≈44px) ve hamburger (:138, 40px) var; aralarda gap-2 (3–4×8px). Oturumsuz toplam ≈32+145+125+80+40+24 ≈ 446px, oturumlu ≈ 498px. Select'ler ve logo min-content altına küçülemediğinden 320/360/375/390/414px'te taşma oluşuyor. Hamburger en sonda olduğu için ilk taşan öğe o. globals.css'te overflow-x kısıtı yok. Mobil menü (:173-216) tema ve dil seçicilerini içermiyor. playwright.config.ts yalnız `devices["Desktop Chrome"]` projesi içeriyor.

**Etki:** Telefonda her sayfada yatay kaydırma oluşuyor. Tek mobil gezinme yolu olan hamburger görünür alanın dışında kalıyor; misafir menünün olmadığını düşünüyor. 1.4.10 (AA) ihlali.

**Önerilen aksiyon:** ThemeToggle ve LocaleSwitcher'ı Header.tsx:100-101'de `<div className="hidden lg:flex items-center gap-2">` içine alın; mobil menüye (#mobile-menu, :189 bölümünün üstüne) görünür etiketli tam genişlik kopyalarını ekleyin. Logoya `shrink-0 text-xl sm:text-2xl`, hamburger'a `shrink-0`, sol gruba `min-w-0` verin. Masaüstü nav'ı (:85) 8 öğe için `xl:flex` yapıp hamburger'ı `xl:hidden` yapın ve bağlantılara `whitespace-nowrap` ekleyin. playwright.config.ts'e `devices["Pixel 5"]` projesi ve `document.documentElement.scrollWidth <= innerWidth` kontrolü ekleyin.

**Yapılan düzeltme:** Same change as F33. The desktop nav now appears at 'xl:flex', the hamburger and #mobile-menu use 'xl:hidden', and the nav links have whitespace-nowrap. The Playwright Pixel 5 project and scrollWidth check go in config/test files, which I don't own and did not add. — dosyalar: `src/components/layout/Header.tsx`

## F58 — Başlıktaki tema ve dil seçicilerinde klavye odağı açık temada görünmüyor

| Alan                | Değer                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Severity            | High                                                                       |
| Durum               | Doğrulandı                                                                 |
| Konum               | `src/components/layout/ThemeToggle.tsx:43`                                 |
| Diğer konumlar      | `src/components/layout/LocaleSwitcher.tsx:29`, `src/styles/globals.css:61` |
| Kullanıcılar        | tümü                                                                       |
| Prensip             | accessibility · Focus Visible                                              |
| Sezgisel madde      | H14 — Erişilebilirlik                                                      |
| WCAG                | 2.4.7                                                                      |
| Renk/tema           | Hayır                                                                      |
| Efor                | S                                                                          |
| Kaynak denetçiler   | area:shell                                                                 |
| **Düzeltme durumu** | **Düzeltildi** (paket: shell)                                              |

**Kanıt:** ThemeToggle.tsx:43 ve LocaleSwitcher.tsx:29 className 'min-h-[1.75rem] rounded border border-white/40 bg-transparent px-1 py-0.5' içinde 'ring' yok, bu yüzden globals.css:61-63 yedek kuralı uygulanıyor: 'outline: 2px solid rgb(var(--brand-ring, 0 53 128))'. --brand-ring yalnız koyu temada tanımlı (tailwind.config.ts:135), açık temada değer #003580 oluyor. Başlık zemini Header.tsx:79 'bg-[#003580]' olduğu için çerçeve zeminle aynı renk (1:1). Başlıktaki diğer öğeler sarı halkayı kullanıyor (Header.tsx:32-33).

**Etki:** Klavye kullanıcısı Tab ile tema veya dil seçicisine geldiğinde odağı göremez; ok tuşlarıyla bilmeden dili ya da temayı değiştirebilir.

**Önerilen aksiyon:** Header.tsx:32'deki 'focusRing' sabitini dışa aktarın (ör. 'headerFocusRing'); ThemeToggle ve LocaleSwitcher'a 'className' prop'u ekleyip Header'dan bu sınıfı geçirin, select'in className'ine ekleyin. Sınıf 'ring' içerdiği için yedek outline devre dışı kalır ve mevcut sarı halka kullanılır. Yeni renk eklenmez.

**Yapılan düzeltme:** Header.tsx: the focusRing constant is now exported as 'headerFocusRing' (existing #febb02 ring classes, no new color). ThemeToggle and LocaleSwitcher take a 'className' prop that is added to the select, and Header passes headerFocusRing in both the bar and the mobile menu. — dosyalar: `src/components/layout/Header.tsx`, `src/components/layout/ThemeToggle.tsx`, `src/components/layout/LocaleSwitcher.tsx`

## F59 — Alan düzeyi hata ilişkilendirmesi neredeyse hiç kullanılmıyor; misafir formları Field primitifini atlıyor

| Alan                | Değer                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                  |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                            |
| Konum               | `src/components/ui/ui.tsx:63`                                                                                                                                                                                                                                                                         |
| Diğer konumlar      | `src/app/register/page.tsx:122`, `src/app/login/page.tsx:84`, `src/components/booking/BookingWidget.tsx:142`, `src/components/resolution/OpenClaimForm.tsx:41`, `src/components/host/DepositSettings.tsx:118`, `src/components/admin/ClaimAdmin.tsx:146`, `src/components/host/HostDashboard.tsx:438` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                  |
| Prensip             | accessibility · WCAG 3.3.1 Hata Tanımlama / 1.3.1 Bilgi ve İlişkiler                                                                                                                                                                                                                                  |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                                                                                                                                                 |
| WCAG                | 3.3.1                                                                                                                                                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                 |
| Efor                | M                                                                                                                                                                                                                                                                                                     |
| Kaynak denetçiler   | lens:forms, lens:consistency                                                                                                                                                                                                                                                                          |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: shell)                                                                                                                                                                                                                                                                  |

**Kanıt:** ui.tsx:47-88'deki Field, `error` prop'u verildiğinde `aria-invalid` ve `aria-describedby` ekliyor. Ancak 68 `<Field` kullanımından yalnızca 3'ü `error=` veriyor (AgentMandates.tsx:117, AppealForm.tsx:68, AccessibilityPanel.tsx:288). `aria-invalid` başka yalnızca WalletCreditOption.tsx:94'te geçiyor. register/page.tsx:122-124'teki parola ipucu `<p className="mt-1 text-xs text-red-600">` alana bağlı değil. BookingWidget.tsx:142'deki `<label>` htmlFor içermiyor ve tarih düğmesiyle ilişkisi yok. OpenClaimForm, DepositSettings, ClaimAdmin ve HostDashboard istemci doğrulama hatalarını formun altındaki genel Status'a yazıyor.

**Etki:** Ekran okuyucu kullanıcısı hangi alanın hatalı olduğunu duyamaz. Kayıt formunda parola kuralı ancak görsel olarak, kırmızı metinle fark edilebilir. Görsel kullanıcı ise uzun host formlarında hata metnini alandan uzakta, formun sonunda arar.

**Önerilen aksiyon:** register/page.tsx'te parola alanını `<Field id="password" label={t("password")} hint={t("register.passwordHint")} error={showPwError ? t("register.passwordHint") : null}>` ile sarın. Kırmızı `<p>` öğesini kaldırın; Field'ın mevcut stilleri kullanılır. login/forgot/reset sayfalarındaki çıplak input'ları Field ve inputClass'a taşıyın. OpenClaimForm (amount), DepositSettings (DepositRow), ClaimAdmin (kısmi tutar) ve HostDashboard CalendarForm'da hatayı alan anahtarlı bir `Record<string,string>` state'inde tutup ilgili Field'a `error` olarak verin. BookingWidget.tsx:142'de label'a id verin ve düğmeye `aria-labelledby` ekleyin. Field hata `<p>`'sinin başına renk dışı bir ipucu olarak sr-only 'Hata:' öneki ekleyin.

**Yapılan düzeltme:** ui.tsx Field: the error <p> now starts with '<span className="sr-only">{t("errorPrefix")} </span>' (common.errorPrefix: 'Hata:'/'Error:'). Moving the register, login, forgot and reset forms and OpenClaimForm and the others onto Field is for those screens' owners. — dosyalar: `src/components/ui/ui.tsx`

## F60 — Giriş bağlantıları dönüş adresini (redirect) taşımıyor; derin bağlantılar ve #token girişten sonra kayboluyor, favori düğmesi oturumsuzken sessizce başarısız

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Konum               | `src/components/ui/ui.tsx:219`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:81`, `src/components/pwa/TripsView.tsx:91`, `src/components/transfers/TransferMarket.tsx:92`, `src/components/account/SessionManager.tsx:62`, `src/components/property/PropertyCard.tsx:84`, `src/components/layout/Header.tsx:131`, `src/components/layout/Header.tsx:207`, `src/app/transfers/claim/page.tsx:12`, `src/components/transfers/ClaimForm.tsx:25`, `src/components/booking/PriceInsight.tsx:77`, `src/components/property/ReviewsSection.tsx:45`, `src/app/login/page.tsx:63` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Prensip             | robustness · recoverability (akış sürekliliği)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Kaynak denetçiler   | lens:status, lens:copy, lens:nav                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: shell)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Kanıt:** ui.tsx:219 RoleGate `<Link href="/login" …>` parametresiz; aynısı booking/[id]/page.tsx:81, TripsView.tsx:91, TransferMarket.tsx:92, Header.tsx:131 ve :207, SessionManager.tsx:62/78 `router.push("/login")`, PropertyCard.tsx:85. login/page.tsx:63 `get("redirect") ?? "/"` olduğundan hepsi ana sayfaya döner. Buna karşın checkout/page.tsx:123, AddToCartButton.tsx:59, useCart.ts:24, pay/share/[token]/page.tsx:77 `?redirect=` ekliyor (tutarsız). transfers/claim/page.tsx RoleGate içinde ClaimForm; token ClaimForm.tsx:25-28'de `location.hash`'ten okunuyor, girişten sonra kayboluyor. PropertyCard.tsx:75 `throw new Error("Favori eklenemedi")` ve :84 `err.message.includes("401")` hiç doğru olmaz: oturumsuz kullanıcı kalbe basınca hiçbir şey olmaz. PriceInsight.tsx:77 ve ReviewsSection.tsx:45 401'de yalnız düz 'giriş yapın' metni veriyor, bağlantı yok. Ayrıca login/page.tsx:63 parola yolunda redirect doğrulanmıyor (passkey yolu :142'de doğruluyor).

**Etki:** E-postadaki RNPL hatırlatması ya da talep bağlantısıyla gelen oturumsuz misafir veya ev sahibi, giriş yaptıktan sonra ana sayfaya düşüyor ve sayfayı yeniden bulmak zorunda kalıyor. Devir alıcısı satıcıdan bağlantıyı yeniden istemek zorunda kalıyor. Favori düğmesi geri bildirim vermiyor.

**Önerilen aksiyon:** ui.tsx'e `export function loginHref(returnTo?: string)` ekleyin: `returnTo ?? location.pathname + location.search + location.hash` değerini `/login?redirect=${encodeURIComponent(...)}` olarak döndürsün. RoleGate (:219), booking/[id] (:81), TripsView (:91), TransferMarket (:92), SessionManager (:62, :78), PropertyCard (:85) ve Header'daki giriş/kayıt bağlantıları (:125, :131, :201, :207; usePathname + useSearchParams ile) bunu kullansın; register sayfası da redirect'i girişe aktarsın. login/page.tsx:63'te passkey yolundaki `startsWith("/") && !startsWith("//")` doğrulamasını parola yoluna da uygulayın; hash'i koruyun. PropertyCard'da `if (res.status === 401) router.push(loginHref())`, diğer hatalarda Status ile çevrili 'Favorilere eklenemedi, tekrar deneyin' gösterin. PriceInsight ve ReviewsSection'daki 401 metinlerini `t.rich` ile loginHref bağlantılı yapın.

**Yapılan düzeltme:** Same as F44 (loginHref plus RoleGate and Header). The rest is other owners: login/page.tsx:63 validation, the register redirect, PropertyCard, TripsView, TransferMarket, SessionManager, booking/[id], and PriceInsight and ReviewsSection. — dosyalar: `src/components/ui/ui.tsx`, `src/components/layout/Header.tsx`

## F69 — Çerez bandı Tab ile odaklanan öğeleri tamamen örtüyor (mobilde 24, masaüstünde 8 durak)

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | High                                                        |
| Durum               | Gözlemlendi (2 kaynak birleşti)                             |
| Konum               | `src/components/privacy/CookieConsent.tsx:47`               |
| Diğer konumlar      | `src/styles/globals.css`, `src/app/checkout/page.tsx`       |
| Kullanıcılar        | tümü                                                        |
| Prensip             | accessibility · Observability: odaktaki öğe görünür kalmalı |
| Sezgisel madde      | H14 — Erişilebilirlik                                       |
| WCAG                | 2.4.11 Focus Not Obscured (Minimum) (AA)                    |
| Renk/tema           | Hayır                                                       |
| Efor                | S                                                           |
| Kaynak denetçiler   | runtime:shell, runtime:checkout                             |
| **Düzeltme durumu** | **Düzeltildi** (paket: shell)                               |

**Kanıt:** P6 (probes/shell/p6-cookie.mjs): cookie_consent çerezi olmadan yeni bağlam, anasayfada Tab yürüyüşü. 390 px'te bant top=677 h=215; 24 odak durağı tamamen bandın altında kaldı (ör. #10 'İstanbul' top=700, #16 'Fırsatı Gör' 793, #21 'Bodrum Marina Boutique' 871). 1280x800'de bant top=685 h=115; 8 durak altında kaldı ('Favorilere ekle' 764, 'Yardım Merkezi' 738, footer alt satırındaki 5 bağlantı 728-732). html scroll-padding-bottom 'auto', body padding-bottom '0px'. Yalnız scroll-padding-top: 5rem tanımlı (globals.css:65-67). Ekran görüntüsü: RT/probes/shell/p6-banner-mobile-tr.png.

**Etki:** Yeni gelen her ziyaretçi bant kapanana kadar klavyeyle sayfada ilerlerken odağın nerede olduğunu göremiyor.

**Önerilen aksiyon:** Bant görünürken yüksekliğini ResizeObserver ile ölçün; document.documentElement.style.scrollPaddingBottom değerini yükseklik+16 px, document.body.style.paddingBottom değerini yükseklik olarak ayarlayın. Bant kapanınca ikisini de temizleyin.

**Yapılan düzeltme:** Same ResizeObserver change as F34, with scroll-padding-bottom of height+16 and body padding-bottom of height, both cleared on close. — dosyalar: `src/components/privacy/CookieConsent.tsx`

## F146 — Başlık kabuğu: 404 sayfasında hiçbir çıkış yolu yok, sayfa dili ile içerik dili uyuşmuyor, başlık rotaya göre tutarsız (bilinen genel bulguya ek ayrıntı)

| Alan                | Değer                            |
| ------------------- | -------------------------------- |
| Severity            | High                             |
| Durum               | Gözlemlendi                      |
| Konum               | `src/app/layout.tsx:45`          |
| Diğer konumlar      | `src/app/property/[id]/page.tsx` |
| Kullanıcılar        | tümü                             |
| Prensip             | robustness · Recoverability      |
| Sezgisel madde      | H9 — Hata mesajları              |
| WCAG                | 3.1.2 Language of Parts (AA)     |
| Renk/tema           | Hayır                            |
| Efor                | S                                |
| Kaynak denetçiler   | runtime:shell                    |
| **Düzeltme durumu** | **Düzeltildi** (paket: global)   |

**Kanıt:** P8 (probes/shell/p8-404-offline.mjs): /this-route-does-not-exist, /search/x ve /property/does-not-exist (anon/guest, TR/EN, 390 px) 404 döndürüyor. header, footer ve main yok. Tek etkileşimli öğe 'İçeriğe geç'; #main olmadığı için Enter sonrası odak yerinde kalıyor. Tab döngüsü: İçeriğe geç → nextjs-portal → body → İçeriğe geç. html lang='tr' ama ana metin '404 / This page could not be found.' (lang='en' işaretsiz). Sayfa başlığı: bilinmeyen rotada genel site başlığı ('404' ifadesi yok); notFound() kullanan /property/does-not-exist'te İngilizce '404: This page could not be found.'. Oturumlu guest de aynı sayfayı görüyor (hesap ya da çıkış yok). src/app/not-found.tsx dosyası yok. Ekran görüntüsü: RT/probes/shell/p8-404-mobile.png.

**Etki:** Kırık ya da eski bir bağlantıyla gelen kullanıcı, URL'yi elle düzeltmeden veya geri tuşuna basmadan siteye dönemiyor. Türkçe ekran okuyucu İngilizce metni Türkçe telaffuzla okuyor.

**Önerilen aksiyon:** src/app/not-found.tsx ekleyin: PageShell (Header + main#main + Footer), i18n 'Sayfa bulunamadı / Page not found' h1, kısa açıklama, 'Ana sayfaya dön' ve 'Konaklama ara' bağlantıları. generateMetadata ile 'Sayfa bulunamadı — booking-platform' başlığı verin.

**Yapılan düzeltme:** Covered by the new not-found.tsx: Header/Footer menu, localized h1 and description, Home and Search links, title 'Sayfa bulunamadı — booking-platform' through the root template. — dosyalar: `src/app/not-found.tsx`

## F147 — 1024–1100 px'te host ve admin başlığı yatay taşıyor; Hesabım ve Çıkış yap ekran dışında kalıyor, nav etiketleri 3 satıra kırılıyor

| Alan                | Değer                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                               |
| Durum               | Gözlemlendi                                                                                        |
| Konum               | `src/components/layout/Header.tsx:85`                                                              |
| Diğer konumlar      | `src/components/layout/Header.tsx:19`                                                              |
| Kullanıcılar        | ev sahibi, admin                                                                                   |
| Prensip             | accessibility · Flexibility / substitutivity: yakınlaştırma ve dar masaüstü penceresinde çalışmalı |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                              |
| WCAG                | 1.4.10 Reflow (AA), 1.4.4 Resize Text (AA)                                                         |
| Renk/tema           | Hayır                                                                                              |
| Efor                | M                                                                                                  |
| Kaynak denetçiler   | runtime:shell                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: shell)                                                                      |

**Kanıt:** P1, /account. 1024 px: host docScrollW=1081 ('Çıkış yap' 1025..1081 dışarıda), admin 1160 ('Hesabım' 1003..1097 ve 'Çıkış yap' 1105..1160 dışarıda). 1100 px'te admin hâlâ 1160. guest 1024'te sığıyor (1001) ama nav öğeleri kırılıyor: 'Ev sahibi paneli' 63x76, 'Posta kutusu (demo)' 70x76, yani 3 satır. 1280'de admin ancak sığıyor (sağ kenar 1248). Pratikte 1280 ekran %125 yakınlaştırmada 1024 CSS px, 1366 laptop %125'te 1093 px eder. Ekran görüntüsü: RT/probes/shell/p1-tr-admin-1024.png.

**Etki:** Masaüstü ağırlıklı admin ve ev sahipleri, yaygın Windows ölçekleme ayarlarında hesap ve çıkış kontrollerini görmek için yatay kaydırmak zorunda kalıyor. Nav 3 satırlık etiketlerle taranması zor hale geliyor.

**Önerilen aksiyon:** Masaüstü nav'ı 'xl:flex' (1280) eşiğine çekin ve 1024–1279 aralığında hamburger'ı koruyun ('xl:hidden'). Ya da nav öğelerine 'whitespace-nowrap' verip sığmayanları 'Daha fazla' menüsüne toplayın. 'Posta kutusu (demo)'yu nav'dan çıkarın. Tema/Dil seçicilerini hesap menüsüne taşıyın.

**Yapılan düzeltme:** Header.tsx: the desktop nav moved from lg:flex to xl:flex, so the hamburger stays from 1024 to 1279px. Nav links got whitespace-nowrap. 'Posta kutusu (demo)' stays in the nav because whether to remove it is a product decision. — dosyalar: `src/components/layout/Header.tsx`

## F148 — 390 px'te oturumlu kullanıcının hamburger düğmesi tamamen ekran dışında ve beyaz zemin üstünde beyaz, yani görünmüyor. Mobil menü ve çıkış yapma yolu fiilen erişilemez

| Alan                | Değer                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                               |
| Durum               | Gözlemlendi                                                                                        |
| Konum               | `src/components/layout/Header.tsx:99`                                                              |
| Diğer konumlar      | `src/components/layout/ThemeToggle.tsx`, `src/components/layout/LocaleSwitcher.tsx`                |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                          |
| Prensip             | accessibility · Robustness / observability: kontrol görünür olmalı, içerik 320 px'e yeniden akmalı |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                              |
| WCAG                | 1.4.10 Reflow (AA)                                                                                 |
| Renk/tema           | Hayır                                                                                              |
| Efor                | M                                                                                                  |
| Kaynak denetçiler   | runtime:shell                                                                                      |
| **Düzeltme durumu** | **Düzeltildi** (paket: shell)                                                                      |

**Kanıt:** P1 (probes/shell/p1-header-measure.mjs), 390x844 ölçümü. anon: logo 16..158, Tema select 158..274 (116 px, 'Sistem teması'), Dil 282..356, hamburger 372..412 (40 px'in 22 px'i kesik, ikon yarım görünüyor). guest/host/admin: avatar 364..408, hamburger 416..456 tamamen dışarıda, docScrollW=456. 320 px'te anon 412 (92 px taşma, Dil select de dışarıda), guest 456 (136 px taşma). Piksel kontrolü: full/shots/061-guest-tr-mobile-_account.png ve 095-host...png içinde hamburger alanı (x412-456, y45-95) min kanal 255, yani saf beyaz. Header genişliği 390 px'te bitiyor; düğme text-white ve gövde zemini beyaz. P10: x=389'a dokununca aria-expanded false kalıyor (düğmeye isabet etmiyor). P2: klavye odağı visual viewport'u kaydırıyor; düğme mavi bandın dışında, beyaz zeminde. Çıkış yap <640 px'te yalnız bu menüde (Header.tsx:117 'hidden sm:block'). Ekran görüntüleri: RT/probes/shell/p1-tr-guest-390.png, RT/probes/shell/p3-061-guest-tr-mobile-_account-hdr.png, RT/probes/shell/p2-guest-390-open.png (RT=C:/Users/tuna9/AppData/Local/Temp/claude/C--Users-tuna9-projects-booking/62fc84fa-09c9-431e-a0a0-680b0434666c/scratchpad/runtime).

**Etki:** Çoğunlukla mobilden gelen oturumlu misafir Sepetim'e, Destek'e ve çıkış yapmaya ulaşamıyor. Host/admin de Ev sahibi paneli ve Yönetim bağlantılarına mobil menüden erişemiyor. Yatay kaydırsa bile ikon görünmüyor. Anon kullanıcının Kayıt ve Giriş için tek yolu yarısı kesik bir ikon.

**Önerilen aksiyon:** 640 px altında Tema ve Dil select'lerini başlık çubuğundan çıkarıp mobil menünün içine (ya da footer'a) taşıyın: ThemeToggle/LocaleSwitcher sarmalayıcısına 'hidden sm:flex' verin, aynı bileşenleri #mobile-menu içinde de render edin. Hamburger'a 'shrink-0', sağ gruba 'min-w-0' verin. Logoyu mobilde 'text-xl' yapın. Kabul ölçütü: 320 ve 390 px'te document.documentElement.scrollWidth <= innerWidth ve hamburger boundingBox.right <= viewport. Bunu Playwright regresyon testi olarak ekleyin.

**Yapılan düzeltme:** Same as F33/F57. Below 640px the theme and language selectors are inside the mobile menu, the hamburger is shrink-0 at 44px and the logo is text-xl, so the hamburger stays on screen at 320-390px. I didn't add the Playwright regression test (tests/e2e and the config are not mine). — dosyalar: `src/components/layout/Header.tsx`

## F149 — Avatar bağlantısının erişilebilir adı 'Hesabım', görünür etiket 'AD Ayşe' (label-in-name ihlali)

| Alan                | Değer                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Severity            | High                                                                       |
| Durum               | Gözlemlendi                                                                |
| Konum               | `src/components/layout/Header.tsx:107`                                     |
| Kullanıcılar        | misafir, ev sahibi, admin                                                  |
| Prensip             | accessibility · Consistency: görünür etiket ile programatik ad aynı olmalı |
| Sezgisel madde      | H14 — Erişilebilirlik                                                      |
| WCAG                | 2.5.3 Label in Name (A)                                                    |
| Renk/tema           | Hayır                                                                      |
| Efor                | S                                                                          |
| Kaynak denetçiler   | runtime:shell                                                              |
| **Düzeltme durumu** | **Düzeltildi** (paket: shell)                                              |

**Kanıt:** P9 (probes/shell/p9-misc.mjs), guest, 1280x800, '/': aria-label='Hesabım', innerText 'AD Ayşe'. page.getByRole('link',{name:'Ayşe'}) 0 eşleşme döndürdü. 640 px altında görünür metin yalnız 'AD' (ad 'hidden sm:inline').

**Etki:** Sesle kontrol kullanan biri 'Ayşe'ye tıkla' dediğinde komut çalışmıyor. Ekran okuyucu ile görsel kullanıcı farklı etiketler algılıyor.

**Önerilen aksiyon:** aria-label'ı kaldırın. Baş harf rozetine aria-hidden='true' verin ve bağlantı içine '<span className="sr-only">{t("account")}: </span>{user.firstName}' yazın. Mobilde ad görünmüyorsa aria-label={`${user.firstName} – ${t('account')}`} kullanın.

**Yapılan düzeltme:** Same as F41: the accessible name is now 'Hesabım: Ayşe', which contains the visible 'Ayşe'. — dosyalar: `src/components/layout/Header.tsx`

## F150 — Başlıktaki Tema ve Dil select'lerinde klavye odak göstergesi tamamen görünmez (açık tema)

| Alan                | Değer                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Severity            | High                                                                 |
| Durum               | Gözlemlendi                                                          |
| Konum               | `src/components/layout/ThemeToggle.tsx:43`                           |
| Diğer konumlar      | `src/components/layout/LocaleSwitcher.tsx`, `src/styles/globals.css` |
| Kullanıcılar        | tümü                                                                 |
| Prensip             | accessibility · Observability: odak konumu görünür olmalı            |
| Sezgisel madde      | H14 — Erişilebilirlik                                                |
| WCAG                | 2.4.7 Focus Visible (AA)                                             |
| Renk/tema           | Hayır                                                                |
| Efor                | S                                                                    |
| Kaynak denetçiler   | runtime:shell                                                        |
| **Düzeltme durumu** | **Düzeltildi** (paket: shell)                                        |

**Kanıt:** P13 (probes/shell/p13-select-focus.mjs), anon, 1280x800, açık tema. Tab ile Tema select'ine gelindiğinde :focus-visible=true ve outline 'rgb(0,53,128) solid 2px', header zemini de rgb(0,53,128). Odaklı ve odaksız ekran görüntüsü arasında değişen piksel: Tema 0/17424, Dil 0/11880 (maxDelta 1). Ekran görüntüsü: RT/probes/shell/p13-light-select0-focused.png. Tarama verisindeki tabOrder 'visibleRing:true' sonucu yanlış pozitif. Kök neden: select'lerde 'ring' sınıfı yok, bu yüzden globals.css:61-63'teki genel outline kuralı uygulanıyor. Açık temada --brand-ring tanımsız olduğundan fallback 0 53 128 (başlık zemininin aynısı) kullanılıyor. Koyu temada fark var (1375-1879 piksel).

**Etki:** Klavye kullanıcısı Tab ile başlıkta ilerlerken odak iki durakta kayboluyor ve Tema/Dil seçimini nerede yaptığını göremiyor.

**Önerilen aksiyon:** Header.tsx'teki focusRing sabitini export edin (sarı #febb02 halka, #003580 offset) ve iki select'in className'ine ekleyin. Mevcut paleti kullanır, yeni renk gerekmez. Alternatif olarak globals.css'e 'header :focus-visible { outline-color: #febb02 }' ekleyin.

**Yapılan düzeltme:** Same as F58. The existing yellow ring classes are applied to the selects. globals.css was not changed. — dosyalar: `src/components/layout/ThemeToggle.tsx`, `src/components/layout/LocaleSwitcher.tsx`, `src/components/layout/Header.tsx`

## F151 — Formlar gönderimden sonra odağı <body>'ye düşürüyor (talep aç, mesaj gönder, kanıt yükle)

| Alan                | Değer                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | High                                                                                                                                                                               |
| Durum               | Gözlemlendi                                                                                                                                                                        |
| Konum               | `src/components/ui/ui.tsx:38`                                                                                                                                                      |
| Diğer konumlar      | `src/components/resolution/OpenClaimForm.tsx`, `src/components/resolution/ClaimMessages.tsx`, `src/components/resolution/ClaimEvidence.tsx`, `src/components/admin/ClaimAdmin.tsx` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                          |
| Prensip             | accessibility · Klavye/ekran okuyucu sürekliliği (Dix: robustness – observability)                                                                                                 |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                                                                                                              |
| WCAG                | 2.4.3 Focus Order (A)                                                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                                              |
| Efor                | S                                                                                                                                                                                  |
| Kaynak denetçiler   | runtime:resolution                                                                                                                                                                 |
| **Düzeltme durumu** | **Kısmen düzeltildi** (paket: shell)                                                                                                                                               |

**Kanıt:** RUNTIME p1-panel: OpenClaimForm sunucu yanıtından sonra `document.activeElement` = body ("[100 + 12 spaces desc] focus=body" ve "[1.250] focus=body"). RUNTIME p11-msg: "Mesajı gönder" Enter ile gönderildi, sonrasında focus=body. RUNTIME p5-upload: dosya seçilince input disabled oluyor ("disabled during busy: true focus: body"), yükleme bitince de odak body'de kalıyor. Sebep, odaktaki kontrolün busy sırasında `disabled` yapılması: OpenClaimForm.tsx:91, ClaimMessages.tsx:106 (gönderim sonrası !body.trim() olduğu için kalıcı), ClaimEvidence.tsx:116, ClaimAdmin.tsx:234.

**Etki:** Klavye ve ekran okuyucu kullanıcıları gönderimden sonra konumlarını kaybediyor. Sonraki Tab sayfanın başından (skip link) başlıyor. Başarı ya da hata mesajı ile "Talebi görüntüle ve kanıt ekle" bağlantısı bulunamıyor.

**Önerilen aksiyon:** Busy sırasında `disabled` yerine `aria-disabled="true"` kullanın ve çift gönderimi onSubmit içindeki busy guard ile engelleyin. İşlem bitince odağı programatik olarak taşıyın: başarıda "Talebi görüntüle ve kanıt ekle" bağlantısına ya da tabIndex=-1 verilmiş Status kapsayıcısına, hatada ilgili alana. Kanıt yüklemede input'u devre dışı bırakmak yerine yükleme sürerken change olayını yok sayın.

**Yapılan düzeltme:** ui.tsx Button got a 'busy?: boolean' prop: aria-disabled and aria-busy are set, the onClick handler calls preventDefault and returns early (so forms are not submitted twice), styling uses aria-disabled:opacity-60/cursor-not-allowed, and the button stays focusable. Button now accepts ref (ComponentPropsWithRef). Using busy instead of disabled on each form and moving focus after success or error is for the screen owners. — dosyalar: `src/components/ui/ui.tsx`

## F374 — Footer'daki 14 bağlantı ana sayfaya gidiyor; 'Kullanım Koşulları' işlevsiz bir düğme

| Alan                | Değer                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                          |
| Durum               | Doğrulandı (4 kaynak birleşti)                                                                  |
| Konum               | `src/components/layout/Footer.tsx:34`                                                           |
| Diğer konumlar      | `src/components/layout/Footer.tsx:69`, `messages/tr/footer.json:3`, `messages/en/footer.json:3` |
| Kullanıcılar        | misafir, ev sahibi                                                                              |
| Prensip             | learnability · real-world match / affordance (bağlantı ve düğme semantiği)                      |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                     |
| WCAG                | 2.4.4                                                                                           |
| Renk/tema           | Hayır                                                                                           |
| Efor                | S                                                                                               |
| Kaynak denetçiler   | lens:consistency, lens:a11y, lens:mobile, lens:copy, lens:nav, area:shell                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                    |

**Kanıt:** Footer.tsx:31-40'ta tüm sütun bağlantıları `<Link href="/">` (İade politikası, Para iadesi, Erişilebilirlik, Otel sahibi misiniz?…). :69-71 `<button className="text-xs text-gray-500 … hover:underline">{t("terms")}</button>`: onClick yok, type yok, görünümü bağlantı gibi. footer.json:3'teki `ranking` anahtarı Footer'da kullanılmıyor. Adayın 'focus stili yok' iddiası geçersiz: globals.css:61-64'teki `:where(a, button…):focus-visible:not([class*="ring"])` kuralı bu öğelere outline veriyor.

**Etki:** İade politikasını ya da erişilebilirlik bilgisini arayan misafir her tıklamada ana sayfaya döner ve sitenin bozuk olduğunu düşünür. Ekran okuyucu 'Kullanım Koşulları, düğme' der, basınca hiçbir şey olmaz.

**Önerilen aksiyon:** footerColumns'u `{ key, href }` nesnelerine çevirin ve var olan hedeflere bağlayın: helpCenter → /support, refundPolicy ve refunds → /trust, accessibility → /trust, hosts → /host, allStays → /search. Ekleyin: ranking → /ranking. Hedefi olmayan öğeleri (covid, packages, partners, careers, corporate) listeden çıkarın. 'Kullanım Koşulları' düğmesini kaldırın ya da gerçek bir sayfa varsa `<Link>` yapın.

## F376 — Ortak Status bileşeni: alert iç içe polite bölgede, hata/başarı yalnız renkle ayrışıyor; bilgi mesajlarında role=alert aşırı kullanımı

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                       |
| Durum               | Doğrulandı (3 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                               |
| Konum               | `src/components/ui/ui.tsx:146`                                                                                                                                                                                                                                                                                                                                               |
| Diğer konumlar      | `src/app/search/page.tsx:461`, `src/components/search/ResultsMap.tsx:147`, `src/components/booking/BookingMessages.tsx:140`, `src/components/host/HostDashboard.tsx:664`, `src/components/booking/WalletCreditOption.tsx:102`, `src/components/booking/CouponField.tsx:80`, `src/components/account/PasskeyManager.tsx:112`, `src/components/account/SessionManager.tsx:100` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                                                         |
| Prensip             | accessibility · WCAG 4.1.3 Status Messages / 1.4.1 Use of Color                                                                                                                                                                                                                                                                                                              |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                                                                          |
| WCAG                | 4.1.3                                                                                                                                                                                                                                                                                                                                                                        |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                        |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                            |
| Kaynak denetçiler   | lens:a11y, lens:status, area:misc, area:shell                                                                                                                                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                 |

**Kanıt:** ui.tsx:146-152 `<div aria-live="polite">` içinde `<p role="alert" className="text-red-700">`; başarı `<p className="text-green-800">`; ikon ya da önek yok. Status 52 yerde kullanılıyor. Aynı desen: search/page.tsx:459-462 polite içinde alert; ResultsMap.tsx:147 harita yedeği role=alert; BookingMessages.tsx:138-140 geçmiş mesajların her risk bandı role=alert (liste yüklenince art arda okunur); HostDashboard.tsx:664 düğme içeren uyarı alert; WalletCreditOption.tsx:102 yazarken her geçersizleşmede alert. CouponField.tsx:80 `APPLIED ? text-green-800 : text-red-700`.

**Etki:** Ekran okuyucuda aynı hata bazı okuyucularda iki kez, kritik olmayan bilgiler kesintiyle okunuyor; mesaj geçmişi açılınca birden çok uyarı art arda duyuruluyor. Renk ayrımı zayıf kullanıcı nötr cümleli sunucu mesajında hata/başarı ayrımını yapamıyor.

**Önerilen aksiyon:** Status'u iki kardeş, her zaman DOM'da duran bölgeye ayırın: `<div role="alert">{error && <p>…</p>}</div>` ve `<div role="status">{!error && message && <p>…</p>}</div>`; dış aria-live'ı kaldırın. Metnin başına `aria-hidden` ikon (hata için '⚠', başarı için '✓') ve sr-only önek (common.json'a `errorPrefix: "Hata:"`, `successPrefix: "Tamam:"`) ekleyin; mevcut renk sınıfları aynen kalır. search/page.tsx:461 ve ResultsMap.tsx:147'de role="status" kullanın ve yalnız bir kaynaktan duyurun; BookingMessages'ta geçmiş risk bantlarında role'ü kaldırın, yalnız SSE ile yeni gelen HIGH risk için alert verin; WalletCreditOption'da hatayı Field `error` prop'u ile alana bağlayın.

## F377 — Giriş gerektiren sayfalarda giriş bağlantısı geri dönüş adresi taşımıyor

| Alan                | Değer                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                           |
| Durum               | Doğrulandı (3 kaynak birleşti)                                                                                                                                                                                   |
| Konum               | `src/components/ui/ui.tsx:219`                                                                                                                                                                                   |
| Diğer konumlar      | `src/components/layout/Header.tsx:130`, `src/app/login/page.tsx:63`, `src/app/register/page.tsx:41`, `messages/tr/common.json:13`, `src/app/login/page.tsx`, `src/app/privacy/page.tsx`, `src/lib/api-client.ts` |
| Kullanıcılar        | misafir, ev sahibi, admin                                                                                                                                                                                        |
| Prensip             | flexibility · task migratability                                                                                                                                                                                 |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                                                                |
| Renk/tema           | Hayır                                                                                                                                                                                                            |
| Efor                | S                                                                                                                                                                                                                |
| Kaynak denetçiler   | area:shell, runtime:account, runtime:admin                                                                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                     |

**Kanıt:** ui.tsx:219 RoleGate '<Link href="/login" ...>' sorgu parametresi içermiyor; login/page.tsx:63 ve 141 '?redirect=' okuyabiliyor (141'de açık yönlendirme koruması var). register/page.tsx:41 sabit 'router.push("/")' kullanıyor ve redirect okumuyor. Header giriş/kayıt bağlantıları (Header.tsx:124-135, 200-211) da dönüş adresi taşımıyor. common.json 'loginRequired' yalnız giriş bağlantısı veriyor, kayıt seçeneği yok.

**Etki:** E-postadaki bir bağlantıyı açan ya da 'Gezi planla'ya tıklayan misafir giriş yaptıktan sonra ana sayfaya düşer ve hedef sayfayı yeniden bulmak zorunda kalır. Yeni kullanıcıya kayıt yolu gösterilmez.

**Önerilen aksiyon:** RoleGate'te usePathname() ve useSearchParams() ile mevcut yolu alıp 'href={`/login?redirect=${encodeURIComponent(path)}`}' kullanın. loginRequired mesajına '<register>Kayıt olun</register>' bölümü ekleyin ve aynı redirect'i verin. register/page.tsx:41'de login'deki korumalı redirect okumasını yeniden kullanın. Header'daki giriş/kayıt bağlantılarına pathname'i redirect olarak ekleyin.

## F386 — Host/admin için masaüstü menü kalabalık, etiketler iki satıra kırılıyor

| Alan                | Değer                                                       |
| ------------------- | ----------------------------------------------------------- |
| Severity            | Medium                                                      |
| Durum               | Doğrulandı (2 kaynak birleşti)                              |
| Konum               | `src/components/layout/Header.tsx:91`                       |
| Diğer konumlar      | `src/components/layout/Header.tsx:80`, `docs/img/admin.png` |
| Kullanıcılar        | ev sahibi, admin                                            |
| Prensip             | learnability · synthesizability / estetik-minimal           |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                |
| Renk/tema           | Hayır                                                       |
| Efor                | M                                                           |
| Kaynak denetçiler   | area:shell, runtime:admin                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                |

**Kanıt:** Header.tsx:80 'flex h-16' sabit yükseklik; 85 'hidden items-center gap-1 lg:flex' admin için 8 öğe; 91 bağlantılarda whitespace-nowrap yok. admin.png (1280px): 'Gezi planla', 'Devir pazarı', 'Ev sahibi paneli', 'Posta kutusu (demo)' ve 'Çıkış yap' iki satıra kırılmış. 1024-1279px aralığında durum daha kötü; metin büyütmede iki satırlı öğeler h-16'yı zorlar.

**Etki:** Masaüstü ağırlıklı ev sahibi ve yönetici menüyü taramakta zorlanır; iki satırlı etiketlerin tek öğe mi iki öğe mi olduğu belirsizleşir.

**Önerilen aksiyon:** Bağlantılara ve çıkış düğmesine 'whitespace-nowrap' ekleyin. Masaüstü menüyü 'xl:flex' kırılımına alın (hamburgeri 'xl:hidden' yapın) ya da rol panellerini ve Posta kutusunu hesap bağlantısının açılır menüsüne taşıyın. 'h-16' yerine 'min-h-16' kullanın.

## F387 — YZ rozeti misafire teknik jargon gösteriyor; 'doğruluğunu kontrol edin' uyarısı ve diğer açıklamalar yalnız title ipucunda

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                                                                                                                                                                                                                                            |
| Konum               | `src/components/ui/ui.tsx:135`                                                                                                                                                                                                                                                                                                                                                                                            |
| Diğer konumlar      | `messages/tr/common.json:19`, `src/components/search/SmartFilter.tsx:130`, `src/components/property/ReviewsSection.tsx:212`, `src/components/property/ReviewHighlights.tsx:80`, `src/components/property/AccessibilitySection.tsx:46`, `messages/tr/reviews.json:42`, `src/components/plan/TripPlanner.tsx:180`, `src/components/support/SupportChat.tsx:107`, `messages/tr/common.json:16`, `messages/en/common.json:16` |
| Kullanıcılar        | misafir                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Prensip             | learnability · familiarity / observability                                                                                                                                                                                                                                                                                                                                                                                |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                                                                                                                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Kaynak denetçiler   | area:results, area:pdp, area:shell                                                                                                                                                                                                                                                                                                                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                                                                                              |

**Kanıt:** ui.tsx:133-139 '<span ... title={t("ai.hint")}>{t("ai.generated")} · {MODE_KEYS.has(mode) ? t(`ai.modes.${mode}`) : mode}</span>' → common.json ai.modes 'Canlı LLM' / 'Demo (deterministik)' / 'Yedek (LLM başarısız)'; bilinmeyen mod ham değerle basılıyor. 'Yapay zekâ çıktısı — doğruluğunu kontrol edin' yalnız title'da; span odaklanamaz, dokunmatikte görünmez. Misafir yüzeyleri: SmartFilter.tsx:130, ReviewsSection.tsx:212, ReviewHighlights.tsx:80, TripPlanner.tsx:180, SupportChat.tsx:107, compare/page.tsx:225. Aynı kalıp: AccessibilitySection.tsx:44-46 'Doğrulandı' rozetinin anlamı (compliance.json verifiedHint) yalnız title'da; reviews.json:42 '{count} yorumdan kümelendi'.

**Etki:** Misafir 'LLM', 'deterministik', 'kümelendi' terimlerini anlamaz; 'başarısız' sözcüğü kaygı yaratır; mobil/klavye kullanıcısı YZ çıktısını doğrulaması gerektiği uyarısını ve 'Doğrulandı' rozetinin neye dayandığını hiç göremez.

**Önerilen aksiyon:** LlmBadge'e 'audience?: "guest" | "staff"' prop'u ekleyin (varsayılan 'guest'): guest'te metin 'Yapay zekâ ile üretildi; doğruluğunu kontrol edin' (ai.hint görünür metin olarak, title kaldırılır), yalnız fallback modunda ek ' · Basit özet (yapay zekâ şu an kullanılamıyor)'; canlı/demo ayrımını guest'ten gizleyin, bilinmeyen modu basmayın. AdminDashboard.tsx:104/247, HostDashboard.tsx:570, RevenueDashboard.tsx:205'te 'audience="staff"' ile mevcut teknik etiketleri koruyun. AccessibilitySection.tsx:30 'disclosure' paragrafına verifiedHint cümlesini ekleyip 46'daki title'ı kaldırın; reviews.json:42 'kümelendi' → 'derlendi'. Rozet renk sınıfları değişmez.

## F409 — Rezervasyon yönetimi iki sayfaya dağılmış, ana menüde yok, adlandırma tutarsız

| Alan                | Değer                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                                                                         |
| Durum               | Doğrulandı                                                                                                                                                                     |
| Konum               | `src/components/layout/Header.tsx:19`                                                                                                                                          |
| Diğer konumlar      | `src/app/booking/[id]/page.tsx:189`, `src/app/account/page.tsx:262`, `src/app/checkout/cart/page.tsx:205`, `src/app/pay/share/[token]/page.tsx:162`, `messages/tr/pwa.json:25` |
| Kullanıcılar        | misafir                                                                                                                                                                        |
| Prensip             | learnability · synthesizability / consistency                                                                                                                                  |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                    |
| WCAG                | 3.2.4                                                                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                                                                          |
| Efor                | M                                                                                                                                                                              |
| Kaynak denetçiler   | lens:nav                                                                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                   |

**Kanıt:** Header.tsx:19-30 NAV_ITEMS içinde /trips veya rezervasyon öğesi yok. booking/[id]/page.tsx:189-194'teki 'Rezervasyonlarım' (booking.json:56) bağlantısı /account'a gidiyor. checkout/cart/page.tsx:205-210 ve pay/share/[token]/page.tsx:162-163'teki 'Seyahatlerim' (cart.json:51) /trips'e gidiyor. account/page.tsx:262-264'teki bağlantının metni 'Seyahatlerim (çevrimdışı)' (pwa.json:25). /trips yalnız yaklaşan onaylı rezervasyonları gösteriyor (pwa.json:9-11). Mobilde hesap bağlantısı yalnız baş harf dairesi (Header.tsx:112 `hidden sm:inline`); aria-label='Hesabım' olduğu için erişilebilirlik ihlali değil. Mobil menüde (189-214) Hesabım ya da rezervasyon bağlantısı yok.

**Etki:** Misafir rezervasyonlarının nerede durduğunu kestiremiyor: aynı kavram iki adla iki ayrı sayfaya gidiyor. Bekleyen (HELD) ya da geçmiş rezervasyonlar 'Seyahatlerim'de görünmüyor. Mobilde rezervasyonlara giden tek yol etiketsiz görünen bir daire.

**Önerilen aksiyon:** Header.tsx NAV_ITEMS'e `{ key: "trips", href: "/trips", roles: ["USER","HOST","ADMIN"] }` ekleyin ve nav.json'a 'Seyahatlerim' anahtarını girin. Header.tsx:189-214'teki mobil menüye, oturum açıkken `/account` için metinli bir 'Hesabım' bağlantısı ekleyin. Adları birleştirin: booking/[id]/page.tsx:190'daki bağlantıyı /trips'e yönlendirin ya da metnini hedefle eşleştirin; pwa.json:25'teki '(çevrimdışı)' ekini kaldırın. /trips intro metninde geçmiş ve bekleyen rezervasyonların /account'ta olduğunu söyleyip oraya bağlantı verin. Uzun vadede /trips'e Yaklaşan/Geçmiş/İptal sekmeleri ekleyin.

## F410 — 'Seyahatlerim' ana gezinmede yok; QR kartı yalnız hesap sayfasındaki satır içi bağlantıdan bulunuyor

| Alan                | Değer                                                    |
| ------------------- | -------------------------------------------------------- |
| Severity            | Medium                                                   |
| Durum               | Doğrulandı                                               |
| Konum               | `src/components/layout/Header.tsx:19`                    |
| Diğer konumlar      | `src/app/account/page.tsx:262`, `messages/tr/nav.json:1` |
| Kullanıcılar        | misafir                                                  |
| Prensip             | learnability · keşfedilebilirlik / recognition           |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                  |
| Renk/tema           | Hayır                                                    |
| Efor                | S                                                        |
| Kaynak denetçiler   | area:trips                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                             |

**Kanıt:** Header.tsx:11 NavKey ve 19-30 NAV_ITEMS: stays, plan, transfers, cart, support, host, admin, mailbox — '/trips' yok. Tek kalıcı giriş account/page.tsx:262-264 'Oturumlar · Seyahatlerim (çevrimdışı) · Çözüm' satırında; offline/page.tsx:14 ve cart.json:51 dışında başka giriş yok.

**Etki:** Mobil misafir girişte (resepsiyonda, çoğu zaman zayıf bağlantıyla) göstereceği QR kartını aramak zorunda kalır; çevrimdışı önbellek sayfa daha önce açılmadıysa oluşmadığından keşfedilememesi doğrudan işlev kaybına yol açar.

**Önerilen aksiyon:** NavKey'e 'trips' ekleyip NAV_ITEMS'a '{ key: "trips", href: "/trips", roles: ["USER", "HOST", "ADMIN"] }' öğesini 'cart'ın önüne ekleyin (mobil menüye otomatik yansır); messages/tr|en/nav.json'a 'trips': 'Seyahatlerim' / 'My trips' ekleyin.

## F411 — Başlıkta 'Seyahatlerim' girişi yok

| Alan                | Değer                                                    |
| ------------------- | -------------------------------------------------------- |
| Severity            | Medium                                                   |
| Durum               | Doğrulandı                                               |
| Konum               | `src/components/layout/Header.tsx:19`                    |
| Diğer konumlar      | `src/app/account/page.tsx:262`, `messages/tr/nav.json:1` |
| Kullanıcılar        | misafir                                                  |
| Prensip             | learnability · familiarity (tanıma > hatırlama)          |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                  |
| Renk/tema           | Hayır                                                    |
| Efor                | S                                                        |
| Kaynak denetçiler   | area:shell                                               |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                             |

**Kanıt:** Header.tsx:19-30 NAV_ITEMS: stays, plan, transfers, cart, support, host, admin, mailbox; /trips yok. /trips'e yalnız hesap sayfasındaki küçük metin bağlantısı (account/page.tsx:262 'Seyahatlerim (çevrimdışı)'), offline sayfası ve ödeme sonrası ekranlar götürüyor.

**Etki:** Misafirin birincil görevlerinden biri olan rezervasyonunu yönetmek hatırlamaya dayanıyor: Hesabım sayfasında küçük bir metin bağlantısını aramak gerekiyor.

**Önerilen aksiyon:** NAV_ITEMS'a '{ key: "trips", href: "/trips", roles: ["USER","HOST","ADMIN"] }' ekleyin (stays'den hemen sonra); NavKey tipine 'trips' ekleyin; messages/{tr,en}/nav.json'a 'trips': 'Seyahatlerim' / 'My trips' ekleyin. Öğe mobil menüde otomatik görünür.

## F412 — Menüde görünürlük ile sayfa erişimi tutarsız: 'Gezi planla' anonime görünüyor ama giriş istiyor, giriş bağlantısı geri dönmüyor; admin alt bağlantıları RoleGate dışında

| Alan                | Değer                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                                                                         |
| Durum               | Doğrulandı                                                                                                                     |
| Konum               | `src/components/layout/Header.tsx:21`                                                                                          |
| Diğer konumlar      | `src/app/plan/page.tsx:12`, `src/components/ui/ui.tsx:219`, `src/components/pwa/TripsView.tsx:91`, `src/app/admin/page.tsx:17` |
| Kullanıcılar        | misafir, admin                                                                                                                 |
| Prensip             | learnability · consistency / predictability                                                                                    |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                    |
| WCAG                | 3.2.3                                                                                                                          |
| Renk/tema           | Hayır                                                                                                                          |
| Efor                | S                                                                                                                              |
| Kaynak denetçiler   | lens:nav                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                   |

**Kanıt:** Header.tsx:21 `{ key: "plan", href: "/plan" }` rol kısıtı yok, filtre (71-74) anonime gösteriyor. Ama plan/page.tsx:12 `<RoleGate>{() => <TripPlanner />}</RoleGate>` giriş istiyor. Aynı koşuldaki cart (24) ve support (26; support/page.tsx:12 de `<RoleGate>`) ise anonimden gizleniyor. RoleGate'in giriş bağlantısı (ui.tsx:219) `href="/login"`, `?redirect=` yok. Oysa login/page.tsx:63 ve 141 `redirect` parametresini destekliyor ve checkout/page.tsx:123 ile AddToCartButton.tsx:59 bu parametreyi kullanıyor. Bu yüzden girişten sonra kullanıcı '/' adresine düşüyor. admin/page.tsx:17-33'teki dört alt bağlantı, satır 34'teki `<RoleGate roles={["ADMIN"]}>` dışında kalıyor.

**Etki:** Anonim misafir 'Gezi planla'ya tıklıyor, yalnız 'giriş yapın' metnini görüyor. Giriş yaptıktan sonra planlayıcıya değil ana sayfaya dönüyor. Hangi menü öğesinin giriş istediği öngörülemiyor ('Sepetim'/'Destek' gizli, 'Gezi planla' görünür). /admin URL'sini açan yönetici olmayan kullanıcı, açamayacağı dört sayfanın bağlantısını görüyor.

**Önerilen aksiyon:** (1) ui.tsx:219: RoleGate içindeki giriş bağlantısını `usePathname()` ile `/login?redirect=${encodeURIComponent(pathname)}` yapın. Aynı düzeltmeyi TripsView.tsx:91'e de uygulayın. (2) Header.tsx: tek bir kural seçin. Ya plan öğesine `roles: ["USER","HOST","ADMIN"]` verin (cart/support ile tutarlı olur), ya da anonime görünen ve giriş gerektiren öğelere `requiresLogin: true` alanı ekleyip bağlantıyı `/login?redirect=/plan` yapın ve metnin yanına görsel olarak gizli olmayan kısa bir '(giriş gerekir)' etiketi koyun. (3) admin/page.tsx:17-33'teki `<p>` bağlantı satırını RoleGate render fonksiyonunun içine taşıyın: `{() => (<><p>…</p><AdminDashboard /></>)}`.

## F413 — Anonim misafir için yardım/destek kanalı yok

| Alan                | Değer                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Severity            | Medium                                                              |
| Durum               | Doğrulandı                                                          |
| Konum               | `src/components/layout/Header.tsx:26`                               |
| Diğer konumlar      | `src/app/support/page.tsx:12`, `src/components/layout/Footer.tsx:7` |
| Kullanıcılar        | misafir                                                             |
| Prensip             | learnability · task conformance (yardım erişimi)                    |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                          |
| Renk/tema           | Hayır                                                               |
| Efor                | M                                                                   |
| Kaynak denetçiler   | lens:nav                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                        |

**Kanıt:** Header.tsx:26 `{ key: "support", href: "/support", roles: ["USER", "HOST", "ADMIN"] }` oturumsuzlara gizli; support/page.tsx:12 `<RoleGate>{() => <SupportChat />}</RoleGate>` sayfanın tamamını kapatıyor, oturumsuz içerik (SSS/politika) yok. Footer'daki yardım bağlantıları da '/' (ayrı bulgu). Checkout ve sepet sayfalarında Header/Footer yok.

**Etki:** Rezervasyon öncesi iptal, iade ya da erişilebilirlik sorusu olan oturumsuz misafir hiçbir yardım kanalı bulamıyor; para kararı öncesi koşulları okuyamıyor.

**Önerilen aksiyon:** Header'da 'Destek' öğesini herkese gösterin (roles'u kaldırın). support/page.tsx'te PageShell içine oturumsuz okunabilen kısa bir SSS/politika bölümü (iptal, iade, ödeme, erişilebilirlik; /trust ve /privacy'ye bağlantılar) ekleyin ve RoleGate'i yalnız SupportChat'e uygulayın (loginHref ile). Checkout başlığına ve booking/[id] sayfasına 'Bu rezervasyonla ilgili yardım' bağlantısı ekleyin.

## F414 — Header her sayfa geçişinde yeniden kuruluyor; oturum açıkken 'Giriş yap/Kayıt ol' anlık görünüyor, rol menüsü sonradan beliriyor

| Alan                | Değer                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                      |
| Durum               | Doğrulandı                                                                                                                                                  |
| Konum               | `src/components/layout/Header.tsx:47`                                                                                                                       |
| Diğer konumlar      | `src/components/ui/ui.tsx:168`, `src/components/ui/ui.tsx:183`, `src/app/page.tsx:41`, `src/app/search/page.tsx:281`, `src/components/layout/Header.tsx:71` |
| Kullanıcılar        | tümü                                                                                                                                                        |
| Prensip             | robustness · observability / responsiveness                                                                                                                 |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                       |
| Efor                | M                                                                                                                                                           |
| Kaynak denetçiler   | lens:mobile, lens:nav                                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                |

**Kanıt:** Header kök layout'ta değil; 13 dosyada ayrı render ediliyor (PageShell ui.tsx:168, page.tsx, search, login, register, account, booking/[id], property/[id], privacy, ranking, AuthCard…), bu yüzden her navigasyonda yeniden mount oluyor. Header.tsx:47 `useState<SessionUser | null>(null)` ile başlıyor, :50-58 her pathname'de fetchCurrentUser çağırıyor; yanıt gelene kadar :71-74 rol öğeleri (Sepet, Destek, Ev sahibi paneli, Yönetim) gizli, :123-136 giriş/kayıt düğmeleri görünür. RoleGate'teki useSession (ui.tsx:183-195) aynı isteği ikinci kez atıyor.

**Etki:** Oturum açık kullanıcı her gezinmede bir an 'Giriş yap' görüyor ve oturumun düştüğünü sanabiliyor; menü öğeleri sonradan eklenince nav kayıyor ve yanlış öğeye tıklanabiliyor. Her navigasyonda bir ya da iki fazladan /api isteği oluşuyor.

**Önerilen aksiyon:** Oturumu kök layout.tsx'te (server) çerezden çözüp `NextIntlClientProvider` gibi bir `SessionProvider` ile `initialUser` olarak verin; Header ve useSession bu bağlamdan okusun ve yalnız giriş/çıkışta yenilesin. Header/Footer'ı paylaşılan bir route group layout'una (ör. app/(site)/layout.tsx) taşıyıp PageShell'den çıkarın. Kullanıcı durumu bilinmezken giriş düğmeleri yerine aynı genişlikte boş yer tutucu gösterin.

## F415 — Oturum açık kullanıcıya her gezinmede önce 'Giriş yap/Kayıt ol' gösteriliyor, rol menüleri sonradan beliriyor

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | Medium                                                     |
| Durum               | Doğrulandı                                                 |
| Konum               | `src/components/layout/Header.tsx:47`                      |
| Diğer konumlar      | `src/components/ui/ui.tsx:183`, `src/lib/api-client.ts:82` |
| Kullanıcılar        | tümü                                                       |
| Prensip             | robustness · observability / responsiveness                |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                             |
| Renk/tema           | Hayır                                                      |
| Efor                | M                                                          |
| Kaynak denetçiler   | area:shell                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                               |

**Kanıt:** Header.tsx:47 'useState<SessionUser | null>(null)'; null hem 'yükleniyor' hem 'oturum yok' anlamında. Header kök layout'ta değil, PageShell (ui.tsx:168) ve 10 sayfa/bileşende render ediliyor; farklı sayfa bileşenleri altında her gezinmede yeniden bağlanıyor ve 50-58'de fetchCurrentUser'ı [pathname] ile tekrar çağırıyor. 71-74 filtre: Sepetim, Destek, Ev sahibi paneli ve Yönetim kullanıcı gelince ekleniyor, öğeler kayıyor. api-client.ts:82-88 fetchCurrentUser her hatada null döndürüyor; ağ hatasında oturum açık kullanıcı çıkış yapmış görünüyor, useSession (ui.tsx:183-195) de RoleGate'te 'giriş yapın' gösteriyor.

**Etki:** Oturum açık kullanıcı her sayfada kısa süre 'Giriş yap' görür ve oturumunun düştüğünü sanabilir; kayan menüde yanlış öğeye tıklayabilir. Çevrimdışıyken yanlışlıkla giriş istenir.

**Önerilen aksiyon:** Header'da üç durumlu durum kullanın ('undefined' = yükleniyor) ve yüklenirken auth alanında sabit genişlikte 'aria-hidden' bir yer tutucu gösterin. Rol bağımlı menü öğelerini yükleme bitene kadar render etmeyin. fetchCurrentUser'ı 401 ile ağ hatasını ayıracak şekilde değiştirin ({ user } | { error: "network" }); ağ hatasında RoleGate 'Oturum bilgisi alınamadı' ve Tekrar dene göstersin. İsteğe bağlı: oturumu kök layout'ta sunucuda çözüp Header'a initialUser verin.

## F416 — Aktif sayfa yalnız hafif bir ton farkıyla belirtiliyor, mobil menüde hiç gösterge yok

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Medium                                 |
| Durum               | Doğrulandı                             |
| Konum               | `src/components/layout/Header.tsx:91`  |
| Diğer konumlar      | `src/components/layout/Header.tsx:184` |
| Kullanıcılar        | tümü                                   |
| Prensip             | accessibility · Use of Color           |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü         |
| WCAG                | 1.4.1                                  |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | area:shell                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** Header.tsx:91 'aria-[current=page]:bg-white/15' → #003580 üzerinde rgb(38,83,147), zeminle yaklaşık 1.5:1 fark; alt çizgi veya kalınlık gibi başka işaret yok (admin.png 'Yönetim'). Mobil menü bağlantıları (Header.tsx:184) aria-current alıyor ama hiçbir aria-[current] stili yok.

**Etki:** Renk algısı zayıf kullanıcı ya da parlak ortamda mobil kullanan kullanıcı hangi bölümde olduğunu göremez; mobil menüde konum bilgisi görsel olarak hiç yok.

**Önerilen aksiyon:** Masaüstü (91) ve mobil (184) bağlantılara renk dışı gösterge ekleyin: 'aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-4 aria-[current=page]:font-bold'. Mevcut beyaz metin kullanılır, yeni renk eklenmez.

## F417 — Mobil menüde Hesabım/Seyahatlerim yok; bulunulan sayfa mobilde ve arama/ilan akışında işaretlenmiyor

| Alan                | Değer                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                               |
| Durum               | Doğrulandı                                                                                                                                           |
| Konum               | `src/components/layout/Header.tsx:184`                                                                                                               |
| Diğer konumlar      | `src/components/layout/Header.tsx:19`, `src/components/layout/Header.tsx:75`, `src/components/layout/Header.tsx:104`, `src/app/account/page.tsx:262` |
| Kullanıcılar        | misafir, ev sahibi                                                                                                                                   |
| Prensip             | learnability · observability (konum farkındalığı) / familiarity                                                                                      |
| Sezgisel madde      | H6 — Tanıma > hatırlama                                                                                                                              |
| Renk/tema           | Hayır                                                                                                                                                |
| Efor                | S                                                                                                                                                    |
| Kaynak denetçiler   | lens:mobile, lens:nav                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                         |

**Kanıt:** NAV_ITEMS (:19-30) /account ve /trips içermiyor; hesaba yalnız :104-113 baş harf dairesiyle gidiliyor (ad mobilde `hidden sm:inline`). /trips'e uygulama içi yollar account/page.tsx:262, checkout/cart ve offline sayfası. Mobil bağlantı sınıfında (:184) masaüstündeki (:91) `aria-[current=page]:` görsel durumu yok. isCurrent (:75-76) `href === "/" ? pathname === "/"` olduğundan /search, /property/*, /compare'de hiçbir öğe current değil.

**Etki:** Dijital okuryazarlığı düşük misafir 'AD' dairesinin hesap olduğunu tanımayabiliyor; çevrimdışı QR'lı seyahat kartına mobilden ulaşmak için hesap sayfasındaki metin bağlantısını keşfetmesi gerekiyor. Mobilde ve arama → ilan akışında hangi bölümde olduğu görünmüyor.

**Önerilen aksiyon:** Oturum açıkken mobil menünün kullanıcı bölümüne (:190) 'Hesabım' (/account) ve 'Seyahatlerim' (/trips) bağlantıları ekleyin (nav.json'a trips anahtarı). :184 sınıfına masaüstündeki mevcut `aria-[current=page]:bg-white/15` ile birlikte renk dışı ipucu `aria-[current=page]:font-semibold aria-[current=page]:underline` ekleyin. NAV_ITEMS'ta stays için `match: ["/", "/search", "/property", "/compare"]` alanı tanımlayıp isCurrent'ta kullanın.

## F418 — Çerez onayı verildikten sonra değiştirilemiyor ya da geri çekilemiyor

| Alan                | Değer                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                              |
| Durum               | Doğrulandı                                                                                                          |
| Konum               | `src/components/privacy/CookieConsent.tsx:39`                                                                       |
| Diğer konumlar      | `src/components/layout/Footer.tsx:72`, `src/components/privacy/PrivacyCenter.tsx:56`, `messages/tr/privacy.json:34` |
| Kullanıcılar        | tümü                                                                                                                |
| Prensip             | flexibility · customizability / user control                                                                        |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                   |
| Renk/tema           | Hayır                                                                                                               |
| Efor                | S                                                                                                                   |
| Kaynak denetçiler   | lens:consistency                                                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                        |

**Kanıt:** CookieConsent.tsx:30-39'da `hasConsent` true olunca bileşen kalıcı olarak null döndürüyor. Bandı yeniden açan bir dışa aktarım ya da olay yok; `listeners` yalnızca writeConsent'ten tetikleniyor. Footer.tsx:72-77'deki 'Çerez Bildirimi' yalnızca /privacy#p-cookies metnine gidiyor. privacy.json'daki cookies.body tercihin ancak 'çerezi silerek' değiştirilebileceğini söylüyor. PrivacyCenter.tsx'te çerez ayarı yok.

**Etki:** Analitik çereze onay veren ya da yanlışlıkla 'Tümünü kabul et'e basan kullanıcı onayını arayüzden geri alamaz; tarayıcı çerezlerini elle silmesi gerekir. KVKK ve GDPR, onayın verildiği kadar kolay geri alınabilmesini ister.

**Önerilen aksiyon:** CookieConsent.tsx'te `const reopenListeners` ile `export function openCookieSettings()` ekleyin; bu fonksiyon modül düzeyinde bir `forceOpen` bayrağını set edip dinleyicileri tetiklesin. Bileşen `hasConsent && !forceOpen` iken null dönsün, açıldığında `customizing=true` olsun ve analitik kutusu `readConsent(document.cookie) === "necessary,analytics"` ile önceden işaretli gelsin. Footer'a 'Çerez ayarları' için `<button type="button" onClick={openCookieSettings}>` ekleyin; Footer client bileşen olmadığından küçük bir client alt bileşen kullanın. PrivacyCenter'a aynı düğmeyi içeren bir 'Çerez tercihleri' Card'ı ekleyin. privacy.json'daki 'çerezi silerek' cümlesini yeni yolu gösterecek şekilde güncelleyin.

## F419 — Çerez tercihi sonradan arayüzden değiştirilemiyor

| Alan                | Değer                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Severity            | Medium                                                               |
| Durum               | Doğrulandı                                                           |
| Konum               | `src/components/privacy/CookieConsent.tsx:39`                        |
| Diğer konumlar      | `src/components/layout/Footer.tsx:72`, `messages/tr/privacy.json:34` |
| Kullanıcılar        | misafir, ev sahibi, admin                                            |
| Prensip             | robustness · recoverability                                          |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                    |
| Renk/tema           | Hayır                                                                |
| Efor                | S                                                                    |
| Kaynak denetçiler   | area:shell                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                         |

**Kanıt:** CookieConsent.tsx:39 'if (hasConsent) return null;'; bandı yeniden açan bir API yok. Footer 'Çerez Bildirimi' (Footer.tsx:72-77) yalnız /privacy#p-cookies metnine gidiyor. privacy.json cookies.body: '...çerezi silerek tercihinizi değiştirebilirsiniz' → kullanıcıdan tarayıcı çerezini elle silmesi bekleniyor.

**Etki:** 'Tümünü kabul et'e yanlışlıkla basan kullanıcı analitik onayını arayüzden geri alamaz; rızayı geri çekmek vermek kadar kolay değil (KVKK/GDPR beklentisi).

**Önerilen aksiyon:** CookieConsent.tsx'te modül düzeyinde 'forceOpen' bayrağı ve 'openCookiePreferences()' fonksiyonu ekleyin (bayrağı set edip listeners'ı çağırır); bileşen hasConsent && !forceOpen iken null döndürsün, açıldığında customizing=true ve analytics mevcut çerezden önceden seçili olsun. Footer'a 'Çerez tercihleri' düğmesi ekleyin (Footer client bileşen değilse küçük bir istemci düğme bileşeni). privacy.json metnini 'sayfanın altındaki Çerez tercihleri bağlantısından' olarak güncelleyin.

## F420 — Çerez bandında 'Tümünü kabul et' dolu, 'Yalnızca zorunlu' çerçeveli: eşit olmayan vurgu

| Alan                | Değer                                                |
| ------------------- | ---------------------------------------------------- |
| Severity            | Medium                                               |
| Durum               | Doğrulandı                                           |
| Konum               | `src/components/privacy/CookieConsent.tsx:113`       |
| Kullanıcılar        | misafir                                              |
| Prensip             | flexibility · dialog initiative / kullanıcı kontrolü |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                    |
| Renk/tema           | Hayır                                                |
| Efor                | S                                                    |
| Kaynak denetçiler   | area:shell                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                         |

**Kanıt:** CookieConsent.tsx:111-117 'Yalnızca zorunlu' 'border border-[#003580] text-[#003580]' (ikincil); 118-124 'Tümünü kabul et' 'bg-[#003580] text-white' (birincil). Kabul görsel olarak varsayılan eylem gibi sunuluyor.

**Etki:** Misafir görsel vurgu nedeniyle istemeden analitik onayı verebilir; reddetme ikincil görünür (EDPB karanlık desen rehberi eşit görünürlük bekler).

**Önerilen aksiyon:** İki düğmeye bandın içinde zaten kullanılan aynı sınıf setini verin: 'Tümünü kabul et' düğmesini de 'border border-[#003580] text-[#003580] hover:bg-blue-50' yapın (ya da 'Yalnızca zorunlu'yu dolu sınıfa çekin). Yalnız mevcut sınıflar yeniden kullanıldığı için palet veya tema değişmez.

## F421 — Çerez bandında 'Özelleştir' sonrası odak kayboluyor; sabit band odaktaki öğeleri örtüyor

| Alan                | Değer                                                 |
| ------------------- | ----------------------------------------------------- |
| Severity            | Medium                                                |
| Durum               | Doğrulandı                                            |
| Konum               | `src/components/privacy/CookieConsent.tsx:288`        |
| Diğer konumlar      | `src/styles/globals.css:61`, `src/app/layout.tsx:189` |
| Kullanıcılar        | tümü                                                  |
| Prensip             | accessibility · Focus Order / Focus Not Obscured      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                     |
| WCAG                | 2.4.11                                                |
| Renk/tema           | Hayır                                                 |
| Efor                | S                                                     |
| Kaynak denetçiler   |                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                          |

**Kanıt:** CookieConsent.tsx:288-305 'customizing ? <button>{t("save")}</button> : <button aria-expanded={customizing} onClick={() => setCustomizing(true)}>' — odaktaki 'Özelleştir' düğmesi DOM'dan kaldırılıyor, odak body'ye düşüyor; aria-expanded hiçbir zaman true okunmuyor (düğme o anda yok). 242 'fixed inset-x-0 bottom-0 z-50' band onay verilene kadar her sayfada; globals.css yalnız 'scroll-padding-top: 5rem' tanımlıyor, alt pay yok → Tab ile ilerlerken sayfanın alt kısmına kaydırılan odaklı öğe bandın altında kalabiliyor. Band DOM'da altbilginin de sonunda (layout.tsx:189) olduğundan odağın başa dönmesi bandı yeniden bulmayı uzatıyor.

**Etki:** Klavye/ekran okuyucu kullanıcısı 'Özelleştir'e bastıktan sonra konumunu kaybeder ve yeni açılan onay kutusuna ulaşmak için tüm sayfayı yeniden dolaşır; onay vermeden gezinen kullanıcı odaktaki bağlantıyı göremez.

**Önerilen aksiyon:** 'Özelleştir' ve 'Tercihleri kaydet' için tek kalıcı düğme kullanmak yerine 'Özelleştir'i yerinde tutun (aria-expanded true/false, aria-controls="cookie-categories") ve fieldset'e id="cookie-categories" verin; ya da useRef ile setCustomizing(true) sonrası odağı '#consent-analytics' kutusuna taşıyın. Band açıkken ResizeObserver ile bandın yüksekliğini ölçüp 'document.documentElement.style.scrollPaddingBottom' ve body 'paddingBottom' olarak yazın (onay sonrası temizleyin).

## F422 — Çevrimdışı durum yalnız Seyahatlerim'de ele alınıyor; diğer ekranlarda ağ kopması bildirilmiyor

| Alan                | Değer                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                   |
| Durum               | Doğrulandı                                                                               |
| Konum               | `src/components/pwa/ServiceWorkerRegistrar.tsx:10`                                       |
| Diğer konumlar      | `src/components/pwa/TripsView.tsx:69`, `src/app/offline/page.tsx:14`, `public/sw.js:131` |
| Kullanıcılar        | misafir, ev sahibi                                                                       |
| Prensip             | robustness · observability                                                               |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                           |
| WCAG                | 4.1.3                                                                                    |
| Renk/tema           | Hayır                                                                                    |
| Efor                | M                                                                                        |
| Kaynak denetçiler   | lens:status                                                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                             |

**Kanıt:** navigator.onLine yalnız TripsView.tsx:69 ve :73'te; kod tabanında 'online'/'offline' olay dinleyicisi yok (grep). ServiceWorkerRegistrar.tsx:9-15 yalnız SW kaydı yapıyor. offline/page.tsx yalnız tam sayfa gezinmesinde devreye giriyor ve 'Tekrar dene' eylemi içermiyor; istemci tarafı fetch hataları ham 'Failed to fetch' benzeri metinle Status'a düşüyor.

**Etki:** Mobil misafir tünelde ya da uçakta form gönderdiğinde neden başarısız olduğunu anlamıyor; bağlantı dönünce ekranlar kendiliğinden yenilenmediği için eski veriye bakıyor.

**Önerilen aksiyon:** ServiceWorkerRegistrar'ın yanına `ConnectivityBanner` istemci bileşeni ekleyip layout.tsx'te render edin: `window.addEventListener("offline"/"online")` ile `role="status"` metin ('Çevrimdışısınız — değişiklikler gönderilemez' / 'Bağlantı geri geldi') ve aria-hidden ikon gösterin. Bağlantı dönünce `window.dispatchEvent(new Event("app:reconnect"))` yayınlayın, useLoader bu olayda reload etsin. offline/page.tsx'e `<a href="">` biçiminde 'Tekrar dene' bağlantısı ekleyin.

## F423 — Uygulama genelinde çevrimdışı/çevrimiçi durum göstergesi yok

| Alan                | Değer                                                          |
| ------------------- | -------------------------------------------------------------- |
| Severity            | Medium                                                         |
| Durum               | Doğrulandı                                                     |
| Konum               | `src/components/pwa/ServiceWorkerRegistrar.tsx:16`             |
| Diğer konumlar      | `src/components/pwa/TripsView.tsx:69`, `src/app/layout.tsx:68` |
| Kullanıcılar        | tümü                                                           |
| Prensip             | robustness · observability                                     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                 |
| Renk/tema           | Hayır                                                          |
| Efor                | S                                                              |
| Kaynak denetçiler   | area:shell                                                     |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                   |

**Kanıt:** ServiceWorkerRegistrar.tsx:10-17 yalnız SW kaydı yapıp 'return null' döndürüyor. Kod tabanında 'online'/'offline' olay dinleyicisi yok; navigator.onLine yalnız TripsView.tsx:69,73'te kullanılıyor.

**Etki:** Ödeme veya mesajlaşma sırasında bağlantısı kopan kullanıcı işlemlerin neden başarısız olduğunu anlamaz (yalnız 'Failed to fetch' görür); bağlantı dönünce haber almaz.

**Önerilen aksiyon:** Yeni 'src/components/pwa/NetworkStatus.tsx' istemci bileşeni ekleyin (layout.tsx:68'de ServiceWorkerRegistrar'ın yanına): useSyncExternalStore ile 'online'/'offline' olaylarını dinlesin; çevrimdışıyken kalıcı 'role="status"' bant ('Çevrimdışısınız — bağlantı gelince işlemi tekrar deneyin') göstersin, çevrimiçine dönünce 'Bağlantı geri geldi' duyurup birkaç saniye sonra gizlesin. Metinleri pwa.json'a 'network.offline' / 'network.online' olarak ekleyin; bant stilinde mevcut demo şeridi sınıflarını kullanın.

## F424 — iOS Safari'de form alanlarına odaklanınca otomatik yakınlaştırma (14px yazı)

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                            |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                                                                        |
| Konum               | `src/components/ui/ui.tsx:21`                                                                                                                                                                                                                                                                                                                     |
| Diğer konumlar      | `src/components/layout/ThemeToggle.tsx:43`, `src/components/layout/LocaleSwitcher.tsx:29`, `src/components/search/DestinationAutocomplete.tsx:142`, `src/app/search/page.tsx:120`, `src/components/booking/BookingWidget.tsx:170`, `src/app/login/page.tsx:95`, `src/app/checkout/cart/page.tsx:226`, `src/components/booking/CouponField.tsx:53` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                              |
| Prensip             | learnability · predictability                                                                                                                                                                                                                                                                                                                     |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                                                                                                                                                                                                                                                                 |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                             |
| Efor                | S                                                                                                                                                                                                                                                                                                                                                 |
| Kaynak denetçiler   | lens:mobile                                                                                                                                                                                                                                                                                                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                      |

**Kanıt:** ui.tsx:21 `inputClass = … px-3 py-2 text-sm …` (14px). ThemeToggle.tsx ve LocaleSwitcher.tsx select'leri `text-sm` label'dan 14px devralıyor. Yerel kopyalar da text-sm: DestinationAutocomplete.tsx:142, search/page.tsx:120, BookingWidget.tsx:170/188, login/page.tsx:95/110, BookingActions.tsx:235, checkout/cart/page.tsx:226, CouponField.tsx:53, BookingMessages.tsx:187. iOS Safari 16px altı alana odaklanınca sayfayı büyütüyor. layout.tsx:29 viewport zoom'u engellemiyor (doğru).

**Etki:** iPhone'da arama, kart numarası, mesaj alanına her dokunuşta görünüm büyüyor, sabit öğeler kayıyor; kullanıcı elle uzaklaştırmak zorunda kalıyor.

**Önerilen aksiyon:** inputClass'ta `text-sm` yerine `text-base sm:text-sm` kullanın; yerel `field`/`input` sabitlerini inputClass'tan türetin ve ThemeToggle/LocaleSwitcher select'lerine `text-base lg:text-sm` verin. `maximumScale: 1` / `userScalable: false` eklemeyin (1.4.4).

## F425 — Ortak primitifler yalnızca host/admin ekranlarında kullanılıyor; misafir akışında ham <button>/<section> var, odak ve şekil tutarsız

| Alan                | Değer                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                    |
| Durum               | Doğrulandı                                                                                                                                                                                                |
| Konum               | `src/components/ui/ui.tsx:29`                                                                                                                                                                             |
| Diğer konumlar      | `src/components/privacy/CookieConsent.tsx:41`, `src/app/register/page.tsx:120`, `src/app/account/page.tsx:226`, `src/components/account/PasskeyManager.tsx:102`, `src/components/search/SearchBar.tsx:84` |
| Kullanıcılar        | misafir                                                                                                                                                                                                   |
| Prensip             | learnability · consistency / generalizability                                                                                                                                                             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                                                                                                               |
| Renk/tema           | Hayır                                                                                                                                                                                                     |
| Efor                | L                                                                                                                                                                                                         |
| Kaynak denetçiler   | lens:consistency                                                                                                                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                              |

**Kanıt:** `<Button` 26 dosyada, ham `<button` ise 44 dosyada kullanılıyor (grep). Ham düğmeler ağırlıkla misafir akışında: SearchBar, checkout, cart, CookieConsent.tsx:94-124 (kendi buttonBase'i). register/page.tsx:120'deki input `focus:ring-1` ile inputClass'ın `focus-visible:ring-2 ring-offset-2` halkasından farklı. Kartlar da farklı: account/page.tsx:226 `rounded-2xl p-6`, Card (ui.tsx:104) `rounded-xl p-5`.

**Etki:** Aynı birincil eylem ekranlar arasında farklı köşe, dolgu ve odak halkasıyla görünür; bu, tanımayı ve odak izlemeyi zayıflatır. Primitiflere yapılan erişilebilirlik düzeltmeleri misafir akışına ulaşmaz.

**Önerilen aksiyon:** Button'a `size?: "md" | "lg"` ve `fullWidth?: boolean` prop'ları ekleyin. Bağlantı-düğmeler için aynı sınıfları paylaşan bir `ButtonLink` primitifi ekleyin. CookieConsent, cart, checkout ve SearchBar'daki ham düğmeleri, mevcut renkleri koruyarak `<Button variant="primary|secondary">` ile değiştirin. Yalnızca primitifin hazır varyantlarını kullanın; yeni renk eklemeyin. register ve login input'larını `inputClass`'a geçirin. Hesap sayfasındaki ham section'ları (WalletPanel, PasskeyManager, SessionManager) Card'a taşıyın.

## F426 — Field bileşeni zorunlu alanı görsel olarak belirtmiyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Doğrulandı                                              |
| Konum               | `src/components/ui/ui.tsx:47`                           |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:119` |
| Kullanıcılar        | tümü                                                    |
| Prensip             | accessibility · Labels or Instructions                  |
| Sezgisel madde      | H5 — Hata önleme                                        |
| WCAG                | 3.3.2                                                   |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:shell                                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** ui.tsx:47-59 Field prop'ları label, id, hint, error, children; 'required' yok, etiket (72-74) yalnız metin. ComplianceDashboard.tsx:118-126'da 'td-property' ve 'td-reason' required, 'td-ref' isteğe bağlı; üçü görsel olarak aynı. Field 17 bileşende kullanılıyor; mesaj dosyalarında '(zorunlu)' veya '*' işareti yok.

**Etki:** Kullanıcı hangi alanların zorunlu olduğunu ancak gönderip hata aldığında öğrenir.

**Önerilen aksiyon:** Field'a 'required?: boolean' ekleyin: true iken etikete '<span aria-hidden="true"> _</span>' ekleyin ve cloneElement ile çocuğa 'required: true' verin. Formun başında bir kez 'common.requiredLegend' ('_ işaretli alanlar zorunludur') gösterin. Mevcut required input'ları sarmalayan Field'lara 'required' prop'unu verin.

## F427 — Field hata metni gönderimde duyurulmuyor ve odak geçersiz alana taşınmıyor

| Alan                | Değer                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                        |
| Durum               | Doğrulandı                                                                                    |
| Konum               | `src/components/ui/ui.tsx:81`                                                                 |
| Diğer konumlar      | `src/components/compliance/AppealForm.tsx:68`, `src/components/account/AgentMandates.tsx:117` |
| Kullanıcılar        | tümü                                                                                          |
| Prensip             | accessibility · Error Identification / Status Messages                                        |
| Sezgisel madde      | H9 — Hata mesajları                                                                           |
| WCAG                | 3.3.1                                                                                         |
| Renk/tema           | Hayır                                                                                         |
| Efor                | S                                                                                             |
| Kaynak denetçiler   | area:shell                                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                  |

**Kanıt:** ui.tsx:81-85 '<p id={errorId} className="mt-1 text-xs font-medium text-red-700">{error}</p>' canlı bölge değil. Field aria-describedby ve aria-invalid veriyor ama duyuru ya da odak taşıma yok. AppealForm.tsx:68 'noValidate' formda fieldError ayarlanıp gönderim duruyor; odak textarea'ya taşınmıyor, Status boş kalıyor → ekran okuyucu kullanıcısı gönder'e bastığında hiçbir şey duymuyor. AgentMandates.tsx:117 de aynı deseni kullanıyor. (Adaydaki 'yalnız renkle ayrışıyor' iddiası doğru değil: hata ve başarı metinleri içerikleriyle ayrışıyor, 1.4.1 ihlali yok.)

**Etki:** Ekran okuyucu kullanıcısı itiraz formunu gönderdiğinde sessizlikle karşılaşır, hatayı ancak alana tekrar giderse duyar.

**Önerilen aksiyon:** Field'da hata paragrafına 'role="alert"' eklemek yerine, error varken çocuğa odak verecek bir yol sağlayın: ui.tsx'e 'focusFirstInvalid(form: HTMLFormElement)' yardımcısı ekleyin (form.querySelector('[aria-invalid="true"]')?.focus()) ve AppealForm/AgentMandates'te fieldError ayarlandıktan sonra çağırın. Hata metninin başına aria-hidden bir uyarı simgesi ve gizli 'Hata: ' öneki (common.errorPrefix) ekleyin.

## F428 — AI rozetinin doğrulama uyarısı yalnızca title tooltip'inde; mod etiketleri jargon içeriyor (LLM, deterministik) ve AI/yapay zekâ terimleri tutarsız

| Alan                | Değer                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                                          |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                                                                      |
| Konum               | `src/components/ui/ui.tsx:135`                                                                                                                                                                                                                                                                                                                  |
| Diğer konumlar      | `messages/tr/common.json:16`, `messages/en/common.json:16`, `src/components/host/HostDashboard.tsx:570`, `src/components/host/RevenueDashboard.tsx:205`, `src/components/support/SupportChat.tsx:107`, `src/components/plan/TripPlanner.tsx:180`, `src/components/property/ReviewsSection.tsx:212`, `src/components/search/SmartFilter.tsx:130` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                                                                                            |
| Prensip             | learnability · familiarity; help ve dokümantasyon                                                                                                                                                                                                                                                                                               |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                                                                                                                                                                     |
| WCAG                | 1.3.1                                                                                                                                                                                                                                                                                                                                           |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                                           |
| Efor                | S                                                                                                                                                                                                                                                                                                                                               |
| Kaynak denetçiler   | area:host, area:host2, area:misc                                                                                                                                                                                                                                                                                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                                    |

**Kanıt:** ui.tsx:133-139'daki span odaklanamıyor ve 'doğruluğunu kontrol edin' uyarısı yalnızca `title={t("ai.hint")}` içinde. messages/tr/common.json:16-22'de 'AI tarafından üretildi', 'Canlı LLM', 'Demo (deterministik)', 'Yedek (LLM başarısız)' geçiyor; revenue.json:35 ve support.json:5 ise 'yapay zekâ' diyor. Rozet misafir yüzeylerinde de kullanılıyor: ReviewsSection.tsx:212, ReviewHighlights.tsx:80, SmartFilter.tsx:130, compare/page.tsx:225, SupportChat.tsx:107, TripPlanner.tsx:180.

**Etki:** Dokunmatik ve klavye kullanıcıları doğrulama uyarısını hiç görmez; ekran okuyucular da title'ı tutarlı biçimde okumaz. Misafir 'LLM' ve 'deterministik' sözcüklerini anlamaz. 'Yedek (LLM başarısız)' ifadesi yanıtın güvenilir olup olmadığını açıklamaz.

**Önerilen aksiyon:** LlmBadge'de title'ı kaldırın. Rozet metninin sonuna `<span className="sr-only">{` — ${t("ai.hint")}`}</span>` ekleyin. Görsel kullanıcı için rozetin yanına `text-xs` boyutunda kısa bir 'Doğruluğunu kontrol edin' metni koyun; mevcut gri metin sınıfı kullanılsın. TR mod etiketlerini değiştirin: live 'Canlı yapay zekâ', demo 'Örnek yanıt (demo)', fallback 'Basit yanıt (yapay zekâ yanıt vermedi)'. Rozeti de 'Yapay zekâ ile üretildi' yapın. EN'de 'Live AI', 'Sample answer (demo)', 'Basic answer (AI unavailable)' kullanın.

## F429 — Rota değişiminde odak yönetimi yok; h1 odaklanabilir değil

| Alan                | Değer                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                           |
| Durum               | Doğrulandı                                                                                                                       |
| Konum               | `src/components/ui/ui.tsx:171`                                                                                                   |
| Diğer konumlar      | `src/app/search/page.tsx:284`, `src/app/booking/[id]/page.tsx:117`, `src/app/checkout/page.tsx:167`, `src/app/login/page.tsx:79` |
| Kullanıcılar        | tümü                                                                                                                             |
| Prensip             | accessibility · WCAG 2.4.3 Odak Sırası                                                                                           |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                   |
| WCAG                | 2.4.3                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                            |
| Efor                | S                                                                                                                                |
| Kaynak denetçiler   | lens:a11y                                                                                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                     |

**Kanıt:** ui.tsx:168-171'de Header her sayfanın içinde render ediliyor ve h1'de `tabIndex` yok. Gezinmede tıklanan Header bağlantısı yeniden mount edilen ağaçla birlikte DOM'dan kalkıyor. Next layout-router.js:236'daki `domNode.focus()` çağrısı odaklanamayan bir segment kökünde etkisiz kalıyor. Aynı yapı search/page.tsx, booking/[id]/page.tsx ve login/page.tsx'teki kendi main öğelerinde de var.

**Etki:** Klavye ve ekran okuyucu kullanıcısında yeni sayfa açıldığında odak <body>'de kalır ve Tab yeniden 'İçeriğe geç' → logo → menü sırasıyla baştan başlar. Kullanıcı yeni içeriğin başını kendisi aramak zorunda kalır.

**Önerilen aksiyon:** PageShell'de h1'e `ref={h1Ref}`, `tabIndex={-1}` ve `className="... focus:outline-none"` (ya da focusRing) verin. `usePathname()` değiştiğinde, ilk render hariç, `h1Ref.current?.focus({ preventScroll: true })` çağırın. Kendi main öğesini kuran sayfalar (search, booking/[id], checkout, login, register) için aynı mantığı `usePageHeadingFocus()` adlı bir kancaya taşıyın. Bu düzeltme sayfa başlığı bulgusuyla birlikte uygulanmalı.

## F430 — Yetkisiz rol mesajı ham enum gösteriyor ve sonraki adım sunmuyor

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | Medium                                                     |
| Durum               | Doğrulandı                                                 |
| Konum               | `src/components/ui/ui.tsx:230`                             |
| Diğer konumlar      | `messages/tr/common.json:14`, `messages/en/common.json:14` |
| Kullanıcılar        | misafir, ev sahibi                                         |
| Prensip             | learnability · familiarity / recoverability                |
| Sezgisel madde      | H9 — Hata mesajları                                        |
| Renk/tema           | Hayır                                                      |
| Efor                | S                                                          |
| Kaynak denetçiler   | lens:nav                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                               |

**Kanıt:** ui.tsx:228-233 `<p role="alert" …>{t("forbidden", { roles: roles.join(" / ") })}</p>` bileşeni ham rol kodlarını basıyor. Bunlar messages/tr/common.json:14 'Bu sayfaya erişim yetkiniz yok ({roles} rolü gerekir).' metnine giriyor ve TR arayüzde 'HOST / ADMIN rolü gerekir' çıktısı oluşuyor. Çeviriler hazır duruyor: messages/tr/account.json:15-19 `role.host` 'Ev Sahibi', `role.admin` 'Yönetici', `role.user` 'Kullanıcı'. Mesajda ana sayfaya dönüş ya da farklı hesapla giriş bağlantısı yok.

**Etki:** Paylaşılan bir /host veya /admin/... linkini açan misafir ya da ev sahibi, Türkçe cümlenin içinde İngilizce enum görüyor. Sayfada başka eylem yok, kullanıcı çıkmaza giriyor.

**Önerilen aksiyon:** ui.tsx RoleGate içinde `const tr = useTranslations("account.role")` tanımlayın ve rolleri `roles.map(r => tr(r.toLowerCase())).join(" / ")` ile yerelleştirin. Mesajın altına iki eylem ekleyin: `<Link href="/">` 'Ana sayfaya dön' ve 'Farklı hesapla giriş yap' (logout() çağrısından sonra `/login?redirect=${pathname}`). Yeni anahtarları messages/tr|en/common.json'a ekleyin. Mevcut kırmızı metin sınıfı korunsun, renk değişikliği gerekmiyor.

## F431 — Ham enum değerleri arayüze sızıyor (RoleGate rol adları, kategori, karar, bilinmeyen durumlar)

| Alan                | Değer                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                            |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                        |
| Konum               | `src/components/ui/ui.tsx:230`                                                                                                                                                                                                                                                    |
| Diğer konumlar      | `src/components/compliance/ComplianceDashboard.tsx:156`, `src/components/admin/AdminDashboard.tsx:341`, `src/components/admin/AdminDashboard.tsx:151`, `src/app/booking/[id]/page.tsx:118`, `src/components/resolution/shared.tsx:177`, `src/components/search/RankingWhy.tsx:33` |
| Kullanıcılar        | tümü                                                                                                                                                                                                                                                                              |
| Prensip             | learnability · familiarity (sistem ile gerçek dünya eşleşmesi)                                                                                                                                                                                                                    |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi                                                                                                                                                                                                                                                       |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                             |
| Efor                | S                                                                                                                                                                                                                                                                                 |
| Kaynak denetçiler   | lens:copy                                                                                                                                                                                                                                                                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                      |

**Kanıt:** ui.tsx:230 `t("forbidden", { roles: roles.join(" / ") })` → 'Bu sayfaya erişim yetkiniz yok (HOST / ADMIN rolü gerekir).'; oysa account.json'da `role.host: "Ev Sahibi"`, `role.admin: "Yönetici"` çevirileri var. ComplianceDashboard.tsx:156 `<strong>{n.category}</strong>`; AdminDashboard.tsx:341 `· {f.decision}`; :151 outbox `status` anahtarı ham; booking/[id]/page.tsx:118, resolution/shared.tsx:177, RankingWhy.tsx:33 bilinmeyen değerde ham kod geri dönüşü.

**Etki:** Misafir/ev sahibi 'HOST' gibi kodları anlamıyor ve ev sahibi olmak için ne yapacağını bilmiyor; yönetici kuyruğu kodlarla daha yavaş okunuyor.

**Önerilen aksiyon:** RoleGate'te rolleri `useTranslations("account")` ile `t(\`role.${r.toLowerCase()}\`)`üzerinden çevirip birleştirin; USER için forbidden mesajına ev sahibi olma yönlendirmesi ekleyin. ComplianceDashboard'da`t(\`report.categories.${n.category}\`)`, AdminDashboard'da karar ve outbox durumu için çeviri anahtarları kullanın; `?? status` geri dönüşlerini common.json'a eklenecek 'Bilinmeyen durum' metniyle değiştirin.

## F432 — Yetki hatası ham rol kodlarını gösteriyor ve çıkış yolu sunmuyor

| Alan                | Değer                                                      |
| ------------------- | ---------------------------------------------------------- |
| Severity            | Medium                                                     |
| Durum               | Doğrulandı                                                 |
| Konum               | `src/components/ui/ui.tsx:230`                             |
| Diğer konumlar      | `messages/tr/common.json:14`, `messages/en/common.json:14` |
| Kullanıcılar        | misafir, ev sahibi                                         |
| Prensip             | robustness · recoverability                                |
| Sezgisel madde      | H9 — Hata mesajları                                        |
| Renk/tema           | Hayır                                                      |
| Efor                | S                                                          |
| Kaynak denetçiler   | area:shell                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                               |

**Kanıt:** ui.tsx:227-232 '<p role="alert" ...>{t("forbidden", { roles: roles.join(" / ") })}</p>' → 'Bu sayfaya erişim yetkiniz yok (HOST / ADMIN rolü gerekir).' Enum kodları çevrilmiyor, bağlantı veya eylem yok; sayfa açılışında role="alert" ile duyuruluyor.

**Etki:** Yanlış role sahip kullanıcı 'HOST/ADMIN' jargonunu görür ve ne yapacağını bilmez (ana sayfaya dönmek, ev sahibi olmak).

**Önerilen aksiyon:** messages/{tr,en}/common.json'a 'roles.USER/HOST/ADMIN' ('Misafir', 'Ev sahibi', 'Yönetici') ekleyin ve join'den önce 'roles.map(r => t(`roles.${r}`))' ile çevirin. Mesajın altına '/' adresine 'Ana sayfaya dön' bağlantısı ekleyin. role="alert"'i kaldırıp düz paragraf kullanın.

## F433 — Yükleme hatasında 'Tekrar dene' yok: useLoader reload döndürüyor ama Status'a bağlanmamış

| Alan                | Değer                                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                                                                                                                                                                                                                                      |
| Durum               | Doğrulandı                                                                                                                                                                                                                                                                                                                  |
| Konum               | `src/components/ui/ui.tsx:241`                                                                                                                                                                                                                                                                                              |
| Diğer konumlar      | `src/components/admin/PayoutAdmin.tsx:53`, `src/components/host/PayoutPanel.tsx:70`, `src/components/host/RevenueDashboard.tsx:232`, `src/components/host/RevenueDashboard.tsx:321`, `src/components/resolution/ClaimDetail.tsx:38`, `src/components/admin/ClaimAdmin.tsx:53`, `src/components/admin/AdminDashboard.tsx:97` |
| Kullanıcılar        | ev sahibi, admin, misafir                                                                                                                                                                                                                                                                                                   |
| Prensip             | robustness · recoverability                                                                                                                                                                                                                                                                                                 |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                                                                                                                                                         |
| Renk/tema           | Hayır                                                                                                                                                                                                                                                                                                                       |
| Efor                | S                                                                                                                                                                                                                                                                                                                           |
| Kaynak denetçiler   | lens:status                                                                                                                                                                                                                                                                                                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                                                                                                                                                |

**Kanıt:** ui.tsx:241-263 useLoader `{ data, error, reload }` döndürüyor; hata yalnız Status (:144-155) ile metin olarak çıkıyor. 22 dosyada 32 useLoader çağrısı var (iddiadaki ~35 bileşen abartılı); hiçbiri hata durumunda reload'u bir düğmeye bağlamıyor. Erken dönüşlerde kart başlığı da kayboluyor: PayoutAdmin.tsx:53, PayoutPanel.tsx:70, RevenueDashboard.tsx:232/321, ClaimDetail.tsx:38 `if (error) return <Status error={error} />`. Tek örnek account/page.tsx:197 `window.location.reload()` ile tam sayfa yenileme.

**Etki:** Geçici 503/ağ hatasında ev sahibi gelir/ödeme panelleri ve yönetici kuyrukları kırmızı metinle donup kalıyor; tek çıkış tam sayfa yenileme ve kullanıcı neyin başarısız olduğunu (başlık kaybolduğu için) anlamıyor.

**Önerilen aksiyon:** ui.tsx'e `export function LoadError({ error, onRetry }: { error: string; onRetry: () => void })` ekleyin: `<div role="alert">` içinde hata metni + `<Button variant="secondary" onClick={onRetry}>{t("retry")}</Button>` (common.json'a `retry: "Tekrar dene"` / `"Try again"`). useLoader tüketicilerinde `<Status error={error} />` yerine `<LoadError error={error} onRetry={reload} />` kullanın; erken dönüşlü bileşenlerde dönüşü `<Card title={…}>` içine alın ki bağlam korunsun.

## F434 — useLoader filtre değiştiğinde eski veriyi göstergesiz tutuyor; liste ile filtre birbirini tutmuyor

| Alan                | Değer                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| Severity            | Medium                                                                               |
| Durum               | Doğrulandı                                                                           |
| Konum               | `src/components/ui/ui.tsx:246`                                                       |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:53`, `src/components/admin/SupportAdmin.tsx:80` |
| Kullanıcılar        | admin, ev sahibi                                                                     |
| Prensip             | robustness · observability                                                           |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                       |
| Renk/tema           | Hayır                                                                                |
| Efor                | S                                                                                    |
| Kaynak denetçiler   | area:admin                                                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                         |

**Kanıt:** ui.tsx:241-263'teki useLoader, deps ya da version değiştiğinde `data`yı sıfırlamıyor ve `loading` döndürmüyor. ClaimAdmin.tsx:53 `{!data && !error && …loading}` ve SupportAdmin.tsx:79-80 `!data ? loading` yalnızca ilk yüklemede gösterge veriyor. İstek dönene kadar önceki filtrenin satırları kalıyor ve Kararlı/İncele düğmeleri bu satırlarda etkin.

**Etki:** Yavaş ağda yönetici 'Çözüldü' filtresini seçtiğinde ekranda hâlâ açık talepler görünür ve bu satırlarda işlem yapabilir. Filtre durumu ile görünen içerik çelişir.

**Önerilen aksiyon:** useLoader'a `const [loading, setLoading] = useState(true)` ekleyin. Effect başında `setLoading(true)` yerine fetcher'ı `Promise.resolve().then(() => active && setLoading(true))` ile sarın; then ve catch içinde `setLoading(false)` çağırın. Ayrıca deps değiştiğinde `data`yı null yapan `depsKey` karşılaştırması ekleyin ve `{ data, error, loading, reload }` döndürün. ClaimAdmin ve SupportAdmin'de liste kapsayıcısına `aria-busy={loading}` verin, `loading && data` iken listenin üstünde `<p aria-live="polite">{t("loading")}</p>` gösterin ve satır eylem düğmelerini `disabled={loading}` yapın.

## F435 — useLoader yükleme durumu vermiyor; bağımlılık değişince eski veri güncelmiş gibi kalıyor

| Alan                | Değer                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Severity            | Medium                                                                        |
| Durum               | Doğrulandı                                                                    |
| Konum               | `src/components/ui/ui.tsx:262`                                                |
| Diğer konumlar      | `src/components/host/RevenueDashboard.tsx:223`, `src/app/compare/page.tsx:65` |
| Kullanıcılar        | tümü                                                                          |
| Prensip             | robustness · observability                                                    |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                |
| Renk/tema           | Hayır                                                                         |
| Efor                | M                                                                             |
| Kaynak denetçiler   | area:shell                                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                  |

**Kanıt:** ui.tsx:241-263 dönüş '{ data, error, reload }', loading bayrağı yok. Effect başında data/error sıfırlanmıyor: deps değişince önceki 'data' yeni istek bitene kadar ekranda kalıyor. Örnek: RevenueDashboard.tsx:223 '[propertyId]' değişince önceki tesisin geliri görünüyor; compare/page.tsx:65 sorgu değişince eski karşılaştırma görünüyor. reload() sırasında bekleme göstergesi yok. 23 dosyada kullanılıyor.

**Etki:** Ev sahibi tesis değiştirdiğinde önceki tesisin gelirini yenisininmiş gibi okuyabilir; misafir karşılaştırmada eski fiyatları güncel sanabilir. Yönetici kuyruğu yenilerken işlemin sürüp sürmediğini göremez.

**Önerilen aksiyon:** useLoader'a 'loading' state'i ekleyin (effect başında ve reload'da true, sonuçlanınca false) ve dönüşe ekleyin. İsteğe bağlı 'resetOnDepsChange' ile deps değişince data'yı null yapın. Tüketicilerde veri bölgesine 'aria-busy={loading}' ve loading && data iken küçük bir 'Güncelleniyor…' durum metni ekleyin.

## F554 — Çerez bandı DOM'un sonunda (Tab #52/#57); seçim sonrası odak body'ye düşüyor, Escape etkisiz, 'Özelleştir' aria-expanded hiç 'true' olmuyor

| Alan                | Değer                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                         |
| Durum               | Gözlemlendi                                                                                    |
| Konum               | `src/app/layout.tsx:67`                                                                        |
| Diğer konumlar      | `src/components/privacy/CookieConsent.tsx:105`, `src/components/privacy/CookieConsent.tsx:114` |
| Kullanıcılar        | tümü                                                                                           |
| Prensip             | accessibility · Predictability / focus management                                              |
| Sezgisel madde      | H14 — Erişilebilirlik                                                                          |
| WCAG                | 2.4.3 Focus Order (A) — risk                                                                   |
| Renk/tema           | Hayır                                                                                          |
| Efor                | S                                                                                              |
| Kaynak denetçiler   | runtime:shell                                                                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                   |

**Kanıt:** P6: banda ilk Tab mobilde #52, masaüstünde #57 ile ulaşılıyor (aydınlatma metni bağlantısı); yani sayfadaki tüm kontrollerden sonra. Bant göründüğünde canlı bölge ya da duyuru yok. 'Yalnızca zorunlu' + Enter sonrası bant kalkıyor ve odak 'body'ye düşüyor. Escape basınca bant duruyor. 'Özelleştir' aria-expanded='false'; tıklanınca düğme DOM'dan kalkıyor ve yerine 'Tercihleri kaydet' geliyor (odak oraya geçiyor), dolayısıyla genişletilmiş durum hiç yansımıyor.

**Etki:** Ekran okuyucu kullanıcısı bandın varlığından ancak sayfa sonunda haberdar oluyor. Seçimden sonra odak kaybolduğu için gezinmeye sayfanın başından yeniden başlaması gerekiyor.

**Önerilen aksiyon:** <CookieConsent/>'i layout'ta skip-link'ten hemen sonra render edin (görsel konum fixed bottom kalabilir). Seçim sonrası odağı önceki activeElement'e ya da #main öğesine (tabIndex=-1) taşıyın. 'Özelleştir'i gerçek bir disclosure yapın: düğme kalsın, aria-expanded true/false değişsin, aria-controls fieldset id'sini göstersin. Escape 'Yalnızca zorunlu' gibi davranabilir ya da bandı odaktan çıkarabilir.

## F555 — Footer'da 19 kontrolden 14'ü sahte ('/' adresine gidiyor); 'Kullanım Koşulları' hiçbir şey yapmayan bir düğme

| Alan                | Değer                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Severity            | Medium                                                           |
| Durum               | Gözlemlendi                                                      |
| Konum               | `src/components/layout/Footer.tsx:34`                            |
| Diğer konumlar      | `src/components/layout/Footer.tsx:69`, `messages/tr/footer.json` |
| Kullanıcılar        | tümü                                                             |
| Prensip             | learnability · Predictability / familiarity                      |
| Sezgisel madde      | H10 — Yardım/dokümantasyon                                       |
| Renk/tema           | Hayır                                                            |
| Efor                | M                                                                |
| Kaynak denetçiler   | runtime:shell                                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                     |

**Kanıt:** P7 (probes/shell/p7-footer.mjs), /privacy sayfası, 1280x800. Yardım Merkezi, COVID-19 ile ilgili bilgiler, İade politikası, Para iadesi, Erişilebilirlik, Tüm konaklama seçenekleri, Tatil kiralık evleri, Tatil paketleri, Şehir merkezindeki oteller, Uygun oteller, Otel sahibi misiniz?, Ortaklık programı, Kariyer ve Kurumsal iletişim bağlantılarının hepsi href='/'. /privacy'de 'Erişilebilirlik'e tıklayınca '/' açılıyor (h1 'Konaklama yerlerini keşfedin'). 'Kullanım Koşulları' bir <button> (type yok, onClick yok): tıklamada URL, dialog ya da metin değişmiyor. Gerçek hedefler mevcut: /support, /resolution, /search, /host, /trust, /ranking. footer.json'da kullanılmayan 'ranking' ('Sıralama nasıl çalışır?') anahtarı var. Mobilde footer 898 px uzunluğunda (/privacy belgesinin %34'ü).

**Etki:** İade politikasını, yardımı ya da erişilebilirlik beyanını arayan misafir sessizce anasayfaya düşüyor; güven kaybı yaşanıyor. Kullanım koşullarına erişilemiyor.

**Önerilen aksiyon:** Yardım Merkezi→/support, Para iadesi→/resolution, İade politikası→/trust (ilgili bölüm), Tüm konaklama seçenekleri→/search, Otel sahibi misiniz?→/host, 'Sıralama nasıl çalışır?'→/ranking olarak bağlayın. Karşılığı olmayanları (COVID, Kariyer, Ortaklık, Kurumsal, Tatil paketleri vb.) kaldırın. 'Kullanım Koşulları'nı gerçek bir sayfaya bağlı Link yapın ya da kaldırın. Bir erişilebilirlik beyanı sayfası ekleyin.

## F556 — Oturumlu başlık her sayfa geçişinde 170–520 ms boyunca anonim duruma dönüyor ('Kayıt ol | Giriş yap')

| Alan                | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Severity            | Medium                                                       |
| Durum               | Gözlemlendi                                                  |
| Konum               | `src/components/layout/Header.tsx:47`                        |
| Diğer konumlar      | `src/components/ui/ui.tsx:168`                               |
| Kullanıcılar        | misafir, ev sahibi, admin                                    |
| Prensip             | robustness · Observability: sistem durumu doğru yansıtılmalı |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                               |
| Renk/tema           | Hayır                                                        |
| Efor                | M                                                            |
| Kaynak denetçiler   | runtime:shell                                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                 |

**Kanıt:** P9 ve P11 (probes/shell/p11-nav-flash.mjs), guest 1280x800. İlk yüklemede t=53–507 ms arası 'Kayıt ol|Giriş yap', ardından 'Sepetim|Destek|Hesabım|Çıkış yap'. Başlık nav'ıyla 3 istemci gezinmesinde her seferinde anon durum görüldü: t=219→388, 2306→2826, 4334→4666 ms. Bu 3 gezinmede 12 adet /api/user/me isteği gitti (dev StrictMode'un çift çağrısı dahil). 390 px'te avatar yaklaşık 540 ms sonra beliriyor. Kök neden: Header her sayfada ayrı render ediliyor (PageShell ve sayfa bileşenleri), user state null başlıyor ve paylaşılan bir oturum önbelleği yok.

**Etki:** Giriş yapmış kullanıcı her sayfada kısa süre 'Giriş yap' görüyor; hızlı tıklayan biri gereksiz yere login sayfasına düşebilir. Her gezinmede ek ağ isteği yapılıyor.

**Önerilen aksiyon:** Header ve Footer'ı kök ya da segment layout'una taşıyın ki gezinmede yeniden mount olmasın. İlk oturum durumunu sunucuda çerezden okuyup prop olarak verin veya bir SessionProvider/SWR önbelleği kullanın. Yüklenirken auth alanında Kayıt/Giriş düğmeleri yerine nötr bir iskelet gösterin.

## F557 — Başlık nav'ıyla sayfa değiştirildiğinde odak body'ye düşüyor; rota duyurusu güvenilmez (boş kalabiliyor)

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Gözlemlendi                                             |
| Konum               | `src/components/layout/Header.tsx:86`                   |
| Diğer konumlar      | `src/app/layout.tsx:16`, `src/components/ui/ui.tsx:169` |
| Kullanıcılar        | tümü                                                    |
| Prensip             | robustness · Observability / feedback                   |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                          |
| WCAG                | 2.4.3 Focus Order (risk)                                |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | runtime:shell                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** P3 (probes/shell/p3-nav-skip.mjs), guest 1280x800, başlık nav'ıyla /plan, /transfers, /support, / ve /cart sayfalarına gidildi. document.title her sayfada aynıydı ve odak her seferinde body'ye düştü. Next route announcer metni iki koşuda şöyle çıktı: /plan için bir kez 'Gezi planlayıcı', bir kez boş; /cart için iki koşuda da boş. Announcer yalnız title değiştiğinde ya da title boşken h1'e düşüyor (node_modules/next/dist/client/components/app-router-announcer.js), bu yüzden duyuru bir yarış koşuluna bağlı. Mobil menü bağlantısıyla yapılan gezinmede de odak body (P2).

**Etki:** Ekran okuyucu kullanıcısı bağlantıya bastıktan sonra sayfanın değişip değişmediğini her zaman bilemiyor ve sayfanın başından yeniden gezinmek zorunda kalıyor.

**Önerilen aksiyon:** Sayfa başına metadata title tanımlayın (genel bulgu); bu announcer'ı güvenilir yapar. Ek olarak kabukta pathname değişince main#main (tabIndex={-1}) ya da h1 öğesine odak verin.

## F558 — Dil seçicide tek ok tuşu tüm arayüzün dilini (ve oturumluysa e-posta dilini) anında değiştiriyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Gözlemlendi                                   |
| Konum               | `src/components/layout/LocaleSwitcher.tsx:18` |
| Kullanıcılar        | tümü                                          |
| Prensip             | learnability · Predictability                 |
| Sezgisel madde      | H5 — Hata önleme                              |
| WCAG                | 3.2.2 On Input (A) — risk                     |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | runtime:shell                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** P5 (probes/shell/p5-locale-focus.mjs): kapalı select'e odaklanıp tek ArrowDown basınca 10 rota ve 4 personada (anon /, /plan, /login, /privacy; guest /account, /trips, /booking/:id, /account/sessions; host /host; admin /admin) lang tr'den en'e geçti. Oturumluyken aynı tuş PUT /api/user/locale 200 gönderiyor (P4); test sonunda tercih tr'ye geri alındı. Geçiş devde yaklaşık 1913 ms sürdü ve bu sürede ilerleme göstergesi yok. Odak select'te kalıyor (olumlu).

**Etki:** Seçenekleri okumak için ok tuşlarını kullanan klavye ya da ekran okuyucu kullanıcısı istemeden tüm sayfanın dilini değiştiriyor. Oturumluysa kalıcı e-posta dili de değişiyor.

**Önerilen aksiyon:** onChange'de dili hemen uygulamayın: değeri yerel state'te tutun ve Enter, blur ya da bitişik 'Uygula' düğmesiyle uygulayın. Alternatif olarak dili iki bağlantı (TR | EN) olarak sunun. Yenileme sırasında aria-busy ve küçük bir gösterge ekleyin. PUT /api/user/locale isteğini yalnız oturum varken gönderin.

## F559 — Çerez onayı uygulama içinden değiştirilemiyor; aydınlatma metni çerezi silmeyi öneriyor

| Alan                | Değer                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                                     |
| Durum               | Gözlemlendi                                                                                                |
| Konum               | `src/components/privacy/CookieConsent.tsx:38`                                                              |
| Diğer konumlar      | `messages/tr/privacy.json`, `src/components/layout/Footer.tsx`, `src/components/privacy/PrivacyCenter.tsx` |
| Kullanıcılar        | tümü                                                                                                       |
| Prensip             | flexibility · Kullanıcı kontrolü (Dix: customizability)                                                    |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                                          |
| Renk/tema           | Hayır                                                                                                      |
| Efor                | S                                                                                                          |
| Kaynak denetçiler   | runtime:account                                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                               |

**Kanıt:** /privacy (anon, mobil, crops/account/023-1.png) '6. Çerezler': 'Tercihiniz cookie_consent çerezinde saklanır; çerezi silerek tercihinizi değiştirebilirsiniz.' (privacy.json:34). CookieConsent.tsx:38 onay varsa null döner, yeniden açma API'si yok; footer 'Çerez Bildirimi' yalnız /privacy#p-cookies çapası. /account/privacy (p3) yalnız 'Verilerimi indir' ve 'Hesabımı sil' bölümleri içeriyor.

**Etki:** Analitik çereze verdiği rızayı geri almak isteyen kullanıcı tarayıcı ayarlarına başvurmak zorunda; rızayı geri almak vermek kadar kolay değil (KVKK/GDPR md.7(3) beklentisi).

**Önerilen aksiyon:** Footer'a ve /account/privacy'ye 'Çerez tercihlerini yönet' butonu ekle; CookieConsent'e window olayı/context ile yeniden açma (customizing=true) desteği ver; aydınlatma metnini bu butona yönlendir.

## F560 — Çerez tercihini sonradan değiştirmek ya da onayı geri almak için arayüz yok; politika metni 'çerezi silin' diyor

| Alan                | Değer                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Severity            | Medium                                                               |
| Durum               | Gözlemlendi                                                          |
| Konum               | `src/components/privacy/CookieConsent.tsx:39`                        |
| Diğer konumlar      | `src/components/layout/Footer.tsx:72`, `messages/tr/privacy.json:34` |
| Kullanıcılar        | tümü                                                                 |
| Prensip             | flexibility · Recoverability / user control                          |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                    |
| Renk/tema           | Hayır                                                                |
| Efor                | S                                                                    |
| Kaynak denetçiler   | runtime:shell                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                         |

**Kanıt:** P6: 'Yalnızca zorunlu' seçilince cookie_consent=necessary yazılıyor ve bant kalıcı olarak kayboluyor. Sayfada kalan tek çerez kontrolü 'Çerez Bildirimi' (/privacy#p-cookies, statik metin). privacy.json:34 tercihi değiştirmek için çerezin silinmesini söylüyor. writeConsent yalnız CookieConsent.tsx içinde; PrivacyCenter'da ya da hesap sayfalarında consent değiştiren bir kontrol yok (grep ile doğrulandı).

**Etki:** 'Tümünü kabul et'e yanlışlıkla basan kullanıcı analitik onayını arayüzden geri alamıyor. Onay vermek kadar kolay geri alınabilmesi beklentisi (KVKK/GDPR) karşılanmıyor.

**Önerilen aksiyon:** CookieConsent'ten bir openConsentPreferences() fonksiyonu export edin (listeners deposu üzerinden bandı customizing=true olarak açsın). Footer'a 'Çerez tercihleri' düğmesi ve /account/privacy sayfasına aynı kontrolü ekleyin. privacy.json metnini buna göre güncelleyin.

## F561 — Çerez bandı sayfa altındaki içeriği kalıcı örtüyor: footer'ın yasal satırı ve anon checkout'ta 'Rezervasyonu Tamamla' kaydırılarak açılamıyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Medium                                        |
| Durum               | Gözlemlendi                                   |
| Konum               | `src/components/privacy/CookieConsent.tsx:47` |
| Diğer konumlar      | `src/app/layout.tsx:43`                       |
| Kullanıcılar        | tümü                                          |
| Prensip             | robustness · Task conformance                 |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                  |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | runtime:shell                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** P6 ve P6b (probes/shell/p6b-checkout-bottom.mjs): sayfa en alta kaydırıldığında footer'ın 5 kontrolü (Gizlilik Bildirimi, Güven merkezi, Verilerim, Kullanım Koşulları, Çerez Bildirimi) bandın altında kalıyor; mobil, masaüstü, EN, /login ve /register'da aynı. Anon /checkout (390x844): belge yüksekliği 844 ve viewport 844 (kaydırma yok); 'Uygula' (top 634) ve 'Rezervasyonu Tamamla' (top 765) bandın altında. Mobil ayak izi: bant 215 px (%25) + DEMO şeridi 41 px, ekranın %30'u; 'Özelleştir' sonrası 271 px, şeritle %35. Yatay telefonda (844x390) bant 115→157 px + şerit 25 px, %36–47. Ekran görüntüleri: RT/probes/shell/p6-banner-checkout-mobile.png, RT/probes/shell/p6-customize-mobile-tr.png.

**Etki:** Kullanıcı ödeme düğmesine ya da yasal bağlantılara ulaşmak için önce bantla uğraşmak zorunda. Yasal bağlantıları bandı kapatmadan okuyamıyor.

**Önerilen aksiyon:** Bant yüksekliği kadar body padding-bottom ve scroll-padding-bottom uygulayın (2.4.11 bulgusuyla aynı ResizeObserver). Mobilde bandı sıkıştırın: kısa metin, üç düğme tek satırda; özelleştirme alanına max-h ve overflow-auto verin.

## F562 — Oturumsuz ve yetkisiz /host: giriş bağlantısı panele geri dönmüyor, misafire 'HOST / ADMIN rolü' teknik dili gösteriliyor

| Alan                | Değer                                                              |
| ------------------- | ------------------------------------------------------------------ |
| Severity            | Medium                                                             |
| Durum               | Gözlemlendi                                                        |
| Konum               | `src/components/ui/ui.tsx:219`                                     |
| Kullanıcılar        | ev sahibi, misafir                                                 |
| Prensip             | learnability · Learnability: gerçek dünya eşleşmesi / dialog akışı |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                  |
| Renk/tema           | Hayır                                                              |
| Efor                | S                                                                  |
| Kaynak denetçiler   | runtime:host                                                       |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                       |

**Kanıt:** Tarama 048/049 (anon /host): 'Bu sayfa için giriş yapın.' Bağlantı href='/login' ve redirect parametresi içermiyor (ui.tsx:219). Login sayfası ?redirect= destekliyor (login/page.tsx:63) ama verilmediği için varsayılan '/'. Tarama 090/091 (guest /host): role=alert 'Bu sayfaya erişim yetkiniz yok (HOST / ADMIN rolü gerekir).' (ui.tsx:230). Ev sahibi olma yolunu gösteren bir bağlantı yok.

**Etki:** Oturumu düşen ev sahibi giriş yaptıktan sonra ana sayfaya atılıyor ve panele yeniden gitmek zorunda kalıyor. Misafir teknik rol kodlarıyla karşılaşıyor ve ev sahibi olmak için ne yapacağını bilmiyor.

**Önerilen aksiyon:** RoleGate'te href={`/login?redirect=${encodeURIComponent(pathname)}`} kullanın. Yetki mesajını 'Bu sayfa ev sahipleri içindir. Mülkünüzü listelemek için: [Ev sahibi olun]' biçiminde yazın ve rol kodlarını göstermeyin.

## F563 — Talep sayfalarındaki giriş kapısı dönüş adresini atıyor: e-postadaki talep bağlantısı girişten sonra ana sayfaya düşüyor

| Alan                | Değer                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Severity            | Medium                                                                                        |
| Durum               | Gözlemlendi                                                                                   |
| Konum               | `src/components/ui/ui.tsx:219`                                                                |
| Diğer konumlar      | `src/app/login/page.tsx`, `src/lib/notifications/resolution-notifications.ts`                 |
| Kullanıcılar        | misafir, ev sahibi                                                                            |
| Prensip             | flexibility · Kullanıcı kontrolü / bağlamın korunması (Dix: flexibility – task migratability) |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                                             |
| Renk/tema           | Hayır                                                                                         |
| Efor                | S                                                                                             |
| Kaynak denetçiler   | runtime:resolution                                                                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                  |

**Kanıt:** RUNTIME p3-pages (anon, TR): /resolution ve /resolution/missing sayfalarında "Bu sayfa için giriş yapın." bağlantısının href değeri "/login". redirect parametresi yok. Login sayfası ?redirect= desteğine sahip ama verilmezse "/" adresine gidiyor (login/page.tsx:63,141). Talep bildirim e-postaları /resolution/<id> adresine bağlantı veriyor (resolution-notifications.ts:40). Erişim token'ı yaklaşık 5 dk ömürlü, refresh başarısız olunca bu kapı görünüyor.

**Etki:** "Ev sahibi talebinize yanıt verdi" e-postasından gelen misafir giriş yaptıktan sonra ana sayfaya düşüyor ve talebi yeniden aramak zorunda kalıyor. SLA'lı yanıt süreleri düşünülünce gecikme riski doğuyor.

**Önerilen aksiyon:** RoleGate'te usePathname()/useSearchParams() ile `/login?redirect=${encodeURIComponent(pathname + search)}` üretin. Login'deki mevcut açık yönlendirme koruması yeterli.

## F564 — Yetkisiz rolde (misafir/ev sahibi) /admin ve /host: çıkış yolu yok, ham rol kodu var, admin alt menüsü ve görev açıklaması görünüyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Medium                                                  |
| Durum               | Gözlemlendi                                             |
| Konum               | `src/components/ui/ui.tsx:227`                          |
| Diğer konumlar      | `src/app/admin/page.tsx`                                |
| Kullanıcılar        | misafir, ev sahibi                                      |
| Prensip             | robustness · Kurtarılabilirlik ve anlaşılır hata mesajı |
| Sezgisel madde      | H9 — Hata mesajları                                     |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | runtime:admin                                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** Sweep 092/093 guest /admin: alert 'Bu sayfaya erişim yetkiniz yok (ADMIN rolü gerekir).' Üstünde 'Kuyrukları izleyin, olay sinyallerini onaylayın…' açıklaması ve 'Uyum paneli · Ödeme kontrolü · Hasar ve iade talepleri · Destek kuyruğu' bağlantıları görünüyor (crops/admin/092-guest-tr-desktop-_admin-0.png). Bunlar RoleGate dışında (admin/page.tsx:16-33). Sweep 090 guest /host: '(HOST / ADMIN rolü gerekir)'. p7 (EN, USER rolü stub) /admin/payouts: main içinde 0 bağlantı. Tüm durumlarda HTTP 200.

**Etki:** Misafir, erişemeyeceği alt sayfalara giden bağlantılarla başka çıkmazlara yönleniyor. 'ADMIN/HOST' kodları anlaşılmıyor. Ev sahibi olmak isteyen misafire bir yol gösterilmiyor.

**Önerilen aksiyon:** Alt menüyü ve açıklamayı RoleGate içine taşıyın. Yasak durumunda insan diliyle rol adı ('yönetici', 'ev sahibi') ve eylem bağlantıları verin: 'Ana sayfaya dön', 'Hesabım'. /host için 'Ev sahibi olun' bağlantısı ekleyin. Sunucu tarafında rol kontrolüyle 403/notFound semantiği sağlayın.

## F1031 — Marka adı üç biçimde: 'booking.com' / 'booking-platform' / 'Booking'

| Alan                | Değer                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                   |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                        |
| Konum               | `src/components/layout/Header.tsx:83`                                                                                 |
| Diğer konumlar      | `src/components/layout/Footer.tsx:48`, `src/app/layout.tsx:24`, `messages/tr/common.json:3`, `messages/tr/pwa.json:4` |
| Kullanıcılar        | tümü                                                                                                                  |
| Prensip             | learnability · consistency                                                                                            |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                                                                                           |
| Renk/tema           | Hayır                                                                                                                 |
| Efor                | S                                                                                                                     |
| Kaynak denetçiler   | area:shell, runtime:shell                                                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                          |

**Kanıt:** Header.tsx:83 'booking<span>.com</span>'; common.json meta.title ve Footer.tsx:48 'booking-platform'; layout.tsx:24 'appleWebApp: { title: "Booking" }' ve pwa.json manifest 'Booking'.

**Etki:** Kullanıcı sekme başlığı, logo ve kurulu uygulama adının aynı ürün olduğunu çıkarmak zorunda; '.com' logosu gerçek bir siteyle karıştırılabilir.

**Önerilen aksiyon:** common.json'a tek 'brand' anahtarı ekleyin; Header.tsx:83 logo, Footer.tsx:48, common.json meta.title ve layout.tsx:24 appleWebApp.title bu anahtardan beslensin; logo bağlantısına 'aria-label={`${brand} — ${t("home")}`}' verin. Logo renk vurgusu aynen kalır.

## F1032 — Dil seçicideki seçeneklerde lang özniteliği yok

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Doğrulandı (2 kaynak birleşti)                |
| Konum               | `src/components/layout/LocaleSwitcher.tsx:32` |
| Kullanıcılar        | tümü                                          |
| Prensip             | accessibility · WCAG 3.1.2 Language of Parts  |
| Sezgisel madde      | H14 — Erişilebilirlik                         |
| WCAG                | 3.1.2                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | lens:copy, area:shell                         |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** LocaleSwitcher.tsx:31-35 `<option key={l} value={l} …>{t(l)}</option>` — TR sayfada 'English', EN sayfada 'Türkçe' lang belirtilmeden okunuyor.

**Etki:** Ekran okuyucu dil adını sayfa dilinin ses motoruyla yanlış telaffuz ediyor; okuyucu desteği seçeneklerde sınırlı olduğundan etki küçük.

**Önerilen aksiyon:** `<option lang={l} …>` ekleyin; ayrıca seçenek metnini her dilin kendi adıyla (endonym) sabitleyin.

## F1033 — Yetkisiz kullanıcıya ham rol kodları (HOST / ADMIN) gösteriliyor ve çıkış yolu sunulmuyor

| Alan                | Değer                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                                             |
| Durum               | Doğrulandı (2 kaynak birleşti)                                                                                                                                                                  |
| Konum               | `src/components/ui/ui.tsx:230`                                                                                                                                                                  |
| Diğer konumlar      | `messages/tr/common.json:14`, `messages/en/common.json:14`, `src/components/host/HostDashboard.tsx:71`, `src/components/host/HostDashboard.tsx:85`, `src/components/host/PartyRiskPanel.tsx:27` |
| Kullanıcılar        | tümü                                                                                                                                                                                            |
| Prensip             | learnability · familiarity; hata mesajı (H9)                                                                                                                                                    |
| Sezgisel madde      | H9 — Hata mesajları                                                                                                                                                                             |
| Renk/tema           | Hayır                                                                                                                                                                                           |
| Efor                | S                                                                                                                                                                                               |
| Kaynak denetçiler   | area:host2, area:compliance, area:host                                                                                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                                    |

**Kanıt:** ui.tsx:227-231 `t("forbidden", { roles: roles.join(" / ") })` çağrısı tr common.json:14 ile 'Bu sayfaya erişim yetkiniz yok (HOST / ADMIN rolü gerekir).' çıktısı veriyor. Bağlantı ya da eylem yok. Sayfa yüklenir yüklenmez gelen statik bir mesajda `role="alert"` kullanılmış.

**Etki:** Bir bağlantıdan (ör. Güven merkezindeki şeffaflık raporu) gelen misafir ya da ev sahibi İngilizce enum kodu görür ve nereye gideceğini bilemez.

**Önerilen aksiyon:** common.json'a `roles: { USER: "Misafir", HOST: "Ev sahibi", ADMIN: "Yönetici" }` ekleyin (EN: Guest/Host/Admin) ve `roles.map(r => t(`roles.${r}`)).join(" / ")` kullanın. Mesajın altına `<Link href="/">` 'Ana sayfaya dön' bağlantısı ve loginHref ile 'Farklı hesapla giriş yap' bağlantısı ekleyin. Statik mesajda `role="alert"` yerine bir h2 başlığı ve paragraf kullanın.

## F1060 — Demo şeridi mobilde iki satır kaplıyor; 'DEMO' etiketi 10px

| Alan                | Değer                                                  |
| ------------------- | ------------------------------------------------------ |
| Severity            | Low                                                    |
| Durum               | Doğrulandı                                             |
| Konum               | `src/app/layout.tsx:59`                                |
| Diğer konumlar      | `messages/tr/common.json:8`                            |
| Kullanıcılar        | tümü                                                   |
| Prensip             | learnability · estetik-minimal tasarım / okunabilirlik |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                           |
| Renk/tema           | Hayır                                                  |
| Efor                | S                                                      |
| Kaynak denetçiler   | area:shell                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                           |

**Kanıt:** layout.tsx:53-63 'sticky top-0 z-50 ... text-xs'; demo.banner ≈63 karakter + etiket 360px'te iki satıra kırılıyor (≈40px kalıcı yükseklik); 59 'text-[10px]'. Alttaki sabit çerez bandıyla birlikte görünür alan daralıyor.

**Etki:** Mobilde içerik alanı her sayfada daralır; 10px etiket düşük görüşlü kullanıcı için zor okunur.

**Önerilen aksiyon:** Kapatılamaz/yapışkan kararını (v4#5) koruyarak common.json'a 'demo.bannerShort' ('Demo — gerçek ödeme yok') ekleyin; '<span className="sm:hidden">' kısa, '<span className="hidden sm:inline">' uzun metni gösterin; 59'daki 'text-[10px]' → 'text-xs'. Renkler aynen kalır.

## F1061 — 34 çeviri ad alanının tamamı (≈85 KB) her sayfada istemciye gönderiliyor

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Doğrulandı                                  |
| Konum               | `src/app/layout.tsx:65`                     |
| Diğer konumlar      | `src/i18n/messages.ts:8`                    |
| Kullanıcılar        | misafir                                     |
| Prensip             | robustness · responsiveness (algılanan hız) |
| Sezgisel madde      | H15 — Performans                            |
| Renk/tema           | Hayır                                       |
| Efor                | M                                           |
| Kaynak denetçiler   | area:shell                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** layout.tsx:35 'const messages = await getMessages();' ve 65 '<NextIntlClientProvider locale={locale} messages={messages}>'; i18n/messages.ts:8 34 ad alanı; messages/tr/*.json toplam 85.613 bayt (sıkıştırılmamış) ilk RSC yüküne ekleniyor.

**Etki:** Mobil misafirin ilk yüklemesi admin/host/compliance metinleriyle şişer.

**Önerilen aksiyon:** Kök sağlayıcıya yalnız kabuk ad alanlarını verin (common, nav, footer, locale, cookie, pwa); rota özel ad alanlarını ilgili segment layout'unda iç içe NextIntlClientProvider ile ekleyin.

## F1062 — Çevrimdışı sayfasında 'Tekrar dene' ve ana sayfaya dönüş yok

| Alan                | Değer                             |
| ------------------- | --------------------------------- |
| Severity            | Low                               |
| Durum               | Doğrulandı                        |
| Konum               | `src/app/offline/page.tsx:14`     |
| Diğer konumlar      | `public/sw.js:135`                |
| Kullanıcılar        | misafir, ev sahibi                |
| Prensip             | robustness · recoverability       |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü |
| Renk/tema           | Hayır                             |
| Efor                | S                                 |
| Kaynak denetçiler   | area:shell                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**      |

**Kanıt:** offline/page.tsx:8-17 yalnız h1, bir paragraf ve '/trips' bağlantısı içeriyor; Header/Footer yok. sw.js:135 'fetch(request).catch(offlineFallback)' bu içeriği istenen URL'de sunuyor, ama metin sayfayı yenilemenin çözüm olduğunu söylemiyor.

**Etki:** Bağlantısı geri gelen kullanıcı nasıl devam edeceğini bilmez; tek çıkış Seyahatlerim ya da tarayıcının geri/yenile düğmesi.

**Önerilen aksiyon:** Sayfaya '<a href="">' ile 'Tekrar dene' bağlantısı (JS olmadan mevcut URL'yi yeniden yükler) ve '<Link href="/">' 'Ana sayfa' ekleyin. Küçük bir istemci bileşeniyle 'online' olayında location.reload() çağırın. pwa.json'a 'offline.retry' ve 'offline.home' anahtarlarını ekleyin.

## F1063 — Altbilgi alt bağlantı satırı sarmıyor; dar ekranda sıkışıyor

| Alan                | Değer                                 |
| ------------------- | ------------------------------------- |
| Severity            | Low                                   |
| Durum               | Doğrulandı                            |
| Konum               | `src/components/layout/Footer.tsx:50` |
| Kullanıcılar        | tümü                                  |
| Prensip             | accessibility · Reflow                |
| Sezgisel madde      | H8 — Estetik/minimal tasarım          |
| WCAG                | 1.4.10                                |
| Renk/tema           | Hayır                                 |
| Efor                | S                                     |
| Kaynak denetçiler   | area:shell                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**          |

**Kanıt:** Footer.tsx:50 '<div className="flex items-center gap-4">' beş öğe, flex-wrap yok; 12px metinde min-content toplamı ≈260px + 4×16px ≈ 324px, 360px'te kullanılabilir 328px'e dayanıyor, 320px'te taşar; öğeler kelime kelime çok satıra kırılır.

**Etki:** Dar ekranda yasal bağlantılar düzensiz kırılır, dokunma hedefleri birbirine yaklaşır, 320px'te kenardan taşabilir.

**Önerilen aksiyon:** 50. satırı 'flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-end' yapın.

## F1064 — Menüde yetki kapısı tutarsız: 'Gezi planla' oturumsuz kullanıcıya görünüyor ama giriş istiyor; Güven merkezi yalnız yöneticiye açık sayfaya bağlanıyor

| Alan                | Değer                                                   |
| ------------------- | ------------------------------------------------------- |
| Severity            | Low                                                     |
| Durum               | Doğrulandı                                              |
| Konum               | `src/components/layout/Header.tsx:21`                   |
| Diğer konumlar      | `src/app/plan/page.tsx:12`, `src/app/trust/page.tsx:47` |
| Kullanıcılar        | misafir                                                 |
| Prensip             | learnability · predictability / consistency             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar                             |
| Renk/tema           | Hayır                                                   |
| Efor                | S                                                       |
| Kaynak denetçiler   | area:misc, lens:consistency                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                            |

**Kanıt:** Header.tsx:21'deki `{ key: "plan", href: "/plan" }` öğesinde roles yok; oysa :24 cart ve :26 support `roles: ["USER","HOST","ADMIN"]` ile gizleniyor. plan/page.tsx RoleGate kullanıyor. trust/page.tsx:47'deki `{ key: "transparency", href: "/admin/compliance" }` herkese açık sayfadan ADMIN'e özel sayfaya gidiyor.

**Etki:** Oturumsuz misafir 'Gezi planla'ya tıklayıp yalnızca 'giriş yapın' metniyle karşılaşır; giriş gerektiren diğer öğeleri ise hiç görmez. Şeffaflık raporu bağlantısı kamuya açık görünür ama misafirin erişimine kapalıdır.

**Önerilen aksiyon:** Tek bir kural seçin. Önerilen: giriş gerektiren öğeler oturumsuz kullanıcıya görünsün, ama Header'da `<span className="sr-only"> (giriş gerekir)</span>` eki taşısın ve bağlantı loginHref(item.href) olsun. Bu kural cart, support ve plan için aynı uygulansın. Alternatif: plan öğesine `roles: ["USER","HOST","ADMIN"]` ekleyin. trust/page.tsx:47'deki transparency bağlantısını kamuya açık bir rapor ucuna yönlendirin ya da listeden çıkarın.

## F1065 — 'Gezi planla' oturumsuz kullanıcıya gösteriliyor ama giriş istiyor; benzer Sepetim/Destek gizli

| Alan                | Değer                                       |
| ------------------- | ------------------------------------------- |
| Severity            | Low                                         |
| Durum               | Doğrulandı                                  |
| Konum               | `src/components/layout/Header.tsx:21`       |
| Diğer konumlar      | `src/app/plan/page.tsx:12`                  |
| Kullanıcılar        | misafir                                     |
| Prensip             | learnability · consistency / predictability |
| Sezgisel madde      | H13 — Feedforward                           |
| Renk/tema           | Hayır                                       |
| Efor                | S                                           |
| Kaynak denetçiler   | area:shell                                  |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                |

**Kanıt:** Header.tsx:21 '{ key: "plan", href: "/plan" }' roles içermiyor; 24-26 cart ve support 'roles: ["USER","HOST","ADMIN"]' ile gizli. plan/page.tsx:12 '<RoleGate>{() => <TripPlanner />}</RoleGate>' giriş istiyor; transfers ise girişsiz açılıyor (public liste).

**Etki:** Misafir 'Gezi planla'yı açar ve yalnız 'giriş yapın' metniyle karşılaşır; benzer özellikler bir yerde gizli bir yerde açık olduğu için kural öğrenilemez.

**Önerilen aksiyon:** Bir kural seçin: (a) plan öğesine 'roles: ["USER","HOST","ADMIN"]' ekleyin; ya da (b) giriş isteyen öğeleri oturumsuz kullanıcıya gösterin ama href'i '/login?redirect=/plan' yapın ve etikete gizli '(giriş gerekir)' metni ekleyin. R1-7'deki redirect düzeltmesiyle birlikte (b) daha keşfedilebilir.

## F1066 — Gezinmede sepet kalemi ve yönetici kuyruklarında bekleyen iş sayısı görünmüyor

| Alan                | Değer                                 |
| ------------------- | ------------------------------------- |
| Severity            | Low                                   |
| Durum               | Doğrulandı                            |
| Konum               | `src/components/layout/Header.tsx:24` |
| Diğer konumlar      | `src/app/admin/page.tsx:17`           |
| Kullanıcılar        | misafir, admin                        |
| Prensip             | robustness · observability            |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü        |
| Renk/tema           | Hayır                                 |
| Efor                | M                                     |
| Kaynak denetçiler   | lens:status                           |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**          |

**Kanıt:** Header.tsx:24 `{ key: "cart", href: "/cart", … }` sayaçsız render ediliyor (:86-94); admin/page.tsx:17-33 kuyruk bağlantıları sayı göstermiyor.

**Etki:** Misafir sepette bekleyen (tutma süresi işleyen) kalemleri hatırlamıyor; yönetici hangi kuyruğun acil olduğunu görmek için her sayfayı açıyor.

**Önerilen aksiyon:** Sepet bağlantısına useCart'tan gelen kalem sayısını metin rozeti olarak ekleyin ve erişilebilir adı 'Sepetim, 3 kalem' yapın (nav.json'a ICU çoğul anahtar). admin/page.tsx bağlantılarına 'Talepler · 4 açık' biçiminde sayıları mevcut sayım uçlarından ekleyin.

## F1067 — Çıkışta bekleme durumu yok ve kullanıcı her sayfadan ana sayfaya atılıyor

| Alan                | Değer                                 |
| ------------------- | ------------------------------------- |
| Severity            | Low                                   |
| Durum               | Doğrulandı                            |
| Konum               | `src/components/layout/Header.tsx:60` |
| Diğer konumlar      | `src/lib/api-client.ts:90`            |
| Kullanıcılar        | tümü                                  |
| Prensip             | robustness · feedback                 |
| Sezgisel madde      | H12 — Feedback                        |
| Renk/tema           | Hayır                                 |
| Efor                | S                                     |
| Kaynak denetçiler   | area:shell                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**          |

**Kanıt:** Header.tsx:60-65 'await logout(); setUser(null); router.push("/"); router.refresh();' — logout() (api-client.ts:90-98) ağ isteği + clearOfflineUserData() bekler; bu sürede düğmeler (114-120, 191-197) disabled değil ve metin değişmiyor. Herkese açık sayfadan (ilan, arama) çıkışta da '/' yönlendirmesi.

**Etki:** Paylaşılan cihazdaki kullanıcı çıkışın sürdüğünü göremez, tekrar tıklar; ilan sayfasındaki kullanıcı bağlamını kaybeder.

**Önerilen aksiyon:** useState ile 'loggingOut' tutun; düğmelere 'disabled={loggingOut}' ve metin 'Çıkış yapılıyor…' (nav.json'a 'loggingOut' anahtarı) verin. Yönlendirmeyi yalnız korumalı rotalarda (/account, /cart, /host, /admin, /trips, /support) yapın; aksi halde yalnız 'router.refresh()'.

## F1068 — Header'daki Giriş/Kayıt bağlantıları kendi sayfalarında aria-current taşımıyor

| Alan                | Değer                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| Severity            | Low                                                                            |
| Durum               | Doğrulandı                                                                     |
| Konum               | `src/components/layout/Header.tsx:124`                                         |
| Diğer konumlar      | `src/components/layout/Header.tsx:200`, `src/components/layout/Header.tsx:104` |
| Kullanıcılar        | misafir                                                                        |
| Prensip             | learnability · consistency                                                     |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                 |
| Renk/tema           | Hayır                                                                          |
| Efor                | S                                                                              |
| Kaynak denetçiler   | area:auth                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                   |

**Kanıt:** Header.tsx:124-135 ve 200-211 'href="/register"', 'href="/login"' bağlantılarında aria-current yok; aynı bileşendeki nav öğeleri 90 ve 183'te 'aria-current={isCurrent(item.href) ? "page" : undefined}' kullanıyor. /account bağlantısı (104-108) da aynı eksikle.

**Etki:** Ekran okuyucu kullanıcısı /login'deyken başlıktaki 'Giriş yap'ın mevcut sayfa olduğunu duymaz.

**Önerilen aksiyon:** Dört bağlantıya ve /account bağlantısına 'aria-current={isCurrent("/login") ? "page" : undefined}' (ilgili href ile) ekleyin.

## F1069 — Mobil menü: aria-controls kapalıyken var olmayan id'yi gösteriyor, Escape ile kapanmıyor

| Alan                | Değer                                                             |
| ------------------- | ----------------------------------------------------------------- |
| Severity            | Low                                                               |
| Durum               | Doğrulandı                                                        |
| Konum               | `src/components/layout/Header.tsx:144`                            |
| Diğer konumlar      | `src/components/layout/Header.tsx:173`, `messages/tr/nav.json:15` |
| Kullanıcılar        | misafir, ev sahibi, admin                                         |
| Prensip             | flexibility · user control / ARIA ilişkileri                      |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                                 |
| WCAG                | 4.1.2                                                             |
| Renk/tema           | Hayır                                                             |
| Efor                | S                                                                 |
| Kaynak denetçiler   | area:shell                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                      |

**Kanıt:** Header.tsx:142-144 'aria-label={t("toggleMenu")} aria-expanded={isMenuOpen} aria-controls="mobile-menu"', 173 '{isMenuOpen && (<div id="mobile-menu"' — kapalıyken hedef DOM'da yok. Escape veya dış tıklama işleyicisi yok. nav.json:15 'Menüyü aç/kapat' aria-expanded ile durumu tekrarlıyor.

**Etki:** Yardımcı teknoloji kapalı durumda kontrol edilen öğeye bağlanamaz; klavye kullanıcısı menüyü yalnız düğmeye geri dönerek kapatabilir.

**Önerilen aksiyon:** #mobile-menu'yu her zaman render edip kapalıyken 'hidden={!isMenuOpen}' verin; menü kabına 'onKeyDown={(e) => { if (e.key === "Escape") { setIsMenuOpen(false); buttonRef.current?.focus(); } }}' ekleyin; nav.json 'toggleMenu' → 'Menü' / 'Menu'.

## F1070 — Dil seçici her değişimde anında ve geri bildirimsiz sayfayı yeniden çiziyor

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Doğrulandı                                    |
| Konum               | `src/components/layout/LocaleSwitcher.tsx:18` |
| Kullanıcılar        | tümü                                          |
| Prensip             | robustness · responsiveness / predictability  |
| Sezgisel madde      | H12 — Feedback                                |
| WCAG                | 3.2.2                                         |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:shell                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** LocaleSwitcher.tsx:18-28 onChange: çerez yazar, '/api/user/locale' PUT eder (yanıt beklenmez) ve 'router.refresh()' çağırır; bekleme durumu/disabled yok. Windows tarayıcılarında kapalı select üzerinde ok tuşu her basışta change tetikler → tuşlamayla gezinmek dili değiştirir ve sunucu yeniden render'ını başlatır.

**Etki:** Klavye kullanıcısı istemeden tüm arayüzün dilini değiştirebilir; yavaş ağda değişimin alınıp alınmadığını göremez.

**Önerilen aksiyon:** useTransition ile 'startTransition(() => router.refresh())' çalıştırın, isPending iken select'e 'aria-busy' ve 'disabled' verin; select yerine iki '<button aria-pressed>' (TR / EN) kullanmak hem 3.2.2 riskini hem ok tuşu sorununu kaldırır.

## F1071 — Çerez özelleştirmede 'Analitik' kategorisi açıklamasız

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Doğrulandı                                    |
| Konum               | `src/components/privacy/CookieConsent.tsx:82` |
| Diğer konumlar      | `messages/tr/cookie.json:6`                   |
| Kullanıcılar        | misafir                                       |
| Prensip             | learnability · predictability / feedforward   |
| Sezgisel madde      | H13 — Feedforward                             |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | area:shell                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** CookieConsent.tsx:74-83 '<label htmlFor="consent-analytics">{t("analytics")}</label>' yalnız 'Analitik'; ne ölçüldüğü/kimle paylaşıldığı yok. Özelleştirme modunda 'Tercihleri kaydet', 'Yalnızca zorunlu', 'Tümünü kabul et' birlikte; son ikisi kutu durumunu yok sayar (etiketleri bunu açıkça söylediği için sessiz kayıp değil, ama üç kaydetme yolu karar yükünü artırır).

**Etki:** Misafir neye onay verdiğini bilmeden seçim yapar; özelleştirme ekranındaki üç düğme kararı uzatır.

**Önerilen aksiyon:** cookie.json'a 'analyticsHint' ekleyin ('Hangi sayfaların kullanıldığını anonim olarak ölçer; üçüncü taraflarla paylaşılmaz' — gerçek uygulamaya göre); kutunun altına '<p id="consent-analytics-hint">' ekleyip input'a 'aria-describedby="consent-analytics-hint"' verin. Özelleştirme modunda 'Tümünü kabul et'i gizleyip yalnız 'Tercihleri kaydet' ve 'Yalnızca zorunlu' bırakın.

## F1072 — Button bileşeninde bekleme (pending) durumu yok

| Alan                | Değer                                     |
| ------------------- | ----------------------------------------- |
| Severity            | Low                                       |
| Durum               | Doğrulandı                                |
| Konum               | `src/components/ui/ui.tsx:29`             |
| Kullanıcılar        | tümü                                      |
| Prensip             | robustness · responsiveness / hata önleme |
| Sezgisel madde      | H12 — Feedback                            |
| Renk/tema           | Hayır                                     |
| Efor                | S                                         |
| Kaynak denetçiler   | area:shell                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**              |

**Kanıt:** ui.tsx:29-41 Button yalnız variant alıyor; loading/aria-busy desteği yok. Kod tabanında 'aria-busy' 0 kez geçiyor; 59 '<Button' kullanımının 24'ü 'disabled=' veriyor. Tüketiciler (ör. AppealForm.tsx:79 'disabled={state === "sending"}' + 'sending' metni) bekleme durumunu kendileri ele alıyor.

**Etki:** Bekleme davranışı bileşenden bileşene tutarsız; önlemi unutan bir tüketicide yavaş ağda kullanıcı tekrar basabilir.

**Önerilen aksiyon:** Button'a 'loading?: boolean' ve 'loadingLabel?: string' ekleyin: true iken 'disabled', 'aria-busy="true"' ve metin yerine loadingLabel (varsayılan common.processing 'İşleniyor…'). Mevcut 'disabled={busy}' + koşullu metin desenlerini bu prop'a taşıyın.

## F1073 — PageShell'de konum/kardeş sayfa gezinmesi yok (admin/host alt sayfaları)

| Alan                | Değer                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                 |
| Durum               | Doğrulandı                                                                                          |
| Konum               | `src/components/ui/ui.tsx:157`                                                                      |
| Diğer konumlar      | `src/app/admin/claims/page.tsx:11`, `src/app/host/payouts/page.tsx:26`, `src/app/admin/page.tsx:17` |
| Kullanıcılar        | admin, ev sahibi                                                                                    |
| Prensip             | flexibility · navigasyon verimi                                                                     |
| Sezgisel madde      | H7 — Esneklik/verim                                                                                 |
| Renk/tema           | Hayır                                                                                               |
| Efor                | M                                                                                                   |
| Kaynak denetçiler   | area:shell                                                                                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                        |

**Kanıt:** ui.tsx:157-179 PageShell yalnız title/intro/children alır. admin/page.tsx:17-33 dört alt sayfaya satır içi bağlantı verir; admin/claims/page.tsx:11-13 ve host/payouts/page.tsx:26-28 geri/kardeş bağlantısı içermez. Ancak Header.tsx:76 isCurrent 'startsWith' ile 'Yönetim'/'Ev sahibi paneli' öğesini alt sayfalarda aria-current yapıyor; merkeze dönüş tek tıkla mümkün.

**Etki:** Yönetici talep → ödeme → destek kuyrukları arasında her seferinde /admin'e dönmek zorunda (iki tıklama); konum yalnız h1'den çıkarılır.

**Önerilen aksiyon:** PageShell'e 'breadcrumbs?: { label: string; href?: string }[]' ekleyin; h1 üstünde '<nav aria-label="Konum"><ol className="flex gap-1 text-sm">…</ol></nav>' olarak render edip son öğeye 'aria-current="page"' verin; admin/page.tsx:17-33'teki bağlantı satırını küçük bir AdminNav bileşenine çıkarıp tüm /admin/* sayfalarında PageShell children'ının başına koyun (host için aynısı).

## F1074 — İçerik sütunu başlık/altbilgi ile hizalı değil (max-w-5xl px-4 / max-w-7xl lg:px-8)

| Alan                | Değer                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Severity            | Low                                                                          |
| Durum               | Doğrulandı                                                                   |
| Konum               | `src/components/ui/ui.tsx:169`                                               |
| Diğer konumlar      | `src/components/layout/Header.tsx:80`, `src/components/layout/Footer.tsx:23` |
| Kullanıcılar        | ev sahibi, admin                                                             |
| Prensip             | learnability · consistency (hizalama)                                        |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                                                 |
| Renk/tema           | Hayır                                                                        |
| Efor                | S                                                                            |
| Kaynak denetçiler   | area:shell                                                                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                 |

**Kanıt:** ui.tsx:169 PageShell main 'max-w-5xl px-4'; Header.tsx:80 ve Footer.tsx:23 'max-w-7xl px-4 sm:px-6 lg:px-8'. src/app altındaki sayfalarda max-w-3xl (14), max-w-7xl (6), max-w-xl (4), max-w-md (2) karışık.

**Etki:** Geniş ekranda logo ile sayfa başlığının sol kenarı farklı yerde başlar; tablo ağırlıklı panellerde yatay alan boşa gider.

**Önerilen aksiyon:** PageShell'e 'width?: "narrow" | "wide"' prop'u ekleyin (narrow=max-w-5xl, wide=max-w-7xl) ve yatay dolguyu başlıkla eşleyin ('px-4 sm:px-6 lg:px-8'); host/admin panel sayfalarında width="wide" verin.

## F1075 — Oturum bilgisi aynı sayfada iki kez çekiliyor; korumalı içerik oturumdan sonra yüklenmeye başlıyor

| Alan                | Değer                                                             |
| ------------------- | ----------------------------------------------------------------- |
| Severity            | Low                                                               |
| Durum               | Doğrulandı                                                        |
| Konum               | `src/components/ui/ui.tsx:187`                                    |
| Diğer konumlar      | `src/components/layout/Header.tsx:52`, `src/lib/api-client.ts:82` |
| Kullanıcılar        | tümü                                                              |
| Prensip             | robustness · responsiveness                                       |
| Sezgisel madde      | H15 — Performans                                                  |
| Renk/tema           | Hayır                                                             |
| Efor                | M                                                                 |
| Kaynak denetçiler   | area:shell                                                        |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                      |

**Kanıt:** Header.tsx:50-58 (her pathname değişiminde) ve useSession ui.tsx:183-195 ayrı ayrı fetchCurrentUser → '/api/user/me' (api-client.ts:82-88, önbellek/tekilleştirme yok). RoleGate (ui.tsx:206-234) çocuklarını oturum gelene kadar render etmez → çocukların useLoader istekleri ancak oturum yanıtından sonra başlar.

**Etki:** Mobil ağda korumalı sayfalarda (sepet, hesap, host/admin panelleri) 'Yükleniyor…' bir tur daha uzun sürer.

**Önerilen aksiyon:** Kök layout'a tek bir SessionProvider (context) ekleyip Header ve useSession'ı ondan besleyin; ya da fetchCurrentUser'da modül düzeyinde bekleyen Promise'i paylaşan basit bir tekilleştirme yapın.

## F1076 — Yeniden yüklemede yükleniyor işareti yok: filtre değişince eski liste yeni filtre altında işaretsiz kalıyor

| Alan                | Değer                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity            | Low                                                                                                                                                                              |
| Durum               | Doğrulandı                                                                                                                                                                       |
| Konum               | `src/components/ui/ui.tsx:246`                                                                                                                                                   |
| Diğer konumlar      | `src/components/admin/ClaimAdmin.tsx:54`, `src/components/admin/SupportAdmin.tsx:31`, `src/components/compliance/AccessibilityReviewQueue.tsx:28`, `src/app/search/page.tsx:503` |
| Kullanıcılar        | admin, ev sahibi                                                                                                                                                                 |
| Prensip             | robustness · observability                                                                                                                                                       |
| Sezgisel madde      | H1 — Sistem durumu görünürlüğü                                                                                                                                                   |
| WCAG                | 4.1.3                                                                                                                                                                            |
| Renk/tema           | Hayır                                                                                                                                                                            |
| Efor                | S                                                                                                                                                                                |
| Kaynak denetçiler   | lens:status                                                                                                                                                                      |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                                                                                                                                     |

**Kanıt:** ui.tsx:241-263 useLoader yalnız `{data, error, reload}` döndürüyor; deps değişince data sıfırlanmıyor, loading bayrağı yok. ClaimAdmin.tsx:25-31 `[status]` deps'li; :54 `{!data && !error && …loading}` yalnız ilk yüklemede görünüyor. Aynı desen SupportAdmin.tsx:31 ve AccessibilityReviewQueue.tsx:28. search/page.tsx kendi loading durumunu sayaçta (:426) gösteriyor ama sonuç ızgarası (:503) aria-busy/yarı saydamlık almıyor.

**Etki:** Yavaş ağda yönetici filtreyi 'Çözüldü'ye çevirdiğinde kısa süre eski filtrenin taleplerini görüp yanlış öğeye tıklayabiliyor; durum değişimi algılanmıyor.

**Önerilen aksiyon:** useLoader'a her fetch başında true, sonunda false olan `loading` durumu ekleyip döndürün. Tüketicilerde liste kapsayıcısına `aria-busy={loading}` ve `opacity-60` (renk değil saydamlık), başlık yanına `<p role="status">{t("loading")}</p>` ekleyin. search/page.tsx:503 ızgarasına `aria-busy={loading}` verin.

## F1142 — DEMO şeridi: 10 px etiket; mobilde 2 satırlık, 41 px kalıcı yapışkan alan

| Alan                | Değer                                        |
| ------------------- | -------------------------------------------- |
| Severity            | Low                                          |
| Durum               | Gözlemlendi                                  |
| Konum               | `src/app/layout.tsx:59`                      |
| Kullanıcılar        | tümü                                         |
| Prensip             | accessibility · Minimal design / readability |
| Sezgisel madde      | H8 — Estetik/minimal tasarım                 |
| Renk/tema           | Hayır                                        |
| Efor                | S                                            |
| Kaynak denetçiler   | runtime:shell                                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                 |

**Kanıt:** report.json tinyText: 'DEMO' span'ı tüm ziyaretlerde 10 px. Şerit masaüstünde 25 px, 390 px'te 41 px (iki satır) ve sticky. Çerez bandıyla birlikte 390 px'te 256 px, yani ekranın %30'u kapalı (P6).

**Etki:** Küçük ekranda içerik alanı sürekli daralıyor; 10 px etiket zor okunuyor.

**Önerilen aksiyon:** Etiketi text-xs (12 px) yapın. Mobilde kısa bir metin kullanın ('Demo — gerçek ödeme yok'). Şeridi bir landmark içine alın (genel region bulgusuyla birlikte).

## F1143 — Çevrimdışı sayfasında yeniden deneme, ana sayfa ya da marka yok; sayfa başlığı genel

| Alan                | Değer                        |
| ------------------- | ---------------------------- |
| Severity            | Low                          |
| Durum               | Gözlemlendi                  |
| Konum               | `src/app/offline/page.tsx:8` |
| Kullanıcılar        | tümü                         |
| Prensip             | robustness · Recoverability  |
| Sezgisel madde      | H9 — Hata mesajları          |
| Renk/tema           | Hayır                        |
| Efor                | S                            |
| Kaynak denetçiler   | runtime:shell                |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)** |

**Kanıt:** P8: /offline sayfası (masaüstü, mobil, EN) incelendi. Tek bağlantı 'Seyahatlerim' (/trips). Yenile/yeniden dene düğmesi, ana sayfa bağlantısı ya da logo yok. Başlık genel site başlığı. h1 dikey olarak ortada (masaüstünde top=357/800). Not: Service worker yalnız production'da kaydediliyor (ServiceWorkerRegistrar.tsx:12); gerçek ağ kesintisi senaryosu dev ortamında test edilemedi, içerik doğrudan /offline adresinden incelendi.

**Etki:** Bağlantı geri geldiğinde kullanıcıyı yönlendiren bir eylem yok; başlıktan çevrimdışı olunduğu anlaşılmıyor.

**Önerilen aksiyon:** 'Tekrar dene' düğmesi (location.reload) ekleyin ve window 'online' olayında otomatik yenileyin. metadata title olarak 'Çevrimdışısınız — booking-platform' verin. Logo ekleyin ve içeriği sayfanın üstünden başlatın.

## F1144 — Birincil nav'da her rol için 'Posta kutusu (demo)' görünüyor; 'Devir pazarı' jargon ve hedef sayfa başlıklarıyla uyumsuz

| Alan                | Değer                                    |
| ------------------- | ---------------------------------------- |
| Severity            | Low                                      |
| Durum               | Gözlemlendi                              |
| Konum               | `src/components/layout/Header.tsx:29`    |
| Diğer konumlar      | `messages/tr/nav.json`                   |
| Kullanıcılar        | misafir, ev sahibi                       |
| Prensip             | learnability · Familiarity / consistency |
| Sezgisel madde      | H2 — Gerçek dünya eşleşmesi              |
| Renk/tema           | Hayır                                    |
| Efor                | S                                        |
| Kaynak denetçiler   | runtime:shell                            |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**             |

**Kanıt:** P1/P2: anon, guest, host ve admin nav'ının hepsinde 'Posta kutusu (demo)' var. P3'te nav etiketi ile varılan sayfanın h1'i: 'Devir pazarı'→'Rezervasyon devri', 'Gezi planla'→'Gezi planlayıcı', 'Destek'→'Destek asistanı'. 1024 px'te 'Posta kutusu (demo)' 3 satıra kırılıyor.

**Etki:** Okuryazarlık düzeyi geniş bir yelpazede olan misafirler için anlamı belirsiz etiketler ve geliştirici aracı birincil nav'ı kalabalıklaştırıyor.

**Önerilen aksiyon:** Posta kutusunu yalnız ADMIN rolüne gösterin ya da DEMO şeridine bağlantı olarak taşıyın. Nav etiketlerini hedef h1 ile eşitleyin (ör. 'Rezervasyon devri').

## F1145 — Anon kullanıcıda her sayfa yüklemesinde 3 başarısız (401) istek; dil değişiminde PUT 401

| Alan                | Değer                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Severity            | Low                                                                       |
| Durum               | Gözlemlendi                                                               |
| Konum               | `src/components/layout/Header.tsx:52`                                     |
| Diğer konumlar      | `src/lib/api-client.ts:66`, `src/components/layout/LocaleSwitcher.tsx:22` |
| Kullanıcılar        | tümü                                                                      |
| Prensip             | robustness · Responsiveness                                               |
| Sezgisel madde      | H15 — Performans                                                          |
| Renk/tema           | Hayır                                                                     |
| Efor                | S                                                                         |
| Kaynak denetçiler   | runtime:shell                                                             |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                                              |

**Kanıt:** P15 (probes/shell/p15-net.mjs): anon kullanıcı için '/' ve '/privacy' sayfalarında 401 /api/user/me x2 ve 401 /api/auth/refresh. P4: dil değişiminde 401 PUT /api/user/locale. report.json consoleErrors: her kabuklu sayfada 3–5 hata. Dev StrictMode çift çağrı yapıyor; production'da beklenen sayı sayfa başına 2.

**Etki:** Her gezinmede gereksiz ağ gidiş-dönüşü oluyor; konsol hatalarla doluyor ve gerçek hatalar gözden kaçabiliyor.

**Önerilen aksiyon:** Oturum yokken 200 {user:null} dönen bir uç kullanın ya da ilk oturum durumunu sunucudan verin. Refresh token çerezi yokken refresh denemeyin (httpOnly olmayan bir 'has_session' işaret çerezi işe yarar). LocaleSwitcher PUT isteğini yalnız oturum varken göndersin.

## F1146 — Mobilde hesaba erişim yalnız 28 px'lik baş harf rozetinden; mobil menüde Hesabım ve Seyahatlerim yok

| Alan                | Değer                                         |
| ------------------- | --------------------------------------------- |
| Severity            | Low                                           |
| Durum               | Gözlemlendi                                   |
| Konum               | `src/components/layout/Header.tsx:112`        |
| Diğer konumlar      | `src/components/layout/Header.tsx:189`        |
| Kullanıcılar        | misafir, ev sahibi, admin                     |
| Prensip             | learnability · Recognition rather than recall |
| Sezgisel madde      | H6 — Tanıma > hatırlama                       |
| Renk/tema           | Hayır                                         |
| Efor                | S                                             |
| Kaynak denetçiler   | runtime:shell                                 |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                  |

**Kanıt:** P1/P2: 640 px altında avatar yalnız 28x28 'AD' rozeti (ad 'hidden sm:inline' ile gizli); 390 px'te 364..408 aralığında, kısmen kesik. Mobil menü öğeleri: Konaklama, Gezi planla, Devir pazarı, Sepetim, Destek, Posta kutusu (demo), Çıkış yap. 'Hesabım' ve 'Seyahatlerim' yok.

**Etki:** Misafir hesap ve seyahat sayfasını metin etiketiyle bulamıyor; baş harflerin bir bağlantı olduğunu tahmin etmesi gerekiyor.

**Önerilen aksiyon:** Mobil menüye 'Hesabım' (/account) ve 'Seyahatlerim' (/trips) metin bağlantıları ekleyin.

## F1147 — /account'ta iki ayrı çıkış düğmesi, farklı yazımla ('Çıkış yap' ve 'Çıkış Yap')

| Alan                | Değer                                  |
| ------------------- | -------------------------------------- |
| Severity            | Low                                    |
| Durum               | Gözlemlendi                            |
| Konum               | `src/components/layout/Header.tsx:119` |
| Diğer konumlar      | `src/app/account/page.tsx:211`         |
| Kullanıcılar        | misafir, ev sahibi, admin              |
| Prensip             | learnability · Consistency             |
| Sezgisel madde      | H4 — Tutarlılık/standartlar            |
| Renk/tema           | Hayır                                  |
| Efor                | S                                      |
| Kaynak denetçiler   | runtime:shell                          |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**           |

**Kanıt:** P9: /account sayfasındaki düğmeler: 'header:Çıkış yap' ve 'main:Çıkış Yap'. Tab sırasında art arda geliyorlar (report 060 tabOrder #11–#12).

**Etki:** Gereksiz tekrar ve tutarsız büyük harf kullanımı; klavye kullanıcısına bir fazladan durak.

**Önerilen aksiyon:** Sayfa içindeki çıkış düğmesini kaldırın ya da başlıktakiyle aynı metni ('Çıkış yap') kullanın.

## F1148 — Mobil menü Escape ya da dış dokunuşla kapanmıyor; mevcut sayfa görsel olarak işaretlenmiyor

| Alan                | Değer                                      |
| ------------------- | ------------------------------------------ |
| Severity            | Low                                        |
| Durum               | Gözlemlendi                                |
| Konum               | `src/components/layout/Header.tsx:184`     |
| Diğer konumlar      | `src/components/layout/Header.tsx:138`     |
| Kullanıcılar        | tümü                                       |
| Prensip             | flexibility · User control / observability |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü          |
| Renk/tema           | Hayır                                      |
| Efor                | S                                          |
| Kaynak denetçiler   | runtime:shell                              |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**               |

**Kanıt:** P2 (probes/shell/p2-hamburger.mjs), 390 ve 768 px: Enter ile açılıyor (aria-expanded true). Escape sonrası aria-expanded hâlâ true ve odak menüde kalıyor. Sayfa dışına (5,600) tıklamak da menüyü kapatmıyor. P9d: /plan'da 'Gezi planla' aria-current='page' ama arka plan rgba(0,0,0,0) ve font-weight 500, diğer öğelerle aynı. Masaüstündeki aynı öğenin arka planı rgba(255,255,255,0.15). 390 px'te kapatma 'X' ikonu da yarıya kesik. Ekran görüntüsü: RT/probes/shell/p9-mobile-menu-plan.png.

**Etki:** Klavye kullanıcısı menüyü beklendiği gibi Escape ile kapatamıyor. Mobil kullanıcı hangi bölümde olduğunu menüde göremiyor.

**Önerilen aksiyon:** Mobil menüdeki Link'lere 'aria-[current=page]:bg-white/15 aria-[current=page]:font-semibold' ekleyin. Menü açıkken document üzerinde keydown 'Escape' dinleyin: setIsMenuOpen(false) yapın ve odağı hamburger düğmesine geri verin.

## F1149 — Çerez bandında kabul ve ret eşit ağırlıkta değil: 'Tümünü kabul et' dolu birincil düğme, 'Yalnızca zorunlu' çerçeveli

| Alan                | Değer                                            |
| ------------------- | ------------------------------------------------ |
| Severity            | Low                                              |
| Durum               | Gözlemlendi                                      |
| Konum               | `src/components/privacy/CookieConsent.tsx:120`   |
| Kullanıcılar        | tümü                                             |
| Prensip             | learnability · Predictability / ethical defaults |
| Sezgisel madde      | H3 — Kullanıcı kontrolü/özgürlüğü                |
| Renk/tema           | Hayır                                            |
| Efor                | S                                                |
| Kaynak denetçiler   | runtime:shell                                    |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**                     |

**Kanıt:** P6: 'Tümünü kabul et' bg-[#003580] text-white, 'Yalnızca zorunlu' border-[#003580] (çerçeveli). 390 px'te 'Tümünü kabul et' ikinci satırda tek başına dolu düğme olarak kalıyor. Ekran görüntüsü: RT/probes/shell/p6-customize-mobile-tr.png.

**Etki:** Görsel ağırlık kullanıcıyı analitik onaya yönlendiriyor; KVKK çerez rehberindeki eşit seçenek beklentisiyle çelişiyor.

**Önerilen aksiyon:** İki düğmeyi aynı varyantta gösterin (ikisi de mevcut secondary ya da ikisi de primary stil). Sırayı 'Yalnızca zorunlu | Tümünü kabul et' yapın. Renk değişikliği gerekmez, yalnız varyant seçimi.

## F1150 — Status bileşeni role=alert'i aria-live=polite içinde iç içe kullanıyor (çift duyuru riski)

| Alan                | Değer                           |
| ------------------- | ------------------------------- |
| Severity            | Low                             |
| Durum               | Gözlemlendi                     |
| Konum               | `src/components/ui/ui.tsx:146`  |
| Kullanıcılar        | admin, tümü                     |
| Prensip             | accessibility · Durum mesajları |
| Sezgisel madde      | H14 — Erişilebilirlik           |
| WCAG                | 4.1.3 Durum Mesajları (AA)      |
| Renk/tema           | Hayır                           |
| Efor                | S                               |
| Kaynak denetçiler   | runtime:admin                   |
| **Düzeltme durumu** | **Sonraki tur (Medium/Low)**    |

**Kanıt:** RUNTIME p3-claims.mjs: kısmi tutar hatasında aynı metin iki canlı öğede bulundu: {live:'polite'} sarmalayıcı ve {role:'alert'} çocuk. Sweep 104'te sayfada 7 adet boş 'div.min-h-[1.25rem] live=polite' var.

**Etki:** Bazı ekran okuyucu/tarayıcı ikilileri hatayı iki kez okuyor.

**Önerilen aksiyon:** Tek bir canlı bölge kullanın: hata için role='alert', başarı için role='status' olsun ve sarmalayıcıdaki aria-live kaldırılsın.
